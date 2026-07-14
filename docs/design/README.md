# Design drafts

Static, self-contained HTML mockups for review **before** any implementation. They match the
product's dark `color-scheme: dark` design tokens (oklch palette, IBM Plex Sans/Mono, semantic
clear/review/blocked) but are **not wired into the React app** — nothing here ships until Bryan
approves the direction. Open either file directly in a browser.

| Draft | Build order | What it proposes |
| --- | --- | --- |
| [`release-checklist-draft.html`](release-checklist-draft.html) | #5 — Release Flow as a Roblox checklist | A go/no-go checklist for one release candidate (Northwind 2.4 RC): version note, audience/eligibility, **asset permission diff vs the last published version**, **rollback target backed by immutable animation snapshots**, Studio publish confirmation, rollout, and smoke test. Complements the existing dependency-map view rather than replacing it. |
| [`stress-lab-matrix-draft.html`](stress-lab-matrix-draft.html) | #6 — Stress Lab device evidence matrix | A fixtures × evidence matrix that keeps **modeled** results (CreatorFlow browser, solid cells) visually separate from **measured** results (Studio / physical device, dashed cells), with most measured cells honestly `pending`. Status is encoded by icon + label + colour (never colour alone) and texture carries the modeled/measured split, per the dataviz method. |

## Design notes

- **Single theme on purpose.** The product commits to a dark world (`color-scheme: dark`), so the
  drafts do too rather than inventing a light theme the app doesn't have.
- **The checklist leans on Phase 3.** Its rollback row pins immutable last-known-good /
  last-published animation snapshots, so a rollback target is exact, not approximate.
- **The matrix's message is the separation.** A transfer size or decode cost is a hypothesis about
  runtime; the dashed "measured" columns stay open until a Studio import or device session fills
  them — that's the friend-test device pass, not something the browser lab can answer.
