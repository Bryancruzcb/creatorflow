/**
 * The nearest-neighbour deviation search. Pure, and deliberately free of any worker API.
 *
 * It lives apart from `deviation.worker.ts` so it can be tested directly: the worker module
 * assigns `self.onmessage` at import time, which throws outside a worker context and made the
 * algorithm untestable from node. The worker is now a thread wrapper around this and nothing more.
 *
 * This ran synchronously inside the render component. On a real ~52k-triangle component it held
 * the main thread for minutes and Chrome reported the renderer as unresponsive, so the feature was
 * effectively unusable on exactly the assets it exists for.
 *
 * Points arrive as flat Float32Arrays and are transferred rather than copied, so a 60,000-point
 * source costs one pointer handoff instead of a structured clone. That transfer is the one real
 * difference from the main-thread version: coordinates are now float32 where they were float64, so
 * a point sitting within ~1e-7 of a cell boundary can bucket one cell over. It changes which
 * neighbour wins a tie, never the measured distance beyond float32 precision, and the ceiling this
 * feeds is 0.12 — seven orders of magnitude coarser. Worth stating rather than claiming the
 * results are bit-identical, which they are not.
 */

export interface DeviationRequest {
  /** Flat xyz triples of the reference surface. */
  source: Float32Array;
  /** Flat xyz triples of the surface being measured. */
  target: Float32Array;
  cellSize: number;
  /** Distance treated as the top of the scale. */
  ceiling: number;
}

export interface DeviationProgress {
  type: 'progress';
  done: number;
  total: number;
}

export interface DeviationResult {
  type: 'result';
  /** One distance per target point. NaN marks a point with no neighbour in range. */
  distances: Float32Array;
  mean: number;
  maximum: number;
  samples: number;
  /** Target points that had no neighbour within the search radius. */
  unmeasured: number;
}

const CELL_RANGE = 512;

function cellKey(cx: number, cy: number, cz: number) {
  if (cx < -CELL_RANGE || cx >= CELL_RANGE || cy < -CELL_RANGE || cy >= CELL_RANGE || cz < -CELL_RANGE || cz >= CELL_RANGE) return -1;
  return ((cx + CELL_RANGE) * 1024 + (cy + CELL_RANGE)) * 1024 + (cz + CELL_RANGE);
}

/** Progress is reported through the callback so the pure search stays free of postMessage. */
export function run(request: DeviationRequest, onProgress?: (progress: DeviationProgress) => void): DeviationResult {
  const { source, target, cellSize, ceiling } = request;

  const grid = new Map<number, number[]>();
  for (let i = 0; i < source.length; i += 3) {
    const key = cellKey(
      Math.floor(source[i] / cellSize),
      Math.floor(source[i + 1] / cellSize),
      Math.floor(source[i + 2] / cellSize),
    );
    if (key < 0) continue;
    const bucket = grid.get(key);
    if (bucket) bucket.push(source[i], source[i + 1], source[i + 2]);
    else grid.set(key, [source[i], source[i + 1], source[i + 2]]);
  }

  const count = target.length / 3;
  const distances = new Float32Array(count);
  let sum = 0;
  let maximum = 0;
  let samples = 0;
  let unmeasured = 0;

  const progressEvery = Math.max(1, Math.floor(count / 40));

  for (let index = 0; index < count; index += 1) {
    const px = target[index * 3];
    const py = target[index * 3 + 1];
    const pz = target[index * 3 + 2];
    const cellX = Math.floor(px / cellSize);
    const cellY = Math.floor(py / cellSize);
    const cellZ = Math.floor(pz / cellSize);

    let minimumSquared = Number.POSITIVE_INFINITY;
    for (let radius = 0; radius <= 2; radius += 1) {
      for (let x = -radius; x <= radius; x += 1) for (let y = -radius; y <= radius; y += 1) for (let z = -radius; z <= radius; z += 1) {
        // Shell only — inner cells were covered by a previous radius.
        if (radius > 0 && Math.abs(x) !== radius && Math.abs(y) !== radius && Math.abs(z) !== radius) continue;
        const key = cellKey(cellX + x, cellY + y, cellZ + z);
        if (key < 0) continue;
        const bucket = grid.get(key);
        if (!bucket) continue;
        for (let offset = 0; offset < bucket.length; offset += 3) {
          const dx = px - bucket[offset];
          const dy = py - bucket[offset + 1];
          const dz = pz - bucket[offset + 2];
          const squared = dx * dx + dy * dy + dz * dz;
          if (squared < minimumSquared) minimumSquared = squared;
        }
      }
      // A cell at Chebyshev radius r+1 has every point at least r*cellSize away, so a hit inside
      // that bound cannot be beaten further out.
      const guaranteed = radius * cellSize;
      if (minimumSquared <= guaranteed * guaranteed) break;
    }

    if (Number.isFinite(minimumSquared)) {
      const distance = Math.sqrt(minimumSquared);
      distances[index] = distance;
      sum += distance;
      if (distance > maximum) maximum = distance;
      samples += 1;
    } else {
      // No neighbour in range: unmeasured, which is NOT the same as maximally different.
      distances[index] = Number.NaN;
      unmeasured += 1;
    }

    if (index % progressEvery === 0) onProgress?.({ type: 'progress', done: index, total: count });
  }

  void ceiling;
  return {
    type: 'result',
    distances,
    mean: samples > 0 ? sum / samples : 0,
    maximum,
    samples,
    unmeasured,
  };
}
