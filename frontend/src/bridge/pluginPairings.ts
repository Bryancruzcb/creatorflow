import type { PluginPairingStatus } from './localBridge';

/** Human label for a pairing's lifecycle state. */
export function pairingStatusLabel(status: PluginPairingStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'EXPIRED':
      return 'Expired';
    case 'REVOKED':
      return 'Revoked';
  }
}

export type PairingTone = 'neutral' | 'positive' | 'warning';

/** Review tone for a pairing's status — active is reassuring, expired/revoked are not live. */
export function pairingStatusTone(status: PluginPairingStatus): PairingTone {
  switch (status) {
    case 'ACTIVE':
      return 'positive';
    case 'EXPIRED':
    case 'REVOKED':
      return 'neutral';
  }
}

/** A pairing id is a UUID; show a short trailing slice so rows stay scannable. */
export function formatPairingId(id: string): string {
  return id.length <= 8 ? id : id.slice(-8);
}

/** Only an ACTIVE pairing can still be revoked — an expired or already-revoked one cannot. */
export function isRevocable(status: PluginPairingStatus): boolean {
  return status === 'ACTIVE';
}
