# server/ — self-hosted team provenance store

**Status: repurposed and built, by owner decision of 2026-08-02.** The 2026-07-17 redirect froze
this module; Phase E unfroze it for one purpose. It is now a **self-hosted, append-only log of
team provenance claims**, keyed by the motion curve fingerprint the desktop app already computes
(`creatorflow.motion-fingerprint/v1`).

It answers exactly one question: **which members of one team recorded this exact 64-hex
fingerprint.** That is the whole read surface. There is no similarity code on the default path and
no score, distance, ranking or decision column anywhere in the schema — so this server is
*structurally* incapable of emitting a copied/not-copied verdict, not merely configured not to.

## What a claim is, and is not

A claim says: *this member ran CreatorFlow on a curve with this fingerprint, and chose to record
it.* Any member can claim any fingerprint, which is precisely why a claim can only ever be an
observation. Two members claiming the same fingerprint is not a conflict — it is the product
signal, and both rows are returned.

| VERIFIED (CreatorFlow computed it) | DECLARED (a person typed it, or their machine reported it) |
| --- | --- |
| `fingerprint`, `algorithm_version` | `clip_name`, `duration_seconds`, `roblox_asset_id`, `ownership_context` |
| `recorded_at` — this server's own clock, the ordering key | `declared_source`, `declared_license`, `declared_note` |
| | `observed_at` — the member's clock, display-only, so a backdated machine cannot manufacture "first" |

**Tripwire, recorded here on purpose:** if a later phase adds a "first" or "original" badge derived
from `recorded_at`, the honesty ceiling this design buys is gone and the store becomes an
accusation machine. The ordering key exists so the log has a clock it can trust, not so anyone can
win a race.

## API

