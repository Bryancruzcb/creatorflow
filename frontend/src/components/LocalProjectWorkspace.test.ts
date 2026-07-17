import { describe, expect, it } from 'vitest';
import { parseExperienceFormInput } from './LocalProjectWorkspace';

describe('parseExperienceFormInput', () => {
  it('accepts a fully specified positive-integer declaration and trims the name', () => {
    const result = parseExperienceFormInput({ universeId: '1234567890', placeId: '9876543210', experienceName: '  Obby Tower  ' });
    expect(result).toEqual({ ok: true, value: { universeId: 1234567890, placeId: 9876543210, experienceName: 'Obby Tower' } });
  });

  it('rejects a zero, negative, non-integer, or non-numeric universe id', () => {
    expect(parseExperienceFormInput({ universeId: '0', placeId: '1', experienceName: 'X' }).ok).toBe(false);
    expect(parseExperienceFormInput({ universeId: '-5', placeId: '1', experienceName: 'X' }).ok).toBe(false);
    expect(parseExperienceFormInput({ universeId: '1.5', placeId: '1', experienceName: 'X' }).ok).toBe(false);
    expect(parseExperienceFormInput({ universeId: 'abc', placeId: '1', experienceName: 'X' }).ok).toBe(false);
    expect(parseExperienceFormInput({ universeId: '', placeId: '1', experienceName: 'X' }).ok).toBe(false);
  });

  it('rejects a non-positive place id independently of a valid universe id', () => {
    const result = parseExperienceFormInput({ universeId: '1', placeId: '-4', experienceName: 'X' });
    expect(result).toEqual({ ok: false, error: 'Place ID must be a positive whole number.' });
  });

  it('rejects a blank or whitespace-only experience name', () => {
    const result = parseExperienceFormInput({ universeId: '1', placeId: '1', experienceName: '   ' });
    expect(result).toEqual({ ok: false, error: 'Experience name is required.' });
  });
});
