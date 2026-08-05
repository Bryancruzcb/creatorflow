# CreatorFlow Animation Bridge for Roblox Studio

This local Studio plugin reads two animation IDs that the signed-in creator is already allowed to access, normalizes their joint data, and sends one comparison request to the CreatorFlow desktop app on `127.0.0.1`.

It does **not** bypass Roblox asset permissions, download a place, or send the request to a hosted service. The first prototype is an evidence and similarity tool, not a plagiarism verdict.

## What the plugin captures

For each accessible animation clip, the plugin records:

- animation asset ID, clip name, duration, loop setting, and priority;
- keyframe times, ordered by time;
- each pose's stable hierarchy path, such as `HumanoidRootPart/LowerTorso/LeftUpperArm`;
- the pose's 12 rounded `CFrame` components, blend weight (`Pose.Weight`), easing style, and easing direction.

Floating-point values are checked for finiteness and rounded to six decimal places. Pose paths and keyframes are sorted before the JSON is created. The desktop app computes and stores the fingerprints and comparison; the plugin does not claim that similar motion proves copying.

### CurveAnimation clips

A `CurveAnimation` stores continuous channels instead of authored keyframes, so there is no keyframe list to read. The plugin samples it instead: 20 samples per second plus one at the exact clip end, evaluating each joint's `Position` and `Rotation` curves into the same 12-component `CFrame` a `KeyframeSequence` pose carries. Everything after that — fingerprints, joint scores, storage — treats a sampled clip like an authored one. Sampled poses carry fixed `weight = 1`, `Linear`, `InOut` values, because a curve channel has no authored blend weight or easing to read.

Sampling is a reconstruction, not an exact read, so every comparison records how each side was read. `sourceKind` and `candidateKind` are `KEYFRAME` or `CURVE_SAMPLED`, and that tag travels from the request body through the SQLite record and the view JSON into the desktop workspace, where the Animation Snapshots panel labels a sampled side “Sampled from a curve — not an exact read.”

Sampled sides can still be pinned as drift-detection snapshots. That was measured before it was allowed: a live-Studio spike on 2026-08-02 sampled the same clip twice, and again after a full register/refetch round trip, and every value came back bit-identical — so a sampled fingerprint does not wobble and cannot fake a “this animation changed” report. The decision stays reversible in one line: `CURVE_SAMPLED_SNAPSHOTS_ALLOWED` in the desktop app's `LocalBridgeServer.java`, mirrored by `CURVE_SAMPLED_PINNING_BLOCKED` in the workspace's `AnimationSnapshotsPanel.tsx`.

## Requirements

- Roblox Studio signed in as a creator who can access both animation assets.
- CreatorFlow desktop running with a project open.
- The CreatorFlow motion bridge URL and pairing token shown in the app.
- Permission for this plugin to contact the loopback address. Studio should prompt on the first request; plugin network permissions can be reviewed in **Manage Plugins**.

Roblox documents that Studio plugins may communicate with software on the same computer through `localhost` or `127.0.0.1`: <https://create.roblox.com/docs/cloud-services/http-service#use-in-plugins>

## Install locally (about two minutes)

This uses Roblox's documented source-first local plugin flow, so your friend can inspect exactly what is running.

1. Open Roblox Studio and a blank Baseplate.
2. Optional but useful for testing: open **Studio Settings → Studio** and enable **Plugin Debugging Enabled**.
3. In Explorer, insert a normal **Script** inside `ServerStorage` and rename it `CreatorFlowAnimationBridge`.
4. Open [`CreatorFlowAnimationBridge.lua`](./CreatorFlowAnimationBridge.lua), copy the entire file, and replace the temporary Script's contents with it.
5. Keep that Script selected in Explorer. In Studio's **Plugins** menu, choose **Save as Local Plugin**, then choose **Save**.
6. Delete the original temporary Script from `ServerStorage`. The installed copy should appear in `PluginDebugService` and the **CreatorFlow** toolbar button should appear in the Plugins toolbar.
7. If it does not appear immediately, restart Studio or right-click the plugin under `PluginDebugService` and choose **Reload Plugin**.

These steps mirror Roblox's current local-plugin instructions: <https://create.roblox.com/docs/studio/plugins#save-plugin-script>

To update the local copy later, paste the new source into the plugin under `PluginDebugService`, then right-click it and choose **Save and Reload Plugin**.

## First comparison

