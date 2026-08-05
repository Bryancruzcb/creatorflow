# CreatorFlow handoff — Roblox direction

> **Superseded in part by the 2026-07-17 strategic redirect.** The current product definition and
> the authoritative work plan now live in [`STRATEGIC-REDIRECT.md`](STRATEGIC-REDIRECT.md) and
> [`CONSOLIDATION-REPORT.md`](CONSOLIDATION-REPORT.md) (mapped against the code, with a milestone
> tracker in the issues). This handoff remains accurate as build/verify reference and repository
> map; where it describes future product scope, defer to the redirect. The redirect confirms this
> file's Roblox direction and narrows it to local-first release preflight for small teams.

Consolidated July 13, 2026 from the former `FABLE_HANDOFF.md` (GPT's preflight handoff) and
`CLAUDE_HANDOFF.md` (end of the July 13 session). Where the two disagreed, the newer session's
facts win. Read `ROBLOX_WORKFLOW_RESEARCH.md` for the landscape research behind the direction.

## Where things stand

**As of 2026-08-02:** `main` is green on all **three** CI jobs (`build`,
`desktop-windows`, `frontend`). Shipped since the July-13 snapshot below:
ownership verification Phase A (#33/#38, merged 2026-07-26), the stylesheet split
(#67), JavaFX 26 (#92, desktop launch verified 2026-08-02), Spring Boot 4
(#107), the runtime playability probe Phase B (#118), and Phase C
(CurveAnimation) is in review as PR #119. The friend test was **cancelled
permanently by the project owner on 2026-07-30** — see `ROADMAP.md` for the
gate-closure record; phases proceed by per-phase owner decision.

The July-13 snapshot (still accurate as history), newest first:

- Frontend CI job + friend-test runbook (`docs/FRIEND-TEST.md`) + session handoff.
- **Three review fixes** (`1f138d1`, `8339462`, `00cfd40`): bridge accepts `localhost` Host;
  desktop-bridge plugin sends `Pose.Weight` not deprecated `MaskWeight`; `ManifestCli` gained
  repeatable `--exclude` (this repo's dogfood scan needs `--exclude stress-fixtures`).
- **GPT's preflight commit** (`cd4ff3a`): `creatorflow.motion` Java engine, bridge pairing
  tokens, SQLite V005 evidence store, the `frontend/` React workspace (Motion/Stress/Release
  labs), and a second Studio plugin `roblox-plugin/desktop-bridge/` (single Lua file, loopback
  pairing).
- **Claude's registry work** (`81cc724`, `4dad46e`): per-context Roblox asset-id mappings
  (`POST/GET /api/v1/assets/{id}/mappings`, context = `group:12345` / `user:98765`, upsert per
  context) and the Rojo-based registry plugin `roblox-plugin/src/` (canonical KeyframeSequence
  serialization → pure-Luau SHA-256 → `/api/v1/verify` with `X-Api-Key`).

## Repository map

- React/Vite product UI: `frontend/` (mirrored into git from the old non-git output dir —
  do all future UI work here)
- Java motion engine: `core/src/main/java/creatorflow/motion/`
- Desktop loopback bridge: `desktop/src/main/java/creatorflow/bridge/`
- Desktop animation evidence persistence: `desktop/src/main/java/creatorflow/db/AnimationComparisonRepository.java`
- Registry Studio plugin (Rojo): `roblox-plugin/src/`
- Desktop-pairing Studio plugin (friend test): `roblox-plugin/desktop-bridge/`
- Roblox workflow research: `docs/ROBLOX_WORKFLOW_RESEARCH.md`

## Build, test, verify (Windows quirks included)

```bash
npm --prefix frontend ci
npm --prefix frontend run dev        # http://127.0.0.1:5173
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

- **JDK 24 or newer is required, and `JAVA_HOME` is what decides it — not `java` on PATH.**
  PR #92 raised `maven.compiler.release` to 24 for JavaFX 26. Maven compiles with the JDK that
  `JAVA_HOME` points at, so a machine with JDK 26 on PATH but `JAVA_HOME` still aimed at a 21
  install fails at compile with:

  ```
  [ERROR] Fatal error compiling: error: release version 24 not supported
  ```

  Check with `mvn -version` (it prints the JDK it will use), not `java -version`. CI pins
  `java-version: '24'` in `ci.yml`, so this only ever bites locally — which is exactly why it
  went unnoticed until it blocked `mvn -pl desktop javafx:run`, the first step of the friend
  test.

- Full Java suite: `mvn -B verify` — passes in CI, and passes locally once the JDK above is
  right. Frontend suite, typecheck, and build are enforced by the `frontend` CI job.
- Desktop shell against the built frontend:

  ```bash
  npm --prefix frontend run build
  mvn -pl desktop javafx:run \
    -Dcreatorflow.web.root=$(pwd)/frontend/dist -Dcreatorflow.web.open=true
  ```

  The workspace URL is printed to the console at startup. (The old
  `-Djavafx.options="..."` form silently failed to forward these properties —
  verified 2026-07-20; the desktop pom now forwards them itself.)

  **Desktop launch on JavaFX 26.0.2 verified 2026-08-02** (the validation issue #11's close
  comment asked for): window renders, dashboard populates with demo data
  (`-Dcreatorflow.demo=true`), SQLite writes land in the configured
  `-Dcreatorflow.data.dir`. Startup logs two JDK restricted-method warnings
  (`javafx.graphics` and sqlite-jdbc native loads); when a future JDK enforces them, add
  `--enable-native-access=javafx.graphics,ALL-UNNAMED` to the javafx-maven-plugin options.

- Luau/Rojo aren't installed globally; grab `luau-compile` and `rojo` from their GitHub
  releases to syntax-check plugins / build the registry plugin
  (`rojo build roblox-plugin --plugin CreatorFlow.rbxm`).
- Commits must use `209073313+Bryancruzcb@users.noreply.github.com` (GH007 push protection).
  Repo-local git config already set.

## What the product does today

- The Motion Lab compares motion shape, authored timing, loop seams, and root translation
  across fourteen licensed fixture clips.
- Full/Upper/Lower/Root changes both the analytical scope and a visible skeleton focus. In
  Root Path, the score remains correctly locked to root translation while all four buttons
  remain available as preview focus.
- Pose comparison is a bright, depth-visible wireframe. A one-shot previous pose clamps at the
  clip start instead of wrapping to the clip end. Loop mode explicitly labels solid as
  end/current and wireframe as start.
- The Java core recanonicalizes bounded normalized animation input and computes exact curve
  fingerprints plus pose/timing/coverage evidence.
- The desktop bridge creates short-lived project-scoped pairings and persists comparison
  records without retaining raw joint curves.
- The source-first Studio desktop bridge reads two permitted Animation IDs and rejects
  non-loopback endpoints.
- With an optional Roblox Open Cloud API key, an explicit action verifies an animation's creator
  and the target experience's owner through Roblox's own API, records the facts point-in-time,
  and surfaces a match as positive evidence or a mismatch as a non-accusatory review lead (see
  *Ownership verification* below).

## Important product semantics

- **Pair side / Pair overlay** means reference clip versus candidate clip. It does not mean
  start pose versus end pose.
- **Previous-pose outline** shows the earlier pose for ordinary comparison modes.
- **Start-pose outline** pins the wireframe to time zero in Loop Seam while the solid rig is
  inspected at the end.
- **Root Path** measures only a root/body translation channel. Upper-body or lower-body
  root-path scores are not meaningful, so those buttons are visual focus only in this mode.
- Similarity is a review lead, never an authorship, copying, or copyright verdict — this
  honesty won the SJ Hacks judge question and it's all over the docs; keep it.
- Ownership `VERIFIED` means CreatorFlow obtained the creator/owner facts from Roblox, **not**
  that the team has the right to use the asset; a mismatch is a review lead, never an accusation.
  Those facts are about an **animation id a person typed in** — the link between the scanned file
  and that id is `DECLARED`, never verified. See *Ownership verification* below.
- "Publish" in CreatorFlow currently means prepare and record a Roblox Studio handoff. It is
  not a direct Roblox upload.

## Ownership verification (Phase A — shipped 2026-07-24)

The always-`NOT_VERIFIED` ownership row is now *verified where Roblox's Open Cloud API allows
it*. In a project with a bound experience, a person enters a Roblox animation id for the file
they are looking at and an explicit **Verify ownership** action calls Open Cloud once
(desktop-side — the only live-call site), confirms who created *that animation* and who owns the
target experience, and persists the raw facts to an insert-only ledger (`V010`). Downstream reads
persisted rows only — export never touches the network, so manifests stay byte-deterministic.

- **Key setup.** Add a user-scoped Open Cloud API key (asset + universe + group read) under
  **Settings → Roblox Open Cloud**. The key stays on the machine — never in the manifest,
  frontend, logs, or VCS. It is protected at rest: **DPAPI-encrypted on Windows**
  (`Crypt32Util.protectData`, base64 ciphertext bound to the Windows user, via JNA); on other
  OSes it falls back to plaintext and the Settings card says so plainly (*encrypted (Windows
  DPAPI)* vs *not encrypted on this OS*) — it never claims protection the platform can't back.
- **The honesty ceiling.** `VERIFIED` means *facts were obtained* — a MATCH (creator == owner,
  or the creator-user is a member of the owning group) and a MISMATCH both qualify. It never
  means "you have the right to use this asset". A MISMATCH is a **review lead** for a human,
  never an accusation or an auto-block; only a mismatch with no recorded decision blocks the
  gate, and a human APPROVED/EXCLUDED decision clears it. Group policy: *any* membership in the
  owning group is a MATCH, and the member's rank is persisted so the policy can tighten later
  without re-verifying. Membership is a **tri-state** fact and only the memberships listing
  decides it: a member whose *rank* could not be resolved (unexpected entry shape, a role deleted
  mid-check, the role-paging cap) is still a MATCH, recorded with no rank. Only an **observed**
  absence — a 200 with an empty memberships list — can produce a MISMATCH, so a shape divergence
  can never turn a real group member into a published accusation of non-membership.
- **The linkage is DECLARED, the facts are VERIFIED.** Nothing in a scanned file identifies a
  Roblox asset — CreatorFlow cannot derive an animation id from a `sha256`/path, so the id always
  comes from a person typing it into the ownership panel. The two claims are therefore kept
  apart everywhere: the manifest's `ownership` block records the id that was actually checked
  plus `assetIdSource: "DECLARED_BY_USER"`; `EvidenceBases.ownershipLinkBasis` /
  `evidenceBasis.ts`'s `ownershipLinkBasis` classify that linkage as `DECLARED` (never
  `VERIFIED`, for any input); and the panel says in words that you entered the id and that only
  that id's ownership was checked. `evidenceBases.ownership = VERIFIED` is a statement about the
  animation id, never about the file.
- **What stays NOT_VERIFIED.** A lookup that *ran* but could not obtain the facts — a 4xx/5xx, a
  network error, an unreadable/deleted id, an id that is not an `Animation` — is `UNVERIFIABLE`,
  never a false `VERIFIED`. Two paths persist **nothing at all** rather than an `UNVERIFIABLE`
  row: **no key** (the bridge route rejects with 409 before any call, and the panel disables the
  Verify button up front so the click never happens) and a **429 rate-limit** (surfaced distinctly
  as "rate-limited, try again"; a transient throttle is not an observation about ownership). In
  both, the asset keeps whatever ownership state it already had. A file nobody has entered an id
  for has no ownership block at all and stays `NOT_VERIFIED`. A verification is a **point-in-time
  observation**: CreatorFlow surfaces `checkedAt` ("checked N days ago") and does not expire or
  auto-re-check.

## Two Studio-plugin paths (hard rule)

1. `roblox-plugin/src/` is the Rojo-based registry plugin. It fingerprints a selected
   `KeyframeSequence`, talks to the CreatorFlow registry, and manages ownership-context
   Animation IDs.
2. `roblox-plugin/desktop-bridge/` is the source-first friend-test plugin for the local
   desktop evidence workflow. It reads two Animation IDs and posts normalized data to a
   short-lived `127.0.0.1` pairing.

The two are deliberately contract-separate (different auth, settings keys, endpoints). Do not
merge their network/auth contracts silently. A later unified plugin should present "Local
preflight" and "Team registry" as explicit destinations with separate capability receipts.

## Open findings from the 24-agent review (all adversarially verified)

Confirmed-major, still open:

1. **Dual scoring algorithms** — *resolved 2026-07-17 (PRs #12/#19, loop/root follow-up).* The
   `shape` and `timing` modes route through the parity-proven v2 engine
   (`frontend/src/motion/motionEngine.ts`, golden-locked against the Java
   `MotionComparisonEngine` via `motionEngineGolden.test.ts`). `loop` and `root` stay
   deliberately distinct metrics (loop = intra-clip seam continuity, root = channel-restricted
   inter-clip translation match) and are never presented as the same pose-relationship score
   as `shape`/`timing` — but their pose-distance math is no longer an independent curve: both
   `loopContinuity`'s pose-closure term and `rootComparison`'s per-point score in
   `motionAnalysis.ts` now call `motionEngineCore.poseDelta` directly (same
   `POSITION_DECAY`=2.25 / `ROTATION_DECAY`=1.8 fixed-decay kernel as v2), replacing the old
   linear-quaternion (`1 - angle/π`) and self-normalized-by-the-pair's-own-path-size
   `Math.exp` math. `rootPath`'s point sampling (feeds `RootPathPlot`) is unchanged — only the
   comparison step's math changed. `loop`'s velocity-continuity term stays bespoke by
   necessity: v2 has no velocity concept and there is no second clip to compare against
   (loop is intra-clip), so there is nothing to port it to; it is now covered by tests
   instead of left untested. UI labels were already differentiated in the 2026-07-17 PRs
   #12/#19 pass; this follow-up additionally fixed the loop/root indicator bars that were
   coloring from unrelated v2 fields (`result.coverage`, `root.similarity`) instead of the
   value printed next to them (`MotionComparisonLab.tsx`'s "Scoped joints"/"Candidate travel"
   rows now carry no fabricated quality bar, since a joint count and a raw travel distance
   have no percentage to show), and labeled `RegistryMatchCard`'s pose figure as an
   independent v2 comparison when viewed under `loop`/`root` modes. `loop`/`root` previously
   had zero test coverage; `frontend/src/motion/motionAnalysis.test.ts` now covers
   `analyzeMotionClips` under both modes, `loopContinuity`/`rootPath`/`rootComparison`
   behavior, and a parity check (dynamically derived from `motionEngineCore.poseDelta`, not
   hand-copied constants) that the ported pose component agrees with it on synthetic cases.
2. **`localBridge.ts` has zero tests** — *resolved (real-path coverage, PR #27; ownership
   tests added in #38).*
   `frontend/src/bridge/localBridge.test.ts` now covers detect, key status, the request
   wrapper, ownership verification, SSE subscribe, and followScan (33 tests across 6 describe
   blocks), plus `wire.test.ts` / `contract.test.ts` / `pluginPairings.test.ts` beside it.
3. **`styles.css` monolith** — *resolved 2026-07-28 (PR #67, after #66's rendered-output
   harness and a 128-dead-rule purge).* Split into 11 ordered slab files +
   `frontend/src/styles/index.css`, byte-identical output, slab order test-enforced
   (`styles/slabOrder.test.ts`). Deeper per-rule consolidation is optional follow-up work —
   the cascade is position-dependent in documented places, so any rule move needs the
   harness. Tracked in #120.
4. **Stale `frontend/*.md` docs** — *resolved 2026-07-26 (PR #41, "honest docs").*

Notable verified minors from the July-13 review — **re-verified against code 2026-08-02;
all but one are since fixed**:

- posePercent still averages over common joints only, but the Phase 1b coverage guard
  multiplies the overall score by coverage on every production path (web v2 + desktop
  bridge V2), so a 1-of-3-joint copy scores LOW_SIMILARITY, not HIGH (regression-tested).
  Only the legacy v1 engines keep the unguarded blend and they are parity/test-only.
- `Looped`/`priority` are still excluded from the curve fingerprint — now a **documented,
  deliberate** definition (`PlaybackSettings.java`: EXACT_CURVE_DATA is a curve-data-only
  claim), with snapshot change-detection recording looped/priority beside the fingerprint
  and classifying a Looped-only flip as CHANGED. Residual: the comparison-result view does
  not yet surface a "playback settings differ" indicator — tracked in #121.
- `PluginPairingService.revoke` — fixed: reachable via
  `POST /api/v1/projects/{id}/plugin-pairings/{pairingId}/revoke` and a Revoke button in
  the pairing list; issue + list + revoke complete the rotation surface.
- `Instant.toString()` lexicographic sort — fixed: `creatorflow.db.Timestamps` writes
  fixed-width nine-digit fractions everywhere and migration `V011` rewrote legacy rows.
- `followScan` adaptive polling — fixed in the Phase 2 pass (self-rescheduling timeout).
- SSE reconnect replay — fixed: the events route honors `Last-Event-ID` (and `?after=`),
  frames carry `id:` lines, so a reconnect resumes instead of replaying up to 4,000 events.

## July 13–14 skills-execution pass (branch `claude/skills-execution`)

Ran the plan in `docs/SKILLS_EXECUTION_PLAN.md`. All five phases done; merged as PR #1
(2026-07-14).

**Phase 1 — security audit (Semgrep + manual).** Semgrep 1.169.0 (OSS, no Pro) over
`server/`, `core/`, `desktop/`, `frontend/src/` in important-only mode with Trail of Bits /
elttam / Atlassian third-party rules. All 22 Java findings triaged to false positives or
flag-gated demo code (SQL findsecbugs hits are `LIMIT + int` and bundled migration DDL; the
SSRF hit is the hardcoded `127.0.0.1` bind; `PREDICTABLE_RANDOM`/`HARD_CODE_KEY` are the
`@ConditionalOnProperty("creatorflow.demo-seed")` seeder and a password-confirm check).
Frontend fully clean. `p/spring` could not run (registry pack 404s — retired upstream);
`findsecbugs` covered that surface. **One real, undocumented bug fixed:** an image
decompression-bomb DoS — `ImageIO.read()` ran on user uploads with no decoded-pixel bound in
`OriginalityEngine.verify`, `FileStore.writeThumbnail`, and `DiffService.compare`, and account
creation is open, so a few-hundred-KB PNG could decode to a multi-GB raster and OOM the JVM.
Fixed with `core` `SafeImageIo.read()` (reads header dimensions before allocating the raster;
40 MP default cap), wired into all three call sites. TDD, `SafeImageIoTest`.
**Read that as history, not as a map of today's code:** the Phase E preparation PR deleted
`FileStore` and `DiffService` outright, so `OriginalityEngine.verify` is the only remaining
`SafeImageIo.read()` call site. Two of the three guards went away with the code they guarded —
that is a smaller attack surface, not a regression, and the guard on the surviving path is
untouched. Server-side account creation can also now be gated by `creatorflow.signup.token`.

**Phase 2 — frontend review.** Reviewed `frontend/src` + recent motion/bridge code. Fixed two
confirmed bugs. (1) The exported release manifest failed CreatorFlow's *own* validator on the
"Apply prepared sample resolutions" path: an excluded blocked asset was labelled
`verification: CLEAR` but not counted in `summary.clear`, and `summary.unresolvedSources` used
string heuristics the validator doesn't share. Extracted a pure, tested `buildReleaseManifest`
(`frontend/src/manifest/releaseManifest.ts`) that derives the summary from the emitted records
with the validator's own rules; also fixed `sizeBytes`, which assumed MB and turned "684 KB"
into ~717 MB. (2) `localBridge.ts` `followScan` never sped up polling after the SSE stream
dropped (`setInterval(..., polling ? 600 : 900)` read `polling` once when it was always false);
converted to a self-rescheduling `setTimeout`. Baseline stayed green: 24 frontend tests (was
22), typecheck, build; core 13 / server 25 / desktop 24; full reactor compiles.

**Phase 2 leftovers — status re-verified 2026-08-02:** `matchedAssetId` is fixed
(`releaseManifest.ts` resolves the real 1-based asset ordinal by file name and records
unresolvable external matches as `EXTERNAL_MATCH` findings; regression-tested) and the
`ProductWorkspace` abort race is fixed (every awaited bridge call re-checks
`controller.signal.aborted` before setState). `MotionStage`'s render loop got an idle-cadence
mitigation (#51: ~11fps while paused instead of full rate) but still renders a static scene
forever instead of using `motion/renderLoop.ts`'s demand-driven scheduler like its four
sibling viewers — the full port is in flight. The four previously-known majors are all
resolved (see the findings list above).

**Phase 3 — immutable animation snapshots (build-order #3), shipped TDD-first.** A snapshot
captures one animation's canonical fingerprint at a moment, tagged `LAST_KNOWN_GOOD` /
`LAST_PUBLISHED`, scoped to (project, assetId); insert-only, and a re-capture is classified vs
the prior current one as FIRST/UNCHANGED/CHANGED by fingerprint. Layers: core
(`MotionSnapshotKind`, `MotionSnapshotStatus`, pure `MotionSnapshots.classify`), desktop
(`MotionSnapshotRecord`, `V006` migration that cascades with its project, and
`MotionSnapshotRepository` with atomic capture), bridge (`POST`/`GET`
`/api/v1/projects/{id}/animation-snapshots`, which promotes a chosen side of an existing motion
comparison — no Studio plugin contract change, no live Studio needed), and frontend
(`localBridge` client methods + `motion/snapshots.ts` presentation helpers). The visual React
panel was intentionally deferred to the design pass. NOTE: one wrap-up fix — the
`currentForProject` dedup key was accidentally built with a raw NUL char literal (compiled, but
made the file binary to Git); now `"::"`.

**Phase 4 — design drafts (build-order #5 and #6), drafts only.** Self-contained HTML mockups in
`docs/design/` matching the product's dark tokens, **not wired into the app** pending Bryan's
approval: `release-checklist-draft.html` (a go/no-go release checklist whose rollback row pins
the Phase 3 snapshots) and `stress-lab-matrix-draft.html` (a device-evidence matrix keeping
modeled/browser results visually separate from measured/Studio ones). See `docs/design/README.md`.

**Phase 5 — wrap-up done.** Full verification green: frontend 27 tests + typecheck + build; core
48 (excl. the env-only symlink test), desktop 27, server 25 — 100 Java tests, full reactor
compiles. The run merged to `main` as PR #1 on 2026-07-14 (see
`CONSOLIDATION-REPORT.md`).

## Known gaps needing a live Studio session (owner-only)

The friend test was **cancelled permanently on 2026-07-30**; live-Studio validation happens
as the owner's solo run or not at all. These gaps remain real and need that session:

1. Install the desktop-bridge plugin in Roblox Studio and run the manual checklist in
   `roblox-plugin/desktop-bridge/README.md` with two accessible Animation IDs.
2. Verify the `AnimationClipProvider:GetAnimationClipAsync()` behavior against the current
   Studio client and record the exact error copy for private, deleted, moderated, and
   wrong-owner assets.
3. Confirm the local bridge survives desktop restart, token rotation, Studio HTTP denial, and
   a request near the 2 MiB boundary.
4. ~~Add `CurveAnimation`~~ — Phase C does exactly this on a deterministic curve canonical
   format; in review as PR #119.
5. ~~Add a published-ID runtime probe on R6/R15~~ — shipped as Phase B (#118). Residual:
   the plugin's `RIG_ASSET_IDS` R6/R15 entries are `0` placeholders until a live Studio
   session fills them (Rig Builder → copy asset ID). The structural joint-overlap check
   (#122) is deliberately *not* on that dependency — it is derived desktop-side from the
   submitted joint names and reports on every Compare regardless.
6. Add an experience permission graph before claiming that an Animation ID is ready for both
   test and production.

## What to build next, in order

1. ~~**Friend test**~~ — cancelled permanently 2026-07-30 (see `ROADMAP.md`).
2. **Join the two halves**: motion-comparison evidence should be able to cite a registry asset
   ("94% similar to WalkCycle V3, registered by mira, mapped to ID 222 under your group"). The
   fingerprint is the join key. This is the feature no first-party Roblox tool can replicate —
   Roblox doesn't know two asset IDs are the same creative work; CreatorFlow does.
3. **Team registries**: the server API is per-account; a shared account works for demos, real
   teams need memberships. *(This is Phase E territory — approved to build by owner decision
   2026-08-02, see `ROADMAP.md`.)*
4. From GPT's original build order: creator/group/experience ownership and permission context
   per Animation ID *(the creator/owner/group-ownership match shipped 2026-07-24 — see
   Ownership verification above; a fuller permission graph remains)*; last-known-good and
   last-published immutable animation snapshots; a
   runtime probe for intended rig, priority, loop, markers, duration, and load errors; Release
   Flow as a Roblox checklist (version note, audience/eligibility, asset permission diff,
   rollback target, Studio publish confirmation, rollout, smoke test); Stress Lab as a device
   evidence matrix that clearly distinguishes modeled results from Studio and physical-device
   measurements.

## Product context in one paragraph

Competitive scan (July 13, 30 sources) found: plugin↔localhost-server is commodity (Rojo,
Argon, Lync, AssetReuploader) — never pitch the architecture. Unclaimed territory CreatorFlow
owns: team animation-ID lifecycle (documented, painful, only crude one-shot fixes exist),
perceptual/motion originality checking for Roblox assets (zero third-party tools), web-based
asset review/diff (Package Diffs is Studio-only), and release preflight (nothing in the
ecosystem). Main strategic risk: Roblox's first-party Expanded Sharing — anchor on
evidence/originality/review, which Roblox shows no sign of building.

## Large fixture policy

`frontend/` includes the lightweight licensed fixtures required by the Motion Lab and ordinary
tests. The optional showcase GLBs and large audio/video/FBX stress files remain local because
several are 10–102 MB each. Their metadata can render without the payload. Use Git LFS or
release artifacts before distributing the complete asset pack; do not push the 100 MB+ files
directly to GitHub.

