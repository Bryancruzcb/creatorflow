---
type: design-spec
project: CreatorFlow
phase: E
status: approved-in-chat
date: 2026-08-02
tags:
  - creatorflow
  - roblox
  - phase-e
  - team-provenance
---

# Phase E — Shared team provenance

**Goal:** let a small team answer one question about an incoming animation — *has anyone I work
with already recorded this exact curve fingerprint?* — without building anything that can answer
"did someone copy this". A member shares a local snapshot's fingerprint; other members look that
exact fingerprint up and see who on the team recorded it, when, and under what declared Roblox id,
source and license.

**Why this phase, why now:** `docs/ROADMAP.md` marks Phase E *(only if validated)* — "Build only
if the friend test proves real multi-user demand." **That friend test was cancelled permanently by
the project owner on 2026-07-30 and will not happen**, so no phase can satisfy the old validation
gate. Phase E proceeds by **explicit owner decision of 2026-08-02**, exactly the way Phase B (spec
of 2026-07-31) and Phase C (spec of 2026-08-01) recorded theirs.

Where that decision is written down, stated precisely so this sentence is true as shipped: **it is
not in `docs/ROADMAP.md` on this branch.** ROADMAP still carries the original *(only if validated)*
gate text, because rewriting it belongs to the open docs-honesty PR (#124), which records the
cancelled friend test along with the Phase D and Phase E approvals. This branch deliberately does
not touch ROADMAP — two PRs editing the same lines is a merge conflict for no gain — so until #124
lands, **this spec is the record**, and afterwards ROADMAP is. Anyone reading ROADMAP alone before
#124 merges will see a gate this phase did not satisfy; that is the expected state, not an
oversight.

That override has a cost, and this spec states it rather than burying it: **the demand risk the
gate existed to retire is still open.** A 2–5 person team may find explicit claim-recording too
much friction, and there is no validation channel left to test that before building. Phase E ships
as an owner-decision bet, not a validated need. It is deliberately small and structurally
constrained so that being wrong about demand costs a feature, not the product's honesty.

**Architecture:** the honest rebirth of the old cloud registry. Desktop app (authoritative, SQLite,
fully functional at zero network) → optional HTTP → one self-hosted CreatorFlow server on the
studio's LAN or a member's box (Spring Boot 4.1, H2 file DB). The React frontend keeps talking
*only* to `LocalBridgeServer` on 127.0.0.1 — no CORS anywhere — and **all outbound team calls
originate in the desktop JVM**, exactly as `OpenCloudClient` is the sole Roblox call site (the
Phase A precedent).

The server answers 64-hex fingerprint equality within one team and nothing else. It holds no
similarity code on the default path after PR-1, and its schema has no score, distance, ranking or
decision column, so it is *structurally* incapable of emitting a verdict rather than merely
configured not to. It is not a public "copied/not-copied" judge; that direction stays dead.

**Honesty wrinkle this phase introduces:** for the first time, CreatorFlow shows a person a record
*about someone else*. Everything before this was about their own machine. A wrong or stale shared
record read as an accusation is the defining hazard of the phase, and the defences for it are
structural rather than copy-deep — see Global constraints.

**Tech stack:** Java 21 (desktop bridge, team client), Spring Boot 4.1 + JPA/H2 (server), React 19
+ TypeScript (workspace UI), JavaFX (desktop Settings card).

## The gate override, and the four owner decisions

Each decision is recorded with the alternative it beat, so a later reader can tell a considered
trade from an accident.

1. **Live-only lookup — no local mirror.** Team lookups are never persisted to desktop SQLite;
   offline renders as *unknown*, never as "nobody else has this". No stale local copy of a
   teammate's claim can exist.
   *Alternative rejected:* a synced mirror with staleness stamps. It works in airplane mode, but a
   cached copy of someone else's claim is exactly the stale-record → false-accusation vector this
   phase must not create.
   *Consequence:* no desktop migration at all in this PR; the V014/V015 slots stay free for
   Phase C (#119).

2. **Observations only — no shared decision label.** A claim carries the fingerprint plus declared
   metadata (clip name, Roblox id, ownership context, source, license, note), never an
   APPROVED/BLOCKED enum. Nothing verdict-shaped is ever shared.
   *Alternative rejected for MVP:* "mira recorded this as Approved". Most day-1 value, and the
   closest thing to a verdict-shaped shared object — revisit only with its own copy discipline.

3. **Legacy registry routes: flag-gated, default off.** `POST /api/v1/verify`,
   `POST/GET /api/v1/assets*` and the mappings routes sit behind
   `creatorflow.legacy-registry.enabled=false` via `@ConditionalOnProperty` (house precedent:
   `DemoSeeder`). A fresh Phase E server serves no similarity judge; flipping the flag keeps the
   frozen Rojo plugin working.
   *Alternative rejected:* deleting the routes and letting the plugin 404. Nothing should silently
   break a frozen contract.

4. **Two PRs.** PR-1 (prep): retire the gallery half and demote the judge — deletion-dominated,
   reviewable as `-` lines. PR-2 (this one): teams + claims + desktop client + UI, carrying this
   spec.
   *Alternative rejected:* one ~40-file PR.

## Global constraints

- **An unreachable store must NEVER render as "no one else has this."** This is the single most
  important rule in the phase and it has a dedicated test file
  (`TeamProvenancePanel.unreachable.test.tsx`). It is defended structurally, not by careful
  wording: every lookup response carries a `status`, the bridge answers **200 even for a failed
  lookup** so no `catch` branch can render an empty list, and there is no local cache to silently
  fall back on. `claims: []` is readable only when `status === 'OK'`.

- **A late answer is not an answer.** The rule above is reachable without anyone writing the
  sentence in the wrong branch, because the panel's `fingerprint` prop changes **in place**: the
  motion lab polls the Studio inbox every 3 s and there is no `key` forcing a remount, while a
  lookup's 4 s connect / 6 s read budget routinely outlives two poll cycles. A slow empty answer
  for fingerprint A landing after the panel moved to B renders the banned sentence for a
  fingerprint nobody looked up; the mirror case paints A's claims under B's heading, which is the
  false-attribution direction. Guarded twice — a monotonic request id that gates both `.then` and
  `.catch` (a ref, not an effect-cleanup flag, because "Try again" calls `lookup()` outside the
  effect), and a check that the response's echoed `fingerprint` is the one that was asked for.
  Three tests cover it, and all three fail if either guard is removed.

- **A judgement must stay underivable from the data.** No score, distance, verdict, decision enum,
  perceptual hash or file bytes exists in `provenance_claims`, in the API response, or in the
  bridge view. Three separate tests assert the absence by name
  (`ProvenanceClaimApiTest`, `LocalBridgeServerTeamRoutesTest`, `contract.test.ts`) rather than
  trusting review to notice a field being added.

- **Tripwire, recorded:** if a future phase adds a "first" or "original" badge derived from
  `recorded_at`, this property breaks and the honesty ceiling is gone. The server clock exists so
  the log has a clock it can trust, not so anyone can win a race.

- **Priority is visible but uncredited — and that is the honest claim, not "priority does not
  leak".** Both `recordedAt` and the monotonic claim `id` are on the wire and on screen, so any
  client, or any person reading two rows, can work out who recorded first. Sorting by username
  buys exactly one thing: the product never *presents* an order as a ranking, and no CreatorFlow
  surface draws a conclusion from it. It does not and cannot make the information unavailable —
  `recordedAt` is load-bearing for "when was this observed" and removing it would cost more honesty
  than it bought. State the guarantee at its real strength: **the ordering is uncredited, not
  concealed.** The tripwire above is the thing that actually holds the line, because the failure
  mode is a product surface asserting priority, not a user inferring it.

- **Retract is the kill switch and is not cuttable — and it must be *reachable*, not merely
  implemented.** Author or team `OWNER`, reason required. Copy says "removes it from future
  lookups" — **never "unshares"**, because no server can retrieve a copy a teammate already read.
  The lookup response therefore carries `canRetract`, the server's own author-or-OWNER answer, and
  the UI gates the button on that rather than on `isYours`: gating on `isYours` alone would leave
  an owner unable to pull the switch on a wrong record about a person, which would hollow out the
  last-owner-409 rule whose entire justification is that such a person always exists.

- **Ordering must not imply priority.** Rows sort by `username`, which is unique (so the order is
  stable) and carries no seniority. `displayName` has had no writer since PR-1 deleted the web
  signup flow, so the API shape carries `memberUsername` only. Wherever a time is visible, this
  line is pinned: *"A record of who ran CreatorFlow first — not a record of who authored the
  work."*

- **The frontend cannot publish a fingerprint the desktop did not compute.** The bridge share
  route reads `fingerprint`, `algorithmVersion`, clip name and duration from the local
  `motion_snapshots` row and ignores whatever the request said. The wire field set is asserted
  field-by-field — the confirmation dialog's text is not the contract, the wire is.

- **Version classification is the client's job, always.** The lookup is by fingerprint only; the
  server never filters by `algorithmVersion`. Filtering there would silently drop the rows a
  person most needs to be told about.

- **Copy says *curve fingerprint* / *curve data*, never *animation*.**
  `MotionComparisonEngine.fingerprint` excludes `Looped`/`priority` by documented design, so an
  exact match means identical curve data, not an identical clip.

- **Any state where the sample registry card still renders says "illustrative records, not your
  team store".** A real provenance surface and a fixture must never be mistakable for each other,
  and the live GitHub Pages demo has no desktop behind it, so that state is permanent.

- **Nothing is ever uploaded automatically.** Sharing is a per-snapshot button behind a
  confirmation dialog that enumerates exactly what leaves the machine — and what does not.

## Data model (server, JPA on H2)

**teams** — id PK; name (≤80); `created_by_account_id` → accounts; created_at.

**team_memberships** — id PK; team_id; account_id; role `OWNER | MEMBER`; joined_at;
`UNIQUE(team_id, account_id)`. A real UNIQUE here, unlike on claims: a membership is current state,
not a historical observation, so there is no append-only log for a constraint to damage.

**team_join_codes** — id PK; team_id; `code_hash` CHAR(64) (SHA-256; **hash-at-rest, raw code
returned exactly once at issuance**, modeled on the proven `PluginPairingService` token pattern and,
like it, **128-bit random, base64url**); created_by; created_at; expires_at (**24 h TTL**);
used_by_account_id NULL; used_at NULL; **`@Version`**. Redeem attempts ride the kept
`RateLimitFilter` on `/api/**`, which throttles online brute force.

The version column is what makes "single-use" a fact rather than an intention. Redemption is
read → check → write, which is not atomic under H2's READ_COMMITTED: two *different* accounts
presenting the same code at the same instant would both see it unspent and both join, and
`UNIQUE(team_id, account_id)` does not catch that because it only stops the same account twice.
The loser's flush fails and is translated into the same flat 404 an already-used code gets, so
losing by a millisecond is indistinguishable from losing by a day. Note the deliberate asymmetry
with claims: a concurrent double-**share** is accepted on the record, because a duplicate
observation is harmless; an invitation that admits two people is not.

One honest asymmetry, recorded: `UserAccount.apiKey` sits in plaintext in the same H2 file, so
hash-at-rest protects codes against a DB dump more than the keys beside them — inherited from the
account model, not worsened here.

**provenance_claims** — id PK; team_id; account_id; `fingerprint` CHAR(64), lowercased then
validated `[0-9a-f]{64}` (the same normalize-then-validate shape as
`RegistryController.requireSha`); `algorithm_version` (**load-bearing: the client classifies every
row by it, so a v2 row never silently renders as a v1 match**); `clip_name`; `duration_seconds`;
`roblox_asset_id` NULL; `ownership_context` normalized like `MappingController.normalizeContext`
and stored as `''` when absent so the duplicate probe can use plain equality; `declared_source`,
`declared_license`, `declared_note`; `observed_at` (client clock, DECLARED, display-only);
`recorded_at` (server clock, VERIFIED, the ordering key); `retracted_at`, `retracted_reason`;
`INDEX (team_id, fingerprint)`.

**No `UNIQUE` constraint, deliberately.** H2 has no partial unique indexes, so
`UNIQUE(team, account, fingerprint, context)` would let a retracted tombstone occupy the key
forever — making retract-then-reshare, the only append-only-consistent correction, impossible.
Uniqueness is application-level and scoped to non-retracted rows. Rare duplicate rows from a
concurrent double-submit are accepted: they are harmless independent observations that render
twice, not corruption.

**No desktop SQLite change.** No V014/V015 — decision 1's consequence.

## Components

**Server (`server/…`):**
- `Team`, `TeamMembership`, `TeamRole`, `TeamJoinCode`, `ProvenanceClaim` + their repositories.
  `ProvenanceClaimRepository` is the entire read surface: indexed equality inside one team, with
  every query excluding retracted rows.
- `JoinCodes` — 128-bit base64url mint + SHA-256 hash, 24 h TTL.
- `TeamService` — all transactional logic, returning fully-materialized view records so no lazy
  association escapes (`spring.jpa.open-in-view=false`). Two policies live here and nowhere else so
  no route can forget them: **non-membership answers 404, never 403** (a 403 would confirm a team
  id exists), and **the last `OWNER` cannot leave (409)** so OWNER-retract always has an operator.
- `TeamController`, `ProvenanceClaimController`.
- `AccountController` gains an optional `X-Signup-Token` gate from `creatorflow.signup.token`,
  compared in constant time, blank by default. Open registration on a LAN box is a real hole.

**Desktop (`desktop/…/service/team/`)** — a new sibling package, the
`OpenCloudSettings`-beside-`RegistrySettings` house pattern; `service/registry/` is untouched:
- `TeamSettings` — `team.properties` in the data dir, API key protected at rest by **reusing Phase
  A's `ApiKeyProtector.forCurrentOs()`** (DPAPI on Windows, honestly-labelled plaintext elsewhere).
  An unlabelled or unrecognized storage mode means the value is *undecodable*, so the store reports
  itself not configured rather than handing ciphertext out as a key.
- `TeamStatus` — `NOT_CONFIGURED | UNREACHABLE | UNAUTHORIZED | REJECTED | OK`.
- `TeamClient` (+ `disabled()` no-op, which answers `NOT_CONFIGURED` rather than an empty success)
  and `HttpTeamClient` — plumbing lifted from `HttpRegistryClient` (4 s connect / 6 s read,
  `X-Api-Key`, error unwrapping).

**Desktop bridge (`LocalBridgeServer`)** — four session+CSRF-guarded routes:
- `GET /api/v1/team` → `{configured, baseUrl, teamId, teamName, memberCount, keyStorageMode,
  status, message}`; never the key (the `openCloudKeyConfigured` precedent). `memberCount` is live
  and null whenever `status` is not `OK` — nothing about a team is cached.
- `POST /api/v1/team/provenance-lookup` `{fingerprint, algorithmVersion}` →
  `{status, fingerprint, algorithmVersion, claims[], message}`, **always 200**.
- `POST /api/v1/team/provenance-claims` `{snapshotId, robloxAssetId?, ownershipContext?,
  declaredSource?, declaredLicense?, declaredNote?}`.
- `POST /api/v1/team/provenance-claims/{claimId}/retract` `{reason}`.

**Desktop Settings** — the "Community registry" card is replaced by a **Team provenance store**
card carrying the whole member-#2 story end to end: base URL → Create account (username, optional
signup token) → Test connection → Join team (paste code) or Create team → live member list, plus
Mint join code for owners. Copy lives in `TeamCardText` so it is testable without a JavaFX harness
(the `OpenCloudCardText` precedent).

**Frontend:**
- `fingerprintVersions.ts` — pure classification (`MATCH` / `DIFFERENT_VERSION` /
  `UNKNOWN_VERSION`), its caveat sentences, and `sortClaimsForDisplay` (by username).
- `TeamProvenancePanel.tsx` — the lookup, in the existing `RegistryMatchCard` slot on the
  motion-comparison detail. That is where an incoming clip is actually checked against the team.
- `AnimationSnapshotsPanel.tsx` — a per-snapshot "Share to team" button behind a confirmation
  dialog, disabled with an honest reason when the store is unavailable.

## Data flow

1. The Studio plugin submits a comparison; the desktop scores it and stores an
   `animation_comparisons` row; a person pins one side as a `motion_snapshots` row.
2. **Lookup:** the workspace posts `{fingerprint, algorithmVersion}` from the latest comparison's
   candidate side → bridge normalizes to lowercase 64-hex → `HttpTeamClient` GETs
   `/teams/{id}/provenance-claims?fingerprint=…` → rows come back → the bridge maps them to a view
   with no verdict field → the panel classifies each row's `algorithmVersion` against the lookup's
   and renders states 1–5.
3. **Share:** the workspace posts `{snapshotId, …declared}` → the bridge loads the local snapshot
   and builds the wire body from *it* → `HttpTeamClient` POSTs → 201 new, or 200 with
   `alreadyShared` / `declarationsDiffer`.
4. **Retract:** `{reason}` → the row is tombstoned → it leaves every future lookup.

Nothing in this flow writes to desktop SQLite, and nothing in the preflight or release path awaits
any of it.

## Error handling

Every desktop→server failure maps to a `TeamStatus`, and the read and write paths differ on
purpose:

- **Read path (lookup):** `401`/`403`/`404` → `UNAUTHORIZED`; everything else, including an
  unexpected 4xx → `UNREACHABLE`. Both render as *unknown*. The read path never returns `REJECTED`
  — on a read, degrading toward "we do not know" is the only direction that cannot mislead. 404 is
  folded into `UNAUTHORIZED` because the server answers 404 for non-membership by design, so it
  means "this credential no longer resolves to that team", not "that fingerprint is absent".
- **Write path (share, retract):** additionally maps a `4xx` to `REJECTED` with the server's
  message, because a person just pressed a button and needs a real answer. The bridge surfaces
  these as `409` (not configured), `502` (unauthorized), `400` (rejected), `503` (unreachable).
- **One read-path exception, deliberate:** a fingerprint that is not 64-hex is refused by the
  client *before any socket is opened*, and that is `REJECTED` too. Calling it `UNREACHABLE` would
  be a false statement about a store that is fine and was never contacted, so the panel gives it
  its own sentence — "Team provenance unknown — this build could not ask… no lookup was sent" —
  which is still an *unknown*, still carries no absence claim, and is pinned by its own test. An
  unexpected refusal **from the store** on a read still degrades to `UNREACHABLE`.

`REJECTED` is an addition to the four states the design brief named. It exists so that a refusal
nobody can act on is not disguised as an outage, and so that the one locally-refusable read case
does not have to lie about the server. Everything it covers still renders as unknown; the
guarantee that matters — an empty claim list is readable only under `OK` — is unaffected.

## Testing

- **Server:** `TeamApiTest` (join codes single-use and distinct, 404-not-403, last owner cannot
  leave, members ordered by username), `ProvenanceClaimApiTest` (no verdict/score/rank field is
  emitted; idempotent re-share returns the stored claim and flags changed declarations; retract
  removes from lookups and re-share afterwards creates a new row; the lookup does not filter by
  version; a departed member's claims remain), `SignupTokenTest`.
- **Desktop:** `LocalBridgeServerTeamRoutesTest` — the share route ignores a request-supplied
  fingerprint entirely; the `ShareRequest` and `ClaimRecord` field sets are pinned by reflection; an
  unreachable store still answers 200 with its status; `/api/v1/team` never carries the key.
  `TeamSettingsTest` — no plaintext key at rest, reload survives, an unlabelled value is
  undecodable rather than assumed plaintext.
- **Contract fixtures:** `team-status.json` and `team-provenance.json`, recorded by
  `LocalBridgeServerTest#writesContractFixturesForTheTypeScriptClient` and asserted in
  `contract.test.ts` — including that the `status` key survives and that no claim gains a verdict
  field. `keyStorageMode` is stabilised in the recorder because it is OS-dependent by design and
  would otherwise churn between a Windows dev box and Linux CI.
- **Frontend:** `TeamProvenancePanel.unreachable.test.tsx` (the dedicated rule, asserted as a
  negative sweep over the whole rendered subtree so an unrelated future line cannot slip past),
  `TeamProvenancePanel.test.tsx` (ordering, version states 4b/5, VERIFIED vs DECLARED separation,
  retract only on your own rows), `fingerprintVersions.test.ts`,
  `AnimationSnapshotsPanel.share.test.tsx` (the dialog enumerates what leaves, consent is the
  confirm button not the open, the request carries a snapshot id and no fingerprint).
- **`HttpTeamClientTest`** — the client against a real `HttpServer` stub on loopback, the shape
  `OpenCloudClientTest` already uses. This exists because every bridge test substitutes a fake
  `TeamClient`, which left the status mapping, URL construction, `X-Api-Key` header, error
  unwrapping and JSON parsing — the whole read path's actual behaviour — unverified. It pins that a
  500, an unexpected 4xx and a non-JSON body all degrade to *unknown* rather than to an empty
  success, that a malformed fingerprint never reaches the network, and that a connect failure's
  message does not leak the host and port it was shown.

### Manual: the two-data-dir loopback run

Run against the built jar on port 8099 with two independent desktop data dirs, each with its own
`team.properties` and its own `LocalBridgeServer`. Observed, 2026-08-03:

1. Two accounts created; machine A created the team as `OWNER` and minted a 22-character
   base64url code (= 128 bits); machine B redeemed it as `MEMBER`; **re-redeeming the same code was
   refused** with the flat "not valid" message.
2. `GET /teams/{id}/members` listed `amir` before `mira` although mira joined first — username
   order, not join order.
3. Machine A shared one snapshot with a **deliberately falsified `fingerprint` in the request
   body**; the recorded claim carried the snapshot's real one. The guard holds against a live
   server, not only against a fake client. An immediate retry returned `200`,
   `alreadyShared: true`, same claim id.
4. Machine B looked the fingerprint up and saw A's claim with `isYours: false`. `GET /api/v1/team`
   reported `keyStorageMode: DPAPI_WINDOWS` and no key anywhere in the payload.
5. **The server was then killed.** `GET /api/v1/team` returned `status: UNREACHABLE` with
   `memberCount: null` — no stale count. The lookup returned **HTTP 200** with
   `status: UNREACHABLE` and an empty `claims` array, which the panel renders as *unknown*. Machine
   B had read A's claim a minute earlier and retained no copy of it, which is owner decision 1
   working as intended.

Re-run after any change to the panel's request handling: the polling inbox that drives
`fingerprint` prop changes is exactly the condition a stale-response bug lives in, and it is not
reproducible from a single mounted render.

### Known gaps, recorded rather than implied away

- The concurrent-redemption test asserts the **invariant** (exactly one membership), not that the
  race window was hit on any given run. If the database serializes the two attempts naturally the
  test still passes, so it guards the outcome rather than proving the timing.
- Nothing exercises the JavaFX Settings card itself; its copy is tested through `TeamCardText`, the
  wiring is not.

## Out of scope for v1

1. **Phase A ownership facts inside shared claims.** Someone else's point-in-time Open Cloud
   observation replayed later is the stale-record hazard; it needs its own staleness design.
2. **Any server-side similarity or perceptual matching — permanently out.** The default-path server
   contains no similarity code at all after PR-1.
3. **Team data in the release manifest or the release gate — permanent.** A mutable remote record
   cannot live inside a byte-deterministic, network-free export. `ReleaseGate`, `CreativeManifest`,
   `ManifestJson` and `evidenceBases` are untouched by construction.
4. **Local caching of team results** (owner decision 1).
5. **Background sync, polling, push, or a shared inbox.** Every lookup is explicit and live.
6. **Federation, hosting, multi-tenancy, internet-facing deployment, TLS/proxy config, LAN
   discovery.** The README says plainly: do not expose the server to the internet.
7. **Migrating `roblox-plugin/src/` onto the team API.** Frozen contract; the legacy routes stay
   flag-reachable.
8. **Multi-team membership in the desktop UI.** One selected team.
9. **A shared decision label** (owner decision 2).
10. **Full removal of the desktop's legacy `service/registry` client.** Its disposition, stated:
    with the Settings card gone it can no longer be configured from the UI, and a machine with an
    old `registry.properties` pointing at a flag-off server would have seen "unreachable" on every
    import. So PR-2 **unwires it from the importer** — the client code stays, dormant and still
    exercised by `RegistryEscalationTest` through its own injected clients, but its status noise is
    gone.
