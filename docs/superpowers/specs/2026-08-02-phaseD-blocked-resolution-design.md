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
  - blocked-resolution
---

# Phase D — Guided BLOCKED-resolution flow ("Gate check")

**Goal:** turn "the gate said BLOCKED" from a downloaded JSON file a person reads in
another application into a grouped, jumpable checklist in the workspace — so they can
see exactly what is standing, land on the precise affordance that changes each item,
and re-run the real gate — without minting throwaway release records and without the
workspace ever claiming something was resolved that only the gate can confirm.

**Why this phase, why now — and the gate this proceeds past.** `docs/ROADMAP.md`
lists Phase D as *(validation-gated)*, behind the friend test in `FRIEND-TEST.md`
that its own "The gate before more building: validate" section makes the precondition
for expanding the roadmap. **That friend test was cancelled by the project owner on
2026-07-30 and will not happen; the validation gate is closed permanently, not
pending.** Phase B's spec (`2026-07-31-phaseB-runtime-playability-design.md`) recorded
that cancellation and an owner decision to build B anyway, "picked over C/D/E." Phase
C's spec (`2026-08-01-phaseC-curve-animation-design.md`) recorded that B's decision
covered B only and that proceeding with C was a separate new owner decision. This is
the third such decision, made 2026-08-02, in the same shape and recorded the same way:
Phase D is built by explicit owner choice despite the gate being closed, not because
any earlier decision pre-approved it. Nothing about the gate's *reasoning* is claimed
to be satisfied — no real Roblox developer has trodden this path, and this feature is
scoped so that being wrong about what a user wants costs nothing more than a panel
nobody opens. `docs/ROADMAP.md` is not edited here; its Phase D status line changes
on merge.

Phase D as the roadmap words it is four things: batch decisions, a smoother
BLOCKED-resolution flow, the `styles.css` monolith cleanup, and the held dependency
majors. **Only the second ships here.** Batch decisions in particular is deliberately
left out and is the subject of the honesty analysis below — fusing the two would
produce the exact failure this design exists to avoid.

**What the loop actually is today**, verified rather than assumed. The gate runs only
as a side effect of `POST /api/v1/projects/{id}/releases`
(`desktop/src/main/java/creatorflow/workflow/ReleaseExportService.java`, gate evaluated
inside what is now `evaluateInTransaction`). `LocalReleasesView` renders a
`policyResult` chip, six counters and two download links — **it never renders the
violations**. The POST response does carry the full report, and `LocalRelease.report`
exists in `frontend/src/bridge/localBridge.ts`, but nothing in the render path reads
it, and `GET .../releases` serves `releaseSummaryView`
(`LocalBridgeServer.java:993-1006`), which omits `report` entirely — so after any reload
the violations are reachable only by downloading `gate-report.json`. The loop was:
build → see BLOCKED → download the JSON → open it in another app → read
`violations[].path` → go to Evidence → type the filename into a box that filters only
the current 100-record page (`LocalProjectWorkspace.tsx:918`) → find the right form
among three stacked in one inspector → fix → repeat per violation → go back → build
again, **which inserts another immutable release row**.

That last step is not merely noise. `createInTransaction` reads
`releases.latestForProject(projectId)` as the diff baseline
(`ReleaseExportService.java:99`), so every throwaway build becomes the baseline for the
next one and the `comparison.previousReleaseId` rollback target the workspace renders
(`LocalProjectWorkspace.tsx:1149`, `.local-release-rollback`). It also appends one
`RELEASE_CREATED` audit row per attempt.

