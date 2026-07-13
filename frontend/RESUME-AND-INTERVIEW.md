# CreatorFlow: resume and interview guide

## The shortest correct explanation

CreatorFlow is a local-first creative asset bill of materials for game and creative releases. It scans a project, reconnects exact or perceptually related files to source and license records, records human release decisions, and exports a portable asset manifest.

Scanning is the intake mechanism—not the whole product. The product is the evidence and decision workflow after the scan.

## Thirty-second pitch

“Creative teams pull images, audio, fonts, models, and asset packs from many places, then lose track of where those files came from by release time. CreatorFlow scans the project locally, fingerprints the media, and surfaces exact conflicts, visual similarities, missing licenses, and provenance gaps. For every finding, the team can inspect the matching sources, attach the correct evidence, exclude the file, or record a human decision. It then exports those hashes, sources, and decisions as a release manifest. The key design principle is that detection finds conflicts—it never pretends to prove originality or ownership.”

## Resume bullets you can use now

Use one or two, not all of them.

- Designed and built CreatorFlow, a local-first creative-asset release preflight workflow that connects media fingerprinting, source investigation, license evidence, human approvals, and JSON manifest export.
- Implemented an interactive React/TypeScript evidence workspace with multi-source visual comparison, deterministic scan states, accessible status semantics, responsive layouts, and reduced-motion support.
- Integrated five real licensed GLB evidence chains with a reproducible derivative pipeline and a lazy-loaded Three.js registered-reveal viewer for synchronized source-versus-project inspection.
- Built a standalone product workspace and an on-demand stress-asset pipeline that indexes 43 MB and 24 MB extension-rich GLBs without adding them to initial page load.
- Implemented `creatorflow.manifest/v0.1` in Java with recursive project scanning, existing fingerprint-engine reuse, project-relative paths, deterministic JSON export/re-import, a shipped JSON Schema, CLI execution, and round-trip tests.
- Reframed a community-gallery prototype into a focused game-development workflow after analyzing SJHacks winners and identifying release-time asset provenance as the strongest use of the existing fingerprint engine.
- Built a portfolio-grade product narrative using Canvas 2D rendering, pointer-responsive depth, viewport-aware animation, and a production-tested responsive design system without compromising the task UI.

Only use this stronger bullet after the React surface is connected to the Java engine and real registry data:

- Built an end-to-end Java 21 and React creative-asset preflight system that scans real project directories, performs exact and perceptual matching, resolves evidence exceptions, and emits versioned release manifests.

## What you personally built

Be precise about the layers:

### Existing technical foundation

- Java 21 Maven multi-module project.
- Core fingerprinting and verification logic.
- Server/gallery and desktop modules.
- Exact hashes, image similarity, audio signatures, and upload-policy work.

### This product/design iteration

- Product pivot from public gallery to release preflight.
- Scan → investigate → resolve → export information architecture.
- Advanced landing-page art direction and responsive design system.
- Interactive evidence ledger and release state machine.
- Three-source match investigation with source switching.
- Visual comparison split control.
- Human source attachment and release resolution.
- Browser-generated JSON manifest containing matching record summaries.
- Accessibility and reduced-motion behavior.
- Canvas-rendered evidence relationship map that pauses outside the viewport.

The current React experience uses deterministic evidence records around ten real local GLB binaries: five CC0 Khronos source models and five reproducibly generated project derivatives with controlled, documented material deltas. The Java core now scans arbitrary directories and emits the same versioned manifest boundary; the next engineering milestone is calling that scanner from the desktop UI and persisting source/decision records.

## Two-minute architecture explanation

“The architecture separates detection from judgment. The Java core should own file indexing, SHA-256, perceptual signatures, matching thresholds, evidence types, and manifest serialization. The desktop layer should own project selection, local scan progress, source investigation, exception decisions, and export. The server should receive fingerprints rather than raw creative files and return addressable source records with match metadata. The React prototype demonstrates that complete workflow and the API shape it needs.

When an asset is flagged, the interface does not show only a confidence badge. It exposes each source record, the algorithm used, similarity or distance, registration time, license state, and what the relationship can actually prove. A human then attaches evidence, replaces the file, or excludes it. The exported manifest preserves both the automated finding and the human decision.”

## Ninety-second demo script

