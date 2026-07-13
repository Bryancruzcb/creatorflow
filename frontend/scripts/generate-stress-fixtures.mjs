import { deflateSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve('public/stress-fixtures');

function ensure(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  ensure(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function makePng(width, height, rgb = [90, 116, 137]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  row[0] = 0;
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = (rgb[0] + (x % 29)) & 255;
    row[2 + x * 3] = (rgb[1] + (x % 17)) & 255;
    row[3 + x * 3] = (rgb[2] + (x % 11)) & 255;
  }
  const raw = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(raw, y * row.length);
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

function writeWav(path, seconds = 30, channels = 6, sampleRate = 96_000, bits = 24) {
  ensure(dirname(path));
  const bytesPerSample = bits / 8;
  const dataBytes = seconds * channels * sampleRate * bytesPerSample;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataBytes, 40);
  const file = openSync(path, 'w');
  writeSync(file, header);
  const chunk = Buffer.alloc(1024 * 1024);
  let remaining = dataBytes;
  while (remaining > 0) {
    const length = Math.min(chunk.length, remaining);
    writeSync(file, chunk, 0, length);
    remaining -= length;
  }
  closeSync(file);
}

function writePsd(path, width = 8192, height = 8192) {
  ensure(dirname(path));
  const header = Buffer.alloc(26);
  header.write('8BPS', 0);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(3, 12);
  header.writeUInt32BE(height, 14);
  header.writeUInt32BE(width, 18);
  header.writeUInt16BE(8, 22);
  header.writeUInt16BE(3, 24);
  const file = openSync(path, 'w');
  writeSync(file, header);
  writeSync(file, Buffer.alloc(12));
  const compression = Buffer.alloc(2);
  compression.writeUInt16BE(1);
  writeSync(file, compression);
  const runsPerRow = Math.ceil(width / 128);
  const rowLength = runsPerRow * 2;
  const lengths = Buffer.alloc(height * 3 * 2);
  for (let row = 0; row < height * 3; row += 1) lengths.writeUInt16BE(rowLength, row * 2);
  writeSync(file, lengths);
  for (const value of [82, 108, 131]) {
    const encodedRow = Buffer.alloc(rowLength);
    for (let run = 0; run < runsPerRow; run += 1) {
      const length = Math.min(128, width - run * 128);
      encodedRow[run * 2] = 257 - length;
      encodedRow[run * 2 + 1] = value;
    }
    for (let row = 0; row < height; row += 1) writeSync(file, encodedRow);
  }
  closeSync(file);
}

function writeFbx(path, side = 800) {
  ensure(dirname(path));
  const file = openSync(path, 'w');
  const write = (value) => writeSync(file, value);
  const vertices = side * side;
  const polygons = (side - 1) * (side - 1);
  write('; FBX 7.4.0 project file\nFBXHeaderExtension:  { FBXHeaderVersion: 1003 FBXVersion: 7400 Creator: "CreatorFlow deterministic stress fixture" }\n');
  write(`Objects:  {\n Geometry: 1, "Geometry::StressGrid", "Mesh" {\n  Vertices: *${vertices * 3} {\n   a: `);
  let first = true;
  for (let y = 0; y < side; y += 1) {
    let row = '';
    for (let x = 0; x < side; x += 1) {
      const height = ((x * 17 + y * 31) % 23) / 10;
      row += `${first ? '' : ','}${x},${height},${y}`;
      first = false;
    }
    write(row);
  }
  write(`\n  }\n  PolygonVertexIndex: *${polygons * 4} {\n   a: `);
  first = true;
  for (let y = 0; y < side - 1; y += 1) {
    let row = '';
    for (let x = 0; x < side - 1; x += 1) {
      const a = y * side + x;
      const b = a + 1;
      const c = a + side + 1;
      const d = a + side;
      row += `${first ? '' : ','}${a},${b},${c},${-(d + 1)}`;
      first = false;
    }
    write(row);
  }
  write('\n  }\n }\n Model: 2, "Model::StressGrid", "Mesh" { Version: 232 }\n}\nConnections:  { C: "OO",1,2 C: "OO",2,0 }\n');
  closeSync(file);
}

const broken = join(root, 'broken');
writeJson(join(broken, 'missing-texture/scene.gltf'), {
  asset: { version: '2.0', generator: 'CreatorFlow stress fixture' },
  scenes: [{ nodes: [] }], scene: 0,
  images: [{ uri: 'textures/albedo-missing.png' }],
  textures: [{ source: 0 }], materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
});
writeFileSync(join(broken, 'corrupt.glb'), Buffer.from('NOT_A_GLTF_BINARY\ntruncated-header\n'));
writeJson(join(broken, 'unsupported-extension.gltf'), {
  asset: { version: '2.0' }, extensionsUsed: ['VENDOR_required_feature'], extensionsRequired: ['VENDOR_required_feature'], scenes: [{ nodes: [] }], scene: 0,
});
writeJson(join(broken, 'invalid-material.gltf'), {
  asset: { version: '2.0' }, buffers: [{ byteLength: 4, uri: 'data:application/octet-stream;base64,AAAAAA==' }],
  bufferViews: [{ buffer: 0, byteLength: 4 }], accessors: [], meshes: [{ primitives: [{ attributes: {}, material: 99 }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
});
writeJson(join(broken, 'outside-folder.gltf'), {
  asset: { version: '2.0' }, buffers: [{ byteLength: 128, uri: '../outside-project.bin' }], scenes: [{ nodes: [] }], scene: 0,
});
writeJson(join(broken, 'embedded-megabyte.gltf'), {
  asset: { version: '2.0' }, buffers: [{ byteLength: 786_432, uri: `data:application/octet-stream;base64,${Buffer.alloc(786_432, 71).toString('base64')}` }], scenes: [{ nodes: [] }], scene: 0,
});

const multi = join(root, 'multi-file-package');
ensure(join(multi, 'buffers'));
ensure(join(multi, 'textures/environment'));
ensure(join(multi, 'textures/props'));
writeFileSync(join(multi, 'buffers/geometry.bin'), Buffer.alloc(256 * 1024, 31));
writeFileSync(join(multi, 'buffers/animation.bin'), Buffer.alloc(96 * 1024, 17));
const tinyPng = makePng(32, 32);
const images = [];
for (let index = 0; index < 24; index += 1) {
  const group = index < 12 ? 'environment' : 'props';
  const uri = `textures/${group}/texture_${String(index + 1).padStart(2, '0')}.png`;
  writeFileSync(join(multi, uri), tinyPng);
  images.push({ uri });
}
writeJson(join(multi, 'world.gltf'), {
  asset: { version: '2.0', generator: 'CreatorFlow dependency stress fixture' },
  buffers: [{ uri: 'buffers/geometry.bin', byteLength: 262_144 }, { uri: 'buffers/animation.bin', byteLength: 98_304 }],
  images, textures: images.map((_, source) => ({ source })), scenes: [{ nodes: [] }], scene: 0,
});

const non3d = join(root, 'non3d');
ensure(non3d);
writeFileSync(join(non3d, 'terrain_8k.png'), makePng(8192, 8192));
writePsd(join(non3d, 'environment_master_8k.psd'));
writeWav(join(non3d, 'ambisonic_6ch_96khz_24bit.wav'));
writeFbx(join(non3d, 'dense_environment_grid.fbx'));
const proResPath = join(non3d, 'prores_4k_2s.mov');
const ffmpeg = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=24', '-t', '2', '-c:v', 'prores_ks', '-profile:v', '0', '-pix_fmt', 'yuv422p10le', proResPath], { stdio: 'inherit' });
if (ffmpeg.error) console.warn('ffmpeg unavailable; the executable ProRes fixture was not generated.');

const fontSource = resolve('node_modules/@fontsource/ibm-plex-sans/files');
const fontTarget = join(non3d, 'font-family');
ensure(fontTarget);
for (const file of ['ibm-plex-sans-latin-100-normal.woff2', 'ibm-plex-sans-latin-300-normal.woff2', 'ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-latin-500-normal.woff2', 'ibm-plex-sans-latin-600-normal.woff2', 'ibm-plex-sans-latin-700-normal.woff2']) {
  const source = join(fontSource, file);
  if (existsSync(source)) copyFileSync(source, join(fontTarget, file));
}

writeJson(join(root, 'capacity-profiles.json'), {
  generatedFixtures: [
    { id: 'texture-8k', path: 'non3d/terrain_8k.png', format: 'PNG', dimensions: '8192 × 8192', decodedBytes: 268_435_456, mode: 'executable' },
    { id: 'texture-8k-psd', path: 'non3d/environment_master_8k.psd', format: 'PSD', dimensions: '8192 × 8192', channels: 3, mode: 'executable' },
    { id: 'surround-wav', path: 'non3d/ambisonic_6ch_96khz_24bit.wav', format: 'WAV', channels: 6, sampleRate: 96_000, bits: 24, duration: 30, mode: 'executable' },
    { id: 'prores-smoke', path: 'non3d/prores_4k_2s.mov', format: 'ProRes 422 Proxy', dimensions: '3840 × 2160', duration: 2, mode: ffmpeg.status === 0 ? 'executable' : 'unavailable' },
    { id: 'fbx-grid', path: 'non3d/dense_environment_grid.fbx', format: 'FBX 7.4 ASCII', vertices: 640_000, polygons: 638_401, mode: 'executable' },
    { id: 'font-family', path: 'non3d/font-family/', format: 'WOFF2', files: 6, mode: 'executable' },
  ],
  capacityOnly: [
    { id: 'psd-8k', name: 'environment_master_8k.psd', format: 'PSD', bytes: 1_482_000_000, layers: 187, note: 'Profile only · source file intentionally not bundled' },
    { id: 'prores-4k', name: 'launch_master_4k_prores.mov', format: 'ProRes 422 HQ', bytes: 3_840_000_000, duration: 128, note: 'Profile only · source file intentionally not bundled' },
    { id: 'font-production', name: 'Northwind variable family', format: 'OTF / WOFF2', bytes: 18_600_000, files: 42, note: 'Profile only · executable six-weight subset included' },
    { id: 'blender-source', name: 'northwind_world_master.blend', format: 'BLEND', bytes: 2_740_000_000, linkedFiles: 316, note: 'Profile only · source file intentionally not bundled' },
    { id: 'fbx-source', name: 'hero_full_rig_source.fbx', format: 'FBX', bytes: 884_000_000, linkedFiles: 94, note: 'Profile only · source file intentionally not bundled' },
  ],
});

console.log(`Generated stress fixtures in ${root}`);
