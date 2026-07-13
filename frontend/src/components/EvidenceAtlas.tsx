import {
  Box,
  Check,
  FileJson2,
  Fingerprint,
  GitFork,
  Scale,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import { useState } from 'react';

type AtlasView = 'resolved' | 'gap';
type AtlasStage = {
  id: string;
  index: string;
  eyebrow: string;
  title: string;
  meta: string;
  detail: string;
  status: 'project' | 'machine' | 'source' | 'decision' | 'release' | 'blocked';
  icon: typeof Box;
};

const baseStages: AtlasStage[] = [
  {
    id: 'project',
    index: '01',
    eyebrow: 'Project asset',
    title: 'avocado_foodstudy_v02.glb',
    meta: '7.7 MB · GLB',
    detail: 'CreatorFlow indexes the file locally and keeps the project path, size, type, and first-seen record together.',
    status: 'project',
    icon: Box,
  },
  {
    id: 'finding',
    index: '02',
    eyebrow: 'Automated evidence',
    title: '99% match confidence',
    meta: 'Geometry match · material delta',
    detail: 'The confidence score says the records are strongly related; it does not mean only 1% of pixels changed. The material grade and container hash are reported separately.',
    status: 'machine',
    icon: Fingerprint,
  },
  {
    id: 'source',
    index: '03',
    eyebrow: 'Source + permission',
    title: 'Khronos upstream GLB',
    meta: 'CC0 1.0 · public record',
    detail: 'The source page, original SHA-256, license text, and repository distribution record form one evidence chain—not three ownership claims.',
    status: 'source',
    icon: GitFork,
  },
  {
    id: 'decision',
    index: '04',
    eyebrow: 'Human decision',
    title: 'Source attached',
    meta: 'M. Chen · approved',
    detail: 'A reviewer confirms the match, attaches the CC0 record, and records why the derivative is permitted to ship.',
    status: 'decision',
    icon: UserCheck,
  },
  {
    id: 'release',
    index: '05',
    eyebrow: 'Release output',
    title: 'Manifest 1.2',
    meta: 'Ready · evidence carried forward',
    detail: 'The exported manifest carries the project hash, upstream record, license, automated findings, and human decision into the release package.',
    status: 'release',
    icon: FileJson2,
  },
];

const gapStages: AtlasStage[] = baseStages.map((stage) => {
  if (stage.id === 'decision') {
    return {
      ...stage,
      title: 'License evidence missing',
      meta: 'Unassigned · action required',
      detail: 'The visual match is strong, but no permission record is attached. A fingerprint cannot establish the right to ship.',
      status: 'blocked',
      icon: ShieldAlert,
    };
  }
  if (stage.id === 'release') {
    return {
      ...stage,
      title: 'Release blocked',
      meta: 'Manifest incomplete',
      detail: 'CreatorFlow preserves the unresolved finding and prevents the release record from being presented as ready.',
      status: 'blocked',
      icon: Scale,
    };
  }
  return stage;
});

export function EvidenceAtlas() {
  const [view, setView] = useState<AtlasView>('resolved');
  const stages = view === 'resolved' ? baseStages : gapStages;
  const [selectedId, setSelectedId] = useState('finding');
  const selected = stages.find((stage) => stage.id === selectedId) ?? stages[1];

  return (
    <div className={`evidence-atlas evidence-atlas-${view}`}>
      <div className="atlas-toolbar">
        <div>
          <span>Release chain · real Avocado example</span>
          <strong>{view === 'resolved' ? '5 / 5 stages connected' : '3 / 5 stages connected'}</strong>
        </div>
        <div className="atlas-view-switch" aria-label="Evidence map scenario">
          <button type="button" className={view === 'resolved' ? 'selected' : ''} onClick={() => setView('resolved')} aria-pressed={view === 'resolved'}><Check size={13} /> Resolved path</button>
          <button type="button" className={view === 'gap' ? 'selected' : ''} onClick={() => setView('gap')} aria-pressed={view === 'gap'}><ShieldAlert size={13} /> Missing license</button>
        </div>
      </div>

      <div className="atlas-pipeline-scroll">
        <ol className="atlas-pipeline">
          {stages.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <li key={stage.id} className={`atlas-stage atlas-stage-${stage.status}`}>
                <button type="button" onClick={() => setSelectedId(stage.id)} className={selected.id === stage.id ? 'selected' : ''} aria-pressed={selected.id === stage.id}>
                  <span className="atlas-stage-index">{stage.index}</span>
                  <span className="atlas-stage-icon"><Icon size={18} /></span>
                  <span className="atlas-stage-copy">
                    <small>{stage.eyebrow}</small>
                    <strong>{stage.title}</strong>
                    <em>{stage.meta}</em>
                  </span>
                </button>
                {index < stages.length - 1 ? <span className="atlas-connector" aria-hidden="true"><i /></span> : null}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="atlas-detail" aria-live="polite">
        <div className={`atlas-detail-mark atlas-detail-${selected.status}`}><selected.icon size={19} /></div>
        <div>
          <span>{selected.index} / {selected.eyebrow}</span>
          <strong>{selected.title}</strong>
          <p>{selected.detail}</p>
        </div>
        <code>{selected.id === 'finding' ? '5d36ed…15af7' : selected.id === 'source' ? 'ccc9c3…3abd4' : view === 'gap' && selected.id === 'release' ? 'BLOCKED' : 'CONNECTED'}</code>
      </div>
    </div>
  );
}
