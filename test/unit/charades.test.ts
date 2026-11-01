import { describe, expect, it } from 'vitest';
import { COUNT_MS, GAP_MS, type CharadesState } from '../../src/server/games/charades';
import { makeRoom } from './helpers';

function setup(settings: Record<string, unknown> = {}, lang: 'en' | 'ar' = 'en', n = 3) {
  const r = makeRoom({ lang });
  const ids = Array.from({ length: n }, (_, i) => r.add(`P${i}`).id);
  r.core.handle(ids[0], { t: 'select', game: 'charades', settings: { seconds: 20, ...settings } });
  expect(r.core.handle(ids[0], { t: 'start' })).toEqual({ ok: true });
  const s = () => r.core.s.game!.state as CharadesState;
  const act = (pid: string, a: unknown) => r.core.handle(pid, { t: 'act', a });
  const pub = () => r.core.publicView() as any;
  const view = (pid: string) => r.core.playerView(pid) as any;
  return { r, ids, s, act, pub, view };
}

describe('charades', () => {
  it('only the holder can start and sees the word, after a count-in', () => {
    for (const lang of ['en', 'ar'] as const) {
      const { r, ids, s, act, pub, view } = setup({}, lang);
      const holder = s().queue[0];
      const other = ids.find((p) => p !== holder)!;
      expect(act(other, { type: 'start' })).toMatchObject({ ok: false, detail: 'not_holder' });
      expect(view(holder).word).toBeNull();
      act(holder, { type: 'start' });
      expect(pub().phase).toBe('count');
      r.advance(COUNT_MS);
      expect(pub().phase).toBe('play');
      expect(view(holder).word).toBeTruthy();
      expect(view(other).word).toBeNull();
      expect(JSON.stringify(pub())).not.toContain(view(holder).word);
    }
  });

  it('scores correct, ignores a repeated tilt, ends the turn on time and rotates holders', () => {
    const { r, ids, s, act, pub, view } = setup({ rounds: 1 });
    const first = s().queue[0];
    act(first, { type: 'start' });
    r.advance(COUNT_MS);
    const w1 = view(first).word;
    const n1 = view(first).n;
    expect(act(ids.find((p) => p !== first)!, { type: 'correct' })).toMatchObject({ ok: false });
    act(first, { type: 'correct', n: n1 });
    act(first, { type: 'correct', n: n1 }); // the same tilt twice
    expect(pub().score[first]).toBe(1);
    expect(view(first).word).not.toBe(w1);
    act(first, { type: 'pass', n: n1 + 1 });
    r.advance(20_000);
    expect(pub().phase).toBe('turnend');
    expect(pub().right).toEqual([w1]);
    expect(pub().passed).toHaveLength(2);
    expect(view(first).word).toBeNull();
    r.advance(GAP_MS);
    expect(pub().phase).toBe('ready');
    expect(pub().holder).toBe(s().queue[1]);
    expect(r.core.s.players.find((p) => p.id === first)!.score).toBe(1);
  });

  it('plays every turn, then shows final scores (with teams on)', () => {
    const { ids, r, s, act, pub } = setup({ teams: 'on', rounds: 1 }, 'en', 2);
    expect(Object.values(s().teams!).sort()).toEqual([0, 1]);
    for (let t = 0; t < 2; t++) {
      const h = s().queue[t];
      act(h, { type: 'start' });
      r.advance(COUNT_MS);
      act(h, { type: 'correct' });
      r.advance(20_000);
      act(ids[0], { type: 'next' });
    }
    expect(pub().phase).toBe('end');
    expect(pub().holder).toBeNull();
    expect(pub().score[ids[0]]).toBe(1);
    expect(pub().score[ids[1]]).toBe(1);
  });

  it('moves on when the holder leaves', () => {
    const { r, s, pub, act } = setup();
    const holder = s().queue[0];
    act(holder, { type: 'start' });
    r.core.removePlayer(holder);
    expect(pub().phase).toBe('ready');
    expect(pub().holder).toBe(s().queue[0]);
    expect(s().queue).not.toContain(holder);
  });
});
