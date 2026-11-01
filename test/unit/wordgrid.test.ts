import { describe, expect, it } from 'vitest';
import { WIN_POINTS, type GridState } from '../../src/server/games/wordgrid';
import wgEn from '../fixtures/content/packs/en/wordgrid.json';
import wgAr from '../fixtures/content/packs/ar/wordgrid.json';
import { makeRoom } from './helpers';

const PACKS = { en: { wordgrid: wgEn }, ar: { wordgrid: wgAr } };
type Tile = { w: string; up: boolean; k: number | null };
type Pub = { phase: string; tiles: Tile[]; todo: [number, number]; turn: 0 | 1; winner: 0 | 1 | null; reason: string | null; left: number; clue: { word: string; num: number } | null };
type Priv = { team: number | null; guide: boolean; key: number[] | null };

function setup(lang: 'en' | 'ar' = 'en', n = 4, seed = 5) {
  const r = makeRoom({ lang, seed, packs: PACKS as never });
  const ids = Array.from({ length: n }, (_, i) => r.add(`P${i}`).id);
  r.core.handle(ids[0], { t: 'select', game: 'wordgrid' });
  expect(r.core.handle(ids[0], { t: 'start' })).toEqual({ ok: true });
  const s = () => r.core.s.game!.state as GridState;
  const act = (pid: string, a: unknown) => r.core.handle(pid, { t: 'act', a });
  const pub = () => r.core.publicView() as Pub;
  const guide = () => s().guide[s().turn];
  const guessers = (t = s().turn) => s().teams[t].filter((p) => p !== s().guide[t]);
  const tilesOf = (kind: number) => s().key.map((k, i) => (k === kind ? i : -1)).filter((i) => i >= 0);
  return { r, ids, s, act, pub, guide, guessers, tilesOf, priv: (p: string) => r.core.playerView(p) as Priv };
}

const score = (r: ReturnType<typeof setup>['r'], p: string) => r.core.snapshot().players.find((x) => x.id === p)!.score;

