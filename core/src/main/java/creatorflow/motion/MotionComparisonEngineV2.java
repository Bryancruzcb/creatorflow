package creatorflow.motion;

import creatorflow.motion.MotionComparisonEngine.PoseBlendWeights;
import creatorflow.motion.MotionComparisonEngine.PoseDelta;
import creatorflow.motion.MotionComparisonEngine.PoseSample;
import creatorflow.motion.MotionComparisonEngine.TrackKey;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Engine v2 for the Java side — a faithful port of frontend/src/motion/motionEngine.ts.
 *
 * <p>PORT CONTRACT: this must reproduce {@code compareMotion} to the tolerances in
 * frontend/src/motion/parity/v2Parity.test.ts, which grades it against the committed v2 oracle the
 * same way v1's port is graded. Do not "improve" anything here; a change that is not made on both
 * sides is a divergence, and a divergence between these two files is exactly the defect this class
 * exists to remove (issue #102).
 *
 * <p>WHY THIS EXISTS. Every browser surface scored on v2 while the Studio plugin route
 * ({@code POST /plugin/v1/motion-comparisons}) still scored on v1, so the same pair of animations
 * got different numbers depending on which door it came through — and a mirrored copy was detected
 * in the browser while staying invisible through the plugin. v1 is deliberately left alone: it is
 * the parity oracle the TypeScript port is proven against, and moving it would invalidate every
 * number that proof underwrites. So v2 lives beside it and composes its primitives.
 *
 * <p>The four divergences from v1, each graded separately on the TS side:
 * <ol>
 *   <li>overall = (pose*0.65 + timing*0.20 + coverage*0.15) * coverage/100 — guards tiny-overlap
 *       false accusations without the old harmonic mean's full-coverage inflation.</li>
 *   <li>position de-weighted 0.42 -> 0.25 toward rotation, because absolute position partly
 *       measures rig identity rather than performance.</li>
 *   <li>banded DTW replaces lockstep sampling, with a warp-aware timing composite.</li>
 *   <li>mirror canonicalization: the pair is scored in both orientations and the better kept.</li>
 * </ol>
 */
public final class MotionComparisonEngineV2 {

    /**
     * Shared with the TypeScript engine's {@code ENGINE_V2_VERSION}, character for character.
     *
     * <p>The "-web" suffix is a historical artifact from when this algorithm existed only in the
     * browser. It is kept rather than corrected because this string identifies the ALGORITHM, not
     * the implementation: two parity-locked implementations must report the same version or the
     * comparison table again holds two names for one algorithm, which is the confusion #102 is
     * about. Stored evidence records already carry this value, so renaming it would also rewrite
     * the meaning of rows nobody can regenerate.
     */
    public static final String ENGINE_VERSION = "creatorflow.motion-comparison/v2-web";

    /** Finding 7: absolute position partly measures rig identity; de-weight toward rotation. */
    static final PoseBlendWeights V2_POSE_WEIGHTS = new PoseBlendWeights(0.25, 0.65, 0.10);

    private static final int DEFAULT_SAMPLE_COUNT = 49;
    private static final int MIN_SAMPLE_COUNT = 13;

    /** The band {@code verdict} calls HIGH_SIMILARITY, named because mirror short-circuiting reads it. */
    private static final double HIGH_SIMILARITY_PERCENT = 90.0;

    /**
     * A small per-transition cost on non-diagonal moves.
     *
     * <p>Without it, unweighted DTW hits the classic "trivial expansion" pathology: a tiny CONSTANT
     * pose offset with no real timing difference can still look pointwise-cheaper a few samples off
     * the diagonal purely from sampling-grid quantization, so the path drifts off the diagonal for a
     * fraction-of-a-percent gain. This prices that drift out while staying far below the large,
     * sustained per-cell saving a genuine inserted hold produces. The constant is coupled to the
     * sample count, the pose weights and the cost-cell scale — re-derive it if any of those move,
     * and re-derive it on BOTH sides.
     */
    private static final double STEP_PENALTY = 0.1;

    private MotionComparisonEngineV2() {
    }

    public static MotionComparisonV2Result compare(MotionComparisonRequest request) {
        if (request == null) {
            throw new MotionValidationException("comparison request is required");
        }
        return compare(request, DEFAULT_SAMPLE_COUNT, V2_POSE_WEIGHTS, true);
    }

    static MotionComparisonV2Result compare(
            MotionComparisonRequest request, int sampleCount, PoseBlendWeights weights, boolean mirrorAware) {
        NormalizedAnimation source = request.source();
        NormalizedAnimation candidate = request.candidate();

        // Fingerprints describe what was SUBMITTED. They are computed here and never inside an
        // orientation, so a mirrored comparison cannot store the fingerprint of a clip that nobody
        // sent — that would be a false statement in an evidence record.
        String sourceFingerprint = MotionComparisonEngine.fingerprint(source);
        String candidateFingerprint = MotionComparisonEngine.fingerprint(candidate);

        Oriented direct = compareOriented(source, candidate, sampleCount, weights);
        Oriented chosen = direct;
        boolean mirrored = false;

        // Band by verdict, not by re-comparing the ROUNDED overall against 90: the verdict saw the
        // unrounded value, and an 89.996 that rounds to 90.00 must not skip the orientation that
        // could genuinely decide it.
        if (mirrorAware && !direct.exact() && direct.verdict() != MotionVerdict.HIGH_SIMILARITY) {
            NormalizedAnimation mirroredCandidate = MirrorCanonical.mirrorNormalized(candidate, source);
            if (mirroredCandidate != null) {
                Oriented reflected = compareOriented(source, mirroredCandidate, sampleCount, weights);
                // Rounded-vs-rounded, matching the TS comparison of the two returned results.
                if (reflected.overallPercent() > direct.overallPercent()) {
                    chosen = reflected;
                    mirrored = true;
                }
            }
        }

        /*
         * A perfect mirror is NOT exact curve data.
         *
         * The equality check inside the mirrored orientation sees source vs mirror(candidate), and
         * because the reflection is an exact inverse of the mirroring transform, a cleanly mirrored
         * copy comes back EQUAL there. Passing that through would be a byte-identity claim about a
         * pair whose bytes are not identical. Exactness is a statement about what was submitted, so
         * it can only come from the direct orientation — which short-circuited above. The scores
         * stand; the claim is downgraded to the strongest similarity, found in the mirror.
         */
        boolean exact = mirrored ? false : chosen.exact();
        MotionVerdict verdict = chosen.verdict();
        if (mirrored && verdict == MotionVerdict.EXACT_CURVE_DATA) {
            verdict = MotionVerdict.HIGH_SIMILARITY;
        }

        List<String> limitations = new ArrayList<>(List.of(
                "Similarity is evidence, not a determination of ownership or infringement.",
                "Transforms are compared in local joint space; rig retargeting is not inferred.",
                "Easing metadata is fingerprinted and lightly scored; interpolation uses linear position and quaternion slerp."));
        if (mirrored) {
            limitations.add(
                    "These scores describe the candidate compared MIRRORED; the two clips do not match as submitted.");
        }

        return new MotionComparisonV2Result(
                ENGINE_VERSION,
                source.assetId(),
                candidate.assetId(),
                sourceFingerprint,
                candidateFingerprint,
                chosen.overallPercent(),
                chosen.posePercent(),
                chosen.timingPercent(),
                chosen.coveragePercent(),
                chosen.durationPercent(),
                chosen.warpScore(),
                exact,
                verdict,
                chosen.jointScores(),
                chosen.frameScores(),
                chosen.commonJointCount(),
                chosen.allJointCount(),
                mirrored,
                limitations);
    }

    /** One orientation's numbers. No fingerprints: see the note in {@link #compare}. */
    private record Oriented(
            double overallPercent,
            double posePercent,
            double timingPercent,
            double coveragePercent,
            double durationPercent,
            double warpScore,
            boolean exact,
            MotionVerdict verdict,
            List<MotionJointScore> jointScores,
            List<MotionComparisonV2Result.FrameScore> frameScores,
            int commonJointCount,
            int allJointCount) {
    }

    private static Oriented compareOriented(
            NormalizedAnimation source,
            NormalizedAnimation candidate,
            int requestedSampleCount,
            PoseBlendWeights weights) {
        int sampleCount = Math.max(MIN_SAMPLE_COUNT, requestedSampleCount);
        boolean exact = MotionComparisonEngine.fingerprint(source)
                .equals(MotionComparisonEngine.fingerprint(candidate));

        Map<String, List<TrackKey>> sourceTracks = MotionComparisonEngine.tracks(source);
        Map<String, List<TrackKey>> candidateTracks = MotionComparisonEngine.tracks(candidate);
        // TreeSet ordering is String.compareTo, i.e. UTF-16 code-unit order — the same order the TS
        // side's Array.prototype.sort() produces on the joint names. The joint iteration order
        // decides which score lands in which slot, so this is load-bearing, not tidiness.
        Set<String> allJoints = new TreeSet<>(sourceTracks.keySet());
        allJoints.addAll(candidateTracks.keySet());
        Set<String> commonJointSet = new TreeSet<>(sourceTracks.keySet());
        commonJointSet.retainAll(candidateTracks.keySet());
        List<String> commonJoints = new ArrayList<>(commonJointSet);
        double coveragePercent = allJoints.isEmpty()
                ? 0.0
                : 100.0 * commonJoints.size() / allJoints.size();

        // --- Banded DTW over lockstep sample grids ---
        // Cost cell = DISTANCE (1 - posePercent/100), never similarity: DTW minimizes.
        // Duration-aware band: a duration mismatch of fraction f shifts alignment by up to
        // f*(N-1) samples, so the band floors at 12.5% but grows to cover that shift, capped at 35%.
        double maxDuration = Math.max(source.duration(), candidate.duration());
        double durationShift = maxDuration == 0.0
                ? 0.0
                : Math.abs(source.duration() - candidate.duration()) / maxDuration;
        int band = (int) Math.min(
                Math.round(0.35 * (sampleCount - 1)),
                Math.max(
                        Math.max(2L, Math.round(0.125 * (sampleCount - 1))),
                        (long) Math.ceil(durationShift * (sampleCount - 1)) + 2L));

        List<List<PoseSample>> sourceSamples = new ArrayList<>(sampleCount);
        List<List<PoseSample>> candidateSamples = new ArrayList<>(sampleCount);
        for (int i = 0; i < sampleCount; i++) {
            double normalizedTime = i / (double) (sampleCount - 1);
            List<PoseSample> sourceRow = new ArrayList<>(commonJoints.size());
            List<PoseSample> candidateRow = new ArrayList<>(commonJoints.size());
            for (String joint : commonJoints) {
                sourceRow.add(MotionComparisonEngine.sample(
                        sourceTracks.get(joint), normalizedTime * source.duration()));
                candidateRow.add(MotionComparisonEngine.sample(
                        candidateTracks.get(joint), normalizedTime * candidate.duration()));
            }
            sourceSamples.add(sourceRow);
            candidateSamples.add(candidateRow);
        }
        int jointCount = commonJoints.size();

        double[][] cost = new double[sampleCount][sampleCount];
        double[][] accumulated = new double[sampleCount][sampleCount];
        for (int i = 0; i < sampleCount; i++) {
            java.util.Arrays.fill(cost[i], Double.POSITIVE_INFINITY);
            java.util.Arrays.fill(accumulated[i], Double.POSITIVE_INFINITY);
        }
        for (int i = 0; i < sampleCount; i++) {
            for (int j = Math.max(0, i - band); j <= Math.min(sampleCount - 1, i + band); j++) {
                cost[i][j] = cellCost(cellDeltas(sourceSamples, candidateSamples, i, j, weights), jointCount);
            }
        }
        accumulated[0][0] = cost[0][0];
        for (int i = 0; i < sampleCount; i++) {
            for (int j = Math.max(0, i - band); j <= Math.min(sampleCount - 1, i + band); j++) {
                if (i == 0 && j == 0) {
                    continue;
                }
                double diagonal = i > 0 && j > 0 ? accumulated[i - 1][j - 1] : Double.POSITIVE_INFINITY;
                double up = i > 0 ? accumulated[i - 1][j] + STEP_PENALTY : Double.POSITIVE_INFINITY;
                double left = j > 0 ? accumulated[i][j - 1] + STEP_PENALTY : Double.POSITIVE_INFINITY;
                accumulated[i][j] = cost[i][j] + Math.min(diagonal, Math.min(up, left));
            }
        }

        // Backtrack (diagonal preferred on ties -> deterministic), collecting the path.
        List<int[]> path = new ArrayList<>();
        int pi = sampleCount - 1;
        int pj = sampleCount - 1;
        while (pi > 0 || pj > 0) {
            path.add(new int[] {pi, pj});
            double diagonal = pi > 0 && pj > 0 ? accumulated[pi - 1][pj - 1] : Double.POSITIVE_INFINITY;
            double up = pi > 0 ? accumulated[pi - 1][pj] + STEP_PENALTY : Double.POSITIVE_INFINITY;
            double left = pj > 0 ? accumulated[pi][pj - 1] + STEP_PENALTY : Double.POSITIVE_INFINITY;
            if (diagonal <= up && diagonal <= left) {
                pi--;
                pj--;
            } else if (up <= left) {
                pi--;
            } else {
                pj--;
            }
        }
        path.add(new int[] {0, 0});
        java.util.Collections.reverse(path);
        int pathLength = path.size();
        double warpTotal = 0.0;
        for (int[] cell : path) {
            warpTotal += Math.abs(cell[0] - cell[1]);
        }
        double meanWarp = warpTotal / pathLength;
        double warpScore = 100.0 * Math.max(0.0, 1.0 - meanWarp / band);

        // Per-joint + per-frame aggregation along the ALIGNED path.
        Map<String, JointAccumulator> perJoint = new TreeMap<>();
        for (String joint : commonJoints) {
            perJoint.put(joint, new JointAccumulator());
        }
        double[] frameTotals = new double[sampleCount];
        int[] frameCounts = new int[sampleCount];
        for (int[] cell : path) {
            List<PoseDelta> deltas = cellDeltas(sourceSamples, candidateSamples, cell[0], cell[1], weights);
            double cellTotal = 0.0;
            for (int jointIndex = 0; jointIndex < deltas.size(); jointIndex++) {
                PoseDelta delta = deltas.get(jointIndex);
                perJoint.get(commonJoints.get(jointIndex)).add(delta);
                cellTotal += delta.posePercent();
            }
            frameTotals[cell[0]] += jointCount == 0 ? 0.0 : cellTotal / jointCount;
            frameCounts[cell[0]]++;
        }
        List<MotionComparisonV2Result.FrameScore> frameScores = new ArrayList<>(sampleCount);
        for (int i = 0; i < sampleCount; i++) {
            frameScores.add(new MotionComparisonV2Result.FrameScore(
                    i,
                    MotionComparisonEngine.round(
                            frameCounts[i] != 0 ? frameTotals[i] / frameCounts[i] : 0.0, 2)));
        }

        List<MotionJointScore> jointScores = new ArrayList<>(allJoints.size());
        double poseTotal = 0.0;
        for (String joint : allJoints) {
            boolean inSource = sourceTracks.containsKey(joint);
            boolean inCandidate = candidateTracks.containsKey(joint);
            if (!inSource || !inCandidate) {
                jointScores.add(new MotionJointScore(joint, inSource, inCandidate, 0.0, 0.0, 0.0, 0.0, 0.0));
                continue;
            }
            JointAccumulator accumulator = perJoint.get(joint);
            double metadataPercent = MotionComparisonEngine.trackMetadataPercent(
                    sourceTracks.get(joint), candidateTracks.get(joint));
            // Divided by pathLength, not by this joint's own visit count: every joint is visited on
            // every path cell, so the two are equal — but the TS side writes pathLength and a port
            // that "simplifies" it would drift the moment that stops being true.
            double jointPercent = (accumulator.poseTotal() / pathLength) * 0.96 + metadataPercent * 0.04;
            poseTotal += jointPercent;
            jointScores.add(new MotionJointScore(
                    joint,
                    true,
                    true,
                    MotionComparisonEngine.round(jointPercent, 2),
                    MotionComparisonEngine.round(accumulator.positionTotal() / pathLength, 6),
                    MotionComparisonEngine.round(accumulator.maxPositionDelta(), 6),
                    MotionComparisonEngine.round(
                            Math.toDegrees(accumulator.rotationTotal() / pathLength), 3),
                    MotionComparisonEngine.round(Math.toDegrees(accumulator.maxRotationDelta()), 3)));
        }

        double posePercent = commonJoints.isEmpty() ? 0.0 : poseTotal / commonJoints.size();
        double durationPercent = durationPercentOf(source, candidate);
        double timing = durationPercent * 0.5 + warpScore * 0.5;
        double overallPercent =
                ((posePercent * 0.65 + timing * 0.2 + coveragePercent * 0.15) * coveragePercent) / 100.0;
        if (exact) {
            posePercent = 100.0;
            timing = 100.0;
            coveragePercent = 100.0;
            overallPercent = 100.0;
        }

        return new Oriented(
                MotionComparisonEngine.round(overallPercent, 2),
                MotionComparisonEngine.round(posePercent, 2),
                MotionComparisonEngine.round(timing, 2),
                MotionComparisonEngine.round(coveragePercent, 2),
                MotionComparisonEngine.round(durationPercent, 2),
                MotionComparisonEngine.round(warpScore, 2),
                exact,
                // The verdict reads the UNROUNDED overall, matching the TS call order.
                verdict(exact, overallPercent),
                jointScores,
                frameScores,
                commonJoints.size(),
                allJoints.size());
    }

    private static List<PoseDelta> cellDeltas(
            List<List<PoseSample>> sourceSamples,
            List<List<PoseSample>> candidateSamples,
            int i,
            int j,
            PoseBlendWeights weights) {
        List<PoseSample> sourceRow = sourceSamples.get(i);
        List<PoseSample> candidateRow = candidateSamples.get(j);
        List<PoseDelta> deltas = new ArrayList<>(sourceRow.size());
        for (int index = 0; index < sourceRow.size(); index++) {
            deltas.add(MotionComparisonEngine.delta(sourceRow.get(index), candidateRow.get(index), weights));
        }
        return deltas;
    }

    private static double cellCost(List<PoseDelta> deltas, int jointCount) {
        if (jointCount == 0) {
            return 1.0;
        }
        double total = 0.0;
        for (PoseDelta delta : deltas) {
            total += delta.posePercent();
        }
        return 1.0 - total / jointCount / 100.0;
    }

    private static double durationPercentOf(NormalizedAnimation source, NormalizedAnimation candidate) {
        if (source.duration() == 0.0 && candidate.duration() == 0.0) {
            return 100.0;
        }
        if (source.duration() == 0.0 || candidate.duration() == 0.0) {
            return 0.0;
        }
        return 100.0 * Math.min(source.duration(), candidate.duration())
                / Math.max(source.duration(), candidate.duration());
    }

    private static MotionVerdict verdict(boolean exact, double overallPercent) {
        if (exact) {
            return MotionVerdict.EXACT_CURVE_DATA;
        }
        if (overallPercent >= HIGH_SIMILARITY_PERCENT) {
            return MotionVerdict.HIGH_SIMILARITY;
        }
        if (overallPercent >= 70.0) {
            return MotionVerdict.MODERATE_SIMILARITY;
        }
        return MotionVerdict.LOW_SIMILARITY;
    }

    /** Sums along the DTW path. Totals stay raw; the caller divides by the path length. */
    private static final class JointAccumulator {
        private double poseTotal;
        private double positionTotal;
        private double rotationTotal;
        private double maxPositionDelta;
        private double maxRotationDelta;

        void add(PoseDelta delta) {
            poseTotal += delta.posePercent();
            positionTotal += delta.positionDelta();
            rotationTotal += delta.rotationDelta();
            maxPositionDelta = Math.max(maxPositionDelta, delta.positionDelta());
            maxRotationDelta = Math.max(maxRotationDelta, delta.rotationDelta());
        }

        double poseTotal() {
            return poseTotal;
        }

        double positionTotal() {
            return positionTotal;
        }

        double rotationTotal() {
            return rotationTotal;
        }

        double maxPositionDelta() {
            return maxPositionDelta;
        }

        double maxRotationDelta() {
            return maxRotationDelta;
        }
    }
}
