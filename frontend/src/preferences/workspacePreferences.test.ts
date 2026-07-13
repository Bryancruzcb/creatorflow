import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  WORKSPACE_PREFERENCES_KEY,
  readWorkspacePreferences,
  validateWorkspacePreferences,
  writeWorkspacePreferences,
} from './workspacePreferences';

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

describe('workspace preferences', () => {
  it('falls back safely when saved JSON is malformed', () => {
    const storage = memoryStorage({ [WORKSPACE_PREFERENCES_KEY]: '{not-json' });

    expect(readWorkspacePreferences(storage)).toEqual(DEFAULT_WORKSPACE_PREFERENCES);
  });

  it('merges partial records and validates every field', () => {
    const result = validateWorkspacePreferences({
      analysisMode: 'timing',
      jointScope: 'face',
      sampleCount: 72,
      autoplay: false,
      poseTrail: 'yes',
      previewQuality: 'sharp',
      reviewThreshold: 104.7,
      releaseDefaultView: 'map',
    });

    expect(result).toEqual({
      ...DEFAULT_WORKSPACE_PREFERENCES,
      analysisMode: 'timing',
      autoplay: false,
      previewQuality: 'sharp',
      reviewThreshold: 100,
      releaseDefaultView: 'map',
    });
  });

  it('migrates the legacy release preference and retires legacy keys after a successful save', () => {
    const storage = memoryStorage({
      'creatorflow:release-preference': 'map',
      'creatorflow:release-mode': 'guided',
    });
    const preferences = readWorkspacePreferences(storage);

    expect(preferences.releaseDefaultView).toBe('map');
    expect(writeWorkspacePreferences(preferences, storage)).toBe(true);
    expect(storage.getItem('creatorflow:release-preference')).toBeNull();
    expect(storage.getItem('creatorflow:release-mode')).toBeNull();
    expect(JSON.parse(storage.getItem(WORKSPACE_PREFERENCES_KEY) ?? '{}')).toEqual(preferences);
  });

  it('uses a legacy release view only for a missing or invalid canonical value', () => {
    const storage = memoryStorage({
      [WORKSPACE_PREFERENCES_KEY]: JSON.stringify({ analysisMode: 'loop', releaseDefaultView: 'unknown' }),
      'creatorflow:release-mode': 'map',
    });

    expect(readWorkspacePreferences(storage)).toMatchObject({ analysisMode: 'loop', releaseDefaultView: 'map' });
  });
});
