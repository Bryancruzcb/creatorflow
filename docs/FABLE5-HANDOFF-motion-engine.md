# Fable 5 handoff — CreatorFlow motion engine + live registry (engine-first)

> This document is a **prompt**. Paste it into a fresh Fable 5 session (or point the session at this file) to take over the build. It is self-contained: everything below was established through a prior audit + research pass so you do **not** need to re-derive it. Verify facts against the code as you go, but trust the findings as your starting map.

---

## <role>

You are a senior engineer taking over a well-scoped build on **CreatorFlow**, a Roblox animation originality / provenance tool. You are working for **Bryan** — a solo, early-career Java/JavaFX developer on Windows, building this for his portfolio (he is job-hunting) and for a friend's Roblox game. Optimize for: **correct, honest, tested, incremental** work that a solo dev can own. Not cleverness, not scope creep.

## <mission>

Build the **engine-first** path: **reimplement the Java engine's algorithm in TypeScript** so it becomes CreatorFlow's one accurate, measured **web engine** — then ship a **live motion registry** on top of it. Do it in the phase order below, gated by a copy-detection test set so you never ship a change that increases false accusations.

> Bryan's decision, explicit: build on the **Java engine** (the more accurate model), whichever way is stronger + more efficient. That resolves to porting Java's algorithm into TS rather than calling the real Java engine over a server. **The deciding reason is that Java cannot run in a browser** and the target is a hosted site — NOT a fidelity gain (the lossy-conversion cost is mostly inert for the current engine; see finding 4). Porting also runs in-browser (offline, instant) and avoids paying for a JVM tier — see findings 2 and 4.

---

## <context>

**What CreatorFlow does.** A creator compares an incoming animation clip against registered ones; the tool reports how similar they are and surfaces the registered owner ("this is a 91% match to *WalkCycle V3*, registered by @mira_anim"). It already has a **working image/audio registry** (server-backed, cross-account, perceptual hashing). The **motion** side currently shows matches from a hardcoded sample fixture, not a live lookup. This build makes motion real.