describe('wordgrid', () => {
  it('deals 25 distinct words, 9+8 team tiles, 7 neutral and one trap', () => {
    for (const lang of ['en', 'ar'] as const) {
      const { s, pub } = setup(lang);
      expect(new Set(s().words).size).toBe(25);
      const count = (k: number) => s().key.filter((x) => x === k).length;
      expect([count(0), count(1)].sort()).toEqual([8, 9]);
      expect(count(2)).toBe(7);
      expect(count(3)).toBe(1);
      expect(count(s().turn)).toBe(9);
      expect(pub().todo[s().turn]).toBe(9);
    }
  });

  it('splits players into two teams with one Guide each, and only Guides get the key', () => {
    const { s, ids, priv, pub } = setup('en', 5);
    expect(s().teams[0].length + s().teams[1].length).toBe(5);
    const guides = ids.filter((p) => priv(p).guide);
    expect(guides.sort()).toEqual([...s().guide].sort());
    for (const p of ids) expect(priv(p).key !== null).toBe(priv(p).guide);
    expect(pub().tiles.every((t) => t.k === null)).toBe(true);
    expect(JSON.stringify(pub())).not.toContain('"key"');
  });

  it('validates clues: Guide only, one word, a number, not a word on the grid', () => {
    const { s, act, guide, guessers } = setup();
    const g = guide();
    expect(act(guessers()[0], { type: 'clue', word: 'sea', num: 2 })).toMatchObject({ ok: false, detail: 'not_guide' });
    expect(act(g, { type: 'clue', word: 'two words', num: 2 })).toMatchObject({ ok: false, detail: 'one_word' });
    expect(act(g, { type: 'clue', word: 'ok', num: 0 })).toMatchObject({ ok: false, detail: 'bad_number' });
    expect(act(g, { type: 'clue', word: s().words[3].toUpperCase(), num: 2 })).toMatchObject({ ok: false, detail: 'clue_on_board' });
    expect(act(guessers()[0], { type: 'pick', i: 0 })).toMatchObject({ ok: false });
    expect(act(g, { type: 'clue', word: 'zzfoo', num: 2 })).toEqual({ ok: true });
  });

  it('keeps the turn on a right tile, ends it on a wrong one', () => {
    const { s, act, pub, guide, guessers, tilesOf } = setup();
    const team = s().turn;
    act(guide(), { type: 'clue', word: 'zzfoo', num: 3 });
    expect(pub()).toMatchObject({ phase: 'guess', left: 4, clue: { word: 'zzfoo', num: 3 } });
    expect(act(guide(), { type: 'pick', i: 0 })).toMatchObject({ ok: false, detail: 'guide_cant_pick' });
    expect(act(guessers()[0], { type: 'pass' })).toMatchObject({ ok: false, detail: 'pick_first' });
    const [a, b] = tilesOf(team);
    act(guessers()[0], { type: 'pick', i: a });
    expect(pub().turn).toBe(team);
    expect(pub().tiles[a]).toMatchObject({ up: true, k: team });
    expect(act(guessers()[0], { type: 'pick', i: a })).toMatchObject({ ok: false, detail: 'bad_tile' });
    act(guessers()[0], { type: 'pick', i: tilesOf(2)[0] });
    expect(pub()).toMatchObject({ turn: 1 - team, phase: 'clue', clue: null });
    expect(pub().tiles[b].k).toBeNull();
    // the other team cannot act until it is their turn
    expect(act(s().teams[team][1], { type: 'clue', word: 'zzbar', num: 1 })).toMatchObject({ ok: false, detail: 'not_your_turn' });
  });

  it('gives only num + 1 taps, then passes the turn; a pass needs one tap first', () => {
    const { s, act, pub, guide, guessers, tilesOf } = setup();
    const team = s().turn;
    act(guide(), { type: 'clue', word: 'zzfoo', num: 1 });
    const [a, b] = tilesOf(team);
    act(guessers()[0], { type: 'pick', i: a });
    act(guessers()[0], { type: 'pick', i: b });
    expect(pub()).toMatchObject({ turn: 1 - team, phase: 'clue' });
    act(guide(), { type: 'clue', word: 'zzbar', num: 2 });
    act(guessers()[0], { type: 'pick', i: tilesOf(2)[0] });
    act(guide(), { type: 'clue', word: 'zzbaz', num: 2 });
    act(guessers()[0], { type: 'pick', i: tilesOf(team)[2] });
    expect(act(guessers()[0], { type: 'pass' })).toEqual({ ok: true });
    expect(pub().turn).toBe(1 - team);
  });

  it('the trap loses the game for the team that taps it, and everyone then sees the key', () => {
    const { r, s, act, pub, guide, guessers, tilesOf } = setup();
    const team = s().turn;
    act(guide(), { type: 'clue', word: 'zzfoo', num: 1 });
    act(guessers()[0], { type: 'pick', i: tilesOf(3)[0] });
    expect(pub()).toMatchObject({ phase: 'over', winner: 1 - team, reason: 'trap' });
    expect(pub().tiles.every((t) => t.k !== null)).toBe(true);
    for (const p of s().teams[1 - team]) expect(score(r, p)).toBe(WIN_POINTS);
    for (const p of s().teams[team]) expect(score(r, p)).toBe(0);
  });

  it('wins by finding every tile, also when the other team finds your last one for you', () => {
    const a = setup();
    const t = a.s().turn;
    a.act(a.guide(), { type: 'clue', word: 'zzfoo', num: 9 });
    for (const i of a.tilesOf(t)) a.act(a.guessers()[0], { type: 'pick', i });
    expect(a.pub()).toMatchObject({ phase: 'over', winner: t, reason: 'found' });
    expect(a.act(a.guessers()[0], { type: 'pick', i: 0 })).toMatchObject({ ok: false, detail: 'over' });

    const b = setup('ar', 4, 9);
    const first = b.s().turn;
    b.act(b.guide(), { type: 'clue', word: 'زززز', num: 9 });
    const theirs = b.tilesOf(1 - first);
    for (const i of theirs.slice(0, 7)) b.s().up[i] = true;
    b.act(b.guessers()[0], { type: 'pick', i: theirs[7] });
    expect(b.pub()).toMatchObject({ phase: 'over', winner: 1 - first, reason: 'found' });
  });

  it('a team that drops below two players forfeits; a leaving Guide is replaced', () => {
    const { r, s, pub, priv } = setup('en', 6);
    const t = s().turn;
    const g = s().guide[t];
    r.core.handle(g, { t: 'leave' });
    expect(pub().phase).toBe('clue');
    expect(s().guide[t]).not.toBe(g);
    expect(priv(s().guide[t]).key).not.toBeNull();
    for (const p of [...s().teams[t]].slice(1)) r.core.handle(p, { t: 'leave' });
    expect(pub()).toMatchObject({ phase: 'over', winner: 1 - t, reason: 'forfeit' });
  });
});
