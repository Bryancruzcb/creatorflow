// frontend/src/motion/mirrorCanonical.ts
/**
 * Mirror canonicalization (issue #16).
 *
 * A mirrored copy is the laundering step this engine was worst at. The scorecard called it
 * "partial" for a long time on a 47% aggregate, but per-rig it was one rig carrying everything:
 * 8/14 on robot, 0/3 fox, 0/1 cesiumMan, 0/1 riggedFigure. Robot only scored because that rig is
 * symmetric enough for a mirrored clip to still look like itself — detection by accident, not by
 * design. On every other rig, mirroring defeated the engine completely.
 *
 * Why the direct comparison cannot see it: mirroring moves the left limb's performance onto the
 * right limb's joints. `compareMotion` scores joint-by-joint on NAME, so it compares the mirrored
 * right arm against the original right arm — two genuinely different curves — and the pose score
 * collapses. Nothing about DTW or coverage helps, because the misalignment is across joints, not
 * across time.
 *
 * So the fix is a second orientation rather than a better score: reflect the candidate, swap its
 * left/right joints, and compare again.
 *
 * ## The reflection
 *
 * Reflection across the YZ plane, M = diag(-1, 1, 1). Positions take x -> -x. A rotation
 * conjugates as R' = M R M (M is its own inverse), which on the row-major 3x3 the normalized
 * transform carries works out to negating exactly r01, r02, r10 and r20:
 *
 *     [ r00  -r01  -r02 ]
 *     [-r10   r11   r12 ]
 *     [-r20   r21   r22 ]
 *
 * det(M R M) = det(M)^2 det(R) = det(R) = 1, so the reflected rotation is still a proper rotation
 * and no quaternion double-cover problem arises. (Equivalently, in three's (x,y,z,w) order the
 * quaternion goes to (x, -y, -z, w) — which is how the test fixtures build their mirrors, and the
 * two agree exactly. Worth knowing when comparing this against `testset/derivations.ts`.)
 *
 * ## What this is NOT
 *
 * This reflects each joint's LOCAL transform. That is an exact mirror only where a joint's local
 * frame is axis-aligned with the world. A true mirror reflects in world space and re-expresses the
 * result in each bone's rest frame, which needs the bind pose — and `clipToNormalized` drops the
 * hierarchy on purpose, so it is not available here.
 *
 * The honest consequence: this canonicalization inverts the same simplified mirror model the test
 * fixtures are built from, so the recall it recovers on that set is partly self-fulfilling. The
 * number from this change worth trusting is the FALSE-POSITIVE rate, because the negatives are
 * real distinct clips and are not derived by any mirror model at all. Real mirrored Roblox
 * animations remain uncollected; see the test set README.
 */
import type { NormalizedAnimationJson } from './normalizedMotion';

/**
 * Least mirror-map ENTRIES worth mirroring for. Two entries is ONE mutual pair.
 *
 * The guard compares this against `swap.size`, and `buildMirrorMap` stores both directions of every
 * mutual pair (A -> B and B -> A), so a single pair already fills two entries and clears it. The
 * effective floor is one pair: only a clip with no mutual pair at all is refused.
 *
 * Refusing that case is what the floor is for. With no paired joints the "mirror" degenerates to
 * negating x on every joint, which is not a mirror of a performance — it is a reflected rig.
 * Scoring that as a second chance would be pure added false-positive surface for no detection
 * value.
 *
 * The one-pair floor is the shipped scoring behaviour and is kept by owner decision 2026-08-02:
 * raising it would change which clips get a second orientation and move scores the web already
 * ships and the scorecard already grades. This comment used to claim a two-pair floor the code
 * never implemented; the comment was corrected to the code, not the code to the comment.
 */
export const MIRROR_MIN_PAIRS = 2;

/**
 * Pairs left/right joints from the names in one clip.
 *
 * Three conventions, all present in the vendored rigs: a trailing side letter (`HandL`/`HandR`,
 * which is what three's node-name sanitizer leaves of a `Hand.L`), an infix side letter between
 * underscores (`leg_joint_L_1`/`leg_joint_R_1`), and a `Left`/`Right` word inside the name where
 * the numeric suffix may differ per side (`LeftHand_23`/`RightHand_41`).
 *
 * A pair is only kept when it is MUTUAL: the counterpart must exist in this same clip and must map
 * back. A one-way guess would rename a joint onto a name that is not there, which does not look
 * like a failed mirror to the caller — it looks like a coverage drop, i.e. a wrong answer with a
 * plausible explanation. Deliberately not shared with `testset/derivations.ts`, which builds its
 * swap from a rig's full node list: keeping the detector's pairing independent of the fixture
 * generator's is the only thing that stops the mirror cases from grading a function against itself.
 */
