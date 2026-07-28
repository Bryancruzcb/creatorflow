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
  // One word plus the number. These sit next to a card title in a narrow column, and the longer
  // phrasing ("Exact curve data 100%") squeezed the title until every word broke onto its own
  // line. The percentage already says what is being measured.
  if (exactCurveData) return { label: 'Exact', tone: 'exact' };
  if (primaryValue === null) return { label: 'No shared joints', tone: 'none' };
  if (primaryValue >= 90) return { label: 'High', tone: 'high' };
  if (primaryValue >= 70) return { label: 'Moderate', tone: 'moderate' };
  return { label: 'Low', tone: 'low' };
}
