# CreatorFlow: product decision and build strategy

## Recommendation

Pivot CreatorFlow from a community gallery with originality checks into a **local-first release preflight for creative assets**.

The gallery can remain later as an optional registry or publishing destination. It should not be the primary product. The primary product should answer one urgent question for an indie game team or small creative studio:

> Can we ship this release, and can we show the evidence behind that decision?

That framing preserves the technically valuable work already in CreatorFlow—exact hashes, perceptual image comparison, audio signatures, upload policy, desktop operation, and a server registry—while turning it into a coherent workflow rather than a collection of features.

## Would anyone actually use it?

Potentially, but only in a narrower form than a general creator platform. The credible customer is an asset-heavy indie studio, agency, or publisher-facing team that already has a release checklist and cannot reliably answer: “Which third-party files are in this build, where did they come from, and can we produce the receipt or license?”

The product wedge is a **creative asset bill of materials**, not an originality detector and not another video review tool. Fingerprints reconnect renamed or edited files to evidence; the recurring value comes from release diffs, engine/CI integration, and an audit packet that travels with the build.

This distinction matters because Frame.io and Framer are different products. Frame.io is Adobe’s acquired video review and approval system. Framer is a website builder. CreatorFlow should compete with neither product’s broad interface; it should own project-level asset evidence before a release.

### What makes the wedge credible

- Teams already track licenses in spreadsheets, receipts, text files, and ad hoc folders.
- A source is often lost after an asset is renamed, exported, converted, or edited.
- Publisher/client handoff creates a deadline when missing evidence becomes expensive.
- A manifest diff makes the product useful on every release, not just during a one-time scan.

### What would make it useless

- Requiring users to maintain a separate dashboard with no Unity, Godot, CLI, or CI integration.
- Treating “no fingerprint match” as proof of ownership.
- Building a global registry before solving the local evidence/receipt workflow.
- Producing enough false positives that every scan becomes an untrusted cleanup chore.

### Validation and kill criteria

Before building a network or collaboration layer, run ten concierge audits with small studios or asset-heavy student teams. Ask each team for one real release folder and attempt to produce its asset manifest manually with the prototype.

Measure missing source/license records found, renamed assets reconnected to evidence, minutes required, false-positive review rate, and willingness to add one release-gate integration. Continue if at least three teams report this as a recurring painful release problem and at least two will install an adapter for the next release. Pivot to binary asset diffing or handoff packaging if the pain is rare, nobody will integrate it, or the audit saves no meaningful time.

## Why this fits SJHacks

SJHacks 2026 asked participants to make creative technology more accessible, reduce workflow friction, preserve creator control, and build secure or privacy-respecting tools. Its game-development track specifically asked how to improve the pipeline; its DIY track emphasized local control, protection, and reduced platform lock-in.

CreatorFlow Preflight maps directly to those goals:

- It reduces the release-time work of tracing where assets came from.
- It makes provenance and licensing review understandable to non-specialists.
- It keeps creative files local and makes registry comparison optional.
- It augments a human release decision instead of pretending automation can establish ownership.
- It produces a portable record that is not trapped in a gallery account.

## What the winners teach

The winners share a stronger pattern than “they had more features.” Each turns a specific, already painful creative workflow into a short, demonstrable loop.

| Winner | Broken workflow | Product loop | Lesson for CreatorFlow |
| --- | --- | --- | --- |
| deadwax, Best Overall | Music collaboration through ZIP files and renamed folders | Workspace → version → notes/branches → merge | Start with an existing workflow people already hate. |
| Bloom, Best 3D/CGI | Beginners cannot translate intent into complex 3D tooling | Sketch/speak → generate → refine → learn | Remove technical ceremony while preserving creator intent. |
| WhatTheDiff, Best Digital Content | Source control cannot explain binary 3D changes | Load versions → inspect visual/structural diff → review | Evidence becomes valuable when placed inside a review decision. |
| Playtest Pilot, Best Game Development | Unity QA is repetitive and fragmented | Launch test → collect failures → inspect report → fix | A full workflow beats an impressive isolated detector. |
| The Fifth Postulate, Best DIY | Independent creators lack one place to assess and protect plans | Inspect footprint → test decision → store proof | Security is strongest when attached to a creator’s real decision. |
| PixelPilot, cybersecurity winner | 2D level testing is repetitive | Run agent → observe failures → identify patterns → iterate | Make the technical system visibly do the work end to end. |