1. Start at the hero: “The user needs to know what can ship, not whether a gallery upload succeeded.”
2. Show the evidence relationship map: “The scan creates links between assets, source records, licenses, decisions, and the release.”
3. Run the sample preflight.
4. Point to `Perceptual match · 3 sources`: “This used to be a dead result. Now every source is inspectable.”
5. Open the investigation workspace.
6. Switch among Avocado, Boom Box, Barramundi Fish, Water Bottle, and Lantern; for each, inspect the upstream Khronos model, repository distribution record, and local import/edit record.
7. Rotate the registered GLBs, move the reveal, and use the delta register to separate visible material changes from record-only metadata and exact byte matches.
8. Attach the correct source and required credit.
9. Resolve the remaining sample exceptions.
10. Export the manifest: “The release leaves with a record, not a green score.”

## Strong interview questions and answers

### “Is it an originality detector?”

No. It detects exact or perceptual conflicts and missing evidence. A clean result only means no conflict was found in the registries checked. Ownership and permission come from source records, licenses, declarations, and human review.

### “Why local-first?”

Creative projects can contain unreleased game art, audio, client work, and licensed assets. Fingerprinting locally reduces exposure; a connected registry can compare signatures without requiring the original project files.

### “Why not just use Git?”

Git tracks file versions well but does not explain visual similarity, reconstruct a lost license, or produce a release-focused asset inventory. CreatorFlow complements version control by making binary creative evidence reviewable.

### “Would a studio really use this?”

Only if it lives in the release path. The initial user is a small asset-heavy team that must answer publisher, client, or storefront questions about third-party material. The next validation is ten real project audits and one Unity, Godot, or CI integration; if teams will not install that integration or the audits expose no recurring evidence gaps, the product should pivot rather than invent a market.

### “Is this like Frame.io or Framer?”

No. Frame.io is video review and approval; Framer is a website builder. CreatorFlow’s job is release inventory and evidence for the files inside a game or creative project. Its interface can borrow the polish of premium creative tools without copying their product scope.

### “Why does this need a UI?”

Detectors produce ambiguous findings. The difficult work is comparing sources, understanding limitations, attaching permission, assigning responsibility, and recording the final exception. Those are human decisions that need context and clear state.

### “What was the hardest product decision?”

Removing the gallery from the center. The gallery was visually familiar but strategically broad. Making the release decision the product produced a clearer user, workflow, demo, and technical roadmap while preserving the existing engine.

### “What would you build next?”

Add project-wide evidence search and source aggregation, cache unchanged fingerprints for incremental scans, replace curated GLB component relationships with production mesh registration, then build one excellent Unity or Godot adapter. The React/Java bridge, versioned manifest, SQLite decisions, release diffs, and CI gate are already implemented.

## Next steps, in order

### 1. Add project-wide evidence operations

The desktop workspace now calls the Java scanner through the authenticated local bridge. Next, move search/filtering beyond the current 100-record page and add a project-wide source library endpoint with saved views.

### 2. Make registry source records addressable

Each registry match needs a stable ID, publisher/owner assertion, first-seen time, fingerprint method, similarity/distance, license URL or stored receipt, dispute state, and revocation state.

### 3. Make scanning incremental

Reuse fingerprints for unchanged files, persist a resumable scan cursor, and define how interrupted or moved files are re-associated. Cooperative cancellation and partial results already work; process-termination resume does not.

### 4. Productionize GLB component matching

Store stable node/primitive fingerprints and real mesh-registration results so curated showcase relationships can be replaced by evidence generated from arbitrary projects.

### 5. Add workflow integration

The CLI/CI gate now blocks unresolved releases with machine-readable reports. Build one editor adapter first—Unity or Godot—that opens the exact local finding from a failed build.

### 6. Add collaboration carefully

Assignments, review comments, decision history, and team identities are useful. Raw creative files should remain local unless a team explicitly chooses otherwise.

### 7. Add standards interoperability

Import existing C2PA Content Credentials where present and consider exporting compatible provenance for supported formats. Keep CreatorFlow’s project-level release manifest separate from asset-embedded credentials.

## Metrics that would make the project stronger

- Time from scan completion to resolved release.
- Percentage of assets with a source and license record.
- Number of renamed/modified files reconnected to an existing receipt.
- False-positive review rate by fingerprint method.
- Registry lookup latency without uploading original assets.
- Manifest reproducibility across machines.
- Accessibility results and keyboard task-completion rate.

## Honest boundaries

Do not claim:

- That CreatorFlow proves copyright ownership.
- That a perceptual match is necessarily infringement.
- That the React sample currently scans arbitrary local projects.
- That exported JSON is cryptographically signed.
- That a public registry is abuse-resistant before disputes, moderation, revocation, and rate limits exist.

Those limits make the project sound more mature, not less. They show you understand the difference between a convincing demo and a trustworthy system.
