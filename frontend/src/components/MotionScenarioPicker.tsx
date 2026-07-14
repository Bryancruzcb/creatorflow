import { Layers } from 'lucide-react';
import { similarityBand, type SimilarityTone } from '../motion/motionScenarios';
import type { RigClip, RigScenario } from '../motion/rigFixtures';
import './MotionScenarioPicker.css';

export interface ScenarioScore {
  exactCurveData: boolean;
  primaryValue: number | null;
}

interface FactsResult {
  sourceDuration: number;
  candidateDuration: number;
  sourceKeys: number;
  candidateKeys: number;
  sourceTracks: number;
  candidateTracks: number;
  commonTracks: number;
  coverage: number;
  verdict: string;
}

const TONE_ORDER: Record<SimilarityTone, number> = { exact: 0, high: 1, moderate: 2, low: 3, none: 4 };

function BandBadge({ score }: { score: ScenarioScore | null }) {
  if (!score) return <span className="scenario-band tone-none">—</span>;
  const band = similarityBand(score.exactCurveData, score.primaryValue);
  const pct = score.exactCurveData ? '100%' : score.primaryValue === null ? '' : `${Math.round(score.primaryValue)}%`;
  return <span className={`scenario-band tone-${band.tone}`}>{band.label}{pct ? <b>{pct}</b> : null}</span>;
}

function FactColumn({ label, clipName, facts, duration, keys, tracks }: {
  label: string; clipName: string; facts: RigClip | undefined; duration: number; keys: number; tracks: number;
}) {
  return (
    <div className="motion-scenario-facts-col">
      <header><span>{label}</span><strong>{clipName}</strong></header>
      <dl>
        <div><dt>Animation ID</dt><dd className="mono">{facts?.animationId ?? '—'}</dd></div>
        <div><dt>Priority</dt><dd>{facts?.priority ?? '—'}</dd></div>
        <div><dt>Looped</dt><dd>{facts ? (facts.looped ? 'Yes' : 'No') : '—'}</dd></div>
        <div><dt>Duration</dt><dd>{duration.toFixed(2)}s</dd></div>
        <div><dt>Keyframes</dt><dd>{keys.toLocaleString()}</dd></div>
        <div><dt>Tracks</dt><dd>{tracks}</dd></div>
        <div><dt>Typical use</dt><dd>{facts?.use ?? '—'}</dd></div>
      </dl>
    </div>
  );
}

/**
 * Presents a rig's clips as the comparison relationships a Roblox creator meets — a re-upload, an
 * edited variant, a same-family cycle, an unrelated clip — with the band computed live for each,
 * and a Studio-facts table for the loaded pair. Scenarios and facts are supplied by the active rig.
 */
export function MotionScenarioPicker({ sourceName, candidateName, onSelect, scenarioScores, result, scenarios, clipByName }: {
  sourceName: string;
  candidateName: string;
  onSelect: (source: string, candidate: string) => void;
  scenarioScores: Record<string, ScenarioScore | null>;
  result: FactsResult | null;
  scenarios: RigScenario[];
  clipByName: (name: string) => RigClip | undefined;
}) {
  const activeId = scenarios.find((s) => s.source === sourceName && s.candidate === candidateName)?.id;
  const active = scenarios.find((s) => s.id === activeId);
  const ordered = [...scenarios].sort((a, b) => {
    const sa = scenarioScores[a.id];
    const sb = scenarioScores[b.id];
    const ta = sa ? TONE_ORDER[similarityBand(sa.exactCurveData, sa.primaryValue).tone] : 99;
    const tb = sb ? TONE_ORDER[similarityBand(sb.exactCurveData, sb.primaryValue).tone] : 99;
    return ta - tb;
  });

  return (
    <section className="motion-scenario-picker" aria-label="Roblox similarity scenarios">
      <header className="motion-scenario-head">
        <div>
          <span className="motion-scenario-kicker"><Layers size={14} /> Similarity scenarios</span>
          <h2>See the whole range, not one score.</h2>
          <p>This rig's clips, framed as the relationships a Roblox creator meets. The band on each is computed live by the engine — click one to load it into the comparison below.</p>
        </div>
      </header>

      <div className="motion-scenario-grid">
        {ordered.map((scenario) => {
          const isActive = scenario.id === activeId;
          return (
            <button
              key={scenario.id}
              type="button"
              className={`motion-scenario-card${isActive ? ' is-active' : ''}`}
              aria-pressed={isActive}
              onClick={() => onSelect(scenario.source, scenario.candidate)}
            >
              <div className="motion-scenario-card-top">
                <strong>{scenario.title}</strong>
                <BandBadge score={scenarioScores[scenario.id]} />
              </div>
              <span className="motion-scenario-pair">{scenario.source} <i aria-hidden="true">↔</i> {scenario.candidate}</span>
              <small>{scenario.situation}</small>
            </button>
          );
        })}
      </div>

      {active ? <p className="motion-scenario-guidance"><strong>{active.title}:</strong> {active.guidance}</p> : null}

      {result ? (
        <div className="motion-scenario-facts">
          <FactColumn label="Reference" clipName={sourceName} facts={clipByName(sourceName)} duration={result.sourceDuration} keys={result.sourceKeys} tracks={result.sourceTracks} />
          <FactColumn label="Candidate" clipName={candidateName} facts={clipByName(candidateName)} duration={result.candidateDuration} keys={result.candidateKeys} tracks={result.candidateTracks} />
          <div className="motion-scenario-facts-shared">
            <div><span>Shared joints</span><strong>{result.commonTracks}</strong></div>
            <div><span>Coverage</span><strong>{result.coverage}%</strong></div>
            <div className="wide"><span>Live verdict</span><strong>{result.verdict}</strong></div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
