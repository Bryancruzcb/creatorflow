import { Quaternion, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildMirrorMap, mirrorNormalized, MIRROR_MIN_PAIRS } from './mirrorCanonical';
import { compareMotion } from './motionEngine';
import type { NormalizedAnimationJson, NormalizedPoseJson } from './normalizedMotion';

/** Row-major 3x3 from a quaternion, matching clipToNormalized's layout. */
function rowMajor(q: Quaternion): number[] {
  const m = new Matrix4().makeRotationFromQuaternion(q).elements; // column-major
  return [
    m[0], m[4], m[8],
    m[1], m[5], m[9],
    m[2], m[6], m[10],
  ];
}

function pose(jointPath: string, position: [number, number, number], q: Quaternion): NormalizedPoseJson {
  return {
    jointPath,
    transform: [...position, ...rowMajor(q)],
    weight: 1,
    easingStyle: 'Linear',
    easingDirection: 'InOut',
  };
}

function clip(name: string, poses: NormalizedPoseJson[][]): NormalizedAnimationJson {
  return {
    assetId: name,
    name,
    duration: poses.length - 1,
    looped: false,
    priority: 'Unknown',
    keyframes: poses.map((frame, index) => ({ time: index, poses: frame })),
  };
}

describe('buildMirrorMap', () => {
  it('pairs a trailing side letter, which is what three leaves of "Hand.L"', () => {
    const map = buildMirrorMap(['HandL', 'HandR', 'Head']);
    expect(map.get('HandL')).toBe('HandR');
    expect(map.get('HandR')).toBe('HandL');
    expect(map.has('Head')).toBe(false);
  });

  it('pairs an infix side letter where the numeric suffix is shared', () => {
    const map = buildMirrorMap(['leg_joint_L_1', 'leg_joint_R_1', 'leg_joint_L_2', 'leg_joint_R_2']);
    expect(map.get('leg_joint_L_1')).toBe('leg_joint_R_1');
    expect(map.get('leg_joint_R_2')).toBe('leg_joint_L_2');
  });

  it('pairs Left/Right names whose numeric suffixes differ per side', () => {
    const map = buildMirrorMap(['LeftHand_23', 'RightHand_41']);
    expect(map.get('LeftHand_23')).toBe('RightHand_41');
    expect(map.get('RightHand_41')).toBe('LeftHand_23');
  });

  it('drops a one-way guess rather than renaming onto a joint that is not there', () => {
    // A rename with no counterpart does not read as a failed mirror downstream. It reads as a
    // coverage drop, which is a wrong answer wearing a plausible explanation.
    expect(buildMirrorMap(['HandL', 'Head']).size).toBe(0);
  });

  it('is an involution, so no two joints can be renamed onto the same name', () => {
    const joints = ['HandL', 'HandR', 'FootL', 'FootR', 'LeftEye_1', 'RightEye_2', 'Spine'];
    const map = buildMirrorMap(joints);
    for (const [from, to] of map) expect(map.get(to)).toBe(from);
    expect(new Set(map.values()).size).toBe(map.size);
  });

  it('does not pair an ambiguous Left/Right core with two candidates', () => {
    // Two joints could both be the counterpart; guessing either would be evidence built on a
    // coin flip.
    expect(buildMirrorMap(['LeftArm_1', 'RightArm_1', 'RightArm_2']).has('LeftArm_1')).toBe(false);
  });
});

