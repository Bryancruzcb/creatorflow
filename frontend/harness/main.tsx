/**
 * Visual harness for surfaces the normal build cannot show.
 *
 * The `.local-*` views are gated on a live desktop bridge (`activeLocal && bridgeClient` in
 * ProductWorkspace), so they never render in `npm run preview`, never render on the deployed
 * site, and are invisible to Playwright against the real app. That gap is not academic: a
 * type-scale pass on that surface shipped a headline pinned at 12px by a specificity collision
 * while every reading of the source said 16px, and only computed style on a live element caught
 * it. This exists so those surfaces can be rendered, measured and audited like any other.
 *
 * It is NOT part of the product build — `vite.harness.config.ts` is a separate root, and nothing
 * here is imported by `src/main.tsx`.
 *
 * Add a scene whenever a surface cannot be reached from the deployed app.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LocalEvidenceView, LocalProjectOverview, LocalReleasesView, LocalScanView, LocalSourcesBoundary,
} from '../src/components/LocalProjectWorkspace';
import { project, run, stubClient } from './fixtures';
import '../src/styles/index.css';

const client = stubClient();
const noop = () => undefined;

const scenes: Record<string, { label: string; render: () => JSX.Element }> = {
  evidence: {
    label: 'Local evidence + ownership',
    render: () => <LocalEvidenceView client={client} project={project} initialSelectedAssetId={501} />,
  },
  overview: {
    label: 'Local project overview',
    render: () => (
      <LocalProjectOverview
        client={client} project={project} run={run}
        onOpenRun={noop} onOpenEvidence={noop} onExperienceBound={noop}
      />
    ),
  },
  scan: {
    label: 'Local scan',
    render: () => <LocalScanView client={client} project={project} onRunChange={noop} onOpenEvidence={noop} />,
  },
  releases: {
    label: 'Local releases',
    render: () => <LocalReleasesView client={client} project={project} run={run} />,
  },
  sources: {
    label: 'Sources boundary',
    render: () => <LocalSourcesBoundary onOpenEvidence={noop} />,
  },
};

function Harness() {
  const initial = new URLSearchParams(location.search).get('scene') ?? 'evidence';
  const [scene, setScene] = useState(scenes[initial] ? initial : 'evidence');
  const select = (id: string) => {
    setScene(id);
    const url = new URL(location.href);
    url.searchParams.set('scene', id);
    history.replaceState(null, '', url);
  };
  return (
    <div className="workspace-shell" style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
      {/* data-harness-chrome marks everything that is scaffolding rather than product, so audits
          can exclude it without excluding the surface under test. */}
      <nav data-harness-chrome style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        {Object.entries(scenes).map(([id, s]) => (
          <button
            key={id} type="button" onClick={() => select(id)} aria-current={scene === id}
            style={{
              padding: '.4rem .7rem', font: 'inherit', fontSize: '14px', cursor: 'pointer',
              background: scene === id ? '#2c3540' : 'transparent',
              color: '#e6e8e3', border: '1px solid #3a4450',
            }}
          >{s.label}</button>
        ))}
      </nav>
      <main data-harness-scene={scene}>{scenes[scene].render()}</main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>);

export const SCENE_IDS = Object.keys(scenes);
