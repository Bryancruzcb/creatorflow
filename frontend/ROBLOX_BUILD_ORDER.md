# CreatorFlow: Roblox-first build order

## Product decision

Build **animation evidence for Roblox teams first**. Do not turn CreatorFlow into another animation editor, asset marketplace, or one-click publisher.

The first useful loop is:

1. A developer opens a CreatorFlow dock widget in Roblox Studio.
2. They select or paste two Animation IDs they are allowed to read.
3. The plugin reads the `KeyframeSequence`, normalizes the joint tracks, and sends a short-lived, authenticated loopback request to the CreatorFlow desktop app.
4. CreatorFlow produces exact and similarity fingerprints, explains pose/timing/coverage evidence, and stores the Animation IDs, algorithm version, permission context, and human decision.
5. The release record carries that evidence to a separate Roblox Studio or Creator Dashboard publishing action.

This wedge solves a concrete problem without claiming that a similarity score proves copying.

## Capability boundary

| CreatorFlow should do | Roblox should continue to do |
| --- | --- |
| Read permitted animation data through a Studio plugin | Author poses, curves, easing, and rig controls |
| Normalize and compare joint tracks locally | Enforce asset access and ownership permissions |
| Explain pose, timing, coverage, and exact-curve evidence | Publish the animation or place version |
| Attach source, permission, and a human decision | Choose audience, rollout, and live-server behavior |
| Export a release evidence manifest | Host the project and its cloud assets |

