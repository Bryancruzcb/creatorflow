/**
 * The rigs the Motion Lab can load. Each is a self-contained data entry — a licensed animated
 * .glb plus its clips, Studio facts, and a few similarity scenarios — so adding another rig
 * (see docs/adding-animation-rigs.md) never touches the component. The 3D model differs per rig;
 * clips are always compared within one rig, since a comparison needs a shared skeleton.
 */

export type MotionCategory = 'Locomotion' | 'States' | 'Actions' | 'Gestures';
export type RobloxPriority = 'Core' | 'Idle' | 'Movement' | 'Action';

export interface RigClip {
  /** Must equal the clip's animation name inside the .glb. */
  name: string;
  category: MotionCategory;
  description: string;
  animationId: string;
  priority: RobloxPriority;
  looped: boolean;
  use: string;
}

export interface RigScenario {
  id: string;
  title: string;
  situation: string;
  guidance: string;
  source: string;
  candidate: string;
}

export interface RigFixture {
  id: string;
  name: string;
  glbUrl: string;
  license: string;
  attribution: string;
  /** Notes what makes this rig distinct — shown as a one-liner. */
  note: string;
  defaultPair: [string, string];
  clips: RigClip[];
  scenarios: RigScenario[];
}

const ROBOT: RigFixture = {
  id: 'robot',
  name: 'RobotExpressive',
  glbUrl: '/assets/robot-expressive.glb',
  license: 'CC0 1.0',
  attribution: 'RobotExpressive by Tomás Laulhé / Quaternius; glTF modifications by Don McCurdy',
  note: 'Stylised humanoid · 14 clips · lightweight rig',
  defaultPair: ['Walking', 'Running'],
  clips: [
    { name: 'Idle', category: 'Locomotion', description: 'Looping neutral motion', animationId: 'rbxassetid://1027461501', priority: 'Idle', looped: true, use: 'Default standing loop' },
    { name: 'Walking', category: 'Locomotion', description: 'Reference walk cycle', animationId: 'rbxassetid://1027461842', priority: 'Movement', looped: true, use: 'Humanoid walk cycle' },
    { name: 'Running', category: 'Locomotion', description: 'Faster locomotion cycle', animationId: 'rbxassetid://1027462119', priority: 'Movement', looped: true, use: 'Humanoid run cycle' },
    { name: 'WalkJump', category: 'Locomotion', description: 'Walk-to-jump transition', animationId: 'rbxassetid://1027462584', priority: 'Movement', looped: false, use: 'Walk-to-jump transition' },
    { name: 'Jump', category: 'Locomotion', description: 'Authored jump action', animationId: 'rbxassetid://1027462907', priority: 'Movement', looped: false, use: 'Jump action' },
    { name: 'Sitting', category: 'States', description: 'Sitting pose transition', animationId: 'rbxassetid://1027463315', priority: 'Action', looped: false, use: 'Seat transition' },
    { name: 'Standing', category: 'States', description: 'Standing pose transition', animationId: 'rbxassetid://1027463742', priority: 'Action', looped: false, use: 'Stand-up transition' },
    { name: 'Death', category: 'States', description: 'Fall and rest state', animationId: 'rbxassetid://1027464088', priority: 'Action', looped: false, use: 'Fall / death state' },
    { name: 'Dance', category: 'Actions', description: 'Full-body dance action', animationId: 'rbxassetid://1027464560', priority: 'Action', looped: true, use: 'Full-body emote' },
    { name: 'Punch', category: 'Actions', description: 'Upper-body strike', animationId: 'rbxassetid://1027464931', priority: 'Action', looped: false, use: 'Combat strike' },
    { name: 'Wave', category: 'Gestures', description: 'One-arm greeting', animationId: 'rbxassetid://1027465307', priority: 'Action', looped: false, use: 'Greeting emote' },
    { name: 'Yes', category: 'Gestures', description: 'Affirmative head motion', animationId: 'rbxassetid://1027465742', priority: 'Action', looped: false, use: 'Affirmative head nod' },
    { name: 'No', category: 'Gestures', description: 'Negative head motion', animationId: 'rbxassetid://1027466108', priority: 'Action', looped: false, use: 'Negative head shake' },
    { name: 'ThumbsUp', category: 'Gestures', description: 'Positive hand gesture', animationId: 'rbxassetid://1027466533', priority: 'Action', looped: false, use: 'Positive hand gesture' },
  ],
  scenarios: [
    { id: 'reupload', title: 'Re-upload under a new ID', situation: 'The same motion uploaded as a second Animation ID.', guidance: 'Exact curve data — the same work. A new ID or name does not make it original; attach provenance before shipping.', source: 'Walking', candidate: 'Walking' },
    { id: 'variant', title: 'Edited variant', situation: 'A walk cycle with a jump grafted on — built from another clip.', guidance: 'Strong structural overlap. Confirm it is an authorised edit of your own animation, not a lifted derivative.', source: 'Walking', candidate: 'WalkJump' },
    { id: 'shared-rig', title: 'Same rig, different intent', situation: 'Two full-body clips that share a skeleton but not the movement.', guidance: 'The overlap is mostly the shared rig and cadence, not the motion — usually fine, but worth a glance before you record the decision.', source: 'Walking', candidate: 'Dance' },
    { id: 'unrelated', title: 'Unrelated motion', situation: 'A death fall versus a hand gesture — nothing in common.', guidance: 'No meaningful relationship; the tool correctly does not flag this. A good negative control for a demo.', source: 'Death', candidate: 'ThumbsUp' },
  ],
};

