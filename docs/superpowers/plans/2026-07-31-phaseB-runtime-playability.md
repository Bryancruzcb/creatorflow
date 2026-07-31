# Phase B — Runtime Playability Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** check that a Roblox animation actually plays cleanly on Roblox's stock R6/R15 dummy rigs inside Studio, and surface that as new evidence on the comparison record — without wiring it into the release gate, which needs infrastructure this phase does not build.

**Architecture:** the Studio plugin (`CreatorFlowAnimationBridge.lua`) probes playability for both animations right after it already reads them for a Compare, and sends the result as a new top-level `playability` field alongside the existing wire payload. The desktop bridge (`LocalBridgeServer.java`) parses that field independently of the existing pose-comparison parsing, persists it as a new nullable JSON column on `animation_comparisons`, and returns it in the comparison view. The frontend (`AnimationSnapshotsPanel.tsx`) renders it per animation using the existing `EvidenceBasisMark` tri-state component.

**Tech Stack:** Luau (Studio plugin), Java 21 (desktop bridge + SQLite via the existing `Database`/migration runner), React 19 + TypeScript + Vitest/RTL (frontend).

**Spec:** `docs/superpowers/specs/2026-07-31-phaseB-runtime-playability-design.md`

## Global Constraints

- **Honesty ceiling.** `VERIFIED` is the evidence *basis* (a live check ran on a Roblox-stock R6/R15 dummy in Studio) — never an outcome claim. A clip that plays clean and a clip that throws an engine error are **both** `VERIFIED`; they differ only in outcome text, never in which tri-state label is shown. Only "no check ran at all" is `NOT_VERIFIED`.
- **Never claims more than Roblox's stock rigs prove.** A `VERIFIED` result says nothing about the target experience's actual custom rig, if one differs from the stock skeletons.
- **R6 and R15 results are always shown independently** — never collapsed into one pass/fail.
- **`Priority` is recorded, not verified.** v1 reads the clip's declared `Priority` (already read today, unchanged) but does not claim to have confirmed it's behaviorally honored — that needs a second competing track this phase does not build.
- **No wire schema-string bump.** `creatorflow.roblox-motion/v0.1` stays exactly as-is (`LocalBridgeServer.MOTION_INPUT_SCHEMA`, `CreatorFlowAnimationBridge.lua`'s `SCHEMA` constant, and the plugin's connect-time strict schema match all depend on this not changing).
- **`playability` is a top-level sibling field in the wire payload, never nested inside `source`/`candidate`.** `LocalBridgeServer`'s `ObjectMapper` does not disable Jackson's `FAIL_ON_UNKNOWN_PROPERTIES`, and `source`/`candidate` deserialize straight into `NormalizedAnimation` — an unknown nested key throws. `playability` gets its own independent parse.
- **No release-gate integration in this phase.** `animation_comparisons` has no `scan_asset_id` — Studio comparisons aren't bound to a scanned `AssetEntry` the way ownership verification is. A playability failure is visible evidence on the comparison record only.
- **No Luau test framework is introduced.** Pure logic gets a self-check function called once at script load (new to this file — not existing precedent, see Task 1). The rig-plays-for-real behavior is a manually-verified live-Studio step.

---

## Task 0 (GATE) — Feasibility spike: does marker-firing survive scrubbed playback?

**Nothing in Tasks 1–3 is built until this answers Steps 2 and 4.** This determines the playback-driving method, whether `markersFired` ships in v1, and pins the two rig asset IDs every later task depends on.

**Files:** none committed to the main tree — a throwaway script run from Studio's command bar (or a scratch local plugin), findings written to `docs/superpowers/plans/2026-07-31-phaseB-task0-spike-note.md`.

- [ ] **Step 1 — Pin the rig asset IDs.** In Studio, use `InsertService` (or the Toolbox) to find the exact stock R6 and R15 dummy rig asset IDs — the same rigs Roblox's own built-in Animation Editor uses are a good starting point. Insert **both** into a test place (Step 4 needs the R6 one too). Record both numeric asset IDs in the note.

- [ ] **Step 2 — Test marker-firing under scrubbing.** On the inserted R15 dummy, load a known `KeyframeSequence` that has at least one authored `PoseMarker`, via:
  ```lua
  local humanoid = rig:FindFirstChildOfClass("Humanoid")
  local animation = Instance.new("Animation")
  animation.AnimationId = "rbxassetid://" .. testAnimationId
  local track = humanoid:LoadAnimation(animation)
  local fired = {}
  track:GetMarkerReachedSignal("YourMarkerName"):Connect(function()
      table.insert(fired, "YourMarkerName")
  end)
  track:Play()
  for i = 0, 30 do
      track.TimePosition = (i / 30) * track.Length
      task.wait()
  end
  print("Fired:", fired)
  ```
  Record in the note whether `fired` ends up non-empty (some/all authored markers fired) or stays empty (none fired under scrubbing).

- [ ] **Step 3 — If Step 2 shows markers do NOT fire reliably, test the fallback.** Replace the scrub loop with real-time playback polled via `Heartbeat`:
  ```lua
  track:Play()
  local connection
  connection = game:GetService("RunService").Heartbeat:Connect(function()
      if track.TimePosition >= track.Length then
          connection:Disconnect()
      end
  end)
  ```
  Time how long this takes end-to-end for a representative clip (should complete in well under a second, not the clip's real playback duration — Roblox animation playback speed is independent of the engine's simulation step rate). Record in the note whether markers fire reliably this way, and whether the timing is practical inside a plugin action.

