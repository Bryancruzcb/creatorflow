# CreatorFlow next improvements

## Current product boundary

The browser workspace now demonstrates asset investigation convincingly, but its project workflow is still driven by deterministic sample state. The GLBs, decoded-size calculation, live frame pacing, CPU submit time, render submissions, resource counts, and detected WebGL limits are real. GLB component matches are curated in `heavyAssets.ts`, the normalized heatmap is a main-thread nearest-vertex approximation, and the browser does not yet call the Java scanner or persist human decisions. WebGL does not expose actual allocated, free, or total VRAM, so memory must remain explicitly labeled as an estimate.

The next work should move the project from a polished prototype to a real local vertical slice.

## P0 — Stabilize the investigation workbench

**Target: 3–7 days**

1. Add screenshot regression tests for viewer overlays at wide desktop, narrow split-pane, tablet, and phone sizes.
2. Add React component tests for comparison modes, confidence filtering, queue navigation, routing, loading, and error recovery.
3. Add axe accessibility checks and a keyboard-only end-to-end test.
4. Break `HeavyAssetViewer.tsx` into renderer lifecycle, asset loader, scene index, comparison renderer, heatmap worker, budget estimator, and overlay components.
5. Split the global stylesheet into tokens plus feature-scoped styles.
6. Add ESLint, formatting enforcement, and CI checks.
7. Remove obsolete or duplicate viewer files and audit unused components.

**Acceptance:** every viewer mode has a deterministic screenshot at several container widths, and an overlay collision fails CI.

## P0.5 — Import real scanner evidence without inventing fields

**Target: 3–5 days**

1. Add a read-only `Imported manifest` dataset to Evidence beside the current `Sample project` dataset.
2. Validate `creatorflow.manifest/v0.1` with the checked-in JSON Schema plus semantic count and unique-path checks.
3. Render the manifest in its native shape: project, release, generated time, paths, sizes, hashes, fingerprints, findings, matches, source state, and decisions.
4. Do not invent previews, owners, similarity percentages, visual differences, or browser asset URLs that the manifest does not contain.
5. Add search, filters, pagination, import warnings, replace/clear actions, and an explicit “read-only snapshot; asset payloads were not imported” disclosure.
6. Keep the previous valid dataset active when a replacement import fails and cap initial imports at 25 MB.

**Acceptance:** run the existing Java CLI on an arbitrary folder, import its JSON, and inspect every real asset and finding in the browser with no sample fields mixed into the result.

## P1 — Build one real local project flow

**Target: 3–5 weeks**

1. Add a desktop folder picker with exclusions, privacy summary, estimated scan scope, and permission errors.
2. Wrap the Java core in a typed local bridge rather than rebuilding the workspace in JavaFX.
3. Stream typed scan events: discovered files, bytes processed, current format, warnings, cancellation, failure, and completion.
4. Persist projects, scan runs, findings, sources, decisions, and releases in SQLite with migrations.
5. Restore the exact open asset, selected component, comparison mode, queue position, and unresolved decision after restart.
6. Replace manual hash parsing with a versioned, validated route schema.
7. Add explicit sample-project and real-project entry points.

**Acceptance:** select a previously unseen project, scan it, stop and resume, close the app, reopen it, and return to the same finding without uploading creative files.

## P1 — Complete the human decision workflow

**Target: 1–2 weeks alongside the vertical slice**

1. Support approve, block, exclude, request evidence, and mark-owned decisions.
2. Require a reason and attach license, source, receipt, credit, or ownership evidence.
3. Record actor, timestamp, finding version, decision history, undo, and stale-decision warnings.
4. Explain every confidence score with method, threshold, visible evidence, and limitations.
5. Add complete corrupt-file, missing-texture, insufficient-memory, disconnected-drive, registry-offline, and cancelled-scan recovery states.

## P2 — Replace curated GLB matches with real 3D analysis

**Target: 5–8 weeks**

1. Implement a typed GLB analyzer in the Java core: stable component paths, buffer hashes, topology fingerprints, material hashes, texture hashes, and dependency records.
2. Detect exact instances first, then canonicalized geometry and appearance relationships.
3. Move heatmap computation into a cancellable Web Worker with progress reporting and cached results.
4. Register components with PCA or landmarks and ICP where appropriate.
5. Replace nearest-vertex visualization with bidirectional point-to-triangle surface distance using a BVH or k-d tree.
6. Persist method version, registration confidence, error bounds, and the transform used for comparison.
7. Build a labeled ground-truth corpus and report precision/recall instead of validating only hand-selected examples.

**Acceptance:** the engine discovers the current chess and ship relationships without `heavyAssets.ts` match definitions and produces reproducible metrics on a labeled corpus.

## P2 — Performance, cancellation, and resource ownership

**Target: 2–4 weeks**

1. Add abortable GLB and comparison-source loading.
2. Prevent stale loader and worker callbacks from mutating a newer investigation.
3. Enforce decoded-memory ceilings and evict cached scenes predictably.
4. Recover from WebGL context loss and low-memory failures.
5. Add incremental scanning keyed by path, size, modification time, and content hash.
6. Add CI performance fixtures for 10k nodes, 1M+ triangles, 100 MB GLBs, 50k project files, scan throughput, and memory recovery.

## P3 — Make releases operational

**Target: 2–4 weeks after persistence**

1. Replace the current download screen with release diffs: added, changed, removed, unresolved, and approved assets.
2. Generate manifests from persisted findings and decisions rather than browser fixture state.
3. Re-import and verify exported manifests.
4. Add a CLI policy gate with machine-readable output and nonzero exit status.
5. Run that gate in GitHub Actions.
6. Defer signing until canonical serialization, key storage, rotation, verification, and failure behavior are designed and tested.

## P3 — Registry and team architecture

1. Replace linear registry scans with indexed exact hashes, perceptual-fingerprint indexes, and an ANN index only when richer embeddings exist.
2. Add an offline-first outbox, idempotent registration, retry/backoff, and visible degraded mode.
3. Sync fingerprints, sources, and decisions independently from creative payloads.
4. Add loopback authentication, strict origin validation, symlink/path traversal policies, encrypted credentials, and packaged-app signing.

## Explicitly defer

- More sample assets.
- More comparison display modes.
- AI-generated explanations.
- Gallery or discovery features.
- Manifest signing.
- Hosted collaboration features.

Do not prioritize these until the real local-project acceptance test passes.
