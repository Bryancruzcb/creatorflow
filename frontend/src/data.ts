export type EvidenceStatus = 'clear' | 'review' | 'blocked';
export type ReleaseDecision = 'approved' | 'needs-review' | 'blocked' | 'pending' | 'excluded';
export type AssetKind = 'model' | 'mesh' | 'mountain' | 'sprite' | 'wave' | 'texture' | 'icons' | 'font' | 'video' | 'receipt';

export interface MatchDifference {
  label: string;
  category: 'appearance' | 'container' | 'identity';
  sourceValue: string;
  projectValue: string;
  visibility: 'visible' | 'record-only' | 'exact';
}

export interface SourceMatch {
  id: string;
  title: string;
  provider: string;
  recordType: string;
  similarity: number;
  method: string;
  firstRegistered: string;
  license: string;
  relationship: string;
  differences: MatchDifference[];
  hash: string;
  variant: 'original' | 'crop' | 'derivative';
  modelUrl?: string;
  sourceUrl?: string;
  licenseUrl?: string;
}

export interface AssetRecord {
  id: string;
  name: string;
  path: string;
  format: string;
  size: string;
  kind: AssetKind;
  origin: string;
  license: string;
  fingerprint: string;
  evidence: string;
  status: EvidenceStatus;
  decision: ReleaseDecision;
  owner: string;
  firstSeen: string;
  hash: string;
  matches?: SourceMatch[];
  modelUrl?: string;
  previewUrl?: string;
  modelRotation?: number;
}

interface KhronosModelRecords {
  slug: string;
  displayName: string;
  localName: string;
  sourceHash: string;
  projectHash: string;
  sourceModelUrl: string;
  projectModelUrl: string;
  sourcePageUrl: string;
  firstSeen: string;
  visualDelta: {
    label: string;
    sourceValue: string;
    projectValue: string;
  };
}

const cc0LicenseUrl = 'https://creativecommons.org/publicdomain/zero/1.0/legalcode';

interface SampleMatchConfig {
  id: string;
  title: string;
  provider: string;
  similarity: number;
  method: string;
  license: string;
  relationship: string;
  differences: MatchDifference[];
  hash: string;
  variant?: SourceMatch['variant'];
}

function sampleRegistryMatch(config: SampleMatchConfig): SourceMatch[] {
  return [{
    id: config.id,
    title: config.title,
    provider: config.provider,
    recordType: 'Low-confidence sample registry record',
    similarity: config.similarity,
    method: config.method,
    firstRegistered: 'Earlier public record · sample dataset',
    license: config.license,
    relationship: config.relationship,
    differences: config.differences,
    hash: config.hash,
    variant: config.variant ?? 'derivative',
  }];
}

