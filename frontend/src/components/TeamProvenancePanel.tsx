import { HelpCircle, RotateCcw, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type LocalBridgeClient,
  type LocalProvenanceClaim,
  type TeamStoreStatus,
} from '../bridge/localBridge';
import { claimVersionCaveat, classifyClaimVersion, sortClaimsForDisplay } from '../bridge/fingerprintVersions';
import { EvidenceBasisMark } from './EvidenceBasisMark';
import './TeamProvenancePanel.css';

/**
 * "A record of who ran CreatorFlow first — not a record of who authored the work."
 *
 * Pinned wherever any time ordering is visible. The store's `recordedAt` is a real, server-side
 * clock, which makes it tempting to read as priority — and reading it that way is exactly the
 * false accusation this whole phase is shaped to prevent.
 */
export const ORDERING_DISCLAIMER =
  'A record of who ran CreatorFlow first — not a record of who authored the work.';

type PanelState =
  | { kind: 'loading' }
  | { kind: 'answered'; status: TeamStoreStatus; claims: LocalProvenanceClaim[]; message: string | null };

/**
 * The copy for every non-`OK` status.
 *
 * Every one of these is a *we do not know* sentence. Not one of them says, implies, or leaves room
 * for "no one else has this" — that sentence belongs to exactly one state, `OK` with zero rows,
 * and `TeamProvenancePanel.unreachable.test.tsx` exists to keep it that way.
 */
function unknownCopy(status: TeamStoreStatus): { headline: string; detail: string } {
  switch (status) {
    case 'NOT_CONFIGURED':
      return {
        headline: 'Team store not connected.',
        detail: 'CreatorFlow works fully without it. Connect one in the desktop Settings page to '
          + 'check a fingerprint against your team.',
      };
    case 'UNAUTHORIZED':
      return {
        headline: 'Team store unreachable — team provenance unknown.',
        detail: 'This machine\'s credential no longer opens the configured team, so nothing was '
          + 'looked up. Re-check the server URL, key and team in desktop Settings.',
      };
    case 'REJECTED':
      // Its own branch, because the generic line would be a lie here: the store is fine and was
      // never contacted. What is true is that this build could not form the question.
      return {
        headline: 'Team provenance unknown — this build could not ask.',
        detail: 'The comparison did not carry a 64-hex curve fingerprint, so no lookup was sent. '
          + 'Nothing here says anything about who else has this clip.',
      };
    default:
      return {
        headline: 'Team store unreachable — team provenance unknown.',
        detail: 'Nothing was looked up, so nothing is known either way about this fingerprint.',
      };
  }
}

function ClaimRow({ claim, lookupVersion, onRetract, retracting }: {
  claim: LocalProvenanceClaim;
  lookupVersion: string | null;
  onRetract: ((claim: LocalProvenanceClaim) => void) | null;
  retracting: boolean;
}) {
  const match = classifyClaimVersion(claim.algorithmVersion, lookupVersion);
  const caveat = claimVersionCaveat(match);
  const declared = [
    claim.declaredSource ? { label: 'Source', value: claim.declaredSource } : null,
    claim.declaredLicense ? { label: 'License', value: claim.declaredLicense } : null,
    claim.robloxAssetId !== null ? { label: 'Roblox ID', value: String(claim.robloxAssetId) } : null,
    claim.ownershipContext ? { label: 'Context', value: claim.ownershipContext } : null,
    claim.declaredNote ? { label: 'Note', value: claim.declaredNote } : null,
  ].filter((entry): entry is { label: string; value: string } => entry !== null);

  return (
    <li className="team-provenance-row" data-match={match} data-yours={claim.isYours ? 'true' : 'false'}>
      <div className="team-provenance-row-head">
        <strong>{claim.memberUsername}{claim.isYours ? ' (you)' : ''}</strong>
        <span className="team-provenance-clip">{claim.clipName}</span>
      </div>

      {/*
        * VERIFIED and DECLARED are separated visually, not just labelled, because collapsing them
        * is the confident-false-claim failure this product exists to avoid. CreatorFlow computed
        * the fingerprint match and the store stamped the time; everything in the DECLARED block is
        * a sentence a person typed, and it is attributed to them by name.
        */}
      <div className="team-provenance-verified">
        <EvidenceBasisMark basis={match === 'MATCH' ? 'VERIFIED' : 'NOT_VERIFIED'} compact />
        <span>
          {match === 'MATCH'
            ? 'Exact curve fingerprint match'
            : caveat}
        </span>
        <time dateTime={claim.recordedAt}>Recorded {new Date(claim.recordedAt).toLocaleString()}</time>
      </div>

      {declared.length > 0 ? (
        <dl className="team-provenance-declared">
          <div className="team-provenance-declared-head">
            <EvidenceBasisMark basis="DECLARED" compact />
            <span>{claim.memberUsername} declared:</span>
          </div>
          {declared.map((entry) => (
            <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>
          ))}
        </dl>
      ) : null}

      {/*
        * Gated on the server's canRetract, not on isYours: a team owner is the kill switch's
        * second operator and must be able to pull it on someone else's row. That is the whole
        * justification for refusing to let the last owner leave.
        */}
      {claim.canRetract && onRetract ? (
        <button
          type="button"
          className="team-provenance-retract"
          disabled={retracting}
          onClick={() => onRetract(claim)}
        >
          {retracting ? 'Retracting…' : claim.isYours ? 'Retract' : 'Retract as owner'}
        </button>
      ) : null}
    </li>
  );
}

