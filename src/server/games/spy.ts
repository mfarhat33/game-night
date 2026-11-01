// Spy: everyone gets the same place and a role, except one spy who only sees a list of possible places.
// Players question each other, then vote. If the spy is caught they get one last guess at the place.
import { GameError, type GameCtx as Ctx, type GameDef } from './types';

export interface SpyPlace {
  id: string;
  place: string;
  pack: string;
  roles: string[];
}

type Phase = 'play' | 'vote' | 'guess' | 'result';
type Outcome = 'escaped' | 'caught' | 'stole' | 'left';

export interface SpyState {
  phase: Phase;
  place: string;
  spy: string;
  first: string;
  roles: Record<string, string>;
  options: string[];
  deadline: number;
  voteMs: number;
  ready: string[];
  votes: Record<string, string>;
  accused: string | null;
  guess: string | null;
  outcome: Outcome | null;
  points: Record<string, number>;
}

export interface SpySettings extends Record<string, unknown> {
  minutes: number;
  voteSeconds: number;
  pack: string;
}

export const SPY_PACKS = ['all', 'lebanon', 'kuwait', 'general'];
export const GUESS_MS = 30_000;
const MAX_OPTIONS = 16;

export const spy: GameDef<SpyState, SpySettings> = {
  id: 'spy',
  minPlayers: 3,
  maxPlayers: 12,
  modes: ['phones', 'screen'],
  defaults: { minutes: 6, voteSeconds: 60, pack: 'all' },
  clampSettings: (s) => ({
    minutes: Math.min(15, Math.max(1, Math.round(s.minutes))),
    voteSeconds: Math.min(180, Math.max(15, Math.round(s.voteSeconds))),
    pack: SPY_PACKS.includes(s.pack) ? s.pack : 'all',
  }),

  start(ctx, settings) {
    const all = ctx.pack<SpyPlace>('spy');
    const chosen = settings.pack === 'all' ? all : all.filter((p) => p.pack === settings.pack);
    const places = chosen.length ? chosen : all;
    if (!places.length) throw new GameError('no_content');
    const place = ctx.pick(places);
    const spyId = ctx.pick(ctx.playing);
    const roles = ctx.shuffle(place.roles);
    const roleOf: Record<string, string> = {};
    ctx.playing.filter((p) => p !== spyId).forEach((p, i) => (roleOf[p] = roles[i % roles.length]));
    const others = ctx.shuffle(places.filter((p) => p.place !== place.place).map((p) => p.place)).slice(0, MAX_OPTIONS - 1);
    return {
      phase: 'play',
      place: place.place,
      spy: spyId,
      first: ctx.pick(ctx.playing),
      roles: roleOf,
      options: ctx.shuffle([...others, place.place]),
      deadline: ctx.setTimer('round', settings.minutes * 60_000),
      voteMs: settings.voteSeconds * 1000,
      ready: [],
      votes: {},
      accused: null,
      guess: null,
      outcome: null,
      points: {},
    };
  },

  action(ctx, s, pid, a) {
    const type = a && typeof a === 'object' ? (a as { type?: unknown }).type : undefined;
    if (type === 'ready' && s.phase === 'play') {
      if (!ctx.playing.includes(pid)) throw new GameError('not_playing');
      s.ready = s.ready.includes(pid) ? s.ready.filter((x) => x !== pid) : [...s.ready, pid];
      if (s.ready.length >= need(ctx.playing.length)) toVote(ctx, s);
    } else if (type === 'vote' && s.phase === 'vote') {
      const target = (a as { target?: unknown }).target;
      if (!ctx.playing.includes(pid)) throw new GameError('not_playing');
      if (typeof target !== 'string' || target === pid || !ctx.playing.includes(target)) throw new GameError('bad_target');
      s.votes[pid] = target;
      if (allVoted(ctx, s)) tally(ctx, s);
    } else if (type === 'guess' && s.phase === 'guess') {
      const place = (a as { place?: unknown }).place;
      if (pid !== s.spy) throw new GameError('not_spy');
      if (typeof place !== 'string' || !s.options.includes(place)) throw new GameError('bad_place');
      resolve(ctx, s, place);
    } else {
      throw new GameError('bad_action');
    }
  },

  timer(ctx, s, name) {
    if (name === 'round' && s.phase === 'play') toVote(ctx, s);
    else if (name === 'vote' && s.phase === 'vote') tally(ctx, s);
    else if (name === 'guess' && s.phase === 'guess') resolve(ctx, s, null);
  },

  leave(ctx, s, pid) {
    s.ready = s.ready.filter((x) => x !== pid);
    delete s.votes[pid];
    for (const [voter, target] of Object.entries(s.votes)) if (target === pid) delete s.votes[voter];
    if (s.phase === 'result') return;
    if (pid === s.spy) {
      s.outcome = 'left';
      finish(ctx, s);
    } else if (s.phase === 'play' && s.ready.length >= need(ctx.playing.length)) toVote(ctx, s);
    else if (s.phase === 'vote' && allVoted(ctx, s)) tally(ctx, s);
  },

  publicView(ctx, s) {
    const done = s.phase === 'result';
    return {
      phase: s.phase,
      deadline: s.deadline,
      first: s.first,
      options: s.options,
      ready: s.ready.length,
      need: need(ctx.playing.length),
      voted: Object.keys(s.votes).length,
      total: ctx.playing.length,
      spy: s.phase === 'guess' || done ? s.spy : null,
      place: done ? s.place : null,
      votes: done || s.phase === 'guess' ? s.votes : null,
      accused: s.accused,
      guess: done ? s.guess : null,
      outcome: s.outcome,
      points: done ? s.points : null,
    };
  },

  playerView(_ctx, s, pid) {
    const isSpy = pid === s.spy;
    return {
      spy: isSpy,
      place: isSpy ? null : s.place,
      role: isSpy ? null : s.roles[pid] ?? null,
      ready: s.ready.includes(pid),
      vote: s.votes[pid] ?? null,
    };
  },
};

