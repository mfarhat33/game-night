// Room codes: 4 letters, consonants only (no vowels means almost no real words),
// and no letters that are easy to confuse (I, L, O, U, Y and digits are left out).
export const CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ';
export const CODE_LENGTH = 4;

// Consonant clusters that still read as rude or loaded abbreviations.
const BLOCKED = ['FCK', 'FK', 'FKN', 'FGT', 'CNT', 'KKK', 'NGR', 'NGGR', 'SHT', 'PHK', 'WTF', 'STFU', 'DCK', 'PNS', 'XXX', 'NZ', 'SS', 'KMK', 'TZZ', 'ZB', 'KSS', 'SKS', 'SX', 'FVCK', 'BTCH', 'HTLR', 'JZZ', 'CK', 'DMN'];

export function isCleanCode(code: string): boolean {
  return !BLOCKED.some((w) => code.includes(w));
}

export function isValidCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);
}

/** Make a random clean code. `rand` returns a float in [0, 1). */
export function makeCode(rand: () => number = Math.random): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
    if (isCleanCode(code)) return code;
  }
}
