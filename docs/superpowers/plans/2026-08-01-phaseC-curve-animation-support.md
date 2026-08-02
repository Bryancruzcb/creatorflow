# Phase C — CurveAnimation Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** stop hard-rejecting `CurveAnimation` assets — sample their position/rotation
data at fixed intervals and bake it into the same pose format `KeyframeSequence`
already produces, so the existing comparison engine handles both with zero changes to
that engine, while honestly tracking which side of a comparison was sampled vs. read
exactly.

**Architecture:** `readAnimation` gains a dispatch: `KeyframeSequence` clips take the
existing unchanged path; `CurveAnimation` clips take a new sampling path
(`normalizeCurveAnimation`). Both produce the identical `{time, poses}` shape;
`readAnimation` also returns which path it took as a 4th value (`kind`), submitted to
the desktop bridge as new top-level `sourceKind`/`candidateKind` wire fields (same
additive-field pattern Phase B's `playability` used), persisted, and surfaced in the
UI. If sampling turns out not to be deterministic, snapshot pinning is blocked for
`CURVE_SAMPLED` sides — enforced server-side, not just in the UI — so a stale
fingerprint can never report a false "this animation changed."

**Tech Stack:** Luau (Studio plugin), Java 21 (desktop bridge + SQLite), React 19 +
TypeScript + Vitest/RTL (frontend).

**Spec:** `docs/superpowers/specs/2026-08-01-phaseC-curve-animation-design.md`

## Global Constraints

- **Sampled is not exact and must never be shown as if it were.** Every comparison
  involving a `CURVE_SAMPLED` side carries that provenance through to the UI.
- **v1 scope: position/rotation curves on rig-joint-equivalent paths only.** A curve
  animation with zero such channels is rejected with a clear reason.
- **No changes to `MotionComparisonEngine`, `MotionComparisonEngineV2`, or
  `NormalizedAnimation`.** A curve-sampled clip must be indistinguishable from a
  keyframe clip at that layer.
- **`sourceKind`/`candidateKind` are new top-level sibling wire fields, never nested
  inside `source`/`candidate`.** `LocalBridgeServer.parseMotionRequest` deserializes
  those straight into `NormalizedAnimation` via Jackson, whose `ObjectMapper` does not
  disable `FAIL_ON_UNKNOWN_PROPERTIES` — an unknown nested field throws on every
  submission.
- **Snapshot pinning for `CURVE_SAMPLED` sides defaults to blocked, enforced
  server-side, not just via a disabled button** — until Task 0 confirms sampling is
  genuinely deterministic. A disabled button alone is bypassable (stale tab, direct API
  call), and a false "your animation changed" report from sampling noise is exactly the
  class of error this app treats as its worst possible output.
- **No wire schema-string bump.** `creatorflow.roblox-motion/v0.1` stays unchanged —
  same reasoning as Phase B: the connect handshake does a strict schema match, and every
  new field here is additive.
- **No Luau test framework is introduced.** Pure logic gets a self-check on script
  load, following the `Playability_selfTest`/`dedupeMarkerNames` precedent Phase B
  established. The real curve-sampling behavior is manually-verified live-Studio, not
  automated.

---

## Task 0 (GATE) — Feasibility spike: how does `CurveAnimation` actually expose its data?

**Nothing in Tasks 1–4 is built until this answers Steps 2 and 4.** Unlike Phase A/B,
where the general mechanism was well understood and only specific behaviors needed
confirming, here the shape of the solution itself depends on a Roblox API this project
has only medium confidence about.

**Files:** none committed — a throwaway script in Studio's command bar, findings
written to `docs/superpowers/plans/2026-08-01-phaseC-task0-spike-note.md`.

- [ ] **Step 1 — Get a real `CurveAnimation` asset to test against.** Author one via
      Roblox's Animation Editor, or find a public one via the Toolbox. Confirm
      `clip:IsA("CurveAnimation")` is true for it via
      `AnimationClipProvider:GetAnimationClipAsync("rbxassetid://" .. testAnimationId)`.
- [ ] **Step 2 — Confirm the read API.** In Studio's command bar, inspect the returned
      `CurveAnimation` instance directly:
      ```lua
      local clip = game:GetService("AnimationClipProvider"):GetAnimationClipAsync("rbxassetid://" .. testAnimationId)
      print(clip.ClassName)
      for _, child in ipairs(clip:GetChildren()) do
          print(" ", child.Name, child.ClassName)
          for _, grandchild in ipairs(child:GetChildren()) do
              print("   ", grandchild.Name, grandchild.ClassName)
          end
      end
      ```
      Record the real hierarchy this prints — what represents a joint path, what
      represents a curve, and what method/property on that curve object returns a
      value at an arbitrary time (Roblox's curve objects are expected to expose some
      form of time-based evaluation — record its exact name and signature, do not
      assume it matches any guess made before this step).
- [ ] **Step 3 — Confirm `Loop`/`Priority` equivalents exist.**
      `normalizeKeyframeSequence` reads `clip.Loop` and `clip.Priority.Name` directly
      off a `KeyframeSequence`. Try the same on the `CurveAnimation` instance from Step
      1 (`print(clip.Loop)`, `print(clip.Priority)`) and record whether they exist with
      the same names/types. **This choice is not cosmetic**: whatever `looped` value
      `normalizeCurveAnimation` ends up producing becomes `declaredLooped` in
      `probePlayability(sourceId, "R6", source.looped, sourceMarkers)`
      (`roblox-plugin/desktop-bridge/CreatorFlowAnimationBridge.lua:893-899`), compared
      against the real engine-observed `track.Looped` from actual playback
      (`local loopHonored = engineLooped == declaredLooped`, line 249 of that same
      file). If no reliable equivalent exists, record that explicitly — Task 1 Step 3
      below has a fallback that skips the loop-honored check entirely for
      `CURVE_SAMPLED` clips rather than guess at a default likely to be wrong.
- [ ] **Step 4 — Confirm sampling is deterministic.** Using the time-evaluation method
      found in Step 2, read the same curve at the same time value twice in a row, and
      again in a second, separate command-bar execution. Record whether the output is
      bit-identical every time.
- [ ] **Step 5 — Pick a concrete sample rate.** Balance fidelity against
      `MAX_POSES`/`MAX_REQUEST_BYTES`
      (`roblox-plugin/desktop-bridge/CreatorFlowAnimationBridge.lua:14-15`, currently
      20,000 poses / 2 MiB) for a realistic multi-second clip. Record the chosen
      samples-per-second value and the reasoning.
- [ ] **Step 6 — Write the confirmed contract.** `docs/superpowers/plans/2026-08-01-phaseC-task0-spike-note.md`
      recording: the real read API (Step 2, with exact method/property names), the
      `Loop`/`Priority` answer (Step 3), the determinism verdict (Step 4), and the
      chosen sample rate (Step 5). **This note is what Task 1 Step 3 codes against.**
- [ ] **Step 7 — Commit the note.**
      ```bash
      git add docs/superpowers/plans/2026-08-01-phaseC-task0-spike-note.md
      git commit -m "docs: Phase C Task 0 spike findings -- CurveAnimation read API, determinism, sample rate"
      ```

**Completion test:** the note has a clear, real answer for Steps 2 and 4. If Step 4
finds sampling is not bit-identical even after the existing `roundNumber`/
`ROUNDING_SCALE` rounding absorbs small differences, that is not a reason to abandon
the phase — Task 1 Step 3 and Task 2 Step 7 below already default to the safe,
disclosed-limitation behavior for exactly that case.

---

## Task 1 — Plugin: sample CurveAnimation into the existing pose format

**Files:**
- Modify: `roblox-plugin/desktop-bridge/CreatorFlowAnimationBridge.lua`

**Interfaces:**
- Consumes: Task 0's spike note (the real curve-read API, the `Loop`/`Priority`
  answer, the determinism verdict, the chosen sample rate).
