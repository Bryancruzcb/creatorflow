# "How it works": the record, not a description of the record

**Date:** 2026-07-28
**Surface:** `frontend/src/App.tsx` → `WorkflowSection`, plus the atlas stage cards

Follows [the landing dossier rig](2026-07-28-landing-dossier-rig.md), and applies the same test to
the section beside it: does this show the thing, or describe it?

## The problem

Four rows of prose, each ending in a label naming an artefact it never showed — "Output: JSON
release record". Measured before the change: **879px of page for 79 words**, with the entire right
half of the section empty. Nothing on it a visitor could look at.

## The approach

The four steps were already the right four; they are unchanged and still come from
`workflowSteps` in `data.ts`. What changed is that each one now reveals the part of a real release
manifest it produces, for one real file.

| Step | Contributes |
|---|---|
| Scan the project | `path`, `fileType`, `sizeBytes`, `sha256` |
| Review the evidence | `verification`, `matches`, `findings` + the top external match |
| Resolve exceptions | `source`, `license`, `decision` |
| Export the manifest | `summary` counts, then the document itself |

The panel is the return value of `buildReleaseManifest`, called with the same project name and
release the sample workspace's export button uses. Values are read out of that object, never
transcribed — `workflowRecord.test.ts` asserts each displayed field equals the corresponding
manifest field, so a copy that drifts fails the build rather than the page.

## Decisions worth keeping

**Step copy has one home.** Titles and bodies come from `workflowSteps`; only the field groups live
in `workflowRecord.ts`, and a count mismatch between them throws with an explanation rather than
silently dropping a step.

**Only the active step carries its body copy.** Four descriptions stacked is the wall of prose the
section was, and three of them always describe a step the reader is not looking at.

**The last step shows the document instead of the running list.** Every field steps one to three
added is already in the JSON. Carrying all fourteen rows above it made the panel twice as tall as
any other step and pushed the page down ~700px on a click. Section height now varies 66px across
all four steps.

**`generatedAt` is fixed, not `new Date()`.** A moving timestamp would make the section differ from
itself between two reads of the same page and flake any snapshot of it.

## Two bugs the screenshots caught

**The self-match headline.** Ranking the asset's matches by similarity put its own local-import
record on top — it scores 100% because it *is* the file — and rendered "100% similar to
avocado_foodstudy_v02.glb". True, circular, and exactly the number the step exists to show. Now
filtered to external records: "99% similar to Avocado.glb — upstream GLB, Khronos glTF Sample
Assets".

**Breaking version numbers.** The atlas stage cards wrapped `avocado_foodstudy_v02.glb` mid-token
as "avocado_fo / odstudy_v0 / 2.glb" under `overflow-wrap: anywhere`. Marking separators as break
opportunities fixed it — and the first attempt, which also broke after `.`, promptly split the card
beside it into "Manifest 1." / "2". `breakPoints` is now underscore and hyphen only, and tested.

## What was removed

`WorkflowScrub.css` and the scroll-scrubbed rail, which were a position readout for a list that no
longer exists; the `.workflow-list` / `.workflow-number` / `.workflow-copy` / `.workflow-output`
rules across three stylesheets. `useScrollReveal` also still targeted `.dossier-stage`, removed in
the previous change — corrected to `.evidence-rig`.

## Verification

384 unit tests (17 new across `workflowRecord` and `breakPoints`), 170 audit gates. Zero sub-11px
text and zero horizontal overflow inside the new subtree at 430px.

## Not done

`why-section` was in scope and was left alone deliberately. At 59 words it is the tightest section
on the page, and its `truth-line` — "detection proves conflicts, never originality" — is the honesty
statement the footer repeats. Rewriting it risked losing the one block on the page that builds
trust for no measurable gain.