const need = (n: number) => Math.floor(n / 2) + 1;

function allVoted(ctx: Ctx, s: SpyState): boolean {
  return ctx.playing.every((p) => s.votes[p] || !ctx.isConnected(p));
}

function toVote(ctx: Ctx, s: SpyState): void {
  ctx.clearTimer('round');
  s.phase = 'vote';
  s.votes = {};
  s.deadline = ctx.setTimer('vote', s.voteMs);
}

function tally(ctx: Ctx, s: SpyState): void {
  ctx.clearTimer('vote');
  const counts = new Map<string, number>();
  for (const t of Object.values(s.votes)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const max = Math.max(0, ...counts.values());
  const leaders = [...counts].filter(([, n]) => n === max).map(([p]) => p);
  s.accused = max > 0 && leaders.length === 1 ? leaders[0] : null;
  if (s.accused === s.spy) {
    s.phase = 'guess';
    s.deadline = ctx.setTimer('guess', GUESS_MS);
  } else {
    s.outcome = 'escaped';
    finish(ctx, s);
  }
}

function resolve(ctx: Ctx, s: SpyState, guess: string | null): void {
  ctx.clearTimer('guess');
  s.guess = guess;
  s.outcome = guess === s.place ? 'stole' : 'caught';
  finish(ctx, s);
}

function finish(ctx: Ctx, s: SpyState): void {
  for (const t of ['round', 'vote', 'guess']) ctx.clearTimer(t);
  s.phase = 'result';
  s.deadline = 0;
  const pts: Record<string, number> = {};
  if (s.outcome === 'escaped' || s.outcome === 'stole') pts[s.spy] = 2;
  if (s.outcome === 'caught') {
    for (const p of ctx.playing) if (p !== s.spy) pts[p] = 1 + (s.votes[p] === s.spy ? 1 : 0);
  }
  s.points = pts;
  for (const [p, n] of Object.entries(pts)) ctx.award(p, n);
}
