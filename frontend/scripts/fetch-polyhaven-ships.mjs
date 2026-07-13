import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const assets = ['dutch_ship_large_01', 'dutch_ship_large_02'];
const workRoot = resolve('work/polyhaven-ships');
const outputRoot = resolve('public/assets');
const cli = resolve('node_modules/.bin/gltf-transform');

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
  const packageRecord = metadata.gltf?.['4k']?.gltf;
  if (!packageRecord) throw new Error(`No 4K glTF package found for ${id}`);
  const packageRoot = resolve(workRoot, id);
  const inputPath = resolve(packageRoot, `${id}_4k.gltf`);
  await download(packageRecord.url, inputPath);
  for (const [relativePath, record] of Object.entries(packageRecord.include)) {
    await download(record.url, resolve(packageRoot, relativePath));
  }
  const outputPath = resolve(outputRoot, `${id.replaceAll('_', '-')}.glb`);
  const result = spawnSync(cli, ['copy', inputPath, outputPath], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`glTF Transform failed for ${id}`);
  await download(`https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=1200&height=800`, resolve(outputRoot, `${id.replaceAll('_', '-')}.png`));
}

rmSync(workRoot, { recursive: true, force: true });
console.log('Poly Haven ship GLBs packaged successfully.');
