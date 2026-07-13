export type HeavyComponentMatchKind = 'exact-instance' | 'geometry' | 'appearance';

export interface HeavyComponentSide {
  assetId: string;
  label: string;
  nodeNames: string[];
}

export interface HeavyComponentDifference {
  label: string;
  project: string;
  source: string;
}

export interface HeavyComponentMatch {
  id: string;
  project: HeavyComponentSide;
  source: HeavyComponentSide;
  similarity: number;
  kind: HeavyComponentMatchKind;
  method: string;
  relationship: string;
  differences: HeavyComponentDifference[];
}

export interface HeavyAssetRecord {
  id: string;
  name: string;
  projectPath: string;
  modelUrl: string;
  previewUrl: string;
  sourceUrl: string;
  licenseUrl: string;
  license: string;
  attribution: string;
  bytes: number;
  size: string;
  hash: string;
  nodes: number;
  meshes: number;
  primitives: number;
  materials: number;
  textures: number;
  images: number;
  extensions: string[];
  description: string;
  robloxWorkflow?: {
    label: string;
    note: string;
  };
  componentMatches?: HeavyComponentMatch[];
}

function shipComponentMatches(projectAssetId: string, sourceAssetId: string, projectSuffix: '01' | '02', sourceSuffix: '01' | '02'): HeavyComponentMatch[] {
  return [
    {
      id: `${projectAssetId}-hull-match`,
      project: { assetId: projectAssetId, label: `Dutch ship ${projectSuffix} · hull`, nodeNames: [`dutch_ship_large_${projectSuffix}_hull`] },
      source: { assetId: sourceAssetId, label: `Dutch ship ${sourceSuffix} · hull`, nodeNames: [`dutch_ship_large_${sourceSuffix}_hull`] },
      similarity: 82,
      kind: 'geometry',
      method: 'Component topology + shared 4K texture-family signature',
      relationship: 'The two ships use the same material vocabulary and texture family, but their hull silhouettes and deck structures are independently modeled variants.',
      differences: [
        { label: 'Hull geometry', project: projectSuffix === '01' ? 'Base A · 110.6k-scene triangle profile' : 'Base B · 96.5k-scene triangle profile', source: sourceSuffix === '01' ? 'Base A · 110.6k-scene triangle profile' : 'Base B · 96.5k-scene triangle profile' },
        { label: 'Surface family', project: 'Shared hull diffuse / ARM / normal set', source: 'Shared hull diffuse / ARM / normal set' },
      ],
    },
    {
      id: `${projectAssetId}-rigging-match`,
      project: { assetId: projectAssetId, label: `Dutch ship ${projectSuffix} · rigging`, nodeNames: [`dutch_ship_large_${projectSuffix}_rigging`] },
      source: { assetId: sourceAssetId, label: `Dutch ship ${sourceSuffix} · rigging`, nodeNames: [`dutch_ship_large_${sourceSuffix}_rigging`] },
      similarity: 96,
      kind: 'appearance',
      method: 'Mesh silhouette + exact shared texture digest',
      relationship: 'The rigging components share exact 4K source textures and nearly the same visual construction, while remaining separate mesh records in the two packages.',
      differences: [
        { label: 'Rig layout', project: `Ship ${projectSuffix} mast and rope arrangement`, source: `Ship ${sourceSuffix} mast and rope arrangement` },
        { label: 'Texture identity', project: 'Exact shared rigging maps', source: 'Exact shared rigging maps' },
      ],
    },
    {
      id: `${projectAssetId}-sails-match`,
      project: { assetId: projectAssetId, label: `Dutch ship ${projectSuffix} · sails`, nodeNames: [`dutch_ship_large_${projectSuffix}_sails`] },
      source: { assetId: sourceAssetId, label: `Dutch ship ${sourceSuffix} · sails`, nodeNames: [`dutch_ship_large_${sourceSuffix}_sails`] },
      similarity: 94,
      kind: 'appearance',
      method: 'Alpha silhouette + exact shared material-map digest',
      relationship: 'The sail components reuse the same diffuse, ARM, and normal maps, with visible differences in plane layout and attachment context.',
      differences: [
        { label: 'Sail planes', project: `Ship ${projectSuffix} closed-sail arrangement`, source: `Ship ${sourceSuffix} closed-sail arrangement` },
        { label: 'Texture identity', project: 'Exact shared sail maps', source: 'Exact shared sail maps' },
      ],
    },
  ];
}

