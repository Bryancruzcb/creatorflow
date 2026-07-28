/**
 * Thread wrapper. All of the actual work — and all of the reasoning about it — lives in
 * `./deviation.ts`, which is pure and directly testable.
 *
 * Keep this file boring. Anything added here is code that can only be exercised by starting a real
 * worker, which is why the search itself was moved out.
 */

import { run } from './deviation';
import type { DeviationRequest } from './deviation';

export type { DeviationRequest, DeviationProgress, DeviationResult } from './deviation';

self.onmessage = (event: MessageEvent<DeviationRequest>) => {
  const result = run(event.data, (progress) => (self as unknown as Worker).postMessage(progress));
  (self as unknown as Worker).postMessage(result, [result.distances.buffer]);
};