const FOX: RigFixture = {
  id: 'fox',
  name: 'Fox',
  glbUrl: '/assets/fox-animated.glb',
  license: 'CC-BY 4.0',
  attribution: 'Fox mesh by PixelMannen (CC0); rig and animation by @tomkranis / Norgeotloic (CC-BY 4.0)',
  note: 'Non-humanoid quadruped · different skeleton · 3 gait clips',
  defaultPair: ['Walk', 'Run'],
  clips: [
    { name: 'Survey', category: 'States', description: 'Idle look-around', animationId: 'rbxassetid://1031820104', priority: 'Idle', looped: true, use: 'Idle survey / alert' },
    { name: 'Walk', category: 'Locomotion', description: 'Four-legged walk cycle', animationId: 'rbxassetid://1031820551', priority: 'Movement', looped: true, use: 'Quadruped walk' },
    { name: 'Run', category: 'Locomotion', description: 'Four-legged run cycle', animationId: 'rbxassetid://1031820937', priority: 'Movement', looped: true, use: 'Quadruped run' },
  ],
  scenarios: [
    { id: 'fox-reupload', title: 'Re-upload under a new ID', situation: 'The same gait re-uploaded as a second Animation ID.', guidance: 'Exact curve data — the same work; attach provenance before shipping.', source: 'Walk', candidate: 'Walk' },
    { id: 'fox-family', title: 'Same gait family', situation: 'Two locomotion cycles on the same skeleton.', guidance: 'Related but distinct clips — usually fine; note they share a rig and cadence.', source: 'Walk', candidate: 'Run' },
    { id: 'fox-idle-run', title: 'Idle vs run', situation: 'An alert look-around versus a full run on the same compact rig.', guidance: 'Still reads high here: with only three clips all sharing the whole skeleton, coverage keeps the score up — a coverage signal, not a copy. A rig with more, more-varied clips spreads the bands wider (see the robot).', source: 'Survey', candidate: 'Run' },
  ],
};

export const rigFixtures: RigFixture[] = [ROBOT, FOX];

export function rigById(id: string): RigFixture {
  return rigFixtures.find((rig) => rig.id === id) ?? ROBOT;
}

export function clipInRig(rig: RigFixture, name: string): RigClip | undefined {
  return rig.clips.find((clip) => clip.name === name);
}
