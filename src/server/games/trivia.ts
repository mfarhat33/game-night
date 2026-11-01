// Trivia: multiple choice questions on a timer. Faster correct answers earn more points.
// Phase flow: question -> reveal (right answer + scores) -> next question ... -> end (leaderboard).
import { GameError, type GameCtx as Ctx, type GameDef } from './types';

export interface TriviaItem {
  id: string;
  q: string;
  options: string[];
  answer: number;
  difficulty?: number;
}
interface Q {
  q: string;
  options: string[];
  answer: number;
}
type Phase = 'question' | 'reveal' | 'end';

export interface TriviaState {
  phase: Phase;
  qs: Q[];
  i: number;
  ms: number;
  startedAt: number;
  deadline: number;
  answers: Record<string, { c: number; ms: number }>;
  gain: Record<string, number>;
  total: Record<string, number>;
}

export interface TriviaSettings extends Record<string, unknown> {
  topic: string;
  difficulty: string;
  count: number;
  seconds: number;
}

export const TRIVIA_TOPICS = ['lbkw', 'sport', 'histgeo', 'science'];
export const REVEAL_MS = 6000;
export const MAX_POINTS = 100;

/** 50..100 points for a correct answer: the sooner, the more. */
export function triviaPoints(elapsedMs: number, limitMs: number): number {
  const left = Math.min(1, Math.max(0, 1 - elapsedMs / limitMs));
  return Math.round(MAX_POINTS / 2 + (MAX_POINTS / 2) * left);
}

export const trivia: GameDef<TriviaState, TriviaSettings> = {
  id: 'trivia',
  minPlayers: 2,
  maxPlayers: 12,
  modes: ['screen', 'phones'],
  defaults: { topic: 'mixed', difficulty: 'mixed', count: 10, seconds: 20 },
  clampSettings: (s) => ({
    topic: s.topic === 'mixed' || TRIVIA_TOPICS.includes(s.topic) ? s.topic : 'mixed',
    difficulty: ['mixed', '1', '2', '3'].includes(s.difficulty) ? s.difficulty : 'mixed',
    count: Math.min(30, Math.max(3, Math.round(s.count))),
    seconds: Math.min(60, Math.max(5, Math.round(s.seconds))),
  }),

  start(ctx, settings) {
    const topics = settings.topic === 'mixed' ? TRIVIA_TOPICS : [settings.topic];
    const seen = new Set<string>();
    let pool: TriviaItem[] = [];
    const collect = (list: string[]) => {
      for (const t of list) for (const it of ctx.trivia<TriviaItem>(t)) if (!seen.has(it.id)) (seen.add(it.id), pool.push(it));
    };
    collect(topics);
    // A topic with no content in this language falls back to everything we have.
    if (!pool.length) collect(TRIVIA_TOPICS);
    if (settings.difficulty !== 'mixed') {
      const level = pool.filter((it) => it.difficulty === Number(settings.difficulty));
      if (level.length >= Math.min(settings.count, 3)) pool = level;
    }
    if (!pool.length) throw new GameError('no_content');
    const qs = ctx
      .shuffle(pool)
      .slice(0, settings.count)
      .map((it) => {
        const order = ctx.shuffle(it.options.map((_, k) => k));
        return { q: it.q, options: order.map((k) => it.options[k]), answer: order.indexOf(it.answer) };
      });
    const s: TriviaState = { phase: 'question', qs, i: 0, ms: settings.seconds * 1000, startedAt: 0, deadline: 0, answers: {}, gain: {}, total: {} };
    for (const p of ctx.playing) s.total[p] = 0;
    ask(ctx, s);
    return s;
  },

  action(ctx, s, pid, a) {
    const type = a && typeof a === 'object' ? (a as { type?: unknown }).type : undefined;
    if (type === 'answer' && s.phase === 'question') {
      const c = (a as { choice?: unknown }).choice;
      if (!ctx.playing.includes(pid)) throw new GameError('not_playing');
      if (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 3) throw new GameError('bad_choice');
      if (s.answers[pid]) throw new GameError('answered');
      s.answers[pid] = { c, ms: ctx.now() - s.startedAt };
      if (allAnswered(ctx, s)) reveal(ctx, s);
    } else if (type === 'next' && s.phase === 'reveal') {
      if (pid !== ctx.hostId) throw new GameError('host_only');
      advance(ctx, s);
    } else {
      throw new GameError('bad_action');
    }
  },

  timer(ctx, s, name) {
    if (name === 'q' && s.phase === 'question') reveal(ctx, s);
    else if (name === 'reveal' && s.phase === 'reveal') advance(ctx, s);
  },

  leave(ctx, s, pid) {
    delete s.answers[pid];
    delete s.total[pid];
    if (s.phase === 'question' && allAnswered(ctx, s)) reveal(ctx, s);
  },

  publicView(ctx, s) {
    const q = s.qs[s.i];
    const shown = s.phase !== 'end';
    const rev = s.phase === 'reveal';
    return {
      phase: s.phase,
      i: s.i,
      n: s.qs.length,
      q: shown ? q.q : null,
      options: shown ? q.options : null,
      deadline: s.deadline,
      answered: Object.keys(s.answers).length,
      players: ctx.playing.length,
      answer: rev ? q.answer : null,
      counts: rev ? [0, 1, 2, 3].map((k) => Object.values(s.answers).filter((x) => x.c === k).length) : null,
      board: board(ctx, s),
    };
  },

  playerView(_ctx, s, pid) {
    const mine = s.answers[pid];
    const rev = s.phase === 'reveal';
    return { choice: mine ? mine.c : null, correct: rev && mine ? mine.c === s.qs[s.i].answer : null, gain: rev ? s.gain[pid] ?? 0 : null };
  },
};

function board(ctx: Ctx, s: TriviaState) {
  const showGain = s.phase === 'reveal';
  return Object.entries(s.total)
    .map(([pid, score]) => ({ pid, score, gain: showGain ? s.gain[pid] ?? 0 : 0 }))
    .sort((a, b) => b.score - a.score || ctx.name(a.pid).localeCompare(ctx.name(b.pid)));
}

const allAnswered = (ctx: Ctx, s: TriviaState) => ctx.playing.every((p) => s.answers[p] || !ctx.isConnected(p));

function ask(ctx: Ctx, s: TriviaState): void {
  s.phase = 'question';
  s.answers = {};
  s.gain = {};
  s.startedAt = ctx.now();
  s.deadline = ctx.setTimer('q', s.ms);
}

function reveal(ctx: Ctx, s: TriviaState): void {
  ctx.clearTimer('q');
  s.phase = 'reveal';
  const right = s.qs[s.i].answer;
  for (const [pid, a] of Object.entries(s.answers)) {
    if (a.c !== right) continue;
    const pts = triviaPoints(a.ms, s.ms);
    s.gain[pid] = pts;
    s.total[pid] = (s.total[pid] ?? 0) + pts;
    ctx.award(pid, pts);
  }
  s.deadline = ctx.setTimer('reveal', REVEAL_MS);
}

function advance(ctx: Ctx, s: TriviaState): void {
  ctx.clearTimer('reveal');
  if (s.i + 1 >= s.qs.length) {
    s.phase = 'end';
    s.deadline = 0;
    s.gain = {};
  } else {
    s.i++;
    ask(ctx, s);
  }
}