1. Start CreatorFlow and open the project that should receive the local evidence.
2. In CreatorFlow's Motion workspace, copy the **loopback URL** and **pairing token**.
3. In Studio, click the **CreatorFlow** toolbar button.
4. Paste the URL and token, then click **Test connection**. Accept Studio's network permission prompt if one appears.
5. Paste two numeric animation asset IDs.
6. Click **Read, normalize & compare**.
7. Return to CreatorFlow to inspect the saved comparison, fingerprints, joint scores, and evidence record.

The endpoint, token, and most recent IDs are saved with `Plugin:SetSetting()` for convenience. The pairing token is local but is not encrypted in Studio's plugin settings; treat it as short-lived. Pairings persist across desktop restarts (stored hashed in SQLite) and stay valid until their 8-hour expiry or until revoked from the desktop app's pairing panel. Paste a fresh token if an old one returns `401 Unauthorized` (expired or revoked).

If Studio refuses all requests, also check **Game Settings → Security → Allow HTTP Requests**. Roblox's `RequestAsync()` setup and response behavior are documented here: <https://create.roblox.com/docs/reference/engine/classes/HttpService#RequestAsync>

## Stock rig asset IDs for the playability probe (one-time owner setup)

Since Phase B (#118), Compare also plays each clip on a stock R6 and R15 dummy and reports
per-rig playability. The plugin ships with placeholders:

```lua
local RIG_ASSET_IDS = {
	R6 = 0, -- TODO: insert a stock R6 dummy via Studio's Avatar tab -> Rig Builder, copy its asset ID here
	R15 = 0, -- TODO: same, for R15
}
```

(`CreatorFlowAnimationBridge.lua` lines 133–134 on `main`.) With the placeholders the probe
does not error: `InsertService:LoadAsset(0)` fails inside a `pcall`, `fetchStandardRig`
returns `nil`, and every playability row in the desktop's Animation Snapshots panel just
reads **Not checked** (`NOT_VERIFIED`). A wrong-but-nonzero ID, or an ID that loads but is
not a rig, lands in the exact same silent path — which is why a wrong ID is worse than the
placeholder: it looks filled in while checking nothing.

The **structural rig-binding line** under each of those rows is a different check and does not
depend on any of this. CreatorFlow derives it desktop-side from the joint names the clip already
sends — how many of the animation's channels name a joint the stock R6/R15 skeleton actually has —
so it reports on every Compare whether or not these IDs are filled. That check is what catches a
rig-incompatible clip; the live probe cannot, because Roblox plays such a clip without complaint
(see issue #122).

### What research found (2026-08-03, not re-verified in a live Studio)

- **Rig Builder does not hand you an asset ID.** The rig tool the code comment points at
  (current docs: the Rig Generator, reached from the **Avatar** or **Home** tab — the exact
  button name varies by Studio version) builds the rig locally in the place. There is no ID
  until you publish the rig yourself.
  <https://create.roblox.com/docs/studio/rig-builder>
- **There is no first-party stock-rig asset.** Every "R6/R15 dummy" on the Creator Store is
  user-uploaded.
- **`LoadAsset` very likely cannot fetch free models you don't own, even from a plugin.**
  The current API reference gates `LoadAsset` behind a `LoadOwnedAsset` capability; a
  Feb 2022 Studio bug report shows plugin/command-bar `LoadAsset` on an unowned free model
  failing with an HTTP 403 (staff filed a ticket, no public fix), and a Jan 2024 feature
  request says the restriction was still in place. Unverified against today's Studio — the
  one-line test below settles it either way.
  <https://devforum.roblox.com/t/can-no-longer-insert-free-models-using-insertserviceloadasset-in-studio/1683109>
  <https://devforum.roblox.com/t/allow-insertservice-to-insert-free-models-in-plugins-command-bar/2773919>

### Recommended path: publish your own rigs (~3 minutes, works in every context)

1. In a scratch place, insert one R6 rig and one R15 rig with the rig tool.
2. Right-click each rig in Explorer → **Save to Roblox…** → asset type **Model**. Name them
   findably, e.g. `CreatorFlow probe rig R6` / `CreatorFlow probe rig R15`. They do not need
   Creator Store distribution — you only need to own them.
3. Copy each numeric asset ID from the publish dialog, or later from
   create.roblox.com → Creations → Models.
4. Run the confirmation one-liner below on each ID, then make the two-line edit.

### Candidate public IDs (untested — try first only if you'd rather not publish)

| Rig | ID | Name | Evidence | Caveats |
|-----|----|------|----------|---------|
| R15 | `5421500442` | "R15 Block Rig Dummy" | Model asset by user **elitz164**, 2020-07-24, marked public-domain/free in Roblox's public asset-details API (checked 2026-08-03) | User-uploaded, not by Roblox; contents unopened — whether it holds a plain R15 rig with a `Humanoid` is unverified |
| R6 | `11025556170` | "Template Dummy (R6)" | Model asset by user **Maclenix**, 2022-09-24, public-domain/free, described "Useful for animations" (same API, same date) | Same caveats |
| R6 alt | `15523079702` | "R6 Dummy" | Model asset by user **ImNotProYourJustBad**, 2023-12-02, public-domain/free (same API, same date) | Same caveats |

Any of these can be moderated, deleted, or updated by its creator later, and per the
research above the load will probably 403 anyway. If a candidate fails the test, publish
your own — that removes every one of these caveats.

### Confirm an ID before writing it into the code

In Studio's Command Bar (**View → Command Bar**), one ID at a time:

```lua
local m = game:GetService("InsertService"):LoadAsset(5421500442) local rig = m:FindFirstChildWhichIsA("Model") local h = rig and rig:FindFirstChildOfClass("Humanoid") print(rig and rig.Name, h and h.RigType)
```

- **Correct:** no error, and it prints the rig's name plus `Enum.HumanoidRigType.R15` (or
  `.R6` — the type must match the slot you are filling). That is exactly the shape
  `fetchStandardRig` needs: a loaded container whose Model child holds a `Humanoid`.
- **Unusable:** a red HTTP 403 / "asset is not trusted"-style error (cannot load it), or
  `nil` printed (loads, but is not a rig with a `Humanoid`). Do not use that ID.

### The exact edit once confirmed

In `CreatorFlowAnimationBridge.lua` (lines 133–134 on `main`; 137–138 on the PR #119
branch), replace:

```lua
	R6 = 0, -- TODO: insert a stock R6 dummy via Studio's Avatar tab -> Rig Builder, copy its asset ID here
	R15 = 0, -- TODO: same, for R15
```

with your confirmed IDs, comments dropped:

```lua
	R6 = 123456789,
	R15 = 987654321,
```

Then paste the updated file into the installed plugin under `PluginDebugService` and
**Save and Reload Plugin** (see *Install locally* above). On the next Compare, the R6/R15
rows in the desktop's Animation Snapshots panel should read **Plays clean** (or a real
playback error) instead of **Not checked**.