function khronosModelRecords(config: KhronosModelRecords): SourceMatch[] {
  return [
    {
      id: `${config.slug}-upstream-model`,
      title: `${config.displayName} — upstream GLB`,
      provider: 'Khronos glTF Sample Assets',
      recordType: 'Upstream source model',
      similarity: 99,
      method: 'Mesh topology + embedded texture digest',
      firstRegistered: '2017 · upstream public record',
      license: 'CC0 1.0 Universal',
      relationship: 'The project file preserves the source geometry and textures. Its controlled appearance change, container metadata, and new binary identity are itemized above so the score is not a black box.',
      differences: [
        {
          label: config.visualDelta.label,
          category: 'appearance',
          sourceValue: config.visualDelta.sourceValue,
          projectValue: config.visualDelta.projectValue,
          visibility: 'visible',
        },
        {
          label: 'GLB container metadata',
          category: 'container',
          sourceValue: 'Original Khronos scene record',
          projectValue: 'Northwind scene + import record',
          visibility: 'record-only',
        },
        {
          label: 'File identity',
          category: 'identity',
          sourceValue: `${config.sourceHash.slice(0, 12)}…`,
          projectValue: `${config.projectHash.slice(0, 12)}…`,
          visibility: 'record-only',
        },
      ],
      hash: config.sourceHash,
      variant: 'original',
      modelUrl: config.sourceModelUrl,
      sourceUrl: config.sourcePageUrl,
      licenseUrl: cc0LicenseUrl,
    },
    {
      id: `${config.slug}-repository-record`,
      title: `glTF-Sample-Assets / ${config.displayName}`,
      provider: 'Khronos GitHub repository',
      recordType: 'Repository distribution record',
      similarity: 99,
      method: 'Exact upstream SHA-256 + model signature',
      firstRegistered: 'Repository history · public',
      license: 'CC0 1.0 Universal',
      relationship: 'This stable repository record documents distribution and license history for the same upstream binary; it is not a second ownership claim.',
      differences: [
        {
          label: config.visualDelta.label,
          category: 'appearance',
          sourceValue: config.visualDelta.sourceValue,
          projectValue: config.visualDelta.projectValue,
          visibility: 'visible',
        },
        {
          label: 'Distribution record',
          category: 'container',
          sourceValue: 'Public upstream binary',
          projectValue: 'Project-side derivative',
          visibility: 'record-only',
        },
      ],
      hash: config.sourceHash,
      variant: 'crop',
      modelUrl: config.sourceModelUrl,
      sourceUrl: config.sourcePageUrl,
      licenseUrl: cc0LicenseUrl,
    },
    {
      id: `${config.slug}-northwind-import`,
      title: config.localName,
      provider: 'Northwind team archive',
      recordType: 'Local import and edit record',
      similarity: 100,
      method: 'Exact project SHA-256',
      firstRegistered: `${config.firstSeen} local`,
      license: 'References upstream record',
      relationship: 'This exact local file proves when the team imported and repackaged the asset. Permission still comes from the attached upstream evidence.',
      differences: [
        {
          label: 'Exact project bytes',
          category: 'identity',
          sourceValue: 'Same SHA-256',
          projectValue: 'Same SHA-256',
          visibility: 'exact',
        },
      ],
      hash: config.projectHash,
      variant: 'derivative',
      modelUrl: config.projectModelUrl,
      sourceUrl: '/assets/ASSET-PROVENANCE.md',
      licenseUrl: cc0LicenseUrl,
    },
  ];
}