- [ ] **Step 4 — Confirm engine errors are catchable.** Force an R15-authored `KeyframeSequence` onto the R6 dummy inserted in Step 1:
  ```lua
  local ok, err = pcall(function()
      local track = r6Humanoid:LoadAnimation(r15Animation)
      track:Play()
  end)
  print(ok, err)
  ```
  Record in the note whether `ok` is `false` with a non-empty `err` (a catchable error) or whether it silently succeeds/no-ops.

- [ ] **Step 5 — Write the confirmed contract.** Create `docs/superpowers/plans/2026-07-31-phaseB-task0-spike-note.md` recording: the two pinned rig asset IDs (Step 1), the chosen playback-driving method (scrub or real-time-poll, from Steps 2–3), whether `markersFired` ships in v1 or is cut, and the exact shape of the `pcall` error string from Step 4. **Tasks 1–3 below use `RIG_R6_ASSET_ID`, `RIG_R15_ASSET_ID`, and `PLAYBACK_METHOD` as named placeholders for these three pinned values — substitute the note's real values when implementing, do not leave the placeholder names in committed code.**
- [ ] **Step 6 — Commit the note.**
  ```bash
  git add docs/superpowers/plans/2026-07-31-phaseB-task0-spike-note.md
  git commit -m "docs: Phase B Task 0 spike findings — rig IDs, playback method, marker feasibility"
  ```

**Completion test:** the note has a clear answer for Steps 2 and 4. `PlayabilityResult`'s shipped shape is always just `{ ok, error? }` (see Task 1) — marker-firing feasibility only decides whether Task 1's `probePlayability` folds a marker-mismatch into that `ok`/`error` pair or skips straight to the loop-honored check. If marker-firing cannot be made reliable even with Step 3's fallback, cut it and proceed with the loop-honored check only — do not block the rest of the phase on it.

---

## Task 1 — Plugin: probe playability during Compare

**Files:**
- Modify: `roblox-plugin/desktop-bridge/CreatorFlowAnimationBridge.lua`

**Interfaces:**
- Consumes: `RIG_R6_ASSET_ID`, `RIG_R15_ASSET_ID`, `PLAYBACK_METHOD` from Task 0's spike note.
- Produces: a `playability` Lua table with shape `{ source = PlayabilityReport, candidate = PlayabilityReport }` where `PlayabilityReport = { r6 = PlayabilityResult?, r15 = PlayabilityResult? }` and `PlayabilityResult = { ok: boolean, error: string? }`. **A rig key is entirely absent (nil, not present in the encoded JSON) when no probe could run at all** (rig fetch failed) — that is the only case downstream code reads as `NOT_VERIFIED`. Once a probe *does* run, its key is always present with `ok`/`error` reflecting every check this phase makes (engine error, loop honored, markers fired if in scope) folded into one boolean + message — never a separate UI state per failure kind. This table is what Task 2 parses as the wire payload's top-level `playability` field.

This task has no automated test harness (no Luau test framework exists or is being introduced — see Global Constraints). The "test cycle" here is: (a) a pure-logic self-check runnable in Studio's command bar, verified by reading its printed output, and (b) a manual live-Studio walkthrough at the end.

- [ ] **Step 1 — Add the rig cache and fetch function.** Near the top of `CreatorFlowAnimationBridge.lua`, after the existing `local SETTINGS = {...}` block, add:
  ```lua
  local InsertService = game:GetService("InsertService")

  local RIG_ASSET_IDS = {
      R6 = <RIG_R6_ASSET_ID>,   -- from Task 0's spike note
      R15 = <RIG_R15_ASSET_ID>, -- from Task 0's spike note
  }

  local rigCache = {}

  local function fetchStandardRig(rigType)
      if rigCache[rigType] then
          return rigCache[rigType]
      end
      local ok, model = pcall(function()
          return InsertService:LoadAsset(RIG_ASSET_IDS[rigType])
      end)
      if not ok or not model then
          return nil
      end
      local rig = model:FindFirstChildWhichIsA("Model")
      if rig then
          rig.Parent = nil
      end
      model:Destroy()
      rigCache[rigType] = rig
      return rig
  end
  ```

- [ ] **Step 2 — Add the pure marker-comparison helper and its self-check.** This is the one piece of logic testable without a live rig — write it TDD-style: the self-check IS the failing-then-passing test, run manually.
  ```lua
  local function markersDeclaredIn(clip)
      local declared = {}
      for _, keyframe in ipairs(clip:GetKeyframes()) do
          for _, marker in ipairs(keyframe:GetMarkers()) do
              table.insert(declared, marker.Name)
          end
      end
      return declared
  end

  local function Playability_selfTest()
      local passed = true
      -- markersDeclaredIn on an empty keyframe list returns an empty table, not nil.
      local emptyClip = Instance.new("KeyframeSequence")
      local emptyResult = markersDeclaredIn(emptyClip)
      emptyClip:Destroy()
      if type(emptyResult) ~= "table" or #emptyResult ~= 0 then
          warn("[CreatorFlow] Playability self-test FAILED: markersDeclaredIn did not return an empty table for a clip with no keyframes.")
          passed = false
      end
      return passed
  end
  ```
  Run this in Studio's command bar first (paste `Playability_selfTest()` after loading the script in a throwaway place) and confirm it prints nothing and returns `true` — if it warns, the helper has a bug; fix `markersDeclaredIn` before continuing.

  `markersDeclaredIn` has no caller in the shipped feature yet — `probePlayability` (Step 3) takes `declaredMarkers` as a parameter rather than deriving it from a clip, and until Task 0 confirms `markersFired` is viable that parameter is always `{}` (see Step 3/Step 4). This helper is where marker extraction plugs in once that happens: `normalizeKeyframeSequence` gets extended to call it per-keyframe and fold the results into `normalized.markers`, which Step 4's `compareButton.Activated` wiring then passes as `source.markers`/`candidate.markers` in place of today's `{}` literals. Until then it's self-tested but unused — that's expected, not a bug.

  Then wire it to run automatically on every plugin load, matching how `Sha256.selfTest()` guards `Main.server.luau:15` in the legacy plugin — add near the top of `CreatorFlowAnimationBridge.lua`, immediately after `Playability_selfTest`'s own definition:
  ```lua
  if not Playability_selfTest() then
      warn("[CreatorFlow] Playability self-test failed — marker/report logic may be broken; playability checks will still run but their results may be unreliable.")
  end
  ```
  Unlike `Sha256.selfTest()` (which refuses to load the whole plugin on failure, because a wrong hash could poison the shared registry), this warns rather than halts: a broken playability self-check degrades one evidence facet, not data integrity, so the rest of the plugin — Compare, pairing, everything already working — should keep functioning.

