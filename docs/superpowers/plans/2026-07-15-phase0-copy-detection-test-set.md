# Phase 0 — Copy-Detection Test Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the labeled copy-detection test set + vitest scorecard harness that grades every future motion-engine change on recall (positives caught) and false-positive rate (negatives wrongly flagged), per `docs/FABLE5-HANDOFF-motion-engine.md` Phase 0.

**Architecture:** A Node script extracts the two licensed rigs' animation curves (via three's own `GLTFLoader`, headless, render sections stripped) into committed curve-JSON fixtures — the same JSON shape Phase 2 will use as the registry wire format. Pure, deterministic derivation functions turn each base clip into labeled positives (re-upload, re-time ×2, hold-insert, rescale, relocate, mirror); within-rig clip pairs become labeled negatives. An engine-agnostic scorecard runner grades any `(sourceClip, candidateClip) → outcome` adapter over the case list; the harness runs the CURRENT TS engine through the app's real entry point (`compareClips`), prints the scorecard, and pins per-case flagged/not-flagged results in a committed baseline file so no engine change can move the numbers silently.

**Tech Stack:** TypeScript, vitest 4, three ^0.185 (`AnimationClip`/`KeyframeTrack`/interpolants), Node ≥18 (`structuredClone`, ESM scripts). No new dependencies.

## Global Constraints

(from `docs/FABLE5-HANDOFF-motion-engine.md` — apply to every task)

- **Precision outranks recall.** A false accusation is the worst output. Mislabeling a case is worse than skipping it — when a derivation can't be generated honestly, throw; never emit a dubious "positive".
- **Never pair robot-vs-fox.** Cross-rig pairs trivially non-match via zero coverage and validate nothing.
- **No engine changes in Phase 0.** The harness grades `frontend/src/motion/motionAnalysis.ts` as-is via `compareClips` from `MotionComparisonLab.tsx` with the app's real defaults: mode `'shape'`, jointScope `'full'`, sampleCount `48`, reviewThreshold `85`. Flagged = `tone !== 'neutral'` (i.e. `exactCurveData` or score ≥ 85).
- **Acceptance:** `npm test` (from `frontend/`) runs the harness and prints a recall / false-positive scorecard; generated fixtures and the baseline are committed.
- **Branch:** `claude/motion-engine-registry`. One logical change per commit. Do not push or open a PR unless Bryan asks.
- Baseline suite is green before this work: 7 files / 33 tests pass (verified 2026-07-15, 543 ms).

## Verified facts the plan relies on (probed 2026-07-15, do not re-derive)

- `GLTFLoader.parse` works headless in Node **after stripping** `materials`/`textures`/`images`/`samplers` and `primitive.material` from the GLB JSON chunk (fox has 1 texture and fails un-stripped with `self is not defined`; robot parses either way). GLB chunk surgery idiom already exists in `frontend/scripts/derive-glb-assets.mjs`.
- All animation samplers in both GLBs are **LINEAR** — no STEP/CUBICSPLINE handling needed; extraction must assert this.
- three deduplicates node names (`Head_2`, `Head_3`, `Head_4` are morph-mesh nodes) and sanitizes `.L`→`L` — track names look like `UpperArmL.quaternion`, `FootR.position`, `Head_2.morphTargetInfluences`. Extraction MUST go through three's loader so fixture track names match the app exactly.
- Robot: 14 clips, 74 nodes, trailing-`L`/`R` side naming, every clip has `Body.position`. Fox: 3 clips (each animating the identical 21 tracks), `b_Left*`/`b_Right*` naming where the L/R pair has DIFFERENT numeric suffixes (`b_RightUpperArm_06` ↔ `b_LeftUpperArm_09`) — the mirror map must pair by suffix-stripped core name, not string substitution. Every fox clip has `b_Hip_01.position`.
- Animation curve payload is small: ~116 KB (robot) + ~52 KB (fox) of float32 → committed JSON fixtures land well under 1 MB total.
- `vitest.config.ts` includes `src/**/*.test.ts` only; `workspacePreferences.tsx` defaults: sampleCount 48, reviewThreshold 85; the live-registry code path calls the engine with jointScope `'full'` (`MotionComparisonLab.tsx:652`).

## File Structure

```
frontend/
  scripts/extract-motion-fixtures.mjs          # GLB → per-rig curve-JSON fixture (npm run fixtures:motion)
  src/motion/
    motionCurves.ts                            # MotionCurves JSON format + (de)serialize — reused by Phase 2
    motionCurves.test.ts
    testset/
      README.md                                # what the set is, labels, honesty caveats, how to regenerate
      fixtures/robot.json                      # generated + committed
      fixtures/fox.json                        # generated + committed
      fixtureLoader.ts                         # fs-based fixture loading (no tsconfig JSON-import fiddling)
      fixtures.test.ts                         # invariants over the committed fixtures
      derivations.ts                           # pure labeled transforms
      derivations.test.ts
      copyDetectionCases.ts                    # labeled case list builder
      copyDetectionCases.test.ts
      scorecard.ts                             # engine-agnostic runner + current-engine adapter + formatter
      scorecard.test.ts
      copyDetection.test.ts                    # THE harness: runs engine, prints scorecard, pins baseline
      scorecard.baseline.json                  # generated + committed
```

