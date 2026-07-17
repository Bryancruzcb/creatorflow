import { Check, HelpCircle, User } from 'lucide-react';
import type { EvidenceBasis } from '../bridge/evidenceBasis';

/**
 * Shared evidence-basis badge for the tri-state provenance classifier ({@link EvidenceBasis}).
 * Reuses `StatusMark`'s visual language (icon bracket + text pill) but targets the live
 * local-project dataset (`VERIFIED`/`DECLARED`/`NOT_VERIFIED`), not the demo `data.ts` type.
 *
 * Honesty constraint: color is never the only signal — every basis also carries a visible text
 * label and a `title`/screen-reader description so the meaning survives without color.
 */
const BASIS_META: Record<EvidenceBasis, { label: string; description: string; icon: typeof Check; tone: string }> = {
  VERIFIED: {
    label: 'Verified',
    description: 'Computed by CreatorFlow — not a claim of originality or ownership.',
    icon: Check,
    tone: 'verified',
  },
  DECLARED: {
    label: 'Declared',
    description: 'Entered by a person.',
    icon: User,
    tone: 'declared',
  },
  NOT_VERIFIED: {
    label: 'Not verified',
    description: 'CreatorFlow did not or cannot check this.',
    icon: HelpCircle,
    tone: 'not-verified',
  },
};

export function EvidenceBasisMark({ basis, compact = false }: { basis: EvidenceBasis; compact?: boolean }) {
  const meta = BASIS_META[basis];
  const Icon = meta.icon;

  return (
    <span className={`status-mark evidence-basis-mark evidence-basis-${meta.tone}`} title={meta.description}>
      <span className="status-bracket" aria-hidden="true"><Icon size={compact ? 12 : 14} strokeWidth={1.8} /></span>
      {!compact && <span>{meta.label}<span className="sr-only"> — {meta.description}</span></span>}
    </span>
  );
}
