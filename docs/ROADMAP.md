# CreatorFlow roadmap (post-redirect)

Product: a **local-first Roblox release-preflight tool for small teams** (see
[`STRATEGIC-REDIRECT.md`](STRATEGIC-REDIRECT.md)). This file is the forward plan
after the redirect's focused milestone shipped.

## Done — the release-preflight milestone (2026-07-17)

Issue #20, closed. Shipped as reviewed, merged PRs:

- Intended-experience binding (#22)
- Gate result embedded in the manifest, schema v0.2, deterministic export (#23)
- Unified evidence tri-state — VERIFIED / DECLARED / NOT_VERIFIED (#24)
- Rollback target + returned-place-version handoff (#25)
- Plugin pairing lifecycle — persist + list/revoke + hash-at-rest (#26)
- Real-path test coverage — bridge client, decision flow, restart round-trip (#27)
- Full validation runbook (#29)
- Loop/root scoring on the shared v2 kernel (#31)

Old motion-engine Phases 2 (public cloud registry) and 3 (mirror
normalization) are **superseded/deferred** by the redirect — see #15/#16/#17.

## The gate before more building: validate

The redirect's own final instruction is to **validate with a real Roblox dev
before expanding the roadmap** — the friend test in [`FRIEND-TEST.md`](FRIEND-TEST.md).
Track A (solo, offline) can be run today. What a real user trips on reorders
everything below.

## Next phases

Ordered from "completes the core" to "expands scope". Only Phase A is
recommended to build before the friend test — it *finishes* a promise the tool
already makes rather than adding new scope.

### Phase A — Real ownership & permission verification  ← planned, ready to build
Turn the always-`NOT_VERIFIED` ownership evidence into *verified where Roblox's
Open Cloud API allows*: confirm an animation's creator and the target
experience's owner, and whether they match. Completes redirect milestone item 6.
Plan: [`superpowers/plans/2026-07-17-phaseA-ownership-verification.md`](superpowers/plans/2026-07-17-phaseA-ownership-verification.md).
**Starts with a feasibility spike** — the feature's reach depends on what Open
Cloud genuinely exposes to a third party (creator/owner/group = yes; a direct
"can X publish to Y" check = no, must be inferred; anything above the API's
ceiling stays NOT_VERIFIED).

### Phase B — Runtime playability probe  *(validation-gated)*
Before "ready to ship", check the animation actually plays on the target rig
(R6/R15), respects loop/priority/markers, and loads clean. On-mission (release
confidence); needs deeper live-Studio integration.

### Phase C — CurveAnimation support  *(validation-gated)*
The plugin reads only `KeyframeSequence` today; add curve-based animations
(needs a deterministic curve canonical format first).

### Phase D — Team polish  *(validation-gated)*
Batch decisions, a smoother BLOCKED-resolution flow, the `styles.css` monolith
cleanup, and the held dependency majors (Spring Boot 4 #8, JavaFX 26 #11 — the
latter needs a desktop-launch verification pass).

### Phase E — Shared team provenance  *(only if validated)*
The honest rebirth of the old cloud registry: not a public "copied/not-copied"
judge, but a shared store so a team's members check provenance against each
other. Build only if the friend test proves real multi-user demand.

## Standing constraints (every phase)

- Similarity/ownership signals are **review leads, never verdicts**; a match is
  not proof, a mismatch is not an accusation.
- **Precision over recall** — a false accusation is the worst possible output;
  when in doubt, under-flag.
- Unknown state is shown as **unknown**, never as verified.
- Manifest export stays **byte-deterministic**; live API calls never happen on export.
- The frozen `server/` and `roblox-plugin/src/` legacy trees stay frozen unless
  a phase explicitly repurposes them.
