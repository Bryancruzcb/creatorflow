/**
 * TS mirror of the Java normalized-animation records (core/src/main/java/creatorflow/motion/).
 * transform holds the 12 CFrame components the Java engine reads: [0..2] position,
 * [3..11] row-major 3x3 rotation (m00,m01,m02,m10,m11,m12,m20,m21,m22).
 * Types only — the numeric core trusts its callers (the Java-generated oracle and
 * clipToNormalized, which synthesizes canonical values).
 */
export interface NormalizedPoseJson {
  jointPath: string;
  transform: number[];
  weight: number;
  easingStyle: string;
  easingDirection: string;
}

export interface NormalizedKeyframeJson {
  time: number;
  poses: NormalizedPoseJson[];
}

export interface NormalizedAnimationJson {
  assetId: string;
  name: string;
  duration: number;
  looped: boolean;
  priority: string;
  keyframes: NormalizedKeyframeJson[];
}
