export type ProjectEvidenceState = 'clear' | 'review' | 'blocked' | 'unscanned';
export type ProjectChangeState = 'unchanged' | 'added' | 'modified';
export type RobloxNodeKind = 'project' | 'service' | 'folder' | 'model' | 'animation' | 'script' | 'ui' | 'remote' | 'humanoid' | 'animator' | 'audio';

export interface RobloxAnimationExample {
  fixtureClipName: string;
  animationId: string;
  durationSeconds: number;
  trackCount: number;
  keyCount: number;
  rigType: 'R15';
}

export interface RobloxProjectNode {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  className: string;
  kind: RobloxNodeKind;
  evidenceState: ProjectEvidenceState;
  changeState: ProjectChangeState;
  previewUrl?: string;
  note?: string;
  license?: string;
  sourceStatus?: 'recorded' | 'missing' | 'not-required';
  references?: string[];
  findingIds?: string[];
  animation?: RobloxAnimationExample;
}

export interface RobloxProjectFinding {
  id: string;
  nodeId: string;
  state: 'review' | 'blocked';
  title: string;
  detail: string;
}

const animationStats: Array<[string, number, number, number]> = [
  ['Dance', 3.333, 12, 972],
  ['Death', 0.958, 18, 432],
  ['Idle', 3.333, 7, 567],
  ['Jump', 0.708, 18, 324],
  ['No', 1.667, 7, 287],
  ['Punch', 0.833, 15, 315],
  ['Running', 0.958, 18, 432],
  ['Sitting', 0.417, 10, 110],
  ['Standing', 0.417, 10, 110],
  ['ThumbsUp', 1.583, 15, 585],
  ['Walking', 0.958, 20, 480],
  ['WalkJump', 0.833, 18, 378],
  ['Wave', 1.833, 18, 810],
  ['Yes', 1.667, 7, 287],
];

const animationNodes: RobloxProjectNode[] = animationStats.map(([name, durationSeconds, trackCount, keyCount], index) => ({
  id: `animation-${name.toLowerCase()}`,
  parentId: 'guide-animations',
  name,
  path: `ReplicatedStorage.Assets.Animations.Guide.${name}`,
  className: 'Animation',
  kind: 'animation',
  evidenceState: name === 'Wave' ? 'review' : 'clear',
  changeState: name === 'Wave' ? 'modified' : 'unchanged',
  note: name === 'Wave' ? 'Locally edited derivative; animator review is still open.' : 'Licensed CC0 fixture with source metadata attached.',
  license: 'CC0 1.0',
  sourceStatus: 'recorded',
  references: name === 'Walking' || name === 'Running' || name === 'Idle' ? ['StarterPlayer.StarterPlayerScripts.TourController'] : ['Workspace.CharacterCast.GuideRig.Animator'],
  findingIds: name === 'Wave' ? ['finding-wave-edit'] : [],
  animation: {
    fixtureClipName: name,
    animationId: `demo:guide:${String(index + 1).padStart(2, '0')}`,
    durationSeconds,
    trackCount,
    keyCount,
    rigType: 'R15',
  },
}));

