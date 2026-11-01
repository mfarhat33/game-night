import { describe, expect, it } from 'vitest';
import { REVEAL_MS, triviaPoints, type TriviaState } from '../../src/server/games/trivia';
import { makeRoom } from './helpers';

const item = (id: string, topic: string, difficulty: number) => ({ id, topic, difficulty, q: `Q ${id}`, options: ['a', 'b', 'c', 'd'], answer: 1 });
const TRIVIA = {
  en: {
    sport: [1, 2, 3, 4, 5, 6].map((n) => item(`s${n}`, 'sport', (n % 3) + 1)),
    science: [1, 2, 3, 4, 5, 6].map((n) => item(`c${n}`, 'science', (n % 3) + 1)),
  },
  ar: { sport: [1, 2, 3, 4].map((n) => item(`as${n}`, 'sport', 1)) },
};

function setup(settings: Record<string, unknown> = {}, lang: 'en' | 'ar' = 'en', n = 3) {
  const r = makeRoom({ lang, trivia: TRIVIA });
  const ids = Array.from({ length: n }, (_, i) => r.add(`P${i}`).id);
  expect(r.core.handle(ids[0], { t: 'select', game: 'trivia', mode: 'screen', settings: { count: 3, seconds: 20, ...settings } })).toEqual({ ok: true });
  expect(r.core.handle(ids[0], { t: 'start' })).toEqual({ ok: true });
  const s = () => r.core.s.game!.state as TriviaState;
  const act = (pid: string, a: unknown) => r.core.handle(pid, { t: 'act', a });
  const pub = () => r.core.publicView() as any;
  const right = () => s().qs[s().i].answer;
  return { r, ids, s, act, pub, right };
}

describe('trivia', () => {
  it('scales points by speed', () => {
    expect(triviaPoints(0, 20_000)).toBe(100);
    expect(triviaPoints(10_000, 20_000)).toBe(75);
    expect(triviaPoints(20_000, 20_000)).toBe(50);
    expect(triviaPoints(90_000, 20_000)).toBe(50);
  });

  it('hides the answer until the reveal, which comes once everyone answered', () => {
    const { r, ids, act, pub, right, s } = setup();
    expect(pub().phase).toBe('question');
    expect(pub().answer).toBeNull();
    const k = right();
    expect(act(ids[0], { type: 'answer', choice: k })).toEqual({ ok: true });
    expect(act(ids[0], { type: 'answer', choice: 0 })).toMatchObject({ ok: false, detail: 'answered' });
    expect(act(ids[1], { type: 'answer', choice: 9 })).toMatchObject({ ok: false, detail: 'bad_choice' });
    r.advance(5000);
    act(ids[1], { type: 'answer', choice: k });
    act(ids[2], { type: 'answer', choice: (k + 1) % 4 });
    expect(pub().phase).toBe('reveal');
    expect(pub().answer).toBe(k);
    expect(s().gain[ids[0]]).toBeGreaterThan(s().gain[ids[1]]);
    expect(s().gain[ids[2]]).toBeUndefined();
    expect((r.core.playerView(ids[2]) as any).correct).toBe(false);
    expect(pub().board[0].pid).toBe(ids[0]);
    expect(r.core.s.players.find((p) => p.id === ids[0])!.score).toBe(s().gain[ids[0]]);
  });

  it('times out, auto-advances, lets only the host skip the reveal, and ends with a leaderboard', () => {
    const { r, ids, act, pub, right } = setup({ seconds: 10 });
    for (let q = 0; q < 3; q++) {
      expect(pub().i).toBe(q);
      act(ids[0], { type: 'answer', choice: right() });
      r.advance(10_000);
      expect(pub().phase).toBe('reveal');
      if (q === 1) {
        expect(act(ids[1], { type: 'next' })).toMatchObject({ ok: false });
        expect(act(ids[0], { type: 'next' })).toEqual({ ok: true });
      } else {
        r.advance(REVEAL_MS);
      }
    }
    expect(pub().phase).toBe('end');
    expect(pub().q).toBeNull();
    expect(pub().board[0].pid).toBe(ids[0]);
  });

  it('filters by difficulty and falls back to all topics when the topic has no content', () => {
    const hard = setup({ difficulty: '3', topic: 'sport', count: 3 });
    expect(hard.s().qs).toHaveLength(3); // only two hard ones exist, so the filter is dropped
    const hard2 = setup({ difficulty: '3', topic: 'science', count: 2 });
    expect(hard2.s().qs.every((q) => q.q.startsWith('Q c'))).toBe(true);
    const ar = setup({ topic: 'lbkw' }, 'ar');
    expect(ar.s().qs).toHaveLength(3);
    expect(ar.s().qs[0].q).toMatch(/^Q as/);
  });

  it('refuses to start without content', () => {
    const r = makeRoom();
    const a = r.add('A').id;
    r.add('B');
    r.core.handle(a, { t: 'select', game: 'trivia' });
    expect(r.core.handle(a, { t: 'start' })).toMatchObject({ ok: false, detail: 'no_content' });
  });
});
