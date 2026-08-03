---
type: design-spec
project: CreatorFlow
phase: D
status: approved-in-chat
date: 2026-08-02
tags:
  - creatorflow
  - roblox
  - phase-d
  - batch-decisions
---

# Phase D — Batch decisions ("Group review")

**Goal:** let one person resolve a same-violation-kind group of files with **one shared,
written justification**, recorded as one batch row plus **one honest ledger row per
file** — without the tool ever becoming a machine for manufacturing judgement at scale.
The batchable set is deliberately short: shared source evidence, needs-review triage,
and exclusion where the standing problem is a missing source record. `APPROVED` and
`BLOCKED` are never batchable — not disabled in the UI, *absent* from it, and rejected
by the bridge so a hand-rolled request cannot do it either.

**Why this phase, why now — and the gate this proceeds past.** `docs/ROADMAP.md` lists
Phase D as *(validation-gated)*, behind the friend test in `FRIEND-TEST.md` that its own
"The gate before more building: validate" section makes the precondition for expanding
the roadmap. **That friend test was cancelled by the project owner on 2026-07-30 and
will not happen; the validation gate is closed permanently, not pending.** Phase B's
spec recorded that cancellation and an owner decision to build B anyway, "picked over
C/D/E"; Phase C's spec recorded that B's decision covered B only; the Phase D
BLOCKED-resolution spec (`2026-08-02-phaseD-blocked-resolution-design.md`) recorded a
third such decision. **This is the fourth, made 2026-08-02, in the same shape and
recorded the same way**: batch decisions are built by explicit owner choice despite the
gate being closed, not because any earlier decision pre-approved them. Nothing about the
gate's *reasoning* is claimed to be satisfied — no real Roblox developer has trodden
this path. `docs/ROADMAP.md` is not edited here; its Phase D status line changes on
merge.

**This change is stacked on the gate-check feature** (`claude/phaseD-gate-check`,
commit `41dabe6b`), and depends on it: `ReleaseExportService.evaluateInTransaction` /
`preview()` and the `GatePreview` record already exist there, and this feature is built
on them rather than re-extracting anything. The BLOCKED-resolution spec's own words —
"`previewManifest` is the seam that feature should build on" — are what this does.

**Two facts from the code set the shape.**

1. `ReleaseGate.evaluate` (`core/src/main/java/creatorflow/manifest/ReleaseGate.java:29-88`)
   is the only thing that decides what "outstanding work" means. A second implementation
   of those predicates in the bridge would drift, and a batch panel that offers to "fix
   the unresolved-source files" while the gate disagrees about which rows those are is a
   lie about what the action accomplishes. So **the groups are the gate**: `preview()`
   runs the real evaluation and `report.violations()` is bucketed by `code`.
2. `ReleaseGate.java:44-50` shows `APPROVED` does **not** clear `UNRESOLVED_SOURCE` —
   only recording source evidence, or excluding, does. A batch feature that shipped
   decisions only would make "exclude them all" the one-click answer to "we never
   recorded where these came from". That is why batch **source evidence** is in the MVP
   rather than a follow-up.

**Tech stack:** Java 21 (desktop bridge + workflow + one SQLite migration), React 19 +
TypeScript (workspace). No plugin change, no core change, no manifest schema change.

## Owner decisions recorded here

Three of the design's open questions were answered by the project owner rather than
drifted into. They are recorded as decisions, with what would change if they are revisited.

