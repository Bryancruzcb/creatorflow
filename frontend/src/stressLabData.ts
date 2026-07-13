export interface MotionFixture {
  id: string;
  name: string;
  subtitle: string;
  url: string;
  previewUrl: string;
  sourceUrl: string;
  license: string;
  payload: string;
  expected: string;
}

export const motionFixtures: MotionFixture[] = [
  {
    id: 'fox-rig',
    name: 'Fox — rig and clip switching',
    subtitle: 'One skeleton · Survey, Walk, and Run clips',
    url: '/assets/fox-animated.glb',
    previewUrl: '/assets/fox-animated.jpg',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox',
    license: 'CC0 model · CC BY 4.0 rig, animation, and conversion',
    payload: '162.9 KB',
    expected: 'Three clips must switch cleanly without blending or duplicate playback.',
  },
  {
    id: 'morph-stress',
    name: 'Morph Stress Test — eight targets',
    subtitle: '18 requested vertex attributes · Individuals, TheWave, and Pulse',
    url: '/assets/morph-stress-test.glb',
    previewUrl: '/assets/morph-stress-test.png',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MorphStressTest',
    license: 'CC BY 4.0 · Analytical Graphics / Ed Mackey',
    payload: '575.9 KB',
    expected: 'All eight targets should animate; frozen blocks expose runtime limits.',
  },
];

export const failureFixtures = [
  { id: 'missing-texture', name: 'Missing texture', path: 'missing-texture/scene.gltf', issue: 'Unresolved textures/albedo-missing.png', expectedAction: 'Keep project structure inspectable and flag the missing dependency.', successCopy: 'Missing dependency identified' },
  { id: 'corrupt-glb', name: 'Corrupt GLB', path: 'corrupt.glb', issue: 'Invalid binary magic and truncated header', expectedAction: 'Reject the file before an interactive preview is opened.', successCopy: 'Invalid GLB header identified' },
  { id: 'unsupported-extension', name: 'Unsupported extension', path: 'unsupported-extension.gltf', issue: 'Required VENDOR extension is unavailable', expectedAction: 'Gate the preview while preserving readable file metadata.', successCopy: 'Required extension identified' },
  { id: 'invalid-material', name: 'Invalid material reference', path: 'invalid-material.gltf', issue: 'Primitive points to material index 99', expectedAction: 'Isolate the invalid reference instead of failing the workspace.', successCopy: 'Invalid material index identified' },
  { id: 'embedded-payload', name: 'Oversized embedded data', path: 'embedded-megabyte.gltf', issue: '786 KB payload embedded as a data URI', expectedAction: 'Defer decoding and surface the embedded-payload warning.', successCopy: 'Embedded payload threshold identified' },
  { id: 'outside-folder', name: 'Outside-folder dependency', path: 'outside-folder.gltf', issue: 'Buffer escapes the selected project root', expectedAction: 'Refuse only the escaped dependency and preserve the root record.', successCopy: 'Escaped relative path identified' },
] as const;

export const executableFormats = [
  { name: 'terrain_8k.png', format: 'PNG', payload: '1.4 MB', decoded: '256 MB RGBA', detail: 'Real 8192 × 8192 image; header and decoded-memory pressure are inspected.' },
  { name: 'environment_master_8k.psd', format: 'PSD', payload: 'Generated locally', decoded: '8192 × 8192 RGB', detail: 'Real RLE-compressed Photoshop document with three full-resolution channels.' },
  { name: 'ambisonic_6ch_96khz_24bit.wav', format: 'WAV', payload: '51.8 MB', decoded: '6 channels', detail: 'Real 30-second, 96 kHz, 24-bit PCM fixture.' },
  { name: 'prores_4k_2s.mov', format: 'ProRes', payload: 'Generated locally', decoded: '3840 × 2160', detail: 'Real two-second 4K ProRes 422 Proxy smoke fixture generated with FFmpeg.' },
  { name: 'IBM Plex production subset', format: 'WOFF2 × 6', payload: '≈145 KB', decoded: '6 weights', detail: 'Real font files tested as a related family rather than six unrelated assets.' },
  { name: 'dense_environment_grid.fbx', format: 'FBX', payload: 'Generated locally', decoded: '640k vertices', detail: 'Real FBX 7.4 ASCII source fixture with 638,401 procedural polygons.' },
];

export const capacityProfiles = [
  { name: 'environment_master_8k.psd', format: 'PSD', payload: '1.48 GB', detail: '187-layer production profile · real 8K fixture included' },
  { name: 'launch_master_4k_prores.mov', format: 'ProRes 422 HQ', payload: '3.84 GB', detail: '4K · 128-second master profile' },
  { name: 'Northwind variable family', format: 'OTF / WOFF2', payload: '18.6 MB', detail: '42-file multilingual family profile' },
  { name: 'northwind_world_master.blend', format: 'BLEND', payload: '2.74 GB', detail: '316 linked-file world source profile' },
  { name: 'hero_full_rig_source.fbx', format: 'FBX', payload: '884 MB', detail: '94-link production profile · real 24 MB fixture included' },
];
