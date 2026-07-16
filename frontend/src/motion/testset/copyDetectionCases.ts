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
  | 'unrelated' | 'family' | 'variant';

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
const ROOT_JOINT: Record<string, string> = { robot: 'Body', fox: 'b_Hip_01' };
const VARIANT_PAIRS = new Set(['robot:WalkJump-vs-Walking']);
const FAMILY_PAIRS = new Set(['robot:Running-vs-Walking', 'fox:Run-vs-Walk']);

const pairKey = (rigId: string, a: string, b: string) => {
  const [first, second] = [a, b].sort();
  return `${rigId}:${first}-vs-${second}`;
};

export function buildCases(fixtures: RigMotionFixture[]): CopyDetectionCase[] {
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
  }
  return cases;
}
