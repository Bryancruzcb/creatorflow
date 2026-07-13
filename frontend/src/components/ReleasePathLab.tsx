import {
  Activity,
  ArrowRight,
  Boxes,
  Check,
  CircleDashed,
  Columns3,
  ExternalLink,
  Fingerprint,
  FlaskConical,
  ListTree,
  LockKeyhole,
  Move,
  Network,
  PackageCheck,
  RotateCcw,
  ShieldAlert,
  TestTube2,
  Users,
  Workflow,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useWorkspacePreferences } from '../preferences/workspacePreferences';
import './ReleasePathLab.premium.css';

export type ReleaseDestination = 'project' | 'assets' | 'motion' | 'stress' | 'evidence' | 'sources' | 'releases';

type ReleaseMode = 'guided' | 'map' | 'compare';
type ReleaseState = 'clear' | 'active' | 'blocked' | 'ready' | 'locked';
type ReleaseOwner = 'Team' | 'CreatorFlow' | 'Roblox';
type ReleasePreference = Exclude<ReleaseMode, 'compare'>;
type Point = { x: number; y: number };

type ReleaseStage = {
  id: string;
  order: number;
  phase: 'Prepare' | 'Prove' | 'Validate' | 'Roblox handoff';
  title: string;
  shortTitle: string;
  summary: string;
  why: string;
  exit: string;
  state: ReleaseState;
  owner: ReleaseOwner;
  surface: string;
  needs: string[];
  blocker?: string;
  route?: ReleaseDestination;
  href?: string;
  action: string;
  icon: typeof Workflow;
  position: Point;
};

type ReleaseEdge = { from: string; to: string };