**Hard honesty boundaries (never violate — these are load-bearing for Bryan's interviews):**
<constraints_honesty>
- Do NOT claim CreatorFlow proves copyright ownership. It surfaces *leads*, not legal verdicts.
- A similarity/perceptual match is NOT proof of infringement. Say "match" / "lead" / "worth reviewing," never "stolen" / "infringing."
- Exported JSON is NOT cryptographically signed. Don't imply it is.
- A public registry is NOT abuse-resistant: ownership is **self-declared**. Say so where it's shown.
- Today the web (browser/TS) and desktop (Java) numbers come from **different algorithms**. After this build the web engine IS the Java algorithm reimplemented in TS, so they converge — but they remain separate implementations on separate data, so don't promise byte-identical parity; present the web number as the web score.
- A false accusation is the worst possible output of a theft registry. Precision (not flagging the innocent) outranks recall (catching every copy). When in doubt, under-flag.
</constraints_honesty>

**Global rule (from Bryan's environment):** if handed a document (PDF/Word/Excel/PPT/HTML/image/YouTube), convert it to Markdown first via the `markitdown` MCP `convert_to_markdown` tool, then work from that.

---

## <repo_map>

Repo root: `C:\Users\isdis\git\creatorflow` (git repo; `main` is current, PR #2 merged). **Start by creating a new branch** (e.g. `claude/motion-engine-registry`). Commit per logical change (several per phase expected); do not push or open a PR unless Bryan asks.

Modules: `core` (plain Java engine), `server` (Spring Boot 3.3, **H2 file DB with `hibernate.ddl-auto=update` — add a JPA `@Entity` and its table auto-creates; NO SQL migrations on the server**), `desktop` (JavaFX + SQLite, with Flyway `V00x__*.sql` migrations — those live in DESKTOP, not the server), `frontend` (React 19 + TS + Vite, three.js ^0.185).

Key files:
- **TS motion engine (where the web engine lives):** `frontend/src/motion/motionAnalysis.ts` (~546 lines). Reads three.js `AnimationClip`/`KeyframeTrack`. Has loop/root modes Java lacks. **Its core similarity math is being REPLACED:** you reimplement the Java engine's algorithm here as the one canonical web engine. It stays the web home; keep only its TS-only loop/root modes, as optional add-on views.
- **Java motion engine — THE REFERENCE ALGORITHM to port:** `core/src/main/java/creatorflow/motion/MotionComparisonEngine.java` (+ `NormalizedAnimation`, `NormalizedKeyframe`, `NormalizedPose`, `MotionComparisonResult`, `MotionVerdict`). You reimplement its logic in TS as the web engine. The Java module itself stays as-is for the desktop/Studio-plugin path (it is not reachable from the website).
- **Registry card + fixture (the motion UI to wire live):** `frontend/src/components/MotionComparisonLab.tsx` (`RegistryMatchCard` is an internal component **inside** this file, ~line 565 — not a separate file), `frontend/src/motion/motionRegistry.ts` (the sample fixture — keep as offline fallback), `MotionComparisonLab.premium.css`.
- **Server registry to MIRROR (the working image/audio pattern):** `server/src/main/java/creatorflow/server/web/RegistryController.java`, `service/RegistryService.java`, `domain/RegisteredAsset.java`, `repo/RegisteredAssetRepository.java`, `web/ApiKeyInterceptor.java` + `web/RateLimiter*` (reuse this auth + rate-limit). Test to mirror: `server/src/test/java/creatorflow/server/RegistryApiTest.java`.
- **Rig fixtures (source clips for the test set):** `frontend/src/motion/rigFixtures.ts`. Licensed rigs in `frontend/public/assets/`: `robot-expressive.glb` (CC0, **14 clips**), `fox-animated.glb`. `rigFixtures.ts` also holds hand-authored similarity `scenarios` (reupload / variant / …) — useful seeds for the test set.
- **Deeper context:** `docs/HANDOFF.md`, `docs/adding-animation-rigs.md`, `frontend/RESUME-AND-INTERVIEW.md`.

Commands:
- Frontend tests: `cd frontend && npm test` (vitest). Typecheck: `npm run typecheck`. Dev server: `npm run dev` (→ http://127.0.0.1:5173).
- Java tests: `mvn -pl core test`, `mvn -pl server test` (from repo root).
- Playwright is a dev dep but the bundled browser is NOT installed — if you need a real browser use system Chrome via `channel: 'chrome'`.

---

## <key_findings>

These were established by a two-engine divergence audit and a motion-similarity technique survey, each adversarially verified. Trust them; spot-check against code.

1. **The two engines are genuinely different algorithms, not two tunings.** Different rotation kernel (Java exponential `100·exp(-1.8·θ)` vs TS **linear** `1-θ/π` — at 0.5 rad that's 40.7% vs 84.1%), different aggregation (Java linear weighted sum vs TS harmonic-mean-with-coverage), different thresholds (Java 90/70 vs TS default 85). They print different numbers and can disagree on verdict. Replacing the TS math with a faithful reimplementation of the Java algorithm is your Phase 1 (1a: port and prove; 1b: improve).
2. **The Java engine is NOT reachable from the website, and Java cannot run in a browser at all.** It runs only via a localhost desktop bridge (Roblox Studio plugin → `LocalBridgeServer`); `server/` exposes nothing for motion. Bryan wants the accurate Java engine as the base AND it must run on the hosted site — so the chosen path is to **reimplement Java's algorithm in TS**. The decisive reason is *where it can run* (the browser), not accuracy: serving the real Java engine would force a net-new paid JVM tier + a lossy converter + network/auth purely to run code that can't run where the users are. The TS port runs in-browser (offline, instant, zero server compute). The Java module stays for the desktop path.
3. **You don't need the `.glb` for motion — the curves ARE the motion** (glTF stores them as float32; three.js reads them losslessly). But "just the curves" is under-specified: a clip carries no skeleton/rest-pose, so for height/root normalization (Phase 3) you also need the skeleton hierarchy + rest pose from `gltf.scene`, not just the clip.
4. **Fidelity is a MINOR reason to port, not the main one — don't oversell it.** Converting three.js → the Java `NormalizedAnimation` format is lossy on paper (resampling, dropped scale, synthesized weight/easing/jointPath, quat→matrix round-trip), but most of that is **inert for the current engine**: it never reads scale, float32→float64 is lossless, the quat round-trip is ~1e-7, and both sides already resample to lockstep samples. So do NOT justify the port as "serving Java is less accurate." The port's *real* fidelity edge is **future** upgrades (height/root normalization, mirror) that need scale/skeleton/rest-pose which three.js exposes natively but the Java format drops. Also: cross-format exact-copy SHA fingerprints (a `.glb` web upload vs a Studio-native registration) essentially never match — so **do not promise Studio→web cryptographic exact-copy**; both engines only give reliable *web→web* exact match. Keep the web engine in TS; don't route the web score through the actual Java engine.
5. **There is no better ready-made engine to adopt.** For skeletal motion, no drop-in copy-detection engine exists anywhere. The Java per-frame pose cost (position exp-decay + quaternion geodesic + weight) is a good base. Improvements are **additive**, not replacements.
6. **The upgrades that matter, in priority order (all no-ML, TS-buildable):**
   - **Banded DTW (Dynamic Time Warping)** (Sakoe-Chiba band ~10-15% + warp-amount penalty). Replaces rigid `t=i/48` lockstep sampling with elastic alignment. Extract a `poseCost(a,b)` you can evaluate at arbitrary sample pairs `(i,j)` (the lockstep engine only ever computes `(i,i)`), and make the cell cost a **DISTANCE** (`1 - posePercent/100`, or the pre-exp position/rotation blend) — DTW MINIMIZES, so feeding it a similarity percent warps toward the LEAST-similar path. **Biggest recall win** — catches re-timed / sped-up / paused copies the current engine misses. ~100 lines, no library. NOTE: DTW is not a metric → cannot be indexed; it's a verifier, not a fingerprint.
   - **Size/height + root-heading normalization** — the position term is absolute-distance, so a rescaled/relocated avatar doing the same motion tanks the score. Divide positional features by skeleton height; translate to root; remove root yaw. (Needs rest-pose/skeleton plumbed into the scorer — real work, not "low".)
   - **Mirror canonicalization** — catches mirrored dances (very common Roblox copy). **CAUTION:** mirroring a *quaternion* is NOT a lateral sign-flip like a position vector; it's an improper reflection — get the handedness right and validate against a hand-made mirrored fixture. Call this medium effort.
7. **Precision traps to fix as you go:**
   - The absolute-position term (42% weight) partly measures *rig identity*, not motion — on a shared standard rig it **inflates** similarity for genuinely different motions (false positives). De-weight toward rotation as part of Phase 1. **Note:** the `0.42` position weight and `timingPercent` live in the **Java** engine (`MotionComparisonEngine.java:231`), not in `motionAnalysis.ts` — the TS engine composes scores differently today. You are *importing* Java's pose-composite structure into TS as part of porting the Java algorithm, then de-weighting it; don't hunt for these terms in the TS file.
   - Every invariance you add (DTW over-warp, mirror-min, height-norm) **lowers distances → raises false accusations.** This is why Phase 0 (the test set) comes first and gates everything.
8. **Tier-3 (web scale) shape, for later (do NOT build now):** a hand-crafted, no-ML **DCT fingerprint** over normalized joint-angle curves + FK'd end-effector trajectories (NOT raw quaternion components — q and -q are the same rotation, a double-cover trap; convert to a continuous rep first), L2-normalized to a ~64-128-D vector, stored in a **pgvector / hnswlib** ANN index. Add cheap **rolling-hash / shingling** over the existing canonical keyframe stream to catch verbatim segment lifts (someone lifting an 8-count from a 32-count dance) precisely and indexably. Two-stage pipeline: exact-hash → ANN coarse recall → banded-DTW re-rank. Learned embeddings (self-supervised ST-GCN, ONNX→browser) are the eventual upgrade but a **months-long Python project gated on data + a labeled eval set** — not now, and it carries a real over-invariance / false-theft risk.

---

## <plan>

Do phases in order. **Plan each phase before coding, use TDD, and stop at each phase boundary to report results to Bryan before proceeding.** Every engine change must be graded on the Phase 0 test set. (The day figures below are Bryan's calendar estimates for scoping, not limits on your working session.)

### Phase 0 — Copy-detection test set (do FIRST, ~2-3 days)
Build the safety net that grades every later change.
- Programmatically derive **known derivations** from the 14 robot clips (+ fox clips): re-timed (speed up/slow down, insert holds), mirrored, rescaled, relocated, re-uploaded (identical). Label these **positive** (should match).
- Pair **unrelated** clips **within the same rig** as **negative** (robot-vs-robot, fox-vs-fox — **never robot-vs-fox**: different skeletons share no joints, so a cross-rig pair trivially non-matches via zero coverage, validating nothing while padding the pass rate).
- Write a harness (vitest) that runs the engine over the set and reports **recall** (positives caught) and **false-positive rate** (negatives wrongly flagged) at the current threshold.
- **Acceptance:** `npm test` runs the harness and prints a recall / false-positive scorecard; committed with the fixtures it generates.

### Phase 1 — One honest engine, in TWO strict steps (~1–1.5 weeks)
> **Do NOT fold the port and the improvements into one step.** Changing the algorithm while porting it destroys your only correctness oracle for Java's fiddly quaternion / slerp / hashing math. Port faithfully and prove it first; improve second.

**Phase 1a — Faithful port, proven against Java (finish and commit this BEFORE any change):**

Split the port into TWO layers, because a three.js clip CANNOT carry the inputs Java's `compare()` reads (per-pose weight, per-pose easing strings, matrix rotations, fused per-joint poses, whole-clip keyframe times) — so you can never feed both engines identical end-to-end input. Only a normalized representation can:
- **(1) A pure numeric core `compareNormalized(source, candidate)`** whose inputs mirror Java's `NormalizedAnimation` (jointPath, 12-value CFrame, weight, easingStyle/easingDirection). **This is the layer you prove against Java.** Port the algorithm EXACTLY here — and port the WHOLE thing by reading the file, not just the constants listed: per-joint pose blend (position `0.42` / rotation `0.50` / weight `0.08`), exponential kernels (`POSITION_DECAY 2.25`, `ROTATION_DECAY 1.8`), `jointPercent = poseMean*0.96 + metadata*0.04`, full `trackMetadataPercent` (0.8/0.2, case-insensitive easing), full `timingPercent` (0.45/0.40/0.15, `1 - meanDiff*2.5`, `duration==0` edges), `SAMPLE_COUNT=49` / `t=i/48`, `quantileIndex` round-half, coverage `100*common/all`, the exact-match 100-override, `round()` half-up, `0.65/0.20/0.15` overall, `90/70` verdicts. Watch the fragile parts: 4-branch `fromRotationMatrix` (`MotionComparisonEngine.java:363-404`), the `0.9995` slerp fallback (`411-435`).
- **(2) A separate lossy adapter `clipToNormalized(clip)`** that turns a three.js `AnimationClip` into that normalized input (group `*.position` + `*.quaternion` per joint, resample, synthesize weight/easing/jointPath). It has no Java counterpart, so it is **graded on the Phase 0 scorecard ONLY — NOT held to parity.**
- **Prove the core against Java:** have Java run `MotionComparisonEngine` on a set of `NormalizedAnimation` pairs and dump inputs + outputs to a JSON fixture (**regenerated on the same JVM/OS Bryan ships from**; serialize doubles with shortest-round-trip, never fixed decimals). Assert `compareNormalized` reproduces them with a **two-tier tolerance**: rounded public fields (they're `round(_,2)`) exact to **≤0.01**; unrounded intermediates to **~1e-7 relative, relaxed to ~1e-6 for the quaternion angle / rotationPercent** (Java and JS `Math` agree bit-for-bit only on `sqrt`; near dot=1 — the re-upload positive — `acos` amplifies a 1-ulp `exp/acos/sin` gap). A test against the TS output alone proves nothing.
- **Exact-match / fingerprint:** do NOT reproduce Java's `Double.toHexString` SHA — JS has no equivalent and cross-engine hashes never match anyway (finding 4). The web engine needs only its OWN consistent web→web exact-match (native array equality on clip data, like today's `motionAnalysis.ts`). Parity compares scores + verdict + the exact-match boolean, NOT raw hash hex.
- **Keep** the existing TS-only **loop/root modes** as optional add-on views — do NOT drop them (a naive port would).
- **Acceptance (1a):** `compareNormalized` passes the two-tier Java-parity test; `clipToNormalized` exists and the end-to-end path runs; loop/root modes preserved; committed with the oracle proven, before touching the algorithm.

**Phase 1b — Improvements, each a separately graded change (only after 1a is committed):**
- **De-weight the absolute-position term toward rotation** (fixes finding 7). Own commit, graded on the Phase 0 scorecard.
- **Add banded DTW** (Sakoe-Chiba band + warp penalty) in place of the fixed lockstep (`t=i/48`) sampling. Build a cost matrix over the two frame sequences using a `poseCost(a,b)` **DISTANCE** (see finding 6 — feed a distance, never the similarity percent, or DTW warps toward the worst match); the similarity becomes the length-normalized DTW path cost mapped back to a percent. Drop/de-weight the ad-hoc timing heuristic; DTW subsumes it (warp-amount penalty instead).
- Once you deliberately diverge from Java, the parity test no longer applies — pin the NEW behavior with its own golden vectors.
- **Acceptance (1b):** DTW in place; per improvement on the Phase 0 scorecard — **banded DTW must raise recall**; the **position de-weight must lower the false-positive rate** (it's a precision fix and may even shave recall slightly); neither may worsen the other metric; post-improvement engine pinned by its own golden test. Report before/after numbers to Bryan.

### Phase 2 — Live motion registry (~1-2 weeks)
- **Server (storage only — it does NOT score):** new JPA `@Entity` + table for a registered motion clip — owner, assetName, license, animationId, registryId, usageNote, **+ the clip's curve JSON** (TS-native serialization, NOT the lossy Java format), **+ an indexed `curveHash` column** (mirror `RegisteredAsset`'s `idx_asset_sha`) for O(1) web→web exact-match. Table auto-creates via `ddl-auto=update`. Mirror `RegisteredAsset`/`RegistryController`/`RegistryService` for **storage / auth / CRUD only** — motion deliberately diverges from the image/audio pattern in that **matching runs client-side**, not on the server.
- **Endpoints:** `POST /api/v1/motion/register` (store) and `GET /api/v1/motion/registry` (serve curve JSON + metadata), reusing the existing `X-Api-Key` auth (`ApiKeyInterceptor`) + `RateLimiter`. **No `/verify` endpoint** — a server-side verify would require the engine on the server, the exact paid JVM tier the port exists to avoid.
- **Browser:** serialize the loaded three.js clip → compact curve JSON; on a comparison, fetch the registered clips and compare with the **one TS engine** (client-side); render matches in the `RegistryMatchCard`. Keep `motionRegistry.ts` as the **offline fallback**; label which mode is live.
- **Seed** the registry (via a `DemoSeeder`-style path) AND add a **"Register this clip"** button (Bryan chose seed + button).
- **Acceptance:** server tests mirror `RegistryApiTest`; a frontend test covers serialize→register→verify; the card shows a live hit end-to-end; offline fallback still works with the server down.

### Phase 3 — Accuracy layer 2 (~1 week)
- **Size/height + root-heading normalization** (plumb rest-pose/skeleton into the scorer).
- **Mirror canonicalization** (validate quaternion mirror against a known mirrored fixture — see finding 6/7).
- **Acceptance:** Phase 0 scorecard shows each addition improves recall **without** raising the false-positive rate; if one raises false positives, revert or gate it behind a stricter threshold.

### Later — Tier-3 web scale (NOT this build; leave a written roadmap at `docs/TIER3-ROADMAP.md`)
DCT fingerprint + rolling-hash + pgvector ANN index + two-stage pipeline (finding 8). Learned embedding is a separate future project. Write the roadmap; build nothing yet.

---

## <working_agreement>
- **Plan before coding.** At the start of each phase, produce a short written plan (files, approach, tests) and confirm with Bryan.
- **TDD.** Write the test/harness first where practical; every engine change is graded on the Phase 0 set.
- **Report at phase boundaries.** Never silently roll from one phase into the next — give Bryan the scorecard and the diff summary and let him proceed.
- **Verify before claiming done.** Run `npm test` / `mvn test` and report real output. If something fails, say so.
- **Small honest commits**, one logical change each, with clear messages.
- **Stay in scope.** No ML training, no tier-3 build, no unrelated refactors. The anime rig is Bryan's to source (see `docs/adding-animation-rigs.md`).
- If you can spawn parallel subagents / workflows, use them for the heavier phases (e.g., parallelize Phase 0 fixture generation, or Phase 2 server + frontend work), but correctness and the test-set discipline come first.

## <definition_of_done> (first milestone = Phases 0 + 1)
A faithful TS port of the Java engine's numeric core (`compareNormalized`), **proven against a Java-generated two-tier parity test (rounded fields ≤0.01, intermediates ~1e-6/1e-7) and committed BEFORE any algorithm change** (Phase 1a), plus the lossy `clipToNormalized` adapter graded on Phase 0 only; then the position de-weight + banded DTW added as **separately graded** improvements (Phase 1b) — DTW raising recall, the de-weight lowering false positives, neither worsening the other; loop/root modes preserved; all green under `npm test` and reported to Bryan with before/after numbers.

## <first_actions>
1. Read `motionAnalysis.ts`, `MotionComparisonEngine.java`, and `rigFixtures.ts` in full to ground yourself.
2. Create the working branch.
3. Write and confirm the **Phase 0** plan (how you'll generate labeled derivations from the fixtures and structure the scorecard), then build it.
4. Report the Phase 0 scorecard baseline before touching the engine.