- Produces: `readAnimation(assetId)` now returns 4 values —
  `(normalized, counters, markers, kind)` where `kind` is the literal string
  `"KEYFRAME"` or `"CURVE_SAMPLED"` — instead of the 3 values it returns today.
  `compareButton.Activated` captures this as `sourceKind`/`candidateKind` and includes
  both as new top-level fields in the JSON body sent to
  `/plugin/v1/motion-comparisons`, consumed by Task 2.

- [ ] **Step 1 — Replace the CurveAnimation rejection with a dispatch.** In
      `readAnimation` (`CreatorFlowAnimationBridge.lua:809-828` today), change:
      ```lua
      local clip = clipOrError
      if clip:IsA("CurveAnimation") then
          clip:Destroy()
          error(
              "Animation "
                  .. assetId
                  .. " is a CurveAnimation. CreatorFlow v0.1 compares KeyframeSequence assets only; curve-channel normalization is planned separately.",
              0
          )
      end
      if not clip:IsA("KeyframeSequence") then
          local className = clip.ClassName
          clip:Destroy()
          error("Animation " .. assetId .. " returned unsupported clip type " .. className .. ".", 0)
      end

      local normalizedOk, normalized, counters, markers = pcall(normalizeKeyframeSequence, assetId, clip)
      clip:Destroy()
      if not normalizedOk then
          error(errorText(normalized), 0)
      end
      return normalized, counters, markers
      ```
      to:
      ```lua
      local clip = clipOrError
      local isCurve = clip:IsA("CurveAnimation")
      if not isCurve and not clip:IsA("KeyframeSequence") then
          local className = clip.ClassName
          clip:Destroy()
          error("Animation " .. assetId .. " returned unsupported clip type " .. className .. ".", 0)
      end

      local normalizeFn = isCurve and normalizeCurveAnimation or normalizeKeyframeSequence
      local normalizedOk, normalized, counters, markers = pcall(normalizeFn, assetId, clip)
      clip:Destroy()
      if not normalizedOk then
          error(errorText(normalized), 0)
      end
      return normalized, counters, markers, (isCurve and "CURVE_SAMPLED" or "KEYFRAME")
      ```

