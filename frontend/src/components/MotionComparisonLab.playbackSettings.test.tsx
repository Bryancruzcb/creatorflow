// @vitest-environment jsdom
//
// The playback-settings note on the "Latest Studio evidence" card (#121).
//
// Two clips identical except for `Looped` have identical curve data, so they score 100 across the
// board and the verdict reads EXACT_CURVE_DATA. That is the honest reading of a curve-data
// fingerprint and it is not changing. What was missing is that a reviewer had no way to tell a
// looping idle from a one-shot pose while looking at that verdict — the settings were stored and
// never shown. These tests pin the note that closes that gap, and, just as hard, pin the three
// cases where it must NOT appear.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LatestStudioEvidence, playbackSettingsNote } from './MotionComparisonLab';
import type { LocalMotionComparison } from '../bridge/localBridge';

// vitest.config.ts does not enable `globals`, so Testing Library registers no automatic cleanup
// and renders would pile up in one document — the absence assertions below query the whole body.
afterEach(() => {
  cleanup();
});

function comparison(overrides: Partial<LocalMotionComparison>): LocalMotionComparison {
  return {
    id: 'cmp-abcdef12', projectId: 1, sourceAssetId: '1001', candidateAssetId: '1002',
    sourceName: 'Idle', candidateName: 'Idle Copy',
    sourceDuration: 1, candidateDuration: 1,
    sourceFingerprint: 'fp1', candidateFingerprint: 'fp1',
    overallPercent: 100, posePercent: 100, timingPercent: 100, coveragePercent: 100,
    exactCurveData: true, verdict: 'Exact curve data — provenance required',
    algorithmVersion: 'creatorflow.motion-comparison/v2-web',
    createdAt: new Date('2026-08-02T12:00:00Z').toISOString(), result: {},
    ...overrides,
  };
}

describe('playbackSettingsNote', () => {
  it('says nothing when both sides recorded the same settings', () => {
    expect(playbackSettingsNote(comparison({
      sourcePlayback: { looped: true, priority: 'Movement' },
      candidatePlayback: { looped: true, priority: 'Movement' },
    }))).toBeNull();
  });

  it('says nothing for records that predate playback settings', () => {
    expect(playbackSettingsNote(comparison({}))).toBeNull();
  });

  it('says nothing when only one side recorded settings', () => {
    // Unrecorded is not "different". A record with one observed side and one unobserved one
    // supports no claim about drift, and a note here would manufacture one out of a schema change.
    expect(playbackSettingsNote(comparison({
      sourcePlayback: { looped: true, priority: 'Movement' },
    }))).toBeNull();
    expect(playbackSettingsNote(comparison({
      candidatePlayback: { looped: false, priority: 'Action' },
    }))).toBeNull();
    // Same rule field by field: a side that recorded a loop flag but no priority can be compared
    // on the flag alone.
    expect(playbackSettingsNote(comparison({
      sourcePlayback: { looped: true },
      candidatePlayback: { looped: true, priority: 'Action' },
    }))).toBeNull();
  });

  it('names only the loop flag when only the loop flag differs', () => {
    const note = playbackSettingsNote(comparison({
      sourcePlayback: { looped: true, priority: 'Movement' },
      candidatePlayback: { looped: false, priority: 'Movement' },
    }));
    expect(note).toBe('Playback settings differ (Looped: yes vs no) — reference first. '
      + 'These sit outside the curve fingerprint, so they do not change the scores or the verdict.');
  });

  it('names only the priority when only the priority differs', () => {
    const note = playbackSettingsNote(comparison({
      sourcePlayback: { looped: true, priority: 'Movement' },
      candidatePlayback: { looped: true, priority: 'Action' },
    }));
    expect(note).toBe('Playback settings differ (Priority: Movement vs Action) — reference first. '
      + 'These sit outside the curve fingerprint, so they do not change the scores or the verdict.');
  });

  it('names both when both differ, reference first', () => {
    const note = playbackSettingsNote(comparison({
      sourcePlayback: { looped: true, priority: 'Movement' },
      candidatePlayback: { looped: false, priority: 'Action' },
    }));
    expect(note).toBe('Playback settings differ (Looped: yes vs no, Priority: Movement vs Action) — reference first. '
      + 'These sit outside the curve fingerprint, so they do not change the scores or the verdict.');
    // Reversed sides read reversed, or the note would be pointing a reviewer at the wrong clip.
    const swapped = playbackSettingsNote(comparison({
      sourcePlayback: { looped: false, priority: 'Action' },
      candidatePlayback: { looped: true, priority: 'Movement' },
    }));
    expect(swapped).toBe('Playback settings differ (Looped: no vs yes, Priority: Action vs Movement) — reference first. '
      + 'These sit outside the curve fingerprint, so they do not change the scores or the verdict.');
  });

  it('says it on a non-exact verdict too', () => {
    // The gap #121 names is loudest under EXACT_CURVE_DATA, but a loop flag that flipped is worth
    // knowing at any score, and a note that appears only at 100 would read as part of the verdict.
    expect(playbackSettingsNote(comparison({
      exactCurveData: false, verdict: 'High similarity', overallPercent: 82,
      sourcePlayback: { looped: true, priority: 'Movement' },
      candidatePlayback: { looped: false, priority: 'Movement' },
    }))).toContain('Looped: yes vs no');
  });
});

describe('Latest Studio evidence playback note', () => {
  it('renders beside the verdict when the settings differ', () => {
    render(<LatestStudioEvidence comparison={comparison({
      sourcePlayback: { looped: true, priority: 'Movement' },
      candidatePlayback: { looped: false, priority: 'Action' },
    })} />);
    expect(screen.getByText(/Playback settings differ \(Looped: yes vs no, Priority: Movement vs Action\)/)).toBeTruthy();
    // Beside, not instead of: the verdict and the exactness claim are untouched by this note.
    expect(screen.getByText('Exact curve data — provenance required')).toBeTruthy();
    expect(screen.getByText(/Exact canonical curves ·/)).toBeTruthy();
  });

  it('renders nothing new when the settings match', () => {
    render(<LatestStudioEvidence comparison={comparison({
      sourcePlayback: { looped: true, priority: 'Movement' },
      candidatePlayback: { looped: true, priority: 'Movement' },
    })} />);
    expect(screen.queryByText(/Playback settings differ/)).toBeNull();
  });

  it('renders nothing new for records that predate playback settings', () => {
    render(<LatestStudioEvidence comparison={comparison({})} />);
    expect(screen.queryByText(/Playback settings differ/)).toBeNull();
  });
});
