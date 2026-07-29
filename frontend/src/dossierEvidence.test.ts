import { describe, expect, it } from 'vitest';
import { AnimationClip, Bone, Group, Mesh, Object3D } from 'three';
import { loadRigFixture } from './motion/testset/fixtureLoader';
import { deserializeClip } from './motion/motionCurves';
import {
  DOSSIER_CANDIDATE_CLIP,
  DOSSIER_SOURCE_CLIP,
  buildDossierEvidence,
  jointForMesh,
  jointLabel,
} from './dossierEvidence';

function robotClips(): AnimationClip[] {
  return loadRigFixture('robot').clips.map(deserializeClip);
}

describe('jointLabel', () => {
  it('restores the side suffix the loader strips', () => {
    expect(jointLabel('UpperLegR')).toBe('UpperLeg.R');
    expect(jointLabel('FootL')).toBe('Foot.L');
  });

  it('leaves sideless joints alone', () => {
    expect(jointLabel('Head')).toBe('Head');
    expect(jointLabel('Body')).toBe('Body');
  });
});

describe('jointForMesh', () => {
  it('walks up to the nearest bone', () => {
    const bone = new Bone();
    bone.name = 'UpperLegR';
    const mesh = new Mesh();
    mesh.name = 'LegR';
    bone.add(mesh);
    expect(jointForMesh(mesh)).toBe('UpperLegR');
  });

  it('skips non-bone ancestors on the way up', () => {
    const bone = new Bone();
    bone.name = 'Body';
    const wrapper = new Group();
    const mesh = new Mesh();
    bone.add(wrapper);
    wrapper.add(mesh);
    expect(jointForMesh(mesh)).toBe('Body');
  });

  it('sanitizes the bone name the way the loader does', () => {
    const bone = new Bone();
    bone.name = 'UpperLeg.R';
    const mesh = new Mesh();
    bone.add(mesh);
    expect(jointForMesh(mesh)).toBe('UpperLegR');
  });

  it('uses the named fallback for the two skinned hands', () => {
    const root = new Object3D();
    const hand = new Mesh();
    hand.name = 'HandR';
    root.add(hand);
    // No bone ancestor at all — this is the case the derivation cannot cover.
    expect(jointForMesh(hand)).toBe('LowerArmR');
  });

  it('returns null for a mesh with neither a bone ancestor nor an override', () => {
    const root = new Object3D();
    const mesh = new Mesh();
    mesh.name = 'Prop';
    root.add(mesh);
    expect(jointForMesh(mesh)).toBeNull();
  });
});

describe('buildDossierEvidence', () => {
  const evidence = buildDossierEvidence(robotClips());

  it('finds both clips in the shipped rig', () => {
    expect(evidence).not.toBeNull();
    expect(evidence!.sourceClip).toBe(DOSSIER_SOURCE_CLIP);
    expect(evidence!.candidateClip).toBe(DOSSIER_CANDIDATE_CLIP);
  });

  it('returns null when a clip is missing rather than inventing one', () => {
    const onlyWalking = robotClips().filter((clip) => clip.name === DOSSIER_SOURCE_CLIP);
    expect(buildDossierEvidence(onlyWalking)).toBeNull();
    expect(buildDossierEvidence([])).toBeNull();
  });

  /**
   * The section only works if the engine disagrees with itself somewhere. A pair that scored 99
   * would colour nothing and the whole visual would read as broken, so this is a real gate on the
   * clip choice rather than a restatement of the implementation.
   */
  it('reports a partial relationship, not a match and not a total mismatch', () => {
    expect(evidence!.overall).toBeGreaterThan(40);
    expect(evidence!.overall).toBeLessThan(90);
  });

  it('flags joints worst first, capped at the engine list length', () => {
    const scores = evidence!.joints.map((joint) => joint.matchPercent);
    expect(scores.length).toBeGreaterThan(2);
    expect(scores.length).toBeLessThanOrEqual(8);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });

  /**
   * Guards the unit trap in `toPercent`. Track scores arrive 0-1 while every other percentage the
   * engine returns is already 0-100; reading them raw would render every joint at 0% or 1%.
   */
  it('converts track scores into readable percentages', () => {
    evidence!.joints.forEach((joint) => {
      expect(joint.matchPercent).toBeGreaterThan(1);
      expect(joint.matchPercent).toBeLessThan(100);
    });
  });

  it('puts the worst joint at full heat and keeps the mildest above the floor', () => {
    const heats = evidence!.joints.map((joint) => joint.heat);
    expect(heats[0]).toBeCloseTo(1, 5);
    expect(Math.min(...heats)).toBeGreaterThanOrEqual(0.4);
    expect(Math.max(...heats)).toBeLessThanOrEqual(1);
  });

  it('indexes joints by their track name for mesh lookup', () => {
    evidence!.joints.forEach((joint) => {
      expect(evidence!.byJoint.get(joint.joint)).toBe(joint);
    });
  });

  /**
   * The visual claim this section makes. WalkJump departs from Walking at the jump-off leg, so if
   * the flagged set ever stops being leg-led the colouring no longer tells the story the copy
   * promises and the clip pair needs revisiting.
   */
  it('lands the divergence on the legs', () => {
    const top = evidence!.joints.slice(0, 3).map((joint) => joint.joint);
    expect(top.filter((joint) => /Leg|Foot/.test(joint)).length).toBeGreaterThanOrEqual(2);
  });

  it('reports a peak difference somewhere inside the clip', () => {
    expect(evidence!.peakProgress).toBeGreaterThanOrEqual(0);
    expect(evidence!.peakProgress).toBeLessThanOrEqual(1);
  });
});
