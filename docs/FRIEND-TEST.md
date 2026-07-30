# Friend test — Roblox animation preflight, first real run

The single highest-value next step (see `ROBLOX_WORKFLOW_RESEARCH.md`, "Product
boundary for the friend test"): one animator pairs Roblox Studio to a local
CreatorFlow project, reads two animations they can actually access, compares
them, and saves the evidence. Fix only blockers found here before building more.

**Two parts.** Part 1 (below) is the original minimal pairing+compare loop — the
smoke test that the Studio bridge works at all. Part 2 is the **full
release-preflight walkthrough** added after the strategic-redirect increments
(intended-experience binding, evidence tri-state, PASS/BLOCKED release manifest,
rollback target, published-version handoff, pairing management). Run Part 1
first; if it's smooth, run Part 2 to validate the whole product against a real
release. Every step is tagged **[live-Studio]** (needs a signed-in Studio user +
real Animation IDs), **[offline]** (verifiable without Studio, on any machine), or
**[offline-ish]** (needs a Roblox Open Cloud API key + internet, but no Studio —
just the ownership-verification step).

## The one constraint people miss

The bridge is **loopback-only by design**: Roblox Studio and the CreatorFlow
desktop app must run on the **same machine**. So either install both on the
friend's machine, or run the session on yours with the friend signed into
Studio (the plugin can only read animations the signed-in Studio user has
access to — that's the point of the test).

## Setup (one time, ~10 minutes)

Requires **JDK 24 or newer**, Maven, Node 20+.

```bash
git clone https://github.com/Bryancruzcb/creatorflow.git && cd creatorflow
npm --prefix frontend ci && npm --prefix frontend run build
mvn install -DskipTests
```

(`-DskipTests` only because core's symlink test needs elevated privileges on
Windows; CI runs the full suite.)

## Run the desktop workspace

```bash
mvn -pl desktop javafx:run -Dcreatorflow.web.root=<ABSOLUTE-PATH>/frontend/dist -Dcreatorflow.web.open=true
```

The browser workspace opens on a `http://127.0.0.1:<port>` URL; the same URL is
also printed to the console (`CreatorFlow workspace: ...`) in case no browser
opens. Pick or create a local project, then create a **plugin pairing** — you'll
get the endpoint URL and an 8-hour token.

## Install the Studio plugin

Follow `roblox-plugin/desktop-bridge/README.md` (paste
`CreatorFlowAnimationBridge.lua` into a Script, right-click → **Save as Local
Plugin**). Enable *Plugin Debugging Enabled* — the README's update flow depends
on it even though it says optional.

In the plugin panel: paste the endpoint (either `127.0.0.1` or `localhost`
spelling works as of commit `1f138d1`) and the token, press **Test
connection**, and allow the HTTP-permission prompt Studio raises.

## Part 1 — the actual test (pair + compare)

1. **[live-Studio]** Enter two Animation IDs the signed-in user can access.
   Compare. Confirm the comparison lands in the desktop workspace's evidence
   history.
2. Now deliberately break things and **write down the exact error copy** — this
   is the data the next build step needs:
   - **[live-Studio]** an animation ID the user does NOT own (wrong owner / private)
   - **[live-Studio]** a deleted or moderated ID
   - **[live-Studio]** deny the HTTP permission prompt, then recover
   - **[offline]** restart the desktop app mid-session. **As of the pairing-
     lifecycle increment, pairings persist across a desktop restart** — so the
     SAME token must STILL work after relaunch (it's stored hashed in SQLite,
     valid until its 8-hour expiry). **The bridge port changes on every launch**,
     so after a restart paste the NEW endpoint URL into the plugin while keeping
     the same token. Then **revoke** the pairing from the Studio bridge panel and
     confirm the plugin's next request now fails with the pairing-required error.
     (This is the reverse of the old behavior, where a restart invalidated the
     token — verify the new persistence explicitly.)
   - **[live-Studio]** a very dense baked clip (the server caps at 2,000
     keyframes — the plugin does not pre-check this; note what the failure looks
     like)
3. Run the full manual checklist at the bottom of the plugin README.

## Part 2 — full release-preflight walkthrough

This validates the whole product: from binding an intended experience through a
deterministic PASS/BLOCKED release with a rollback target and a recorded
published version. Do it in order; capture results in the template at the end.

1. **Bind the intended experience [offline].** In the local project view, set
   the intended Roblox experience (universe ID + place ID + a name). Confirm it
   shows labeled as *declared by you, not verified* — CreatorFlow must NOT imply
   it checked ownership or access. Reload the app and confirm it persisted.
2. **Produce comparison evidence [live-Studio].** Run at least one animation
   comparison (Part 1), and pin a **last-known-good** snapshot for an animation
   so later drift has a baseline to compare against.
3. **Read the evidence tri-state [offline].** In the evidence view, confirm each
   facet shows a consistent basis badge: a computed comparison/fingerprint reads
   **VERIFIED ("computed by CreatorFlow")**; a source/license you typed reads
   **DECLARED**; and **ownership reads NOT_VERIFIED** — with an explicit row —
   until you run the verification in the next step. Sanity check the honesty:
   nothing labeled VERIFIED should imply originality or ownership.
4. **Verify ownership where possible [offline-ish — needs a key + internet, no
   Studio].** This step needs a Roblox Open Cloud API key and internet, but *not*
   Studio. In the desktop **Settings → Roblox Open Cloud** card, paste a
   user-scoped Open Cloud API key (asset + universe + group read) and press **Test
   connection** — confirm it reports the key accepted, and that the storage line
   reads *encrypted (Windows DPAPI)* on Windows (or *not encrypted on this OS*
   elsewhere). Then, on a file you know the Roblox animation id for, in a project
   with a bound experience (step 1), type that id into the ownership panel and
   press **Verify ownership**. Confirm exactly one of three honest outcomes:
   - **VERIFIED — creator matches the experience owner** (a MATCH): positive
     evidence, worded as *who created it / who owns the experience*, never "you
     have the right to use it";
   - **VERIFIED — review lead: creator is not the experience owner** (a MISMATCH):
     framed as a lead for a person to confirm the team has rights, never an
     accusation (the words "infringement"/"stolen" must not appear), prompting the
     required-reason decision flow;
   - **NOT_VERIFIED — could not verify** (UNVERIFIABLE): the lookup ran but could
     not obtain the facts — an unreadable/deleted id, an id that is not an
     Animation, or an Open Cloud/network error. An honest "could not check", never
     a false VERIFIED.
   Two of the failure paths record **nothing at all** — don't expect an
   UNVERIFIABLE row from either. With **no key configured** the Verify button is
   disabled with a clear reason pointing at the Settings card, so no call is made
   and nothing is stored. A **rate-limit (429)** shows a distinct "rate-limited,
   try again" message (with the wait when Roblox reports one); a throttle is not an
   observation about ownership, so the asset keeps exactly the ownership state it
   already had. Confirm the verdict shows the point-in-time facts (creator,
   experience owner, moderation) and a **checked today / N days ago** stamp. Then
   check the honesty boundaries: a file nobody has entered an id for stays
   **NOT_VERIFIED** with nothing to check. Most important — confirm the panel does
   **not** claim it verified
   *this file's* ownership: the **Animation ID you entered** row must read
   **DECLARED** next to the VERIFIED facts, and the panel must say in words that
   you entered the id and that CreatorFlow cannot check that this file is that
   animation. A verification is a point-in-time observation — CreatorFlow surfaces
   `checkedAt`; it does not expire or re-check.
5. **Record a provenance decision [offline].** For a flagged/similar asset, try
   to save a decision with an EMPTY reason — the control must stay disabled /
   reject it. Enter a reason, save, and confirm it appears in the append-only
   history (a later decision supersedes, never overwrites).
6. **Generate a release [offline].** Create a release. Confirm:
   - it produces a **PASS or BLOCKED** result with the blocking reasons listed
     (unresolved sources, undecided flags, blocked decisions);
   - the exported **manifest** carries the gate block, the evidenceBases, and the
     intended experience;
   - regenerating a release from the same scan yields a **byte-identical**
     manifest (determinism — diff the two downloads);
   - a PASS is never presented as an originality/copyright verdict.
7. **Verify the manifest with the gate CLI [offline].** Run `ReleaseGateCli`
   against the downloaded manifest and confirm its result matches what the UI
   showed. Then hand-edit the manifest's gate `result` to the opposite value and
   re-run — the CLI must exit non-zero on the tampered gate (integrity check).
8. **Rollback target [offline].** Create a second release for the same project.
   Confirm the newer release shows an explicit **rollback target** pointing at
   the prior release, with a link to that release's manifest, and wording that
   makes clear CreatorFlow does not perform the rollback (Studio does).
9. **Close the handoff loop [live-Studio for the number, offline to record].**
   Publish in Roblox Studio (that stays entirely in Studio — CreatorFlow never
   publishes). Take the Roblox place version you get back and record it on the
   release. Confirm it displays as *published as place version N (self-reported /
   not verified)*.
10. **Pairing management [offline].** In the Studio bridge panel, confirm you can
    list active/past pairings (id + issued/expires + status) with the token shown
    only once at creation, and revoke one — after which that token no longer
    authenticates.

## Capture template (paste into the results doc)

```
Env: [friend's machine / mine + friend signed in]  OS: ___  Date: ___
Part 1:
  pair + compare .......... pass/fail + notes
  wrong-owner error copy .. "____"
  deleted/moderated copy .. "____"
  perm-denied recovery .... pass/fail
  restart persistence ..... token still valid after restart? Y/N ; revoke kills it? Y/N
  >2000-keyframe failure .. "____"
Part 2:
  experience binding ...... persisted? Y/N ; labeled declared-not-verified? Y/N
  tri-state badges ........ VERIFIED/DECLARED/NOT_VERIFIED shown correctly? Y/N ; ownership NOT_VERIFIED before verify? Y/N
  ownership verify ........ key accepted? Y/N ; storage line: "encrypted (Windows DPAPI)" / "not encrypted on this OS"
                            outcome: MATCH/MISMATCH/UNVERIFIABLE ; checkedAt shown? Y/N
                            no-key disables button (and records nothing)? Y/N ; un-checked file stays NOT_VERIFIED? Y/N
                            entered-id row reads DECLARED, not VERIFIED? Y/N
                            mismatch worded as a lead, not an accusation? Y/N
  required-reason gate .... blocked on empty reason? Y/N
  release PASS/BLOCKED .... result + reasons: ____
  manifest determinism .... two exports byte-identical? Y/N
  gate CLI integrity ...... matches UI? Y/N ; tampered gate rejected? Y/N
  rollback target ......... shown + links prior manifest? Y/N
  published version ....... recorded + labeled self-reported? Y/N
  pairing list/revoke ..... list works? Y/N ; revoke invalidates token? Y/N
  anything they stumbled on: ____
```

## What "success" means

The friend can pair, compare, resolve findings, and produce a release they
understand — and every failure message is clear without help. A five-minute
small-project run should be achievable. Similarity is never presented as proof
of copying; unknown states are shown as unknown, never as verified — and where
ownership *can* be verified, VERIFIED means the creator/owner facts were
obtained, never that the team holds the right to ship the asset. Anything they
stumble on is the next work item — resist
adding features until this loop is smooth.
