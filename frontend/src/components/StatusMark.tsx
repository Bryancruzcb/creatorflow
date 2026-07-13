import { Check, CircleDot, Minus, X } from 'lucide-react';
import type { EvidenceStatus, ReleaseDecision } from '../data';

type StatusValue = EvidenceStatus | ReleaseDecision;

const labels: Record<StatusValue, string> = {
  clear: 'Clear',
  review: 'Review',
  blocked: 'Blocked',
  approved: 'Approved',
  'needs-review': 'Needs review',
  pending: 'Pending',
  excluded: 'Excluded',
};

export function StatusMark({ value, compact = false }: { value: StatusValue; compact?: boolean }) {
  const className = value === 'approved' ? 'clear' : value === 'needs-review' ? 'review' : value;
  const Icon = className === 'clear' ? Check : className === 'review' ? CircleDot : className === 'blocked' ? X : Minus;

  return (
    <span className={`status-mark status-${className}`}>
      <span className="status-bracket" aria-hidden="true"><Icon size={compact ? 12 : 14} strokeWidth={1.8} /></span>
      {!compact && <span>{labels[value]}</span>}
    </span>
  );
}
