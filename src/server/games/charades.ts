// Charades (heads up style): one player holds the phone on their forehead and the others act the word out.
// Tilt down = correct, tilt up = pass (the phone sends the action; buttons are the fallback).
// Phase flow per turn: ready (holder taps start) -> count (3 s) -> play (timer) -> turnend (summary).
import { GameError, type GameCtx as Ctx, type GameDef } from './types';

interface Word {
  id: string;
  word: string;
}
type Phase = 'ready' | 'count' | 'play' | 'turnend' | 'end';

export interface CharadesState {
  phase: Phase;
  queue: string[];
  i: number;
  deck: string[];
  d: number;
  ms: number;
  cur: string;
  n: number;
  right: string[];
  passed: string[];
  deadline: number;
  score: Record<string, number>;
  teams: Record<string, number> | null;
}

export interface CharadesSettings extends Record<string, unknown> {
  seconds: number;
  rounds: number;
  teams: string;
}

export const COUNT_MS = 3000;
export const GAP_MS = 8000;
export const READY_MS = 60_000;
const MAX_DECK = 200;

export const charades: GameDef<CharadesState, CharadesSettings> = {
  id: 'charades',
  minPlayers: 2,
  maxPlayers: 12,
  modes: ['phones', 'screen'],
  defaults: { seconds: 60, rounds: 1, teams: 'off' },
  clampSettings: (s) => ({
    seconds: Math.min(120, Math.max(10, Math.round(s.seconds))),
    rounds: Math.min(3, Math.max(1, Math.round(s.rounds))),
    teams: s.teams === 'on' ? 'on' : 'off',
  }),

  start(ctx, settings) {
    const words = ctx.pack<Word>('charades');
    if (!words.length) throw new GameError('no_content');
    const order = ctx.shuffle(ctx.playing);
    const queue: string[] = [];
    for (let r = 0; r < settings.rounds; r++) queue.push(...order);
    const teams: Record<string, number> | null = settings.teams === 'on' ? Object.fromEntries(order.map((p, k) => [p, k % 2])) : null;
    const s: CharadesState = {
      phase: 'ready',
      queue,
      i: 0,
      deck: ctx.shuffle(words.map((w) => w.word)).slice(0, MAX_DECK),
      d: 0,
      ms: settings.seconds * 1000,
      cur: '',
      n: 0,
      right: [],
      passed: [],
      deadline: 0,
      score: Object.fromEntries(ctx.playing.map((p) => [p, 0])),
      teams,
    };
    ready(ctx, s);
    return s;
  },

  action(ctx, s, pid, a) {
    const type = a && typeof a === 'object' ? (a as { type?: unknown }).type : undefined;
    const holder = s.queue[s.i];
    if (type === 'start' && s.phase === 'ready') {
      if (pid !== holder) throw new GameError('not_holder');
      ctx.clearTimer('ready');
      s.phase = 'count';
      s.deadline = ctx.setTimer('count', COUNT_MS);
    } else if ((type === 'correct' || type === 'pass') && s.phase === 'play') {
      if (pid !== holder) throw new GameError('not_holder');
      const n = (a as { n?: unknown }).n;
      if (typeof n === 'number' && n !== s.n) return; // a repeated tilt for a card already handled
      if (type === 'correct') {
        s.right.push(s.cur);
        s.score[pid] = (s.score[pid] ?? 0) + 1;
        ctx.award(pid, 1);
      } else {
        s.passed.push(s.cur);
      }
      draw(s);
    } else if (type === 'next' && (s.phase === 'turnend' || s.phase === 'ready')) {
      if (pid !== ctx.hostId && !(s.phase === 'turnend' && pid === holder)) throw new GameError('host_only');
      advance(ctx, s);
    } else {
      throw new GameError('bad_action');
    }
  },

  timer(ctx, s, name) {
    if (name === 'count' && s.phase === 'count') {
      s.phase = 'play';
      draw(s);
      s.deadline = ctx.setTimer('turn', s.ms);
    } else if (name === 'turn' && s.phase === 'play') {
      endTurn(ctx, s);
    } else if ((name === 'gap' && s.phase === 'turnend') || (name === 'ready' && s.phase === 'ready')) {
      advance(ctx, s);
    }
  },

  leave(ctx, s, pid) {
    if (s.phase === 'end') return;
    const holder = s.queue[s.i];
    s.queue = [...s.queue.slice(0, s.i), ...s.queue.slice(s.i).filter((p) => p !== pid)];
    if (pid !== holder) return;
    if (s.phase === 'turnend') {
      s.i--; // the summary stays up; advance() moves on to whoever is next in line
      return;
    }
    for (const t of ['ready', 'count', 'turn']) ctx.clearTimer(t);
    if (s.i >= s.queue.length) finish(ctx, s);
    else ready(ctx, s);
  },

  publicView(ctx, s) {
    const over = s.phase === 'end';
    return {
      phase: s.phase,
      holder: over ? null : s.queue[s.i] ?? null,
      turn: s.i + 1,
      turns: s.queue.length,
      deadline: s.deadline,
      score: s.score,
      teams: s.teams,
      right: s.phase === 'turnend' ? s.right : null,
      passed: s.phase === 'turnend' ? s.passed : null,
      players: ctx.playing,
    };
  },

  // Only the holder gets the word, and only while it is their turn.
  playerView(_ctx, s, pid) {
    const mine = pid === s.queue[s.i] && s.phase !== 'end';
    return { holder: mine, word: mine && s.phase === 'play' ? s.cur : null, n: s.n };
  },
};

function ready(ctx: Ctx, s: CharadesState): void {
  s.phase = 'ready';
  s.right = [];
  s.passed = [];
  s.cur = '';
  s.deadline = ctx.setTimer('ready', READY_MS);
}

function draw(s: CharadesState): void {
  s.cur = s.deck[s.d++ % s.deck.length];
  s.n++;
}

function endTurn(ctx: Ctx, s: CharadesState): void {
  ctx.clearTimer('turn');
  if (s.cur) s.passed.push(s.cur);
  s.cur = '';
  s.phase = 'turnend';
  s.deadline = ctx.setTimer('gap', GAP_MS);
}

function advance(ctx: Ctx, s: CharadesState): void {
  ctx.clearTimer('gap');
  ctx.clearTimer('ready');
  s.i++;
  if (s.i >= s.queue.length) finish(ctx, s);
  else ready(ctx, s);
}

function finish(ctx: Ctx, s: CharadesState): void {
  for (const t of ['ready', 'count', 'turn', 'gap']) ctx.clearTimer(t);
  s.phase = 'end';
  s.deadline = 0;
  s.cur = '';
}
