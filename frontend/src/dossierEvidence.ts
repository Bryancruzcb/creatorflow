import { Bone, PropertyBinding, type AnimationClip, type Object3D } from 'three';
import { analyzeMotionClips, type MotionAnalysisResult, type MotionTrackScore } from './motion/motionAnalysis';

/**
 * The evidence behind the landing dossier.
 *
 * The section is headed "Every exception arrives with context", and the point it has to make in
 * about two seconds is that an exception has a LOCATION on the asset. So rather than describe that
 * in three bullet points, the section runs the shipped comparison engine against two clips on the
 * rig it is already showing, and colours the parts the engine flags.
 *
 * Nothing here is illustrative. `analyzeMotionClips` is the same entry point the motion lab calls,
 * and the clips are the ones in `public/assets/robot-expressive.glb`. If the engine's scoring
 * changes, this section changes with it — which is the intent. A landing page that fakes its
 * numbers goes stale silently; this one cannot.
 */

/**
 * Walking against WalkJump.
 *
 * Chosen because the two share a gait and then genuinely part company: the engine scores them 70
 * overall, and the eight joints it returns are dominated by the right leg — the jump-off leg. That
 * is a picture a person can read without knowing anything about motion comparison. A pair that
 * scored 12 or 99 would colour either everything or nothing and teach the viewer nothing.
 */
export const DOSSIER_SOURCE_CLIP = 'Walking';
export const DOSSIER_CANDIDATE_CLIP = 'WalkJump';

/**
 * The two meshes that cannot find their joint by walking up the graph.
 *
 * Twelve of the robot's fourteen meshes are rigid props parented directly to the bone that drives
 * them, so their joint is simply `mesh.parent`. The two hands are skinned (glTF skins 0 and 1) and
 * therefore sit on the scene root instead, with no bone ancestor to find. They are named here
 * rather than inferred: a skinned mesh spans several joints by definition, and picking one by
 * heaviest weight would be a guess dressed up as a derivation.
 */
export const SKINNED_MESH_JOINTS: Record<string, string> = {
  HandR: 'LowerArmR',
  HandL: 'LowerArmL',
};

export interface JointEvidence {
  /** Sanitized joint name as it appears in the animation tracks, e.g. `UpperLegR`. */
  joint: string;
  /** Rig-style label for display, e.g. `UpperLeg.R`. */
  label: string;
  /** 0-100. How much of the motion shape the two clips share at this joint. */
  matchPercent: number;
  /** 0-1, normalized across the flagged set, for colour. 1 is the worst joint present. */
  heat: number;
}

export interface DossierEvidence {
  sourceClip: string;
  candidateClip: string;
  /** 0-100 overall shape relationship, straight from the engine. */
  overall: number;
  verdict: string;
  /** Normalized position in the clip where the two differ most, 0-1. */
  peakProgress: number;
  /** Worst joint first. At most eight — the engine caps its own list there. */
  joints: JointEvidence[];
  byJoint: Map<string, JointEvidence>;
}

/**
 * `UpperLegR` -> `UpperLeg.R`.
 *
 * glTF node names in this rig carry a `.L`/`.R` side suffix, which three's GLTFLoader strips
 * because a dot is the property separator in an animation track path. Putting it back is purely
 * cosmetic, but it means the label on screen matches what an animator sees in Blender or Studio
 * rather than a mangled version of it.
 */
export function jointLabel(joint: string): string {
  return joint.replace(/([LR])$/, '.$1');
}

/**
 * Track scores arrive 0-1 while every other percentage the engine returns is already 0-100.
 *
 * Reading `MotionTrackScore.score` as a percentage is the obvious mistake here and it fails
 * quietly — every joint would render as 0% or 1%, which looks like a total mismatch rather than a
 * unit error. Converted in exactly one place for that reason.
 */
function toPercent(score: number): number {
  return Math.round(score * 100);
}

/**
 * The joint a mesh belongs to, or null if it has none.
 *
 * Derived from the file rather than tabulated, so a rig change cannot leave a stale mapping behind.
 */
export function jointForMesh(mesh: Object3D): string | null {
  const override = SKINNED_MESH_JOINTS[mesh.name];
  if (override) return override;
  for (let node = mesh.parent; node; node = node.parent) {
    if (node instanceof Bone) return PropertyBinding.sanitizeNodeName(node.name);
  }
  return null;
}

export function findClip(clips: AnimationClip[], name: string): AnimationClip | undefined {
  return clips.find((clip) => clip.name === name);
}

/**
 * Spread the flagged scores across the ramp instead of using them raw.
 *
 * Raw deviation for this pair spans roughly 0.30 to 0.50, which lands every joint in the same
 * muddy third of the ramp and makes the worst joint indistinguishable from the eighth. Normalizing
 * within the flagged set is honest here because the set is already "the exceptions" — the ordering
 * is what carries meaning, and the joints that are NOT in the list are not coloured at all.
 *
 * A floor of 0.4 keeps the mildest exception clearly warmer than an unflagged part, so the
 * boundary between "flagged" and "fine" stays visible.
 */
function heatFor(score: number, best: number, worst: number): number {
  if (best <= worst) return 1;
  return 0.4 + 0.6 * ((best - score) / (best - worst));
}

export function buildDossierEvidence(clips: AnimationClip[]): DossierEvidence | null {
  const source = findClip(clips, DOSSIER_SOURCE_CLIP);
  const candidate = findClip(clips, DOSSIER_CANDIDATE_CLIP);
  if (!source || !candidate) return null;

  const result: MotionAnalysisResult = analyzeMotionClips(source, candidate, {
    mode: 'shape',
    sampleCount: 96,
  });

  const scores: MotionTrackScore[] = [...result.trackScores].sort((a, b) => a.score - b.score);
  if (scores.length === 0) return null;

  const worst = scores[0].score;
  const best = scores[scores.length - 1].score;
  const joints: JointEvidence[] = scores.map((track) => ({
    joint: track.rawName,
    label: jointLabel(track.rawName),
    matchPercent: toPercent(track.score),
    heat: heatFor(track.score, best, worst),
  }));

  return {
    sourceClip: source.name,
    candidateClip: candidate.name,
    overall: result.overall,
    verdict: result.verdict,
    peakProgress: result.largestDifferenceProgress,
    joints,
    byJoint: new Map(joints.map((entry) => [entry.joint, entry])),
  };
}
