import {
  Activity,
  BatteryMedium,
  Check,
  Database,
  Gauge,
  Monitor,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  useWorkspacePreferences,
  type AnalysisMode,
  type JointScope,
  type MotionSampleCount,
  type PreviewQuality,
  type ReleaseDefaultView,
  type WorkspacePreferences,
} from '../preferences/workspacePreferences';
import './WorkspaceSettingsView.css';

const analysisOptions: Array<{ value: AnalysisMode; label: string; detail: string }> = [
  { value: 'shape', label: 'Motion shape', detail: 'Compare pose order after both clips are mapped to a 0–100% timeline.' },
  { value: 'timing', label: 'Timing drift', detail: 'Compare clips at the same authored second to expose early or late poses.' },
  { value: 'loop', label: 'Loop seam', detail: 'Check whether each clip’s last pose closes cleanly into its first.' },
  { value: 'root', label: 'Root path', detail: 'Compare an available root or body-translation path separately from limb poses.' },
];

const jointOptions: Array<{ value: JointScope; label: string }> = [
  { value: 'full', label: 'Full rig' },
  { value: 'upper', label: 'Upper body' },
  { value: 'lower', label: 'Lower body' },
  { value: 'root', label: 'Root only' },
];

const qualityOptions: Array<{ value: PreviewQuality; label: string; detail: string }> = [
  { value: 'battery', label: 'Battery', detail: 'Lower-cost preview' },
  { value: 'balanced', label: 'Balanced', detail: 'Recommended' },
  { value: 'sharp', label: 'Sharp', detail: 'Higher-detail preview' },
];

const releaseOptions: Array<{ value: ReleaseDefaultView; label: string; detail: string }> = [
  { value: 'guided', label: 'Guided path', detail: 'Open on the next dependency-respecting action.' },
  { value: 'map', label: 'Flexible map', detail: 'Open on parallel work and downstream blockers.' },
];

function ChoiceGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
  compact = false,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; detail?: string }>;
  onChange: (value: T, label: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`workspace-setting-choices${compact ? ' workspace-setting-choices-compact' : ''}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value, option.label)}>
          <strong>{option.label}</strong>
          {option.detail ? <small>{option.detail}</small> : null}
        </button>
      ))}
    </div>
  );
}

function SettingCopy({ title, detail }: { title: string; detail: string }) {
  return <span className="workspace-setting-copy"><strong>{title}</strong><small>{detail}</small></span>;
}

export function WorkspaceSettingsView({ onClearSavedViewState }: { onClearSavedViewState: () => boolean }) {
  const { preferences, setPreference, resetPreferences, saveState } = useWorkspacePreferences();
  const [announcement, setAnnouncement] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const [clearPending, setClearPending] = useState(false);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const clearTriggerRef = useRef<HTMLButtonElement>(null);

  function restoreFocus(ref: { current: HTMLButtonElement | null }) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => ref.current?.focus()));
  }

  function changePreference<K extends keyof WorkspacePreferences>(key: K, value: WorkspacePreferences[K], label: string) {
    setPreference(key, value);
    setAnnouncement(`${label} ${saveState === 'saved' ? 'saved on this device' : 'applied for this session'}.`);
    setResetPending(false);
  }

  function resetAllPreferences() {
    resetPreferences();
    setResetPending(false);
    setAnnouncement(`Workspace settings restored to their defaults${saveState === 'saved' ? ' and saved on this device' : ' for this session'}.`);
    restoreFocus(resetTriggerRef);
  }

  function clearSavedViewState() {
    const cleared = onClearSavedViewState();
    setClearPending(false);
    setAnnouncement(cleared ? 'Saved map positions and pinned comparisons cleared.' : 'Browser storage is unavailable, so there was no saved view state to clear.');
    restoreFocus(clearTriggerRef);
  }

  return (
    <div className="workspace-settings-page">
      <header className="workspace-settings-hero">
        <div>
          <span><SlidersHorizontal size={15} /> Workspace defaults</span>
          <h1>Settings that change the workbench.</h1>
          <p>Choose how CreatorFlow opens animation evidence, previews local fixtures, and presents a release. Every change applies immediately and stays in this browser.</p>
        </div>
        <aside data-state={saveState}>{saveState === 'saved' ? <Check size={15} /> : <Database size={15} />}<span><strong>{saveState === 'saved' ? 'Saved on this device' : 'Browser storage unavailable'}</strong><small>{saveState === 'saved' ? 'No account or cloud sync required' : 'Changes last until this tab closes'}</small></span></aside>
      </header>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>

      <div className="workspace-settings-surface">
        <section className="workspace-settings-section" aria-labelledby="settings-analysis-title">
          <header><Activity size={18} /><div><h2 id="settings-analysis-title">Animation comparison</h2><p>Choose the first question CreatorFlow answers when an animator opens Pair compare.</p></div></header>
          <div className="workspace-settings-rows">
            <div className="workspace-setting-row workspace-setting-row-wide">
              <SettingCopy title="Default comparison mode" detail="This changes the calculation and explanation—not either underlying clip." />
              <ChoiceGroup label="Default animation comparison mode" value={preferences.analysisMode} options={analysisOptions} onChange={(value, label) => changePreference('analysisMode', value, `${label} comparison`)} />
            </div>
            <div className="workspace-setting-row">
              <SettingCopy title="Joint scope" detail="Limit the joints included in the first comparison pass." />
              <ChoiceGroup label="Default joint scope" value={preferences.jointScope} options={jointOptions} compact onChange={(value, label) => changePreference('jointScope', value, `${label} scope`)} />
            </div>
            <div className="workspace-setting-row">
              <SettingCopy title="Samples per shared track" detail="More samples can reveal shorter changes but use more processing time." />
              <ChoiceGroup
                label="Normalized animation sample count"
                value={preferences.sampleCount}
                compact
                options={([24, 48, 96] as MotionSampleCount[]).map((value) => ({ value, label: String(value) }))}
                onChange={(value) => changePreference('sampleCount', value, `${value} samples`)}
              />
            </div>
            <label className="workspace-setting-row workspace-setting-slider">
              <SettingCopy title="Relationship review threshold" detail="Flag high Motion shape, Timing drift, or Root path scores for human review. Loop seam uses its own quality ranges." />
              <span className="workspace-setting-range"><span><strong>{preferences.reviewThreshold}%</strong><small>60%</small><small>100%</small></span><input type="range" min="60" max="100" step="1" value={preferences.reviewThreshold} onChange={(event) => setPreference('reviewThreshold', Number(event.target.value))} onPointerUp={() => setAnnouncement(`${preferences.reviewThreshold}% review threshold ${saveState === 'saved' ? 'saved on this device' : 'applied for this session'}.`)} onKeyUp={() => setAnnouncement(`${preferences.reviewThreshold}% review threshold ${saveState === 'saved' ? 'saved on this device' : 'applied for this session'}.`)} /></span>
            </label>
          </div>
        </section>

        <section className="workspace-settings-section" aria-labelledby="settings-playback-title">
          <header><Monitor size={18} /><div><h2 id="settings-playback-title">Playback + device</h2><p>These defaults affect the local preview only. They never modify or publish a Roblox animation.</p></div></header>
          <div className="workspace-settings-rows">
            <label className="workspace-setting-row workspace-setting-toggle-row">
              <SettingCopy title="Autoplay synchronized clips" detail="Start both previews together when Pair compare opens. Reduced-motion device settings still take priority." />
              <span className="workspace-setting-switch"><input type="checkbox" checked={preferences.autoplay} onChange={(event) => changePreference('autoplay', event.target.checked, event.target.checked ? 'Autoplay enabled' : 'Autoplay disabled')} /><i aria-hidden="true" /><em>{preferences.autoplay ? 'On' : 'Off'}</em></span>
            </label>
            <label className="workspace-setting-row workspace-setting-toggle-row">
              <SettingCopy title="Show previous-pose trail" detail="Keep one faded prior pose visible to make direction changes easier to inspect." />
              <span className="workspace-setting-switch"><input type="checkbox" checked={preferences.poseTrail} onChange={(event) => changePreference('poseTrail', event.target.checked, event.target.checked ? 'Pose trail enabled' : 'Pose trail disabled')} /><i aria-hidden="true" /><em>{preferences.poseTrail ? 'On' : 'Off'}</em></span>
            </label>
            <div className="workspace-setting-row workspace-setting-row-wide">
              <SettingCopy title="Preview quality" detail="Choose a renderer budget for the comparison stage. Evidence sampling stays deterministic." />
              <ChoiceGroup label="Animation preview quality" value={preferences.previewQuality} options={qualityOptions} onChange={(value, label) => changePreference('previewQuality', value, `${label} preview quality`)} />
            </div>
          </div>
        </section>

        <section className="workspace-settings-section" aria-labelledby="settings-release-title">
          <header><Workflow size={18} /><div><h2 id="settings-release-title">Release workflow</h2><p>Guide and Map show the same release record through different working views.</p></div></header>
          <div className="workspace-settings-rows">
            <div className="workspace-setting-row workspace-setting-row-wide">
              <SettingCopy title="Default release view" detail="Guide prioritizes the next action. Map preserves parallel work and dependencies." />
              <ChoiceGroup label="Default release workflow view" value={preferences.releaseDefaultView} options={releaseOptions} onChange={(value, label) => changePreference('releaseDefaultView', value, `${label} default`)} />
            </div>
          </div>
        </section>

        <section className="workspace-settings-section workspace-settings-data" aria-labelledby="settings-data-title">
          <header><ShieldCheck size={18} /><div><h2 id="settings-data-title">Local data + privacy</h2><p>The privacy boundary is fixed. Only lightweight workspace preferences and view state are stored here.</p></div></header>
          <div className="workspace-settings-data-ledger">
            <div><ShieldCheck size={16} /><span><strong>Creative payloads stay local</strong><small>This is a CreatorFlow guarantee, not a switch. The browser stores no Roblox animation curves or source models as a preference.</small></span><em>Always on</em></div>
            <div><Database size={16} /><span><strong>Workspace preferences</strong><small>Analysis defaults, playback choices, preview quality, review threshold, and release view.</small></span><em>{saveState === 'saved' ? 'Stored locally' : 'Session only'}</em></div>
            <div><Gauge size={16} /><span><strong>Saved view state</strong><small>Flexible-map positions and pinned asset comparisons. Clear these without changing analysis defaults.</small></span><em>Separate</em></div>
          </div>
          <div className="workspace-settings-actions">
            <div>
              {!resetPending ? <button ref={resetTriggerRef} className="button button-secondary" type="button" onClick={() => { setResetPending(true); setClearPending(false); }}><RotateCcw size={14} /> Reset preferences</button> : <span className="workspace-settings-confirm" role="group" aria-label="Confirm resetting workspace preferences"><strong>Restore all defaults?</strong><button type="button" autoFocus onClick={resetAllPreferences}>Reset preferences</button><button type="button" onClick={() => { setResetPending(false); restoreFocus(resetTriggerRef); }}>Keep settings</button></span>}
              <small>Restores analysis, playback, device, threshold, and release defaults.</small>
            </div>
            <div>
              {!clearPending ? <button ref={clearTriggerRef} className="button button-secondary" type="button" onClick={() => { setClearPending(true); setResetPending(false); }}><Trash2 size={14} /> Clear saved view state</button> : <span className="workspace-settings-confirm" role="group" aria-label="Confirm clearing saved view state"><strong>Clear positions and pins?</strong><button type="button" autoFocus onClick={clearSavedViewState}>Clear view state</button><button type="button" onClick={() => { setClearPending(false); restoreFocus(clearTriggerRef); }}>Keep view state</button></span>}
              <small>Keeps your settings and active local-project connection.</small>
            </div>
          </div>
        </section>
      </div>

      <footer className="workspace-settings-footer"><BatteryMedium size={14} /><span>CreatorFlow applies preview settings locally. Fingerprints and human decisions remain attached to the evidence record.</span></footer>
    </div>
  );
}
