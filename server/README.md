# server/ — FROZEN LEGACY (community gallery + originality registry)

**Status: frozen as of the 2026-07-17 strategic redirect. Kept green, no new feature work.**

This Spring Boot module is the pre-redirect **community-gallery / originality-registry** product
(gallery, accounts, uploads, `/api/v1` verify/register/mappings, disputes, rate limiting). It is
real, tested, and still builds, but it is **not** part of the current product — a local-first
Roblox release-preflight tool (see the repo [`README.md`](../README.md) and
[`docs/STRATEGIC-REDIRECT.md`](../docs/STRATEGIC-REDIRECT.md)).

Facts for anyone touching this tree:

- The **release-preflight flow does not call this server.** The React frontend talks only to the
  desktop `127.0.0.1` bridge (no CORS anywhere); the only live wiring from the app is the opt-in
  "Community registry" card in the desktop `SettingsPage` → `HttpRegistryClient` → `AssetImporter`.
  Severing that one card fully disconnects the server with no impact on preflight.
- Kept as a **candidate to later repurpose** as a shared cross-team provenance registry. Until a
  real need is validated, invest nothing here beyond keeping CI green.
- Do not build new gallery/marketplace/dispute features against the redirect; that scope is
  deferred. If you must change this module, keep the existing tests
  (`RegistryApiTest`, `GalleryWebTest`, `MappingApiTest`, `RateLimiterTest`, `VersionReviewTest`)
  green.