## Local bridge contract

The plugin accepts only a base URL matching `http://127.0.0.1:<port>` or `http://localhost:<port>`. It never accepts a remote host or HTTPS URL in this prototype.

### Health check

```http
GET /plugin/v1/health
Authorization: Bearer <pairing-token>
```

Expected response:

```json
{
  "status": "ok",
  "projectId": "optional-active-project-id",
  "expiresAt": "optional-token-expiration",
  "schema": "creatorflow.roblox-motion/v0.1"
}
```

### Comparison request

```http
POST /plugin/v1/motion-comparisons
Authorization: Bearer <pairing-token>
Content-Type: application/json
```

The JSON shape is:

```json
{
  "schema": "creatorflow.roblox-motion/v0.1",
  "source": {
    "assetId": "1234567890",
    "name": "Walk",
    "duration": 1.2,
    "looped": true,
    "priority": "Movement",
    "keyframes": [
      {
        "time": 0,
        "poses": [
          {
            "jointPath": "HumanoidRootPart/LowerTorso",
            "transform": [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
            "weight": 1,
            "easingStyle": "Linear",
            "easingDirection": "In"
          }
        ]
      }
    ]
  },
  "candidate": { "...": "same shape as source" },
  "sourceKind": "KEYFRAME",
  "candidateKind": "CURVE_SAMPLED"
}
```

`sourceKind` and `candidateKind` sit at the top level rather than inside `source`/`candidate`, because those two objects are parsed straight into the desktop app's `NormalizedAnimation` and it rejects unknown properties.

CreatorFlow should reply with the persisted comparison view, including at least `id` and `overallScore`; the plugin also displays `verdict` and `exactCurveData` when present.

## Manual test checklist

Run these before handing the plugin to another developer:

- [ ] **Connection:** valid loopback URL and current token report “Connected to CreatorFlow.”
- [ ] **Token security:** changing one character in the token produces a clear `401` error.
- [ ] **Loopback guard:** a URL on any non-loopback host is rejected before `HttpService` runs.
- [ ] **Exact pair:** comparing an accessible animation ID with itself creates one record and reports exact normalized data / a full score.
- [ ] **Different pair:** comparing two accessible motion clips creates a record with fingerprints and component scores.
- [ ] **Permissions:** an inaccessible or deleted asset produces a Roblox permission/loading error and creates no evidence record.
- [ ] **Curve clip:** comparing a `CurveAnimation` on at least one side creates a record built from sampled poses, and the desktop workspace's Animation Snapshots panel labels that side “Sampled from a curve — not an exact read.” with its Pin buttons still enabled.
- [ ] **Curve with nothing to compare:** a `CurveAnimation` carrying no position/rotation curve on a joint path is rejected with that reason instead of being treated as empty data.
- [ ] **Sampled exactness wording:** comparing the same `CurveAnimation` against itself finishes with “Exact match of curve-sampled data (20/s), not an authored-keyframe read.” in the plugin status line — not the plain “Exact normalized data.” a keyframe pair gets.
- [ ] **Restart:** restarting CreatorFlow keeps the pairing valid — the SAME token still connects after relaunch (until its 8-hour expiry). Revoking the pairing from the desktop app makes the plugin's next request fail with the pairing-required error.
- [ ] **HTTP denial:** denying the Studio network prompt results in a useful recovery message.
- [ ] **Persistence:** close and reopen the dock widget; the URL, token, and recent IDs remain filled in.

## Known v0.1 limitations

- `CurveAnimation` sampling reads position and rotation channels on rig-joint paths only. A curve clip with none of those is rejected with that reason rather than compared as empty data. `FloatCurve` and `MarkerCurve` channels are ignored, and a sampled clip reports no keyframe markers.
- A joint's `Rotation` child may be an `EulerRotationCurve` or a `RotationCurve`. Only the `EulerRotationCurve` shape has been exercised against a real asset; the `RotationCurve` branch is written and reviewed but untested in Studio, so treat a clip that uses it as unverified.
- Roblox decides which animation assets the Studio session may read. Ownership, group ownership, transfer, moderation, or experience permission problems cannot be bypassed by the plugin.
- The normalized evidence includes joint transforms, hierarchy, blend weight, and easing. It does not yet include keyframe markers, authored rig geometry, facial animation channels, or an avatar preview model.
- Duplicate joint paths or duplicate keyframes at the same six-decimal timestamp are rejected because v0.1 cannot order those cases unambiguously.
- A client-side safety limit stops sequences above 20,000 pose samples or requests above 2 MiB.
- A `CurveAnimation` longer than about 100 seconds is refused before sampling: 20 samples per second past that point exceeds the 2,000-keyframe limit the desktop app accepts per side. Clips on a fuller rig hit the 2 MiB request ceiling earlier, at roughly 13 seconds for 16 joints.
- The 20-samples-per-second rate is fixed. It is part of the fingerprint of every sampled clip, so changing it would make every pinned snapshot of a sampled clip report as changed even though the asset never moved.
- The pairing token is stored locally in Studio plugin settings for this friend-test build. Treat it as short-lived and do not reuse it as an account credential.
- A high similarity score is a review signal. It is not proof of authorship, infringement, or intent; source files, timestamps, licenses, and creator statements remain the stronger evidence.

## Roblox APIs used

- `AnimationClipProvider:GetAnimationClipAsync()` (the supported replacement for the deprecated `KeyframeSequenceProvider`): <https://create.roblox.com/docs/reference/engine/classes/AnimationClipProvider#GetAnimationClipAsync>
- `KeyframeSequence:GetKeyframes()`: <https://create.roblox.com/docs/reference/engine/classes/KeyframeSequence#GetKeyframes>
- `Keyframe:GetPoses()`: <https://create.roblox.com/docs/reference/engine/classes/Keyframe#GetPoses>
- `Pose:GetSubPoses()`: <https://create.roblox.com/docs/reference/engine/classes/Pose#GetSubPoses>
- `Vector3Curve:GetValueAtTime()` for a joint's sampled position: <https://create.roblox.com/docs/reference/engine/classes/Vector3Curve#GetValueAtTime>
- `EulerRotationCurve:GetRotationAtTime()` for a joint's sampled rotation: <https://create.roblox.com/docs/reference/engine/classes/EulerRotationCurve#GetRotationAtTime>
- `HttpService:RequestAsync()`: <https://create.roblox.com/docs/reference/engine/classes/HttpService#RequestAsync>