- [ ] **Step 3 — Add `probePlayability`, using Task 0's confirmed playback method.** Takes the animation's **Roblox asset ID** (a string — the same `sourceId`/`candidateId` already computed by `normalizeAssetId` in the Compare handler), not the raw `KeyframeSequence` clip: `Humanoid:LoadAnimation` requires an `Animation` instance with an `AnimationId`, exactly like Task 0's spike script builds (`Instance.new("Animation")`, set `AnimationId`, then load that) — a `KeyframeSequence` cannot be passed to `LoadAnimation` directly. Building a fresh `Animation` here means this function needs no `KeyframeSequence` instance at all, so `readAnimation` does not need to change.

  Returns `nil` when no probe could run at all (rig fetch failed — becomes `NOT_VERIFIED` downstream); otherwise always returns a table with `ok`/`error` reflecting every check made, folding engine errors, loop mismatch, and (if in scope) marker mismatch into that single boolean rather than separate fields the UI would need to branch on. Takes the clip's already-known declared `looped` boolean and marker-name list as parameters — both come from the same normalized data `readAnimation` already produces (`normalized.looped`, which is `clip.Loop` read in `normalizeKeyframeSequence` before the clip is destroyed), so `probePlayability` never needs the raw `KeyframeSequence` itself. If Task 0 pinned the scrub method:
  ```lua
  local function probePlayability(assetId, rigType, declaredLooped, declaredMarkers)
      local rig = fetchStandardRig(rigType)
      if not rig then
          return nil -- no probe could run — NOT_VERIFIED downstream, distinct from a probe that ran and failed
      end
      local scratchRig = rig:Clone()
      scratchRig.Parent = workspace
      local animation = Instance.new("Animation")
      animation.AnimationId = "rbxassetid://" .. assetId
      local fired = {}
      local result
      local ok, err = pcall(function()
          local humanoid = scratchRig:FindFirstChildOfClass("Humanoid")
          local track = humanoid:LoadAnimation(animation)
          -- Roblox initializes track.Looped from the loaded clip's own authored Loop metadata.
          -- Read it now, before anything else touches it, or the comparison below is comparing
          -- declaredLooped against a value we set ourselves — a tautology, not a check.
          local engineLooped = track.Looped
          for _, name in ipairs(declaredMarkers) do
              track:GetMarkerReachedSignal(name):Connect(function()
                  table.insert(fired, name)
              end)
          end
          track:Play()
          local samples = 30
          for i = 0, samples do
              track.TimePosition = (i / samples) * track.Length
          end
          track:Stop()

          local loopHonored = engineLooped == declaredLooped
          local missingMarker = nil
          for _, name in ipairs(declaredMarkers) do
              if not table.find(fired, name) then
                  missingMarker = name
                  break
              end
          end

          if not loopHonored then
              result = { ok = false, error = "Loop setting was not honored during playback." }
          elseif missingMarker then
              result = { ok = false, error = "Marker '" .. missingMarker .. "' never fired." }
          else
              result = { ok = true }
          end
      end)
      scratchRig:Destroy()
      if not ok then
          return { ok = false, error = errorText(err) }
      end
      return result
  end
  ```
  `declaredMarkers` is `{}` (empty) until Task 0 confirms `markersFired` is viable and `normalizeKeyframeSequence` is extended to also collect `Keyframe:GetMarkers()` names — with an empty list, the marker check is a no-op and every clip passes it trivially, which is correct (nothing declared, nothing to miss).

  If Task 0 instead pinned the real-time-`Heartbeat`-poll method, replace the scrub loop (the `for i = 0, samples do ... end` block) with the polling loop from Task 0 Step 3, keeping everything else — including `scratchRig:Destroy()` in both the success and `pcall`-failure paths — identical.

  If Task 0's note says `markersFired` was cut, delete the `fired`/`GetMarkerReachedSignal`/`missingMarker` logic entirely and drop straight to `result = loopHonored and { ok = true } or { ok = false, error = "Loop setting was not honored during playback." }`.

  Place `markersDeclaredIn` and `probePlayability` immediately after Step 1's `fetchStandardRig` block (before `local toolbar = plugin:CreateToolbar(...)`), and Step 2's `Playability_selfTest` immediately after `probePlayability` — all four must be declared, as `local function`s, before `compareButton.Activated`'s handler (~line 725 in the current file) captures them as upvalues; Lua requires the declaration to appear lexically earlier in the file.