describe('mirrorNormalized', () => {
  const identity = new Quaternion();
  const tilt = new Quaternion().setFromAxisAngle({ x: 0.3, y: 0.8, z: 0.5 } as never, 0.7).normalize();

  it('reflects x and matches the (x, -y, -z, w) quaternion form exactly', () => {
    // The load-bearing math, checked against the independent formulation rather than against the
    // fixtures that were generated from it: R -> M R M for M = diag(-1,1,1) must equal the row-major
    // rotation of the quaternion with y and z negated.
    const source = clip('a', [[pose('HandL', [1, 2, 3], tilt), pose('HandR', [-1, 2, 3], identity)]]);
    const mirrored = mirrorNormalized(source)!;
    const hand = mirrored.keyframes[0].poses.find((p) => p.jointPath === 'HandR')!;
    const expected = new Quaternion(tilt.x, -tilt.y, -tilt.z, tilt.w);
    expect(hand.transform.slice(0, 3)).toEqual([-1, 2, 3]);
    rowMajor(expected).forEach((value, index) => {
      expect(hand.transform[3 + index]).toBeCloseTo(value, 12);
    });
  });

  it('is its own inverse', () => {
    const source = clip('a', [[pose('HandL', [1, 2, 3], tilt), pose('HandR', [-4, 5, 6], identity)]]);
    const twice = mirrorNormalized(mirrorNormalized(source)!)!;
    expect(twice.keyframes).toEqual(source.keyframes);
  });

  it('keeps zeros positive, so exact-equality round trips still work', () => {
    const source = clip('a', [[pose('HandL', [0, 0, 0], identity), pose('HandR', [0, 0, 0], identity)]]);
    const mirrored = mirrorNormalized(source)!;
    for (const p of mirrored.keyframes[0].poses) {
      for (const value of p.transform) expect(Object.is(value, -0)).toBe(false);
    }
  });

  it('refuses zero mutual pairs and accepts one, which is where the floor really sits', () => {
    // Without a real left/right pair this would be a reflected RIG, not a mirrored performance —
    // pure added false-positive surface for no detection value.
    const noPairs = clip('a', [[pose('Head', [1, 2, 3], tilt)]]);
    expect(mirrorNormalized(noPairs)).toBeNull();

    // MIRROR_MIN_PAIRS counts map ENTRIES, and buildMirrorMap stores both directions of a mutual
    // pair, so ONE pair already fills the quota. That one-pair floor is the shipped scoring
    // behaviour (owner decision 2026-08-02) — every case above rides on it, and a change that
    // quietly raised it would fail here.
    expect(buildMirrorMap(['ArmL', 'ArmR']).size).toBe(MIRROR_MIN_PAIRS);
    const onePair = clip('b', [[pose('ArmL', [1, 2, 3], tilt), pose('ArmR', [-1, 2, 3], identity)]]);
    expect(mirrorNormalized(onePair)).not.toBeNull();
  });

  it('widens the pairing using the clip it will be compared against', () => {
    // A one-armed performance contains no pair to find on its own: the counterpart joint is never
    // keyed. This is the shape of every mirror fixture that canonicalization still missed before
    // `against` was threaded through — their pose scores were already exactly 100, and they failed
    // on coverage alone.
    const oneArm = clip('cand', [[pose('HandL', [1, 2, 3], tilt), pose('ArmL', [1, 1, 1], tilt)]]);
    const other = clip('src', [[pose('HandR', [-1, 2, 3], tilt), pose('ArmR', [-1, 1, 1], tilt)]]);
    expect(mirrorNormalized(oneArm)).toBeNull();
    const paired = mirrorNormalized(oneArm, other)!;
    expect(paired.keyframes[0].poses.map((p) => p.jointPath).sort()).toEqual(['ArmR', 'HandR']);
  });
});

describe('compareMotion mirror awareness', () => {
  const spin = new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, 0.9).normalize();
  const source = clip('src', [
    [pose('HandL', [1, 0, 0], spin), pose('HandR', [-1, 0, 0], new Quaternion())],
    [pose('HandL', [1, 1, 0], spin), pose('HandR', [-1, 0, 0], new Quaternion())],
  ]);
  const mirroredCopy = mirrorNormalized(source)!;

  it('finds a mirrored copy and says so', () => {
    const result = compareMotion(source, mirroredCopy);
    expect(result.mirrored).toBe(true);
    expect(result.overallPercent).toBeGreaterThanOrEqual(90);
  });

  it('never claims exact curve data for a mirrored pair', () => {
    // The reflection is a bitwise-exact inverse of the mirroring transform, so inside the mirrored
    // comparison the canonical-equality check DOES fire for a clean mirror. Passing that through
    // was a byte-identity claim about a pair whose bytes differ — 14 of the 19 mirror fixtures
    // reported EXACT_CURVE_DATA before this was guarded. Exactness is a statement about what was
    // submitted; only the direct orientation may ever assert it.
    const result = compareMotion(source, mirroredCopy);
    expect(result.mirrored).toBe(true);
    expect(result.overallPercent).toBe(100);
    expect(result.exactCurveData).toBe(false);
    expect(result.verdict).toBe('HIGH_SIMILARITY');
    // The direct orientation still asserts it, unchanged.
    const identical = compareMotion(source, source);
    expect(identical.exactCurveData).toBe(true);
    expect(identical.verdict).toBe('EXACT_CURVE_DATA');
  });

  it('reports the direct orientation when it is the better one', () => {
    expect(compareMotion(source, source).mirrored).toBe(false);
  });

  it('can be turned off, and then misses the mirror it would otherwise catch', () => {
    const off = compareMotion(source, mirroredCopy, { mirrorAware: false });
    expect(off.mirrored).toBe(false);
    expect(off.overallPercent).toBeLessThan(compareMotion(source, mirroredCopy).overallPercent);
  });
});
