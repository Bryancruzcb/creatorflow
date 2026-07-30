# Explainer video: real UI footage — design

2026-07-29. Approved in session; supersedes the drawn-slide visuals of the current
`video/` explainer. The script, durations, and messaging rules survive; the pixels change.

## Goal

Recreate `video/out/creatorflow-explainer.mp4` so every scene shows the real frontend
(recorded from the running app), with the existing captions and messaging overlaid in
Remotion. No hand-drawn slide content remains, including the open and close scenes.

## What stays fixed

- The 6-scene structure, order, and per-scene durations from `video/README.md`
  (Open 8s, Scan 12s, Finding 17s, Evidence 18s, Manifest 15s, Close 8s).
- All four messaging rules: similarity is never called copying ("Similar is not
  stolen" closes scene 3); checked / declared / decided stay visually distinct;
  the manifest shows `open: 1`; the data-flow line stays hedged ("Files stay on
  your machine, fingerprints travel").
- Output artefacts: `out/creatorflow-explainer.mp4` and the GIF render, same
  resolution (1920×1080) and total length.

## Architecture

Two stages, run in order:

1. **Capture** (`video/capture/`, new): a Playwright script that boots the frontend
   the same way `frontend/playwright.config.ts` does (`npm run build && vite preview`,
   strict port), drives six scripted beats against the frontend's built-in fixture
   data, and records one clip per scene to `video/assets/captures/<scene>.mp4`
   at 1920×1080. No Java backend; the labs run on bundled fixtures.
   - Deterministic: every action waits on a UI state (locator visible/settled),
     never on wall-clock timers.
   - Each clip is recorded a few seconds longer than its scene so Remotion trims
     the tail rather than running out of frames.
   - The script asserts the expected UI state before recording each beat and fails
     loudly if the flow has drifted — a broken product flow must break the capture,
     not silently record the wrong thing.
   - `video/assets/captures/` is gitignored (same policy as `video/out/`).

2. **Render** (existing Remotion project): each scene component keeps its file,
   name, and duration, but its drawn internals are replaced by an
   `<OffthreadVideo>` of the matching clip with the existing caption primitives
   (`primitives.tsx`, `theme.ts`) overlaid. Captions sit on a scrim/dim so they
   stay readable over arbitrary UI pixels.

Pipeline: `npm run capture` → `npm run render` (and `render:gif`), documented in
`video/README.md`.

## Scene → footage map

| # | Scene | Footage | Overlay |
|---|---|---|---|
| 1 | Open | App landing state, slow push-in | Title text |
| 2 | Scan | Scan triggered on the fixture project, progress visible | Scan promise caption |
| 3 | Finding | Match card appears; cursor hovers the similarity evidence | Ends on "Similar is not stolen" at full contrast |
| 4 | Evidence | Checked / declared / decided panel in the dossier | Captions naming the three sources |
| 5 | Manifest | Manifest view with `open: 1` on screen | Artefact caption |
| 6 | Close | Manifest at rest | End text |

Exact beats (which lab, which clicks, which fixture asset) are finalized during
implementation against the real UI; the map above is the contract for what each
scene must show. If the UI cannot show a beat truthfully (e.g. no view exposes
`open: 1`), implementation stops and the gap is raised rather than faked.

## Verification

- Capture: per-beat state assertions (above); a capture run that completes is a
  claim the flow works.
- Render: check the output's duration matches the old video, then extract frames
  (one per scene) and inspect them — the built artefact is verified, not the
  source (repo rule: source-level green is not shipped green).
- Frontend is untouched; its test suites are not in scope.

## Isolation

All changes live under `video/` plus this spec. Work happens on
`video/real-footage-explainer` off up-to-date `main`; concurrent agents touching
`core/` or `frontend/` are unaffected. One PR when done, per repo convention.

## Out of scope

- Any frontend change (even styling for the camera).
- Re-scripting captions or durations.
- Sound.