- [ ] **Step 2 — Add the sampling self-check scaffold.** Immediately after
      `Playability_selfTest`'s definition (`CreatorFlowAnimationBridge.lua:175-188`),
      add a constant for the sample rate and a self-check for the pure interval-math
      piece — the part that doesn't depend on Task 0's actual curve-read API:
      ```lua
      local CURVE_SAMPLES_PER_SECOND = <SAMPLE_RATE> -- from Task 0's spike note, Step 5

      local function sampleTimesFor(duration)
          if duration <= 0 then
              return { 0 }
          end
          local times = {}
          local step = 1 / CURVE_SAMPLES_PER_SECOND
          local t = 0
          while t < duration do
              table.insert(times, t)
              t += step
          end
          table.insert(times, duration)
          return times
      end

      local function CurveSampling_selfTest()
          local passed = true
          local times = sampleTimesFor(0)
          if #times ~= 1 or times[1] ~= 0 then
              warn("[CreatorFlow] Curve sampling self-test FAILED: sampleTimesFor(0) must return a single 0 sample.")
              passed = false
          end
          local nonEmpty = sampleTimesFor(1)
          if #nonEmpty < 2 or nonEmpty[1] ~= 0 or nonEmpty[#nonEmpty] ~= 1 then
              warn("[CreatorFlow] Curve sampling self-test FAILED: sampleTimesFor(1) must start at 0 and end at the duration.")
              passed = false
          end
          return passed
      end

      if not CurveSampling_selfTest() then
          warn("[CreatorFlow] Curve sampling self-test failed -- sampled comparisons may be unreliable.")
      end
      ```
      Replace `<SAMPLE_RATE>` with the real number from Task 0's note before
      committing — do not leave the placeholder in committed code.

- [ ] **Step 3 — Add `normalizeCurveAnimation`, coded against Task 0's confirmed
      contract.** This function's *shape* (inputs, output, rounding, determinism) is
      fixed by this plan; its *body* — the actual Roblox API calls that enumerate
      joint paths and evaluate a curve at a time value — must use the real method and
      property names Task 0's spike note recorded in Step 2, not any guess made before
      that note existed. Structure:
      ```lua
      local function normalizeCurveAnimation(assetId, clip)
          -- Enumerate joint paths and their curve data using the real API from Task 0's
          -- spike note (Step 2). Replace this line with that confirmed traversal --
          -- do not guess at method names not recorded in the note.
          local channelsByPath = <TASK_0_CONFIRMED_ENUMERATION>(clip)

          local duration = <TASK_0_CONFIRMED_DURATION_READ>(clip)
          if duration <= 0 then
              error("Animation " .. assetId .. " has no duration to sample.", 0)
          end

          local hasAnyChannel = false
          for _ in pairs(channelsByPath) do
              hasAnyChannel = true
              break
          end
          if not hasAnyChannel then
              error("Animation " .. assetId .. " has no position/rotation curve channels CreatorFlow can compare.", 0)
          end

          local normalizedKeyframes = {}
          local counters = { poses = 0 }
          for _, time in ipairs(sampleTimesFor(duration)) do
              local poses = {}
              local seenPaths = {}
              for jointPath, channel in pairs(channelsByPath) do
                  -- <TASK_0_CONFIRMED_EVALUATION>(channel, time) must return a CFrame
                  -- (or the 12 raw components) at this sample time -- the exact call
                  -- and return shape come from Task 0's spike note, Step 2.
                  local sampledCFrame = <TASK_0_CONFIRMED_EVALUATION>(channel, time)
                  local components = { sampledCFrame:GetComponents() }
                  for index, value in ipairs(components) do
                      components[index] = roundNumber(value, jointPath)
                  end
                  seenPaths[jointPath] = true
                  table.insert(poses, {
                      jointPath = jointPath,
                      transform = components,
                      weight = 1, -- sampled data has no authored blend weight; full weight is the honest default
                      easingStyle = "Linear", -- interpolation between authored keyframes doesn't apply to a
                      easingDirection = "InOut", -- value sampled directly off a continuous curve -- see spec
                  })
                  counters.poses += 1
                  if counters.poses > MAX_POSES then
                      error(string.format("Animation exceeds the v0.1 safety limit of %d poses.", MAX_POSES), 0)
                  end
              end
              table.sort(poses, function(a, b) return a.jointPath < b.jointPath end)
              table.insert(normalizedKeyframes, { time = roundNumber(time, "keyframe time"), poses = poses })
          end

          -- Loop/Priority: per Task 0's Step 3 finding. If CurveAnimation exposes the
          -- same properties KeyframeSequence does, read them the same way:
          --     looped = clip.Loop, priority = clip.Priority.Name
          -- If Task 0 found no reliable equivalent, use nil for looped (probePlayability
          -- must then skip the loop-honored check for CURVE_SAMPLED clips rather than
          -- compare against a guessed default -- see Task 1 Step 4 below) and "Movement"
          -- for priority (KeyframeSequence's own default when authored without a choice).
          return {
              assetId = assetId,
              name = clip.Name,
              duration = roundNumber(duration, "duration"),
              looped = <TASK_0_CONFIRMED_LOOP_VALUE_OR_NIL>,
              priority = <TASK_0_CONFIRMED_PRIORITY_OR_"Movement">,
              keyframes = normalizedKeyframes,
          }, counters, {} -- markers: CurveAnimation has no per-keyframe marker concept: see spec, Components
      end
      ```
      Place this function immediately after `normalizeKeyframeSequence`'s own
      definition (`CreatorFlowAnimationBridge.lua:738-793` today), since it must be
      declared before `readAnimation` (which now references it) captures it as an
      upvalue — same Lua declaration-order requirement Phase B's functions followed.