const chessComponentMatches: HeavyComponentMatch[] = [
  ['knight', 'Knight_W1', 'Knight_W2', 'Knight'],
  ['castle', 'Castle_W1', 'Castle_W2', 'Castle'],
  ['bishop', 'Bishop_W1', 'Bishop_W2', 'Bishop'],
  ['pawn', 'Pawn_Body_W1', 'Pawn_Body_W2', 'Pawn'],
].map(([id, first, second, label]) => ({
  id: `chess-${id}-instance`,
  project: { assetId: 'beautiful-game', label: `${label} W1`, nodeNames: [first] },
  source: { assetId: 'beautiful-game', label: `${label} W2`, nodeNames: [second] },
  similarity: 100,
  kind: 'exact-instance' as const,
  method: 'Shared glTF mesh index + geometry buffer identity',
  relationship: 'Both scene nodes reference the same underlying mesh and material data. Only their transforms place them at different squares.',
  differences: [{ label: 'Scene placement', project: 'First board position', source: 'Second board position' }],
}));

chessComponentMatches.push(
  {
    id: 'chess-knight-material',
    project: { assetId: 'beautiful-game', label: 'Knight W1', nodeNames: ['Knight_W1'] },
    source: { assetId: 'beautiful-game', label: 'Knight B1', nodeNames: ['Knight_B1'] },
    similarity: 94,
    kind: 'geometry',
    method: 'Exact position/index buffers + material divergence',
    relationship: 'The white and black knights have byte-identical geometry but different material assignments.',
    differences: [{ label: 'Material', project: 'White marble / glass treatment', source: 'Black stone / glass treatment' }],
  },
  {
    id: 'chess-castle-material',
    project: { assetId: 'beautiful-game', label: 'Castle W1', nodeNames: ['Castle_W1'] },
    source: { assetId: 'beautiful-game', label: 'Castle B1', nodeNames: ['Castle_B1'] },
    similarity: 94,
    kind: 'geometry',
    method: 'Exact position/index buffers + material divergence',
    relationship: 'The castle meshes are geometrically identical while the material systems provide the visible difference.',
    differences: [{ label: 'Material', project: 'White-piece material', source: 'Black-piece material' }],
  },
  {
    id: 'chess-pawn-material',
    project: { assetId: 'beautiful-game', label: 'Pawn W1', nodeNames: ['Pawn_Body_W1'] },
    source: { assetId: 'beautiful-game', label: 'Pawn B1', nodeNames: ['Pawn_Body_B1'] },
    similarity: 91,
    kind: 'geometry',
    method: 'Exact body/top geometry + material divergence',
    relationship: 'The pawn body and top geometry match exactly; the black/white material records and scene context differ.',
    differences: [{ label: 'Material', project: 'White pawn surface', source: 'Black pawn surface' }],
  },
);

