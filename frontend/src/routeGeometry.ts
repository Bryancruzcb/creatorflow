/**
 * Geometry for the landing page's survey canvas: the topographic contours behind it and the
 * route that runs from the verdict marker through the four stations.
 *
 * Both are calculations. The contours trace a fixed, seeded height field with marching squares,
 * so the same size always draws the same terrain; the route smooths a list of measured points
 * into one cubic path and splits it where the walked part ends. The component measures the DOM
 * and writes the paths; nothing here touches it.
 */

export interface Point {
  x: number;
  y: number;
}

/** A deterministic 32-bit generator (mulberry32), so the terrain never changes between visits. */
function seeded(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Hill {
  x: number;
  y: number;
  spread: number;
  height: number;
}

const HILL_CELL = 430;

/** One hill per cell of a coarse grid, jittered inside its cell; about a quarter are hollows. */
function hillAt(i: number, j: number): Hill {
  const random = seeded((i * 73856093) ^ (j * 19349663) ^ 0x5eed);
  return {
    x: (i + 0.15 + random() * 0.7) * HILL_CELL,
    y: (j + 0.15 + random() * 0.7) * HILL_CELL,
    spread: 150 + random() * 210,
    height: (random() < 0.28 ? -1 : 1) * (0.55 + random() * 0.75),
  };
}

function heightAt(x: number, y: number, hill: (i: number, j: number) => Hill): number {
  const wx = x + 34 * Math.sin(y / 151);
  const wy = y + 34 * Math.sin(x / 197);
  let value = 0.32 * Math.sin(wx / 420 + Math.sin(wy / 330)) + 0.22 * Math.cos(wy / 280 - wx / 760);
  const ci = Math.floor(wx / HILL_CELL);
  const cj = Math.floor(wy / HILL_CELL);
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const h = hill(i, j);
      const dx = wx - h.x;
      const dy = wy - h.y;
      value += h.height * Math.exp(-(dx * dx + dy * dy) / (h.spread * h.spread));
    }
  }
  return value;
}

type Edge = 't' | 'r' | 'b' | 'l';

/** Edge pairs per marching-squares case (corners: top-left 8, top-right 4, bottom-right 2, bottom-left 1). */
const CASES: readonly (readonly (readonly [Edge, Edge])[])[] = [
  [], [['l', 'b']], [['b', 'r']], [['l', 'r']],
  [['t', 'r']], [['t', 'l'], ['b', 'r']], [['t', 'b']], [['t', 'l']],
  [['t', 'l']], [['t', 'b']], [['t', 'r'], ['l', 'b']], [['t', 'r']],
  [['l', 'r']], [['b', 'r']], [['l', 'b']], [],
];

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface ContourPaths {
  /** SVG path data for the ordinary contour lines. */
  minor: string;
  /** Every fifth level, drawn a little stronger, like an index contour on a survey map. */
  major: string;
}

/**
 * Traces 31 contour levels of the height field over a `width` × `height` box, sampled every
 * `step` px. Cost grows with (width / step) × (height / step); the caller buckets the height so a
 * small layout change does not retrace it.
 */
export function contourPaths(width: number, height: number, step: number): ContourPaths {
  if (width <= 0 || height <= 0 || step <= 0) return { minor: '', major: '' };
  const cache = new Map<string, Hill>();
  const hill = (i: number, j: number) => {
    const key = `${i},${j}`;
    let found = cache.get(key);
    if (!found) {
      found = hillAt(i, j);
      cache.set(key, found);
    }
    return found;
  };
  const cols = Math.ceil(width / step) + 1;
  const rows = Math.ceil(height / step) + 1;
  const field = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) field[r * cols + c] = heightAt(c * step, r * step, hill);
  }

  const minor: string[] = [];
  const major: string[] = [];
  for (let k = -12; k <= 18; k++) {
    const level = k * 0.13 + 0.03;
    const out = k % 5 === 0 ? major : minor;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const tl = field[r * cols + c];
        const tr = field[r * cols + c + 1];
        const br = field[(r + 1) * cols + c + 1];
        const bl = field[(r + 1) * cols + c];
        const index = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
        if (index === 0 || index === 15) continue;
        const x0 = c * step;
        const y0 = r * step;
        const at: Record<Edge, () => [number, number]> = {
          t: () => [x0 + (step * (level - tl)) / (tr - tl), y0],
          r: () => [x0 + step, y0 + (step * (level - tr)) / (br - tr)],
          b: () => [x0 + (step * (level - bl)) / (br - bl), y0 + step],
          l: () => [x0, y0 + (step * (level - tl)) / (bl - tl)],
        };
        for (const [from, to] of CASES[index]) {
          const p = at[from]();
          const q = at[to]();
          out.push(`M${round1(p[0])} ${round1(p[1])}L${round1(q[0])} ${round1(q[1])}`);
        }
      }
    }
  }
  return { minor: minor.join(''), major: major.join('') };
}

/** Long gaps between stations get extra bends this far apart, so the route meanders. */
const WAYPOINT_EVERY = 240;

interface Waypoint extends Point {
  /** Index of the route point this waypoint is, or -1 for an inserted bend. */
  node: number;
}

function waypoints(points: readonly Point[], swing: number): Waypoint[] {
  return points.flatMap((point, i): Waypoint[] => {
    if (i === 0) return [{ ...point, node: 0 }];
    const previous = points[i - 1];
    const parts = Math.max(1, Math.round((point.y - previous.y) / WAYPOINT_EVERY));
    const bends = Array.from({ length: parts - 1 }, (_, j): Waypoint => ({
      x: previous.x + (point.x - previous.x) * ((j + 1) / parts) + ((i + j) % 2 ? swing : -swing),
      y: previous.y + (point.y - previous.y) * ((j + 1) / parts),
      node: -1,
    }));
    return [...bends, { ...point, node: i }];
  });
}

export interface RoutePaths {
  /** From the marker up to the route point the release has reached: drawn solid. */
  walked: string;
  /** The rest: drawn dotted. */
  ahead: string;
}

/**
 * Smooths the points into Catmull-Rom curves (as cubic Béziers) and splits them at route point
 * `walkedTo`. `walkedTo` 0 means only the marker has been reached, so the whole route is ahead.
 */
export function routePaths(points: readonly Point[], walkedTo: number, swing: number): RoutePaths {
  if (points.length < 2) return { walked: '', ahead: '' };
  const way = waypoints(points, swing);
  const split = way.findIndex((point) => point.node === Math.min(walkedTo, points.length - 1));
  const walked: string[] = [];
  const ahead: string[] = [];
  for (let i = 0; i < way.length - 1; i++) {
    const p0 = way[i - 1] ?? way[i];
    const p1 = way[i];
    const p2 = way[i + 1];
    const p3 = way[i + 2] ?? p2;
    const d = `M${round1(p1.x)} ${round1(p1.y)}C${round1(p1.x + (p2.x - p0.x) / 6)} ${round1(p1.y + (p2.y - p0.y) / 6)} `
      + `${round1(p2.x - (p3.x - p1.x) / 6)} ${round1(p2.y - (p3.y - p1.y) / 6)} ${round1(p2.x)} ${round1(p2.y)}`;
    (i < split ? walked : ahead).push(d);
  }
  return { walked: walked.join(''), ahead: ahead.join('') };
}
