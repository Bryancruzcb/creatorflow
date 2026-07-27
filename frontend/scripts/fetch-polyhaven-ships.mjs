import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const assets = ['dutch_ship_large_01', 'dutch_ship_large_02'];

/**
 * Resolution and compression.
 *
 * This script used to pull the 4K package and run a bare `copy`, which produced ~102 MB per
 * ship — far past anything that can be committed or served, which is why both models ended up
 * gitignored and the workspace advertised assets it could never load.
 *
 * 2K is the largest tier that survives compression at a shippable size, and at the sizes these
 * models are actually displayed the difference is not visible. Draco compresses the geometry
 * and WebP the ten textures, which is where nearly all the weight is.
 *
 * Source sizes for reference (Poly Haven API, both ships): 4K 203.4 MB, 2K 55.8 MB, 1K 19.7 MB.
 */
const RESOLUTION = process.env.SHIP_RESOLUTION ?? '2k';
const workRoot = resolve('work/polyhaven-ships');
const outputRoot = resolve('public/assets');
const isWindows = process.platform === 'win32';
const cli = resolve(`node_modules/.bin/gltf-transform${isWindows ? '.cmd' : ''}`);

/**
 * Run the glTF Transform CLI.
 *
 * On Windows the .bin entry is a shell script spawnSync cannot execute, so the .cmd wrapper is
 * used instead — and since the CVE-2024-27980 fix (Node 18.20+/20.12+) spawning a .cmd requires
 * shell: true. Without both of these the script fails on Windows with a bare non-zero status and
 * no message, which is what it did.
 */
function runCli(args) {
  return spawnSync(isWindows ? `"${cli}"` : cli, args.map((a) => (isWindows ? `"${a}"` : a)), {
    stdio: 'inherit',
    shell: isWindows,
  });
}

async function download(url, path) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} while downloading ${url}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
}

rmSync(workRoot, { recursive: true, force: true });
mkdirSync(workRoot, { recursive: true });

for (const id of assets) {
  const response = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!response.ok) throw new Error(`Could not read Poly Haven metadata for ${id}`);
  const metadata = await response.json();
  const packageRecord = metadata.gltf?.[RESOLUTION]?.gltf;
  if (!packageRecord) throw new Error(`No ${RESOLUTION} glTF package found for ${id}`);
  const packageRoot = resolve(workRoot, id);
  const inputPath = resolve(packageRoot, `${id}_${RESOLUTION}.gltf`);
  await download(packageRecord.url, inputPath);
  for (const [relativePath, record] of Object.entries(packageRecord.include)) {
    await download(record.url, resolve(packageRoot, relativePath));
  }
  const outputPath = resolve(outputRoot, `${id.replaceAll('_', '-')}.glb`);
  const rawPath = resolve(packageRoot, `${id}-raw.glb`);

  const packed = runCli(['copy', inputPath, rawPath]);
  if (packed.status !== 0) throw new Error(`glTF Transform failed for ${id}`);

  // Draco for geometry, WebP for the ten textures. Without this the output is unshippable and
  // the model has to be gitignored, which is how these two ended up advertised-but-absent.
  const optimized = runCli(['optimize', rawPath, outputPath, '--compress', 'draco', '--texture-compress', 'webp']);
  if (optimized.status !== 0) throw new Error(`glTF Transform optimize failed for ${id}`);

  const before = statSync(rawPath).size;
  const after = statSync(outputPath).size;
  console.log(
    `${id}: ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB `
    + `(${(100 - (after / before) * 100).toFixed(0)}% smaller)`,
  );
  await download(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=1200&height=800`, resolve(outputRoot, `${id.replaceAll('_', '-')}.png`));
}

rmSync(workRoot, { recursive: true, force: true });
console.log('Poly Haven ship GLBs packaged successfully.');
