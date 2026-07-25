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

## Done — Phase A: real ownership verification (2026-07-24)

The feasibility spike passed — Roblox Open Cloud `GetAsset` returns
creator/type/moderation for assets the key owner does *not* own, so cross-creator
verification is real (contract note:
[`superpowers/plans/2026-07-23-phaseA-task0-spike-note.md`](superpowers/plans/2026-07-23-phaseA-task0-spike-note.md)).
Shipped across the plan's tasks:

- Pure `OwnershipOutcome` evaluator + `OwnershipEvidence` value type (creator vs
  owner vs group-membership → MATCH / MISMATCH / UNVERIFIABLE).
- Opt-in Open Cloud key store, **DPAPI-encrypted at rest on Windows** (plaintext
  fallback elsewhere, labelled honestly) + a Settings card with a
  Test-connection probe.
- `OpenCloudClient` (the only component that calls Roblox) + `OwnershipVerifier`
  orchestration; an insert-only `V010` ledger + repository; a single bridge
  verify route (the only live-call site) with history.
- Optional additive `ownership` on the manifest AssetEntry (schema stays v0.2),
  the classifier reading it in lockstep (Java + TS), deterministic stamping into
  the export, and a gate rule that treats a mismatch-without-decision as a review
  lead (never an auto-block).
- Frontend verify action with an honest verdict (VERIFIED facts / non-accusatory
  mismatch lead / NOT_VERIFIED) and a point-in-time `checkedAt` stamp.

**Honesty ceiling (locked):** `VERIFIED` = the facts were obtained, never "the
team has the right to use this"; a mismatch is a review lead, never an accusation
or auto-block; generic scanned files with only a `sha256`/path have no Roblox id
and stay `NOT_VERIFIED`; export never calls the network. Completes redirect
milestone item 6.

## The gate before more building: validate

The redirect's own final instruction is to **validate with a real Roblox dev
before expanding the roadmap** — the friend test in [`FRIEND-TEST.md`](FRIEND-TEST.md).
Track A (solo, offline) can be run today. What a real user trips on reorders
everything below.

## Next phases

Ordered from "completes the core" to "expands scope". Phase A (below) shipped
2026-07-24 ahead of the friend test — it *finished* a promise the tool already
made rather than adding new scope; the friend test now exercises it.

### Phase A — Real ownership & permission verification  ✓ shipped 2026-07-24
Turned the always-`NOT_VERIFIED` ownership evidence into *verified where Roblox's
Open Cloud API allows*: confirms an animation's creator and the target
experience's owner, and whether they match. What Open Cloud genuinely exposes to
a third party set the ceiling (creator/owner/group = yes; a direct "can X publish
to Y" check = no; anything above the ceiling stays NOT_VERIFIED). Details under
[Done — Phase A](#done--phase-a-real-ownership-verification-2026-07-24). Plan:
[`superpowers/plans/2026-07-17-phaseA-ownership-verification.md`](superpowers/plans/2026-07-17-phaseA-ownership-verification.md).

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
