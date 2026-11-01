import { describe, expect, it } from 'vitest';
import type { TabooState } from '../../src/server/games/taboo';
import { makeRoom } from './helpers';

function setup(settings: Record<string, unknown> = {}, lang: 'en' | 'ar' = 'en', n = 4) {
  const r = makeRoom({ lang });
  const ids = Array.from({ length: n }, (_, i) => r.add(`P${i}`).id);
  r.core.handle(ids[0], { t: 'select', game: 'taboo', settings: { seconds: 20, rounds: 1, ...settings } });
  expect(r.core.handle(ids[0], { t: 'start' })).toEqual({ ok: true });
  const s = () => r.core.s.game!.state as TabooState;
  const act = (pid: string, a: unknown) => r.core.handle(pid, { t: 'act', a });
  const pub = () => r.core.publicView() as any;
  const view = (pid: string) => r.core.playerView(pid) as any;
  const begin = () => act(ids[0], { type: 'begin' });
  return { r, ids, s, act, pub, view, begin };
}

describe('taboo', () => {
  it('balances teams, lets only the host swap, and needs two per team', () => {
    for (const lang of ['en', 'ar'] as const) {
      const { ids, s, act, begin } = setup({}, lang, 5);
      const count = (t: number) => Object.values(s().teams).filter((x) => x === t).length;
      const of = (t: number) => Object.keys(s().teams).find((p) => s().teams[p] === t)!;
      expect(Math.abs(count(0) - count(1))).toBe(1);
      expect(act(ids[1], { type: 'swap', pid: ids[2] })).toMatchObject({ ok: false, detail: 'host_only' });
      // 3 v 2 -> 4 v 1 is not playable, moving one back is.
      const big = count(0) > count(1) ? 0 : 1;
      act(ids[0], { type: 'swap', pid: of(1 - big) });
      expect(begin()).toMatchObject({ ok: false, detail: 'teams_small' });
      act(ids[0], { type: 'swap', pid: of(big) });
      expect(begin()).toEqual({ ok: true });
    }
  });

  it('shows the card to the giver and the other team, never to the guessers or the board', () => {
    const { ids, s, act, pub, view, begin } = setup();
    begin();
    const giver = s().giver;
    const team = s().teams[giver];
    const mates = ids.filter((p) => p !== giver && s().teams[p] === team);
    const rivals = ids.filter((p) => s().teams[p] !== team);
    expect(view(giver).card).toBeNull();
    act(giver, { type: 'start' });
    expect(view(giver).card.banned).toHaveLength(5);
    for (const p of rivals) expect(view(p).card?.word).toBe(view(giver).card.word);
    for (const p of mates) expect(view(p).card).toBeNull();
    expect(JSON.stringify(pub())).not.toContain(view(giver).card.word);
  });

  it('scores correct, skip and the rivals buzzer, then rotates teams and givers', () => {
    const { r, ids, s, act, pub, view, begin } = setup({ rounds: 2 });
    begin();
    const givers: string[] = [];
    for (let t = 0; t < 4; t++) {
      const giver = s().giver;
      givers.push(giver);
      const team = s().teams[giver];
      expect(team).toBe(t % 2);
      const rival = ids.find((p) => s().teams[p] !== team)!;
      act(giver, { type: 'start' });
      const n = view(giver).n;
      expect(act(giver, { type: 'buzz', n })).toMatchObject({ ok: false, detail: 'not_opponent' });
      expect(act(rival, { type: 'skip' })).toMatchObject({ ok: false });
      act(giver, { type: 'correct', n });
      act(giver, { type: 'skip', n: n + 1 });
      act(rival, { type: 'buzz', n: n + 2 });
      act(rival, { type: 'buzz', n: n + 2 }); // a second buzzer on the same card is ignored
      expect(s().log.map((e) => e.m)).toEqual(['ok', 'skip', 'buzz']);
      r.advance(20_000);
      expect(pub().phase).toBe('turnend');
      expect(pub().log).toHaveLength(3);
      act(ids[0], { type: 'next' });
    }
    expect(pub().phase).toBe('end');
    expect(pub().score).toEqual([0, 0]);
    expect(new Set(givers).size).toBe(4);
    expect(pub().winner).toBe(-1);
    expect(r.core.s.players.every((p) => p.score === 1)).toBe(true);
  });

  it('gives the winning team the points', () => {
    const { r, ids, s, act, pub, view, begin } = setup({ rounds: 1 });
    begin();
    const giver = s().giver;
    act(giver, { type: 'start' });
    act(giver, { type: 'correct', n: view(giver).n });
    r.advance(20_000);
    act(ids[0], { type: 'next' });
    r.advance(20_000); // the other team's giver never starts: the ready timer skips the turn
    r.advance(60_000);
    expect(pub().phase).toBe('end');
    expect(pub().winner).toBe(s().teams[giver]);
    for (const p of r.core.s.players) expect(p.score).toBe(s().teams[p.id] === s().teams[giver] ? 3 : 0);
  });

  it('ends the game when a player leaves and fewer than four remain', () => {
    const { r, ids, begin } = setup();
    begin();
    r.core.removePlayer(ids[3]);
    expect(r.core.s.game).toBeNull();
  });
});
