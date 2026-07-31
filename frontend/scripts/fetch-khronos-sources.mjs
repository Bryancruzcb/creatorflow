/**
 * Downloads the five Khronos CC0 source GLBs the comparison workbench loads.
 *
 * These files are gitignored (they are ~50 MB together), so a fresh clone — and every
 * GitHub Pages build — starts without them, and the workbench falls back to a still image
 * instead of the real 3D comparison. This script is what puts them back.
 *
 * Usage: npm run assets:khronos
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Pinned to a commit, not to `main`. The digests below are the ones
 * public/assets/ASSET-PROVENANCE.md publishes as this project's evidence chain, and a moving
 * ref would let the bytes under those digests change upstream.
 */
const REF = '2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf';

const sources = [
  { model: 'Avocado', file: 'Avocado.glb', output: 'avocado-source.glb', sha256: 'ccc9c3ce56423720b09399c2351537207cd5a65f859f9e6e2f30922762f3abd4' },
  { model: 'BoomBox', file: 'BoomBox.glb', output: 'boombox-source.glb', sha256: 'f8b918445ebdd006768232205a62f5182d2208ca57f84c6ccc084943c0bc8f15' },
  { model: 'BarramundiFish', file: 'BarramundiFish.glb', output: 'barramundi-source.glb', sha256: 'ecc3bafb6b00f2c8b810863c388e3768a7b7ea0d0335e8cb8c574c266e571f4a' },
  { model: 'WaterBottle', file: 'WaterBottle.glb', output: 'waterbottle-source.glb', sha256: 'b337e526fd6a162013c2984aeec163f5fbb4f717252724dfc3f3458bd51df94b' },
  { model: 'Lantern', file: 'Lantern.glb', output: 'lantern-source.glb', sha256: 'a79458c4b02d695187a952f23a63b8bf278e7bc3d316a3c2a314f2d6974181f1' },
];

const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function localDigest(path) {
  try {
    return digest(await readFile(path));
  } catch {
    return null;
  }
}

for (const source of sources) {
  const path = fileURLToPath(new URL(`../public/assets/${source.output}`, import.meta.url));

  if (await localDigest(path) === source.sha256) {
    console.log(`${source.output}: already present and matching`);
    continue;
  }

  const url = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${REF}/Models/${source.model}/glTF-Binary/${source.file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} while downloading ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());

  // Checked before the write, so a mismatch leaves no file behind for the next step to build on.
  const actual = digest(buffer);
  if (actual !== source.sha256) {
    throw new Error(`${source.output}: expected sha256 ${source.sha256}, upstream served ${actual}`);
  }

  await writeFile(path, buffer);
  console.log(`${source.output}: ${(buffer.length / 1048576).toFixed(1)} MB, sha256 verified`);
}

console.log('Khronos source GLBs present. Run `npm run assets:derive` to build the project derivatives.');
