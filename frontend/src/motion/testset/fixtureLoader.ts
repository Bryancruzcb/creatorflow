import { readFileSync } from 'node:fs';
import type { MotionCurves } from '../motionCurves';

export interface RigMotionFixture {
  formatVersion: 1;
  rigId: string;
  source: string;
  nodes: string[];
  clips: MotionCurves[];
}

export type FixtureRigId = 'robot' | 'fox';

export function loadRigFixture(rigId: FixtureRigId): RigMotionFixture {
  const url = new URL(`./fixtures/${rigId}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as RigMotionFixture;
}
