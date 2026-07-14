# Claude handoff — CreatorFlow, Roblox direction

Written July 13, 2026, end of a long session. Read `FABLE_HANDOFF.md` (GPT's
handoff) and `ROBLOX_WORKFLOW_RESEARCH.md` first if you haven't; this doc
covers what happened after them and what's true right now.

## Where things stand

`main` is green (both CI jobs) and contains, newest first:

- Frontend CI job + friend-test runbook + this doc.
- **Three review fixes** (`1f138d1`, `8339462`, `00cfd40`): bridge accepts
  `localhost` Host; desktop-bridge plugin sends `Pose.Weight` not deprecated
  `MaskWeight`; `ManifestCli` gained repeatable `--exclude` (this repo's
  dogfood scan needs `--exclude stress-fixtures`).
- **GPT's preflight commit** (`cd4ff3a`): `creatorflow.motion` Java engine,
  bridge pairing tokens, SQLite V005 evidence store, the `frontend/` React
  workspace (Motion/Stress/Release labs), and a second Studio plugin
  `roblox-plugin/desktop-bridge/` (single Lua file, loopback pairing).
- **Claude's registry work** (`81cc724`, `4dad46e`): per-context Roblox
  asset-id mappings (`POST/GET /api/v1/assets/{id}/mappings`, context =
  `group:12345` / `user:98765`, upsert per context) and the Rojo-based
  registry plugin `roblox-plugin/src/` (canonical KeyframeSequence
  serialization → pure-Luau SHA-256 → `/api/v1/verify` with `X-Api-Key`).

**Hard rule from GPT's handoff, still in force:** the two Studio plugins are
deliberately contract-separate (different auth, settings keys, endpoints). Do
not merge them silently; a future unified plugin should present "Local
preflight" and "Team registry" as explicit destinations.

## Verified build/test commands (Windows quirks included)

- Full Java suite: `mvn -B verify` — passes in CI. Locally on Bryan's Windows
  box, core's `followedSymlinkCannotEscapeTheSelectedRoot` fails (symlink
  creation needs Developer Mode); build core with `-DskipTests`, then test
  `desktop`/`server` normally. 91 Java tests as of this writing.
- Frontend: `npm --prefix frontend ci|test|run typecheck|run build` — all green,
  now enforced by the `frontend` CI job.
- Luau/Rojo aren't installed globally; grab `luau-compile` and `rojo` from
  their GitHub releases to syntax-check plugins / build the registry plugin
  (`rojo build roblox-plugin --plugin CreatorFlow.rbxm`).
- Commits must use `209073313+Bryancruzcb@users.noreply.github.com` (GH007
  push protection). Repo-local git config already set.

## Open findings from the 24-agent review (all adversarially verified)

Confirmed-major, still open:

1. **Dual scoring algorithms**: `frontend/src/motion/motionAnalysis.ts` and the
   Java `MotionComparisonEngine` compute materially different scores shown
   under identical "Pose/Timing/Coverage/Overall" labels. Either port one to
   match the other or label them distinctly; add a cross-implementation test.
2. **`localBridge.ts` has zero tests** — it's the only integration contract
   with the Java bridge.
3. **`styles.css`** is a 12,360-line monolith fighting six `*.premium.css`
   override files; contains verified-dead selectors (`.motion-variant-control`,
   `.dependency-tree`, `.hero-artifact`, …).
4. **`frontend/NEXT-IMPROVEMENTS.md`** (and parts of `RESUME-AND-INTERVIEW.md`,
   `STRATEGY.md`, `ROBLOX_BUILD_ORDER.md`) describe shipped features as future
   work or cite stale numbers/APIs. Fix before Bryan uses them for interviews.

Notable verified minors (full list in the July 13 session's workflow output):
posePercent averages over common joints only, so a 1-of-3-joint copy scores
HIGH_SIMILARITY; `Looped`/`priority` are validated but ignored by fingerprints
(flipping Looped still reports EXACT_CURVE_DATA); `PluginPairingService.revoke`
has no production caller (tokens live 8h, no rotation surface); repositories
sort `Instant.toString()` lexicographically (mis-orders across fractional-digit
widths); `followScan`'s adaptive polling is dead code; SSE reconnect replays up
to 4,000 events (no `?after=` resume).

## What to build next, in order

1. **Friend test** — `docs/FRIEND-TEST.md` is the runbook. Everything
   automatable is done; a human session in Studio is the blocker. Fix only
   what it surfaces.
2. **Join the two halves**: motion-comparison evidence should be able to cite a
   registry asset ("94% similar to WalkCycle V3, registered by mira, mapped to
   ID 222 under your group"). The fingerprint is the join key. This is the
   feature no first-party Roblox tool can replicate — Roblox doesn't know two
   asset IDs are the same creative work; CreatorFlow does.
3. **Team registries**: the server API is per-account; a shared account works
   for demos, real teams need memberships.
4. From GPT's build order: permission/ownership graph per animation ID, then
   published-ID runtime probe, then release-gate-as-Roblox-checklist.

## Product context in one paragraph

Competitive scan (July 13, 30 sources) found: plugin↔localhost-server is
commodity (Rojo, Argon, Lync, AssetReuploader) — never pitch the architecture.
Unclaimed territory CreatorFlow owns: team animation-ID lifecycle (documented,
painful, only crude one-shot fixes exist), perceptual/motion originality
checking for Roblox assets (zero third-party tools), web-based asset
review/diff (Package Diffs is Studio-only), and release preflight (nothing in
the ecosystem). Main strategic risk: Roblox's first-party Expanded Sharing —
anchor on evidence/originality/review, which Roblox shows no sign of building.
Similarity is always "a review lead, never a verdict" — keep that honesty; it's
what won the SJ Hacks judge question and it's all over the docs.
