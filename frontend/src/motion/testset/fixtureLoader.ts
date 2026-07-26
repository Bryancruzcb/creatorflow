import { readFileSync } from 'node:fs';
import type { MotionCurves } from '../motionCurves';

export interface RigMotionFixture {
  formatVersion: 1;
  rigId: string;
  source: string;
  nodes: string[];
  clips: MotionCurves[];
}

export type FixtureRigId = 'robot' | 'fox' | 'cesiumMan' | 'riggedFigure' | 'riggedSimple';

/**
 * Every rig in the test set, in one place, so adding a fixture widens every consumer at once
 * rather than only the call sites someone remembered to update.
 *
 * `robot` and `fox` carry several clips each and so contribute both positives (programmatic
 * derivations) and negatives (distinct clips on the same rig). The three Cesium rigs carry a
 * single clip apiece: they broaden the skeleton topologies the derivations are tested against —
 * including a third joint-naming convention for mirroring — but contribute no negatives, because
 * a negative needs two different clips on one rig.
 */
export const ALL_RIG_IDS: FixtureRigId[] = ['robot', 'fox', 'cesiumMan', 'riggedFigure', 'riggedSimple'];

export function loadAllRigFixtures(): RigMotionFixture[] {
  return ALL_RIG_IDS.map(loadRigFixture);
}

export function loadRigFixture(rigId: FixtureRigId): RigMotionFixture {
  const url = new URL(`./fixtures/${rigId}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as RigMotionFixture;
}