const stages: ReleaseStage[] = [
  {
    id: 'candidate',
    order: 1,
    phase: 'Prepare',
    title: 'Define the release candidate',
    shortTitle: 'Release candidate',
    summary: 'Name the build, owner, target place, supported devices, audience, and version note.',
    why: 'Every later check needs to point at one exact candidate instead of a moving Studio project.',
    exit: 'Northwind 2.4 RC is tied to a place, owner, device set, Limited audience, and version note.',
    state: 'clear',
    owner: 'Team',
    surface: 'Release brief',
    needs: [],
    route: 'releases',
    action: 'Open release record',
    icon: PackageCheck,
    position: { x: 9, y: 47 },
  },
  {
    id: 'scan',
    order: 2,
    phase: 'Prepare',
    title: 'Scan the local project snapshot',
    shortTitle: 'Local scan',
    summary: 'Inventory files, hashes, package references, and stable project-relative paths without uploading content.',
    why: 'The evidence gate needs a repeatable snapshot of what the team actually intends to ship.',
    exit: 'A deterministic local manifest identifies the candidate and every supported file inspected by CreatorFlow.',
    state: 'clear',
    owner: 'CreatorFlow',
    surface: 'Evidence',
    needs: ['candidate'],
    route: 'evidence',
    action: 'Inspect scan evidence',
    icon: Fingerprint,
    position: { x: 26, y: 47 },
  },
  {
    id: 'rights',
    order: 3,
    phase: 'Prove',
    title: 'Resolve source and asset access',
    shortTitle: 'Rights + access',
    summary: 'Attach ownership or license records and confirm restricted assets can load for this experience.',
    why: 'A fingerprint can show a relationship, but it cannot prove permission or grant an experience access to a private asset.',
    exit: 'Every required mesh, image, audio, package, and animation has a source decision and usable access state.',
    state: 'blocked',
    owner: 'Team',
    surface: 'Sources + Creator Dashboard',
    needs: ['scan'],
    blocker: 'Two restricted asset records still need an experience grant or a documented replacement.',
    route: 'sources',
    action: 'Review source records',
    icon: ShieldAlert,
    position: { x: 44, y: 13 },
  },
  {
    id: 'motion',
    order: 4,
    phase: 'Prove',
    title: 'Review important animations',
    shortTitle: 'Animation evidence',
    summary: 'Compare permitted Roblox animation IDs, normalize joint tracks, and keep fingerprints with the local record.',
    why: 'Animation evidence gives the animator a focused place to investigate suspicious similarity before a release decision.',
    exit: 'The animator has reviewed the candidate pair and recorded match, exclusion, ownership, or permission context.',
    state: 'active',
    owner: 'CreatorFlow',
    surface: 'Animation compare',
    needs: ['scan'],
    blocker: 'Animator sign-off is the recommended next action for this prototype.',
    route: 'motion',
    action: 'Open animation compare',
    icon: Activity,
    position: { x: 44, y: 36 },
  },
  {
    id: 'validation',
    order: 5,
    phase: 'Prove',
    title: 'Validate project assets and packages',
    shortTitle: 'Project validation',
    summary: 'Check project dependencies, malformed files, texture pressure, and delivery formats against this candidate.',
    why: 'The bundled Stress Lab proves CreatorFlow can contain difficult fixtures; a release result must eventually run against the team project.',
    exit: 'Project-connected checks produce evidence for dependencies, failures, decoded cost, and supported formats.',
    state: 'ready',
    owner: 'CreatorFlow',
    surface: 'Stress Lab prototype',
    needs: ['scan'],
    route: 'stress',
    action: 'Understand the fixture lab',
    icon: FlaskConical,
    position: { x: 44, y: 59 },
  },
  {
    id: 'playtest',
    order: 6,
    phase: 'Validate',
    title: 'Run Studio and Team Test',
    shortTitle: 'Studio + Team Test',
    summary: 'Exercise client/server behavior, multiplayer, supported controls, and real collaborator flows.',
    why: 'Roblox experiences are client-server systems; a local evidence scan cannot establish that gameplay works in every test mode.',
    exit: 'The team records Test, Server & Clients, Team Test, and supported-device results for this candidate.',
    state: 'ready',
    owner: 'Team',
    surface: 'Roblox Studio',
    needs: ['candidate', 'scan'],
    href: 'https://create.roblox.com/docs/studio/testing-modes',
    action: 'Open Studio testing guide',
    icon: Users,
    position: { x: 44, y: 84 },
  },
  {
    id: 'performance',
    order: 7,
    phase: 'Validate',
    title: 'Check device and runtime budgets',
    shortTitle: 'Runtime budgets',
    summary: 'Review memory, load behavior, frame pacing, and network conditions on the devices the release supports.',
    why: 'Transfer size and browser fixture timings are useful evidence, but they are not Roblox client performance results.',
    exit: 'The team accepts or waives candidate-specific budgets with the device and test conditions recorded.',
    state: 'locked',
    owner: 'Team',
    surface: 'Studio + devices',
    needs: ['validation', 'playtest'],
    action: 'Complete prerequisites first',
    icon: TestTube2,
    position: { x: 61, y: 72 },
  },
  {
    id: 'audience',
    order: 8,
    phase: 'Validate',
    title: 'Confirm audience and compliance',
    shortTitle: 'Audience + compliance',
    summary: 'Confirm maturity, intended reach, owner permissions, and whether the rollout is Private, Limited, Beta, or Public.',
    why: 'Roblox publishing requirements and discoverability change with the intended audience and experience ownership.',
    exit: 'The candidate has an approved audience, compliance answers, and a clear rollout target.',
    state: 'ready',
    owner: 'Team',
    surface: 'Creator Dashboard',
    needs: ['candidate'],
    href: 'https://create.roblox.com/docs/production/publishing/publish-games-and-places',
    action: 'Open publishing requirements',
    icon: Boxes,
    position: { x: 61, y: 18 },
  },
  {
    id: 'gate',
    order: 9,
    phase: 'Validate',
    title: 'Make the human release decision',
    shortTitle: 'CreatorFlow gate',
    summary: 'Review every required result, explicitly waive exceptions, and export a PASS or BLOCKED evidence record.',
    why: 'CreatorFlow organizes evidence and blockers; it does not silently turn similarity scores into ownership or shipping decisions.',
    exit: 'Rights, animation, validation, playtest, performance, and audience decisions are complete or explicitly waived.',
    state: 'locked',
    owner: 'CreatorFlow',
    surface: 'Evidence review',
    needs: ['rights', 'motion', 'performance', 'audience'],
    blocker: 'Rights and animation decisions are unresolved; runtime budgets have not run.',
    route: 'evidence',
    action: 'Review current evidence',
    icon: Workflow,
    position: { x: 72, y: 43 },
  },
  {
    id: 'publish',
    order: 10,
    phase: 'Roblox handoff',
    title: 'Hand off to Roblox publishing',
    shortTitle: 'Roblox publish handoff',
    summary: 'Take the approved evidence record into Studio or Creator Dashboard, publish the place version, and choose how outdated servers transition.',
    why: 'CreatorFlow prepares the candidate and its evidence. This prototype never calls Roblox publishing APIs or changes the experience audience.',
    exit: 'The team records the returned Roblox place version, intended audience, version note, and rollout choice.',
    state: 'locked',
    owner: 'Roblox',
    surface: 'Studio + Creator Dashboard',
    needs: ['gate'],
    href: 'https://create.roblox.com/docs/production/publishing/publish-games-and-places',
    action: 'Open Roblox publishing guide',
    icon: LockKeyhole,
    position: { x: 90, y: 43 },
  },
  {
    id: 'monitor',
    order: 11,
    phase: 'Roblox handoff',
    title: 'Monitor, restore, or roll forward',
    shortTitle: 'Monitor + rollback',
    summary: 'Track the live version, decide how servers update, and keep a known-good version ready to restore.',
    why: 'A release path is incomplete if the team cannot identify what shipped or recover from a bad version.',
    exit: 'The live version, server transition, evidence manifest, and rollback checkpoint are recorded together.',
    state: 'locked',
    owner: 'Roblox',
    surface: 'Version History',
    needs: ['publish'],
    href: 'https://create.roblox.com/docs/projects/version-history',
    action: 'Open version history guide',
    icon: RotateCcw,
    position: { x: 90, y: 77 },
  },
];