/**
 * The team provenance lookup, on the motion-comparison detail — the moment an incoming clip is
 * actually checked against the people you work with.
 *
 * Five states, and the difference between two of them is the whole point:
 *
 * 1. not connected — NOT_VERIFIED, and CreatorFlow works fully without it;
 * 2. **unreachable or unauthorized — NOT_VERIFIED, "unknown", and never "no one else has this"**;
 * 3. reachable with zero rows — VERIFIED, because a lookup genuinely ran, with the outcome carried
 *    in words rather than in the mark, and the words are *no record found*, never *original*;
 * 4. reachable with rows — sorted by username so the order implies no priority;
 * 5. a row whose fingerprint version this build does not recognize — shown and labelled, never
 *    counted as a match, never dropped.
 *
 * Nothing here is cached. Every render that needs an answer asks for one, and a failed ask is a
 * state, not an empty result.
 */
export function TeamProvenancePanel({ bridgeClient, fingerprint, algorithmVersion, clipName }: {
  bridgeClient: LocalBridgeClient;
  fingerprint: string;
  algorithmVersion: string | null;
  clipName: string;
}) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' });
  const [retractingId, setRetractingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Which lookup is allowed to write to state. Only the newest one is.
   *
   * This panel's `fingerprint` prop changes **in place**: the motion lab polls the Studio evidence
   * inbox every 3 seconds and hands over `latestComparison.candidateFingerprint`, with no `key` to
   * force a remount. A lookup's budget is 4 s connect / 6 s read, which routinely outlives two
   * poll cycles — so a slow answer for fingerprint A can land after the panel has moved on to B.
   *
   * Without this guard that is not a cosmetic glitch, it is the one sentence this whole phase
   * exists to prevent: A's empty `claims` array arriving late flips the panel to the "no one on
   * your team has registered this exact curve fingerprint" state **for a fingerprint nobody looked
   * up**. The mirror case is worse in the other direction — A's claims painted under B's heading is
   * a false attribution.
   *
   * A ref rather than an effect-cleanup flag, deliberately: "Try again" and "Check again" call
   * `lookup()` outside the effect, so a `let cancelled` closure scoped to the effect would not
   * cover them.
   */
  const requestId = useRef(0);

  const lookup = useCallback(() => {
    const mine = requestId.current + 1;
    requestId.current = mine;
    setState({ kind: 'loading' });
    bridgeClient.lookupTeamProvenance(fingerprint, algorithmVersion)
      .then((result) => {
        if (mine !== requestId.current) return;
        /*
         * Belt and braces. The bridge echoes back the fingerprint it actually looked up, so the
         * answer can be checked against the question rather than trusted to arrive in order. A
         * mismatch means this response is about something else and is dropped — never rendered
         * under the current fingerprint's heading.
         */
        if (result.fingerprint && result.fingerprint.toLowerCase() !== fingerprint.toLowerCase()) return;
        setState({
          kind: 'answered',
          status: result.status,
          claims: result.claims ?? [],
          message: result.message,
        });
      })
      // The bridge answers 200 with a status even for an unreachable store, so reaching this
      // branch means the bridge itself failed. That is still an "we could not ask" — never an
      // empty result set.
      .catch(() => {
        if (mine !== requestId.current) return;
        setState({ kind: 'answered', status: 'UNREACHABLE', claims: [], message: null });
      });
  }, [algorithmVersion, bridgeClient, fingerprint]);

  useEffect(() => { lookup(); }, [lookup]);

  async function retract(claim: LocalProvenanceClaim) {
    const reason = window.prompt(
      'Why are you retracting this? A reason is required, and it removes the claim from future '
      + 'lookups — it cannot recall a copy a teammate already read.',
    );
    if (reason === null || reason.trim().length === 0) return;
    setRetractingId(claim.id);
    setActionError(null);
    try {
      await bridgeClient.retractProvenanceClaim(claim.id, reason.trim());
      lookup();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not retract that claim.');
    } finally {
      setRetractingId(null);
    }
  }

  if (state.kind === 'loading') {
    return (
      <section className="team-provenance" data-state="loading" aria-label="Team provenance">
        <header>
          <span><Users size={15} /> Team provenance</span>
          <small>Checking live…</small>
        </header>
        <p className="team-provenance-unknown-detail">Asking your team store about this fingerprint.</p>
      </section>
    );
  }

  if (state.status !== 'OK') {
    const { headline, detail } = unknownCopy(state.status);
    return (
      <section className="team-provenance" data-state="unknown" aria-label="Team provenance">
        <header>
          <span><HelpCircle size={15} /> Team provenance</span>
          <EvidenceBasisMark basis="NOT_VERIFIED" compact />
        </header>
        <p className="team-provenance-unknown"><strong>{headline}</strong></p>
        <p className="team-provenance-unknown-detail">{detail}</p>
        <button type="button" className="team-provenance-refresh" onClick={lookup}>
          <RotateCcw size={13} /> Try again
        </button>
      </section>
    );
  }

  const claims = sortClaimsForDisplay(state.claims);

  if (claims.length === 0) {
    return (
      <section className="team-provenance" data-state="empty" aria-label="Team provenance">
        <header>
          <span><Users size={15} /> Team provenance</span>
          {/*
            * VERIFIED because a lookup genuinely ran — the mark describes the basis, not the
            * outcome (the Phase B split). The outcome lives in the sentence below it.
            */}
          <EvidenceBasisMark basis="VERIFIED" compact />
        </header>
        <p className="team-provenance-empty">
          <strong>No one on your team has registered this exact curve fingerprint.</strong>
        </p>
        <p className="team-provenance-unknown-detail">
          No record found — which is not the same as original. Only your team's store was asked, and
          only for this exact fingerprint.
        </p>
        <button type="button" className="team-provenance-refresh" onClick={lookup}>
          <RotateCcw size={13} /> Check again
        </button>
      </section>
    );
  }

  return (
    <section className="team-provenance" data-state="claims" aria-label="Team provenance">
      <header>
        <span><Users size={15} /> Team provenance</span>
        <EvidenceBasisMark basis="VERIFIED" compact />
      </header>
      <p className="team-provenance-lead">
        {claims.length === 1 ? '1 person' : `${claims.length} people`} on your team recorded this
        exact curve fingerprint{clipName ? <> while checking <strong>{clipName}</strong></> : null}.
      </p>
      <ul className="team-provenance-list">
        {claims.map((claim) => (
          <ClaimRow
            key={claim.id}
            claim={claim}
            lookupVersion={algorithmVersion}
            onRetract={retract}
            retracting={retractingId === claim.id}
          />
        ))}
      </ul>
      {actionError ? <p className="team-provenance-error" role="status">{actionError}</p> : null}
      <p className="team-provenance-ordering">{ORDERING_DISCLAIMER}</p>
      <button type="button" className="team-provenance-refresh" onClick={lookup}>
        <RotateCcw size={13} /> Check again
      </button>
    </section>
  );
}
