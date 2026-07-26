/**
 * Resolves a path in `public/` against wherever this bundle is actually being served from.
 *
 * The same build has two homes: the desktop bridge serves it at the site root (`/`), and the
 * GitHub Pages project site serves it under `/<repo>/`. Vite rewrites the URLs of assets it
 * bundles, but it cannot rewrite a string literal like `'/assets/robot-expressive.glb'` — that
 * stays root-absolute and, under a subpath deploy, requests a file that is not there. The
 * symptom is not a build failure; it is a working page whose runtime fetches 404 (the motion lab
 * reporting "the motion fixture could not be decoded" while everything else looks fine).
 *
 * `import.meta.env.BASE_URL` is Vite's record of the configured base and always ends in `/`, so
 * every runtime reference to a public-directory file should go through here.
 */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}