- [ ] **Step 4 — Handle a `nil` `looped` in `probePlayability`.** If Task 0 Step 3
      found no reliable Loop equivalent, `source.looped`/`candidate.looped` may now be
      `nil` for a curve-sourced clip. `probePlayability`
      (`CreatorFlowAnimationBridge.lua:205-272`) currently always compares
      `engineLooped == declaredLooped`. Change the loop-honored check to skip when
      `declaredLooped` is `nil`:
      ```lua
      local loopHonored = declaredLooped == nil or engineLooped == declaredLooped
      ```
      If Task 0 Step 3 found a real equivalent instead, skip this step — the existing
      comparison is correct as-is once `normalizeCurveAnimation` supplies a real
      boolean.

- [ ] **Step 5 — Update `compareButton.Activated`'s wiring.** Phase B's
      `readAnimation` returns 3 values; Task 1 Step 1 above makes it 4 (adding
      `kind`). Change the existing capture:
      ```lua
      local source, sourceCounts, sourceMarkers = readAnimation(sourceId)
      ```
      to:
      ```lua
      local source, sourceCounts, sourceMarkers, sourceKind = readAnimation(sourceId)
      ```
      and identically for `candidate`/`candidateCounts`/`candidateMarkers`/
      `candidateKind`. Then change the `HttpService:JSONEncode({...})` call:
      ```lua
      local body = HttpService:JSONEncode({
          schema = SCHEMA,
          source = source,
          candidate = candidate,
          playability = playability,
      })
      ```
      to:
      ```lua
      local body = HttpService:JSONEncode({
          schema = SCHEMA,
          source = source,
          candidate = candidate,
          playability = playability,
          sourceKind = sourceKind,
          candidateKind = candidateKind,
      })
      ```

- [ ] **Step 6 — Manual live-Studio verification.** Install the updated plugin, pair
      with a running desktop app, and run a real Compare where at least one side is
      the `CurveAnimation` asset from Task 0 Step 1. Confirm in Studio's Output window:
      no uncaught errors, and (temporarily add `print(HttpService:JSONEncode({...}))`
      before the `request(...)` call, remove after) the POST body contains
      `sourceKind`/`candidateKind` set correctly for each side.

- [ ] **Step 7 — Commit.**
      ```bash
      git add roblox-plugin/desktop-bridge/CreatorFlowAnimationBridge.lua
      git commit -m "feat(plugin): sample CurveAnimation into the existing pose format"
      ```

---

## Task 2 — Desktop bridge: parse, persist, and guard clip provenance

**Files:**
- Create: `desktop/src/main/resources/creatorflow/db/migrations/V014__animation_comparison_clip_kind.sql`
- Modify: `desktop/src/main/java/creatorflow/db/SchemaMigrator.java`
- Modify: `desktop/src/main/java/creatorflow/workflow/AnimationComparisonRecord.java`
- Modify: `desktop/src/main/java/creatorflow/db/AnimationComparisonRepository.java`
- Modify: `desktop/src/main/java/creatorflow/bridge/LocalBridgeServer.java`
- Test: `desktop/src/test/java/creatorflow/db/AnimationComparisonRepositoryTest.java`
- Test: `desktop/src/test/java/creatorflow/bridge/LocalBridgeServerTest.java`

**Interfaces:**
- Consumes: the plugin's wire payload from Task 1 — top-level `sourceKind`/
  `candidateKind` string fields, each `"KEYFRAME"` or `"CURVE_SAMPLED"` (or absent, for
  comparisons predating this phase).
- Produces: `AnimationComparisonRecord.sourceClipKind()`/`candidateClipKind()` return
  `Optional<String>`; the comparison view JSON gains `"sourceKind"`/`"candidateKind"`
  keys (present only when recorded); the animation-snapshot capture endpoint rejects a
  `CURVE_SAMPLED` side unless `CURVE_SAMPLED_SNAPSHOTS_ALLOWED` (a constant this task
  adds) is `true`.

- [ ] **Step 1 — Write the failing repository test.** Add to
      `desktop/src/test/java/creatorflow/db/AnimationComparisonRepositoryTest.java`:
      ```java
      @Test
      void roundTripsOptionalClipKinds() {
          AnimationComparisonRecord withKinds = repo.insert(projectId, "5001", "5002", "Walk", "Walk",
                  1.0, 1.0, "fp5", "fp6", 100, 100, 100, 100, true,
                  "{\"verdict\":\"MATCH\"}", "motion-v2", PlaybackSettings.unknown(), PlaybackSettings.unknown(),
                  null, "KEYFRAME", "CURVE_SAMPLED");
          assertEquals(Optional.of("KEYFRAME"), withKinds.sourceClipKind());
          assertEquals(Optional.of("CURVE_SAMPLED"), withKinds.candidateClipKind());

          AnimationComparisonRecord withoutKinds = repo.insert(projectId, "6001", "6002", "Run", "Run",
                  1.0, 1.0, "fp7", "fp8", 100, 100, 100, 100, true,
                  "{\"verdict\":\"MATCH\"}", "motion-v2", PlaybackSettings.unknown(), PlaybackSettings.unknown(),
                  null, null, null);
          assertEquals(Optional.empty(), withoutKinds.sourceClipKind());
          assertEquals(Optional.empty(), withoutKinds.candidateClipKind());

          assertEquals(Optional.of("KEYFRAME"), repo.findById(withKinds.id()).orElseThrow().sourceClipKind());
      }
      ```
      This adds two new trailing parameters to `insert(...)` (after the existing
      `playabilityJson` parameter Phase B added) — `sourceClipKind`, `candidateClipKind`.

