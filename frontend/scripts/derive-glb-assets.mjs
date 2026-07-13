import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assets = [
  {
    source: 'avocado-source.glb',
    output: 'avocado-project-derivative.glb',
    importRecord: 'avocado_foodstudy_v02',
    sceneName: 'Northwind Props / Food Study',
    materialPatch: { baseColorFactor: [1, 0.32, 0.18, 1] },
  },
  {
    source: 'boombox-source.glb',
    output: 'boombox-project-derivative.glb',
    importRecord: 'radio_safehouse_v04',
    sceneName: 'Northwind Props / Safehouse Radio',
    materialPatch: { baseColorFactor: [0.35, 0.65, 1, 1], emissiveFactor: [0.25, 0.55, 1] },
  },
  {
    source: 'barramundi-source.glb',
    output: 'barramundi-project-derivative.glb',
    importRecord: 'barramundi_market_v03',
    sceneName: 'Northwind Creatures / Harbor Market',
    materialPatch: { baseColorFactor: [0.2, 0.55, 1, 1], roughnessFactor: 0.18 },
  },
  {
    source: 'waterbottle-source.glb',
    output: 'waterbottle-project-derivative.glb',
    importRecord: 'water_bottle_camp_v02',
    sceneName: 'Northwind Props / Trail Camp',
    materialPatch: { baseColorFactor: [0.12, 0.45, 1, 1] },
  },
  {
    source: 'lantern-source.glb',
    output: 'lantern-project-derivative.glb',
    importRecord: 'lantern_dock_v03',
    sceneName: 'Northwind Props / Night Dock',
    materialPatch: { baseColorFactor: [0.12, 0.45, 1, 1], roughnessFactor: 0.12 },
  },
];

for (const asset of assets) {
  const sourcePath = fileURLToPath(new URL(`../public/assets/${asset.source}`, import.meta.url));
  const outputPath = fileURLToPath(new URL(`../public/assets/${asset.output}`, import.meta.url));
  const source = await readFile(sourcePath);

  if (source.toString('ascii', 0, 4) !== 'glTF' || source.readUInt32LE(4) !== 2) {
    throw new Error(`${asset.source} is not a glTF 2.0 binary file.`);
  }

  const jsonLength = source.readUInt32LE(12);
  const jsonType = source.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error(`${asset.source} has no leading JSON chunk.`);

  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLength;
  const gltf = JSON.parse(source.toString('utf8', jsonStart, jsonEnd).trim());

  gltf.asset.extras = {
    ...(gltf.asset.extras ?? {}),
    creatorFlowProject: 'Northwind',
    creatorFlowImportRecord: asset.importRecord,
  };
  if (gltf.scenes?.[gltf.scene ?? 0]) gltf.scenes[gltf.scene ?? 0].name = asset.sceneName;
  const material = gltf.materials?.[0];
  if (material && asset.materialPatch) {
    material.pbrMetallicRoughness ??= {};
    if (asset.materialPatch.baseColorFactor) material.pbrMetallicRoughness.baseColorFactor = asset.materialPatch.baseColorFactor;
    if (asset.materialPatch.roughnessFactor !== undefined) material.pbrMetallicRoughness.roughnessFactor = asset.materialPatch.roughnessFactor;
    if (asset.materialPatch.emissiveFactor) material.emissiveFactor = asset.materialPatch.emissiveFactor;
  }

  const jsonText = JSON.stringify(gltf);
  const padding = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
  const jsonChunk = Buffer.from(`${jsonText}${' '.repeat(padding)}`, 'utf8');
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);

  const header = Buffer.from(source.subarray(0, 12));
  const remainingChunks = source.subarray(jsonEnd);
  const output = Buffer.concat([header, chunkHeader, jsonChunk, remainingChunks]);
  output.writeUInt32LE(output.length, 8);

  await writeFile(outputPath, output);
}
