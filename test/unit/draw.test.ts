import { describe, expect, it } from 'vitest';
import { CHOOSE_MS, MAX_STROKES, REVEAL_MS, normalizeGuess, type DrawState } from '../../src/server/games/draw';
import drawEn from '../fixtures/content/packs/en/draw.json';
import drawAr from '../fixtures/content/packs/ar/draw.json';
import { makeRoom } from './helpers';

const PACKS = { en: { draw: drawEn }, ar: { draw: drawAr } };
type Pub = { phase: string; drawer: string; word: string | null; strokes: { c: number; w: number; p: number[] }[]; hint: number[] | null; feed: { p: string; t: string; ok: boolean }[]; tot: Record<string, number>; turn: number };
type Priv = { drawer: boolean; options: string[] | null; word: string | null; correct: boolean };

function setup(lang: 'en' | 'ar' = 'en', n = 3, seed = 3) {
  const r = makeRoom({ lang, seed, packs: PACKS as never });
  const ids = Array.from({ length: n }, (_, i) => r.add(`P${i}`).id);
  r.core.handle(ids[0], { t: 'select', game: 'draw' });
  expect(r.core.handle(ids[0], { t: 'start' })).toEqual({ ok: true });
  const s = () => r.core.s.game!.state as DrawState;
  const act = (pid: string, a: unknown) => r.core.handle(pid, { t: 'act', a });
  const pub = () => r.core.publicView() as Pub;
  const priv = (pid: string) => r.core.playerView(pid) as Priv;
  const start = () => act(s().drawer, { type: 'pick', i: 0 });
  return { r, ids, s, act, pub, priv, start, guessers: () => ids.filter((p) => p !== s().drawer) };
}

describe('normalizeGuess', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(normalizeGuess('  Ice  Cream! ')).toBe(normalizeGuess('icecream'));
    expect(normalizeGuess('The Sun')).toBe('sun');
  });
  it('folds Arabic letter variants and tashkeel', () => {
    expect(normalizeGuess('أرنب')).toBe(normalizeGuess('ارنب'));
    expect(normalizeGuess('إبريق')).toBe(normalizeGuess('ابريق'));
    expect(normalizeGuess('آلة')).toBe(normalizeGuess('اله'));
    expect(normalizeGuess('شجرة')).toBe(normalizeGuess('شجره'));
    expect(normalizeGuess('مستشفى')).toBe(normalizeGuess('مستشفي'));
    expect(normalizeGuess('شَمْس')).toBe(normalizeGuess('شمس'));
    expect(normalizeGuess('الشمس')).toBe(normalizeGuess('شمس'));
  });
});