const edges: ReleaseEdge[] = [
  { from: 'candidate', to: 'scan' },
  { from: 'candidate', to: 'audience' },
  { from: 'scan', to: 'rights' },
  { from: 'scan', to: 'motion' },
  { from: 'scan', to: 'validation' },
  { from: 'scan', to: 'playtest' },
  { from: 'validation', to: 'performance' },
  { from: 'playtest', to: 'performance' },
  { from: 'rights', to: 'gate' },
  { from: 'motion', to: 'gate' },
  { from: 'performance', to: 'gate' },
  { from: 'audience', to: 'gate' },
  { from: 'gate', to: 'publish' },
  { from: 'publish', to: 'monitor' },
];

const phaseOrder: ReleaseStage['phase'][] = ['Prepare', 'Prove', 'Validate', 'Roblox handoff'];
const defaultPositions = Object.fromEntries(stages.map((stage) => [stage.id, stage.position])) as Record<string, Point>;

const stateCopy: Record<ReleaseState, string> = {
  clear: 'Clear',
  active: 'In review',
  blocked: 'Blocked',
  ready: 'Ready to start',
  locked: 'Waiting',
};

const proofCheckpoints = [
  { stageId: 'scan', label: 'Fingerprint', detail: 'Local snapshot', signal: 'CLEAR' },
  { stageId: 'rights', label: 'Source', detail: 'Rights + access', signal: 'BLOCKED' },
  { stageId: 'motion', label: 'Animation', detail: 'Animator review', signal: 'IN REVIEW' },
  { stageId: 'gate', label: 'Decision', detail: 'Human release gate', signal: 'WAITING' },
  { stageId: 'publish', label: 'Roblox', detail: 'Studio handoff', signal: 'EXTERNAL' },
] as const;

function readPositions() {
  try {
    const saved = JSON.parse(window.localStorage.getItem('creatorflow:release-map') ?? '{}') as Record<string, Point>;
    return Object.fromEntries(stages.map((stage) => {
      const point = saved[stage.id];
      const valid = point && Number.isFinite(point.x) && Number.isFinite(point.y);
      return [stage.id, valid ? point : stage.position];
    })) as Record<string, Point>;
  } catch {
    return defaultPositions;
  }
}

