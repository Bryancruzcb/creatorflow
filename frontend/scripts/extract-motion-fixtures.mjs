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
