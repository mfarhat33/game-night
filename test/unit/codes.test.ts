import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, isCleanCode, isValidCode, makeCode, normalizeCode } from '../../src/server/codes';
import { seeded } from './helpers';

describe('room codes', () => {
  it('uses no vowels or look-alike letters', () => {
    for (const ch of 'AEIOUYL01') expect(CODE_ALPHABET).not.toContain(ch);
  });
  it('makes valid, clean 4 letter codes', () => {
    const rand = seeded(3);
    for (let i = 0; i < 2000; i++) {
      const c = makeCode(rand);
      expect(isValidCode(c)).toBe(true);
      expect(isCleanCode(c)).toBe(true);
    }
  });
  it('blocks rude clusters and normalizes input', () => {
    expect(isCleanCode('XFCK')).toBe(false);
    expect(normalizeCode(' bc-df ')).toBe('BCDF');
    expect(isValidCode('ABCD')).toBe(false);
  });
});
