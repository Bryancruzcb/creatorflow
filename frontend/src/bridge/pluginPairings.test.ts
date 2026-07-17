import { describe, expect, it } from 'vitest';
import type { PluginPairingStatus } from './localBridge';
import { formatPairingId, isRevocable, pairingStatusLabel, pairingStatusTone } from './pluginPairings';

describe('plugin pairing presentation', () => {
  it('labels each lifecycle status', () => {
    expect(pairingStatusLabel('ACTIVE')).toBe('Active');
    expect(pairingStatusLabel('EXPIRED')).toBe('Expired');
    expect(pairingStatusLabel('REVOKED')).toBe('Revoked');
  });

  it('flags only an active pairing with a positive tone', () => {
    expect(pairingStatusTone('ACTIVE')).toBe('positive');
    expect(pairingStatusTone('EXPIRED')).toBe('neutral');
    expect(pairingStatusTone('REVOKED')).toBe('neutral');
  });

  it('shortens a UUID pairing id to its trailing slice but leaves a short one alone', () => {
    expect(formatPairingId('11111111-2222-3333-4444-555555555555')).toBe('55555555');
    expect(formatPairingId('short')).toBe('short');
  });

  it('only an active pairing is revocable', () => {
    const statuses: PluginPairingStatus[] = ['ACTIVE', 'EXPIRED', 'REVOKED'];
    expect(statuses.filter(isRevocable)).toEqual(['ACTIVE']);
  });
});
