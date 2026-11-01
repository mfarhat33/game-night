import { describe, expect, it } from 'vitest';
import { GUESS_MS, type SpyState } from '../../src/server/games/spy';
import { makeRoom } from './helpers';

type Priv = { spy: boolean; place: string | null; role: string | null };
type Pub = { phase: string; spy: string | null; place: string | null; outcome: string | null; options: string[]; points: Record<string, number> | null };

function setup(lang: 'en' | 'ar' = 'en', seed = 7, n = 4) {
  const r = makeRoom({ lang, seed });
  const ids = Array.from({ length: n }, (_, i) => r.add(`P${i}`).id);
  expect(r.core.handle(ids[0], { t: 'start' })).toEqual({ ok: true });
  const s = r.core.s.game!.state as SpyState;
  const act = (pid: string, a: unknown) => r.core.handle(pid, { t: 'act', a });
  const pub = () => r.core.publicView() as Pub;
  return { r, ids, s, act, pub, others: ids.filter((p) => p !== s.spy) };
}

describe('spy', () => {
  it('gives everyone the same place except exactly one spy', () => {
    for (const lang of ['en', 'ar'] as const) {
      const { r, ids } = setup(lang);
      const views = ids.map((id) => r.core.playerView(id) as Priv);
      expect(views.filter((v) => v.spy)).toHaveLength(1);
      const places = new Set(views.filter((v) => !v.spy).map((v) => v.place));
      expect(places.size).toBe(1);
      expect(views.find((v) => v.spy)!.place).toBeNull();
      expect(views.every((v) => v.spy || v.role)).toBe(true);
    }
  });

  it('never leaks the spy or place in the public view while playing', () => {
    const { pub, s } = setup();
    const v = pub();
    expect(v.spy).toBeNull();
    expect(v.place).toBeNull();
    expect(v.options).toContain(s.place);
  });

  it('moves to voting when a majority is ready, then the caught spy guesses wrong', () => {
    const { r, ids, s, act, pub, others } = setup();
    act(ids[0], { type: 'ready' });
    act(ids[1], { type: 'ready' });
    expect(pub().phase).toBe('play');
    act(ids[2], { type: 'ready' });
    expect(pub().phase).toBe('vote');
    expect(act(ids[0], { type: 'vote', target: ids[0] })).toMatchObject({ ok: false, detail: 'bad_target' });
    for (const p of others) act(p, { type: 'vote', target: s.spy });
    act(s.spy, { type: 'vote', target: others[0] });
    expect(pub().phase).toBe('guess');
    expect(pub().spy).toBe(s.spy);
    expect(act(others[0], { type: 'guess', place: s.place })).toMatchObject({ ok: false, detail: 'not_spy' });
    const wrong = s.options.find((o) => o !== s.place)!;
    act(s.spy, { type: 'guess', place: wrong });
    const v = pub();
    expect(v).toMatchObject({ phase: 'result', outcome: 'caught', place: s.place });
    for (const p of others) expect(v.points![p]).toBe(2);
    expect(r.core.snapshot().players.find((p) => p.id === s.spy)!.score).toBe(0);
  });

  it('a caught spy who names the place steals the round', () => {
    const { r, s, act, pub, others } = setup();
    r.advance(6 * 60_000);
    expect(pub().phase).toBe('vote');
    for (const p of others) act(p, { type: 'vote', target: s.spy });
    act(s.spy, { type: 'vote', target: others[0] });
    act(s.spy, { type: 'guess', place: s.place });
    expect(pub()).toMatchObject({ outcome: 'stole', points: { [s.spy]: 2 } });
  });

  it('the spy escapes on a tie or wrong accusation, and when the guess times out the spy loses', () => {
    const a = setup('en', 11);
    a.r.advance(6 * 60_000);
    a.r.advance(60_000); // nobody voted
    expect(a.pub()).toMatchObject({ phase: 'result', outcome: 'escaped' });

    const b = setup('en', 12);
    b.r.advance(6 * 60_000);
    for (const p of b.ids) b.act(p, { type: 'vote', target: p === b.s.spy ? b.others[0] : b.s.spy });
    expect(b.pub().phase).toBe('guess');
    b.r.advance(GUESS_MS);
    expect(b.pub().outcome).toBe('caught');
  });

  it('ends the round when the spy leaves', () => {
    const { r, s, pub } = setup('en', 5, 5);
    r.core.handle(s.spy, { t: 'leave' });
    expect(pub()).toMatchObject({ phase: 'result', outcome: 'left' });
  });

  it('plays again with a fresh place and keeps scores', () => {
    const { r, ids } = setup();
    r.core.s.players[0].score = 3;
    expect(r.core.handle(ids[0], { t: 'again' })).toEqual({ ok: true });
    expect((r.core.publicView() as Pub).phase).toBe('play');
    expect(r.core.s.players[0].score).toBe(3);
  });
});