export function buildMirrorMap(joints: string[]): Map<string, string> {
  const present = new Set(joints);
  const candidates = new Map<string, string>();
  const withoutSuffix = (name: string) => name.replace(/_\d+$/, '');

  for (const joint of joints) {
    const trailing = joint.match(/^(.*)([LR])$/);
    if (trailing) {
      const swapped = trailing[1] + (trailing[2] === 'L' ? 'R' : 'L');
      if (present.has(swapped)) { candidates.set(joint, swapped); continue; }
    }
    const infix = joint.match(/^(.*_)([LR])(_.*)$/);
    if (infix) {
      const swapped = `${infix[1]}${infix[2] === 'L' ? 'R' : 'L'}${infix[3]}`;
      if (present.has(swapped)) { candidates.set(joint, swapped); continue; }
    }
    if (/Left|Right/.test(joint)) {
      const wanted = withoutSuffix(joint).replace(/Left|Right/, (side) => (side === 'Left' ? 'Right' : 'Left'));
      const matches = joints.filter((other) => other !== joint && withoutSuffix(other) === wanted);
      if (matches.length === 1) candidates.set(joint, matches[0]);
    }
  }

  // Keep only mutual pairs. An asymmetric guess is dropped rather than throwing: production input
  // is whatever a user loaded, and a half-named rig is a reason to skip mirroring, not to fail.
  const mutual = new Map<string, string>();
  for (const [from, to] of candidates) {
    if (candidates.get(to) === from) mutual.set(from, to);
  }
  return mutual;
}

/** Row-major 3x3 entries inside the 12-component transform that R -> M R M negates. */
const NEGATED_ROTATION_INDICES = [4, 5, 6, 9] as const;

/** Every joint the clip animates. */
function jointsOf(clip: NormalizedAnimationJson): string[] {
  const joints = new Set<string>();
  for (const keyframe of clip.keyframes) for (const pose of keyframe.poses) joints.add(pose.jointPath);
  return [...joints];
}

/**
 * The clip as it would read if performed mirror-image, or null when it cannot be mirrored
 * meaningfully.
 *
 * Null rather than the clip unchanged: an unmirrorable clip must not be scored a second time
 * against a near-identical copy of itself, which is a free extra draw at the maximum and nothing
 * else.
 *
 * `against` is the clip this one is about to be compared with, and its joint names take part in the
 * pairing. That is not a shortcut, it is the whole thing working: a clip that only animates one arm
 * contains no left/right pair to find, because the counterpart joint is never keyed. Mirrored
 * `Wave` yields 4 pairs read alone and 26 read alongside its source — and the six mirror fixtures
 * this engine still missed after canonicalization were ALL of that shape. Their pose score was
 * already exactly 100; they failed on coverage alone, because half the renames never happened.
 *
 * Using both is also what the hypothesis actually says. "The candidate's left arm is doing what the
 * source's right arm did" is a claim about two clips, so it cannot be tested from one of them. No
 * privileged rig knowledge is involved — only the names in the two clips being compared, which the
 * scorer already reads.
 */
export function mirrorNormalized(
  clip: NormalizedAnimationJson,
  against?: NormalizedAnimationJson,
): NormalizedAnimationJson | null {
  const pairingJoints = against
    ? [...new Set([...jointsOf(clip), ...jointsOf(against)])]
    : jointsOf(clip);
  const swap = buildMirrorMap(pairingJoints);
  if (swap.size < MIRROR_MIN_PAIRS) return null;

  return {
    ...clip,
    keyframes: clip.keyframes.map((keyframe) => ({
      ...keyframe,
      poses: keyframe.poses.map((pose) => {
        const transform = pose.transform.slice();
        // -0 breaks exact-equality round-trips downstream; keep zeros positive.
        transform[0] = transform[0] === 0 ? 0 : -transform[0];
        for (const index of NEGATED_ROTATION_INDICES) {
          transform[index] = transform[index] === 0 ? 0 : -transform[index];
        }
        return { ...pose, jointPath: swap.get(pose.jointPath) ?? pose.jointPath, transform };
      }),
    })),
  };
}