- [ ] **Step 4 — Wire it into the existing Compare handler.** `readAnimation` does not need to change — `probePlayability` takes the asset ID string and the already-normalized `looped`/marker data, both of which `readAnimation`'s existing return value (`source`/`candidate`, each with `.looped` per `normalizeKeyframeSequence`'s return table) already carries. In `compareButton.Activated`'s callback (inside `runAction`), after both `readAnimation` calls currently produce `source`/`sourceCounts` and `candidate`/`candidateCounts` (using the existing `sourceId`/`candidateId` locals already computed by `normalizeAssetId`), add:
  ```lua
  local playability = {
      source = {
          r6 = probePlayability(sourceId, "R6", source.looped, {}),
          r15 = probePlayability(sourceId, "R15", source.looped, {}),
      },
      candidate = {
          r6 = probePlayability(candidateId, "R6", candidate.looped, {}),
          r15 = probePlayability(candidateId, "R15", candidate.looped, {}),
      },
  }
  ```
  (The `{}` fourth argument is the empty `declaredMarkers` placeholder from Step 3 — replace with the real marker list once Task 0 confirms `markersFired` is viable and `normalizeKeyframeSequence` is extended to collect it.)

  Include `playability` in the existing `HttpService:JSONEncode({...})` call as a new top-level key alongside `schema`, `source`, `candidate` — change:
  ```lua
  local body = HttpService:JSONEncode({
      schema = SCHEMA,
      source = source,
      candidate = candidate,
  })
  ```
  to:
  ```lua
  local body = HttpService:JSONEncode({
      schema = SCHEMA,
      source = source,
      candidate = candidate,
      playability = playability,
  })
  ```

- [ ] **Step 5 — Manual live-Studio verification.** Install the updated plugin per `roblox-plugin/desktop-bridge/README.md`, pair it with a running desktop app, and run a real Compare on two accessible animation IDs. Confirm in Studio's Output window: no uncaught errors, both `probePlayability` calls return before the HTTP POST fires, and the POST body (add a temporary `print(HttpService:JSONEncode({...}))` before the `request(...)` call, remove it after) contains a `playability` key shaped as specified above.

- [ ] **Step 6 — Commit.**
  ```bash
  git add roblox-plugin/desktop-bridge/CreatorFlowAnimationBridge.lua
  git commit -m "feat(plugin): probe playability on stock R6/R15 rigs during Compare"
  ```

---

## Task 2 — Desktop bridge: parse and persist playability

