# server/ — self-hosted team provenance store (repurposed by Phase E)

**Status: repurposed by owner decision of 2026-08-02.** The 2026-07-17 redirect froze this
module; Phase E unfreezes it for one purpose — it **will become a self-hosted store of team
provenance claims**, keyed by the motion curve fingerprint the desktop app already computes.
The plan is that it will answer exactly one question, 64-hex fingerprint equality within one
team, leaving it structurally incapable of emitting a verdict. None of that exists yet: PR-2
builds it. This PR only cleared the ground.

## What PR-1 did

- **Retired the gallery half.** Uploads, the public gallery, version stacks, comments,
  disputes, the Thymeleaf pages and their static assets, and web form-login are gone —
  no client in this repo called any of it, and keeping it would mean the "honest rebirth"
  still shipped a public copied/not-copied storefront.
- **Turned the legacy similarity judge off by default.** `POST /api/v1/verify`,
  `POST/GET /api/v1/assets*` and the mappings routes are now created only when
  `creatorflow.legacy-registry.enabled=true`. A fresh server serves no similarity judge at
  all; the beans do not exist.

Two clients still speak those routes, and both need the flag on:

1. The frozen Rojo plugin, `roblox-plugin/src/` — verify, register, list, and per-context
   id mappings.
2. The desktop app's opt-in "Community registry" card in `SettingsPage`, via
   `desktop/…/service/registry/HttpRegistryClient` — `/verify` and `/assets`.

**Watch the health check.** `HttpRegistryClient.health()` and the card's *Test connection*
button call `GET /api/v1/health`, which is **not** flag-gated. Against a default Phase E
server that button reports a healthy connection and then every actual registry call 404s.
A green Test connection does not mean the legacy routes are there — check the flag.

What remains on the default path: `POST /api/v1/accounts`, `GET /api/v1/health`, API-key
auth (`X-Api-Key`), and per-IP rate limiting. PR-2 adds teams and provenance claims.

## Fresh datasource

The H2 file moved to `~/.creatorflow-team/registry` (from `~/.creatorflow-server/registry`).
`spring.jpa.hibernate.ddl-auto=update` can add tables but never drops them, so pointing at
the old file would carry the deleted gallery/disputes tables forward forever. A new location
starts clean. An existing old database is left untouched on disk — nothing migrates it.

**Turning the flag on is not enough to see old data.** The routes come back, but they point
at the new, empty database: `/assets/mine` returns `[]`, `/verify` answers CLEAR against an
empty corpus, and any asset id a client cached before Phase E now 404s. To work against
pre-Phase-E registrations, point the datasource back at the old file as well:

```bash
java -jar server/target/creatorflow-server-*.jar \
  --creatorflow.legacy-registry.enabled=true \
  --spring.datasource.url='jdbc:h2:file:${user.home}/.creatorflow-server/registry;AUTO_SERVER=TRUE'
```

## Do not expose this to the internet

Run it on the studio's LAN or a member's box. There is no TLS, no proxy configuration, no
multi-tenancy, and account creation is open by default. It is built for a small trusted
network, and Phase E deliberately does not build hosting.

## Run it

```bash
java -jar server/target/creatorflow-server-*.jar
# legacy registry routes, for the Rojo plugin and the desktop Community registry card:
java -jar server/target/creatorflow-server-*.jar --creatorflow.legacy-registry.enabled=true
```

Tests: `RegistryApiTest` and `MappingApiTest` force the flag on and cover the legacy routes;
`LegacyRegistryDisabledTest` proves they are absent by default; `RateLimiterTest` and
`RateLimitFilterTest` cover throttling (including the #111 X-Forwarded-For fix). Keep all
of them green.
