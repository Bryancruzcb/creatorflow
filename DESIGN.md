# DESIGN.md: CreatorFlow

The UI style file. Read it before any UI work in `frontend/`.

## The look in one sentence
A dark survey desk: warm graphite surfaces, IBM Plex, one muted steel blue, and CreatorFlow's own
topographic contours as the canvas, with the release drawn as a route across them (the one playful
moment per screen).

## References
- CreatorFlow's own design (kept as it was): graphite oklch tokens, IBM Plex Sans + Mono, steel
  blue, rust / amber / sage status with an icon and a word, contour lines, the `[+]` bracket glyph,
  hairlines over shadows.
- Khan Academy's progress path (`khan-classroom`): progress drawn as a line with station nodes and a
  "You are here" marker. The landing page's release route takes this.
- Readwise Reader's feature cards (`readwise-features`): rich dark cards that open with an artwork
  band, then the words. Each station card on the landing page takes this.

## Colors
Dark only, on purpose (`color-scheme: dark`). There is no light mode and no theme toggle. The
tokens live in `frontend/src/styles/01-base.css`; this table is a summary.

| Token | Dark | Used for |
|---|---|---|
| `--desk` | `oklch(18.02% 0.0043 128.73)` | page background |
| `--graphite` | `oklch(21.55% 0.0059 121.94)` | cards, panels |
| `--raised` / `--raised-strong` | `oklch(25.36% …)` / `oklch(28.4% …)` | hover rows, open details, nested surfaces |
| `--hairline` / `--hairline-strong` | `oklch(32.59% …)` / `oklch(41% …)` | dividers, borders, control outlines |
| `--ink` | `oklch(95.42% 0.008 98.88)` | body text |
| `--ink-muted` | `oklch(72.36% 0.0114 100.89)` | secondary text, mono labels |
| `--ink-dim` | `oklch(66% 0.0105 102)` | tertiary text (still 4.5:1 on every surface) |
| `--blue-solid` (+ `-hover`, `-down`) | `oklch(48% 0.0627 249.71)` | filled buttons that carry `--ink` text |
| `--blue-accent` | `oklch(67% 0.069 249.71)` | links, marks, the walked part of the route |
| `--focus` | `oklch(72% 0.11 249.71)` | focus ring |
| `--clear` (success) | `oklch(70% 0.058 151.39)` | approved, done |
| `--review` (warning) | `oklch(71.3% 0.1172 80.74)` | needs review |
| `--blocked` (danger) | `oklch(65% 0.14 33.83)` | blocked, errors |
| info | `--blue-accent` | neutral notices |
| `--contour` / `--contour-major` | `oklch(27.5% 0.008 116)` / `oklch(33% 0.011 113)` | contour lines (decoration only, never text) |
| `--blocked-tint` / `--review-tint` / `--clear-tint` | `oklch(27% …)` | tinted tally squares behind a status icon (never behind text) |

## Type
- Text: IBM Plex Sans 400 / 500 / 600. Labels, IDs, hashes, file names and numbers: IBM Plex Mono
  400 / 500. Both are self-hosted through `@fontsource` (the desktop bridge's CSP allows
  `font-src 'self'` only, so never a font CDN).
- Body: 15px, line height 1.55.
- Scale, six sizes: **12 / 13 / 15 / 18 / 28 / 44**. Tokens: `--text-2xs` 12, `--text-xs` 13,
  `--text-sm` / `--text-md` 15, `--text-lg` 18, `--text-xl` / `--text-2xl` 28, `--text-display` 44.
  `--text-3xs` is kept as a name but equals 12: nothing renders under 12px.
- Small uppercase mono labels: 12px, `letter-spacing: 0.14em` (`--track-label`).
- Numbers that line up: `font-variant-numeric: tabular-nums`.

## Spacing and shape
- Spacing steps: 4 / 8 / 12 / 16 / 24 / 32 / 48 (`--space-*`).
- Radius: 4px for buttons and inputs (the app's existing `.button`), 8px for tiles and thumbnails,
  16px for the landing page's station cards, 999px for pills.
- Shadows: none on cards. Hairline borders do the separating. `--depth-*` only for things that
  float (menus, dialogs).

## Components
- React + plain CSS (no component library). Reuse what exists before adding: `BrandMark`,
  `StatusMark`, `AssetArtwork`, `MatchWorkbench`, `.button` / `.button-primary` /
  `.button-secondary`.
- Buttons: primary = filled `--blue-solid`; secondary = graphite with a `--hairline-strong`
  outline; a locked action is a dashed outline with `aria-disabled` and its reason beside it.
- Status: always an icon plus a word (`Blocked`, `Needs review`, `Approved`, `Excluded`).
- Cards: no cards inside cards. A card opens with its artwork band, then a mono station label, a
  heading, and a status on the right.
- Landing page: `components/ReleaseRoute.tsx`. The counting rules and station states are pure
  functions in `src/releaseRoute.ts`, the contours and the route path in `src/routeGeometry.ts`.

## Motion
- Library: framer-motion, already in the app. 150–300 ms, ease-out.
- At most 1–2 animated things per screen. On the landing page that is the opening file detail.
- Always respect `prefers-reduced-motion`.

## Icons and art
- Small UI icons: Lucide (`lucide-react`) only. No emoji.
- Art is real product material: the topographic contours (inline SVG traced from a height field),
  the real 3D previews in `public/assets/*-source.jpg`, and the live RobotExpressive rig.

## Rules (every screen, always)
1. Skeleton loaders that match the final layout for anything that loads data (no layout shift). Skip them for near-instant loads.
2. Semantic colors (success, warning, danger, info) from the table above. Never use color as the only signal; pair it with an icon or text.
3. No clutter: no subtitle that restates a heading, no redundant helper text, no decorative dividers, no duplicate labels. If it isn't useful, remove it.
4. Accessibility, WCAG 2.2 AA: 4.5:1 text contrast (3:1 for large text and controls), full keyboard navigation with visible focus, a label on every input, aria-labels on icon-only buttons, alt text on meaningful images, semantic HTML, targets at least 24×24px, prefers-reduced-motion respected.