function StageState({ state }: { state: ReleaseState }) {
  return (
    <span className={`release-stage-state release-stage-state-${state}`}>
      {state === 'clear' ? <Check size={13} /> : state === 'blocked' ? <ShieldAlert size={13} /> : state === 'locked' ? <LockKeyhole size={12} /> : <CircleDashed size={13} />}
      {stateCopy[state]}
    </span>
  );
}

function StageAction({ stage, onNavigate, compact = false }: { stage: ReleaseStage; onNavigate: (view: ReleaseDestination) => void; compact?: boolean }) {
  if (stage.route) {
    return <button className="release-stage-action" type="button" onClick={() => onNavigate(stage.route!)}>{compact ? 'Open' : stage.action}<ArrowRight size={12} /></button>;
  }
  if (stage.href) {
    return <a className="release-stage-action" href={stage.href} target="_blank" rel="noreferrer">{compact ? 'Guide' : stage.action}<ExternalLink size={12} /></a>;
  }
  return <span className="release-stage-action release-stage-action-disabled">{compact ? 'Waiting' : stage.action}</span>;
}

function GuidedPath({ selectedId, onSelect, onNavigate, compact = false }: { selectedId: string; onSelect: (id: string) => void; onNavigate: (view: ReleaseDestination) => void; compact?: boolean }) {
  return (
    <div className={`guided-release-path${compact ? ' guided-release-path-compact' : ''}`}>
      {phaseOrder.map((phase) => {
        const phaseStages = stages.filter((stage) => stage.phase === phase);
        const clearCount = phaseStages.filter((stage) => stage.state === 'clear').length;
        return (
          <section className="release-phase" key={phase}>
            <header><span>{phase}</span><small>{clearCount} / {phaseStages.length} clear</small></header>
            <ol>
              {phaseStages.map((stage) => (
                <li key={stage.id} className={selectedId === stage.id ? 'selected' : ''} data-state={stage.state}>
                  {selectedId === stage.id ? <motion.i className="release-guided-selection" layoutId={compact ? 'release-guided-selection-compact' : 'release-guided-selection'} transition={{ type: 'spring', stiffness: 390, damping: 36 }} /> : null}
                  <span className="release-stage-number">{String(stage.order).padStart(2, '0')}</span>
                  <button className="release-stage-select" type="button" onClick={() => onSelect(stage.id)} aria-pressed={selectedId === stage.id}>
                    <span><strong>{stage.title}</strong><small>{stage.summary}</small></span>
                    {!compact ? <em>{stage.owner} · {stage.surface}</em> : null}
                  </button>
                  <StageState state={stage.state} />
                  {!compact ? <StageAction stage={stage} onNavigate={onNavigate} compact={compact} /> : null}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function ReleaseMap({ positions, onPositionsChange, selectedId, onSelect, compact = false }: { positions: Record<string, Point>; onPositionsChange: (positions: Record<string, Point>) => void; selectedId: string; onSelect: (id: string) => void; compact?: boolean }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; pointerId: number; startX: number; startY: number; origin: Point; moved: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  function moveStage(id: string, next: Point, announce = false) {
    const clamped = { x: Math.min(94, Math.max(6, next.x)), y: Math.min(91, Math.max(9, next.y)) };
    onPositionsChange({ ...positions, [id]: clamped });
    if (announce) setAnnouncement(`${stages.find((stage) => stage.id === id)?.shortTitle ?? 'Stage'} moved to ${Math.round(clamped.x)}, ${Math.round(clamped.y)}.`);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0) return;
    const origin = positions[id];
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, moved: false };
    onSelect(id);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !bounds) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    moveStage(drag.id, { x: drag.origin.x + (dx / bounds.width) * 100, y: drag.origin.y + (dy / bounds.height) * 100 });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (dragRef.current.moved) setAnnouncement(`${stages.find((stage) => stage.id === dragRef.current?.id)?.shortTitle ?? 'Stage'} layout position saved locally.`);
    dragRef.current = null;
  }

  function onNodeKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 4 : 2;
    const point = positions[id];
    moveStage(id, {
      x: point.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0),
      y: point.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0),
    }, true);
  }

  return (
    <div className={`release-map-shell${compact ? ' release-map-shell-compact' : ''}`}>
      <div className="release-map-help"><span><Move size={13} /> Arrange the shared stages · Alt + arrow keys also move</span><small>Positions are personal. Dependencies and release states never change.</small></div>
      <div className="release-map-scroll">
        <div className="release-map-canvas" ref={canvasRef} role="group" aria-label="Draggable Roblox release dependency map">
          <svg className="release-map-edges" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs><marker id={`release-arrow-${compact ? 'compact' : 'full'}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" /></marker></defs>
            {edges.map((edge) => {
              const from = positions[edge.from];
              const to = positions[edge.to];
              const targetState = stages.find((stage) => stage.id === edge.to)?.state ?? 'locked';
              const active = edge.from === selectedId || edge.to === selectedId;
              return <line key={`${edge.from}-${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} data-state={targetState} data-active={active ? 'true' : undefined} markerEnd={`url(#release-arrow-${compact ? 'compact' : 'full'})`} vectorEffect="non-scaling-stroke" />;
            })}
          </svg>
          {stages.map((stage) => {
            const Icon = stage.icon;
            const position = positions[stage.id];
            return (
              <button
                className={`release-map-node${selectedId === stage.id ? ' selected' : ''}`}
                data-state={stage.state}
                data-owner={stage.owner.toLowerCase()}
                key={stage.id}
                type="button"
                style={{ left: `${position.x}%`, top: `${position.y}%` }}
                onClick={() => onSelect(stage.id)}
                onPointerDown={(event) => onPointerDown(event, stage.id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={(event) => onNodeKeyDown(event, stage.id)}
                aria-pressed={selectedId === stage.id}
                aria-label={`${stage.order}. ${stage.title}. ${stateCopy[stage.state]}. Owner ${stage.owner}.`}
              >
                {selectedId === stage.id ? <motion.i className="release-map-selection" layoutId={compact ? 'release-map-selection-compact' : 'release-map-selection'} transition={{ type: 'spring', stiffness: 390, damping: 36 }} /> : null}
                <span><Icon size={14} /><small>{String(stage.order).padStart(2, '0')}</small><Move className="release-map-grip" size={12} /></span>
                <strong>{stage.shortTitle}</strong>
                <em>{stateCopy[stage.state]} · {stage.owner}</em>
              </button>
            );
          })}
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </div>
  );
}

function ReleaseProofRibbon({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  return (
    <section className="release-proof-ribbon" aria-label="Northwind sample proof ribbon">
      <div className="release-proof-ribbon-heading">
        <span>Shared release record</span>
        <strong>Northwind 2.4 RC</strong>
        <small>Guide and Map read these same sample states</small>
      </div>
      <ol>
        {proofCheckpoints.map((checkpoint, index) => {
          const stage = stages.find((item) => item.id === checkpoint.stageId)!;
          const Icon = stage.icon;
          const active = selectedId === stage.id;
          return (
            <li key={stage.id} data-state={stage.state}>
              <button type="button" onClick={() => onSelect(stage.id)} aria-current={active ? 'step' : undefined}>
                {active ? <motion.span className="release-proof-cursor" layoutId="release-proof-cursor" transition={{ type: 'spring', stiffness: 390, damping: 36 }} /> : null}
                <i><Icon size={14} /><em>{String(index + 1).padStart(2, '0')}</em></i>
                <span><strong>{checkpoint.label}</strong><small>{checkpoint.detail}</small></span>
                <b>{checkpoint.signal}</b>
              </button>
            </li>
          );
        })}
      </ol>
      <button className={`release-manifest-fold${selectedId === 'publish' ? ' is-handoff' : ''}`} type="button" onClick={() => onSelect('publish')} aria-pressed={selectedId === 'publish'} aria-label="Inspect the Roblox publishing handoff">
        <span className="release-manifest-face release-manifest-front"><small>CREATORFLOW / PROOF PACK</small><strong>2.4 RC</strong><em>BLOCKED · DRAFT</em></span>
        <span className="release-manifest-face release-manifest-back"><small>ROBLOX HANDOFF</small><strong>Studio</strong><em>External action</em></span>
      </button>
    </section>
  );
}

function StageInspector({ stage, onNavigate, onSelect }: { stage: ReleaseStage; onNavigate: (view: ReleaseDestination) => void; onSelect: (id: string) => void }) {
  const needs = stage.needs.map((id) => stages.find((item) => item.id === id)).filter((item): item is ReleaseStage => Boolean(item));
  const unlocks = stages.filter((item) => item.needs.includes(stage.id));
  return (
    <aside className="release-stage-inspector" data-state={stage.state} aria-live="polite">
      <header>
        <span className="release-inspector-icon"><stage.icon size={17} /></span>
        <div><small>Stage {String(stage.order).padStart(2, '0')} · {stage.phase}</small><h2>{stage.title}</h2></div>
        <StageState state={stage.state} />
      </header>
      <div className="release-inspector-body">
        <p>{stage.why}</p>
        {stage.blocker ? <div className="release-blocker"><ShieldAlert size={14} /><span><strong>Current blocker</strong><small>{stage.blocker}</small></span></div> : null}
        <dl>
          <div><dt>Owner</dt><dd>{stage.owner}</dd></div>
          <div><dt>Where</dt><dd>{stage.surface}</dd></div>
          <div><dt>Done when</dt><dd>{stage.exit}</dd></div>
        </dl>
        <div className="release-stage-relations">
          <div className="release-needs"><span>Depends on</span>{needs.length ? needs.map((need) => <button type="button" key={need.id} onClick={() => onSelect(need.id)}>{String(need.order).padStart(2, '0')} {need.shortTitle}</button>) : <small>Starting point</small>}</div>
          <div className="release-unlocks"><span>Unlocks next</span>{unlocks.length ? unlocks.map((item) => <button type="button" key={item.id} onClick={() => onSelect(item.id)}>{String(item.order).padStart(2, '0')} {item.shortTitle}</button>) : <small>End of this path</small>}</div>
        </div>
        <StageAction stage={stage} onNavigate={onNavigate} />
      </div>
    </aside>
  );
}

function ReleaseViewExplainer({ mode }: { mode: ReleaseMode }) {
  if (mode === 'guided') {
    return (
      <div className="release-view-explainer" data-mode="guided">
        <span className="release-view-explainer-icon"><ListTree size={17} /></span>
        <div><strong>Guide is the execution view.</strong><p>Follow a dependency-safe order, see the current blocker, and open the next tool without learning the whole graph first.</p></div>
        <dl><div><dt>Answers</dt><dd>What do I do next?</dd></div><div><dt>Best for</dt><dd>Owners running the release</dd></div></dl>
      </div>
    );
  }

  if (mode === 'map') {
    return (
      <div className="release-view-explainer" data-mode="map">
        <span className="release-view-explainer-icon"><Network size={17} /></span>
        <div><strong>Map is the coordination view.</strong><p>See parallel work, prerequisite branches, and which downstream gates move when one team finishes a stage.</p></div>
        <dl><div><dt>Answers</dt><dd>What can happen in parallel?</dd></div><div><dt>Best for</dt><dd>Teams planning handoffs</dd></div></dl>
      </div>
    );
  }

  return (
    <div className="release-view-explainer" data-mode="compare">
      <span className="release-view-explainer-icon"><Activity size={17} /></span>
      <div><strong>Temporary research mode—not a third workflow.</strong><p>The two panels stay synced to the same release record so a tester can compare comprehension. Choose Guide or Map as the working default when the test ends.</p></div>
      <span className="release-research-tag"><TestTube2 size={12} /> User test</span>
    </div>
  );
}

export function ReleasePathLab({ onNavigate }: { onNavigate: (view: ReleaseDestination) => void }) {
  const { preferences, setPreference: setWorkspacePreference } = useWorkspacePreferences();
  const [mode, setMode] = useState<ReleaseMode>(() => preferences.releaseDefaultView);
  const [selectedId, setSelectedId] = useState('motion');
  const [positions, setPositions] = useState<Record<string, Point>>(readPositions);
  const preference = preferences.releaseDefaultView;
  const workbenchRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const selected = stages.find((stage) => stage.id === selectedId) ?? stages[3];
  const counts = useMemo(() => ({
    clear: stages.filter((stage) => stage.state === 'clear').length,
    blocked: stages.filter((stage) => stage.state === 'blocked' || stage.state === 'active').length,
    team: stages.filter((stage) => stage.owner === 'Team').length,
  }), []);
  const layoutChanged = stages.some((stage) => positions[stage.id].x !== defaultPositions[stage.id].x || positions[stage.id].y !== defaultPositions[stage.id].y);

  useEffect(() => {
    if (mode !== 'compare') setMode(preferences.releaseDefaultView);
  }, [preferences.releaseDefaultView]);
  useEffect(() => {
    try {
      window.localStorage.setItem('creatorflow:release-map', JSON.stringify(positions));
    } catch {
      // Dragging still works for this mounted session when browser storage is unavailable.
    }
  }, [positions]);

  function focusWorkbench() {
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      workbenchRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  }

  function choosePreference(next: ReleasePreference) {
    setWorkspacePreference('releaseDefaultView', next);
    setMode(next);
    focusWorkbench();
  }

  function openResearchCompare() {
    setMode('compare');
    focusWorkbench();
  }

  function resetLayout() {
    setPositions(defaultPositions);
    try {
      window.localStorage.removeItem('creatorflow:release-map');
    } catch {
      // The in-memory reset above is still complete.
    }
  }

  return (
    <div className="release-path-lab">
      <section className="release-flow-hero">
        <div><span className="workspace-kicker">Roblox release preflight · interactive example plan</span><h1>One release record. Two ways to work.</h1><p><strong>Guide</strong> answers “what should I do next?” <strong>Map</strong> answers “what can happen in parallel, and what does this block?” Both read the same 11 stages and evidence states. Side-by-side Compare exists only to test which view your team understands faster.</p></div>
        <button className="button button-primary" type="button" onClick={() => onNavigate('motion')}><Activity size={15} /> Review animation evidence</button>
      </section>

      <section className="release-scope-strip">
        <div><Fingerprint size={16} /><span><strong>CreatorFlow preflight</strong><small>Local scan, evidence, animation review, project checks, and an exportable human gate.</small></span></div>
        <ArrowRight size={15} />
        <div><Users size={16} /><span><strong>Team + Roblox handoff</strong><small>Studio playtests, audience/compliance, publishing, server rollout, and rollback remain explicit external actions.</small></span></div>
      </section>

      <section className="release-publish-clarifier" aria-labelledby="release-publish-clarifier-title">
        <LockKeyhole size={18} />
        <div><span>What “publish” means in this flow</span><h2 id="release-publish-clarifier-title">CreatorFlow creates the release record. Roblox creates the live place version.</h2><p>No button on this prototype uploads an RBXL/RBXLX, changes the experience audience, or restarts servers. The final stage opens Roblox guidance so the team can perform and record that separate action.</p></div>
        <dl><div><dt>Here</dt><dd>Scan · evidence · decisions · manifest</dd></div><div><dt>In Roblox</dt><dd>Publish place · audience · server rollout</dd></div></dl>
        <a href="https://create.roblox.com/docs/production/publishing/publish-games-and-places" target="_blank" rel="noreferrer">Read Roblox publishing requirements <ExternalLink size={13} /></a>
      </section>

      <section className="release-flow-summary" aria-label="Release flow summary">
        <div><strong>{counts.clear} / {stages.length}</strong><small>Stages clear</small></div>
        <div><strong>{counts.blocked}</strong><small>Blocked or in review</small></div>
        <div><strong>{counts.team}</strong><small>Team-owned gates</small></div>
        <div><strong>Limited</strong><small>Planned first audience</small></div>
      </section>

      <ReleaseProofRibbon selectedId={selectedId} onSelect={setSelectedId} />

      <section className="release-flow-workbench" ref={workbenchRef}>
        <header className="release-flow-toolbar">
          <div><span>Working view · shared release data</span><strong>Northwind 2.4 RC</strong></div>
          <div className="release-mode-switch" aria-label="Choose how to view the release record">
            <button type="button" onClick={() => setMode('guided')} aria-pressed={mode === 'guided'}><ListTree size={14} /><span><strong>Guide</strong><small>Next safe action</small></span></button>
            <button type="button" onClick={() => setMode('map')} aria-pressed={mode === 'map'}><Network size={14} /><span><strong>Map</strong><small>Dependencies + impact</small></span></button>
            <button className="release-mode-research" type="button" onClick={() => setMode('compare')} aria-pressed={mode === 'compare'}><Columns3 size={14} /><span><strong>Compare</strong><small>Temporary user test</small></span></button>
          </div>
          <button className="release-reset-layout" type="button" onClick={resetLayout} disabled={!layoutChanged} title={layoutChanged ? 'Restore the authored map layout' : 'Map is already at its default layout'}><RotateCcw size={13} /> {layoutChanged ? 'Reset map' : 'Map at default'}</button>
        </header>

        <ReleaseViewExplainer mode={mode} />

        <AnimatePresence mode="wait" initial={false}>
          {mode === 'guided' ? (
            <motion.div key="guided" className="release-single-layout" initial={reduceMotion ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 10 }} transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.25, 1, 0.5, 1] }}>
              <GuidedPath selectedId={selectedId} onSelect={setSelectedId} onNavigate={onNavigate} />
              <StageInspector stage={selected} onNavigate={onNavigate} onSelect={setSelectedId} />
            </motion.div>
          ) : null}

          {mode === 'map' ? (
            <motion.div key="map" className="release-single-layout release-single-layout-map" initial={reduceMotion ? false : { opacity: 0, scale: 0.992 }} animate={{ opacity: 1, scale: 1 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.995 }} transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.25, 1, 0.5, 1] }}>
              <ReleaseMap positions={positions} onPositionsChange={setPositions} selectedId={selectedId} onSelect={setSelectedId} />
              <StageInspector stage={selected} onNavigate={onNavigate} onSelect={setSelectedId} />
            </motion.div>
          ) : null}

          {mode === 'compare' ? (
            <motion.div key="compare" className="release-compare-layout" initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.25, 1, 0.5, 1] }}>
              <div className="release-compare-notice"><Activity size={14} /><p><strong>Comprehension test:</strong> ask the same three questions in each panel. Selection stays synchronized because these are two views of one release record.</p></div>
              <section><header><span>Working view A</span><strong>Guide</strong><small>Next action · prerequisites · dependency-safe execution</small></header><GuidedPath compact selectedId={selectedId} onSelect={setSelectedId} onNavigate={onNavigate} /></section>
              <section><header><span>Working view B</span><strong>Map</strong><small>Parallel work · topology · downstream impact</small></header><ReleaseMap compact positions={positions} onPositionsChange={setPositions} selectedId={selectedId} onSelect={setSelectedId} /></section>
              <StageInspector stage={selected} onNavigate={onNavigate} onSelect={setSelectedId} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      <section className="release-friend-test">
        <header><div><span>Temporary research mode · 3 minutes</span><h2>Test understanding, then choose one working view.</h2></div><small>Default choice saved only in this browser</small></header>
        <ol>
          <li><span>01</span><p><strong>Find the blocker</strong>What prevents this candidate from reaching a Limited publish?</p></li>
          <li><span>02</span><p><strong>Find parallel work</strong>What can the animator and playtest team do at the same time?</p></li>
          <li><span>03</span><p><strong>Open the right tool</strong>Show where the animator compares two Roblox animation IDs.</p></li>
        </ol>
        <div className="release-preference">
          <span><strong>Choose the team’s default</strong>Which view made those answers clearest?</span>
          <div>
            <button type="button" aria-pressed={preference === 'guided'} onClick={() => choosePreference('guided')}><ListTree size={13} /> Default to Guide</button>
            <button type="button" aria-pressed={preference === 'map'} onClick={() => choosePreference('map')}><Network size={13} /> Default to Map</button>
            <button className="release-research-reopen" type="button" aria-pressed={mode === 'compare'} onClick={openResearchCompare}><Columns3 size={13} /> Run comparison</button>
          </div>
          <small aria-live="polite">{mode === 'compare' ? <><TestTube2 size={12} /> Research view open · choose Guide or Map when finished</> : preference ? <><Check size={12} /> Saved · {preference === 'guided' ? 'Guide' : 'Map'} is the working default</> : 'No default chosen yet.'}</small>
        </div>
      </section>
    </div>
  );
}
