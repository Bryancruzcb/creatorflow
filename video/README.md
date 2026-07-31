# CreatorFlow explainer

Remotion source for the workflow video. Silent and text-driven — it is built to be read with the
sound off, which is how it will actually be watched.

```sh
npm install
npx playwright install chromium
npm run capture    # records real UI footage -> public/captures/ (needs frontend deps installed)
npm run studio     # live editor at localhost:3000
npm run render     # -> out/creatorflow-explainer.mp4
npm run render:gif
```

`npm run capture` builds and previews the real frontend, so it also needs that app's sample models
on disk. The five Khronos glTF-Sample-Assets CC0 sources — `avocado-source.glb`,
`boombox-source.glb`, `barramundi-source.glb`, `waterbottle-source.glb`, `lantern-source.glb` — are
gitignored, so a fresh clone has to download them into `frontend/public/assets/` and then run
`npm run assets:derive` in `frontend/` to build the matching derivatives. Skip that and the
workbench's 3D comparison falls back to "WebGL preview unavailable", which is what scene 3 will
record. `frontend/public/assets/ASSET-PROVENANCE.md` lists every upstream source and hash.

## The script

| # | scene | seconds | job |
|---|---|---|---|
| 1 | `Open` | 8 | The question a creator already has before publishing |
| 2 | `Scan` | 12 | What running it does, and the promise that makes it safe |
| 3 | `Finding` | 17 | A match arrives, drawn rather than asserted |
| 4 | `Evidence` | 18 | Checked vs declared vs your call |
| 5 | `Manifest` | 15 | The artefact you keep |
| 6 | `Close` | 8 | — |

Every scene plays real recorded UI behind its captions; `npm run capture` regenerates the footage
from the running frontend, and a capture that fails means the product flow it films has drifted.

Scenes 3 and 4 are deliberately the longest. They are the two that carry a claim, and a viewer
needs longer to read a caveat than a headline.

## Rules this follows

The video repeats the product's own constraints, because a video that overclaims is worse than a
product that does — it reaches more people and nobody can check it.

- **Similarity is never called copying.** Scene 3 ends on "Similar is not stolen" at full contrast,
  after the evidence rather than buried under it.
- **Checked, declared and decided stay separate.** Scene 4 draws them differently on purpose; the
  whole product turns on who said a thing.
- **The gate is filmed refusing to pass.** Scene 5 opens on "Release needs a decision", export
  greyed out and the blocked and needs-review counts on screen, and clears only once each one is
  recorded — the demo earns its export instead of starting green.
- **"Files stay on your machine, fingerprints travel."** Not "nothing leaves your machine" — the
  app hedges that line deliberately and so does this.

## Keeping it honest

Nothing on screen is a drawing of the product. All six scenes play Playwright recordings of the
built frontend — the landing page, then the sample preflight run end to end — so what a viewer
sees the app do is what the app does. `theme.ts` is the one copy left, the app's palette converted
from the oklch tokens in `frontend/src/styles/01-base.css`, because the captions are set over that
footage and have to belong to it. Copies drift; if the palette moves, this file moves with it.

The footage cannot go stale quietly. `capture/record.mjs` drives every beat through the product's
own selectors, so a flow that has moved fails the run rather than filming something else, and a
beat that comes up short is parked as `<scene>.rejected.webm` instead of replacing the scene's
clip. Either way the run aborts and `public/captures/` keeps its last good take. The moment this
video most needs to be true — a release that is not allowed to export yet — is filmed rather than
asserted: the blocked gate is on screen, in the product's own words, before the first decision is
recorded.