Case inventory this produces: **119 positives** (17 clips × 7 derivation classes), **93 negatives** (robot C(14,2)=91 −1 variant, fox C(3,2)=3), **1 variant pair** (robot Walking↔WalkJump — reported, ungraded, per the in-app "variant" scenario: "built from another clip"). Family pairs (robot Walking↔Running, fox Walk↔Run) stay IN the negatives (different works; flagging them is a false accusation) but are reported as their own class. Mirrored positives are expected to score near zero on the current engine (no mirror canonicalization until Phase 3; a mirrored clip animates the opposite side's joints, so name-matching coverage collapses) — that is the point of per-class reporting.

---

### Task 0: Branch + docs commit

**Files:**
- Commit: `docs/FABLE5-HANDOFF-motion-engine.md` (currently untracked), `docs/superpowers/plans/2026-07-15-phase0-copy-detection-test-set.md`

**Interfaces:** none.

- [ ] **Step 1: Create the working branch**

```bash
cd C:/Users/isdis/git/creatorflow
git checkout -b claude/motion-engine-registry
```

- [ ] **Step 2: Commit the handoff + this plan**

```bash
git add docs/FABLE5-HANDOFF-motion-engine.md docs/superpowers/plans/2026-07-15-phase0-copy-detection-test-set.md
git commit -m "Docs: motion-engine handoff + Phase 0 test-set plan"
```

---

### Task 1: `MotionCurves` format + (de)serialize

**Files:**
- Create: `frontend/src/motion/motionCurves.ts`
- Test: `frontend/src/motion/motionCurves.test.ts`

**Interfaces:**
- Produces (later tasks + Phase 2 rely on these exact names):
  - `interface MotionCurveTrack { name: string; type: 'vector' | 'quaternion' | 'number'; times: number[]; values: number[] }`
  - `interface MotionCurves { formatVersion: 1; name: string; duration: number; tracks: MotionCurveTrack[] }`
  - `serializeClip(clip: AnimationClip): MotionCurves`
  - `deserializeClip(data: MotionCurves): AnimationClip`
  - `trackToThree(track: MotionCurveTrack): KeyframeTrack`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/motion/motionCurves.test.ts
import { describe, expect, it } from 'vitest';
import { AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { deserializeClip, serializeClip, type MotionCurves } from './motionCurves';

function syntheticClip() {
  return new AnimationClip('Synthetic', 1.5, [
    new VectorKeyframeTrack('Body.position', [0, 0.75, 1.5], [0, 1, 0, 0.25, 1.1, 0, 0.5, 1, 0]),
    new QuaternionKeyframeTrack('Head.quaternion', [0, 1.5], [0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068]),
    new NumberKeyframeTrack('Head_2.morphTargetInfluences', [0, 1.5], [0, 0.25, 1, 0]),
  ]);
}

describe('motion curve serialization', () => {
  it('round-trips a clip exactly (serialize → deserialize → serialize)', () => {
    const first = serializeClip(syntheticClip());
    const second = serializeClip(deserializeClip(first));
    expect(second).toEqual(first);
  });

  it('serializes track type, times, and float32-exact values', () => {
    const data = serializeClip(syntheticClip());
    expect(data.formatVersion).toBe(1);
    expect(data.name).toBe('Synthetic');
    expect(data.duration).toBe(1.5);
    expect(data.tracks.map((track) => track.type)).toEqual(['vector', 'quaternion', 'number']);
    expect(data.tracks[0].times).toEqual([0, 0.75, 1.5]);
    expect(data.tracks[1].values).toEqual([0, 0, 0, 1, 0, Math.fround(0.7071068), 0, Math.fround(0.7071068)]);
  });

  it('deserializes into the correct three track classes', () => {
    const clip = deserializeClip(serializeClip(syntheticClip()));
    expect(clip.tracks[0]).toBeInstanceOf(VectorKeyframeTrack);
    expect(clip.tracks[1]).toBeInstanceOf(QuaternionKeyframeTrack);
    expect(clip.tracks[2]).toBeInstanceOf(NumberKeyframeTrack);
    expect(clip.duration).toBe(1.5);
  });

  it('rejects an unknown track type', () => {
    const bad = { formatVersion: 1, name: 'X', duration: 1, tracks: [{ name: 'A.scale', type: 'matrix', times: [0], values: [1] }] } as unknown as MotionCurves;
    expect(() => deserializeClip(bad)).toThrow(/track type/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/motion/motionCurves.test.ts`
Expected: FAIL — cannot resolve `./motionCurves`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/motion/motionCurves.ts
/**
 * Compact JSON form of a three.js AnimationClip's curves. This is both the Phase 0 fixture
 * format and the Phase 2 registry wire format — keep it stable and versioned.
 * Values are float32-exact (three stores Float32Array; JSON doubles hold them losslessly).
 */
import { AnimationClip, type KeyframeTrack, NumberKeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';

export type MotionCurveTrackType = 'vector' | 'quaternion' | 'number';

export interface MotionCurveTrack {
  name: string;
  type: MotionCurveTrackType;
  times: number[];
  values: number[];
}

export interface MotionCurves {
  formatVersion: 1;
  name: string;
  duration: number;
  tracks: MotionCurveTrack[];
}

const TRACK_CLASSES: Record<MotionCurveTrackType, new (name: string, times: number[], values: number[]) => KeyframeTrack> = {
  vector: VectorKeyframeTrack,
  quaternion: QuaternionKeyframeTrack,
  number: NumberKeyframeTrack,
};

export function serializeClip(clip: AnimationClip): MotionCurves {
  return {
    formatVersion: 1,
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.map((track) => {
      const type = (track as KeyframeTrack & { ValueTypeName: string }).ValueTypeName;
      if (type !== 'vector' && type !== 'quaternion' && type !== 'number') {
        throw new Error(`unsupported track type "${type}" on ${track.name}`);
      }
      return { name: track.name, type, times: Array.from(track.times), values: Array.from(track.values) };
    }),
  };
}

export function trackToThree(track: MotionCurveTrack): KeyframeTrack {
  const TrackClass = TRACK_CLASSES[track.type];
  if (!TrackClass) throw new Error(`unsupported track type "${track.type}" on ${track.name}`);
  return new TrackClass(track.name, track.times.slice(), track.values.slice());
}

export function deserializeClip(data: MotionCurves): AnimationClip {
  return new AnimationClip(data.name, data.duration, data.tracks.map(trackToThree));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/motion/motionCurves.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + full suite, then commit**

```bash
cd frontend && npm run typecheck && npm test
git add src/motion/motionCurves.ts src/motion/motionCurves.test.ts
git commit -m "Motion: curve JSON format with exact clip round-trip"
```

---

### Task 2: Fixture extraction script + committed fixtures + invariants test

**Files:**
- Create: `frontend/scripts/extract-motion-fixtures.mjs`
- Create: `frontend/src/motion/testset/fixtureLoader.ts`
- Modify: `frontend/package.json` (add `"fixtures:motion": "node scripts/extract-motion-fixtures.mjs"` to scripts)
- Generate + commit: `frontend/src/motion/testset/fixtures/robot.json`, `frontend/src/motion/testset/fixtures/fox.json`
- Test: `frontend/src/motion/testset/fixtures.test.ts`

**Interfaces:**
- Consumes: `MotionCurves`, `deserializeClip`, `serializeClip` from Task 1.
- Produces:
  - `interface RigMotionFixture { formatVersion: 1; rigId: string; source: string; nodes: string[]; clips: MotionCurves[] }`
  - `loadRigFixture(rigId: 'robot' | 'fox'): RigMotionFixture`
- Fixture JSON is written compact (single line) — it regenerates wholesale; line diffs are not useful.

- [ ] **Step 1: Write the failing invariants test**

```ts
// frontend/src/motion/testset/fixtures.test.ts
import { describe, expect, it } from 'vitest';
import { deserializeClip, serializeClip } from '../motionCurves';
import { loadRigFixture } from './fixtureLoader';
import { rigFixtures } from '../rigFixtures';

describe.each(['robot', 'fox'] as const)('%s motion fixture', (rigId) => {
  const fixture = loadRigFixture(rigId);
  const rig = rigFixtures.find((entry) => entry.id === rigId)!;

  it('contains exactly the clips the Motion Lab advertises', () => {
    expect(fixture.clips.map((clip) => clip.name).sort()).toEqual(rig.clips.map((clip) => clip.name).sort());
  });

  it('round-trips every clip through the three.js deserializer exactly', () => {
    for (const clip of fixture.clips) {
      expect(serializeClip(deserializeClip(clip))).toEqual(clip);
    }
  });

  it('has well-formed tracks: ascending times, value counts matching type size, positive duration', () => {
    const sizes = { vector: 3, quaternion: 4 } as const;
    for (const clip of fixture.clips) {
      expect(clip.duration).toBeGreaterThan(0);
      for (const track of clip.tracks) {
        for (let i = 1; i < track.times.length; i += 1) expect(track.times[i]).toBeGreaterThan(track.times[i - 1]);
        if (track.type !== 'number') expect(track.values.length).toBe(track.times.length * sizes[track.type]);
        else expect(track.values.length % track.times.length).toBe(0);
        expect(track.times[track.times.length - 1]).toBeLessThanOrEqual(clip.duration + 0.000001);
      }
    }
  });

  it('records the node list needed for mirror mapping', () => {
    expect(fixture.nodes.length).toBeGreaterThan(0);
    const trackNodes = new Set(fixture.clips.flatMap((clip) => clip.tracks.map((track) => track.name.slice(0, track.name.lastIndexOf('.')))));
    for (const node of trackNodes) expect(fixture.nodes).toContain(node);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/motion/testset/fixtures.test.ts`
Expected: FAIL — cannot resolve `./fixtureLoader`.

- [ ] **Step 3: Write the loader**

```ts
// frontend/src/motion/testset/fixtureLoader.ts
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
```

- [ ] **Step 4: Write the extraction script**

```js
// frontend/scripts/extract-motion-fixtures.mjs
// Extracts the licensed rigs' animation curves into committed test fixtures
// (src/motion/testset/fixtures/<rig>.json). Uses three's own GLTFLoader so track
// names match what the app produces at runtime; render-only GLB sections are
// stripped first because TextureLoader cannot run headless.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { InterpolateLinear } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const RIGS = [
  { rigId: 'robot', file: 'robot-expressive.glb' },
  { rigId: 'fox', file: 'fox-animated.glb' },
];

function stripRenderSections(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2) {
    throw new Error('not a glTF 2.0 binary file');
  }
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error('no leading JSON chunk');
  const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength));
  delete gltf.materials;
  delete gltf.textures;
  delete gltf.images;
  delete gltf.samplers;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) delete primitive.material;
  }
  const jsonText = JSON.stringify(gltf);
  const padding = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
  const jsonChunk = Buffer.from(jsonText + ' '.repeat(padding), 'utf8');
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);
  const out = Buffer.concat([buffer.subarray(0, 12), chunkHeader, jsonChunk, buffer.subarray(20 + jsonLength)]);
  out.writeUInt32LE(out.length, 8);
  return out;
}

const outDir = fileURLToPath(new URL('../src/motion/testset/fixtures/', import.meta.url));
await mkdir(outDir, { recursive: true });

for (const { rigId, file } of RIGS) {
  const raw = await readFile(fileURLToPath(new URL(`../public/assets/${file}`, import.meta.url)));
  const stripped = stripRenderSections(raw);
  const arrayBuffer = stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength);
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(arrayBuffer, '', resolve, reject));

  const nodes = [];
  gltf.scene.traverse((object) => { if (object.name) nodes.push(object.name); });

  const clips = [...gltf.animations]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((clip) => ({
      formatVersion: 1,
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.map((track) => {
        if (track.getInterpolation() !== InterpolateLinear) {
          throw new Error(`${file} ${clip.name} ${track.name}: only LINEAR interpolation is supported`);
        }
        const type = track.ValueTypeName;
        if (type !== 'vector' && type !== 'quaternion' && type !== 'number') {
          throw new Error(`${file} ${clip.name} ${track.name}: unsupported track type "${type}"`);
        }
        return { name: track.name, type, times: Array.from(track.times), values: Array.from(track.values) };
      }),
    }));

  const fixture = { formatVersion: 1, rigId, source: `public/assets/${file}`, nodes, clips };
  await writeFile(`${outDir}${rigId}.json`, JSON.stringify(fixture));
  console.log(`${rigId}: ${clips.length} clips, ${nodes.length} nodes → src/motion/testset/fixtures/${rigId}.json`);
}
```

- [ ] **Step 5: Add the npm script and generate fixtures**

In `frontend/package.json` scripts, after `"assets:stress"`, add:

```json
"fixtures:motion": "node scripts/extract-motion-fixtures.mjs",
```

Run: `cd frontend && npm run fixtures:motion`
Expected output: `robot: 14 clips, ... nodes → ...` and `fox: 3 clips, 26 nodes → ...`; both JSON files exist and total well under 1 MB.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/motion/testset/fixtures.test.ts`
Expected: PASS (8 tests — 4 per rig).

- [ ] **Step 7: Typecheck + full suite, then commit**

```bash
cd frontend && npm run typecheck && npm test
git add scripts/extract-motion-fixtures.mjs src/motion/testset/fixtureLoader.ts src/motion/testset/fixtures.test.ts src/motion/testset/fixtures package.json
git commit -m "Motion test set: extract rig clips into committed curve fixtures"
```

---

### Task 3: Labeled derivations

**Files:**
- Create: `frontend/src/motion/testset/derivations.ts`
- Test: `frontend/src/motion/testset/derivations.test.ts`

**Interfaces:**
- Consumes: `MotionCurves`, `MotionCurveTrack`, `trackToThree` from Task 1.
- Produces:
  - `reupload(clip: MotionCurves): MotionCurves`
  - `retimeUniform(clip: MotionCurves, factor: number): MotionCurves`
  - `insertHold(clip: MotionCurves, atFraction: number, holdFraction: number): MotionCurves`
  - `rescalePositions(clip: MotionCurves, scale: number): MotionCurves`
  - `relocateRoot(clip: MotionCurves, rootJoint: string, offset: [number, number, number]): MotionCurves`
  - `mirrorClip(clip: MotionCurves, swapName: (trackName: string) => string): MotionCurves`
  - `buildMirrorNameSwapper(nodes: string[]): (trackName: string) => string`
- All functions are pure (inputs never mutated) and fully deterministic (no randomness, no clocks).

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/motion/testset/derivations.test.ts
import { describe, expect, it } from 'vitest';
import type { MotionCurves } from '../motionCurves';
import { deserializeClip } from '../motionCurves';
import {
  buildMirrorNameSwapper, insertHold, mirrorClip, relocateRoot, rescalePositions, retimeUniform, reupload,
} from './derivations';

function baseClip(): MotionCurves {
  return {
    formatVersion: 1,
    name: 'Base',
    duration: 2,
    tracks: [
      { name: 'Body.position', type: 'vector', times: [0, 1, 2], values: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
      { name: 'ArmL.quaternion', type: 'quaternion', times: [0, 2], values: [0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068] },
      { name: 'Head_2.morphTargetInfluences', type: 'number', times: [0, 2], values: [0, 1] },
    ],
  };
}

describe('derivations are pure', () => {
  it('never mutates the input clip', () => {
    const clip = baseClip();
    const frozen = JSON.stringify(clip);
    reupload(clip);
    retimeUniform(clip, 0.8);
    insertHold(clip, 0.4, 0.3);
    rescalePositions(clip, 1.25);
    relocateRoot(clip, 'Body', [3, 0, 2]);
    mirrorClip(clip, buildMirrorNameSwapper(['Body', 'ArmL', 'ArmR', 'Head_2']));
    expect(JSON.stringify(clip)).toBe(frozen);
  });
});

describe('reupload', () => {
  it('is an exact curve copy under a new name', () => {
    const copy = reupload(baseClip());
    expect(copy.name).not.toBe('Base');
    expect(copy.tracks).toEqual(baseClip().tracks);
    expect(copy.duration).toBe(2);
  });
});

describe('retimeUniform', () => {
  it('scales times and duration, leaves values untouched', () => {
    const fast = retimeUniform(baseClip(), 0.8);
    expect(fast.duration).toBeCloseTo(1.6, 12);
    expect(fast.tracks[0].times).toEqual([0, 0.8, 1.6]);
    expect(fast.tracks[0].values).toEqual(baseClip().tracks[0].values);
  });
});

describe('insertHold', () => {
  it('inserts a value plateau and extends the duration', () => {
    const held = insertHold(baseClip(), 0.5, 0.25); // hold at t=1 for 0.5s
    expect(held.duration).toBeCloseTo(2.5, 12);
    const track = deserializeClip(held).tracks[0];
    const interpolant = (track as unknown as { createInterpolant: () => { evaluate: (t: number) => ArrayLike<number> } }).createInterpolant();
    expect(Array.from(interpolant.evaluate(1)).slice(0, 3)).toEqual([4, 5, 6]);
    expect(Array.from(interpolant.evaluate(1.5)).slice(0, 3)).toEqual([4, 5, 6]);   // still held
    expect(Array.from(interpolant.evaluate(2.5)).slice(0, 3)).toEqual([7, 8, 9]);   // shifted tail
  });

  it('replaces a key landing exactly on the hold point with the plateau pair', () => {
    const held = insertHold(baseClip(), 0.5, 0.25);
    const times = held.tracks[0].times;
    expect(times).toEqual([0, 1, 1.5, 2.5]);
    expect(new Set(times).size).toBe(times.length);
  });
});

describe('rescalePositions', () => {
  it('scales only vector position tracks', () => {
    const scaled = rescalePositions(baseClip(), 2);
    expect(scaled.tracks[0].values).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(scaled.tracks[1].values).toEqual(baseClip().tracks[1].values);
    expect(scaled.tracks[2].values).toEqual(baseClip().tracks[2].values);
  });
});

describe('relocateRoot', () => {
  it('offsets only the root joint position track', () => {
    const moved = relocateRoot(baseClip(), 'Body', [10, 0, -1]);
    expect(moved.tracks[0].values).toEqual([11, 2, 2, 14, 5, 5, 17, 8, 8]);
    expect(moved.tracks[1].values).toEqual(baseClip().tracks[1].values);
  });

  it('throws when the root track is missing (never emit a mislabeled positive)', () => {
    expect(() => relocateRoot(baseClip(), 'Pelvis', [1, 0, 0])).toThrow(/Pelvis/);
  });
});

describe('mirror', () => {
  const nodes = ['Body', 'Head_2', 'ArmL', 'ArmR', 'b_LeftLeg01_015', 'b_RightLeg01_019'];

  it('builds an involutive swap for both rig naming styles', () => {
    const swap = buildMirrorNameSwapper(nodes);
    expect(swap('ArmL.quaternion')).toBe('ArmR.quaternion');
    expect(swap('b_RightLeg01_019.quaternion')).toBe('b_LeftLeg01_015.quaternion');
    expect(swap('Body.position')).toBe('Body.position');
    for (const node of nodes) {
      const once = swap(`${node}.quaternion`);
      expect(swap(once)).toBe(`${node}.quaternion`);
    }
  });

  it('negates position x and quaternion y/z, leaves morph weights alone', () => {
    const mirrored = mirrorClip(baseClip(), buildMirrorNameSwapper(nodes));
    expect(mirrored.tracks[0].values).toEqual([-1, 2, 3, -4, 5, 6, -7, 8, 9]);
    expect(mirrored.tracks[1].name).toBe('ArmR.quaternion');
    expect(mirrored.tracks[1].values).toEqual([0, 0, 0, 1, 0, -0.7071068, 0, 0.7071068]);
    expect(mirrored.tracks[2].values).toEqual([0, 1]);
  });

  it('is an exact involution (mirror twice = original curves)', () => {
    const swap = buildMirrorNameSwapper(nodes);
    const twice = mirrorClip(mirrorClip(baseClip(), swap), swap);
    expect(twice.tracks.map(({ name, type, times, values }) => ({ name, type, times, values })))
      .toEqual(baseClip().tracks);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/motion/testset/derivations.test.ts`
Expected: FAIL — cannot resolve `./derivations`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/motion/testset/derivations.ts
/**
 * Labeled copy-detection derivations. Every function is pure and deterministic —
 * the derived clip IS the label, so a transform that cannot be produced honestly
 * must throw rather than emit a dubious "positive".
 *
 * Mirror math: reflection across the YZ plane (x → −x). For positions negate x;
 * for quaternions (three order x,y,z,w) the conjugated rotation is (x, −y, −z, w).
 * Left/right joints swap names so the mirrored performance lands on the opposite
 * limbs, exactly as a human-mirrored copy would.
 */
import type { MotionCurveTrack, MotionCurves } from '../motionCurves';
import { trackToThree } from '../motionCurves';

const cloneTrack = (track: MotionCurveTrack): MotionCurveTrack => ({
  ...track, times: track.times.slice(), values: track.values.slice(),
});

// −0 would break exact involution and JSON round-trips; keep zeros positive.
const negate = (value: number) => (value === 0 ? 0 : -value);

export function reupload(clip: MotionCurves): MotionCurves {
  return { ...clip, name: `${clip.name} (reupload)`, tracks: clip.tracks.map(cloneTrack) };
}

export function retimeUniform(clip: MotionCurves, factor: number): MotionCurves {
  return {
    ...clip,
    name: `${clip.name} (retimed x${factor})`,
    duration: clip.duration * factor,
    tracks: clip.tracks.map((track) => ({ ...cloneTrack(track), times: track.times.map((time) => time * factor) })),
  };
}

export function insertHold(clip: MotionCurves, atFraction: number, holdFraction: number): MotionCurves {
  const holdStart = clip.duration * atFraction;
  const hold = clip.duration * holdFraction;
  return {
    ...clip,
    name: `${clip.name} (hold)`,
    duration: clip.duration + hold,
    tracks: clip.tracks.map((track) => {
      const three = trackToThree(track);
      const size = three.getValueSize();
      const interpolant = (three as unknown as { createInterpolant: () => { evaluate: (t: number) => ArrayLike<number> } }).createInterpolant();
      const first = track.times[0] ?? 0;
      const last = track.times[track.times.length - 1] ?? first;
      const plateau = Array.from(interpolant.evaluate(Math.max(first, Math.min(last, holdStart)))).slice(0, size);
      const times: number[] = [];
      const values: number[] = [];
      track.times.forEach((time, index) => {
        if (time < holdStart) { times.push(time); values.push(...track.values.slice(index * size, (index + 1) * size)); }
      });
      times.push(holdStart, holdStart + hold);
      values.push(...plateau, ...plateau);
      track.times.forEach((time, index) => {
        if (time > holdStart) { times.push(time + hold); values.push(...track.values.slice(index * size, (index + 1) * size)); }
      });
      return { ...track, times, values };
    }),
  };
}

export function rescalePositions(clip: MotionCurves, scale: number): MotionCurves {
  return {
    ...clip,
    name: `${clip.name} (rescaled x${scale})`,
    tracks: clip.tracks.map((track) => (
      track.type === 'vector' && /\.position$/.test(track.name)
        ? { ...cloneTrack(track), values: track.values.map((value) => value * scale) }
        : cloneTrack(track)
    )),
  };
}

export function relocateRoot(clip: MotionCurves, rootJoint: string, offset: [number, number, number]): MotionCurves {
  const rootName = `${rootJoint}.position`;
  if (!clip.tracks.some((track) => track.name === rootName)) {
    throw new Error(`relocateRoot: ${clip.name} has no ${rootName} track`);
  }
  return {
    ...clip,
    name: `${clip.name} (relocated)`,
    tracks: clip.tracks.map((track) => (
      track.name === rootName
        ? { ...cloneTrack(track), values: track.values.map((value, index) => value + offset[index % 3]) }
        : cloneTrack(track)
    )),
  };
}

export function buildMirrorNameSwapper(nodes: string[]): (trackName: string) => string {
  const nodeSet = new Set(nodes);
  const map = new Map<string, string>();
  const core = (name: string) => name.replace(/_\d+$/, '');
  for (const node of nodes) {
    // Style A (robot, three-sanitized ".L"/".R"): trailing capital L/R with an existing counterpart.
    const trailing = node.match(/^(.*)([LR])$/);
    if (trailing) {
      const swapped = trailing[1] + (trailing[2] === 'L' ? 'R' : 'L');
      if (nodeSet.has(swapped)) { map.set(node, swapped); continue; }
    }
    // Style B (fox): Left/Right inside the name; the numeric suffix differs per side, so pair by core.
    if (/Left|Right/.test(node)) {
      const targetCore = core(node).replace(/Left|Right/, (side) => (side === 'Left' ? 'Right' : 'Left'));
      const matches = nodes.filter((other) => other !== node && core(other) === targetCore);
      if (matches.length === 1) map.set(node, matches[0]);
    }
  }
  return (trackName: string) => {
    const dot = trackName.lastIndexOf('.');
    return (map.get(trackName.slice(0, dot)) ?? trackName.slice(0, dot)) + trackName.slice(dot);
  };
}

export function mirrorClip(clip: MotionCurves, swapName: (trackName: string) => string): MotionCurves {
  return {
    ...clip,
    name: `${clip.name} (mirrored)`,
    tracks: clip.tracks.map((track) => {
      const renamed = { ...cloneTrack(track), name: swapName(track.name) };
      if (track.type === 'vector' && /\.position$/.test(track.name)) {
        for (let i = 0; i < renamed.values.length; i += 3) renamed.values[i] = negate(renamed.values[i]);
      } else if (track.type === 'quaternion') {
        for (let i = 0; i < renamed.values.length; i += 4) {
          renamed.values[i + 1] = negate(renamed.values[i + 1]);
          renamed.values[i + 2] = negate(renamed.values[i + 2]);
        }
      }
      return renamed;
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/motion/testset/derivations.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Typecheck + full suite, then commit**

```bash
cd frontend && npm run typecheck && npm test
git add src/motion/testset/derivations.ts src/motion/testset/derivations.test.ts
git commit -m "Motion test set: labeled derivations (retime, hold, rescale, relocate, mirror)"
```

---

### Task 4: Labeled case builder

**Files:**
- Create: `frontend/src/motion/testset/copyDetectionCases.ts`
- Test: `frontend/src/motion/testset/copyDetectionCases.test.ts`

**Interfaces:**
- Consumes: `RigMotionFixture` (Task 2), all derivations (Task 3).
- Produces:
  - `type CaseKind = 'positive' | 'negative' | 'variant'`
  - `type CaseClass = 'reupload' | 'retime-fast' | 'retime-slow' | 'hold' | 'rescale' | 'relocate' | 'mirror' | 'unrelated' | 'family' | 'variant'`
  - `interface CopyDetectionCase { id: string; rigId: string; kind: CaseKind; caseClass: CaseClass; sourceName: string; candidateName: string; source: MotionCurves; candidate: MotionCurves }`
  - `buildCases(fixtures: RigMotionFixture[]): CopyDetectionCase[]`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/motion/testset/copyDetectionCases.test.ts
import { describe, expect, it } from 'vitest';
import { buildCases } from './copyDetectionCases';
import { buildMirrorNameSwapper } from './derivations';
import { loadRigFixture } from './fixtureLoader';

describe('copy-detection case builder', () => {
  const cases = buildCases([loadRigFixture('robot'), loadRigFixture('fox')]);

  it('produces 7 labeled positives per clip (17 clips → 119)', () => {
    expect(cases.filter((entry) => entry.kind === 'positive')).toHaveLength(119);
    const classes = new Set(cases.filter((entry) => entry.kind === 'positive').map((entry) => entry.caseClass));
    expect([...classes].sort()).toEqual(['hold', 'mirror', 'relocate', 'rescale', 'retime-fast', 'retime-slow', 'reupload']);
  });

  it('produces within-rig negatives only: 90 robot + 3 fox, plus the one variant pair', () => {
    const negatives = cases.filter((entry) => entry.kind === 'negative');
    expect(negatives.filter((entry) => entry.rigId === 'robot')).toHaveLength(90);
    expect(negatives.filter((entry) => entry.rigId === 'fox')).toHaveLength(3);
    expect(cases.filter((entry) => entry.kind === 'variant')).toHaveLength(1);
    expect(cases.find((entry) => entry.kind === 'variant')!.id).toBe('robot:variant:WalkJump-vs-Walking');
  });

  it('labels the known same-family pairs as family negatives', () => {
    const family = cases.filter((entry) => entry.caseClass === 'family').map((entry) => entry.id).sort();
    expect(family).toEqual(['fox:neg:Run-vs-Walk', 'robot:neg:Running-vs-Walking']);
  });

  it('never pairs across rigs and never repeats an id', () => {
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    for (const entry of cases) expect(entry.id.startsWith(entry.rigId)).toBe(true);
  });

  it('derives candidates that differ from the source except for reupload', () => {
    for (const entry of cases.filter((c) => c.kind === 'positive' && c.caseClass !== 'reupload')) {
      expect(JSON.stringify(entry.candidate.tracks)).not.toBe(JSON.stringify(entry.source.tracks));
    }
  });

  it('mirror swapping is a complete involution on the real rigs (no half-mirrored fixtures)', () => {
    // Guards fixture regeneration: a future GLB/loader change that breaks L/R pairing
    // must fail here rather than silently emit a mislabeled mirror positive.
    for (const rigId of ['robot', 'fox'] as const) {
      const fixture = loadRigFixture(rigId);
      const swap = buildMirrorNameSwapper(fixture.nodes);
      for (const clip of fixture.clips) {
        for (const track of clip.tracks) {
          const swapped = swap(track.name);
          expect(swap(swapped), `${rigId} ${track.name} must round-trip`).toBe(track.name);
          const node = track.name.slice(0, track.name.lastIndexOf('.'));
          if (/[LR]$/.test(node) || /Left|Right/.test(node)) {
            expect(swapped, `${rigId} ${track.name} is side-marked but did not swap`).not.toBe(track.name);
          }
        }
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/motion/testset/copyDetectionCases.test.ts`
Expected: FAIL — cannot resolve `./copyDetectionCases`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/motion/testset/copyDetectionCases.ts
/**
 * Builds the labeled copy-detection case list from the committed rig fixtures.
 * Positives are programmatic derivations (the label is true by construction);
 * negatives are distinct clips on the same rig. Cross-rig pairs are forbidden —
 * they trivially non-match via zero coverage and validate nothing.
 *
 * Walking↔WalkJump is 'variant' (WalkJump is built from Walking per the rig
 * scenarios): reported, but excluded from both recall and false-positive gating.
 * Walking↔Running / Walk↔Run are DIFFERENT works that share a gait family —
 * flagging them would be a false accusation, so they stay negatives ('family').
 */
import type { MotionCurves } from '../motionCurves';
import {
  buildMirrorNameSwapper, insertHold, mirrorClip, relocateRoot, rescalePositions, retimeUniform, reupload,
} from './derivations';
import type { RigMotionFixture } from './fixtureLoader';

export type CaseKind = 'positive' | 'negative' | 'variant';
export type CaseClass =
  | 'reupload' | 'retime-fast' | 'retime-slow' | 'hold' | 'rescale' | 'relocate' | 'mirror'
  | 'unrelated' | 'family' | 'variant';

export interface CopyDetectionCase {
  id: string;
  rigId: string;
  kind: CaseKind;
  caseClass: CaseClass;
  sourceName: string;
  candidateName: string;
  source: MotionCurves;
  candidate: MotionCurves;
}

const RETIME_FAST = 0.8;
const RETIME_SLOW = 1.25;
const HOLD_AT = 0.4;
const HOLD_LENGTH = 0.3;
const RESCALE = 1.25;
const RELOCATE: [number, number, number] = [3, 0, 2];
const ROOT_JOINT: Record<string, string> = { robot: 'Body', fox: 'b_Hip_01' };
const VARIANT_PAIRS = new Set(['robot:WalkJump-vs-Walking']);
const FAMILY_PAIRS = new Set(['robot:Running-vs-Walking', 'fox:Run-vs-Walk']);

const pairKey = (rigId: string, a: string, b: string) => {
  const [first, second] = [a, b].sort();
  return `${rigId}:${first}-vs-${second}`;
};

export function buildCases(fixtures: RigMotionFixture[]): CopyDetectionCase[] {
  const cases: CopyDetectionCase[] = [];
  for (const fixture of fixtures) {
    const swap = buildMirrorNameSwapper(fixture.nodes);
    const root = ROOT_JOINT[fixture.rigId];
    if (!root) throw new Error(`no root joint configured for rig ${fixture.rigId}`);

    for (const clip of fixture.clips) {
      const positives: Array<[CaseClass, MotionCurves]> = [
        ['reupload', reupload(clip)],
        ['retime-fast', retimeUniform(clip, RETIME_FAST)],
        ['retime-slow', retimeUniform(clip, RETIME_SLOW)],
        ['hold', insertHold(clip, HOLD_AT, HOLD_LENGTH)],
        ['rescale', rescalePositions(clip, RESCALE)],
        ['relocate', relocateRoot(clip, root, RELOCATE)],
        ['mirror', mirrorClip(clip, swap)],
      ];
      for (const [caseClass, candidate] of positives) {
        cases.push({
          id: `${fixture.rigId}:${caseClass}:${clip.name}`,
          rigId: fixture.rigId,
          kind: 'positive',
          caseClass,
          sourceName: clip.name,
          candidateName: candidate.name,
          source: clip,
          candidate,
        });
      }
    }

    const sorted = [...fixture.clips].sort((left, right) => left.name.localeCompare(right.name));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const key = pairKey(fixture.rigId, sorted[i].name, sorted[j].name);
        const variant = VARIANT_PAIRS.has(key);
        cases.push({
          id: variant ? key.replace(':', ':variant:') : key.replace(':', ':neg:'),
          rigId: fixture.rigId,
          kind: variant ? 'variant' : 'negative',
          caseClass: variant ? 'variant' : FAMILY_PAIRS.has(key) ? 'family' : 'unrelated',
          sourceName: sorted[i].name,
          candidateName: sorted[j].name,
          source: sorted[i],
          candidate: sorted[j],
        });
      }
    }
  }
  return cases;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/motion/testset/copyDetectionCases.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + full suite, then commit**

```bash
cd frontend && npm run typecheck && npm test
git add src/motion/testset/copyDetectionCases.ts src/motion/testset/copyDetectionCases.test.ts
git commit -m "Motion test set: labeled positive/negative case builder"
```

---

### Task 5: Scorecard runner + current-engine adapter + formatter

**Files:**
- Create: `frontend/src/motion/testset/scorecard.ts`
- Test: `frontend/src/motion/testset/scorecard.test.ts`

**Interfaces:**
- Consumes: `CopyDetectionCase` (Task 4), `deserializeClip` (Task 1), `compareClips` from `../../components/MotionComparisonLab` (existing export, already imported the same way by `MotionComparisonLab.test.ts`).
- Produces:
  - `interface EngineOutcome { score: number | null; flagged: boolean; exact: boolean }`
  - `type EngineAdapter = (source: AnimationClip, candidate: AnimationClip) => EngineOutcome`
  - `interface ScorecardRow { id: string; rigId: string; kind: CaseKind; caseClass: CaseClass; score: number | null; flagged: boolean; exact: boolean }`
  - `interface ClassTally { total: number; hit: number; percent: number }` (`hit` = caught for positives, wrongly-flagged for negatives)
  - `interface Scorecard { rows: ScorecardRow[]; recall: { overall: ClassTally; byClass: Record<string, ClassTally> }; falsePositives: { overall: ClassTally; byClass: Record<string, ClassTally> }; variants: ScorecardRow[] }`
  - `runScorecard(cases: CopyDetectionCase[], adapter: EngineAdapter): Scorecard`
  - `currentEngineAdapter(): EngineAdapter`
  - `formatScorecard(scorecard: Scorecard, title: string): string`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/motion/testset/scorecard.test.ts
import { describe, expect, it } from 'vitest';
import type { MotionCurves } from '../motionCurves';
import type { CopyDetectionCase } from './copyDetectionCases';
import { currentEngineAdapter, formatScorecard, runScorecard } from './scorecard';

const clip = (name: string, y = 0): MotionCurves => ({
  formatVersion: 1,
  name,
  duration: 1,
  tracks: [{ name: 'Body.position', type: 'vector', times: [0, 1], values: [0, y, 0, 1, y, 0] }],
});

const makeCase = (id: string, kind: CopyDetectionCase['kind'], caseClass: CopyDetectionCase['caseClass'], candidateY: number): CopyDetectionCase => ({
  id, rigId: 'robot', kind, caseClass, sourceName: 'A', candidateName: 'B', source: clip('A'), candidate: clip('B', candidateY),
});

describe('scorecard metrics', () => {
  const cases = [
    makeCase('p1', 'positive', 'reupload', 0),   // identical → flagged by the fake adapter
    makeCase('p2', 'positive', 'mirror', 9),     // different → missed
    makeCase('n1', 'negative', 'unrelated', 9),  // different → correctly unflagged
    makeCase('n2', 'negative', 'family', 0),     // identical → wrongly flagged
    makeCase('v1', 'variant', 'variant', 0),     // must not touch recall or FPR
  ];
  const fakeAdapter = (source: import('three').AnimationClip, candidate: import('three').AnimationClip) => {
    const same = JSON.stringify(source.tracks[0].values) === JSON.stringify(candidate.tracks[0].values);
    return { score: same ? 100 : 10, flagged: same, exact: same };
  };
  const scorecard = runScorecard(cases, fakeAdapter);

  it('computes recall over positives only', () => {
    expect(scorecard.recall.overall).toEqual({ total: 2, hit: 1, percent: 50 });
    expect(scorecard.recall.byClass.reupload).toEqual({ total: 1, hit: 1, percent: 100 });
    expect(scorecard.recall.byClass.mirror).toEqual({ total: 1, hit: 0, percent: 0 });
  });

  it('computes false positives over negatives only, variant excluded', () => {
    expect(scorecard.falsePositives.overall).toEqual({ total: 2, hit: 1, percent: 50 });
    expect(scorecard.falsePositives.byClass.family).toEqual({ total: 1, hit: 1, percent: 100 });
    expect(scorecard.variants).toHaveLength(1);
  });

  it('formats a printable table naming every class', () => {
    const text = formatScorecard(scorecard, 'fake engine');
    for (const label of ['fake engine', 'reupload', 'mirror', 'unrelated', 'family', 'recall', 'false', 'variant']) {
      expect(text.toLowerCase()).toContain(label.toLowerCase());
    }
  });
});

describe('current engine adapter', () => {
  it('flags an exact copy and passes the app defaults through', () => {
    const adapter = currentEngineAdapter();
    const testCase = makeCase('x', 'positive', 'reupload', 0);
    const { deserializeClip } = await import('../motionCurves');
    const outcome = adapter(deserializeClip(testCase.source), deserializeClip(testCase.candidate));
    expect(outcome.exact).toBe(true);
    expect(outcome.flagged).toBe(true);
    expect(outcome.score).toBe(100);
  });
});
```

Note: make the second `describe`'s `it` callback `async` for the dynamic import, or hoist the import to the top of the file — hoisting is cleaner; the snippet shows intent.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/motion/testset/scorecard.test.ts`
Expected: FAIL — cannot resolve `./scorecard`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/motion/testset/scorecard.ts
/**
 * Engine-agnostic grading over the labeled case list. The adapter is the ONLY
 * engine-specific piece, so Phase 1's ported engine (and every later change)
 * gets graded by swapping the adapter — the cases and metrics never move.
 * The current-engine adapter mirrors the live registry path exactly:
 * compareClips with mode 'shape', jointScope 'full', 48 samples, threshold 85;
 * flagged = tone !== 'neutral' (review or blocked), same as the UI.
 */
import type { AnimationClip } from 'three';
import { compareClips } from '../../components/MotionComparisonLab';
import { deserializeClip } from '../motionCurves';
import type { CaseClass, CaseKind, CopyDetectionCase } from './copyDetectionCases';

export interface EngineOutcome { score: number | null; flagged: boolean; exact: boolean }
export type EngineAdapter = (source: AnimationClip, candidate: AnimationClip) => EngineOutcome;

export interface ScorecardRow {
  id: string; rigId: string; kind: CaseKind; caseClass: CaseClass;
  score: number | null; flagged: boolean; exact: boolean;
}

export interface ClassTally { total: number; hit: number; percent: number }

export interface Scorecard {
  rows: ScorecardRow[];
  recall: { overall: ClassTally; byClass: Record<string, ClassTally> };
  falsePositives: { overall: ClassTally; byClass: Record<string, ClassTally> };
  variants: ScorecardRow[];
}

const percent = (hit: number, total: number) => (total === 0 ? 0 : Math.round((1000 * hit) / total) / 10);

function tally(rows: ScorecardRow[]): { overall: ClassTally; byClass: Record<string, ClassTally> } {
  const byClass: Record<string, ClassTally> = {};
  let hit = 0;
  for (const row of rows) {
    const bucket = (byClass[row.caseClass] ??= { total: 0, hit: 0, percent: 0 });
    bucket.total += 1;
    if (row.flagged) { bucket.hit += 1; hit += 1; }
  }
  for (const bucket of Object.values(byClass)) bucket.percent = percent(bucket.hit, bucket.total);
  return { overall: { total: rows.length, hit, percent: percent(hit, rows.length) }, byClass };
}

export function runScorecard(cases: CopyDetectionCase[], adapter: EngineAdapter): Scorecard {
  const rows: ScorecardRow[] = cases.map((entry) => {
    const outcome = adapter(deserializeClip(entry.source), deserializeClip(entry.candidate));
    return { id: entry.id, rigId: entry.rigId, kind: entry.kind, caseClass: entry.caseClass, ...outcome };
  });
  return {
    rows,
    recall: tally(rows.filter((row) => row.kind === 'positive')),
    falsePositives: tally(rows.filter((row) => row.kind === 'negative')),
    variants: rows.filter((row) => row.kind === 'variant'),
  };
}

export function currentEngineAdapter(): EngineAdapter {
  return (source, candidate) => {
    const result = compareClips(source, candidate, { mode: 'shape', jointScope: 'full', sampleCount: 48, reviewThreshold: 85 });
    return { score: result.primaryValue, flagged: result.tone !== 'neutral', exact: result.exactCurveData };
  };
}

export function formatScorecard(scorecard: Scorecard, title: string): string {
  const lines: string[] = [];
  const row = (label: string, entry: ClassTally) =>
    `  ${label.padEnd(14)} ${String(entry.hit).padStart(3)}/${String(entry.total).padEnd(3)}  ${entry.percent.toFixed(1).padStart(5)}%`;
  lines.push(`Copy-detection scorecard — ${title}`);
  lines.push('POSITIVES (recall — higher is better)');
  for (const [name, entry] of Object.entries(scorecard.recall.byClass)) lines.push(row(name, entry));
  lines.push(row('ALL', scorecard.recall.overall));
  lines.push('NEGATIVES (false-positive rate — lower is better)');
  for (const [name, entry] of Object.entries(scorecard.falsePositives.byClass)) lines.push(row(name, entry));
  lines.push(row('ALL', scorecard.falsePositives.overall));
  lines.push('VARIANT pairs (reported, ungraded)');
  for (const variant of scorecard.variants) {
    lines.push(`  ${variant.id}: score ${variant.score ?? '—'} ${variant.flagged ? '(flagged)' : '(not flagged)'}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/motion/testset/scorecard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + full suite, then commit**

```bash
cd frontend && npm run typecheck && npm test
git add src/motion/testset/scorecard.ts src/motion/testset/scorecard.test.ts
git commit -m "Motion test set: engine-agnostic scorecard runner and current-engine adapter"
```

---

### Task 6: Baseline harness + README

**Files:**
- Create: `frontend/src/motion/testset/copyDetection.test.ts`
- Generate + commit: `frontend/src/motion/testset/scorecard.baseline.json`
- Create: `frontend/src/motion/testset/README.md`

**Interfaces:**
- Consumes: everything above.
- Baseline shape: `{ engine: string; flaggedByCase: Record<string, boolean>; recall: { hit: number; total: number }; falsePositives: { hit: number; total: number } }`. Booleans and integer counts only — scores are printed for humans but not asserted, so a sub-threshold score drift can never flake the suite; only a case crossing the flag threshold moves the baseline, and that must be deliberate.

- [ ] **Step 1: Write the harness (it doubles as the failing test — the baseline file doesn't exist yet)**

```ts
// frontend/src/motion/testset/copyDetection.test.ts
/**
 * THE Phase 0 gate. Runs the current engine over the labeled copy-detection set,
 * prints the scorecard, and pins per-case flag outcomes to a committed baseline.
 * Any engine change that moves a case across the flag threshold fails here until
 * the baseline is intentionally regenerated and the before/after is reported:
 *   UPDATE_MOTION_BASELINE=1 npm test   (then commit the diff)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildCases } from './copyDetectionCases';
import { loadRigFixture } from './fixtureLoader';
import { currentEngineAdapter, formatScorecard, runScorecard } from './scorecard';

const ENGINE_TITLE = 'current TS engine (shape / full / 48 samples / threshold 85)';
const baselinePath = fileURLToPath(new URL('./scorecard.baseline.json', import.meta.url));

describe('copy-detection scorecard', () => {
  const cases = buildCases([loadRigFixture('robot'), loadRigFixture('fox')]);
  const scorecard = runScorecard(cases, currentEngineAdapter());
  console.log(`\n${formatScorecard(scorecard, ENGINE_TITLE)}\n`);

  it('covers the full labeled set', () => {
    expect(scorecard.recall.overall.total).toBe(119);
    expect(scorecard.falsePositives.overall.total).toBe(93);
    expect(scorecard.variants).toHaveLength(1);
    for (const row of scorecard.rows) {
      expect(row.score === null || Number.isFinite(row.score), `${row.id} produced no score`).toBe(true);
    }
  });

  it('always catches exact re-uploads (anchor: if this fails, fixtures or engine are broken)', () => {
    expect(scorecard.recall.byClass.reupload).toMatchObject({ total: 17, hit: 17 });
    for (const row of scorecard.rows.filter((entry) => entry.caseClass === 'reupload')) {
      expect(row.exact, `${row.id} lost exact-match`).toBe(true);
    }
  });

  it('matches the committed baseline (UPDATE_MOTION_BASELINE=1 npm test to regenerate deliberately)', () => {
    const snapshot = {
      engine: ENGINE_TITLE,
      flaggedByCase: Object.fromEntries(scorecard.rows.map((row) => [row.id, row.flagged])),
      recall: { hit: scorecard.recall.overall.hit, total: scorecard.recall.overall.total },
      falsePositives: { hit: scorecard.falsePositives.overall.hit, total: scorecard.falsePositives.overall.total },
    };
    if (process.env.UPDATE_MOTION_BASELINE) {
      writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    }
    expect(existsSync(baselinePath), 'baseline missing — run UPDATE_MOTION_BASELINE=1 npm test once and commit it').toBe(true);
    expect(snapshot).toEqual(JSON.parse(readFileSync(baselinePath, 'utf8')));
  });
});
```

- [ ] **Step 2: Run to verify it fails for the right reason**

Run: `cd frontend && npx vitest run src/motion/testset/copyDetection.test.ts`
Expected: the scorecard PRINTS, the first two tests PASS, the baseline test FAILS with "baseline missing".
If the reupload anchor fails instead: STOP — the fixtures or serializer are broken; do not generate a baseline.

- [ ] **Step 3: Generate the baseline (PowerShell sets the env var differently)**

```powershell
cd C:\Users\isdis\git\creatorflow\frontend
$env:UPDATE_MOTION_BASELINE = '1'; npx vitest run src/motion/testset/copyDetection.test.ts; Remove-Item Env:UPDATE_MOTION_BASELINE
```

Expected: PASS (3 tests), `scorecard.baseline.json` created.

- [ ] **Step 4: Run the FULL suite to verify green end-to-end**

Run: `cd frontend && npm test`
Expected: all suites pass (33 existing tests + ~30 new); the scorecard table prints in the output.

- [ ] **Step 5: Write the README**

```markdown
<!-- frontend/src/motion/testset/README.md -->
# Motion copy-detection test set

The safety net for every motion-engine change (handoff Phase 0). `npm test` runs
`copyDetection.test.ts`, which grades the engine over ~213 labeled cases and prints a
recall / false-positive scorecard. Per-case flag outcomes are pinned in
`scorecard.baseline.json` — an engine change that moves any case across the flag
threshold fails CI until the baseline is regenerated on purpose:

    UPDATE_MOTION_BASELINE=1 npm test    # then commit the diff and report before/after

## Labels

- **Positives** (should match): programmatic derivations of each clip — `reupload`
  (identical), `retime-fast`/`retime-slow` (uniform speed change), `hold` (inserted
  pause), `rescale` (positions ×1.25), `relocate` (root offset), `mirror` (left/right
  joint swap + reflected curves).
- **Negatives** (should NOT match): distinct clips on the same rig. `family` = same
  gait family (Walking↔Running, Walk↔Run) — different works; flagging them is a false
  accusation. Never cross-rig: different skeletons share no joints, so those pairs
  prove nothing.
- **Variant** (reported, ungraded): Walking↔WalkJump — WalkJump is built from Walking,
  so neither label is honest.

## Honesty caveats

- Mirrored fixtures swap left/right joints and reflect curves across the YZ plane.
  That is a faithful mirror only insofar as the rigs are left/right symmetric (both
  are, near enough). Expect ~0% mirror recall until Phase 3's mirror canonicalization.
- A scorecard number is a measurement, not a verdict. Precision (not flagging the
  innocent) outranks recall — a change that raises recall by raising the family/unrelated
  false-positive rate is a regression.

## Regenerating fixtures

    npm run fixtures:motion   # re-extracts from public/assets/*.glb via three's GLTFLoader

Fixtures are committed; regenerate only when the GLBs or three's loader change, and
expect the baseline to need a rerun afterwards.
```

- [ ] **Step 6: Commit**

```bash
git add src/motion/testset/copyDetection.test.ts src/motion/testset/scorecard.baseline.json src/motion/testset/README.md
git commit -m "Motion test set: scorecard harness with pinned baseline"
```

---

### Task 7: Phase-boundary report to Bryan

Not a code task. Assemble from the Task 6 output:

- [ ] **Step 1:** Capture the printed scorecard table (recall by class, FPR by class, variant row) from `npm test`.
- [ ] **Step 2:** Note expected shape of results — reupload 100% by construction; retime classes likely high (the engine's phase-normalized sampling absorbs uniform speed changes); rescale likely high on the CURRENT engine (its `vectorSimilarity` self-normalizes by magnitude — this will CHANGE when the Java kernel's absolute `exp(-2.25·d)` lands in Phase 1a, which is exactly what the scorecard is for); mirror near 0% (expected until Phase 3); fox negatives likely flagged (the in-app `fox-idle-run` scenario already documents this precision weakness). Whatever the real numbers are, report them as measured — no smoothing.
- [ ] **Step 3:** Report scorecard + commit list to Bryan and STOP. Phase 1a needs his go-ahead (handoff working agreement: never roll silently into the next phase).

---

## Self-review (per writing-plans skill)

- **Spec coverage:** derivations re-timed (speed up ✓ slow down ✓ holds ✓), mirrored ✓, rescaled ✓, relocated ✓, re-uploaded ✓; within-rig negatives ✓; never robot-vs-fox ✓ (asserted in Task 4 test); vitest harness printing recall + FPR at current threshold ✓ (Task 6); fixtures committed ✓ (Tasks 2, 6); TDD throughout ✓; phase-boundary stop ✓ (Task 7).
- **Placeholder scan:** no TBDs; every step carries runnable code or an exact command.
- **Type consistency:** `MotionCurves`/`MotionCurveTrack` (Task 1) consumed by Tasks 2–5; `CopyDetectionCase`/`CaseKind`/`CaseClass` (Task 4) consumed by Task 5; `Scorecard`/`ClassTally` (Task 5) consumed by Task 6; `compareClips` import path matches the existing `MotionComparisonLab.test.ts` idiom.
- **Known judgment calls (flag to Bryan, defaults chosen):** (1) family pairs count as true negatives in FPR; (2) Walking↔WalkJump excluded as 'variant'; (3) baseline pins booleans not scores; (4) derivation parameters (×0.8/×1.25 retime, 30% hold, ×1.25 rescale, [3,0,2] relocate) are fixed constants — defensible, editable in one place.
- **Adversarial review (2026-07-15, 3 finder + 4 verifier agents):** one confirmed fix applied (Task 3 test count). Empirically validated against the real GLBs by the reviewers: the mirror swap map pairs ALL side joints on both rigs (42 robot, 14 fox, zero fallthroughs, involution holds); Jump↔WalkJump measured genuinely unrelated at curve level (mean per-track diff 0.0568 ≈ the canonical unrelated pair 0.0571), so its 'unrelated' label stands; even Walking↔WalkJump shares zero exact joint-track keyframe runs — its 'variant' status is provenance-based, not curve reuse. The real-rig involution test in Task 4 was added from a reviewer suggestion.
