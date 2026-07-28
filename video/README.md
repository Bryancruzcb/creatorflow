# CreatorFlow explainer

Remotion source for the workflow video. Silent and text-driven — it is built to be read with the
sound off, which is how it will actually be watched.

```sh
npm install
npm run studio    # live editor at localhost:3000
npm run render    # -> out/creatorflow-explainer.mp4
npm run render:gif
```

## The script

| # | scene | seconds | job |
|---|---|---|---|
| 1 | `Open` | 8 | The question a creator already has before publishing |
| 2 | `Scan` | 12 | What running it does, and the promise that makes it safe |
| 3 | `Finding` | 17 | A match arrives, drawn rather than asserted |
| 4 | `Evidence` | 18 | Checked vs declared vs your call |
| 5 | `Manifest` | 15 | The artefact you keep |
| 6 | `Close` | 8 | — |

Scenes 3 and 4 are deliberately the longest. They are the two that carry a claim, and a viewer
needs longer to read a caveat than a headline.

## Rules this follows

The video repeats the product's own constraints, because a video that overclaims is worse than a
product that does — it reaches more people and nobody can check it.

- **Similarity is never called copying.** Scene 3 ends on "Similar is not stolen" at full contrast,
  after the evidence rather than buried under it.
- **Checked, declared and decided stay separate.** Scene 4 draws them differently on purpose; the
  whole product turns on who said a thing.
- **The manifest shows `open: 1`.** A sample that always passes is not a sample anyone should
  believe, and the fixture asset really is a locally edited derivative.
- **"Files stay on your machine, fingerprints travel."** Not "nothing leaves your machine" — the
  app hedges that line deliberately and so does this.

## Keeping it honest

`theme.ts` holds the app's palette converted from the oklch tokens in
`frontend/src/styles/01-base.css`. `Finding.tsx` holds real rotation curves read out of
`frontend/public/assets/robot-expressive.glb` — the same two the landing page draws.

Both are copies, and copies drift. If the palette or those curves change, they change here too.
That is the standing cost of recreating the UI instead of screen-recording it; the trade is that
nothing here can silently rot into showing a version of the product that no longer exists.
