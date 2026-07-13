# Fable handoff — CreatorFlow Roblox direction

Updated July 13, 2026. Working branch: `codex/roblox-motion-handoff`.

## Where the project lives

- Repository: `/Users/bryancruz/Documents/Codex/2026-07-11/files-mentioned-by-the-user-screenshot/work/creatorflow-current`
- React/Vite product UI: `frontend/`
- Java motion engine: `core/src/main/java/creatorflow/motion/`
- Desktop loopback bridge: `desktop/src/main/java/creatorflow/bridge/`
- Desktop animation evidence persistence: `desktop/src/main/java/creatorflow/db/AnimationComparisonRepository.java`
- Local desktop-pairing Studio plugin: `roblox-plugin/desktop-bridge/`
- Roblox workflow research: `docs/ROBLOX_WORKFLOW_RESEARCH.md`

The previous running UI came from a non-Git output directory. Its maintainable source has now been mirrored into `frontend/`; do future UI work there.

## Start and verify

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

Open `http://127.0.0.1:5173`. Full frontend verification:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Java verification:

```bash
mvn test
```

Last clean-checkout verification on July 13, 2026: 22 frontend tests passed, frontend typecheck and production build passed, and all 87 Java tests passed across core, desktop, and server.

Run the desktop shell against the built frontend:

```bash
npm --prefix frontend run build
mvn -pl desktop javafx:run \
  -Djavafx.options="-Dcreatorflow.web.root=$(pwd)/frontend/dist -Dcreatorflow.web.open=true"
```

## What this branch contains

- The complete React product workspace is now versioned under `frontend/` rather than living only in an output folder.
- The Motion Lab compares motion shape, authored timing, loop seams, and root translation across fourteen licensed fixture clips.
- Full/Upper/Lower/Root now changes both the analytical scope and a visible skeleton focus. In Root Path, the score remains correctly locked to root translation while all four buttons remain available as preview focus.
- Pose comparison is now a bright, depth-visible wireframe. A one-shot previous pose clamps at the clip start instead of wrapping to the clip end. Loop mode explicitly labels solid as end/current and wireframe as start.
- The Java core recanonicalizes bounded normalized animation input and computes exact curve fingerprints plus pose/timing/coverage evidence.
- The desktop bridge creates short-lived project-scoped pairings and persists comparison records without retaining raw joint curves.
- The source-first Studio desktop bridge reads two permitted Animation IDs and rejects non-loopback endpoints.
- Research and a Roblox-first build order are documented in `docs/ROBLOX_WORKFLOW_RESEARCH.md`.

## Important product semantics

- **Pair side / Pair overlay** means reference clip versus candidate clip. It does not mean start pose versus end pose.
- **Previous-pose outline** shows the earlier pose for ordinary comparison modes.
- **Start-pose outline** pins the wireframe to time zero in Loop Seam while the solid rig is inspected at the end.
- **Root Path** measures only a root/body translation channel. Upper-body or lower-body root-path scores are not meaningful, so those buttons are visual focus only in this mode.
- Similarity is a review lead, never an authorship, copying, or copyright verdict.
- “Publish” in CreatorFlow currently means prepare and record a Roblox Studio handoff. It is not a direct Roblox upload.

## Two Studio-plugin paths

The repository now has two related but different Studio workflows:

1. `roblox-plugin/src/` is the Rojo-based registry plugin from upstream. It fingerprints a selected `KeyframeSequence`, talks to the CreatorFlow registry, and manages ownership-context Animation IDs.
2. `roblox-plugin/desktop-bridge/` is the source-first friend-test plugin for the local desktop evidence workflow. It reads two Animation IDs and posts normalized data to a short-lived `127.0.0.1` pairing.

Do not silently merge their network/auth contracts. A later unified plugin should present “Local preflight” and “Team registry” as explicit destinations with separate capability receipts.

## Large fixture policy

`frontend/` includes the lightweight licensed fixtures required by the Motion Lab and ordinary tests. The optional showcase GLBs and large audio/video/FBX stress files remain local because several are 10–102 MB each. Their metadata can render without the payload. Use Git LFS or release artifacts before distributing the complete asset pack; do not push the 100 MB+ files directly to GitHub.

## Known gaps before the friend test

1. Install the desktop-bridge plugin in Roblox Studio and run the manual checklist in `roblox-plugin/desktop-bridge/README.md` with two Animation IDs your friend can actually access.
2. Verify the `AnimationClipProvider:GetAnimationClipAsync()` behavior against the current Studio client and record the exact error copy for private, deleted, moderated, and wrong-owner assets.
3. Confirm the local bridge survives desktop restart, token rotation, Studio HTTP denial, and a request near the 2 MiB boundary.
4. Add `CurveAnimation` only after defining a deterministic curve-channel canonical format. The current friend-test plugin intentionally accepts `KeyframeSequence` only.
5. Add a published-ID runtime probe on R6/R15 before claiming that an animation will play correctly in the target experience.
6. Add an experience permission graph before claiming that an Animation ID is ready for both test and production.

## Best next build order

1. Complete one real Studio-to-desktop friend test and fix only blockers found there.
2. Add creator/group/experience ownership and permission context to each Animation ID.
3. Add last-known-good and last-published immutable animation snapshots.
4. Add a runtime probe for intended rig, priority, loop, markers, duration, and load errors.
5. Turn Release Flow into a Roblox checklist with version note, audience/eligibility, asset permission diff, rollback target, Studio publish confirmation, rollout, and smoke test.
6. Expand Stress Lab into a device evidence matrix and clearly distinguish modeled results from Studio and physical-device measurements.

## Working-tree caution

Several local files named `* 2.java` were present beside canonical Java files. They are byte-for-byte copies of the tracked originals and are intentionally ignored rather than committed. Do not delete them without confirming with the user, and do not add compiler exclusions merely to accommodate them in Git.
