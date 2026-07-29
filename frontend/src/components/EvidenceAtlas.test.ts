import { describe, expect, it } from 'vitest';
import { breakPoints } from './EvidenceAtlas';

describe('breakPoints', () => {
  it('breaks a filename after its separators', () => {
    expect(breakPoints('avocado_foodstudy_v02.glb')).toEqual([
      'avocado_',
      'foodstudy_',
      'v02.glb',
    ]);
  });

  it('keeps the extension attached to the stem it belongs to', () => {
    expect(breakPoints('avocado_foodstudy_v02.glb').at(-1)).toBe('v02.glb');
  });

  /**
   * The regression this exists for. Breaking after every full stop fixed the filename card and
   * split the one beside it into "Manifest 1." / "2" — a dot inside a version is not a word
   * boundary.
   */
  it('does not break inside a version number', () => {
    expect(breakPoints('Manifest 1.2')).toEqual(['Manifest 1.2']);
    expect(breakPoints('Release 1.2.0')).toEqual(['Release 1.2.0']);
  });

  it('leaves ordinary labels untouched', () => {
    expect(breakPoints('Khronos upstream GLB')).toEqual(['Khronos upstream GLB']);
    expect(breakPoints('Source attached')).toEqual(['Source attached']);
  });

  it('handles hyphenated names', () => {
    expect(breakPoints('robot-expressive-preview')).toEqual([
      'robot-',
      'expressive-',
      'preview',
    ]);
  });

  it('never drops or reorders characters', () => {
    const samples = ['avocado_foodstudy_v02.glb', 'Manifest 1.2', 'a_b-c', '', 'plain'];
    samples.forEach((sample) => expect(breakPoints(sample).join('')).toBe(sample));
  });
});