**Architecture:** one new read-only bridge route,
`GET /api/v1/projects/{projectId}/gate-preview[?scanRunId=]`, backed by an extraction
inside `ReleaseExportService`: everything from loading the run through
`new ReleaseGate().evaluate(draft)` moves into `evaluateInTransaction`
(`ReleaseExportService.java:126`), which both `create` and the new `preview`
(`:90`) call. `createInTransaction` (`:95`) keeps only what persists — compare, insert,
audit. That extraction is the entire basis for the word *preview*: the checklist is not
a lookalike evaluation, it is the same `ReleaseGate.evaluate` call on the same
`AssetEntry` list the persisted release would have built. The frontend renders the
result in the existing Releases view and jumps into the existing Evidence view; the
walkthrough's state lives in the workspace shell, which does not remount when the view
changes.

**Honesty wrinkle this phase introduces:** the workspace now shows a list of things
standing at the gate *while a person is changing them*, so it is tempted to say
"resolved". It cannot. Only the gate knows, and only on its next run — approving clears
`FLAGGED_WITHOUT_APPROVAL` and `OWNERSHIP_MISMATCH_WITHOUT_DECISION` but **not**
`UNRESOLVED_SOURCE`, because `ReleaseGate.java:46-50` tests `source().resolved()`
independently of the decision. So what the panel records between checks is one observed
fact — *a write happened on this asset after this check* — rendered as **touched**, in
the review tone, next to a standing count that never goes down until the gate itself
says so.

**Tech stack:** Java 21 (desktop bridge + workflow), React 19 + TypeScript (workspace).
No plugin change, no core change, no SQLite change.

**No Task 0 gate.** Phases A/B/C each opened with a feasibility spike because the shape
of the solution depended on an external API this project had only medium confidence
about. Nothing here does: the gate, the repositories, the route arm and the two views
are all existing local code, and the one unknown that would have needed a spike
(whether preview and create can be guaranteed to agree) is answered by construction —
they are the same method — and asserted by test rather than argued.

## Global constraints

- **The gate is the only truth, and this flow never becomes a second one.** Every
  violation shown came from `ReleaseGate.evaluate` on the desktop. The workspace never
  re-implements a gate rule, and never computes whether an asset will clear. The "what
  clears this" line is one static, human-written sentence per group, sourced from the
  gate's own rules (`ReleaseGate.java:37-82`) — it is about the *kind*, never about a
  specific file.
- **No batch write capability exists, at any layer.** The bridge gains exactly one
  route and it is a GET returning a report. There is no endpoint that accepts a list of
  assets and a decision, so the capability is *absent*, not merely unexposed in the UI.
  See the honesty analysis below for where the line was drawn and why.
- **The decision picker is never rendered inside a checklist row.** Resolving requires
  being in `LocalEvidenceView` with that asset's findings, SHA-256, source record,
  ownership verdict and decision history rendered around the form. The jump is a
  shortcut through *navigation*, never through review.