export const robloxProjectNodes: RobloxProjectNode[] = [
  { id: 'project', parentId: null, name: 'Northwind Museum', path: 'Northwind Museum', className: 'DataModel', kind: 'project', evidenceState: 'review', changeState: 'modified', note: 'Fictional Studio snapshot assembled from the licensed CreatorFlow fixtures.' },
  { id: 'workspace', parentId: 'project', name: 'Workspace', path: 'Workspace', className: 'Workspace', kind: 'service', evidenceState: 'clear', changeState: 'unchanged' },
  { id: 'harbor', parentId: 'workspace', name: 'HarborExhibit', path: 'Workspace.HarborExhibit', className: 'Model', kind: 'model', evidenceState: 'clear', changeState: 'unchanged', previewUrl: '/assets/dutch-ship-large-01.png', note: 'Two maritime hero models with reusable, attributed material families.' },
  { id: 'ship-a', parentId: 'harbor', name: 'DutchShipA', path: 'Workspace.HarborExhibit.DutchShipA', className: 'Model', kind: 'model', evidenceState: 'clear', changeState: 'unchanged', previewUrl: '/assets/dutch-ship-large-01.png', license: 'CC0 1.0 Universal', sourceStatus: 'recorded' },
  { id: 'ship-b', parentId: 'harbor', name: 'DutchShipB', path: 'Workspace.HarborExhibit.DutchShipB', className: 'Model', kind: 'model', evidenceState: 'clear', changeState: 'unchanged', previewUrl: '/assets/dutch-ship-large-02.png', license: 'CC0 1.0 Universal', sourceStatus: 'recorded' },
  { id: 'gallery', parentId: 'workspace', name: 'GrandGallery', path: 'Workspace.GrandGallery', className: 'Folder', kind: 'folder', evidenceState: 'clear', changeState: 'unchanged' },
  { id: 'chess-hall', parentId: 'gallery', name: 'ChessHall', path: 'Workspace.GrandGallery.ChessHall', className: 'Model', kind: 'model', evidenceState: 'clear', changeState: 'unchanged', previewUrl: '/assets/beautiful-game.jpg', license: 'CC BY 4.0', sourceStatus: 'recorded', note: 'Repeated chess pieces are legitimate in-file instances, not duplicate-source findings.' },
  { id: 'amber-case', parentId: 'gallery', name: 'AmberCase', path: 'Workspace.GrandGallery.AmberCase', className: 'Model', kind: 'model', evidenceState: 'clear', changeState: 'unchanged', previewUrl: '/assets/mosquito-in-amber.jpg', license: 'CC BY 4.0', sourceStatus: 'recorded' },
  { id: 'wardrobe', parentId: 'gallery', name: 'WardrobeStudy', path: 'Workspace.GrandGallery.WardrobeStudy', className: 'Model', kind: 'model', evidenceState: 'clear', changeState: 'unchanged', previewUrl: '/assets/corset.jpg', license: 'CC BY 4.0', sourceStatus: 'recorded' },
  { id: 'cast', parentId: 'workspace', name: 'CharacterCast', path: 'Workspace.CharacterCast', className: 'Folder', kind: 'folder', evidenceState: 'review', changeState: 'modified' },
  { id: 'guide-rig', parentId: 'cast', name: 'GuideRig', path: 'Workspace.CharacterCast.GuideRig', className: 'Model', kind: 'model', evidenceState: 'review', changeState: 'modified', note: 'R15-style guide rig used by the tour controller and exhibit interactions.' },
  { id: 'humanoid', parentId: 'guide-rig', name: 'Humanoid', path: 'Workspace.CharacterCast.GuideRig.Humanoid', className: 'Humanoid', kind: 'humanoid', evidenceState: 'unscanned', changeState: 'unchanged' },
  { id: 'animator', parentId: 'guide-rig', name: 'Animator', path: 'Workspace.CharacterCast.GuideRig.Animator', className: 'Animator', kind: 'animator', evidenceState: 'clear', changeState: 'modified', references: ['ReplicatedStorage.Assets.Animations.Guide'] },

  { id: 'replicated-storage', parentId: 'project', name: 'ReplicatedStorage', path: 'ReplicatedStorage', className: 'ReplicatedStorage', kind: 'service', evidenceState: 'review', changeState: 'modified' },
  { id: 'assets', parentId: 'replicated-storage', name: 'Assets', path: 'ReplicatedStorage.Assets', className: 'Folder', kind: 'folder', evidenceState: 'review', changeState: 'modified' },
  { id: 'animations', parentId: 'assets', name: 'Animations', path: 'ReplicatedStorage.Assets.Animations', className: 'Folder', kind: 'folder', evidenceState: 'review', changeState: 'modified' },
  { id: 'guide-animations', parentId: 'animations', name: 'Guide', path: 'ReplicatedStorage.Assets.Animations.Guide', className: 'Folder', kind: 'folder', evidenceState: 'review', changeState: 'modified', note: 'Fourteen authored motions mapped to the guide rig.' },
  ...animationNodes,
  { id: 'models', parentId: 'assets', name: 'Models', path: 'ReplicatedStorage.Assets.Models', className: 'Folder', kind: 'folder', evidenceState: 'clear', changeState: 'unchanged' },
  { id: 'textures', parentId: 'assets', name: 'Textures', path: 'ReplicatedStorage.Assets.Textures', className: 'Folder', kind: 'folder', evidenceState: 'clear', changeState: 'unchanged' },
  { id: 'audio', parentId: 'assets', name: 'Audio', path: 'ReplicatedStorage.Assets.Audio', className: 'Folder', kind: 'folder', evidenceState: 'clear', changeState: 'added' },
  { id: 'gallery-ambience', parentId: 'audio', name: 'GalleryAmbience', path: 'ReplicatedStorage.Assets.Audio.GalleryAmbience', className: 'Sound', kind: 'audio', evidenceState: 'clear', changeState: 'added', sourceStatus: 'recorded' },
  { id: 'shared', parentId: 'replicated-storage', name: 'Shared', path: 'ReplicatedStorage.Shared', className: 'Folder', kind: 'folder', evidenceState: 'unscanned', changeState: 'unchanged' },
  { id: 'registry', parentId: 'shared', name: 'ExhibitRegistry', path: 'ReplicatedStorage.Shared.ExhibitRegistry', className: 'ModuleScript', kind: 'script', evidenceState: 'unscanned', changeState: 'modified', references: ['Workspace.GrandGallery', 'Workspace.HarborExhibit'] },
  { id: 'remotes', parentId: 'replicated-storage', name: 'Remotes', path: 'ReplicatedStorage.Remotes', className: 'Folder', kind: 'folder', evidenceState: 'unscanned', changeState: 'unchanged' },
  { id: 'begin-tour', parentId: 'remotes', name: 'BeginTour', path: 'ReplicatedStorage.Remotes.BeginTour', className: 'RemoteEvent', kind: 'remote', evidenceState: 'unscanned', changeState: 'unchanged' },
  { id: 'interact', parentId: 'remotes', name: 'InteractExhibit', path: 'ReplicatedStorage.Remotes.InteractExhibit', className: 'RemoteEvent', kind: 'remote', evidenceState: 'unscanned', changeState: 'unchanged' },

  { id: 'server-scripts', parentId: 'project', name: 'ServerScriptService', path: 'ServerScriptService', className: 'ServerScriptService', kind: 'service', evidenceState: 'unscanned', changeState: 'modified' },
  { id: 'tour-service', parentId: 'server-scripts', name: 'TourService', path: 'ServerScriptService.TourService', className: 'Script', kind: 'script', evidenceState: 'unscanned', changeState: 'modified', references: ['ReplicatedStorage.Remotes.BeginTour', 'Workspace.CharacterCast.GuideRig'] },
  { id: 'exhibit-service', parentId: 'server-scripts', name: 'ExhibitService', path: 'ServerScriptService.ExhibitService', className: 'Script', kind: 'script', evidenceState: 'unscanned', changeState: 'unchanged', references: ['ReplicatedStorage.Shared.ExhibitRegistry'] },
  { id: 'starter-player', parentId: 'project', name: 'StarterPlayer', path: 'StarterPlayer', className: 'StarterPlayer', kind: 'service', evidenceState: 'unscanned', changeState: 'modified' },
  { id: 'starter-scripts', parentId: 'starter-player', name: 'StarterPlayerScripts', path: 'StarterPlayer.StarterPlayerScripts', className: 'StarterPlayerScripts', kind: 'folder', evidenceState: 'unscanned', changeState: 'modified' },
  { id: 'tour-controller', parentId: 'starter-scripts', name: 'TourController', path: 'StarterPlayer.StarterPlayerScripts.TourController', className: 'LocalScript', kind: 'script', evidenceState: 'unscanned', changeState: 'modified', findingIds: ['finding-controller-change'], references: ['ReplicatedStorage.Assets.Animations.Guide.Walking', 'ReplicatedStorage.Assets.Animations.Guide.Running', 'ReplicatedStorage.Remotes.BeginTour'] },
  { id: 'starter-gui', parentId: 'project', name: 'StarterGui', path: 'StarterGui', className: 'StarterGui', kind: 'service', evidenceState: 'blocked', changeState: 'added' },
  { id: 'tour-hud', parentId: 'starter-gui', name: 'TourHUD', path: 'StarterGui.TourHUD', className: 'ScreenGui', kind: 'ui', evidenceState: 'blocked', changeState: 'added', sourceStatus: 'missing', findingIds: ['finding-hud-source'], note: 'One navigation icon has no attached source or license record.' },
  { id: 'exhibit-card', parentId: 'starter-gui', name: 'ExhibitCard', path: 'StarterGui.ExhibitCard', className: 'Frame', kind: 'ui', evidenceState: 'clear', changeState: 'unchanged' },
  { id: 'credits', parentId: 'starter-gui', name: 'CreditsPanel', path: 'StarterGui.CreditsPanel', className: 'Frame', kind: 'ui', evidenceState: 'clear', changeState: 'modified' },
  { id: 'lighting', parentId: 'project', name: 'Lighting', path: 'Lighting', className: 'Lighting', kind: 'service', evidenceState: 'unscanned', changeState: 'unchanged' },
  { id: 'sound-service', parentId: 'project', name: 'SoundService', path: 'SoundService', className: 'SoundService', kind: 'service', evidenceState: 'clear', changeState: 'added' },
];

export const robloxProjectFindings: RobloxProjectFinding[] = [
  { id: 'finding-hud-source', nodeId: 'tour-hud', state: 'blocked', title: 'Tour HUD icon has no source record', detail: 'Attach an origin and license or replace the icon before the release gate.' },
  { id: 'finding-wave-edit', nodeId: 'animation-wave', state: 'review', title: 'Wave was edited after the last checkpoint', detail: 'The derivative is allowed, but the animator should confirm the new curves and provenance.' },
  { id: 'finding-controller-change', nodeId: 'tour-controller', state: 'review', title: 'Animation references changed', detail: 'TourController now references Running in addition to Walking; this is a dependency change, not a similarity verdict.' },
];

export const robloxProjectSnapshot = {
  id: 'demo:northwind-museum:18',
  name: 'Northwind Museum',
  release: '2.4 RC',
  capturedAt: 'Live Studio state · simulated',
  totals: { instances: 427, evidenceAssets: 68, animations: 14, scripts: 4, unresolved: 3 },
};