- **Batch cap: 200 files.** A review-quality judgement, not a technical limit —
  `MAX_REQUEST_BYTES = 64 * 1024` (`LocalBridgeServer.java:79`) would allow several
  times that. It is stated in the UI in exactly those terms ("you can batch up to 200
  files at a time — keep the set something you can actually look at"), never as a bare
  number, and enforced in `BatchDecisionService.MAX_BATCH_ASSETS` as well as pre-checked
  in the route.
- **`EXCLUDED` is batchable only on `UNRESOLVED_SOURCE`, and within it only for files
  standing under that rule alone** — the conservative cut, and it takes *both* halves to
  mean anything. The `FLAGGED_WITHOUT_APPROVAL` and `OWNERSHIP_MISMATCH_WITHOUT_DECISION`
  groups offer `NEEDS_REVIEW` alone. Excluding is a scope claim that can honestly be true
  of a whole folder, and it reduces what ships, but on a *flagged* group it is the closest
  thing in the product to making findings go away in one click. The design's alternative —
  allow it with strong confirm copy — was considered and **rejected for now**.
  **The per-file half was missed on the first implementation and caught in review**: the
  group scope alone was decoration, because `EXCLUDED` is asset-level at the gate (see
  Guardrail 3), so one click on the unresolved-source chip silenced a selected file's
  similarity flag too. It is now refused per file and the panel withholds the control with
  the reason on the row. Loosenable later, but deliberately: allowing it would need confirm
  copy that states, per file, what else the exclusion settles, plus an owner decision to
  accept that trade — not a quiet widening.
- **Batch ids stay local; they are not exported.** The manifest carries no decision
  rationale at all (`CreativeManifest.AssetEntry` has `decision` but no reason), so a
  batch id in a portable artifact would be a dangling token resolving only to the SQLite
  file that produced it — worse than absent. Recorded as an explicit **non-goal** below,
  not an oversight. The real follow-up is "decision rationale *and* batch provenance in
  the manifest", together, as its own additive v0.2 change with the schema,
  `validators.generated.js` and `ManifestByteStabilityTest` moved in lockstep.

## Global constraints

- **The gate is the only truth, and this panel never becomes a second one.** Every group
  is a bucket of `ReleaseGate.Violation`s from one `preview()` call. The workspace never
  re-implements a gate rule and never computes whether an asset will clear. A group's
  gate message renders verbatim; where the gate words itself differently per asset
  (`OWNERSHIP_MISMATCH_WITHOUT_DECISION` says "still marked Needs review" or "no decision
  has been recorded" depending on the standing decision), the row carries its own
  message and the panel shows it when it differs from the group's.
- **`APPROVED` and `BLOCKED` are absent, not disabled, and refused server-side.** The
  panel renders no such control, with one line of copy saying where those decisions
  belong; `POST /batch-decisions` answers **400** to either regardless of what any client
  did. Precedent for the double enforcement: `validateMotionEnvelope` guards
  `MAX_MOTION_POSES` server-side (`LocalBridgeServer.java:333-343`) even though the
  plugin pre-checks, and the Phase C spec requires the same for snapshot pinning because
  "a disabled button is bypassable (a stale tab, a direct API call)".
- **Nothing is ever pre-checked.** Pre-checking is how a group review becomes a rubber
  stamp. The narrowing filters (common parent folder, file type, "SHA-256 identical to
  another file in this group") are built from computed facts and **narrow only** — no
  code path in `narrowGroupAssets` returns a selection.
- **The claim is the human's, and they must write it.** The rationale is mandatory on
  both routes, labelled "Why do these files belong together?", and required for batch
  source evidence too: the source/license pair is the declaration, but the claim the tool
  cannot check is that *these* files share it.
- **One decision row per asset, never one row for N.** Each asset keeps its own id, its
  own `created_at` and its own place in its own history; they share a `batch_id`. The
  alternative would break `DecisionRepository.latestFor`/`latestForRun` and, worse, would
  make "one judgement" and "one record" the same thing — the conflation this feature
  exists to *disclose*.
- **The batch is disclosed wherever the record is read.** The inspector's latest
  decision, every entry in the append-only history, and a batched source record all carry
  "Recorded as part of a 12-file batch · batch b1b2c3d4". This ships in the same change;
  it is the honesty payoff, not polish.
- **The server re-derives the group on every write.** Asset ids from the client are never
  trusted: an id not currently standing under the named rule is a 400. Otherwise the
  group name would be a claim the client makes about ids it chose. The same re-derivation
  is what supplies each file's `alsoStandingCodes`, so the cross-rule exclusion refusal is
  computed from the gate rather than from anything the request asserted.
- **The confirm step shows the files, not only the count**, and changing the narrowing
  clears the selection. Otherwise a person could tick 40 files in one folder, filter to
  another, tick 30 more, and submit 70 with 30 on screen — an honest count naming no file.
- **Whole-batch-or-nothing.** Every batch is one `Database.transaction`, and the drift
  check runs before any insert. There is no state in which some files carry a judgement
  the person's screen never showed them.
- **`ReleaseGate` does not change and does not learn that batches exist.** A batched
  `EXCLUDED` is byte-identical at the gate to a hand-made one. Making the gate treat
  batched decisions differently would either launder them or discount them — both are
  lies about what a person decided. No new violation code, no `ReleaseGateCli` exit-code
  change (0/2/3/4 unchanged), core untouched.
- **Export determinism is untouched.** No new `AssetEntry` field, no schema edit, no
  `validators.generated.js` regeneration; `ManifestByteStabilityTest` passes unchanged.

## Honesty analysis — the attack, and what stops it

**The attack.** Thirty SIMILAR rows, one "select all → Approve → reviewed" click. Thirty
human judgements about thirty distinct pieces of evidence, manufactured by one gesture,
then exported as a PASS. This is the false-accusation surface inverted: the product's
whole discipline is under-claiming about assets, and a bulk-approve lets a human
over-claim about them with the tool's help.

- **Guardrail 1 — the allow-list is enforced on the write.** `APPROVED`/`BLOCKED` → 400
  in every group. `EXCLUDED` → 400 outside `UNRESOLVED_SOURCE`. `BLOCKED_DECISION` →
  nothing batchable at all: those files already carry a deliberate human "no", and
  batch-superseding thirty of them is the rubber stamp inverted.
- **Guardrail 2 — what is batchable is what is genuinely uniform.** `EXCLUDED` is a
  *scope* claim that reduces what ships (the safe direction under "precision over
  recall"); `NEEDS_REVIEW` is a *triage* claim that clears nothing at the gate by
  construction (`ReleaseGate.java:52-58`, `:69-81`); shared source evidence is a
  *provenance declaration* that stays `DECLARED` — nothing is upgraded to `VERIFIED`.
  Approving a flagged or ownership-lead asset is per-evidence by nature ("I looked at
  *this* finding"), so it cannot be uniform, so it cannot be batched.
- **Guardrail 3 — batch-EXCLUDE as flag-silencing, and the mechanism that actually stops
  it.** `ReleaseGate.evaluate` skips an `EXCLUDED` asset at `ReleaseGate.java:44` —
  *before* the flagged check at `:52-58` and the ownership check at `:69-81`. **Exclusion
  is therefore asset-level, not per-violation**: excluding a file to settle its missing
  source record settles everything else standing on that file in the same click. Keeping
  `EXCLUDED` off the flagged and ownership *groups* does not prevent that, because a file
  standing under two rules appears in both, and the unresolved-source chip would reach it.
  So the guard is per file, not per group: `BatchDecisionService.requireExclusionIsSingleRule`
  refuses a batch exclusion of any asset whose `alsoStandingCodes` is non-empty (400,
  whole batch, nothing written), the group payload carries that list so the panel can
  disable the row and say why, and such a file stays excludable **one at a time**, on its
  own page, with its findings and history on screen — which is the individual attention
  the guarantee is actually about. The remaining exposure is unchanged and unfixable here:
  someone can still exclude files and ship them anyway, because export never calls the
  network. What the tool can do it does — the confirm copy states what an exclusion does
  at the gate, the excluded count is visible on every release
  (`ReleaseComparison.excluded`), and the batch id makes "N files excluded in one action
  with this rationale" reconstructable rather than looking like N considered calls.
- **Guardrail 4 — the grouping claim is written, or there is no batch.** Mandatory
  non-blank rationale on both routes, enforced in the service, at the route, and by
  `decision_batches.rationale CHECK (length(trim(rationale)) > 0)`.
- **Guardrail 5 — the server re-derives the group, and drift rejects the whole batch.**
  Necessary rather than defensive: `DecisionRepository.append` performs no such check
  itself, so two appends without a supersede id race silently and `latestFor` picks
  whichever sorted later.

**The positive argument.** Today, thirty decisions written by thirty clicks with a
copy-pasted reason and thirty written by one considered review are **indistinguishable**
in `decisions`. `batch_id` is the first thing in the system that can tell them apart. The
feature's own record-keeping is the honesty upgrade: the batch is disclosed structurally,
surfaced on every affected file's inspector and history, and never hidden behind
identical-looking singleton rows.

**The one honest limitation, stated rather than papered over.** The exported manifest is
silent about batching, because it is silent about decision rationale generally. The local
ledger, not the export, is the record of record for *how* a decision was made. See the
owner decision above.

## Components

**Desktop — persistence.**
- `V015__decision_batches.sql` + its `SchemaMigrator.MIGRATIONS` entry
  (`SchemaMigrator.java:17-34`). That list is a hardcoded `List.of(...)`, not a directory
  scan, so a `.sql` file without an entry does nothing at runtime and fails later as
  "table has no column"; Phase B hit exactly this.
- **Why 15 and not 14.** `SchemaMigrator.migrate()` applies *every unrecorded version* in
  ascending order rather than everything above the highest recorded one, and its own
  comment says why: "not for one with a gap (a migration rolled back by hand, or two
  branches adding versions independently), where 'above the max' would silently skip the
  missing one". So a gap is a supported state, and **V014 is left reserved for the open
  Phase C PR (#119, `V014__animation_comparison_clip_kind.sql`)**. Either branch can now
  merge first with no renumbering. `WorkflowRepositoryTest` asserts the migration *count*
  (14 rows: 1-13 plus 15), with a comment saying the gap is expected.
- New table `decision_batches(id, scan_run_id, kind, group_code, action, rationale,
  asset_count, created_at)`; `decisions.batch_id` and `source_evidence.batch_id` added
  nullable with no default, which is what SQLite requires of an `ADD COLUMN` carrying a
  `REFERENCES` clause under `PRAGMA foreign_keys = ON` (`Database.java:19`). Null means
  "not part of a batch", never "unknown". `asset_count` is denormalized but cannot drift:
  batch rows are insert-only.
- `DecisionBatchRepository` (insert / `findById` / `forRun`) — no update, no delete.
  Undoing a batch is a later superseding per-asset decision, exactly as it is today.
- `DecisionRepository.appendInBatch(...)` and `ScanRepository.appendEvidence(..., batchId)`;
  `batchId` added to `DecisionRecord` and `SourceEvidenceRecord` and to their `map(...)`
  readers.
- `ScanRepository.assetIdsByPath(runId)` — **the one** path → scan-asset-id mapping, now
  shared by `gatePreviewView` and the review groups. Two copies would be two chances to
  disagree about which file a person's decision lands on. An ambiguous path resolves to
  nothing rather than to whichever row was seen first.

**Desktop — `BatchDecisionService`** (`workflow`), which owns the guard chain and the
allow-list table (`batchableActions`), so exactly one place decides what may be batched.
`reviewGroups` runs `releaseExports.preview(...)` and buckets the violations in
`ReleaseGate.Code`'s own declaration order. Both writes re-derive the group *inside* the
transaction, check drift per asset, then insert the batch row, then one record per asset,
then the audit event (`DECISION_BATCH_RECORDED` / `SOURCE_EVIDENCE_BATCH_RECORDED`).
`Database.transaction` is re-entrant against an open transaction, so the nested
`preview()` joins rather than opening a second one.

**Desktop — `LocalBridgeServer`:** three routes, dispatched before the bare `SCAN`
matcher exactly as `SCAN_EVENTS`/`SCAN_CANCEL` are, and scoped to a scan run because a
group is only meaningful against one immutable snapshot. The project is resolved *from
the run*, so a batch needs one id, not two.
- `GET /api/v1/scan-runs/{runId}/review-groups` → `{ scanRunId, gateResult, evaluatedAt,
  groups: [{ code, message, batchableActions, assets: [...] }] }`. 409 when the run is not
  a completed immutable scan; 404 for an unknown run. `evaluatedAt` is additive to the
  design's sketch and mirrors `gatePreviewView`: a group read is point-in-time and says so.
- `POST /api/v1/scan-runs/{runId}/batch-decisions` → 201 with the batch and every
  decision it wrote.
- `POST /api/v1/scan-runs/{runId}/batch-source-evidence` → 201, same shape.
- Both POSTs go through the existing `requireMutation` (same-origin + CSRF), and a drift
  rejection answers **409** `{ error, driftedAssetIds: [...] }`.
- `decisionView` / `sourceEvidenceView` replace the previous raw record serialization on
  the per-asset decision and evidence payloads, adding **`batchAssetCount`** beside
  `batchId`. That number is what lets the marker say "one of twelve recorded at once"
  rather than only "part of a batch"; null when unbatched, and null — never a guessed 1 —
  when the batch row cannot be read.

**Frontend — `localBridge.ts`:** `ReviewGroupCode`, `BatchableAction`,
`LocalReviewGroupAsset`, `LocalReviewGroup`, `LocalReviewGroups`, `LocalDecisionBatch`;
`batchId`/`batchAssetCount` on `LocalDecision` and `LocalSourceEvidence` (optional, so an
older bridge's silence reads as "not batched"); `listReviewGroups`, `recordBatchDecision`,
`recordBatchSourceEvidence`. `LocalBridgeError` gains `driftedAssetIds`, carried through
for the same reason as the 429 retry hint: dropping it leaves a person told only that
"something changed".

**Frontend — `BatchReviewPanel.tsx` (new file), mounted by `LocalEvidenceView`** between
the toolbar and `.local-evidence-layout`. A separate file on purpose: `LocalEvidenceView`'s
entire inspector render is one ~6000-character JSX line, and a panel added into that is
unreviewable. It also keeps the narrow module graph the jsdom component tests depend on.
- Collapsed: one strip with the gate result and a chip per group in the gate's own
  vocabulary in plain words ("Unresolved source · 30", "Flagged, needs a call · 12").
- One group open at a time; selection cannot cross groups because it is cleared with the
  group and there is no shared selection state above it.
- Rows: checkbox (never pre-checked), file name, path, verification chip, standing
  decision, and the gate's per-asset message when it differs from the group's.
- Narrowing row (folder / file type / shared SHA-256) with a line saying it never ticks
  anything. "Select all N shown" acts only on the current filtered subset and states its
  own count. There is no select-all across groups and none across the run.
- Actions come from the server's `batchableActions`. No Approve, no Block, one line:
  "Approving or blocking a file is a per-file call — open the file and record it there."
- Confirm is a second click, not a modal, matching the app's inline-form style, and states
  the **exact writes**: "Writes 1 batch record and 12 decision rows. Every file keeps its
  own row in its own history, all carrying this rationale." Excluding adds the load-bearing
  line about what it does and does not do; needs-review says out loud that it clears
  nothing at the gate.
- After a write: a receipt naming the batch and the count, a re-fetch **from the gate**
  (never a client-side patch), and `onLedgerChanged` so the ledger and open inspector reload.

**Frontend — `LocalProjectWorkspace.tsx`,** kept to the minimum: the panel mount, a
`reloadLedger` callback, the exported pure `batchMarkerLabel`, the marker on the latest
decision and on a batched source record, and a compact `Decision history` section — the
history was previously *counted* but never rendered, so there was nowhere for a
per-entry marker to live.

**CSS:** appended to `frontend/src/styles/06-local.css`, never interleaved, because
several rules in that slab win on source position rather than specificity. No new file,
so `styles/slabOrder.test.ts` is unaffected. No pass tone anywhere except the one state
the gate itself returned as passed.

## Persistence

One migration, described above. Everything else is derived: the groups are recomputed
from the immutable scan snapshot plus the latest append-only decisions, evidence and
ownership rows on every request. Persisting them would create a second, staler truth next
to the gate's — the failure `ReleaseGateCli` exit code 4 exists to catch.

`reason` on each `decisions` row is the shared rationale **verbatim**. It is not decorated
with "(batch)": the `batch_id` carries that fact structurally, and mangling the human's
own sentence would be a small dishonesty in the text of record.

## Data flow

Evidence view → panel mounts → `GET .../review-groups` → `preview()` opens a read
transaction → `evaluateInTransaction` rebuilds the manifest → `ReleaseGate.evaluate` →
violations bucketed by code, each asset joined to its current decision and evidence row →
the panel renders chips. Open a group → narrow → tick files → pick an action → write the
reason → **Review what this writes** → **Record this batch** → one transaction:
re-derive, drift-check, insert the batch, insert one row per asset, append the audit
event → 201 → the panel re-fetches the groups from the gate and the evidence view
reloads the ledger and the open record.

## Error handling

- **Run not COMPLETED** (including a CANCELLED partial snapshot) — 409 with the server's
  own message; the panel renders that one line and no controls. Running the gate over a
  half-scanned tree would produce a verdict about files nobody scanned.
- **Drift between load and submit** — 409 with `driftedAssetIds`, whole batch rejected,
  nothing written; the panel reloads the group and names the files that moved.
- **An asset left the group between load and submit** — 400 on the same re-derivation
  path. Fails toward "nothing written".
- **Batch of one** — 400, with the panel's own floor at 2 as well.
- **Over 200** — 400 naming the cap and the reason, distinct from `MAX_REQUEST_BYTES`,
  which a 200-entry payload never approaches. Pre-checked in the route so a hostile
  payload cannot make the bridge build a huge entry list first.
- **Blank rationale** — 400, plus the column `CHECK`, plus a disabled control.
- **Blank source or license on a shared declaration** — 400. `SourceEvidence.resolved()`
  reads both together, so a half-filled declaration would clear nothing while looking
  like it had.
- **The same file listed twice in one batch** — 400 rather than two rows for one file.
- **Gate passes / no groups** — an explicit "No outstanding group work on this scan.",
  never an empty frame that reads as a loading failure.
- **A BLOCKED asset appearing inside another group** — it cannot: `ReleaseGate.java:38-43`
  `continue`s after emitting `BLOCKED_DECISION`.
- **Bridge absent, or the sample / imported-manifest dataset is active** — the panel lives
  inside `LocalEvidenceView`, which only mounts for `activeDataset === 'local'`, and
  renders nothing without a scan run id.
- **A file standing under two rules, selected for exclusion** — 400, whole batch, nothing
  written; the panel disables the row under that action and says why. See Guardrail 3.
- **A write fails partway** (SQLite busy, FK violation) — the transaction rolls back and
  the ledger is untouched; `busy_timeout = 5000` is already set. It reports as **500**,
  not 409: `Database.transaction` wraps every `SQLException` into an
  `IllegalStateException`, so the routes catch the narrower `ScanNotReleasableException`
  for the one precondition that really is a state conflict. Before that split, a disk or
  busy failure answered "409 Could not complete database transaction" — a state-conflict
  status carrying an infrastructure message.

## Testing

- **`LocalBridgeServerTest`** — the anti-drift test downloads the release's manifest bytes
  and runs a plain `new ReleaseGate().evaluate(...)` over them, asserting the groups equal
  that evaluation code-for-code and path-for-path; `APPROVED`/`BLOCKED` refused 400 in
  every group; `EXCLUDED` refused on a flagged group and accepted on the unresolved-source
  one, with the advertised `batchableActions` asserted alongside; an out-of-group id
  refused with nothing written; drift → 409 with `driftedAssetIds` and nothing written
  (decision *and* source-evidence flavours); the floor, the cap and the blank rationale;
  the record shape (one batch row, N decision rows, one shared `batch_id`, the rationale
  verbatim, `batchAssetCount` on the per-asset payloads, and a per-file decision still
  reading as unbatched); and the 409/401/405/403 guards.
- **`DecisionBatchRepositoryTest`** — the row shape at the repository level, and that the
  column refuses a blank rationale.
- **Contract fixtures** — `review-groups.json` is new, and `asset-detail.json` /
  `decision-history.json` are re-recorded from a run that **actually has a batch on it**,
  so the marker keys are real bytes rather than a hand-written idea of them. All written
  by `LocalBridgeServerTest#writesContractFixturesForTheTypeScriptClient`; never
  hand-edited.
- **`contract.test.ts`** — parses the new fixture through the real client, asserts
  `batchableActions` never contains `APPROVED`/`BLOCKED`, and asserts both drift tokens
  survive as their nullable selves.
- **`BatchReviewPanel.test.tsx`** (new, `// @vitest-environment jsdom` on line 1, no
  jest-dom) — mostly assertions about what is **absent**: no Approve/Block control,
  nothing pre-checked, filters that never select, no submit until a set + an action + a
  written reason exist, the confirm step's exact-writes copy, the drift path reporting
  "nothing was recorded", a blocked group with no way to act on it, the 409 line for a
  non-completed run, and the empty state.
- **`LocalProjectWorkspace.decisionFlow.test.tsx`** — the batch marker rendering on the
  latest decision and in the history, with the per-file entry beside it carrying none; and
  every history entry carrying its own timestamp, with a superseded entry marked as such.
- **`LocalProjectWorkspace.test.ts`** (no DOM) — `batchMarkerLabel`, including that an
  unknown count stays unknown rather than becoming a batch of one;
  `supersededDecisionIds` reading the record rather than list position; and
  `formatDecisionTimestamp` reporting an unreadable stamp as unknown.

**Known gap, recorded rather than papered over:** contract fixtures capture GETs only, so
three of the five payload sites that now go through `decisionView`/`sourceEvidenceView` —
`POST /assets/{id}/decisions`, `POST /assets/{id}/source-evidence` and
`GET /assets/{id}/source-evidence` — have no fixture guarding them. `LocalBridgeServerTest`
asserts the POST decision shape directly, but a rename on either evidence route would not
fail the TypeScript suite. Widening the fixture capture to POSTs is its own change.

## Out of scope for v1

- **Batch `APPROVED` or `BLOCKED`, ever, in any form.** Not deferred: designed out, and
  enforced at the route.
- **Manifest or gate-report exposure of the batch id** — see the owner decision above.
- **Any `ReleaseGate` change**: no new violation code, no batch awareness, no exit-code
  change.
- **Undo/revert a whole batch.** Undo stays a superseding per-asset decision. A one-way
  bulk action with a one-click reverse would be worse than shipping neither; a revert is a
  second bulk write and needs its own honesty analysis.
- **Batch ownership verification** — each verify is a live Open Cloud call and the single
  live-call site in the product; bulk-verifying is a rate-limit and honesty question of
  its own.
- **Batching on a non-COMPLETED run**, including CANCELLED partial snapshots.
- **Saved/named groups, batch rules, auto-apply, "apply last batch to new matches", reason
  carry-forward.** Every one of those makes judgements without a human present at the
  moment of judgement.
- **Cross-run or cross-project batches.** A batch is scoped to one immutable scan.
- **Batching on the sample or imported-manifest datasets** — read-only there by design.
- **Selecting across groups, or any select-all above the group level.**
- **Any server or network involvement.** The frozen `server/` tree stays frozen.
- The other Phase D items as the roadmap words them: the `styles.css` monolith cleanup and
  the held dependency majors are not touched here.