CreatorFlow’s original flow—browse a gallery, upload an asset, then receive a similarity result—put the difficult problem at the edge of a familiar but crowded product. Preflight brings the difficult problem forward and gives it a beginning, middle, and end.

## The chosen workflow

### 1. Select and scan a project

The desktop client indexes a release directory or engine project. It computes exact hashes and supported perceptual signatures locally, collects embedded metadata, and reads existing license/source records.

Output: a stable asset index with fingerprints and declared sources.

### 2. Review evidence

CreatorFlow groups findings into four explicit classes:

- Exact conflict: identical bytes or a known copied artifact.
- Perceptual review: similar image/audio content that requires inspection.
- Provenance gap: no reliable source, author, or creation declaration.
- License gap: a source exists but permission or required attribution is missing.

The UI should always show the method, threshold, source, and limits of the result. “No match” must never be presented as “original.”

Output: findings with source links and supporting evidence.

The prototype now demonstrates this with a real Khronos Avocado GLB under CC0. It compares the upstream binary to a reproducibly generated project derivative, stores the upstream license and hashes locally, and labels multiple records as one evidence chain rather than pretending they are independent ownership claims.

The comparison surface should make every reported match inspectable. A user can open the finding, switch among source records, compare the project asset against each source, review the matching method and record history, and then attach the source that actually explains the asset. “Three sources” must never be a dead label.

### 3. Resolve exceptions

Humans can attach a receipt, record attribution, add an ownership declaration, replace the file, or exclude it from this build. CreatorFlow records who made the decision, when, and why.

Output: accountable release decisions and audit notes.

### 4. Export the creative asset manifest

Export a versioned JSON document containing the release identifier, asset hashes, provenance, licenses, automated findings, exclusions, and human decisions. Store it beside the shipped build or in the repository.

Output: a portable release record. Cryptographic signing is a later phase, not a prototype claim.

## Product architecture

```text
Game / creative project
        |
        v
Desktop project scanner
  - paths and metadata
  - SHA-256
  - perceptual image signatures
  - audio fingerprints
        |
        +------> optional registry API (fingerprints only)
        |
        v
Evidence ledger
  - conflicts
  - provenance gaps
  - license gaps
        |
        v
Human exception decisions
        |
        v
Versioned creative asset manifest
```

### Mapping to the current modules

- `creatorflow-core`: own all scan primitives, evidence types, matching thresholds, and manifest schema generation.
- `creatorflow-desktop`: own project selection, local progress, evidence review, decisions, and export.
- `creatorflow-server`: own optional fingerprint lookup, registry policy, disputes, and revocation. Do not require raw creative files for comparison.
- Existing web gallery: treat it as a later opt-in publishing and discovery surface backed by completed manifests.

## Roadmap

### Phase 1 — credible release preflight

- [In progress] Define `CreativeManifest v0.1`, a shipped JSON Schema, deterministic serialization, and round-trip tests.
- [In progress] Add a project-directory scanner to core. The current scanner inventories supported media, preserves project-relative paths, runs the existing verification engine, and has a CLI bridge.
- Normalize evidence into exact, perceptual, provenance, and license findings.
- Persist local exception decisions.
- Export deterministic JSON and verify a re-import round trip.
- Replace sample data in this UI with desktop/core responses.
- Return addressable source records from the registry so the implemented investigation workspace can use real evidence rather than deterministic sample fixtures.

Current integration proof: the Java CLI scanned the prototype's nineteen real Khronos binaries and previews and emitted `public/assets/creatorflow-real-assets-manifest.json`. The result intentionally separates fingerprint status (`19 clear`) from provenance status (`19 unresolved sources`) until a source-evidence resolver supplies the stored license records.