Existing `/api/v1` + `ApiKeyInterceptor` (`X-Api-Key`); no new auth mechanism. **Non-membership
answers 404, never 403** (`MappingController.ownedAsset`'s policy), so team ids and fingerprints
cannot be probed.

| Endpoint | Does |
| --- | --- |
| `POST /accounts` | register a username, receive the API key. Gated by `X-Signup-Token` when `creatorflow.signup.token` is set |
| `GET /health` | liveness. **Not** gated by anything, including the legacy flag |
| `POST /teams` | create a team; the creator becomes its `OWNER` |
| `GET /teams` | the teams you belong to |
| `GET /teams/{id}/members` | members, ordered by username |
| `POST /teams/{id}/join-codes` | `OWNER` only. 128-bit base64url code, **returned exactly once**; only its SHA-256 is stored. Single-use, 24 h TTL |
| `POST /teams/join` `{code}` | redeem. Unknown, expired and already-used codes are one flat 404 — telling them apart would say whether a code ever existed |
| `DELETE /teams/{id}/members/{accountId}` | `OWNER` removes anyone, or anyone leaves. **The last `OWNER` cannot leave: 409** |
| `POST /teams/{id}/provenance-claims` | record an observation. Idempotent — see below |
| `GET /teams/{id}/provenance-claims?fingerprint=<64hex>` | the lookup. `?mine=true` for your own claims |
| `POST …/provenance-claims/{claimId}/retract` `{reason}` | author or `OWNER`. Removes it from future lookups |

**A departed member's claims stay in every lookup.** They are observations that were genuinely
made; deleting them on departure would rewrite the record.

**Retract is not a recall.** It removes a claim from every *future* lookup. It cannot retrieve a
copy a teammate already read — no server can — which is why nothing in this product's copy says
"unshares".

### Idempotency, and why there is no `UNIQUE` constraint

The share handler checks, inside the transaction, for an existing **non-retracted** row with the
same `(account, fingerprint, ownership_context)`. Found → `200` with the **stored** claim, plus
`declarationsDiffer` when the request's declared fields differ from it; none → `201`. Re-sharing
after a retract creates a new row.

There is deliberately no `UNIQUE(team, account, fingerprint, context)` backing this. H2 has no
partial unique indexes, so such a constraint would let a retracted tombstone occupy the key
forever — making retract-then-reshare, the only append-only-consistent way to correct a wrong
declaration, impossible. The cost is stated rather than hidden: a concurrent double-submit can
leave two rows, which render as two harmless independent observations.

### The lookup never filters by fingerprint version

`algorithm_version` is not a query parameter. Every non-retracted row for the fingerprint comes
back, whatever version produced it, and the **client** classifies each one — same version is a
match, another `creatorflow.motion-fingerprint/vN` is "recorded under a different fingerprint
version — not comparable", anything else is "unknown fingerprint format". Filtering here would
silently drop exactly the rows a person most needs shown.

The honest limit, since it is easy to expect more: the version string is hashed *inside* the
canonical form, so a v2 claim for the same clip carries a completely different fingerprint and
will never appear in a v1 lookup at all. After a fingerprint-version upgrade, members re-share to
be visible to new builds.

## The legacy similarity judge is off by default

`POST /api/v1/verify`, `POST/GET /api/v1/assets*` and the mappings routes are created only when
`creatorflow.legacy-registry.enabled=true`. A fresh server serves no verdict at all — the beans do
not exist. The flag exists for one reason: the frozen Rojo plugin (`roblox-plugin/src/`) still
calls those paths, and nothing should silently break a frozen contract.

The desktop app is no longer a client of them. Its "Community registry" settings card is gone,
replaced by the team provenance card, and the import flow no longer surfaces a community-registry
status line — a machine with a leftover `registry.properties` would otherwise have reported
"unreachable" on every import forever. The legacy client code remains in
`desktop/…/service/registry`, dormant and unwired.

**Watch the health check.** `GET /api/v1/health` is not flag-gated, so a green *Test connection*
says the server is up and nothing about whether the legacy routes are there. Check the flag.

## Optional signup token

```properties
creatorflow.signup.token=some-shared-secret
```

Blank by default, which keeps registration open — the posture a trusted LAN box has always had.
Set it and every new account must present the same value as an `X-Signup-Token` header, compared
in constant time.

**Interaction with the legacy flag, worth knowing before it bites:** the frozen Rojo plugin's own
account-creation call sends no such header. If you also run with
`creatorflow.legacy-registry.enabled=true`, create the plugin's accounts *before* setting the
token — or leave it unset on a network you already trust.

## Fresh datasource

The H2 file lives at `~/.creatorflow-team/registry` (moved from `~/.creatorflow-server/registry`).
`spring.jpa.hibernate.ddl-auto=update` can add tables but never drops them, so pointing at the old
file would carry the deleted gallery/disputes tables forward forever. An existing old database is
left untouched on disk — nothing migrates it.

**Turning the legacy flag on is not enough to see old data.** The routes come back, but they point
at the new, empty database: `/assets/mine` returns `[]`, `/verify` answers CLEAR against an empty
corpus, and any asset id a client cached before Phase E now 404s. To work against pre-Phase-E
registrations, point the datasource back at the old file as well:

```bash
java -jar server/target/creatorflow-server-*.jar \
  --creatorflow.legacy-registry.enabled=true \
  --spring.datasource.url='jdbc:h2:file:${user.home}/.creatorflow-server/registry;AUTO_SERVER=TRUE'
```

## Do not expose this to the internet

Run it on the studio's LAN or a member's box. There is no TLS, no proxy configuration, no
multi-tenancy, no federation and no hosting story, and Phase E deliberately does not build any.

One honest asymmetry, recorded rather than glossed: join codes are hashed at rest, but
`UserAccount.apiKey` sits in plaintext in the same H2 file — so hashing protects codes against a
database dump more than it protects the keys beside them. That is inherited from the existing
account model, not worsened here.

## Run it

```bash
java -jar server/target/creatorflow-server-*.jar
# or, from source:
mvn -B -pl server spring-boot:run

# with registration closed:
java -jar server/target/creatorflow-server-*.jar --creatorflow.signup.token=some-shared-secret

# with the legacy registry routes, for the frozen Rojo plugin:
java -jar server/target/creatorflow-server-*.jar --creatorflow.legacy-registry.enabled=true
```

Point the desktop app at it from **Settings → Team provenance store**: server URL → Create account
→ Test connection → Join team (paste a code) or Create team. A teammate needs nothing out-of-band
except the base URL, the signup token if you set one, and a join code.

Nothing a team store answers is cached on a desktop. Every lookup is live, and a store that cannot
be reached renders as *unknown* — never as "no one else has this."

## Tests

Keep all of these green:

- `TeamApiTest` — join codes are single-use and distinct; non-membership is 404 not 403; the last
  owner cannot leave; members sort by username.
- `ProvenanceClaimApiTest` — no verdict/score/rank field is ever emitted; re-share is idempotent
  and reports changed declarations instead of dropping them; retract removes a claim from future
  lookups and re-sharing afterwards creates a new row; the lookup does not filter by
  `algorithmVersion`; a departed member's claims remain.
- `SignupTokenTest` — the gate, on a context that sets the property. Every other suite leaves it
  unset, which is what proves the default is still open.
- `LegacyRegistryDisabledTest` — the legacy beans do not exist by default.
- `RegistryApiTest` / `MappingApiTest` — force the flag on and cover the legacy routes.
- `RateLimiterTest` / `RateLimitFilterTest` — throttling, including the #111 X-Forwarded-For fix.
