# Phase A — Real Ownership & Permission Verification (Roblox Open Cloud)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to execute this plan task-by-task (fresh implementer + two-stage review per task). Each task ends with an independently testable deliverable. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the always-`NOT_VERIFIED` ownership evidence into *actually verified where Roblox's API allows it* — for an animation being preflighted, confirm who created the asset and who owns the target experience, and surface whether they match — feeding the existing evidence model, manifest, and gate, without ever overclaiming and without breaking manifest determinism.

**Architecture:** A user configures a Roblox Open Cloud API key in the desktop app (opt-in, desktop-side only). An explicit "verify ownership" action on an animation asset calls Open Cloud once through the desktop bridge, computes an ownership outcome, and persists it to an insert-only ledger. That persisted result feeds the evidence classifier (ownership basis → `VERIFIED`), the exported manifest (deterministically, from persisted rows only), and the release gate (a *mismatch without a human decision* becomes a review lead that a person must resolve — never an auto-block). Live API calls happen only at the explicit verify action, never on export.

**Tech stack:** Java 21 (core + desktop, JavaFX, SQLite, `java.net.http.HttpClient`), React 19 + TypeScript (frontend), Roblox Open Cloud v1/v2 REST (`x-api-key`).

## Global Constraints

- **Honesty (load-bearing).** `VERIFIED` ownership means *"CreatorFlow confirmed, via Roblox's authoritative API, who created this asset and who owns the target experience."* It does **not** mean "you have the right to use this." A creator↔owner **match** is strong positive evidence; a **mismatch** is a *review lead*, never proof of infringement (the team may legitimately license the asset). Copy the "review lead, not a verdict" framing that already governs similarity.
- **Never auto-block on the API result.** A mismatch only blocks the gate when there is *no human decision yet*, exactly like `FLAGGED_WITHOUT_APPROVAL`. An `APPROVED`/`EXCLUDED` human decision — not the Open Cloud result — clears the gate.
- **Determinism (Increment 2's guarantee).** Re-exporting a release from the same scan must remain byte-identical. Open Cloud is called ONLY at the explicit verify action and the result is persisted; `ReleaseExportService` reads persisted rows and MUST NOT depend on `OpenCloudClient`. No wall-clock/random enters the manifest — the persisted `checkedAt` is part of the persisted row, stamped as-is.
- **Scope: the animation path only.** Ownership verification requires a real Roblox **Animation asset ID** (available on the plugin/animation-comparison path) and the project's bound **universeId** (from Increment 1). Generic scanned files with only a `sha256`/path have no Roblox ID and stay `NOT_VERIFIED` — nothing to check. State this in the UI.
- **Auth: user-scoped API key, `x-api-key`.** Scopes: `asset:read` (+ universe read, group read). No OAuth in v1 (OAuth/PKCE is only needed for private inventory, which is out of scope). The key lives desktop-side (a properties file in the app data dir), never in the frontend, the manifest, logs, or VCS.
- **Store raw facts, not just a boolean.** The persisted record keeps creator id+type, experience owner id+type, group-membership rank (if applicable), moderation state, the raw JSON, and `checkedAt` — plus the computed outcome. Downstream reads facts, so a later policy change doesn't require re-verification.
- **Schema stays v0.2.** The new manifest ownership field is OPTIONAL and additive (omitted when absent), exactly like `experience` and `evidenceBases` were added without a version bump. Existing v0.2 manifests without it must still validate on both the Java and AJV paths.
- **Rate limits & failures.** Distinguish HTTP 429 from other errors; surface a clear "rate-limited, try again" rather than a generic failure. Any non-success (no key, 4xx/5xx, private inventory, unmapped IDs) → ownership stays `NOT_VERIFIED`, never a false `VERIFIED`.

---

## Task 0 (GATE) — Feasibility spike: confirm the real Open Cloud surface

**Nothing past this task is built until the spike confirms the core calls behave as the research assumed.** The research (`docs/superpowers/plans/…` digest) is *medium confidence* on two things that make or break the feature.

**Files:** none committed — a throwaway script (`scratch/oc-spike.*`) or manual `curl`, results written to a short findings note.

- [ ] **Step 1 — Get a key.** Create a user-scoped Open Cloud API key at `create.roblox.com/dashboard/credentials` with `asset:read` (Assets API), universe read, and group read enabled.
- [ ] **Step 2 — Confirm GetAsset works for an asset you do NOT own.** `curl -H "x-api-key: $KEY" https://apis.roblox.com/assets/v1/assets/{someoneElsesAnimationId}`. Record: does it 200 with `creationContext.creator` + `assetType` + `moderationResult`, or 401/403? **If it only works for your own assets, the cross-creator verification premise fails — STOP and escalate (fall back to verifying only assets whose creator == the key owner, a much narrower feature).**
- [ ] **Step 3 — Confirm the animation `assetType` enum string.** Call GetAsset on a known KeyframeSequence/Animation asset ID; record the exact `assetType` value to match against.
- [ ] **Step 4 — Confirm moderated/deleted behavior.** Call GetAsset on a deleted ID (expect 404) and, if possible, a moderated one; record what comes back.
- [ ] **Step 5 — Confirm GetUniverse owner shape.** `curl -H "x-api-key: $KEY" https://apis.roblox.com/cloud/v2/universes/{universeId}`; record whether `user`/`group` is `"users/123"`/`"groups/123"` path strings or bare ids.
- [ ] **Step 6 — Confirm group membership + owner shapes.** `GET /cloud/v2/groups/{groupId}` (owner field name) and `GET /cloud/v2/groups/{groupId}/memberships?filter=user=='users/{userId}'` (+ `/roles`); record field names and the rank representation.
- [ ] **Step 7 — Write the confirmed contract.** A short note pinning the exact endpoints, auth header, response field paths, and enum strings the code will use. **This note is the spec Tasks 3–4 code against.** Update this plan's assumptions if the spike contradicts them.

**Completion test:** the note answers Steps 2–6 with real responses, and Step 2 is a clear yes (or the feature is re-scoped). Do not proceed otherwise.

---

## File Structure

New files (created across tasks):
- `desktop/src/main/java/creatorflow/service/opencloud/OpenCloudSettings.java` — key storage (mirror `RegistrySettings`).
- `desktop/src/main/java/creatorflow/service/opencloud/OpenCloudClient.java` — the HTTP client (mirror `HttpRegistryClient`); the only thing that talks to Roblox.
- `core/src/main/java/creatorflow/manifest/OwnershipEvidence.java` — the immutable ownership result value type (record; core, no I/O).
- `core/src/main/java/creatorflow/ownership/OwnershipOutcome.java` — the pure match evaluator (creator vs owner vs group membership → outcome).
- `desktop/src/main/java/creatorflow/service/opencloud/OwnershipVerifier.java` — orchestrates client calls + `OwnershipOutcome` into an `OwnershipEvidence` (desktop; calls the client).
- `desktop/src/main/resources/creatorflow/db/migrations/V010__ownership_verifications.sql` — insert-only ledger.
- `desktop/src/main/java/creatorflow/db/OwnershipVerificationRepository.java` — persistence (mirror `LocalProjectRepository`).
- `frontend/src/bridge/openCloud.ts` (or extend `localBridge.ts`) — client methods.

Modified files:
- `core/.../CreativeManifest.java` (AssetEntry gains optional `ownership`), `EvidenceBases.java` (ownership no longer constant), the 3 v0.2 schema copies + `manifest.ts`, `ReleaseGate.java`, `ReleaseExportService.java`, `SettingsPage.java` + `AppContext.java`, `LocalBridgeServer.java`, `frontend/src/bridge/evidenceBasis.ts` + evidence-view components.

---

## Task 1 — `OwnershipEvidence` value type + the pure outcome evaluator (core)

The heart of the feature is a **pure function**: given the facts, what's the outcome? Build and test it with zero I/O first.

**Files:** Create `core/.../manifest/OwnershipEvidence.java`, `core/.../ownership/OwnershipOutcome.java`; Test `core/src/test/java/creatorflow/ownership/OwnershipOutcomeTest.java`.

**Interfaces produced:**
```java
public enum OwnershipOutcome { MATCH, MISMATCH, UNVERIFIABLE }
// MATCH   = creator identity == experience owner identity, OR creator-user is a member of the owner-group
// MISMATCH= facts obtained, but creator is neither the owner nor a member of the owning group
// UNVERIFIABLE = a required fact could not be obtained (no id, private, API error) — ownership basis stays NOT_VERIFIED

public record OwnershipEvidence(
    Long robloxAssetId,          // the animation asset id checked (null → nothing was checked)
    String creatorType,          // "USER" | "GROUP" | null
    Long creatorId,              // null if unknown
    String assetType,            // raw Roblox assetType string
    String moderationState,      // "Approved" | "Rejected" | "Reviewing" | null
    String ownerType,            // experience owner "USER" | "GROUP" | null
    Long ownerId,
    Integer memberRank,          // creator-user's rank in the owner-group, if that path applied; else null
    OwnershipOutcome outcome,
    Instant checkedAt) {
  public static OwnershipEvidence unchecked() { /* all null, outcome UNVERIFIABLE, checkedAt null */ }
  public boolean verified() { return outcome == OwnershipOutcome.MATCH || outcome == OwnershipOutcome.MISMATCH; }
  // verified() == "we obtained authoritative facts" → drives the VERIFIED evidence basis (NOT "you have rights")
}
```
The evaluator is a static pure method: `OwnershipOutcome evaluate(creatorType, creatorId, ownerType, ownerId, Integer memberRankOrNull)`.

- [ ] **Step 1 — failing tests (truth table):** user-creator == user-owner → MATCH; group-creator == group-owner → MATCH; user-creator + group-owner with a non-null memberRank → MATCH; user-creator + group-owner with null memberRank → MISMATCH; user-creator != user-owner → MISMATCH; any null id on either side → UNVERIFIABLE. Assert `verified()` is true for MATCH/MISMATCH and false for UNVERIFIABLE.
- [ ] **Step 2 — implement** the record + evaluator (no I/O, no Roblox calls).
- [ ] **Step 3 — run tests green. Commit.**

---

## Task 2 — `OpenCloudSettings` + Settings card (desktop config)

Mirror the existing opt-in registry settings exactly.

**Files:** Create `desktop/.../service/opencloud/OpenCloudSettings.java`; Modify `SettingsPage.java` (add `openCloudCard()` next to `registryCard()`, ~73-141) and `AppContext.java` (an `openCloudSettings()` accessor next to `registrySettings()`). Test `desktop/src/test/java/creatorflow/service/opencloud/OpenCloudSettingsTest.java`.

**Interface:** `OpenCloudSettings` = same properties-file-in-dataDir shape as `RegistrySettings` (`opencloud.properties`), `load()` in ctor, `save(String apiKey)`, `String apiKey()`, `boolean isConfigured()` = key non-blank.

- [ ] **Step 1 — failing test:** save a key → reload a new instance → `apiKey()` round-trips and `isConfigured()` true; blank key → `isConfigured()` false.
- [ ] **Step 2 — implement** the settings class (mirror `RegistrySettings`).
- [ ] **Step 3 — add the Settings card** (API-key field — **mask it**, unlike the registry card's plain field; status label off `isConfigured()`; a Test-connection button wired in Task 3; Save). Skip any "create account" button — Open Cloud keys are provisioned in the dashboard.
- [ ] **Step 4 — tests green. Commit.**

> **Security note (carry into review):** the registry precedent stores the key in a plaintext properties file. Open Cloud keys are higher-privilege. For v1, keep the file pattern for parity but **mask the input field**; file an issue to move to the OS credential store as a follow-up. Do not silently inherit the plaintext-and-unmasked precedent.

---

## Task 3 — `OpenCloudClient` (the only thing that calls Roblox)

**Files:** Create `desktop/.../service/opencloud/OpenCloudClient.java`; Test `OpenCloudClientTest.java` (against a stubbed `HttpClient`/local test server — do NOT hit the live API in unit tests).

**Interface (methods pinned by the Task 0 note):**
```java
OpenCloudClient(OpenCloudSettings settings)
boolean isConfigured()
AssetInfo getAsset(long assetId)          // GET /assets/v1/assets/{id}; creator, assetType, moderationState
UniverseOwner getUniverse(long universeId)// GET /cloud/v2/universes/{id}; user|group owner
Optional<Integer> groupMemberRank(long groupId, long userId) // membership + role rank; empty = not a member
// throws OpenCloudException(status, message); a dedicated RateLimitedException for 429
```

- [ ] **Step 1 — failing tests** against a stub server: getAsset parses creator/type/moderation from a canned 200; getUniverse parses user vs group owner; groupMemberRank returns a rank on 200 and empty on the not-a-member response; a 429 throws `RateLimitedException`; a 401/403/404 throws `OpenCloudException` with the status; the `x-api-key` header is sent.
- [ ] **Step 2 — implement** mirroring `HttpRegistryClient` (HttpClient singleton, ~4s timeout, Jackson parse, `x-api-key` header, `>=400` → exception, 429 distinguished). Field names/paths from the Task 0 note.
- [ ] **Step 3 — tests green. Commit.**

---

## Task 4 — `OwnershipVerifier` (orchestrate calls → `OwnershipEvidence`)

**Files:** Create `desktop/.../service/opencloud/OwnershipVerifier.java`; Test `OwnershipVerifierTest.java` (inject a fake `OpenCloudClient`).

**Interface:** `OwnershipEvidence verify(long robloxAssetId, long universeId, Instant now)` — calls getAsset + getUniverse; if owner is a group and creator is a user, calls groupMemberRank; assembles the facts, calls `OwnershipOutcome.evaluate`, returns a fully-populated `OwnershipEvidence` with `checkedAt = now`. Any `OpenCloudException` → an `OwnershipEvidence` with the facts it *did* get and `outcome = UNVERIFIABLE` (never throws past here for expected API failures; `RateLimitedException` propagates so the caller can report it distinctly).

- [ ] **Step 1 — failing tests:** matching user creator/owner → evidence.outcome MATCH + verified(); group-owner + member → MATCH with memberRank; group-owner + non-member → MISMATCH; getAsset 404 → UNVERIFIABLE with nulls; `now` is stamped into `checkedAt`; a 429 propagates as `RateLimitedException`.
- [ ] **Step 2 — implement.**
- [ ] **Step 3 — tests green. Commit.**

---

## Task 5 — Persistence: V010 ledger + `OwnershipVerificationRepository`

**Files:** Create `desktop/.../db/migrations/V010__ownership_verifications.sql`, `desktop/.../db/OwnershipVerificationRepository.java`; register V010 in `SchemaMigrator`; Modify `WorkflowRepositoryTest` (migration count bump). Test `OwnershipVerificationRepositoryTest.java`.

**Migration (insert-only ledger, mirror V009):**
```sql
CREATE TABLE IF NOT EXISTS ownership_verifications (
  id                 TEXT PRIMARY KEY,
  scan_asset_id      INTEGER NOT NULL REFERENCES scan_assets(id) ON DELETE CASCADE,
  roblox_asset_id    INTEGER NOT NULL,
  universe_id        INTEGER NOT NULL,
  creator_type       TEXT, creator_id INTEGER,
  asset_type         TEXT, moderation_state TEXT,
  owner_type         TEXT, owner_id INTEGER,
  member_rank        INTEGER,
  outcome            TEXT NOT NULL,       -- MATCH | MISMATCH | UNVERIFIABLE
  raw_response_json  TEXT,
  checked_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ownership_verifications_asset ON ownership_verifications(scan_asset_id, checked_at DESC);
```
**Interface:** `insert(scanAssetId, OwnershipEvidence)`; `Optional<OwnershipVerificationRecord> latestForAsset(long scanAssetId)`; `Map<Long,OwnershipVerificationRecord> latestForRun(String scanRunId)` (batch, mirror `ScanRepository.latestEvidenceForRun`, `ROW_NUMBER() OVER (PARTITION BY scan_asset_id ORDER BY checked_at DESC, id DESC)` — note the id tiebreak, per the #28 fix precedent).

- [ ] **Step 1 — failing tests:** insert → latestForAsset round-trips all fields; two inserts → latest wins (tiebreak on id when timestamps tie); latestForRun returns one row per asset; migration count bumps + idempotent.
- [ ] **Step 2 — implement** (mirror `LocalProjectRepository`'s `synchronized(connection)` + hand-rolled SQL; nullable Longs via getLong+wasNull).
- [ ] **Step 3 — tests green. Commit.**

---

## Task 6 — Bridge route: the single live-call site

**Files:** Modify `LocalBridgeServer.java` (new `ASSET_VERIFY_OWNERSHIP` route ~571-585) + `AppContext.java` (wire `OwnershipVerifier` + repo + settings). Test `LocalBridgeServerTest.java`.

**Routes:**
- `POST /api/v1/assets/{assetId}/verify-ownership` — `requireMutation`; 409 if `openCloudSettings.isConfigured()` is false (mirror `HttpRegistryClient.isConfigured()` gating); reads the asset's Roblox animation id + the project's bound universeId (404 if either is missing — clear message: "needs an animation id and a bound experience"); calls `OwnershipVerifier.verify(...)`, persists via the repo, returns the new record; a `RateLimitedException` → a 429-class response with a retry hint.
- `GET /api/v1/assets/{assetId}/ownership-verifications` — session-authed history (never returns the API key; `raw_response_json` may be included or omitted — omit by default).

- [ ] **Step 1 — failing tests:** POST without a configured key → 409; POST with a fake verifier wired in → 200 + persisted record echoed; GET returns history; POST without CSRF → 403; a rate-limited verifier → 429. (Inject a fake `OwnershipVerifier` in the bridge test — no live API.)
- [ ] **Step 2 — implement** (mirror the `ASSET_EVIDENCE` GET/POST + `RELEASE_PUBLISHED_VERSION` patterns).
- [ ] **Step 3 — tests green. Commit.**

---

## Task 7 — Wire ownership into `AssetEntry`, the classifier, and the manifest

**Files:** Modify `CreativeManifest.java` (AssetEntry optional `OwnershipEvidence ownership` + `withOwnershipEvidence(...)`), `EvidenceBases.java` (ownership reads the field), the 3 v0.2 schema copies, `frontend/src/manifest/manifest.ts`, `frontend/src/bridge/evidenceBasis.ts`. Tests: `ManifestJsonTest`, `EvidenceBasesTest`, `manifest.test.ts`, `evidenceBasis.test.ts`.

**Key decisions:**
- `EvidenceBases.of(asset)` ownership: `asset.ownership() != null && asset.ownership().verified()` → `VERIFIED`, else `NOT_VERIFIED`. (VERIFIED = facts obtained, whether MATCH or MISMATCH.) Mirror the SAME rule in `evidenceBasis.ts` — the Java and TS classifiers must not diverge (existing load-bearing invariant).
- v0.2 schema: add an OPTIONAL `ownership` object to the AssetEntry (not in `required`); byte-identical across the 3 copies; `check-manifest-schema.mjs` stays green. A v0.2 manifest without `ownership` must still validate on both paths (backward-compat test).

- [ ] **Step 1 — failing tests:** an AssetEntry with a MATCH ownership → basis VERIFIED; with UNVERIFIABLE → NOT_VERIFIED; with none → NOT_VERIFIED; a manifest with ownership round-trips + validates (Java + AJV); a v0.2 manifest WITHOUT ownership still validates; Java and TS classifiers agree on the same inputs.
- [ ] **Step 2 — implement.**
- [ ] **Step 3 — tests green. Commit.**

---

## Task 8 — Stamp ownership into the manifest deterministically

**Files:** Modify `ReleaseExportService.java` (~79-109). Test `ReleaseExportServiceTest.java`.

- Build `Map<Long,OwnershipVerificationRecord> owners = ownershipVerifications.latestForRun(scanRunId)` once (alongside the existing evidence/decision maps); per asset, attach `entry.withOwnershipEvidence(toEvidence(owners.get(assetId)))` before `EvidenceBases.of(entry)`. **`ReleaseExportService` must not import `OpenCloudClient`/`OwnershipVerifier`** — repository read only.

- [ ] **Step 1 — failing tests:** verify an asset (persist a MATCH), create a release → the manifest carries the ownership evidence + ownership basis VERIFIED; recreate the release from the same scan → **byte-identical manifest** (determinism holds with ownership present); an unverified asset → no ownership key + ownership basis NOT_VERIFIED.
- [ ] **Step 2 — implement.**
- [ ] **Step 3 — tests green. Commit.**

---

## Task 9 — Gate: mismatch-without-decision as a review lead

**Files:** Modify `ReleaseGate.java` (28-73). Test `ReleaseGateTest.java`.

- Add `Code.OWNERSHIP_MISMATCH_WITHOUT_DECISION`. It fires only when `asset.ownership() != null && asset.ownership().outcome() == MISMATCH && asset.decision() == PENDING` (mirror `FLAGGED_WITHOUT_APPROVAL`: an `APPROVED`/`EXCLUDED` human decision clears it). A MATCH never blocks; an UNVERIFIABLE never blocks (absence of proof is not proof). The violation message names it a review lead: *"The animation's creator is not the owner of the target experience and no decision has been recorded — confirm the team has rights to ship it."*

- [ ] **Step 1 — failing tests:** MISMATCH + PENDING → BLOCKED with the new code; MISMATCH + APPROVED → not blocked by this rule; MATCH + PENDING → not blocked; UNVERIFIABLE + PENDING → not blocked; the message frames it as a lead, not a verdict.
- [ ] **Step 2 — implement.**
- [ ] **Step 3 — tests green. Commit.**

---

## Task 10 — Frontend: verify action + honest display

**Files:** Modify `frontend/src/bridge/localBridge.ts` (verifyOwnership POST + list GET, mirror recordPublishedVersion), the evidence view (`LocalProjectWorkspace.tsx` / evidence components). Tests: a pure-helper test + (if the graph allows) an RTL test like the Increment 6 decision-flow test.

- A "Verify ownership" button on an animation asset that has a Roblox id (disabled with a clear reason when no key is configured or no id/universe is bound). On success it shows: the `VERIFIED` badge, the verified facts (creator, experience owner, moderation), and, on a **mismatch**, a clearly-worded review lead prompting a human decision (reusing the required-reason decision flow) — never the words "infringement"/"stolen". Always show `checkedAt` ("verified 3 days ago") so staleness is visible.

- [ ] **Step 1 — failing test** for the pure display/basis helper (VERIFIED vs NOT_VERIFIED, mismatch → lead copy).
- [ ] **Step 2 — implement** the client methods + UI.
- [ ] **Step 3 — tests green + `npm test`/`typecheck`/`schema:check`. Commit.**

---

## Task 11 — Docs + staleness surfacing

**Files:** Modify `docs/FRIEND-TEST.md` (a new `[live-Studio + key]` section for ownership verification), `docs/HANDOFF.md` / `README` (ownership is now verified where possible), `docs/ROADMAP.md` (mark Phase A shipped).

- [ ] **Step 1 —** document the ownership-verification flow, the API-key setup, what's verified vs what stays NOT_VERIFIED (the honest ceiling), and the staleness caveat (a check is a point-in-time observation).
- [ ] **Step 2 — Commit.**

---

## Self-Review (run before executing)

- **Spec coverage:** every focused-milestone requirement about "owner/group/experience/permission evidence where genuinely verifiable" (redirect item 6) is addressed, and the parts that are NOT verifiable are explicitly kept NOT_VERIFIED.
- **Determinism:** the only live-call site is Task 6's bridge route; Tasks 8's export reads persisted rows; a byte-identical-recreate test is included.
- **Honesty:** VERIFIED ≠ "you have rights"; mismatch = lead, not verdict; no auto-block; the mismatch never uses accusatory language.
- **Classifier parity:** Java `EvidenceBases` and TS `evidenceBasis.ts` change in lockstep with a same-inputs agreement test.
- **Backward-compat:** ownership is an optional additive v0.2 field; a manifest without it still validates on both paths; no schema version bump.
- **Gating:** Task 0 is a hard gate — if GetAsset doesn't work cross-creator, the feature is re-scoped before any code.

## Open questions for the owner (decide before or during Task 0)

1. **Group-rank sufficiency policy.** Roblox has no "can publish" flag per role. Is *any* membership in the owning group enough for MATCH, or must the rank clear a threshold? (Recommendation: any membership → MATCH for v1, and store the rank so the policy can tighten later without re-verifying.)
2. **API key privilege / storage.** OK to store the key in a masked-but-plaintext properties file for v1 (parity with the existing registry key), with an OS-credential-store follow-up issue? (Recommendation: yes, with the issue filed.)
3. **Staleness policy.** Surface `checkedAt` only (v1), or also warn/require re-check after N days? (Recommendation: surface only for v1.)
