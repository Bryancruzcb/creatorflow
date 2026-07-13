# CreatorFlow Animation Bridge for Roblox Studio

This local Studio plugin reads two animation IDs that the signed-in creator is already allowed to access, normalizes their `KeyframeSequence` joint data, and sends one comparison request to the CreatorFlow desktop app on `127.0.0.1`.

It does **not** bypass Roblox asset permissions, download a place, or send the request to a hosted service. The first prototype is an evidence and similarity tool, not a plagiarism verdict.

## What the plugin captures

For each accessible `KeyframeSequence`, the plugin records:

- animation asset ID, clip name, duration, loop setting, and priority;
- keyframe times, ordered by time;
- each pose's stable hierarchy path, such as `HumanoidRootPart/LowerTorso/LeftUpperArm`;
- the pose's 12 rounded `CFrame` components, mask weight, easing style, and easing direction.

Floating-point values are checked for finiteness and rounded to six decimal places. Pose paths and keyframes are sorted before the JSON is created. The desktop app computes and stores the fingerprints and comparison; the plugin does not claim that similar motion proves copying.

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

The endpoint, token, and most recent IDs are saved with `Plugin:SetSetting()` for convenience. The pairing token is local but is not encrypted in Studio's plugin settings; CreatorFlow should rotate it whenever the desktop bridge restarts. Paste the fresh token if an old one returns `401 Unauthorized`.

If Studio refuses all requests, also check **Game Settings → Security → Allow HTTP Requests**. Roblox's `RequestAsync()` setup and response behavior are documented here: <https://create.roblox.com/docs/reference/engine/classes/HttpService#RequestAsync>

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
  "candidate": { "...": "same shape as source" }
}
```

CreatorFlow should reply with the persisted comparison view, including at least `id` and `overallScore`; the plugin also displays `verdict` and `exactCurveData` when present.

## Manual test checklist

Run these before handing the plugin to another developer:

- [ ] **Connection:** valid loopback URL and current token report “Connected to CreatorFlow.”
- [ ] **Token security:** changing one character in the token produces a clear `401` error.
- [ ] **Loopback guard:** a URL on any non-loopback host is rejected before `HttpService` runs.
- [ ] **Exact pair:** comparing an accessible animation ID with itself creates one record and reports exact normalized data / a full score.
- [ ] **Different pair:** comparing two accessible motion clips creates a record with fingerprints and component scores.
- [ ] **Permissions:** an inaccessible or deleted asset produces a Roblox permission/loading error and creates no evidence record.
- [ ] **Clip type:** a `CurveAnimation` is rejected with the v0.1 limitation instead of being treated as empty data.
- [ ] **Restart:** restarting CreatorFlow invalidates the old token; pasting the fresh token reconnects.
- [ ] **HTTP denial:** denying the Studio network prompt results in a useful recovery message.
- [ ] **Persistence:** close and reopen the dock widget; the URL, token, and recent IDs remain filled in.

## Known v0.1 limitations

- Only `KeyframeSequence` is normalized. `CurveAnimation` uses a different channel representation and is deliberately rejected until CreatorFlow has a curve-aware canonical format.
- Roblox decides which animation assets the Studio session may read. Ownership, group ownership, transfer, moderation, or experience permission problems cannot be bypassed by the plugin.
- The normalized evidence includes joint transforms, hierarchy, mask weight, and easing. It does not yet include keyframe markers, authored rig geometry, facial animation channels, or an avatar preview model.
- Duplicate joint paths or duplicate keyframes at the same six-decimal timestamp are rejected because v0.1 cannot order those cases unambiguously.
- A client-side safety limit stops sequences above 20,000 pose samples or requests above 2 MiB.
- The pairing token is stored locally in Studio plugin settings for this friend-test build. Treat it as short-lived and do not reuse it as an account credential.
- A high similarity score is a review signal. It is not proof of authorship, infringement, or intent; source files, timestamps, licenses, and creator statements remain the stronger evidence.

## Roblox APIs used

- `AnimationClipProvider:GetAnimationClipAsync()` (the supported replacement for the deprecated `KeyframeSequenceProvider`): <https://create.roblox.com/docs/reference/engine/classes/AnimationClipProvider#GetAnimationClipAsync>
- `KeyframeSequence:GetKeyframes()`: <https://create.roblox.com/docs/reference/engine/classes/KeyframeSequence#GetKeyframes>
- `Keyframe:GetPoses()`: <https://create.roblox.com/docs/reference/engine/classes/Keyframe#GetPoses>
- `Pose:GetSubPoses()`: <https://create.roblox.com/docs/reference/engine/classes/Pose#GetSubPoses>
- `HttpService:RequestAsync()`: <https://create.roblox.com/docs/reference/engine/classes/HttpService#RequestAsync>
