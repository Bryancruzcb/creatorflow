// frontend/src/motion/testset/copyDetectionCases.ts
/**
 * Builds the labeled copy-detection case list from the committed rig fixtures.
 * Positives are programmatic derivations (the label is true by construction);
 * negatives are distinct clips on the same rig. Cross-rig pairs are forbidden —
 * they trivially non-match via zero coverage and validate nothing.
 *
 * Walking↔WalkJump is 'variant' (WalkJump is built from Walking per the rig
 * scenarios): reported, but excluded from both recall and false-positive gating.
 * Walking↔Running / Walk↔Run are DIFFERENT works that share a gait family —
 * flagging them would be a false accusation, so they stay negatives ('family').
 */
import type { MotionCurves } from '../motionCurves';
import {
  buildMirrorNameSwapper, insertHold, mirrorClip, relocateRoot, rescalePositions, retimeUniform, reupload,
} from './derivations';
import type { RigMotionFixture } from './fixtureLoader';

export type CaseKind = 'positive' | 'negative' | 'variant';
export type CaseClass =
  | 'reupload' | 'retime-fast' | 'retime-slow' | 'hold' | 'rescale' | 'relocate' | 'mirror'
  | 'unrelated' | 'family' | 'variant' | 'partial-coverage';

export interface CopyDetectionCase {
  id: string;
  rigId: string;
  kind: CaseKind;
  caseClass: CaseClass;
  sourceName: string;
  candidateName: string;
  source: MotionCurves;
  candidate: MotionCurves;
}

const RETIME_FAST = 0.8;
const RETIME_SLOW = 1.25;
const HOLD_AT = 0.4;
const HOLD_LENGTH = 0.3;
const RESCALE = 1.25;
const RELOCATE: [number, number, number] = [3, 0, 2];
const ROOT_JOINT: Record<string, string> = {
  robot: 'Body',
  fox: 'b_Hip_01',
  cesiumMan: 'Skeleton_torso_joint_1',
  riggedFigure: 'torso_joint_1',
  riggedSimple: 'Bone001',
};
const VARIANT_PAIRS = new Set(['robot:WalkJump-vs-Walking']);
const FAMILY_PAIRS = new Set(['robot:Running-vs-Walking', 'fox:Run-vs-Walk']);

const pairKey = (rigId: string, a: string, b: string) => {
  const [first, second] = [a, b].sort();
  return `${rigId}:${first}-vs-${second}`;
};

// Partial-coverage negatives (Phase 1b): a candidate that shares only SOME tracks
// with the source — the rest renamed to unshared joints. Identical curve data on
// the shared slice makes these maximally hard: any engine whose composition
// under-penalizes low coverage will flag them, and flagging a clip that shares
// one limb's motion with 20 unrelated tracks is a false accusation.
const PARTIAL_SOURCE: Record<string, string> = { robot: 'Walking', fox: 'Walk' };

function partialCoverageCandidate(clip: MotionCurves, sharedCount: number): MotionCurves {
  const tracks = clip.tracks.map((track, index) => (
    index < sharedCount
      ? { ...track, times: track.times.slice(), values: track.values.slice() }
      : { ...track, name: `Unshared${index}.${track.name.slice(track.name.lastIndexOf('.') + 1)}`, times: track.times.slice(), values: track.values.slice() }
  ));
  return { ...clip, name: `${clip.name} (partial ${sharedCount})`, tracks };
}

/**
 * A rig needs enough independently animated joints for the derivations to mean anything. On a rig
 * with a single animated joint, "relocated in space" and "a different animation" are genuinely
 * indistinguishable from local transform data — there is no relative motion left to match — and
 * mirroring is near-identity because there are no left/right pairs to swap. Such a rig does not
 * expose engine behaviour; it just moves the headline percentages around. Skip it explicitly
 * rather than letting it quietly flatter or depress the score.
 */
const MIN_ANIMATED_JOINTS = 3;

function animatedJointCount(fixture: RigMotionFixture): number {
  const joints = new Set<string>();
  for (const clip of fixture.clips) {
    for (const track of clip.tracks) joints.add(track.name.split('.')[0]);
  }
  return joints.size;
}

export function isGradableRig(fixture: RigMotionFixture): boolean {
  return animatedJointCount(fixture) >= MIN_ANIMATED_JOINTS;
}

export function buildCases(allFixtures: RigMotionFixture[]): CopyDetectionCase[] {
  const fixtures = allFixtures.filter(isGradableRig);
  const cases: CopyDetectionCase[] = [];
  for (const fixture of fixtures) {
    const swap = buildMirrorNameSwapper(fixture.nodes);
    const root = ROOT_JOINT[fixture.rigId];
    if (!root) throw new Error(`no root joint configured for rig ${fixture.rigId}`);

    for (const clip of fixture.clips) {
      const positives: Array<[CaseClass, MotionCurves]> = [
        ['reupload', reupload(clip)],
        ['retime-fast', retimeUniform(clip, RETIME_FAST)],
        ['retime-slow', retimeUniform(clip, RETIME_SLOW)],
        ['hold', insertHold(clip, HOLD_AT, HOLD_LENGTH)],
        ['rescale', rescalePositions(clip, RESCALE)],
        ['relocate', relocateRoot(clip, root, RELOCATE)],
        ['mirror', mirrorClip(clip, swap)],
      ];
      for (const [caseClass, candidate] of positives) {
        cases.push({
          id: `${fixture.rigId}:${caseClass}:${clip.name}`,
          rigId: fixture.rigId,
          kind: 'positive',
          caseClass,
          sourceName: clip.name,
          candidateName: candidate.name,
          source: clip,
          candidate,
        });
      }
    }

    const sorted = [...fixture.clips].sort((left, right) => left.name.localeCompare(right.name));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const key = pairKey(fixture.rigId, sorted[i].name, sorted[j].name);
        const variant = VARIANT_PAIRS.has(key);
        cases.push({
          id: variant ? key.replace(':', ':variant:') : key.replace(':', ':neg:'),
          rigId: fixture.rigId,
          kind: variant ? 'variant' : 'negative',
          caseClass: variant ? 'variant' : FAMILY_PAIRS.has(key) ? 'family' : 'unrelated',
          sourceName: sorted[i].name,
          candidateName: sorted[j].name,
          source: sorted[i],
          candidate: sorted[j],
        });
      }
    }

    // Partial-coverage negatives need a nominated source clip. Rigs added purely to widen the
    // skeleton topologies under test (the single-clip Cesium rigs) do not nominate one, and a rig
    // that declares a name it does not have is a wiring mistake worth failing on — so distinguish
    // the two rather than throwing for both.
    const partialSourceName = PARTIAL_SOURCE[fixture.rigId];
    const partialSource = partialSourceName
      ? fixture.clips.find((clip) => clip.name === partialSourceName)
      : undefined;
    if (partialSourceName && !partialSource) {
      throw new Error(`partial-coverage source clip "${partialSourceName}" missing for rig ${fixture.rigId}`);
    }
    if (partialSource) for (const [label, sharedCount] of [['low', 2], ['half', Math.floor(partialSource.tracks.length / 2)]] as const) {
      cases.push({
        id: `${fixture.rigId}:neg-partial:${label}:${partialSource.name}`,
        rigId: fixture.rigId,
        kind: 'negative',
        caseClass: 'partial-coverage',
        sourceName: partialSource.name,
        candidateName: `${partialSource.name} (partial ${sharedCount})`,
        source: partialSource,
        candidate: partialCoverageCandidate(partialSource, sharedCount),
      });
    }
  }
  return cases;
}