- [ ] **Step 2 — Run it to verify it fails.**
      ```bash
      export JAVA_HOME="C:\Program Files\Java\jdk-26"
      mvn -pl desktop -am -Dtest=AnimationComparisonRepositoryTest test
      ```
      Expected: FAIL — compile error, `insert` has no such parameters yet.

- [ ] **Step 3 — Create the migration.**
      ```sql
      ALTER TABLE animation_comparisons ADD COLUMN source_clip_kind TEXT;
      ALTER TABLE animation_comparisons ADD COLUMN candidate_clip_kind TEXT;
      ```
      Save as `desktop/src/main/resources/creatorflow/db/migrations/V014__animation_comparison_clip_kind.sql`.

- [ ] **Step 4 — Register the migration in `SchemaMigrator.MIGRATIONS`.** This list is
      hardcoded, not a directory scan — Phase B's implementation hit exactly this gap
      (a migration file with no `MIGRATIONS` entry fails at runtime with "table has no
      column" and zero compile-time warning). In `desktop/src/main/java/creatorflow/db/SchemaMigrator.java`,
      change:
      ```java
      new Migration(13, "animation_comparison_playability", "/creatorflow/db/migrations/V013__animation_comparison_playability.sql"));
      ```
      to:
      ```java
      new Migration(13, "animation_comparison_playability", "/creatorflow/db/migrations/V013__animation_comparison_playability.sql"),
      new Migration(14, "animation_comparison_clip_kind", "/creatorflow/db/migrations/V014__animation_comparison_clip_kind.sql"));
      ```

- [ ] **Step 5 — Extend `AnimationComparisonRecord`.** Add two fields and two
      accessors, after the existing `playabilityJsonRaw` field:
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
              String sourceClipKindRaw,
              String candidateClipKindRaw,
              Instant createdAt) {

          /** Raw playability JSON, if a probe ran for this comparison — absent for anything checked before this field existed. */
          public java.util.Optional<String> playabilityJson() {
              return java.util.Optional.ofNullable(playabilityJsonRaw);
          }

          /** "KEYFRAME" or "CURVE_SAMPLED" — absent for comparisons made before Phase C shipped. */
          public java.util.Optional<String> sourceClipKind() {
              return java.util.Optional.ofNullable(sourceClipKindRaw);
          }

          /** "KEYFRAME" or "CURVE_SAMPLED" — absent for comparisons made before Phase C shipped. */
          public java.util.Optional<String> candidateClipKind() {
              return java.util.Optional.ofNullable(candidateClipKindRaw);
          }
      }
      ```

- [ ] **Step 6 — Extend `AnimationComparisonRepository.insert`, the `INSERT`
      statement, and `map`.** Add two `String` parameters after the existing
      `playabilityJson` parameter:
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
                                              String playabilityJson,
                                              String sourceClipKind,
                                              String candidateClipKind) {
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
                  sourceClipKind == null || sourceClipKind.isBlank() ? null : sourceClipKind,
                  candidateClipKind == null || candidateClipKind.isBlank() ? null : candidateClipKind,
                  Instant.now());
          synchronized (connection) {
              try (PreparedStatement statement = connection.prepareStatement("""
                      INSERT INTO animation_comparisons(
                        id, project_id, source_asset_id, candidate_asset_id, source_name, candidate_name,
                        source_duration, candidate_duration, source_fingerprint, candidate_fingerprint,
                        overall_score, pose_score, timing_score, coverage_score, exact_curve_data,
                        result_json, algorithm_version, created_at,
                        source_looped, source_priority, candidate_looped, candidate_priority,
                        playability_json, source_clip_kind, candidate_clip_kind)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")) {
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
                  statement.setString(24, record.sourceClipKind().orElse(null));
                  statement.setString(25, record.candidateClipKind().orElse(null));
                  statement.executeUpdate();
                  return record;
              } catch (SQLException error) {
                  throw new IllegalStateException("Could not persist animation comparison", error);
              }
          }
      }
      ```
      And in `map(ResultSet result)`, add the two new columns before `createdAt`:
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
                  result.getString("source_clip_kind"),
                  result.getString("candidate_clip_kind"),
                  Instant.parse(result.getString("created_at")));
      }
      ```

- [ ] **Step 7 — Run the repository test; verify it passes.**
      ```bash
      mvn -pl desktop -am -Dtest=AnimationComparisonRepositoryTest test
      ```
      Expected: PASS.

- [ ] **Step 8 — Fix the other existing call site.** `WorkflowRepositoryTest.java`
      calls `repository.insert(...)` directly (Phase B hit this same gap). Add `null,
      null` as the two new trailing arguments:
      ```java
      var record = repository.insert(projectId, "1001", "1002", "Walk A", "Walk B",
              1.25, 1.18, "a".repeat(64), "b".repeat(64),
              88, 91, 76, 100, false,
              "{\"verdict\":\"MODERATE_SIMILARITY\"}", "creatorflow.motion-compare/v0.1",
              PlaybackSettings.of(true, "Movement"), PlaybackSettings.of(false, "Action"), null, null, null);
      ```

- [ ] **Step 9 — Parse the wire fields and pass them through in `LocalBridgeServer`.**
      In the `/plugin/v1/motion-comparisons` handler, after the existing `playability`
      parsing this phase's predecessor added, add:
      ```java
      String sourceKind = text(body, "sourceKind", null);
      String candidateKind = text(body, "candidateKind", null);
      ```
      and add `sourceKind, candidateKind` as two new trailing arguments to the
      `animationComparisons.insert(...)` call (after the existing `playabilityJson`
      argument).

- [ ] **Step 10 — Surface both fields in `animationComparisonView`.** After the
      existing `record.playabilityJson().ifPresent(...)` block, add:
      ```java
      record.sourceClipKind().ifPresent(kind -> view.put("sourceKind", kind));
      record.candidateClipKind().ifPresent(kind -> view.put("candidateKind", kind));
      ```

- [ ] **Step 11 — Write the failing bridge-endpoint test.** Add to
      `LocalBridgeServerTest.java`, following the existing `playability` test's
      pattern:
      ```java
      @Test
      void motionComparisonAcceptsAndReturnsOptionalClipKinds() throws Exception {
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
          String withKinds = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                  + animation.formatted("7001") + ",\"candidate\":" + animation.formatted("7002")
                  + ",\"sourceKind\":\"KEYFRAME\",\"candidateKind\":\"CURVE_SAMPLED\"}";
          HttpResponse<String> compared = pluginRequest("POST", "/plugin/v1/motion-comparisons", token, withKinds);
          assertEquals(201, compared.statusCode(), compared.body());
          assertEquals("KEYFRAME", json.readTree(compared.body()).get("sourceKind").asText());
          assertEquals("CURVE_SAMPLED", json.readTree(compared.body()).get("candidateKind").asText());

          String withoutKinds = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                  + animation.formatted("8001") + ",\"candidate\":" + animation.formatted("8002") + "}";
          HttpResponse<String> comparedNoKinds = pluginRequest(
                  "POST", "/plugin/v1/motion-comparisons", token, withoutKinds);
          assertEquals(201, comparedNoKinds.statusCode(), comparedNoKinds.body());
          assertFalse(json.readTree(comparedNoKinds.body()).has("sourceKind"));
          assertFalse(json.readTree(comparedNoKinds.body()).has("candidateKind"));
      }
      ```

- [ ] **Step 12 — Run it to verify it fails, then implement Steps 9-10 if not already
      done, then verify it passes.**
      ```bash
      mvn -pl desktop -am -Dtest=LocalBridgeServerTest#motionComparisonAcceptsAndReturnsOptionalClipKinds test
      ```
      Expected: FAIL first (parsing not wired), PASS after Steps 9-10 are in place.

- [ ] **Step 13 — Add the snapshot-pinning guard.** In `LocalBridgeServer.java`, near
      the top of the class next to other constants, add:
      ```java
      /**
       * Set to true only once Phase C's Task 0 spike confirms curve sampling is
       * genuinely deterministic run-to-run. Until then, pinning a CURVE_SAMPLED side as
       * a snapshot risks a false "this animation changed" report from sampling noise,
       * not a real change -- the worst class of output this app can produce.
       */
      private static final boolean CURVE_SAMPLED_SNAPSHOTS_ALLOWED = false;
      ```
      In the `PROJECT_ANIMATION_SNAPSHOTS` handler's `POST` branch (the
      `requireMutation` path), after loading `comparison` and before the
      `switch (side...)` block, add:
      ```java
      String requestedClipKind = "source".equalsIgnoreCase(side)
              ? comparison.sourceClipKind().orElse(null)
              : comparison.candidateClipKind().orElse(null);
      if (!CURVE_SAMPLED_SNAPSHOTS_ALLOWED && "CURVE_SAMPLED".equals(requestedClipKind)) {
          throw new HttpError(400,
                  "This side was read by sampling a CurveAnimation, not an exact keyframe read. "
                          + "Pinning it as a drift-detection reference isn't reliable yet.");
      }
      ```
      **If Task 0's spike note confirms sampling is deterministic**, change the
      constant to `true` instead of adding this restriction — do not leave a
      known-safe capability disabled.

- [ ] **Step 14 — Write the failing test for the guard.** Add to
      `LocalBridgeServerTest.java`:
      ```java
      @Test
      void animationSnapshotRejectsACurveSampledSideByDefault() throws Exception {
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
          String body = "{\"schema\":\"creatorflow.roblox-motion/v0.1\",\"source\":"
                  + animation.formatted("9001") + ",\"candidate\":" + animation.formatted("9002")
                  + ",\"sourceKind\":\"CURVE_SAMPLED\",\"candidateKind\":\"KEYFRAME\"}";
          String comparisonId = json.readTree(
                  pluginRequest("POST", "/plugin/v1/motion-comparisons", token, body).body())
                  .get("id").asText();

          HttpResponse<String> pinSource = postJson("/api/v1/projects/" + projectId + "/animation-snapshots", cookie,
                  origin.toString(), csrf, "{\"comparisonId\":\"" + comparisonId + "\",\"side\":\"source\",\"kind\":\"LAST_KNOWN_GOOD\"}");
          assertEquals(400, pinSource.statusCode());

          HttpResponse<String> pinCandidate = postJson("/api/v1/projects/" + projectId + "/animation-snapshots", cookie,
                  origin.toString(), csrf, "{\"comparisonId\":\"" + comparisonId + "\",\"side\":\"candidate\",\"kind\":\"LAST_KNOWN_GOOD\"}");
          assertEquals(201, pinCandidate.statusCode(), pinCandidate.body());
      }
      ```
      Uses the existing `postJson(path, cookie, origin, csrf, body)` helper
      (`LocalBridgeServerTest.java:1051-1060`) — distinct from the body-less `post(...)`
      used above for `project-picker`/`plugin-pairings`, which don't take a body.

- [ ] **Step 15 — Run it to verify it fails, implement Step 13 if not already done,
      verify it passes, then run the full desktop suite.**
      ```bash
      mvn -pl desktop -am -Dtest=LocalBridgeServerTest#animationSnapshotRejectsACurveSampledSideByDefault test
      mvn -pl desktop -am test
      ```
      Expected: all tests pass.

- [ ] **Step 16 — Commit.**
      ```bash
      git add desktop/src/main/resources/creatorflow/db/migrations/V014__animation_comparison_clip_kind.sql \
              desktop/src/main/java/creatorflow/db/SchemaMigrator.java \
              desktop/src/main/java/creatorflow/workflow/AnimationComparisonRecord.java \
              desktop/src/main/java/creatorflow/db/AnimationComparisonRepository.java \
              desktop/src/main/java/creatorflow/bridge/LocalBridgeServer.java \
              desktop/src/test/java/creatorflow/bridge/LocalBridgeServerTest.java \
              desktop/src/test/java/creatorflow/db/AnimationComparisonRepositoryTest.java \
              desktop/src/test/java/creatorflow/db/WorkflowRepositoryTest.java
      git commit -m "feat(desktop): parse/persist clip provenance, block curve-sampled snapshot pinning by default"
      ```

---

## Task 3 — Frontend: show clip provenance, disable pinning for sampled sides

**Files:**
- Modify: `frontend/src/bridge/localBridge.ts`
- Modify: `frontend/src/components/AnimationSnapshotsPanel.tsx`
- Test: `frontend/src/components/AnimationSnapshotsPanel.clipKind.test.tsx` (new)

**Interfaces:**
- Consumes: `LocalMotionComparison.sourceKind`/`candidateKind` (new optional fields,
  each `"KEYFRAME" | "CURVE_SAMPLED"`).
- Produces: a provenance label per side, and (matching Task 2's default-blocked
  server-side guard) disabled Pin buttons for a `CURVE_SAMPLED` side with a stated
  reason, so the UI doesn't offer an action the server will reject anyway.

- [ ] **Step 1 — Extend `LocalMotionComparison`.** In `frontend/src/bridge/localBridge.ts`,
      add after the existing `playability?` field:
      ```typescript
        /**
         * "KEYFRAME" (read directly from a KeyframeSequence) or "CURVE_SAMPLED"
         * (baked from sampling a CurveAnimation at fixed intervals — an approximation,
         * never as exact as a direct keyframe read). Absent for comparisons made
         * before this field existed.
         */
        sourceKind?: 'KEYFRAME' | 'CURVE_SAMPLED';
        candidateKind?: 'KEYFRAME' | 'CURVE_SAMPLED';
      ```

- [ ] **Step 2 — Write the failing component test.** Create
      `frontend/src/components/AnimationSnapshotsPanel.clipKind.test.tsx`:
      ```typescript
      // @vitest-environment jsdom
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

      describe('AnimationSnapshotsPanel clip provenance', () => {
        // This case is a regression guard, not a RED/GREEN test: absent clip kind means
        // "behave exactly like before this feature existed," so both assertions are true
        // whether or not Step 4's rendering has been added yet. It won't fail in Step 3 --
        // that's expected, unlike the other two tests below, which do fail until Step 4 lands.
        it('shows no provenance label and enables pinning when clip kind is absent', () => {
          render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({})} />);
          expect(screen.queryByText(/sampled from a curve/i)).toBeNull();
          const pinButtons = screen.getAllByRole('button', { name: /last known good|last published/i });
          expect(pinButtons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
        });

        it('shows a sampled-data qualifier and disables pinning for a CURVE_SAMPLED side', () => {
          render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
            sourceKind: 'CURVE_SAMPLED',
            candidateKind: 'KEYFRAME',
          })} />);
          expect(screen.getAllByText(/sampled from a curve/i).length).toBeGreaterThan(0);
          const sourcePinButtons = screen.getAllByRole('button', { name: /last known good|last published/i });
          expect(sourcePinButtons.some((button) => (button as HTMLButtonElement).disabled)).toBe(true);
        });

        it('leaves a KEYFRAME side fully pinnable', () => {
          render(<AnimationSnapshotsPanel bridgeClient={makeBridgeClient()} project={PROJECT} latestComparison={comparison({
            sourceKind: 'KEYFRAME',
            candidateKind: 'KEYFRAME',
          })} />);
          expect(screen.queryByText(/sampled from a curve/i)).toBeNull();
        });
      });
      ```
      Fix the first test's placeholder assertion in the next step once the real
      rendering exists to check against — for now this file establishes RED for the
      real assertions in tests 2 and 3.

- [ ] **Step 3 — Run it to verify it fails.**
      ```bash
      cd frontend && npx vitest run AnimationSnapshotsPanel.clipKind
      ```
      Expected: FAIL — no rendering exists yet for either assertion.

- [ ] **Step 4 — Add the rendering.** In
      `frontend/src/components/AnimationSnapshotsPanel.tsx`, inside the
      `.map((clip) => (...))` block (the same one Phase B's playability rendering
      lives in), add a provenance check and thread it into both the qualifier text and
      the Pin buttons' `disabled` state:
      ```tsx
      <div className="animation-snapshots-side" key={clip.side}>
        <div className="animation-snapshots-side-id">
          <strong>{clip.name}</strong>
          <small>{clip.label} · ID {clip.id}</small>
        </div>
        {(() => {
          const clipKind = clip.side === 'source' ? latestComparison?.sourceKind : latestComparison?.candidateKind;
          return clipKind === 'CURVE_SAMPLED' ? (
            <p className="animation-snapshots-sampled-note">Sampled from a curve — not an exact read.</p>
          ) : null;
        })()}
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
          {KINDS.map((kind) => {
            const clipKind = clip.side === 'source' ? latestComparison?.sourceKind : latestComparison?.candidateKind;
            const sampledAndBlocked = clipKind === 'CURVE_SAMPLED';
            return (
              <button
                key={kind}
                type="button"
                disabled={busy !== null || sampledAndBlocked}
                title={sampledAndBlocked ? "Sampled data isn't stable enough to detect drift reliably yet." : undefined}
                onClick={() => { void pin(clip.side, kind); }}
              >
                {busy === `${clip.side}:${kind}` ? 'Pinning…' : snapshotKindLabel(kind)}
              </button>
            );
          })}
        </div>
      </div>
      ```
      This replaces the existing `<div className="animation-snapshots-side-actions">`
      block's contents (the `KINDS.map(...)` button list) and adds the new provenance
      `<p>` before the existing playability block.

- [ ] **Step 5 — Run the test again; verify tests 2 and 3 now pass (test 1 already
      did, per the regression-guard note above).**
      ```bash
      npx vitest run AnimationSnapshotsPanel.clipKind
      ```
      Expected: PASS, all three.

- [ ] **Step 6 — Run the full frontend suite and typecheck.**
      ```bash
      npx vitest run
      npm run typecheck
      ```
      Expected: all pass, including existing `AnimationSnapshotsPanel`-adjacent tests
      (their fixtures never set `sourceKind`/`candidateKind`, so the optional-field,
      pinning-enabled default path must still work — covered by this task's own first
      test).

- [ ] **Step 7 — Minimal styling.** In
      `frontend/src/components/AnimationSnapshotsPanel.css`, add near the existing
      `.animation-snapshots-side-playability` rule (from Phase B):
      ```css
      .animation-snapshots-sampled-note {
        margin: 0;
        font-size: var(--text-2xs);
        color: var(--ink-dim);
        font-style: italic;
      }
      ```

- [ ] **Step 8 — Commit.**
      ```bash
      git add frontend/src/bridge/localBridge.ts \
              frontend/src/components/AnimationSnapshotsPanel.tsx \
              frontend/src/components/AnimationSnapshotsPanel.css \
              frontend/src/components/AnimationSnapshotsPanel.clipKind.test.tsx
      git commit -m "feat(frontend): show clip provenance, disable pinning for curve-sampled sides"
      ```

---

## Task 4 — Full-suite verification and PR

**Files:** none (verification only).

- [ ] **Step 1 — Run the full Java suite.**
      ```bash
      export JAVA_HOME="C:\Program Files\Java\jdk-26"
      mvn -pl desktop -am test
      ```
      Expected: all pass.

- [ ] **Step 2 — Run the full frontend suite, typecheck, build, and e2e against the
      built bundle.** Source-level checks alone have missed real bundler-interop bugs
      in this project before (a CJS/ESM interop bug in generated validator code that
      only broke under the real bundler) — run the built-bundle e2e suite too, not
      just vitest:
      ```bash
      cd frontend
      npx vitest run
      npm run typecheck
      npm run build
      npx playwright test
      ```
      Expected: all pass.

- [ ] **Step 3 — Manual live-Studio smoke test.** Repeat Task 1 Step 6's manual
      verification end-to-end: pair the updated plugin, run a real Compare with a
      `CurveAnimation` on at least one side, confirm the desktop workspace's Animation
      Snapshots panel shows the sampled-data qualifier and disabled Pin buttons for
      that side (or enabled, if Task 0 confirmed determinism and Task 2 Step 13 set
      `CURVE_SAMPLED_SNAPSHOTS_ALLOWED = true`).

- [ ] **Step 4 — Push and open the PR.**
      ```bash
      git push -u origin claude/phaseC-curve-animation-support
      gh pr create --title "Phase C: CurveAnimation support" --body "..."
      ```
      Body should summarize: what Phase C adds and why (link the spec), Task 0's real
      findings (the confirmed read API, determinism verdict, chosen sample rate), the
      explicit v1 scope boundary (position/rotation only, no arbitrary property
      curves), whether snapshot pinning ended up allowed or blocked for curve-sampled
      sides and why, and the manual live-Studio verification performed in Step 3.