- **No suggested decision.** The picker keeps its `NEEDS_REVIEW` default and the flow
  passes no value in. Pre-selecting "Approved" on a `FLAGGED_WITHOUT_APPROVAL` row
  would be the tool proposing the answer that clears the block — precisely the thing a
  similarity signal is not allowed to do. The per-asset required-reason gate survives
  unchanged, client-side (`disabled={saving || !reason.trim()}`) and server-side
  (`DecisionRepository`'s `requireReason`).
- **"Touched", never "resolved", and never a pass tone while violations stand.**
  `gateProgressLabel` (`LocalProjectWorkspace.tsx:194`) emits `"7 standing · 3 touched
  since this check"` and is unit-tested to contain neither the word "resolved" nor an
  "N of M" progress shape. The only pass-toned element in the panel renders when a
  returned preview has `passed: true`.
- **A preview persists nothing.** No release row, no audit event, and no read of
  `releases.latestForProject` — the last one matters because reading it is what makes
  every throwaway build poison the next real release's diff baseline.
- **Preview and create cannot drift.** Both call `evaluateInTransaction`, so "the check
  said clear and the release said BLOCKED" cannot come from two evaluations diverging —
  only from the underlying evidence actually changing between them, which is why every
  result is stamped with its own `evaluatedAt` and nothing polls.
- **Nothing downstream can be made to pass falsely.** The persisted manifest's gate
  block is computed server-side, and `ReleaseGateCli` re-evaluates on every CI run and
  exits **4** when a manifest's embedded gate disagrees with a fresh evaluation
  (`core/src/main/java/creatorflow/manifest/ReleaseGateCli.java:32-68`). Exit **2**
  stays policy-blocked, **0** pass, **3** bad input. This PR changes none of them.
- **No SQLite migration and no `SchemaMigrator.MIGRATIONS` entry.** Stated because it
  is the rule that has bitten this project before: `MIGRATIONS`
  (`desktop/src/main/java/creatorflow/db/SchemaMigrator.java:17-30`) is a hardcoded
  `List.of(...)`, not a directory scan, so a `.sql` file added without a matching entry
  does nothing at runtime and fails later as "table has no column". This feature adds
  no migration, so the correct action is to add nothing; a `V014` file in this PR
  should be treated as a mistake.
- **Export determinism is untouched.** The manifest is still derived from
  `run.completedAt()` rather than a wall clock. The preview's `evaluatedAt` is
  wall-clock, lives only in an HTTP response, and is never written into any exported
  artifact.
- **"Build release record" stays available while BLOCKED.** A blocked release is a
  real, exportable, downloadable artifact and several honest workflows want one; this
  feature must not quietly start forbidding it.

## Honesty analysis — what is safe to batch, and what is not

The misuse this feature creates is structural: a checklist of N blocking items with a
decision picker one click away is a machine for converting review leads into APPROVED
without anyone looking at evidence. `ROADMAP.md`'s standing constraint says a
similarity match is a review lead and a false accusation is the worst possible output;
the inversion — a tool that manufactures the *exculpatory* answer at scale — is just as
dishonest, and this flow is where it would appear.

- **Safe, and the entirety of what ships:** *navigation* (walk the violations in order,
  jump to the right affordance, keep a cursor) and *evaluation* (one gate re-run
  covering every fix at once). Both are ephemeral, write nothing to the ledger, and
  cannot be wrong in a way that survives — the next check overwrites them.
- **Not safe, excluded: bulk APPROVE.** Directly manufactures judgment.
- **Not safe, excluded: bulk EXCLUDE.** It looks conservative — excluding never blesses
  an asset — but it is still a claim made without inspection, and `ReleaseGate.java:44`
  makes `EXCLUDED` skip *every* check for an asset, so one click could clear an
  arbitrary number of violations of all four kinds. That is the highest-leverage rubber
  stamp in the system.
- **Not safe enough for v1: bulk source/license evidence** ("these 40 files all came
  from Kenney.nl, CC0"). The only batch with a genuinely honest reading — a `DECLARED`
  assertion a human is actively making. But if two of the forty are not from that
  source, the export carries a false provenance record with a person's name on it and
  nothing in the system can detect that. It needs its own design, scoping affordance
  and evidence-visible confirmation, not a corner of this PR.
- **Not safe enough for v1: reason carry-forward.** Defensible — each decision still
  needs its own click with evidence on screen — but a reason that becomes boilerplate
  stops being a reason, and the append-only decision record is the artifact a team is
  judged on later.

## Components

**Desktop — `ReleaseExportService`:**
- `GatePreview` (new record, `desktop/src/main/java/creatorflow/workflow/GatePreview.java`)
  — sibling of `ReleaseBundle` minus the two fields that only exist because something
  was written: no `ReleaseRecord`, no `ReleaseComparison`.
- `evaluateInTransaction(projectId, scanRunId, releaseName)` (`:126`) — the extracted
  evaluation. `releaseName == null` means "use the scan run's own label", which is safe
  because the name reaches only `CreativeManifest.Project`, a field
  `ReleaseGate.evaluate` never reads.
- `preview(projectId, scanRunId)` (`:90`) — wraps it in `database.transaction(...)`.
  Read-only, but the transaction is load-bearing: the evaluation reads five
  repositories (assets, findings, evidence, decisions, ownership) and must see one
  consistent snapshot.
- `createInTransaction` (`:95`) — now only compare, insert, audit.

**Desktop — `LocalBridgeServer`:**
- `PROJECT_GATE_PREVIEW` (`:87`) and its branch (`:557`), placed before the
  `PROJECT_RELEASES` handling it is the read-only sibling of. Reached through the
  existing `/api/` arm, so the session cookie and same-origin guard already apply;
  `requireMethod(exchange, "GET")` and no CSRF header, matching every other GET.
- Run selection mirrors the releases POST exactly — query `scanRunId` →
  `project.activeScanRunId()` → `scans.latestForProject(...)` — so a check and the
  release built moments later cannot silently pick different runs.
- `gatePreviewView(...)` (`:1044`) serves `ReleaseGate.Summary` as-is and each
  `ReleaseGate.Violation` plus **one** added field, `scanAssetId`.

**Why `scanAssetId` is the whole reason the route exists.** The gate is keyed by
manifest `path`; every decision affordance in the workspace is keyed by a numeric scan
asset id; and `listProjectAssets` is paged (100 default, 500 max), so the browser cannot
reliably resolve a path on a large project. The bridge maps it from the same
`scans.listAllAssets(runId)` the export already walks. An unmapped path emits `null`,
never a guess — a wrong id would put a person's decision on the wrong file — and a path
that somehow appeared twice in one run maps to nothing rather than to whichever row was
seen first (`Map.merge` removes the entry when the remapping function returns null).

**Field-name trap, preserved rather than unified:** the gate *report* calls it `path`
(`ReleaseGate.Violation`), a manifest's embedded *gate block* calls the same thing
`assetPath` (`CreativeManifest.Gate.Reason`, mirrored in
`frontend/src/manifest/manifest.ts`). This route is a report, so it uses `path`.
Renaming either would be a schema change and is out of scope.

**Frontend — `localBridge.ts`:** `LocalGateViolation` (`:177`), `LocalGatePreview`
(`:200`), `previewGate(projectId, scanRunId?)` (`:534`). `code` is typed
`LocalGateViolationCode | (string & {})` deliberately: a gate rule added on the desktop
before this bundle is rebuilt must still render, because dropping an unrecognised
violation would under-report a block, and under-reporting is the direction that ships
something.

**Frontend — pure helpers** (`LocalProjectWorkspace.tsx`, all exported and unit-tested
without a DOM): `groupGateViolations` (`:167`) groups in `ReleaseGate.Code`'s own
declaration order — `BLOCKED_DECISION`, `UNRESOLVED_SOURCE`,
`FLAGGED_WITHOUT_APPROVAL`, `OWNERSHIP_MISMATCH_WITHOUT_DECISION` — with anything
unrecognised collected into a final "Other" group; `affordanceForViolationCode`
(`:180`); `gateProgressLabel` (`:194`); `isGatePreviewStale` (`:208`);
`gateResolutionQueue` (`:227`).

`OWNERSHIP_MISMATCH_WITHOUT_DECISION` jumps to the **ownership panel**, not the decision
form, even though the decision form is the literal resolver: a person has to read what
the mismatch actually says before recording a call on it, and the decision form sits
directly below the panel. Facts first, then the decision.

**Frontend — `LocalGateCheckPanel`** (`:965`), rendered by `LocalReleasesView` directly
above the existing `.local-release-create` form. Kept in `LocalProjectWorkspace.tsx` on
purpose: that module's graph is narrow (lucide-react, `../bridge/evidenceBasis`,
`./EvidenceBasisMark`, `../manifest/manifest`) and pulls in neither three.js nor
`MotionComparisonLab`, which is what makes jsdom component tests cheap here. A new file
would have been fine; a new *dependency* would not.
- Header: the existing `.local-run-state` chip with `data-state="failed"` /
  `"completed"`, reading `BLOCKED` or `Check passed`, over "Checked {evaluatedAt}
  against run {id}… — this is a check, not a release. Nothing was written."
- Counter: `gateProgressLabel(summary.violations, touched)`. The standing number always
  comes from the server summary, never from how many rows were drawn.
- Groups, one `<section>` each, with a static "what clears this" line.
- Rows: path in mono, the verification/decision the gate saw, the gate's `message`
  verbatim, an "N open items on this file" note when the same path stands more than
  once, a *touched* mark with what was written, and one action — **Open evidence →**.
- Row cap: 50 rendered per group, then "…and k more of this kind"; the count is never
  truncated, only the rendering, and a built release's `gate-report.json` stays the
  complete artifact.
- `LocalReleasesView` also gains a **Re-check this run** button on a BLOCKED release
  card, which runs a *fresh* preview against `release.scanRunId` — it never replays the
  stored report as if it were current.

**Frontend — `LocalEvidenceView`** (`:779`) gains three additive props:
- `focusAffordance` — on the queued asset, `scrollIntoView` + focus the first control of
  `.local-source-form`, `.local-ownership-form`, or `.local-decision-record-form`
  (a new class on the existing decision form, added only so the three stacked forms are
  separately addressable). Reading it on mount is sufficient because `AnimatePresence`
  keys the frame on `${activeDataset}-${view}` (`ProductWorkspace.tsx:1006`), so a view
  change remounts this component — the same reason `initialSelectedAssetId` works as
  initial-only state.
- `resolutionContext` — a thin strip reusing the `.local-partial-result` review-tone
  pattern, reading "Gate check · item 3 of 7" with **Next item** and **Back to gate
  check**. Navigation only: it carries no decision, no suggested value and no verdict.
- `onResolutionTouch(assetId, note)` — called from the existing `saveDecision`,
  `saveSourceEvidence` and the ownership panel's `onVerified`. It reports *what was
  written*, and the panel renders that as touched.

**Frontend — `ProductWorkspace`:** `gateResolution` (`:595`) and `localFocusAffordance`
hold the preview, the touched map and the cursor; `openLocalAsset` (`:770`) and
`advanceGateCursor` (`:778`) move it; `recordGateTouch` (`:708`) records a write. The
state is cleared whenever `localProject.projectId` changes, because asset ids are per
project as well as per run.

**CSS:** appended to `frontend/src/styles/06-local.css` — appended, never interleaved,
because several rules in that slab win on source position rather than specificity (the
reason `styles/slabOrder.test.ts` exists). No new file, so that test is unaffected. The
only pass-green introduced is on the one state the gate itself returned as passed;
everything the workspace merely observed renders in `--review`.

## Persistence

**Nothing is persisted, and that is a design decision, not an omission.** The preview is
derived state — recomputed from the immutable scan snapshot plus the latest append-only
decisions, evidence and ownership rows every time it is asked for. Persisting it would
create a second, staler truth next to the one the gate produces, which is exactly the
failure `ReleaseGateCli` exit code 4 exists to catch.

The checklist and its cursor live in `ProductWorkspaceContent` React state. That
survives every view swap — only `.product-view-frame` remounts, keyed at
`ProductWorkspace.tsx:1006`; the shell does not — which is all "re-evaluate without
losing context" requires. A full page reload loses it, which is fine and honest:
re-checking is one click and one local query.

**Deliberately not used in v1, but found and worth recording:**
`workspace_state.queue_json` already exists (`V003__workspace_state.sql`, `TEXT NOT NULL
DEFAULT '[]'`), is round-tripped through `parseWorkspaceState`/`workspaceView`, is
validated only as "must be an array", and **no frontend code writes it today**. It is
the natural home for restart-durable queue state later, and it carries a landmine that
must be fixed before anything uses it: `parseWorkspaceState` defaults a missing `queue`
to an empty array, and `LocalEvidenceView` already calls `saveWorkspaceState({
activeProjectId, activeScanRunId, selectedAssetId })` on every asset selection
(`LocalProjectWorkspace.tsx:818`) — so a partial save silently wipes `queue_json`. Any
future persistence must echo the queue back on every save, or move all saves behind one
writer. If it is used, the shape must stay navigation-only —
`{ kind: "gate-resolution", scanRunId, evaluatedAt, items: [{code, path, scanAssetId}],
cursor }` — carrying no decision, no reason and no verdict, so nothing read back out of
it can influence the gate; and because the column is shared free-form JSON, the reader
must tag-and-filter by `kind` rather than assume it owns the array.

## Data flow

Releases view → **Run gate check** → `GET /api/v1/projects/{id}/gate-preview` →
`ReleaseExportService.preview` opens a read transaction → `evaluateInTransaction`
rebuilds the manifest from the immutable scan plus latest evidence/decisions/ownership →
`ReleaseGate.evaluate` → the bridge maps each violation's path to a scan asset id and
answers → the panel groups and renders it. **Open evidence →** sets the shell's
selected asset, focus affordance and cursor, then changes view; the evidence view
remounts, selects the asset, and focuses the right form. A write there reports a touch
back to the shell. **Re-run gate check** replaces the checklist wholesale from a fresh
evaluation, resetting the touched overlay and the cursor with it. **Build release
record** is unchanged, still persists, and re-runs the check straight afterwards so the
checklist on screen and the release just written cannot be read side by side saying
different things.

## Error handling

- **No completed scan.** 409, with the server's own message ("Project has no scan to
  release", or "Only a completed immutable scan can become a release"). The panel shows
  it and disables the check — the same precondition the existing
  `canCreate = run?.state === 'COMPLETED'` enforces. Fail-safe: no result at all rather
  than an empty one that could read as "nothing wrong".
- **A re-scan starts mid-flow.** When `run.id !== preview.scanRunId` the checklist is
  banner-marked stale, **every jump is disabled**, and the walkthrough strip stops
  being offered. The banner says both load-bearing things: asset ids are per-run, so
  nothing in the old checklist addresses a file in the new scan; and decisions recorded
  against the previous run stay with that run (`DecisionRepository.latestForRun` joins
  `scan_assets` on `scan_run_id`), so the new run's files need their own. Fail-safe:
  refuse to navigate rather than re-map paths across runs.
- **Why that guard is client-side and runs *before* the jump.** Old runs' `scan_assets`
  rows are never deleted, so `getAsset(oldId)` returns real data and the inspector would
  render a stale file with no warning. The bridge does reject the accompanying
  `saveWorkspaceState` — a `selectedAssetId` must belong to `activeScanRunId` — but that
  call is fire-and-forget with `.catch(() => undefined)`
  (`LocalProjectWorkspace.tsx:818`), so the 400 would never be seen.
- **A violation path maps to no scan asset.** `scanAssetId: null`; the row renders with
  its path and message, and the jump is withheld with a stated reason. Never a guessed
  id.
- **Unknown violation code.** Rendered in the "Other" group with the server's message
  verbatim, counted in the total, and still jumpable if the id resolved.
- **Preview request fails mid-flow.** The previous result stays on screen with its
  original timestamp, plus "Could not re-check: {error} — the result below is the
  earlier one". It is never cleared and can never flip to passed: a failed check is not
  a clean check.
- **Re-check returns items the person already touched.** Expected and correct — the new
  preview is a fresh truth object and the touched overlay resets with it. This is where
  "Needs review does not clear an ownership mismatch" gets learned, from the gate rather
  than from a UI guess.
- **One asset, several violations.** Common (unresolved source + flagged). Rows stay
  separate across groups with an "N open items on this file" note, so nobody is
  surprised when one save does not drop the count by two.
- **Project switched while the checklist is open.** The shell clears `gateResolution` on
  `localProject.projectId` change; otherwise the queue would address another project's
  asset ids.
- **A decision is made in the desktop JavaFX app while the browser checklist is open.**
  The preview is explicitly point-in-time and always timestamped; there is no polling
  and no live subscription. Staleness is disclosed, not hidden behind a refresh that may
  not have happened.

## Testing

- **`ReleaseExportServiceTest` — the extraction's proof.**
  `previewEvaluatesTheSameGateTheReleaseDoesOnIdenticalState` asserts the preview's
  manifest is byte-identical to the bytes the release persisted, and the two reports
  equal as whole records with only `evaluatedAt` normalised away (both stamp their own
  wall clock, and always will).
  `previewInsertsNoReleaseRowAndAppendsNoAuditEvent` runs five previews and asserts the
  release count and audit count are unchanged — and, pointedly, that the *next* real
  release still diffs against the last real release.
  `previewRefusesARunThatIsNotACompletedImmutableScan` covers the three preconditions.
- **`LocalBridgeServerTest`** — the route answers 200 with the gate's violations and a
  resolved `scanAssetId`, is session-guarded, rejects POST with 405, creates no release
  however many times it is called, and 404s/409s for an unknown project, no scan, a
  running scan and an unknown run id.
- **Contract fixtures** — `gate-preview.json` is recorded by
  `writesContractFixturesForTheTypeScriptClient` from a real server response and parsed
  back through the real client in `frontend/src/bridge/contract.test.ts`, so a field
  renamed on either side fails the other's suite.
- **`LocalProjectWorkspace.test.ts`** (no DOM) — the five pure helpers, including that
  `gateProgressLabel` emits neither "resolved" nor an "N of M" shape, that an unknown
  code survives grouping, and that a null `scanAssetId` is skipped by the queue rather
  than guessed at.
- **`LocalProjectWorkspace.gateResolution.test.tsx`** (new, `// @vitest-environment
  jsdom` on line 1, per-file as this project scopes it) — grouped rendering from a
  mocked `previewGate`; **Open evidence →** calling back with the right id and
  affordance; **no decision control anywhere in the panel** and no pass tone while
  violations stand; a stale `scanRunId` disabling every jump; an unrecognised code in
  "Other"; a failed re-check keeping the earlier result; `passed: true` rendering the
  success state; "Build release record" still available while blocked. Plus the evidence
  view's half: focus landing inside the right form, the walkthrough strip's copy and
  controls, and a decision write reporting back as *what was written*.

## Out of scope for v1

- **Batch decisions of any kind** — no bulk approve, no bulk exclude, no "apply to all
  similar", no reason carry-forward, no bulk source/license. This is the roadmap's
  *other* Phase D item and it must stay a separate design with its own honesty analysis.
- **No new bridge route that accepts a list of assets**, in any form, even read-only —
  the shape itself invites the batch write later.
- No change to `ReleaseGate` rules, codes, severity or thresholds; no change to
  `ReleaseGateCli` exit codes; core is untouched.
- No SQLite migration, no `SchemaMigrator.MIGRATIONS` entry.
- No `workspace_state.queue_json` persistence (documented above as the next step, with
  its partial-save hazard recorded).
- No auto re-check on every write, no polling, no SSE for gate state. Re-checking is
  explicit.
- No new nav item, no new `WorkspaceView`, no URL-hash deep link into the flow, no
  keyboard shortcuts, no focus-trap wizard or modal. The flow reuses the two existing
  views.
- No standing-violation metric on `LocalProjectOverview` — it would need its own preview
  call on mount, which is a real cost on a large project. Releases-only for v1.
- No gate preview for the imported-manifest dataset — an imported v0.2 manifest carries
  a static, historical `gate` block and there is nothing local to fix.
- No desktop JavaFX parity for this panel.
- No change to release immutability, to `ReleaseComparison`, or to the rollback-target
  line.
- The other three Phase D items as the roadmap words them: the `styles.css` monolith
  cleanup and the held dependency majors (Spring Boot 4 #8 — already landed via #107 —
  and JavaFX 26 #11) are not touched here.
