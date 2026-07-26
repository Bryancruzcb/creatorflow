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

`main` is green (both CI jobs) and contains, newest first:

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

- Full Java suite: `mvn -B verify` — passes in CI. Locally on Bryan's Windows box, core's
  `followedSymlinkCannotEscapeTheSelectedRoot` fails (symlink creation needs Developer Mode);
  build core with `-DskipTests`, then test `desktop`/`server` normally. 91 Java tests as of
  this writing; frontend suite (22 tests), typecheck, and build are enforced by the `frontend`
  CI job.
- Desktop shell against the built frontend:

  ```bash
  npm --prefix frontend run build
  mvn -pl desktop javafx:run \
    -Dcreatorflow.web.root=$(pwd)/frontend/dist -Dcreatorflow.web.open=true
  ```

  The workspace URL is printed to the console at startup. (The old
  `-Djavafx.options="..."` form silently failed to forward these properties —
  verified 2026-07-20; the desktop pom now forwards them itself.)

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
- "Publish" in CreatorFlow currently means prepare and record a Roblox Studio handoff. It is
  not a direct Roblox upload.

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
2. **`localBridge.ts` has zero tests** — it's the only integration contract with the Java
   bridge.
3. **`styles.css`** is a 12,360-line monolith fighting six `*.premium.css` override files;
   contains verified-dead selectors (`.motion-variant-control`, `.dependency-tree`,
   `.hero-artifact`, …).
4. **`frontend/NEXT-IMPROVEMENTS.md`** (and parts of `RESUME-AND-INTERVIEW.md`,
   `STRATEGY.md`, `ROBLOX_BUILD_ORDER.md`) describe shipped features as future work or cite
   stale numbers/APIs. Fix before Bryan uses them for interviews.

Notable verified minors (full list in the July 13 session's workflow output): posePercent
averages over common joints only, so a 1-of-3-joint copy scores HIGH_SIMILARITY;
`Looped`/`priority` are validated but ignored by fingerprints (flipping Looped still reports
EXACT_CURVE_DATA); `PluginPairingService.revoke` has no production caller (tokens live 8h, no
rotation surface); repositories sort `Instant.toString()` lexicographically (mis-orders across
fractional-digit widths); `followScan`'s adaptive polling is dead code; SSE reconnect replays
up to 4,000 events (no `?after=` resume).

## July 13–14 skills-execution pass (branch `claude/skills-execution`)

Ran the plan in `docs/SKILLS_EXECUTION_PLAN.md`. Phases 1–2 done; 3–5 open.

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

**Still open from Phase 2 (lower priority, not fixed):** `MotionComparisonLab.tsx` `MotionStage`
runs a permanent `requestAnimationFrame` loop even when paused/static instead of using
`motion/renderLoop.ts`'s demand-aware scheduler; exported `matches[].matchedAssetId` uses the
match's own array index rather than a referenced asset ordinal (passes the validator's range
check only because match arrays are short — no unambiguous correct value since matches point at
external registry records); `ProductWorkspace.tsx:650` sets state after an `await` without
re-checking `controller.signal.aborted`. The four previously-known majors (dual scoring
algorithms, `localBridge.ts` still under-tested beyond `followScan`, the `styles.css` monolith,
and stale `frontend/*.md` docs) remain.

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
compiles. Branch `claude/skills-execution` holds the whole run; not yet pushed/PR'd (awaiting
Bryan's call on integration).

## Known gaps before the friend test

1. Install the desktop-bridge plugin in Roblox Studio and run the manual checklist in
   `roblox-plugin/desktop-bridge/README.md` with two Animation IDs your friend can actually
   access.
2. Verify the `AnimationClipProvider:GetAnimationClipAsync()` behavior against the current
   Studio client and record the exact error copy for private, deleted, moderated, and
   wrong-owner assets.
3. Confirm the local bridge survives desktop restart, token rotation, Studio HTTP denial, and
   a request near the 2 MiB boundary.
4. Add `CurveAnimation` only after defining a deterministic curve-channel canonical format.
   The current friend-test plugin intentionally accepts `KeyframeSequence` only.
5. Add a published-ID runtime probe on R6/R15 before claiming that an animation will play
   correctly in the target experience.
6. Add an experience permission graph before claiming that an Animation ID is ready for both
   test and production.

## What to build next, in order

1. **Friend test** — `docs/FRIEND-TEST.md` is the runbook. Everything automatable is done; a
   human session in Studio is the blocker. Fix only what it surfaces.
2. **Join the two halves**: motion-comparison evidence should be able to cite a registry asset
   ("94% similar to WalkCycle V3, registered by mira, mapped to ID 222 under your group"). The
   fingerprint is the join key. This is the feature no first-party Roblox tool can replicate —
   Roblox doesn't know two asset IDs are the same creative work; CreatorFlow does.
3. **Team registries**: the server API is per-account; a shared account works for demos, real
   teams need memberships.
4. From GPT's original build order: creator/group/experience ownership and permission context
   per Animation ID; last-known-good and last-published immutable animation snapshots; a
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

## Working-tree caution

Several local files named `* 2.java` were present beside canonical Java files. They are
byte-for-byte copies of the tracked originals and are intentionally ignored rather than
committed. Do not delete them without confirming with the user, and do not add compiler
exclusions merely to accommodate them in Git.