**Files:**
- Create: `desktop/src/main/resources/creatorflow/db/migrations/V013__animation_comparison_playability.sql`
- Modify: `desktop/src/main/java/creatorflow/workflow/AnimationComparisonRecord.java`
- Modify: `desktop/src/main/java/creatorflow/db/AnimationComparisonRepository.java`
- Modify: `desktop/src/main/java/creatorflow/bridge/LocalBridgeServer.java`
- Test: `desktop/src/test/java/creatorflow/bridge/LocalBridgeServerTest.java`
- Test: `desktop/src/test/java/creatorflow/db/AnimationComparisonRepositoryTest.java` (create if it doesn't already exist — check first)

**Interfaces:**
- Consumes: the plugin's wire payload from Task 1 — a top-level `playability` JSON object, `{ source: {...}, candidate: {...} }`, each side shaped `{ r6: {...}, r15: {...} }`.
- Produces: `AnimationComparisonRecord.playabilityJson()` returns `Optional<String>` (raw JSON, `Optional.empty()` when absent); the comparison view's JSON response gains a `"playability"` key (present only when a report exists).

- [ ] **Step 1 — Write the failing repository test.** First check whether `desktop/src/test/java/creatorflow/db/AnimationComparisonRepositoryTest.java` already exists (`ls desktop/src/test/java/creatorflow/db/`); if it does, add this test to it, otherwise create it following the constructor/setup pattern used by `desktop/src/test/java/creatorflow/db/RepositoryTest.java` (an in-memory or temp-file `Database`). Add:
  ```java
  @Test
  void roundTripsOptionalPlayabilityJson() {
      AnimationComparisonRepository repo = new AnimationComparisonRepository(database);
      String playability = "{\"source\":{\"r6\":{\"ok\":true}},\"candidate\":{\"r6\":{\"ok\":false}}}";

      AnimationComparisonRecord withPlayability = repo.insert(1L, "1001", "1002", "Walk", "Walk",
              1.0, 1.0, "fp1", "fp2", 100, 100, 100, 100, true,
              "{\"verdict\":\"MATCH\"}", "motion-v2", PlaybackSettings.unknown(), PlaybackSettings.unknown(),
              playability);
      assertEquals(Optional.of(playability), withPlayability.playabilityJson());

      AnimationComparisonRecord withoutPlayability = repo.insert(1L, "2001", "2002", "Run", "Run",
              1.0, 1.0, "fp3", "fp4", 100, 100, 100, 100, true,
              "{\"verdict\":\"MATCH\"}", "motion-v2", PlaybackSettings.unknown(), PlaybackSettings.unknown(),
              null);
      assertEquals(Optional.empty(), withoutPlayability.playabilityJson());

      assertEquals(Optional.of(playability), repo.findById(withPlayability.id()).orElseThrow().playabilityJson());
      assertEquals(Optional.empty(), repo.findById(withoutPlayability.id()).orElseThrow().playabilityJson());
  }
  ```

- [ ] **Step 2 — Run it to verify it fails.**
  ```bash
  mvn -pl desktop -am -Dtest=AnimationComparisonRepositoryTest test
  ```
  Expected: FAIL — `insert` has no 15th `playability` parameter yet, and `AnimationComparisonRecord` has no `playabilityJson()` method. Compile error, not a test assertion failure — that's fine, it's still "fails for the expected reason."

- [ ] **Step 3 — Create the migration.**
  ```sql
  ALTER TABLE animation_comparisons ADD COLUMN playability_json TEXT;
  ```
  Save as `desktop/src/main/resources/creatorflow/db/migrations/V013__animation_comparison_playability.sql`. `NULL` means "not checked" — matches every other nullable column added to this table (`source_looped` etc. in `V012`).

- [ ] **Step 4 — Extend `AnimationComparisonRecord`.** Add one field and one derived accessor:
  ```java
  public record AnimationComparisonRecord(
          String id,
          long projectId,
          String sourceAssetId,
          String candidateAssetId,
          String sourceName,
          String candidateName,
          double sourceDuration,
          double candidateDuration,
          String sourceFingerprint,
          String candidateFingerprint,
          int overallScore,
          int poseScore,
          int timingScore,
          int coverageScore,
          boolean exactCurveData,
          String resultJson,
          String algorithmVersion,
          PlaybackSettings sourceSettings,
          PlaybackSettings candidateSettings,
          String playabilityJsonRaw,
          Instant createdAt) {

      /** Raw playability JSON, if a probe ran for this comparison — absent for anything checked before this field existed. */
      public java.util.Optional<String> playabilityJson() {
          return java.util.Optional.ofNullable(playabilityJsonRaw);
      }
  }
  ```

- [ ] **Step 5 — Extend `AnimationComparisonRepository.insert`, the `INSERT` statement, and `map`.** Add a `String playabilityJson` parameter as the new last argument before the record is built (positioned right after `candidateSettings`, matching Step 1's test call):
  ```java
  public AnimationComparisonRecord insert(long projectId,
                                          String sourceAssetId, String candidateAssetId,
                                          String sourceName, String candidateName,
                                          double sourceDuration, double candidateDuration,
                                          String sourceFingerprint, String candidateFingerprint,
                                          int overallScore, int poseScore, int timingScore,
                                          int coverageScore, boolean exactCurveData,
                                          String resultJson, String algorithmVersion,
                                          PlaybackSettings sourceSettings,
                                          PlaybackSettings candidateSettings,
                                          String playabilityJson) {
      AnimationComparisonRecord record = new AnimationComparisonRecord(
              UUID.randomUUID().toString(), projectId,
              requireText(sourceAssetId, "source asset ID"),
              requireText(candidateAssetId, "candidate asset ID"),
              displayName(sourceName, sourceAssetId), displayName(candidateName, candidateAssetId),
              finiteNonNegative(sourceDuration, "source duration"),
              finiteNonNegative(candidateDuration, "candidate duration"),
              requireText(sourceFingerprint, "source fingerprint"),
              requireText(candidateFingerprint, "candidate fingerprint"),
              score(overallScore, "overall score"), score(poseScore, "pose score"),
              score(timingScore, "timing score"), score(coverageScore, "coverage score"),
              exactCurveData, requireText(resultJson, "comparison result"),
              requireText(algorithmVersion, "algorithm version"),
              sourceSettings == null ? PlaybackSettings.unknown() : sourceSettings,
              candidateSettings == null ? PlaybackSettings.unknown() : candidateSettings,
              playabilityJson == null || playabilityJson.isBlank() ? null : playabilityJson,
              Instant.now());
      synchronized (connection) {
          try (PreparedStatement statement = connection.prepareStatement("""
                  INSERT INTO animation_comparisons(
                    id, project_id, source_asset_id, candidate_asset_id, source_name, candidate_name,
                    source_duration, candidate_duration, source_fingerprint, candidate_fingerprint,
                    overall_score, pose_score, timing_score, coverage_score, exact_curve_data,
                    result_json, algorithm_version, created_at,
                    source_looped, source_priority, candidate_looped, candidate_priority,
                    playability_json)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")) {
              statement.setString(1, record.id());
              statement.setLong(2, record.projectId());
              statement.setString(3, record.sourceAssetId());
              statement.setString(4, record.candidateAssetId());
              statement.setString(5, record.sourceName());
              statement.setString(6, record.candidateName());
              statement.setDouble(7, record.sourceDuration());
              statement.setDouble(8, record.candidateDuration());
              statement.setString(9, record.sourceFingerprint());
              statement.setString(10, record.candidateFingerprint());
              statement.setInt(11, record.overallScore());
              statement.setInt(12, record.poseScore());
              statement.setInt(13, record.timingScore());
              statement.setInt(14, record.coverageScore());
              statement.setInt(15, record.exactCurveData() ? 1 : 0);
              statement.setString(16, record.resultJson());
              statement.setString(17, record.algorithmVersion());
              statement.setString(18, Timestamps.text(record.createdAt()));
              setNullableBoolean(statement, 19, record.sourceSettings().looped());
              statement.setString(20, record.sourceSettings().priority());
              setNullableBoolean(statement, 21, record.candidateSettings().looped());
              statement.setString(22, record.candidateSettings().priority());
              statement.setString(23, record.playabilityJson().orElse(null));
              statement.executeUpdate();
              return record;
          } catch (SQLException error) {
              throw new IllegalStateException("Could not persist animation comparison", error);
          }
      }
  }
  ```
  And in `map(ResultSet result)`, add the new field as the second-to-last constructor argument:
  ```java
  private static AnimationComparisonRecord map(ResultSet result) throws SQLException {
      return new AnimationComparisonRecord(
              result.getString("id"), result.getLong("project_id"),
              result.getString("source_asset_id"), result.getString("candidate_asset_id"),
              result.getString("source_name"), result.getString("candidate_name"),
              result.getDouble("source_duration"), result.getDouble("candidate_duration"),
              result.getString("source_fingerprint"), result.getString("candidate_fingerprint"),
              result.getInt("overall_score"), result.getInt("pose_score"),
              result.getInt("timing_score"), result.getInt("coverage_score"),
              result.getInt("exact_curve_data") != 0, result.getString("result_json"),
              result.getString("algorithm_version"),
              settingsFrom(result, "source_looped", "source_priority"),
              settingsFrom(result, "candidate_looped", "candidate_priority"),
              result.getString("playability_json"),
              Instant.parse(result.getString("created_at")));
  }
  ```

- [ ] **Step 6 — Run the repository test again; verify it passes.**
  ```bash
  mvn -pl desktop -am -Dtest=AnimationComparisonRepositoryTest test
  ```
  Expected: PASS.

- [ ] **Step 7 — Write the failing bridge-endpoint test.** Add to `LocalBridgeServerTest.java`, modeled on the existing `pairedStudioPluginCanStoreMotionEvidenceWithoutBrowserCookiesOrOrigin` test:
  ```java
  @Test
  void motionComparisonAcceptsAndReturnsOptionalPlayability() throws Exception {
      ObjectMapper json = new ObjectMapper();
      long projectId = json.readTree(post("/api/v1/project-picker", cookie, origin.toString(), csrf).body())
              .get("projectId").asLong();
      String token = json.readTree(post("/api/v1/projects/" + projectId + "/plugin-pairings",
              cookie, origin.toString(), csrf).body()).get("token").asText();

      String animation = """
              {
                "assetId":"%s","name":"Walk","duration":1.0,"looped":true,
                "priority":"Movement","keyframes":[
                  {"time":0.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]},
                  {"time":1.0,"poses":[{"jointPath":"Root/Torso","transform":[0,0.25,0,1,0,0,0,1,0,0,0,1],"weight":1,"easingStyle":"Linear","easingDirection":"InOut"}]}
                ]
              }
              """;
      String withPlayability = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
              + animation.formatted("3001") + ",\"candidate\":" + animation.formatted("3002")
              + ",\"playability\":{\"source\":{\"r6\":{\"ok\":true}},\"candidate\":{\"r6\":{\"ok\":false,\"error\":\"boom\"}}}}";
      HttpResponse<String> compared = pluginRequest("POST", "/plugin/v1/motion-comparisons", token, withPlayability);
      assertEquals(201, compared.statusCode(), compared.body());
      assertTrue(json.readTree(compared.body()).has("playability"));
      assertTrue(json.readTree(compared.body()).get("playability").get("source").get("r6").get("ok").asBoolean());

      String withoutPlayability = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
              + animation.formatted("4001") + ",\"candidate\":" + animation.formatted("4002") + "}";
      HttpResponse<String> comparedNoPlayability = pluginRequest(
              "POST", "/plugin/v1/motion-comparisons", token, withoutPlayability);
      assertEquals(201, comparedNoPlayability.statusCode(), comparedNoPlayability.body());
      assertFalse(json.readTree(comparedNoPlayability.body()).has("playability"));
  }
  ```

- [ ] **Step 8 — Run it to verify it fails.**
  ```bash
  mvn -pl desktop -am -Dtest=LocalBridgeServerTest#motionComparisonAcceptsAndReturnsOptionalPlayability test
  ```
  Expected: FAIL — `playability` is silently dropped today (nothing reads it), so the response has no `"playability"` key in either case, failing the first `assertTrue`.

- [ ] **Step 9 — Parse `playability` and pass it through to persistence.** In `LocalBridgeServer.java`'s `/plugin/v1/motion-comparisons` handler (around line 269), after `MotionComparisonRequest request = parseMotionRequest(body);`, add:
  ```java
  JsonNode playabilityNode = body.path("playability");
  String playabilityJson = playabilityNode.isMissingNode() || playabilityNode.isNull()
          ? null : playabilityNode.toString();
  ```
  Then add `playabilityJson` as the new last argument to the existing `animationComparisons.insert(...)` call (matches Task 2 Step 5's new parameter):
  ```java
  AnimationComparisonRecord stored = animationComparisons.insert(
          pairing.projectId(), source.assetId(), candidate.assetId(),
          source.name(), candidate.name(), source.duration(), candidate.duration(),
          result.sourceFingerprint(), result.candidateFingerprint(),
          roundedPercent(result.overallPercent()), roundedPercent(result.posePercent()),
          roundedPercent(result.timingPercent()), roundedPercent(result.coveragePercent()),
          result.exactCurveData(), json.writeValueAsString(result), result.engineVersion(),
          PlaybackSettings.of(source.looped(), source.priority()),
          PlaybackSettings.of(candidate.looped(), candidate.priority()),
          playabilityJson);
  ```

- [ ] **Step 10 — Surface it in the response view.** In `animationComparisonView(AnimationComparisonRecord record)` (around line 1061), after `view.put("createdAt", record.createdAt());` and before `view.put("result", result);`, add:
  ```java
  record.playabilityJson().ifPresent(raw -> {
      try {
          view.put("playability", json.readTree(raw));
      } catch (IOException error) {
          throw new IllegalStateException("Stored playability JSON is invalid", error);
      }
  });
  ```

- [ ] **Step 11 — Run the bridge test again; verify it passes.**
  ```bash
  mvn -pl desktop -am -Dtest=LocalBridgeServerTest#motionComparisonAcceptsAndReturnsOptionalPlayability test
  ```
  Expected: PASS.

- [ ] **Step 12 — Run the full desktop module test suite.**
  ```bash
  mvn -pl desktop -am test
  ```
  Expected: all pass, including the pre-existing `pairedStudioPluginCanStoreMotionEvidenceWithoutBrowserCookiesOrOrigin` and `pluginRouteScoresOnEngineV2AndNamesAMirroredMatch` tests (their fixtures never send `playability`, so `withoutPlayability`'s code path must handle that — already covered by Step 7's second assertion).

- [ ] **Step 13 — Commit.**
  ```bash
  git add desktop/src/main/resources/creatorflow/db/migrations/V013__animation_comparison_playability.sql \
          desktop/src/main/java/creatorflow/workflow/AnimationComparisonRecord.java \
          desktop/src/main/java/creatorflow/db/AnimationComparisonRepository.java \
          desktop/src/main/java/creatorflow/bridge/LocalBridgeServer.java \
          desktop/src/test/java/creatorflow/bridge/LocalBridgeServerTest.java \
          desktop/src/test/java/creatorflow/db/AnimationComparisonRepositoryTest.java
  git commit -m "feat(desktop): parse and persist optional playability evidence on motion comparisons"
  ```

---

## Task 3 — Frontend: render playability evidence

**Files:**
- Modify: `frontend/src/bridge/localBridge.ts`
- Modify: `frontend/src/components/AnimationSnapshotsPanel.tsx`
- Test: `frontend/src/components/AnimationSnapshotsPanel.playability.test.tsx` (new)

**Interfaces:**
- Consumes: `LocalMotionComparison.playability` (new optional field, shaped `{ source: AnimationPlayability, candidate: AnimationPlayability }`, `AnimationPlayability = { r6?: RigPlayability, r15?: RigPlayability }`, `RigPlayability = { ok: boolean; error?: string }` — a missing `r6`/`r15` key means that rig's probe never ran; matches Task 2's persisted JSON, which passes the plugin's payload through verbatim).
- Produces: a rendered evidence badge per rig per animation side in `AnimationSnapshotsPanel`.

- [ ] **Step 1 — Extend the `LocalMotionComparison` interface.** In `frontend/src/bridge/localBridge.ts`, add after the existing `mirrored?: boolean;` field (following that field's own optional-for-backward-compat precedent):
  ```typescript
  export interface RigPlayability {
    ok: boolean;
    error?: string;
  }

  export interface AnimationPlayability {
    /** Absent, not null, when that rig's probe never ran at all (e.g. the rig fetch failed) — reads NOT_VERIFIED, never a failed VERIFIED. */
    r6?: RigPlayability;
    r15?: RigPlayability;
  }
  ```
  And add the new field to `LocalMotionComparison`:
  ```typescript
    /**
     * Present only when the Studio plugin ran a live playback probe on stock R6/R15 dummies for
     * this comparison. Absent means "not checked" — never read as a failure.
     */
    playability?: { source: AnimationPlayability; candidate: AnimationPlayability };
  ```

- [ ] **Step 2 — Write the failing component test.** The component's early-return branch (`if (!bridgeClient || !project) { ... }`, `AnimationSnapshotsPanel.tsx:124`) shows a "Desktop bridge not connected" sample preview and never reaches the `latestComparison` rendering the new playability block lives in — passing `bridgeClient={null}` would test that disconnected branch, not this feature. Use a cast fake bridge client instead, the same pattern `LocalProjectWorkspace.ownership.test.tsx` already uses (`return client as unknown as LocalBridgeClient;`). The component's `refresh()` (called on mount via `useEffect`) calls `bridgeClient.listAnimationSnapshots(project.projectId)`, so the fake must resolve that call. Create `frontend/src/components/AnimationSnapshotsPanel.playability.test.tsx`:
  ```typescript
  import { describe, expect, it, vi } from 'vitest';
  import { render, screen } from '@testing-library/react';
  import { AnimationSnapshotsPanel } from './AnimationSnapshotsPanel';
  import type { LocalBridgeClient, LocalMotionComparison, LocalProjectSummary } from '../bridge/localBridge';

  function makeBridgeClient(): LocalBridgeClient {
    const client = {
      listAnimationSnapshots: vi.fn().mockResolvedValue({ items: [] }),
      captureAnimationSnapshot: vi.fn(),
    };
    return client as unknown as LocalBridgeClient;
  }

  const PROJECT: LocalProjectSummary = { projectId: 1, name: 'Test Project' };

  function comparison(overrides: Partial<LocalMotionComparison>): LocalMotionComparison {
    return {
      id: 'cmp-1', projectId: 1, sourceAssetId: '1001', candidateAssetId: '1002',
      sourceName: 'Walk', candidateName: 'Walk Candidate',
      sourceDuration: 1, candidateDuration: 1,
      sourceFingerprint: 'fp1', candidateFingerprint: 'fp2',
      overallPercent: 100, posePercent: 100, timingPercent: 100, coveragePercent: 100,
      exactCurveData: true, verdict: 'EXACT_CURVE_DATA', algorithmVersion: 'motion-v2',
      createdAt: new Date().toISOString(), result: {},
      ...overrides,
    };
  }

  describe('AnimationSnapshotsPanel playability evidence', () => {
    // EvidenceBasisMark renders with `compact` here (Task 3 Step 4), which suppresses its text
    // label — only the icon renders, wrapped in a <span title={description}>. The title is set
    // unconditionally regardless of `compact`, so it's what these tests query to tell VERIFIED
    // apart from NOT_VERIFIED; the outcome wording ("Plays clean" / error text / "Not checked")
    // comes from Task 3 Step 4's own <small>, not from EvidenceBasisMark, and is asserted directly.
    it('shows Not verified when no playability report exists', () => {
      render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({})} />);
      expect(screen.getAllByTitle(/did not or cannot check this/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/not checked/i).length).toBeGreaterThan(0);
    });

    it('shows a clean-pass outcome as Verified, not a bare success mark alone', () => {
      render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
        playability: {
          source: { r6: { ok: true }, r15: { ok: true } },
          candidate: { r6: { ok: true }, r15: { ok: true } },
        },
      })} />);
      expect(screen.getAllByTitle(/computed by creatorflow/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/plays clean/i).length).toBeGreaterThan(0);
    });

    it('shows an engine error as Verified with failed wording, never a bare success mark', () => {
      render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
        playability: {
          source: { r6: { ok: false, error: 'Motion could not bind to R6.' }, r15: { ok: true } },
          candidate: { r6: { ok: true }, r15: { ok: true } },
        },
      })} />);
      // getByText already throws if no match exists — a complete assertion on its own. No
      // .toBeInTheDocument() wrapper: this project has no jest-dom dependency or setupFiles
      // entry anywhere (checked frontend/package.json and vitest.config.ts), so that matcher
      // doesn't exist here and would throw a different error than the one being tested for.
      screen.getByText(/motion could not bind to r6/i);
    });

    it('shows Not verified for a rig whose probe never ran, distinct from one that ran and failed', () => {
      // r6 is entirely absent (rig fetch failed) — must read NOT_VERIFIED, not a failed VERIFIED.
      render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
        playability: {
          source: { r15: { ok: true } },
          candidate: { r6: { ok: true }, r15: { ok: true } },
        },
      })} />);
      expect(screen.getAllByText(/not checked/i).length).toBeGreaterThan(0);
    });
  });
  ```

- [ ] **Step 3 — Run it to verify it fails.**
  ```bash
  npm --prefix frontend run test -- AnimationSnapshotsPanel.playability
  ```
  Expected: FAIL — `AnimationSnapshotsPanel` renders nothing for `playability` today; none of the `getAllByText`/`getByText` matches exist yet.

- [ ] **Step 4 — Add the rendering.** In `frontend/src/components/AnimationSnapshotsPanel.tsx`, import `EvidenceBasisMark`:
  ```typescript
  import { EvidenceBasisMark } from './EvidenceBasisMark';
  ```
  Then, inside the `.map((clip) => (...))` block that renders each side (source/candidate) — the block containing `<div className="animation-snapshots-side-id">` — add a playability block, reading each side's report by key (`clip.side` is `'source' | 'candidate'`):
  ```tsx
  <div className="animation-snapshots-side" key={clip.side}>
    <div className="animation-snapshots-side-id">
      <strong>{clip.name}</strong>
      <small>{clip.label} · ID {clip.id}</small>
    </div>
    {(() => {
      const report = latestComparison?.playability?.[clip.side];
      return (
        <div className="animation-snapshots-side-playability">
          {(['r6', 'r15'] as const).map((rig) => {
            const rigResult = report?.[rig];
            return (
              <div key={rig} className="animation-snapshots-playability-row">
                <span className="animation-snapshots-playability-label">{rig.toUpperCase()}</span>
                <EvidenceBasisMark basis={rigResult ? 'VERIFIED' : 'NOT_VERIFIED'} compact />
                <small>
                  {!rigResult
                    ? 'Not checked'
                    : rigResult.ok
                      ? 'Plays clean'
                      : rigResult.error ?? 'Playback error'}
                </small>
              </div>
            );
          })}
        </div>
      );
    })()}
    <div className="animation-snapshots-side-actions">
      {KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={busy !== null}
          onClick={() => { void pin(clip.side, kind); }}
        >
          {busy === `${clip.side}:${kind}` ? 'Pinning…' : snapshotKindLabel(kind)}
        </button>
      ))}
    </div>
  </div>
  ```
  This keeps the existing `animation-snapshots-side-id` and `-actions` blocks unchanged and inserts the new playability block between them.

- [ ] **Step 5 — Run the test again; verify it passes.**
  ```bash
  npm --prefix frontend run test -- AnimationSnapshotsPanel.playability
  ```
  Expected: PASS.

- [ ] **Step 6 — Run the full frontend test suite.**
  ```bash
  npm --prefix frontend run test
  ```
  Expected: all pass, including existing `AnimationSnapshotsPanel`-adjacent tests in `MotionComparisonLab.test.ts` (which construct `LocalMotionComparison` fixtures without `playability` — must still pass since the field is optional).

- [ ] **Step 7 — Add minimal styling.** In `frontend/src/components/AnimationSnapshotsPanel.css`, add:
  ```css
  .animation-snapshots-side-playability {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 8px 0;
  }

  .animation-snapshots-playability-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .animation-snapshots-playability-label {
    font-weight: 600;
    font-size: 11px;
    min-width: 28px;
  }
  ```

- [ ] **Step 8 — Commit.**
  ```bash
  git add frontend/src/bridge/localBridge.ts \
          frontend/src/components/AnimationSnapshotsPanel.tsx \
          frontend/src/components/AnimationSnapshotsPanel.css \
          frontend/src/components/AnimationSnapshotsPanel.playability.test.tsx
  git commit -m "feat(frontend): render playability evidence per rig on the comparison panel"
  ```

---

## Task 4 — Full-suite verification and PR

**Files:** none (verification only).

- [ ] **Step 1 — Run the full Java suite.**
  ```bash
  mvn -pl desktop -am test
  ```
  Expected: all pass.

- [ ] **Step 2 — Run the full frontend suite including e2e.** Source-level checks (vitest, typecheck) run against source and cannot see bugs that only exist in the built bundle — this project has hit that gap before with a CJS/ESM interop bug in generated validator code that only broke under the real bundler, invisible to every source-level check. Run the built-bundle e2e suite too, not just vitest:
  ```bash
  npm --prefix frontend run build
  npx --prefix frontend playwright test
  ```
  Expected: all pass.

- [ ] **Step 3 — Manual live-Studio smoke test.** Repeat Task 1 Step 5's manual verification end-to-end: pair the updated plugin, run a real Compare, confirm the desktop workspace's Animation Snapshots panel shows the new playability rows for both R6 and R15, for both source and candidate.

- [ ] **Step 4 — Push and open the PR.**
  ```bash
  git push -u origin claude/phaseB-runtime-playability
  gh pr create --title "Phase B: runtime playability probe" --body "..."
  ```
  Body should summarize: what Phase B checks and why (link the spec), the explicit v1 scope boundary (no gate integration, no Priority-honoring verification), and the manual live-Studio verification performed in Step 3 (automated tests cannot cover the Luau plugin side).
