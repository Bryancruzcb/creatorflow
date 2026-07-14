/**
 * Curated Roblox-framed comparison scenarios over the licensed fixture clips. The 3D rig is a
 * single licensed model, but each clip is a distinct motion; these scenarios present pairs a
 * Roblox creator actually runs into — a re-upload, an edited variant, a same-family cycle, an
 * unrelated clip — so the similarity spectrum is visible at a glance. The band shown on each is
 * computed live by the real engine, never asserted here.
 */

// Roblox AnimationPriority as a creator sees it in Studio.
export type RobloxPriority = 'Core' | 'Idle' | 'Movement' | 'Action';

export interface RobloxClipFacts {
  animationId: string;
  priority: RobloxPriority;
  looped: boolean;
  use: string;
}

/** Illustrative Studio metadata per fixture clip (sample data; the banner marks the mode). */
export const robloxClipFacts: Record<string, RobloxClipFacts> = {
  Idle: { animationId: 'rbxassetid://1027461501', priority: 'Idle', looped: true, use: 'Default standing loop' },
  Walking: { animationId: 'rbxassetid://1027461842', priority: 'Movement', looped: true, use: 'Humanoid walk cycle' },
  Running: { animationId: 'rbxassetid://1027462119', priority: 'Movement', looped: true, use: 'Humanoid run cycle' },
  WalkJump: { animationId: 'rbxassetid://1027462584', priority: 'Movement', looped: false, use: 'Walk-to-jump transition' },
  Jump: { animationId: 'rbxassetid://1027462907', priority: 'Movement', looped: false, use: 'Jump action' },
  Sitting: { animationId: 'rbxassetid://1027463315', priority: 'Action', looped: false, use: 'Seat transition' },
  Standing: { animationId: 'rbxassetid://1027463742', priority: 'Action', looped: false, use: 'Stand-up transition' },
  Death: { animationId: 'rbxassetid://1027464088', priority: 'Action', looped: false, use: 'Fall / death state' },
  Dance: { animationId: 'rbxassetid://1027464560', priority: 'Action', looped: true, use: 'Full-body emote' },
  Punch: { animationId: 'rbxassetid://1027464931', priority: 'Action', looped: false, use: 'Combat strike' },
  Wave: { animationId: 'rbxassetid://1027465307', priority: 'Action', looped: false, use: 'Greeting emote' },
  Yes: { animationId: 'rbxassetid://1027465742', priority: 'Action', looped: false, use: 'Affirmative head nod' },
  No: { animationId: 'rbxassetid://1027466108', priority: 'Action', looped: false, use: 'Negative head shake' },
  ThumbsUp: { animationId: 'rbxassetid://1027466533', priority: 'Action', looped: false, use: 'Positive hand gesture' },
};

export function robloxFactsFor(clipName: string): RobloxClipFacts {
  return robloxClipFacts[clipName]
    ?? { animationId: 'rbxassetid://—', priority: 'Action', looped: false, use: 'Fixture clip' };
}

export interface MotionScenario {
  id: string;
  title: string;
  /** The Roblox situation this pair represents. */
  situation: string;
  /** What a creator should do when they see this relationship. */
  guidance: string;
  source: string;
  candidate: string;
}

/**
 * Ordered most-similar to least-similar so clicking through reveals the full spectrum. The pairs
 * were chosen empirically so each lands cleanly in a different band (exact / high / moderate /
 * low) with the engine's real scores.
 */
export const motionScenarios: MotionScenario[] = [
  {
    id: 'reupload',
    title: 'Re-upload under a new ID',
    situation: 'The same motion uploaded as a second Animation ID.',
    guidance: 'Exact curve data — the same work. A new ID or name does not make it original; attach provenance before shipping.',
    source: 'Walking',
    candidate: 'Walking',
  },
  {
    id: 'variant',
    title: 'Edited variant',
    situation: 'A walk cycle with a jump grafted on — built from another clip.',
    guidance: 'Strong structural overlap. Confirm it is an authorised edit of your own animation, not a lifted derivative.',
    source: 'Walking',
    candidate: 'WalkJump',
  },
  {
    id: 'shared-rig',
    title: 'Same rig, different intent',
    situation: 'Two full-body clips that share a skeleton but not the movement.',
    guidance: 'The overlap is mostly the shared rig and cadence, not the motion — usually fine, but worth a glance before you record the decision.',
    source: 'Walking',
    candidate: 'Dance',
  },
  {
    id: 'unrelated',
    title: 'Unrelated motion',
    situation: 'A death fall versus a hand gesture — nothing in common.',
    guidance: 'No meaningful relationship; the tool correctly does not flag this. A good negative control for a demo.',
    source: 'Death',
    candidate: 'ThumbsUp',
  },
];

export type SimilarityTone = 'exact' | 'high' | 'moderate' | 'low' | 'none';

export interface SimilarityBand {
  label: string;
  tone: SimilarityTone;
}

/**
 * Maps a live comparison outcome to a similarity band using the engine's own thresholds
 * (exact curve match, then 90 / 70). Kept pure so the gallery and tests agree.
 */
export function similarityBand(exactCurveData: boolean, primaryValue: number | null): SimilarityBand {
  if (exactCurveData) return { label: 'Exact curve data', tone: 'exact' };
  if (primaryValue === null) return { label: 'No shared joints', tone: 'none' };
  if (primaryValue >= 90) return { label: 'High similarity', tone: 'high' };
  if (primaryValue >= 70) return { label: 'Moderate similarity', tone: 'moderate' };
  return { label: 'Low similarity', tone: 'low' };
}