describe('draw', () => {
  it('offers three words only to the drawer and hides the word from the public view', () => {
    for (const lang of ['en', 'ar'] as const) {
      const { ids, s, priv, pub } = setup(lang);
      expect(priv(s().drawer).options).toHaveLength(3);
      for (const p of ids.filter((x) => x !== s().drawer)) expect(priv(p).options).toBeNull();
      expect(pub().word).toBeNull();
      expect(JSON.stringify(pub())).not.toContain(s().options[0]);
    }
  });

  it('only the drawer picks; the word then shows as blanks to guessers', () => {
    const { s, act, pub, priv, guessers } = setup();
    expect(act(guessers()[0], { type: 'pick', i: 0 })).toMatchObject({ ok: false, detail: 'not_drawer' });
    expect(act(s().drawer, { type: 'pick', i: 7 })).toMatchObject({ ok: false, detail: 'bad_choice' });
    const word = s().options[1];
    act(s().drawer, { type: 'pick', i: 1 });
    expect(pub().phase).toBe('draw');
    expect(pub().hint).toEqual(word.split(' ').map((w) => [...w].length));
    expect(pub().word).toBeNull();
    expect(priv(s().drawer).word).toBe(word);
    expect(priv(guessers()[0]).word).toBeNull();
  });

  it('picks the first word when the drawer is too slow', () => {
    const { r, s, pub } = setup();
    const first = s().options[0];
    r.advance(CHOOSE_MS);
    expect(pub().phase).toBe('draw');
    expect(s().word).toBe(first);
  });

  it('keeps a compact stroke log with batches, undo and clear', () => {
    const { s, act, start, pub, guessers } = setup();
    start();
    const d = s().drawer;
    expect(act(guessers()[0], { type: 'pts', c: 0, w: 0, n: true, p: [1, 2] })).toMatchObject({ ok: false, detail: 'not_drawer' });
    act(d, { type: 'pts', c: 1, w: 0, n: true, p: [10, 20, 30, 40] });
    act(d, { type: 'pts', c: 1, w: 0, n: false, p: [50, 60] });
    act(d, { type: 'pts', c: 2, w: 1, n: true, p: [5000, -4] });
    expect(pub().strokes).toEqual([
      { c: 1, w: 0, p: [10, 20, 30, 40, 50, 60] },
      { c: 2, w: 1, p: [1000, 0] },
    ]);
    expect(act(d, { type: 'pts', c: 9, w: 0, n: true, p: [1, 1] })).toMatchObject({ ok: false, detail: 'bad_style' });
    expect(act(d, { type: 'pts', c: 0, w: 0, n: true, p: [1, 1, 2] })).toMatchObject({ ok: false, detail: 'bad_points' });
    act(d, { type: 'undo' });
    expect(pub().strokes).toHaveLength(1);
    act(d, { type: 'clear' });
    expect(pub().strokes).toHaveLength(0);
    for (let i = 0; i < MAX_STROKES; i++) act(d, { type: 'pts', c: 0, w: 0, n: true, p: [1, 1] });
    expect(act(d, { type: 'pts', c: 0, w: 0, n: true, p: [1, 1] })).toMatchObject({ ok: false, detail: 'too_much' });
  });

  it('checks guesses loosely, scores fast guessers and the drawer, and ends when all have guessed', () => {
    const { r, s, act, start, pub, priv, guessers, ids } = setup('ar', 3);
    start();
    const d = s().drawer;
    const [a, b] = guessers();
    const word = s().word;
    expect(act(d, { type: 'guess', text: word })).toMatchObject({ ok: false, detail: 'drawer_cant_guess' });
    act(a, { type: 'guess', text: 'مش هي' });
    expect(pub().feed).toEqual([{ p: a, t: 'مش هي', ok: false }]);
    r.advance(10_000);
    act(a, { type: 'guess', text: ` ${word}َ ` });
    expect(priv(a).correct).toBe(true);
    expect(priv(a).word).toBe(word);
    expect(act(a, { type: 'guess', text: 'x' })).toMatchObject({ ok: false, detail: 'already' });
    expect(pub().feed.at(-1)).toEqual({ p: a, t: '', ok: true });
    expect(pub().phase).toBe('draw');
    const first = pub().tot[a];
    expect(first).toBeGreaterThanOrEqual(5);
    r.advance(30_000);
    act(b, { type: 'guess', text: word });
    expect(pub().tot[b]).toBeLessThan(first);
    expect(pub().tot[d]).toBe(4);
    expect(pub()).toMatchObject({ phase: 'reveal', word });
    const score = (p: string) => r.core.snapshot().players.find((x) => x.id === p)!.score;
    expect(score(d)).toBe(4);
    expect(ids.every((p) => score(p) > 0)).toBe(true);
  });

  it('rotates the drawer and ends with the final scores after everyone drew', () => {
    const { r, ids, s, act, start, pub } = setup('en', 3);
    const seen: string[] = [];
    for (let t = 0; t < 3; t++) {
      seen.push(s().drawer);
      start();
      for (const g of ids.filter((p) => p !== s().drawer)) act(g, { type: 'guess', text: s().word.toUpperCase() });
      expect(pub().phase).toBe('reveal');
      r.advance(REVEAL_MS);
    }
    expect(new Set(seen).size).toBe(3);
    expect(pub().phase).toBe('end');
    expect(Object.keys(pub().tot)).toHaveLength(3);
    expect(r.core.handle(ids[0], { t: 'again' })).toEqual({ ok: true });
    expect(pub().phase).toBe('choose');
  });

  it('ends the turn on the timer with no points when nobody guesses', () => {
    const { r, s, start, pub } = setup();
    start();
    r.advance(75_000);
    expect(pub()).toMatchObject({ phase: 'reveal', word: s().word, tot: {} });
  });

  it('skips a drawer who leaves', () => {
    const { r, s, ids, pub } = setup('en', 4);
    const d = s().drawer;
    r.core.handle(d, { t: 'leave' });
    expect(pub().phase).toBe('reveal');
    r.advance(REVEAL_MS);
    expect(pub().drawer).not.toBe(d);
    expect(ids).toContain(pub().drawer);
  });
});
