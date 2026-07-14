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
