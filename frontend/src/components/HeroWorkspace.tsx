import { Check, Fingerprint, Link2, Pause, Play, ScanSearch, ShieldCheck } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';
import './HeroWorkspace.premium.css';

type RigTraceProps = {
  variant: 'source' | 'candidate';
};

function RigTrace({ variant }: RigTraceProps) {
  const source = variant === 'source';

  return (
    <svg className="cf-proof-rig" viewBox="0 0 78 46" role="img" aria-label={source ? 'Source animation joint trace' : 'Candidate animation joint trace'}>
      <path className="cf-proof-rig-axis" d="M4 40.5H74M10 5V41" />
      <path
        className="cf-proof-rig-ghost"
        d={source ? 'M15 34L24 24L34 27L43 14L55 17L66 8' : 'M15 33L25 25L34 28L44 15L55 18L66 9'}
      />
      <path
        className="cf-proof-rig-line"
        d={source ? 'M15 32L24 22L34 25L43 12L55 15L66 6' : 'M15 31L25 23L34 26L44 13L55 16L66 7'}
      />
      {[15, 25, 34, 44, 55, 66].map((x, index) => (
        <circle key={x} className="cf-proof-rig-joint" cx={x} cy={source ? [32, 22, 25, 12, 15, 6][index] : [31, 23, 26, 13, 16, 7][index]} r="1.8" />
      ))}
    </svg>
  );
}

function StepMark({ state }: { state: 'done' | 'active' | 'review' }) {
  return (
    <span className={`cf-proof-step-mark is-${state}`} aria-hidden="true">
      {state === 'done' ? <Check size={11} strokeWidth={2.3} /> : null}
    </span>
  );
}

export function HeroWorkspace() {
  const [paused, setPaused] = useState(false);
  const [permissionRecorded, setPermissionRecorded] = useState(false);
  const reduceMotion = useReducedMotion();
  const progress = permissionRecorded ? 100 : paused ? 58 : 76;

  return (
    <div className="hero-workspace-wrap cf-proof-wrap" aria-label="CreatorFlow Roblox animation proof workflow preview">
      <motion.section
        className={`cf-proof-machine${paused ? ' is-paused' : ''}${permissionRecorded ? ' is-ready' : ''}`}
        initial={reduceMotion ? false : { opacity: 0, y: 18, filter: 'blur(7px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.68, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
      >
        <header className="cf-proof-commandbar">
          <div className="cf-proof-link-state">
            <i aria-hidden="true" />
            <span>Studio bridge</span>
            <strong>{paused ? 'Paused' : 'Local link active'}</strong>
          </div>
          <div className="cf-proof-project">
            <span>Neon District</span>
            <b>/</b>
            <strong>Movement Pack · RC-04</strong>
          </div>
          <button type="button" className="cf-proof-pause" aria-pressed={paused} onClick={() => setPaused((current) => !current)}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? 'Resume proof' : 'Pause'}
          </button>
        </header>

        <div className="cf-proof-titlebar">
          <div>
            <span className="cf-proof-register">Animation proof / local evidence</span>
            <h2>One ribbon from Roblox asset to release decision.</h2>
          </div>
          <div className="cf-proof-progress" aria-label={`${progress}% of evidence path complete`}>
            <span><b style={{ width: `${progress}%` }} /></span>
            <strong>{progress}%</strong>
          </div>
        </div>

        <ol className="cf-proof-ribbon" aria-label="Animation evidence path">
          <li className="cf-proof-step cf-proof-step-source">
            <header>
              <StepMark state="done" />
              <span>Animation IDs</span>
              <small>Ingested</small>
            </header>
            <div className="cf-proof-source-stack">
              <div>
                <RigTrace variant="source" />
                <span><b>Source</b><code>14279384219</code></span>
              </div>
              <div>
                <RigTrace variant="candidate" />
                <span><b>Candidate</b><code>14279384601</code></span>
              </div>
            </div>
          </li>

          <li className="cf-proof-step">
            <header>
              <StepMark state="done" />
              <span>Normalize joints</span>
              <small>Local</small>
            </header>
            <div className="cf-proof-measure">
              <ScanSearch size={24} strokeWidth={1.35} />
              <strong>R15 → canonical</strong>
              <dl>
                <div><dt>Joints</dt><dd>15</dd></div>
                <div><dt>Rate</dt><dd>30 fps</dd></div>
                <div><dt>Window</dt><dd>2.46 s</dd></div>
              </dl>
            </div>
          </li>

          <li className="cf-proof-step">
            <header>
              <StepMark state={permissionRecorded ? 'done' : paused ? 'review' : 'active'} />
              <span>Motion fingerprint</span>
              <small>{paused ? 'Held' : 'Matched'}</small>
            </header>
            <div className="cf-proof-fingerprint">
              <Fingerprint size={34} strokeWidth={1.1} />
              <code>8F41·2B77·A90E</code>
              <span><strong>91.8%</strong> joint-path similarity</span>
              <i aria-hidden="true"><b /><b /><b /><b /><b /><b /><b /><b /><b /><b /></i>
            </div>
          </li>

          <li className="cf-proof-step">
            <header>
              <StepMark state={permissionRecorded ? 'done' : 'review'} />
              <span>Source + permission</span>
              <small>{permissionRecorded ? 'Recorded' : 'Needs owner'}</small>
            </header>
            <div className="cf-proof-rights">
              <Link2 size={22} strokeWidth={1.4} />
              <span><strong>Friend team library</strong><small>Creator-owned source located</small></span>
              <button type="button" aria-pressed={permissionRecorded} onClick={() => setPermissionRecorded((current) => !current)}>
                {permissionRecorded ? <><Check size={12} /> Permission attached</> : 'Record demo permission'}
              </button>
            </div>
          </li>

          <li className="cf-proof-step cf-proof-step-decision">
            <header>
              <StepMark state={permissionRecorded ? 'done' : 'review'} />
              <span>Release gate</span>
              <small>Human decision</small>
            </header>
            <div className="cf-proof-decision">
              <ShieldCheck size={29} strokeWidth={1.3} />
              <strong>{permissionRecorded ? 'Ready' : 'Review'}</strong>
              <span>{permissionRecorded ? 'Permission and comparison recorded' : 'Attach permission before manifest export'}</span>
            </div>
          </li>
        </ol>

        <footer className="cf-proof-footer">
          <div className="cf-proof-local-boundary">
            <span aria-hidden="true"><i /></span>
            <p><strong>Creative payload stays in Studio.</strong> CreatorFlow receives normalized fingerprints and evidence records—not animation keyframes.</p>
          </div>
          <div className="cf-proof-actions">
            <span>Demo evidence · not a live Roblox verdict</span>
            <a href="#workspace?view=motion">Inspect animation evidence <span aria-hidden="true">↗</span></a>
          </div>
        </footer>
      </motion.section>
    </div>
  );
}
