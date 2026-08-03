// @vitest-environment jsdom
//
// The "Latest Studio evidence" card's exactness claim. LatestStudioEvidence is exported from
// MotionComparisonLab.tsx and rendered directly here: the lab itself owns a WebGL stage and a
// bridge client, and none of that is what this claim depends on.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LatestStudioEvidence } from './MotionComparisonLab';
import type { LocalMotionComparison } from '../bridge/localBridge';

// vitest.config.ts does not enable `globals`, so Testing Library registers no automatic cleanup
// and renders would pile up in one document — the absence assertions below query the whole body.
afterEach(() => {
  cleanup();
});

function comparison(overrides: Partial<LocalMotionComparison>): LocalMotionComparison {
  return {
    id: 'cmp-abcdef12', projectId: 1, sourceAssetId: '1001', candidateAssetId: '1002',
    sourceName: 'Walk', candidateName: 'Walk Candidate',
    sourceDuration: 1, candidateDuration: 1,
    sourceFingerprint: 'fp1', candidateFingerprint: 'fp1',
    overallPercent: 100, posePercent: 100, timingPercent: 100, coveragePercent: 100,
    exactCurveData: true, verdict: 'EXACT_CURVE_DATA', algorithmVersion: 'creatorflow.motion-comparison/v2-web',
    createdAt: new Date('2026-08-02T12:00:00Z').toISOString(), result: {},
    ...overrides,
  };
}

describe('Latest Studio evidence exactness claim', () => {
  it('states the unqualified claim when both sides were read as keyframes', () => {
    render(<LatestStudioEvidence comparison={comparison({ sourceKind: 'KEYFRAME', candidateKind: 'KEYFRAME' })} />);
    expect(screen.getByText(/Exact canonical curves ·/)).toBeTruthy();
    expect(screen.queryByText(/curve-sampled/i)).toBeNull();
  });

  it('states the unqualified claim for records that predate clip kinds', () => {
    render(<LatestStudioEvidence comparison={comparison({})} />);
    expect(screen.getByText(/Exact canonical curves ·/)).toBeTruthy();
    expect(screen.queryByText(/curve-sampled/i)).toBeNull();
  });

  it('qualifies the claim and names the side when one side is curve-sampled', () => {
    render(<LatestStudioEvidence comparison={comparison({ sourceKind: 'CURVE_SAMPLED', candidateKind: 'KEYFRAME' })} />);
    expect(screen.getByText(/the reference curve-sampled, so this matches the sampled reconstruction, not an authored-keyframe read/)).toBeTruthy();
    // Same card, candidate sampled instead: the named side has to follow the data, or the
    // qualifier would be pointing a reader at the wrong clip.
    cleanup();
    render(<LatestStudioEvidence comparison={comparison({ sourceKind: 'KEYFRAME', candidateKind: 'CURVE_SAMPLED' })} />);
    expect(screen.getByText(/the candidate curve-sampled, so this matches the sampled reconstruction, not an authored-keyframe read/)).toBeTruthy();
  });

  it('qualifies the claim when both sides are curve-sampled', () => {
    render(<LatestStudioEvidence comparison={comparison({ sourceKind: 'CURVE_SAMPLED', candidateKind: 'CURVE_SAMPLED' })} />);
    expect(screen.getByText(/both sides curve-sampled, so this matches the sampled reconstruction, not an authored-keyframe read/)).toBeTruthy();
  });

  it('leaves the mirrored and non-exact claims alone', () => {
    render(<LatestStudioEvidence comparison={comparison({ exactCurveData: false, verdict: 'HIGH_SIMILARITY', sourceKind: 'CURVE_SAMPLED' })} />);
    expect(screen.getByText(/Similarity signal ·/)).toBeTruthy();
    cleanup();
    render(<LatestStudioEvidence comparison={comparison({ exactCurveData: false, mirrored: true, verdict: 'HIGH_SIMILARITY', sourceKind: 'CURVE_SAMPLED' })} />);
    expect(screen.getByText(/Similarity found MIRRORED, not as submitted ·/)).toBeTruthy();
  });
});
