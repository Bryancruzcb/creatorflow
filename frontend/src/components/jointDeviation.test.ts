import { describe, expect, it } from 'vitest';
import { Bone, Color, Group } from 'three';
import { makeScopeSkeleton, updateScopeSkeleton } from './MotionComparisonLab';
import { DEVIATION_RAMP, sampleRamp } from '../motion/ramp';

/**
 * The per-joint deviation channel on the overlay skeleton.
 *
 * What matters here is not the colour but WHEN a colour is claimed. A deviation reading against a
 * bone the other clip never animates would be a comparison with a bind pose presented as a
 * measurement, and that is the class of quiet inaccuracy this product cannot ship.
 */

const CEILING = 0.35;

/** A two-bone chain: root -> child. Only child/parent pairs of Bones become segments. */
function makeRig(childY: number) {
  const group = new Group();
  const root = new Bone();
  const child = new Bone();
  child.position.set(0, childY, 0);
  root.add(child);
  group.add(root);
  group.updateMatrixWorld(true);
  return { group, root, child };
}

function colorsOf(skeleton: ReturnType<typeof makeScopeSkeleton>) {
  const c = skeleton.color.array as Float32Array;
  return { r: c[0], g: c[1], b: c[2] };
}

describe('joint deviation channel', () => {
  it('paints the rig tint when no peer is supplied', () => {
    const rig = makeRig(1);
    const tint = new Color('#d6b273');
    const skeleton = makeScopeSkeleton(rig.group, tint);
    updateScopeSkeleton(skeleton, 'full', new Set([rig.child.uuid]), null);

    const painted = colorsOf(skeleton);
    expect(painted.r).toBeCloseTo(tint.r, 5);
    expect(painted.g).toBeCloseTo(tint.g, 5);
    expect(painted.b).toBeCloseTo(tint.b, 5);
  });

  it('paints the ramp colour for the measured separation', () => {
    const a = makeRig(1);
    const b = makeRig(1.14); // 0.14 apart, i.e. 40% of the 0.35 ceiling
    const skeletonA = makeScopeSkeleton(a.group, new Color('#d6b273'));
    const skeletonB = makeScopeSkeleton(b.group, new Color('#7298b8'));

    updateScopeSkeleton(skeletonA, 'full', new Set([a.child.uuid]), {
      peerSegments: skeletonB.segments,
      peerAnimated: new Set([b.child.uuid]),
      ceiling: CEILING,
    });

    const expected = sampleRamp(DEVIATION_RAMP, 0.14 / CEILING);
    const painted = colorsOf(skeletonA);
    expect(painted.r).toBeCloseTo(expected.r / 255, 2);
    expect(painted.g).toBeCloseTo(expected.g / 255, 2);
    expect(painted.b).toBeCloseTo(expected.b / 255, 2);
  });

  it('keeps the tint when the peer clip does not animate that bone', () => {
    const a = makeRig(1);
    const b = makeRig(1.3);
    const tint = new Color('#d6b273');
    const skeletonA = makeScopeSkeleton(a.group, tint);
    const skeletonB = makeScopeSkeleton(b.group, new Color('#7298b8'));

    // Peer animates nothing: there is no pose to compare against, only a bind pose.
    updateScopeSkeleton(skeletonA, 'full', new Set([a.child.uuid]), {
      peerSegments: skeletonB.segments,
      peerAnimated: new Set(),
      ceiling: CEILING,
    });

    const painted = colorsOf(skeletonA);
    expect(painted.r).toBeCloseTo(tint.r, 5);
    expect(painted.g).toBeCloseTo(tint.g, 5);
    expect(painted.b).toBeCloseTo(tint.b, 5);
  });

  it('saturates rather than overflowing past the ceiling', () => {
    const a = makeRig(1);
    const b = makeRig(9); // far beyond the ceiling
    const skeletonA = makeScopeSkeleton(a.group, new Color('#d6b273'));
    const skeletonB = makeScopeSkeleton(b.group, new Color('#7298b8'));

    updateScopeSkeleton(skeletonA, 'full', new Set([a.child.uuid]), {
      peerSegments: skeletonB.segments,
      peerAnimated: new Set([b.child.uuid]),
      ceiling: CEILING,
    });

    const top = sampleRamp(DEVIATION_RAMP, 1);
    const painted = colorsOf(skeletonA);
    expect(painted.r).toBeCloseTo(top.r / 255, 2);
    expect(painted.g).toBeCloseTo(top.g / 255, 2);
    expect(painted.b).toBeCloseTo(top.b / 255, 2);
  });
});
