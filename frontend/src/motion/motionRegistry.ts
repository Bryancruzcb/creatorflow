/**
 * A small sample motion registry. In production, CreatorFlow searches a registry by fingerprint
 * and gets back the owner's record for any registered asset a candidate resembles. Here that
 * lookup is stubbed with a handful of illustrative records so the demo can show the payoff: a bare
 * similarity score turns into "your candidate is an X% match to a *registered* asset owned by
 * someone, mapped to this Animation ID" — the lead a human actually acts on.
 *
 * A record is keyed to a rig's reference clip (the known, registered side you compare a candidate
 * against). Not every clip is registered on purpose: a reference with no record is the honest
 * negative case — "no conflict found in the registry checked," never "proven original."
 */

export interface RegistryRecord {
  /** The rig + clip this record registers; the reference (source) side of a comparison. */
  rigId: string;
  clipName: string;
  /** The registered asset's public name and version, e.g. "WalkCycle V3". */
  assetName: string;
  /** Registrant handle as it would appear in the registry. */
  owner: string;
  /** ISO date the asset was registered. */
  registeredAt: string;
  /** Roblox Animation ID the record maps to — matches the rig clip's own id. */
  animationId: string;
  license: string;
  /** Short registry receipt id, e.g. "CF-2207". */
  registryId: string;
  /** One line on what the record permits — the reason it matters at release time. */
  usageNote: string;
}

const RECORDS: RegistryRecord[] = [
  {
    rigId: 'robot',
    clipName: 'Walking',
    assetName: 'WalkCycle V3',
    owner: '@mira_anim',
    registeredAt: '2026-04-02',
    animationId: 'rbxassetid://1027461842',
    license: 'CC-BY 4.0',
    registryId: 'CF-2207',
    usageNote: 'Reusable with attribution to @mira_anim.',
  },
  {
    rigId: 'robot',
    clipName: 'Idle',
    assetName: 'IdleBreath',
    owner: '@mira_anim',
    registeredAt: '2026-03-11',
    animationId: 'rbxassetid://1027461501',
    license: 'CC-BY 4.0',
    registryId: 'CF-1044',
    usageNote: 'Reusable with attribution to @mira_anim.',
  },
  {
    rigId: 'robot',
    clipName: 'Running',
    assetName: 'SprintLoop',
    owner: '@l6studio',
    registeredAt: '2026-05-19',
    animationId: 'rbxassetid://1027462119',
    license: 'CC0 1.0',
    registryId: 'CF-3391',
    usageNote: 'Public domain — free to reuse, no attribution required.',
  },
  {
    rigId: 'robot',
    clipName: 'Dance',
    assetName: 'PartyEmote',
    owner: '@kolabuild',
    registeredAt: '2026-06-01',
    animationId: 'rbxassetid://1027464560',
    license: 'All rights reserved',
    registryId: 'CF-4820',
    usageNote: 'Not licensed for reuse — permission from @kolabuild required before shipping.',
  },
  {
    rigId: 'fox',
    clipName: 'Walk',
    assetName: 'QuadWalk',
    owner: '@norgerigs',
    registeredAt: '2026-02-20',
    animationId: 'rbxassetid://1031820551',
    license: 'CC-BY 4.0',
    registryId: 'CF-0777',
    usageNote: 'Reusable with attribution to @norgerigs.',
  },
];

export function registryRecordFor(rigId: string, clipName: string): RegistryRecord | undefined {
  return RECORDS.find((record) => record.rigId === rigId && record.clipName === clipName);
}

/** Absolute registration date, formatted for display (no fragile "N months ago" math). */
export function formatRegisteredAt(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