export const heavyAssets: HeavyAssetRecord[] = [
  {
    id: 'robot-expressive-rig',
    name: 'Humanoid Motion Pack.glb',
    projectPath: 'ReplicatedStorage/Assets/Animations/GuideRig',
    modelUrl: '/assets/robot-expressive.glb',
    previewUrl: '/assets/robot-expressive-preview.svg',
    sourceUrl: 'https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf/RobotExpressive',
    licenseUrl: '/assets/robot-expressive-license.txt',
    license: 'CC0 1.0 Universal',
    attribution: 'Tomás Laulhé / Quaternius · glTF modifications by Don McCurdy',
    bytes: 463_988,
    size: '464 KB',
    hash: '047F5E5FB3BB6D378BD1DF16CA6137F2A596C99B3A1B5690B4020C05AAF6F319',
    nodes: 74,
    meshes: 14,
    primitives: 19,
    materials: 3,
    textures: 0,
    images: 0,
    extensions: ['2 skinned rigs', '14 authored animation clips', 'Core glTF 2.0'],
    description: 'A real licensed humanoid rig with fourteen authored clips, added as a Roblox animation-workflow proxy for joint indexing, clip metadata, and evidence handoff.',
    robloxWorkflow: {
      label: 'Animation workflow proxy',
      note: 'Licensed GLB fixture—not a Roblox-owned asset and not an R15 serialization.',
    },
  },
  {
    id: 'fox-npc-rig',
    name: 'NPC Locomotion Rig.glb',
    projectPath: 'ReplicatedStorage/Assets/NPCs/ForestFox',
    modelUrl: '/assets/fox-animated.glb',
    previewUrl: '/assets/fox-animated.jpg',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox',
    licenseUrl: '/assets/FOX-LICENSE.md',
    license: 'CC0 model · CC BY 4.0 rig and animation',
    attribution: 'PixelMannen / Creativetools.se · glTF conversion by Leonard Daly',
    bytes: 162_852,
    size: '163 KB',
    hash: 'D97044E701822BAC5A62696459B27D7B375AADA5DE8574ED4362EDBBA94771F7',
    nodes: 26,
    meshes: 1,
    primitives: 1,
    materials: 1,
    textures: 1,
    images: 1,
    extensions: ['1 skin', 'Survey / Walk / Run clips', 'Core glTF 2.0'],
    description: 'A compact skinned NPC with three mutually exclusive locomotion clips, useful for testing non-humanoid animation references and clip switching.',
    robloxWorkflow: {
      label: 'NPC animation proxy',
      note: 'Licensed Khronos fixture mapped to a Roblox-style project path.',
    },
  },
  {
    id: 'facial-morph-pack',
    name: 'Facial Deformation Pack.glb',
    projectPath: 'ReplicatedStorage/Assets/Characters/FacialCurves',
    modelUrl: '/assets/morph-stress-test.glb',
    previewUrl: '/assets/morph-stress-test.png',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MorphStressTest',
    licenseUrl: '/assets/MORPH-STRESS-TEST-LICENSE.md',
    license: 'CC BY 4.0',
    attribution: 'Analytical Graphics · Ed Mackey',
    bytes: 575_900,
    size: '576 KB',
    hash: '005F1D9DD938C553A506D6BF3D21830FC3F2EC3A199D9332E9A625BAF7342BEF',
    nodes: 1,
    meshes: 1,
    primitives: 2,
    materials: 2,
    textures: 3,
    images: 3,
    extensions: ['8 morph targets', '3 deformation clips', 'Core glTF 2.0'],
    description: 'A real eight-target deformation fixture representing facial and corrective-shape workloads that cannot be explained by skeletal joint counts alone.',
    robloxWorkflow: {
      label: 'Facial animation proxy',
      note: 'Licensed Khronos fixture; Roblox facial controls require their own mapping.',
    },
  },
  {
    id: 'dutch-ship-large-01',
    name: 'Dutch Ship Large 01.glb',
    projectPath: 'Art/World/Maritime/DutchShipA',
    modelUrl: '/assets/dutch-ship-large-01.glb',
    previewUrl: '/assets/dutch-ship-large-01.png',
    sourceUrl: 'https://polyhaven.com/a/dutch_ship_large_01',
    licenseUrl: 'https://polyhaven.com/license',
    license: 'CC0 1.0 Universal',
    attribution: 'Poly Haven · James Ray Cock, Nicolò Zubbini, Rico Cilliers',
    bytes: 107_145_484,
    size: '107.1 MB',
    hash: '968D8713CCEEBD13C8F36231F1368B11050537A8C2889E9C652CE2C275F08BF2',
    nodes: 3,
    meshes: 3,
    primitives: 3,
    materials: 3,
    textures: 9,
    images: 9,
    extensions: ['Core glTF 2.0 · embedded 4K PBR textures'],
    description: 'A self-contained 107 MB maritime hero asset with 110,616 triangles and independently selectable hull, rigging, and sail components.',
    componentMatches: shipComponentMatches('dutch-ship-large-01', 'dutch-ship-large-02', '01', '02'),
  },
  {
    id: 'dutch-ship-large-02',
    name: 'Dutch Ship Large 02.glb',
    projectPath: 'Art/World/Maritime/DutchShipB',
    modelUrl: '/assets/dutch-ship-large-02.glb',
    previewUrl: '/assets/dutch-ship-large-02.png',
    sourceUrl: 'https://polyhaven.com/a/dutch_ship_large_02',
    licenseUrl: 'https://polyhaven.com/license',
    license: 'CC0 1.0 Universal',
    attribution: 'Poly Haven · James Ray Cock, Nicolò Zubbini, Rico Cilliers',
    bytes: 106_163_560,
    size: '106.2 MB',
    hash: '5BAD7161F9ED1B7614621303C82730F6666C8FCBDE17522220CC365AA2878BA8',
    nodes: 3,
    meshes: 3,
    primitives: 3,
    materials: 3,
    textures: 9,
    images: 9,
    extensions: ['Core glTF 2.0 · embedded 4K PBR textures'],
    description: 'A second 106 MB ship variant with 96,506 triangles, created from the same CC0 texture families but a different hull and component arrangement.',
    componentMatches: shipComponentMatches('dutch-ship-large-02', 'dutch-ship-large-01', '02', '01'),
  },
  {
    id: 'beautiful-game',
    name: 'A Beautiful Game.glb',
    projectPath: 'Art/Showcase/ChessHall',
    modelUrl: '/assets/beautiful-game.glb',
    previewUrl: '/assets/beautiful-game.jpg',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ABeautifulGame',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/legalcode',
    license: 'CC BY 4.0',
    attribution: 'MaterialX Project / ASWF · glTF conversion by Ed Mackey',
    bytes: 42_977_928,
    size: '43.0 MB',
    hash: 'BD7133B4B322AAE97C589B8839DAE8155AD2546ACB35AE32A127E722A959D007',
    nodes: 49,
    meshes: 15,
    primitives: 15,
    materials: 15,
    textures: 38,
    images: 33,
    extensions: ['KHR_materials_transmission', 'KHR_materials_volume'],
    description: 'A complete chess set with individually separated pieces, instancing, volumetric glass, transmission, and a dense embedded texture payload.',
    componentMatches: chessComponentMatches,
  },
  {
    id: 'mosquito-amber',
    name: 'Mosquito in Amber.glb',
    projectPath: 'Art/Showcase/MuseumCases',
    modelUrl: '/assets/mosquito-in-amber.glb',
    previewUrl: '/assets/mosquito-in-amber.jpg',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/MosquitoInAmber',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/legalcode',
    license: 'CC BY 4.0',
    attribution: 'Loïc Norgeot / Sketchfab · mosquito scan by Geoffrey Marchal',
    bytes: 24_229_904,
    size: '24.2 MB',
    hash: '1C0B49000650E8A8C00D69BC8D64E46D33527871A47D74E4F2278887325CC35F',
    nodes: 10,
    meshes: 3,
    primitives: 3,
    materials: 3,
    textures: 5,
    images: 5,
    extensions: ['KHR_materials_transmission', 'KHR_materials_ior', 'KHR_materials_volume'],
    description: 'A refraction-heavy museum asset using index of refraction, transmission, and volumetric attenuation around a detailed insect scan.',
  },
  {
    id: 'node-performance-test',
    name: 'Node Performance Test.glb',
    projectPath: 'TechArt/Stress/SceneGraph10K',
    modelUrl: '/assets/node-performance-test.glb',
    previewUrl: '/assets/node-performance-test.jpg',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/NodePerformanceTest',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
    license: 'CC0 1.0 Universal',
    attribution: 'Jon Aspeheim · public-domain Khronos sample asset',
    bytes: 37_986_536,
    size: '38.0 MB',
    hash: '81EEC3B14B8ED25068448FFDC824528D03F1E844B20E017F5C3AAB3F076B1FB8',
    nodes: 10_002,
    meshes: 10_000,
    primitives: 10_000,
    materials: 10_000,
    textures: 10_000,
    images: 100,
    extensions: ['KHR_lights_punctual'],
    description: 'A deliberately demanding 10,000-mesh scene graph with 10,000 unique materials and texture references—the strongest proof that indexing is not limited to hero props.',
  },
  {
    id: 'corset-scan',
    name: 'Corset.glb',
    projectPath: 'Art/Characters/WardrobeStudy',
    modelUrl: '/assets/corset.glb',
    previewUrl: '/assets/corset.jpg',
    sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Corset',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode',
    license: 'CC0 1.0 Universal',
    attribution: 'Microsoft / UX3D · Khronos glTF Sample Assets',
    bytes: 13_491_364,
    size: '13.5 MB',
    hash: '9582C0DC0DEE813BE77F60E6DDF7213987C7E11497BF3CC66FD7B18957AE0D26',
    nodes: 1,
    meshes: 1,
    primitives: 1,
    materials: 1,
    textures: 3,
    images: 3,
    extensions: ['Core glTF 2.0 · embedded PBR textures'],
    description: 'A texture-dense fabric mannequin that stresses embedded high-resolution base color, normal, and packed material maps despite its simple scene graph.',
  },
];
