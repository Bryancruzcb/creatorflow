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

## The validation gate is closed (2026-07-30)

The redirect's final instruction was to **validate with a real Roblox dev** —
the friend test in [`FRIEND-TEST.md`](FRIEND-TEST.md). Track A (solo, offline)
ran and passed on 2026-07-20. The live half was **cancelled permanently by the
project owner on 2026-07-30 and will not happen**. Live-Studio validation
happens as the owner's solo run or not at all.

That makes the old *(validation-gated)* labels dead: no phase can satisfy that
gate anymore. Phases proceed by explicit per-phase owner decision instead — as
Phase B (decision recorded 2026-07-31 in its design spec) and Phase C (separate
decision, 2026-08-01) already did.

## Next phases

Ordered from "completes the core" to "expands scope". Phase A (below) shipped
2026-07-24 ahead of the friend test — it *finished* a promise the tool already
made rather than adding new scope.

### Phase A — Real ownership & permission verification  ✓ shipped 2026-07-24
Turned the always-`NOT_VERIFIED` ownership evidence into *verified where Roblox's
Open Cloud API allows*: confirms an animation's creator and the target
experience's owner, and whether they match. What Open Cloud genuinely exposes to
a third party set the ceiling (creator/owner/group = yes; a direct "can X publish
to Y" check = no; anything above the ceiling stays NOT_VERIFIED). Details under
[Done — Phase A](#done--phase-a-real-ownership-verification-2026-07-24). Plan:
[`superpowers/plans/2026-07-17-phaseA-ownership-verification.md`](superpowers/plans/2026-07-17-phaseA-ownership-verification.md).

### Phase B — Runtime playability probe  ✓ shipped 2026-08-02 (#118)
Checks the animation actually plays on the target rig (R6/R15), respects
loop/priority/markers, and loads clean. One residual, owner-only: the
desktop-bridge plugin's `RIG_ASSET_IDS` R6/R15 entries are still `0`
placeholders — filling them needs a live Studio session (Rig Builder → copy
asset ID); until then the probe's standard-rig path no-ops gracefully. The
structural rig-compatibility follow-on (a rig-incompatible animation still
reports ok) is tracked in #122.

### Phase C — CurveAnimation support  *(in review — PR #119)*
The plugin reads only `KeyframeSequence` today; PR #119 adds curve-based
animations on a deterministic curve canonical format. Built by owner decision
(2026-08-01, recorded in its design spec); awaiting owner review plus the
owner's solo live-Studio checklist.

### Phase D — Team polish  *(next — owner decision 2026-08-02)*
What remains: batch decisions and a smoother BLOCKED-resolution flow. The other
two former scope items are already done — the `styles.css` monolith was split
into ordered slabs by #67 (2026-07-28; deeper per-rule consolidation is parked
in #120), and both held dependency majors
shipped: JavaFX 26 via #92 (2026-07-29) and Spring Boot 4 via #107
(2026-07-30).

### Phase E — Shared team provenance  *(approved to build — owner decision 2026-08-02)*
The honest rebirth of the old cloud registry: not a public "copied/not-copied"
judge, but a shared store so a team's members check provenance against each
other. The friend-test demand gate is closed (see above); the owner approved
building this phase on 2026-08-02. It is expected to explicitly repurpose the
frozen `server/` tree — the phase's design spec records that call.

## Standing constraints (every phase)

- Similarity/ownership signals are **review leads, never verdicts**; a match is
  not proof, a mismatch is not an accusation.
- **Precision over recall** — a false accusation is the worst possible output;
  when in doubt, under-flag.
- Unknown state is shown as **unknown**, never as verified.
- Manifest export stays **byte-deterministic**; live API calls never happen on export.
- The frozen `server/` and `roblox-plugin/src/` legacy trees stay frozen unless
  a phase explicitly repurposes them.