export const initialAssets: AssetRecord[] = [
  {
    id: 'avocado-prop',
    name: 'avocado_foodstudy_v02.glb',
    path: 'Art/Props/FoodStudy',
    format: 'GLB',
    size: '7.7 MB',
    kind: 'model',
    origin: 'Khronos glTF Sample Assets',
    license: 'CC0 1.0 · source record not yet attached',
    fingerprint: 'Geometry + texture match · 3 records',
    evidence: 'The project model is a lightly color-graded derivative of a real Khronos sample asset. The upstream file is CC0, but this project record still needs the source URL and license evidence attached before release.',
    status: 'review',
    decision: 'needs-review',
    owner: 'M. Chen',
    firstSeen: 'May 08, 2026 · 10:32',
    hash: '5D36EDD89E44331DA003F181B6FB3A2A98303922600E3093B213E78913415AF7',
    modelUrl: '/assets/avocado-project-derivative.glb',
    previewUrl: '/assets/avocado-source.jpg',
    matches: khronosModelRecords({
      slug: 'avocado',
      displayName: 'Avocado.glb',
      localName: 'avocado_foodstudy_v02.glb',
      sourceHash: 'CCC9C3CE56423720B09399C2351537207CD5A65F859F9E6E2F30922762F3ABD4',
      projectHash: '5D36EDD89E44331DA003F181B6FB3A2A98303922600E3093B213E78913415AF7',
      sourceModelUrl: '/assets/avocado-source.glb',
      projectModelUrl: '/assets/avocado-project-derivative.glb',
      sourcePageUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Avocado',
      firstSeen: 'May 08, 2026 · 10:32',
      visualDelta: {
        label: 'Base-color grade',
        sourceValue: 'Original texture · neutral multiplier',
        projectValue: 'Orange grade · 1.00 / 0.32 / 0.18',
      },
    }),
  },
  {
    id: 'safehouse-radio',
    name: 'radio_safehouse_v04.glb',
    path: 'Art/Props/Safehouse',
    format: 'GLB',
    size: '10.4 MB',
    kind: 'model',
    origin: 'Khronos glTF Sample Assets',
    license: 'CC0 1.0 · upstream source record attached',
    fingerprint: 'Geometry + texture match · 3 records',
    evidence: 'A real Microsoft/Khronos Boom Box GLB was imported with a cooler emissive treatment and CreatorFlow metadata. Its CC0 source and license records are already attached.',
    status: 'clear',
    decision: 'approved',
    owner: 'M. Chen',
    firstSeen: 'May 09, 2026 · 14:06',
    hash: '1AA49E3FE779E292D39BCC0A71B0D297A098CCFBBA5094FB46A162E59CE4F9A4',
    modelUrl: '/assets/boombox-project-derivative.glb',
    previewUrl: '/assets/boombox-source.jpg',
    matches: khronosModelRecords({
      slug: 'boombox',
      displayName: 'BoomBox.glb',
      localName: 'radio_safehouse_v04.glb',
      sourceHash: 'F8B918445EBDD006768232205A62F5182D2208CA57F84C6CCC084943C0BC8F15',
      projectHash: '1AA49E3FE779E292D39BCC0A71B0D297A098CCFBBA5094FB46A162E59CE4F9A4',
      sourceModelUrl: '/assets/boombox-source.glb',
      projectModelUrl: '/assets/boombox-project-derivative.glb',
      sourcePageUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BoomBox',
      firstSeen: 'May 09, 2026 · 14:06',
      visualDelta: {
        label: 'Material treatment',
        sourceValue: 'Neutral grade and white emissive',
        projectValue: 'Blue grade and blue emissive',
      },
    }),
  },
  {
    id: 'harbor-fish',
    name: 'barramundi_market_v03.glb',
    path: 'Art/Creatures/HarborMarket',
    format: 'GLB',
    size: '12.1 MB',
    kind: 'model',
    origin: 'Khronos glTF Sample Assets',
    license: 'CC0 1.0 · source record not yet attached',
    fingerprint: 'Geometry + texture match · 3 records',
    evidence: 'The real Barramundi Fish GLB has a verified CC0 upstream record, but the project import has not yet attached that evidence to this release.',
    status: 'review',
    decision: 'needs-review',
    owner: 'R. Avery',
    firstSeen: 'May 11, 2026 · 09:44',
    hash: '1A4F497E657DCC33FC55C02FCBD7B5D610AB72B8F8B7AE8764EF69D9E20ED477',
    modelUrl: '/assets/barramundi-project-derivative.glb',
    previewUrl: '/assets/barramundi-source.jpg',
    modelRotation: -1.5,
    matches: khronosModelRecords({
      slug: 'barramundi',
      displayName: 'BarramundiFish.glb',
      localName: 'barramundi_market_v03.glb',
      sourceHash: 'ECC3BAFB6B00F2C8B810863C388E3768A7B7EA0D0335E8CB8C574C266E571F4A',
      projectHash: '1A4F497E657DCC33FC55C02FCBD7B5D610AB72B8F8B7AE8764EF69D9E20ED477',
      sourceModelUrl: '/assets/barramundi-source.glb',
      projectModelUrl: '/assets/barramundi-project-derivative.glb',
      sourcePageUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BarramundiFish',
      firstSeen: 'May 11, 2026 · 09:44',
      visualDelta: {
        label: 'Material treatment',
        sourceValue: 'Neutral grade · roughness 1.00',
        projectValue: 'Blue grade · roughness 0.18',
      },
    }),
  },
  {
    id: 'trail-water-bottle',
    name: 'water_bottle_camp_v02.glb',
    path: 'Art/Props/TrailCamp',
    format: 'GLB',
    size: '8.6 MB',
    kind: 'model',
    origin: 'Khronos glTF Sample Assets',
    license: 'CC0 1.0 · source record not yet attached',
    fingerprint: 'Geometry + texture match · 3 records',
    evidence: 'The project bottle is a lightly color-graded derivative of the Microsoft/Khronos Water Bottle. The upstream CC0 record is verified and ready to attach.',
    status: 'review',
    decision: 'needs-review',
    owner: 'R. Avery',
    firstSeen: 'May 12, 2026 · 08:21',
    hash: 'C56C3CC4960E746E59B7E2E5900AE168308B263C5A0EB384365F4BCE3FCC1480',
    modelUrl: '/assets/waterbottle-project-derivative.glb',
    previewUrl: '/assets/waterbottle-source.jpg',
    matches: khronosModelRecords({
      slug: 'waterbottle',
      displayName: 'WaterBottle.glb',
      localName: 'water_bottle_camp_v02.glb',
      sourceHash: 'B337E526FD6A162013C2984AEEC163F5FBB4F717252724DFC3F3458BD51DF94B',
      projectHash: 'C56C3CC4960E746E59B7E2E5900AE168308B263C5A0EB384365F4BCE3FCC1480',
      sourceModelUrl: '/assets/waterbottle-source.glb',
      projectModelUrl: '/assets/waterbottle-project-derivative.glb',
      sourcePageUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/WaterBottle',
      firstSeen: 'May 12, 2026 · 08:21',
      visualDelta: {
        label: 'Base-color grade',
        sourceValue: 'Original texture · neutral multiplier',
        projectValue: 'Strong blue grade · 0.12 / 0.45 / 1.00',
      },
    }),
  },
  {
    id: 'night-dock-lantern',
    name: 'lantern_dock_v03.glb',
    path: 'Art/Props/NightDock',
    format: 'GLB',
    size: '9.2 MB',
    kind: 'model',
    origin: 'Khronos glTF Sample Assets',
    license: 'CC0 1.0 · upstream source record attached',
    fingerprint: 'Geometry + texture match · 3 records',
    evidence: 'This project-side Lantern uses the original CC0 geometry and textures with a glossier material treatment. Source, license, and import evidence are linked.',
    status: 'clear',
    decision: 'approved',
    owner: 'M. Chen',
    firstSeen: 'May 12, 2026 · 16:47',
    hash: '82C28632E61CE14A173515E69B6F1C22B77092BE817FEEE5548E530B30393515',
    modelUrl: '/assets/lantern-project-derivative.glb',
    previewUrl: '/assets/lantern-source.jpg',
    modelRotation: -0.2,
    matches: khronosModelRecords({
      slug: 'lantern',
      displayName: 'Lantern.glb',
      localName: 'lantern_dock_v03.glb',
      sourceHash: 'A79458C4B02D695187A952F23A63B8BF278E7BC3D316A3C2A314F2D6974181F1',
      projectHash: '82C28632E61CE14A173515E69B6F1C22B77092BE817FEEE5548E530B30393515',
      sourceModelUrl: '/assets/lantern-source.glb',
      projectModelUrl: '/assets/lantern-project-derivative.glb',
      sourcePageUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern',
      firstSeen: 'May 12, 2026 · 16:47',
      visualDelta: {
        label: 'Material treatment',
        sourceValue: 'Neutral wood/metal · roughness 1.00',
        projectValue: 'Strong blue grade · roughness 0.12',
      },
    }),
  },
  {
    id: 'rock-cluster',
    name: 'rock_cluster_03.fbx',
    path: 'Art/Environment/Rocks',
    format: 'FBX',
    size: '8.1 MB',
    kind: 'mesh',
    origin: 'Created in-house',
    license: 'Proprietary · declaration recorded',
    fingerprint: '38% geometric resemblance · 1 record',
    evidence: 'A low-confidence silhouette match was found, but topology, proportions, and material layout are substantially different. The side-by-side view makes the gap explicit.',
    status: 'review',
    decision: 'needs-review',
    owner: 'R. Avery',
    firstSeen: 'May 07, 2026 · 16:14',
    hash: 'C04B82A184D809C14A74B5817CB78442C04B82A184D809C14A74B5817CB78442',
    matches: sampleRegistryMatch({
      id: 'rock-cluster-low-geometry',
      title: 'Basalt outcrop kit / formation B',
      provider: 'Open geometry index · sample record',
      similarity: 38,
      method: 'Coarse silhouette + vertex-density signature',
      license: 'CC BY 4.0 · sample metadata only',
      relationship: 'Both records depict clustered rocks, but the project mesh has a different silhouette, topology, scale distribution, and material segmentation. This is a weak category-level resemblance, not a likely copy.',
      differences: [
        { label: 'Outer silhouette', category: 'appearance', sourceValue: 'Tall columnar outcrop', projectValue: 'Low five-stone cluster', visibility: 'visible' },
        { label: 'Mesh structure', category: 'container', sourceValue: '18.2k vertices · 3 pieces', projectValue: '46.8k vertices · 5 pieces', visibility: 'record-only' },
        { label: 'Material regions', category: 'appearance', sourceValue: 'Single dry basalt surface', projectValue: 'Moss, fractured stone, wet edge', visibility: 'visible' },
      ],
      hash: '0C2D40F61190A9870C2D40F61190A9870C2D40F61190A9870C2D40F61190A987',
    }),
  },
  {
    id: 'hero-sprite',
    name: 'hero_run_cycle@2x.png',
    path: 'Art/Characters/Hero',
    format: 'PNG',
    size: '2.4 MB',
    kind: 'sprite',
    origin: 'Created in-house',
    license: 'Proprietary · all rights reserved',
    fingerprint: '24% pose-sequence resemblance · 1 record',
    evidence: 'The scan found another ten-frame running sheet, but character construction, timing, palette, and frame spacing are visibly different.',
    status: 'review',
    decision: 'needs-review',
    owner: 'R. Avery',
    firstSeen: 'May 12, 2026 · 09:18',
    hash: '92CE7D1A0B4F6E3C8D9A1B2C3D4E5F6A92CE7D1A0B4F6E3C8D9A1B2C3D4E5F6A',
    matches: sampleRegistryMatch({
      id: 'hero-sprite-low-sequence',
      title: 'Courier run cycle · 8-direction sheet',
      provider: 'Sprite Commons index · sample record',
      similarity: 24,
      method: 'Pose cadence + frame-layout fingerprint',
      license: 'CC BY-SA 4.0 · sample metadata only',
      relationship: 'The records share a generic run-cycle rhythm. Different anatomy, costume shapes, frame count, and timing keep the confidence low.',
      differences: [
        { label: 'Character construction', category: 'appearance', sourceValue: 'Armored courier · compact silhouette', projectValue: 'Unarmored runner · tall silhouette', visibility: 'visible' },
        { label: 'Frame cadence', category: 'appearance', sourceValue: '12 frames at 15 fps', projectValue: '10 frames at 24 fps', visibility: 'visible' },
        { label: 'Canvas packing', category: 'container', sourceValue: '3 × 4 atlas', projectValue: '2 × 5 atlas', visibility: 'record-only' },
      ],
      hash: '14AA32C66EF9184514AA32C66EF9184514AA32C66EF9184514AA32C66EF91845',
      variant: 'crop',
    }),
  },
  {
    id: 'ui-icon-set',
    name: 'ui_icon_set.sketch',
    path: 'UI/Icons',
    format: 'SKETCH',
    size: '3.1 MB',
    kind: 'icons',
    origin: 'Figma import · unknown author',
    license: 'No license attached',
    fingerprint: '31% layout resemblance · 1 record',
    evidence: 'The source candidate uses the same broad icon categories, but its geometry, stroke system, grid, and corner language are visibly different. Missing provenance—not visual similarity—is what blocks release.',
    status: 'blocked',
    decision: 'blocked',
    owner: 'Unassigned',
    firstSeen: 'May 18, 2026 · 11:03',
    hash: 'E18F4AD9A07D329B9144A533210DB411E18F4AD9A07D329B9144A533210DB411',
    matches: sampleRegistryMatch({
      id: 'ui-icons-low-layout',
      title: 'Transit controls / outline collection',
      provider: 'Design asset registry · sample record',
      similarity: 31,
      method: 'Vector contour + semantic cluster match',
      license: 'License not present in sample record',
      relationship: 'The two files cover similar interface actions, but their construction systems do not align. This weak match does not resolve the project file’s missing author and license.',
      differences: [
        { label: 'Shape language', category: 'appearance', sourceValue: 'Circular 1.5 px outline set', projectValue: 'Squared 2 px mixed-fill set', visibility: 'visible' },
        { label: 'Icon inventory', category: 'appearance', sourceValue: '24 transit controls', projectValue: '18 navigation controls', visibility: 'visible' },
        { label: 'Vector structure', category: 'container', sourceValue: 'SVG symbol collection', projectValue: 'Sketch components and overrides', visibility: 'record-only' },
      ],
      hash: 'DD8A2140C7F49156DD8A2140C7F49156DD8A2140C7F49156DD8A2140C7F49156',
    }),
  },
  {
    id: 'impact-bass',
    name: 'impact_bass.wav',
    path: 'Audio/SFX',
    format: 'WAV',
    size: '1.2 MB',
    kind: 'wave',
    origin: 'Epidemic Sound',
    license: 'Standard license · single project',
    fingerprint: '18% spectral resemblance · 1 record',
    evidence: 'A registry hit shares a short low-frequency impact profile, while the transient, duration, harmonic tail, and stereo field differ substantially.',
    status: 'clear',
    decision: 'approved',
    owner: 'M. Chen',
    firstSeen: 'May 10, 2026 · 18:42',
    hash: '1F8E2D5C4B5A697887766554433221101F8E2D5C4B5A69788776655443322110',
    matches: sampleRegistryMatch({
      id: 'impact-bass-low-spectrum',
      title: 'Sub drop / concrete hit 04',
      provider: 'Audio fingerprint registry · sample record',
      similarity: 18,
      method: 'Spectral peaks + transient envelope',
      license: 'Royalty-free pack · separate project terms',
      relationship: 'Both clips contain a bass-heavy impact. The spectral contour and timing diverge enough that the system treats this as a weak acoustic neighborhood match.',
      differences: [
        { label: 'Transient shape', category: 'appearance', sourceValue: 'Sharp 18 ms attack', projectValue: 'Soft 74 ms swell', visibility: 'visible' },
        { label: 'Spectral tail', category: 'appearance', sourceValue: 'Metallic 2.4 kHz decay', projectValue: 'Sub-only 62 Hz decay', visibility: 'visible' },
        { label: 'Duration / channels', category: 'container', sourceValue: '0.8 s · mono', projectValue: '2.1 s · stereo', visibility: 'record-only' },
      ],
      hash: 'A0914D75F9B8200EA0914D75F9B8200EA0914D75F9B8200EA0914D75F9B8200E',
    }),
  },
  {
    id: 'ambient-loop',
    name: 'ambient_loop.mp3',
    path: 'Audio/Ambience',
    format: 'MP3',
    size: '4.7 MB',
    kind: 'wave',
    origin: 'Unknown source',
    license: 'No license found',
    fingerprint: '46% acoustic mood resemblance · 1 record',
    evidence: 'A possible ambience source has similar tonal energy but a different pulse, field recording, duration, and mastering profile. It remains blocked because neither record proves permission.',
    status: 'blocked',
    decision: 'pending',
    owner: 'Unassigned',
    firstSeen: 'May 18, 2026 · 11:09',
    hash: '7A3F2C9D8E110CDA0B8E11CDA0B8E117A3F2C9D8E110CDA0B8E11CDA0B8E1100',
    matches: sampleRegistryMatch({
      id: 'ambient-loop-low-mood',
      title: 'Night terminal atmosphere / take 2',
      provider: 'Audio fingerprint registry · sample record',
      similarity: 46,
      method: 'Long-window chroma + ambience texture',
      license: 'Unknown · source candidate only',
      relationship: 'The match is driven by sustained tonal texture, not a shared recording. Audible events, loop boundaries, and dynamics differ.',
      differences: [
        { label: 'Event pattern', category: 'appearance', sourceValue: 'Rain, train brake, PA tone', projectValue: 'Wind, cable hum, distant machinery', visibility: 'visible' },
        { label: 'Loop boundary', category: 'appearance', sourceValue: 'Hard 32 s repeat', projectValue: 'Crossfaded 47 s repeat', visibility: 'visible' },
        { label: 'Encoding', category: 'container', sourceValue: 'AAC · 48 kHz', projectValue: 'MP3 · 44.1 kHz', visibility: 'record-only' },
      ],
      hash: '61BD0FE779A244C061BD0FE779A244C061BD0FE779A244C061BD0FE779A244C0',
      variant: 'crop',
    }),
  },
  {
    id: 'display-typeface',
    name: 'northwind_display_semibold.otf',
    path: 'UI/Typography',
    format: 'OTF',
    size: '684 KB',
    kind: 'font',
    origin: 'Vendor handoff · unverified',
    license: 'Desktop license only · web rights unclear',
    fingerprint: '29% glyph-outline resemblance · 1 record',
    evidence: 'A public display face shares broad proportions, but terminals, counters, kerning, and several diagnostic glyphs are visibly different. The web-use license still needs confirmation.',
    status: 'review',
    decision: 'needs-review',
    owner: 'J. Park',
    firstSeen: 'May 17, 2026 · 15:22',
    hash: '5B320A8D7C19F6405B320A8D7C19F6405B320A8D7C19F6405B320A8D7C19F640',
    matches: sampleRegistryMatch({
      id: 'display-font-low-outline',
      title: 'Foundry Sans Display / Medium',
      provider: 'Font outline registry · sample record',
      similarity: 29,
      method: 'Diagnostic glyph topology + spacing model',
      license: 'OFL 1.1 · candidate record',
      relationship: 'Overall width and x-height are similar, but the letter construction is clearly different. The candidate cannot substitute for the missing webfont permission.',
      differences: [
        { label: 'Diagnostic glyphs', category: 'appearance', sourceValue: 'Single-storey a · open 4', projectValue: 'Double-storey a · closed 4', visibility: 'visible' },
        { label: 'Stroke terminals', category: 'appearance', sourceValue: 'Rounded geometric cuts', projectValue: 'Sharp humanist cuts', visibility: 'visible' },
        { label: 'Font metrics', category: 'container', sourceValue: '1000 UPM · 612 glyphs', projectValue: '2048 UPM · 438 glyphs', visibility: 'record-only' },
      ],
      hash: '8F02D94BA17C6E338F02D94BA17C6E338F02D94BA17C6E338F02D94BA17C6E33',
    }),
  },
  {
    id: 'trailer-cut',
    name: 'launch_trailer_cut_07.mov',
    path: 'Marketing/Trailer',
    format: 'MOV',
    size: '286 MB',
    kind: 'video',
    origin: 'External editor delivery',
    license: 'Mixed footage · cue sheet incomplete',
    fingerprint: '34% shot-sequence resemblance · 1 record',
    evidence: 'The candidate has a similar three-shot rhythm, but subjects, camera motion, edit timing, color grade, and audio bed are all visibly or audibly different.',
    status: 'blocked',
    decision: 'blocked',
    owner: 'Unassigned',
    firstSeen: 'May 18, 2026 · 12:41',
    hash: 'C7EE81A410F259B3C7EE81A410F259B3C7EE81A410F259B3C7EE81A410F259B3',
    matches: sampleRegistryMatch({
      id: 'trailer-low-sequence',
      title: 'Industrial reveal / campaign teaser',
      provider: 'Video sequence registry · sample record',
      similarity: 34,
      method: 'Keyframe embeddings + edit-rhythm signature',
      license: 'Rights-managed footage · candidate record',
      relationship: 'The confidence comes from edit rhythm and broad scene categories. The imagery itself is materially different, so the match is useful for review but not evidence of reuse.',
      differences: [
        { label: 'Shot content', category: 'appearance', sourceValue: 'Factory, vehicle, city aerial', projectValue: 'Forest, character close-up, orbital vista', visibility: 'visible' },
        { label: 'Edit rhythm', category: 'appearance', sourceValue: '2.0 / 1.1 / 3.4 seconds', projectValue: '1.2 / 2.6 / 2.7 seconds', visibility: 'visible' },
        { label: 'Master format', category: 'container', sourceValue: 'H.264 · 1080p SDR', projectValue: 'ProRes 422 · 4K HDR', visibility: 'record-only' },
      ],
      hash: '39B40D6F2A18C4E739B40D6F2A18C4E739B40D6F2A18C4E739B40D6F2A18C4E7',
      variant: 'crop',
    }),
  },
];

export const workflowSteps = [
  {
    title: 'Scan the project',
    body: 'Index creative files locally, compute fingerprints, and collect the metadata already present in the folder.',
    output: 'Asset index, hashes, visual signatures',
  },
  {
    title: 'Review the evidence',
    body: 'See exact conflicts, likely derivatives, missing licenses, and provenance gaps with every source attached.',
    output: 'Findings, source links, exceptions',
  },
  {
    title: 'Resolve exceptions',
    body: 'Attach a receipt, add attribution, record an ownership declaration, replace the file, or exclude it from release.',
    output: 'Human decisions and audit notes',
  },
  {
    title: 'Export the manifest',
    body: 'Generate a shareable creative asset manifest for the release package, repository, or publisher review.',
    output: 'JSON release record',
  },
];
