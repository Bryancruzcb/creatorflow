import { FileArchive, FlaskConical, FolderOpen } from 'lucide-react';
import './WorkspaceDatasetBanner.css';

export type DatasetMode = 'sample' | 'local' | 'imported';

const COPY = {
  sample: {
    tag: 'Sample scenario',
    icon: FlaskConical,
    detail: 'Licensed sample assets — not your files.',
  },
  local: {
    tag: 'Your project',
    icon: FolderOpen,
    detail: 'Scanned on this machine. Only fingerprints leave it.',
  },
  imported: {
    tag: 'Imported manifest',
    icon: FileArchive,
    detail: 'Read-only snapshot from a scan file.',
  },
} as const;

/**
 * A persistent, unmissable statement of where the data on screen comes from, so nothing in the
 * workspace can be mistaken for the user's real project (or dismissed as random filler). Every
 * view renders this above its content.
 */
export function WorkspaceDatasetBanner({ mode, projectName, release, onSwitch }: {
  mode: DatasetMode;
  projectName: string;
  release?: string;
  onSwitch?: () => void;
}) {
  const copy = COPY[mode];
  const Icon = copy.icon;
  const title = mode === 'sample'
    ? projectName
    : mode === 'imported'
      ? `${projectName}${release ? ` · ${release}` : ''}`
      : projectName;

  return (
    <aside className={`workspace-dataset-banner mode-${mode}`} aria-label={`Active dataset: ${copy.tag}. ${title}`}>
      <span className="workspace-dataset-badge"><Icon size={14} aria-hidden="true" /> {copy.tag}</span>
      <div className="workspace-dataset-copy">
        <strong>{title}</strong>
        <small>{copy.detail}</small>
      </div>
      {onSwitch ? (
        <button type="button" className="workspace-dataset-switch" onClick={onSwitch}>
          Switch project
        </button>
      ) : null}
    </aside>
  );
}
