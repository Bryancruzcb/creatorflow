# Studio session runbook

Everything in this repo that is blocked on a live Roblox Studio session under your own
account, in one sitting and in dependency order. Rough total: 45–60 minutes. Keep a note
open — each block says exactly what to write down. Written 2026-08-03; every quoted
message was checked against the code it comes from.

## 0. Prep (~10 min, before opening Studio)

The PR #119 checklist must run against the PR #119 build — the bridge plugin, desktop
(Java V014), and frontend all changed on that branch.

1. Get a checkout of branch `claude/phaseC-curve-animation-support`. If you don't have one:
   `git -C C:/Users/isdis/git/creatorflow worktree add ../creatorflow-pr119 origin/claude/phaseC-curve-animation-support`
   (remove it afterwards with `git worktree remove ../creatorflow-pr119`).
2. From that checkout, build and run the desktop with its workspace. `JAVA_HOME` must
   point at a JDK 24+ — check with `mvn -version`, not `java -version` (see
   `docs/HANDOFF.md`):

   ```bash
   npm --prefix frontend ci
   npm --prefix frontend run build
   mvn -pl desktop javafx:run -Dcreatorflow.web.root=<checkout>/frontend/dist -Dcreatorflow.web.open=true
   ```

3. Open (or create) a project in the desktop app — the bridge pairs per project.
4. Install or update the bridge plugin **to the branch version**: copy the checkout's
   `roblox-plugin/desktop-bridge/CreatorFlowAnimationBridge.lua` into the installed plugin
   under `PluginDebugService` → **Save and Reload Plugin** (first-time install: *Install
   locally* in `roblox-plugin/desktop-bridge/README.md`).
5. Pair: copy the loopback URL + pairing token from the desktop's Motion workspace, click
   the **CreatorFlow** toolbar button in Studio, paste both, **Test connection**. Pass:
   "Connected to CreatorFlow".

## 1. Rig IDs for the playability probe (~5 min)

Full detail and evidence: *Stock rig asset IDs for the playability probe* in
`roblox-plugin/desktop-bridge/README.md`. Short version:

1. In the Command Bar, run that section's one-line `LoadAsset` test on the two public
   candidates (R15 `5421500442`, R6 `11025556170`). Research says they will probably fail
   with HTTP 403 (plugin/command-bar `LoadAsset` on unowned free models); if one passes
   and prints the right `RigType`, you may use it.
2. Otherwise (~3 min): rig tool (Avatar/Home tab) → insert one R6 and one R15 rig →
   right-click each in Explorer → **Save to Roblox…** → **Model**. Re-run the test line on
   your own two IDs — each must print the rig name and the matching
   `Enum.HumanoidRigType`.
3. Edit `RIG_ASSET_IDS` in the installed plugin source (branch copy: lines 137–138) to the
   confirmed IDs → **Save and Reload Plugin**.
4. **Write down both IDs.** They still need a follow-up commit into `main`'s
   `CreatorFlowAnimationBridge.lua` lines 133–134.

Leave the two rigs in the workspace — block 2 animates the R15 one. After any Compare in
block 2, the R6/R15 rows in the desktop's Animation Snapshots panel should now read
**Plays clean** (or a real error) instead of **Not checked**; if they still say
**Not checked**, an ID is wrong.

## 2. PR #119 live checklist (~25 min)

### 2a. Author the test clips (~10 min)

On the R15 rig: **Avatar tab → Animation Editor**.

1. Make a short animation — 2–3 keyframes on at least two joints, 2–3 s long.
2. Publish it ("…" menu → **Publish to Roblox**, choose **Create New**). Note the numeric
   id → call it **K** (keyframe clip).
3. Click the **Curve Editor** icon at the top-left of the editor timeline. Studio warns
   the clip converts to a `CurveAnimation` — accept.
4. Publish again **as a new asset** (Create New, do not overwrite K). Note the id → **C**.
   Roblox's curve-editor doc says the clip is now a `CurveAnimation`; whether the
   *published asset* reads back as one is exactly what 2b/2c observe — if the sampled
   wording never appears, write that down, it means the publish produced keyframes.
5. One deliberately-too-long clip: new animation on the same rig, one joint, keys at 0 s
   and ~101 s, convert to curves, publish → **L**. If Roblox refuses to publish something
   that long, write that down and skip 2d (the client-side check then remains covered by
   automated tests only).

### 2b. Compare C vs C — sampled-exactness wording

Pass: the plugin status ends with exactly
"Exact match of curve-sampled data (20/s), not an authored-keyframe read."
Fail: the plain "Exact normalized data." wording, or any error. Write down the wording you
actually saw.

### 2c. Compare K vs C — the live curve compare and the joint-path unknown

One comparison covers the checklist's first two items. Pass is all of:

- Compare completes with no red error in the plugin status.
- Desktop → Animation Snapshots panel: the C side is labeled
  "Sampled from a curve — not an exact read." with its Pin buttons enabled. That label
  only renders when the request's kind field arrived server-side, so seeing it is also the
  wire-format check.
- The joint-score list shows the rig's actual joints and coverage is not near zero. This
  is the session's real unknown: nobody has yet confirmed that an *authored* curve clip's
  Folder tree yields the same joint paths as the same rig's `KeyframeSequence`. Near-zero
  common joints means the paths do not match — that is a finding to report, not a botched
  run.
- The score is high. (The automated analog — 5 authored keyframes vs a 20 Hz resample
  through the real engine — pins ~99.5 overall in CI; your number will differ, "high" is
  the expectation, not a promise.)

Fail signatures: "…has no position/rotation curve channels CreatorFlow can compare." on C
(curve tree not recognized at all); near-zero coverage (path mismatch); any uncaught
error. Write down: K, C, overall score, coverage, whether the sampled label showed, any
error text verbatim.

### 2d. Compare L vs K — too-long refusal

Pass: fails fast, before anything is sent, with exactly
"Animation `<L>` is too long to sample at 20/s: `<N>` keyframes exceeds the limit of 2000.
Curve clips up to ~100 s are supported." (N ≈ 2021 for a 101-s clip.)
Fail: any other error, or the request going through.

### 2e. Optional while you're here (~2 min)

`docs/HANDOFF.md` gap #2 has never been done: Compare once against a deleted or private
animation id and write down Roblox's exact error copy.

## 3. Toolbar icon upload (~5 min, browser + one edit — Studio not required)

Follow *Toolbar icon* in `roblox-plugin/README.md`: upload
`roblox-plugin/assets/toolbar-icon.png` (already drawn and committed) at
create.roblox.com → Development Items → Images, then paste the returned id into
`roblox-plugin/src/Main.server.luau` line 26.

## 4. After the session — bring back

- The two rig IDs → commit into `main`'s `CreatorFlowAnimationBridge.lua` lines 133–134.
- The icon image id → commit into `Main.server.luau` line 26.
- The 2b/2c/2d results → tick the matching boxes in the PR branch's bridge README manual
  checklist and/or paste your notes on PR #119, then do your normal review/merge pass.
- Anything that failed, verbatim — a failure here is exactly what the checklist exists to
  catch.

## Deliberately not in this session

- The friend test (`docs/FRIEND-TEST.md`) — needs your friend present, not just you.
- Bridge restart / token rotation / 2 MiB boundary checks (HANDOFF gap #3) — part of that
  same friend-test checklist.