Roblox already provides the correct primitives: plugins and dock widgets for the Studio surface, `Selection` for Studio context, and `KeyframeSequenceProvider:GetKeyframeSequenceAsync()` for an accessible animation. That call is a web call and must be wrapped in `pcall`. Restricted assets still obey Roblox access rules. See the official [Studio plugin guide](https://create.roblox.com/docs/studio/plugins), [Studio widget guide](https://create.roblox.com/docs/studio/build-studio-widgets), [Selection API](https://create.roblox.com/docs/reference/engine/classes/Selection), [KeyframeSequenceProvider API](https://create.roblox.com/docs/reference/engine/classes/KeyframeSequenceProvider), and [asset privacy guide](https://create.roblox.com/docs/projects/assets/privacy).

## Build order

### 0. Freeze the vertical-slice contract — half day

Define one versioned record before writing more UI:

```json
{
  "schema": "creatorflow.motion/v1",
  "projectId": 42,
  "sourceAssetId": "14279384219",
  "candidateAssetId": "14279384601",
  "normalization": {
    "rig": "R15",
    "sampleCount": 48,
    "timeDomain": "0..1",
    "rootMotion": "separate",
    "rotation": "quaternion"
  },
  "algorithmVersion": "motion-sim/v0.2",
  "capturedAt": "2026-07-13T00:00:00Z"
}
```

The record must always retain both Animation IDs, the normalization version, and whether exact curve data was available. Never store only a percentage.

**Gate:** the same input produces byte-for-byte identical canonical output on two runs.

### 1. Build the installable Studio shell — day 1

- Create a toolbar button and dockable `DockWidgetPluginGui`.
- Match the Studio theme and respond to theme changes.
- Provide two input modes: paste Animation IDs or use selected `Animation` instances.
- Add a connection panel for the CreatorFlow endpoint and short-lived token.
- Store only non-secret preferences with plugin settings; do not persist an expired pairing token.
- Show an explicit disconnected state and a “Test local connection” action.

The desktop flow already exposes a project-scoped pairing shape in `LocalBridgeClient.createPluginPairing()`. The Java desktop implementation must issue a loopback-only endpoint, a single-project token, and an expiry before the plugin can be called complete.

**Gate:** a fresh Studio install can open the widget, pair to one CreatorFlow project, survive closing/reopening the widget, and reject an invalid or expired token.

### 2. Read two real animations safely — day 2

- Convert numeric IDs to `rbxassetid://…` content IDs.
- Load each animation with `KeyframeSequenceProvider:GetKeyframeSequenceAsync()` inside `pcall`.
- Validate that the response is a `KeyframeSequence`.
- Read sorted keyframes, recursive pose paths, local `CFrame`, easing style/direction, loop, priority, markers, and duration.
- Distinguish invalid ID, wrong asset type, network failure, and permission failure in the UI.
- Never attempt to bypass Roblox access controls.

Roblox documents that a `KeyframeSequence` stores keyframes and animation metadata and that the highest keyframe time defines its length. The Animation Editor remains the supported authoring and upload surface. See [KeyframeSequence](https://create.roblox.com/docs/reference/engine/classes/KeyframeSequence), [Keyframe](https://create.roblox.com/docs/reference/engine/classes/Keyframe), and the [Animation Editor](https://create.roblox.com/docs/animation/editor).

**Gate:** the friend can load two animations they own or can access, while a restricted test ID fails with a useful permission message.

### 3. Normalize and fingerprint motion — days 3–4

Create two related fingerprints, not one magic score:

- **Exact canonical fingerprint:** stable hash of sorted, quantized joint paths, key times, transforms, easing, loop, and priority. This catches renamed or republished identical curves.
- **Similarity fingerprint:** 48 normalized samples per shared joint, with root translation/yaw separated from local pose. Store compact per-joint descriptors for rotation path, translation path, velocity, and timing.
- **Timing fingerprint:** duration ratio, normalized key spacing, easing transitions, and marker placement.
- **Coverage record:** shared, source-only, and candidate-only joints. Low coverage must reduce confidence instead of silently disappearing.

Normalization rules:

1. Sort keyframes by time and build stable pose paths from the recursive hierarchy.
2. Map known R6/R15 aliases into a versioned canonical joint dictionary; preserve unknown joint paths rather than dropping them.
3. Convert rotations to normalized quaternions and force a consistent sign.
4. Quantize after normalization, not before it.
5. Sample both clips in unit time for pose comparison while retaining authored duration for the timing result.
6. Keep root motion as a separate signal so locomotion does not overwhelm arm/torso evidence.
7. Produce an explicit `exactCurveData` flag and algorithm version.

For the first friend test, the plugin may send the versioned canonical joint bundle only to the authenticated `127.0.0.1` desktop bridge; the desktop service can hash, compare, persist fingerprints/aggregates, and discard the temporary samples. Before any remote registry pilot, move descriptor generation into the plugin or desktop process and send fingerprints only. `HttpService` is the Studio networking primitive; CreatorFlow must detect and explain when HTTP requests are disabled. See [HttpService](https://create.roblox.com/docs/reference/engine/classes/HttpService).

**Gate:** identical curves score as exact, a pure 1.18× retime keeps high pose similarity but changes timing, a deliberate arm edit lowers the relevant joint score, and missing joints reduce coverage.

### 4. Persist the evidence locally — days 4–5

- Implement the plugin intake endpoint behind the project-scoped pairing token.
- Bind each request to the paired project; reject arbitrary project IDs.
- Enforce loopback host, JSON content type, body-size limit, expiry, replay protection, and rate limits.
- Store the comparison fields already represented by `LocalMotionComparison`: IDs, names, durations, fingerprints, pose/timing/coverage percentages, exact-curve flag, verdict, algorithm version, timestamp, and result detail.
- Refresh the Animation Compare inbox after a successful post.
- Add the motion record to the release manifest and mark it stale if the Animation ID or fingerprint changes.

**Gate:** restart CreatorFlow and confirm the same comparison is still present, attached to the same project, with no source keyframe payload persisted.

### 5. Run the friend test — end of week

Give the friend one task and do not coach them:

> “Check whether these two animations need a provenance review, attach the reason, and show me what would travel with the release.”

Measure:

- Time to install and pair.
- Whether they understand reference vs candidate.
- Whether they can explain retime, pose, timing, and coverage without help.
- Whether they understand that similarity is not a copyright verdict.
- Whether they can attach “owned,” “licensed,” “shared by teammate,” or “replace” context.
- Whether they know CreatorFlow did not publish or edit the animation.

**Pass:** they complete the flow in under five minutes, correctly explain the result, and trust the evidence record enough to use it on one team release.

### 6. Expand to project awareness — week 2

Only after the pair flow works:

- Scan selected `Animation` instances and animation references in the open data model.
- Use `Selection.SelectionChanged` to offer relevant context without silently scanning everything.
- Track `AnimationId` changes during the Studio session and mark previous evidence stale.
- Add a manual “Refresh cloud animation” action; do not imply that the website receives every remote asset edit instantly.
- Show where each Animation ID is referenced in scripts/instances and which places or packages need revalidation.
- Batch comparisons through a queue with cancellation and progress.

**Gate:** changing an `AnimationId` in Studio marks the old record stale and re-running updates the right project record without duplicating unrelated evidence.

### 7. Connect the release gate — weeks 3–4

- Require reviewed source/permission context for high-similarity or exact-curve findings.
- Add waivers with author, reason, timestamp, and superseded-decision history.
- Include motion evidence in PASS/BLOCKED policy evaluation.
- Export a deterministic manifest containing the Roblox project/place target, Animation IDs, fingerprints, comparison version, permission record, and decision.
- Keep the final publish action as a Roblox Studio/Creator Dashboard handoff.

**Gate:** a blocked animation record prevents a CreatorFlow PASS manifest; resolving or explicitly waiving it changes the gate while preserving the earlier decision history.

## What not to build yet

- Animation authoring or a web-based curve editor.
- Uploading or replacing Roblox animations from CreatorFlow.
- One-click place publishing or audience changes.
- A global “copied/not copied” verdict.
- Cloud storage of raw keyframes.
- Whole-project continuous monitoring before the two-animation loop works.
- Marketplace/community features.

## End-of-month definition of done

A real Roblox developer can install the plugin, pair it to CreatorFlow, compare two permitted Animation IDs, understand the evidence, record provenance, reopen the result after restart, and carry it into an honest BLOCKED/PASS release manifest. Everything beyond that is phase two.