Exit condition: a user can scan a real small game project, resolve every finding, export a manifest, and reproduce the same result on a second machine.

### Phase 2 — workflow integrations

- Unity and Godot project adapters.
- Git pre-push or release CI check with clear failure output.
- Importers for common asset-store receipts and license files.
- Team review with signed-in identities, without uploading source assets.
- Diff two manifests to show what changed between releases.

Exit condition: preflight becomes part of an existing release ritual instead of another dashboard to remember.

### Phase 3 — verification and ecosystem

- Optional cryptographic signing with documented key management and verification.
- C2PA import/export where formats and workflows support Content Credentials.
- Public fingerprint registry with disputes, revocation, abuse controls, and transparent match limits.
- Publisher-facing manifest verification page.
- Optional gallery publication from an already-reviewed release.

Exit condition: a third party can verify that the release record is intact and understand exactly what it does—and does not—prove.

## Alternative pivots

These are valid backup directions, ranked by how well they reuse the existing engine.

### A. Binary asset review for game teams

Compare two release folders and explain which images, audio clips, and models changed perceptually, not just by filename or hash.

Best track: Game Development or Digital Content Creation.

Why it could win: extremely clear demo and close to WhatTheDiff’s successful workflow. Risk: it competes more directly with that winning idea and would need excellent multi-format diff visualization.

### B. License inbox for indie creators

Watch asset folders, match files to receipts/licenses, and warn before an export loses attribution or usage records.

Best track: DIY Software.

Why it could win: understandable pain and strong privacy angle. Risk: less technically distinctive unless fingerprint matching reliably reconnects renamed or modified files to their records.

### C. Local provenance companion for creative tools

An extension or desktop watcher that records creation/import/edit events across tools and later exports Content Credentials-compatible provenance.

Best track: Digital Content Creation or DIY Software.

Why it could win: ambitious and standards-aligned. Risk: integration scope is too large for a short hackathon unless limited to one tool and one format.

### D. Accessible project handoff packager

Analyze a creative project and generate a clean handoff bundle: assets, dependency graph, licenses, missing files, and plain-language setup notes for the next collaborator.

Best track: any workflow track, especially Game Development.

Why it could win: it targets collaboration and accessibility directly. Risk: weaker use of the existing originality/conflict engine.

## Design position

The visual system should feel like a review desk in a small, serious studio—not a cyberpunk scanner and not a generic AI dashboard.

- Near-black graphite surfaces, restrained steel-blue actions, amber review, oxide blocked, sage clear.
- Matte layers and thin dividers instead of glass, gradients, glow, or excessive cards.
- IBM Plex Sans for editorial clarity and IBM Plex Mono for evidence, paths, hashes, and state.
- Motion should explain scanning, layer evidence during scroll, and preserve spatial continuity. It should not reward actions with game-like celebration.
- Always pair status color with a word and icon.
- Use direct product language: scan, evidence, source, license, decision, export.

## Standards boundary

C2PA is relevant but not the first milestone. It standardizes cryptographically verifiable provenance assertions attached to content. CreatorFlow’s near-term value is the release workflow that gathers evidence and decisions across a project. Later, it can import or emit C2PA information for supported assets.

The product should follow the same conceptual restraint expressed by C2PA’s principles: provenance supplies verifiable facts and trust signals; it does not make an automatic value judgment about whether content is “good,” “original,” or legitimately owned.

## Research sources

- SJHacks 2026 overview, tracks, security goals, and prizes: https://sjhacks-2026.devpost.com/
- SJHacks 2026 project gallery and winners: https://sjhacks-2026.devpost.com/project-gallery
- deadwax: https://devpost.com/software/deadwax
- Bloom: https://devpost.com/software/boom-ytjp4a
- WhatTheDiff: https://devpost.com/software/whatthediff
- Playtest Pilot: https://devpost.com/software/playtest-pilot
- The Fifth Postulate: https://devpost.com/software/the-fifth-postulate
- C2PA specifications and guiding principles: https://spec.c2pa.org/about/ and https://c2pa.org/principles/
- SPDX, a useful model for portable software inventory records: https://spdx.dev/
