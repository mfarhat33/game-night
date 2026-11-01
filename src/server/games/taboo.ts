// Taboo: two teams. The clue giver gets a word and five banned words and gets their teammates to say it.
// The other team watches the card and hits the buzzer when a banned word slips out (-1, next card).
// Phase flow: teams (host can swap) -> per turn: ready -> play (timer) -> turnend -> ... -> end.
import { GameError, type GameCtx as Ctx, type GameDef } from './types';

interface Card {
  id: string;
  word: string;
  banned: string[];
}
type Phase = 'teams' | 'ready' | 'play' | 'turnend' | 'end';
type Mark = 'ok' | 'skip' | 'buzz';

export interface TabooState {
  phase: Phase;
  teams: Record<string, number>;
  score: [number, number];
  turn: number;
  turns: number;
  gi: [number, number];
  giver: string;
  deck: { word: string; banned: string[] }[];
  d: number;
  cur: { word: string; banned: string[] } | null;
  n: number;
  log: { w: string; m: Mark }[];
  ms: number;
  deadline: number;
}

export interface TabooSettings extends Record<string, unknown> {
  seconds: number;
  rounds: number;
}

export const GAP_MS = 8000;
export const READY_MS = 60_000;
const MAX_DECK = 120;

export const taboo: GameDef<TabooState, TabooSettings> = {
  id: 'taboo',
  minPlayers: 4,
  maxPlayers: 12,
  modes: ['phones', 'screen'],
  defaults: { seconds: 60, rounds: 2 },
  clampSettings: (s) => ({
    seconds: Math.min(120, Math.max(10, Math.round(s.seconds))),
    rounds: Math.min(5, Math.max(1, Math.round(s.rounds))),
  }),

  start(ctx, settings) {
    const cards = ctx.pack<Card>('taboo');
    if (!cards.length) throw new GameError('no_content');
    const teams: Record<string, number> = {};
    ctx.shuffle(ctx.playing).forEach((p, k) => (teams[p] = k % 2));
    return {
      phase: 'teams',
      teams,
      score: [0, 0],
      turn: 0,
      turns: settings.rounds * 2,
      gi: [0, 0],
      giver: '',
      deck: ctx.shuffle(cards).slice(0, MAX_DECK).map((c) => ({ word: c.word, banned: c.banned.slice(0, 5) })),
      d: 0,
      cur: null,
      n: 0,
      log: [],
      ms: settings.seconds * 1000,
      deadline: 0,
    };
  },

  action(ctx, s, pid, a) {
    const type = a && typeof a === 'object' ? (a as { type?: unknown }).type : undefined;
    const team = s.teams[pid];
    if (type === 'swap' && s.phase === 'teams') {
      if (pid !== ctx.hostId) throw new GameError('host_only');
      const who = (a as { pid?: unknown }).pid;
      if (typeof who !== 'string' || s.teams[who] === undefined) throw new GameError('bad_target');
      s.teams[who] = 1 - s.teams[who];
    } else if (type === 'begin' && s.phase === 'teams') {
      if (pid !== ctx.hostId) throw new GameError('host_only');
      if (size(s, 0) < 2 || size(s, 1) < 2) throw new GameError('teams_small');
      ready(ctx, s);
    } else if (type === 'start' && s.phase === 'ready') {
      if (pid !== s.giver) throw new GameError('not_giver');
      ctx.clearTimer('ready');
      s.phase = 'play';
      draw(s);
      s.deadline = ctx.setTimer('turn', s.ms);
    } else if ((type === 'correct' || type === 'skip') && s.phase === 'play') {
      if (pid !== s.giver) throw new GameError('not_giver');
      const n = (a as { n?: unknown }).n;
      if (typeof n === 'number' && n !== s.n) return;
      mark(s, type === 'correct' ? 'ok' : 'skip');
    } else if (type === 'buzz' && s.phase === 'play') {
      if (team === undefined || team === s.teams[s.giver]) throw new GameError('not_opponent');
      const n = (a as { n?: unknown }).n;
      if (typeof n === 'number' && n !== s.n) return; // someone else already buzzed this card
      mark(s, 'buzz');
    } else if (type === 'next' && (s.phase === 'turnend' || s.phase === 'ready')) {
      if (pid !== ctx.hostId && !(s.phase === 'turnend' && pid === s.giver)) throw new GameError('host_only');
      advance(ctx, s);
    } else {
      throw new GameError('bad_action');
    }
  },

  timer(ctx, s, name) {
    if (name === 'turn' && s.phase === 'play') {
      ctx.clearTimer('turn');
      s.cur = null;
      s.phase = 'turnend';
      s.deadline = ctx.setTimer('gap', GAP_MS);
    } else if ((name === 'gap' && s.phase === 'turnend') || (name === 'ready' && s.phase === 'ready')) {
      advance(ctx, s);
    }
  },

  leave(ctx, s, pid) {
    delete s.teams[pid];
    if (s.phase === 'end') return;
    if (size(s, 0) < 2 || size(s, 1) < 2) return finish(ctx, s);
    if (pid === s.giver && (s.phase === 'ready' || s.phase === 'play')) advance(ctx, s);
  },

  publicView(_ctx, s) {
    const over = s.phase === 'end';
    return {
      phase: s.phase,
      teams: s.teams,
      score: s.score,
      turn: s.turn + 1,
      turns: s.turns,
      team: s.turn % 2,
      giver: s.phase === 'teams' || over ? null : s.giver,
      deadline: s.deadline,
      log: s.phase === 'turnend' ? s.log : null,
      winner: over ? (s.score[0] === s.score[1] ? -1 : s.score[0] > s.score[1] ? 0 : 1) : null,
    };
  },

  // The giver and the watching team see the card; the guessing team must not.
  playerView(_ctx, s, pid) {
    const team = s.teams[pid];
    const turnTeam = s.turn % 2;
    const role = s.phase === 'teams' || s.phase === 'end' ? 'none' : pid === s.giver ? 'giver' : team === turnTeam ? 'guesser' : 'watcher';
    const sees = s.phase === 'play' && s.cur && (role === 'giver' || role === 'watcher');
    return { team: team ?? 0, role, card: sees ? s.cur : null, n: s.n };
  },
};

const size = (s: TabooState, team: number) => Object.values(s.teams).filter((t) => t === team).length;

function draw(s: TabooState): void {
  s.cur = s.deck[s.d++ % s.deck.length];
  s.n++;
}

function mark(s: TabooState, m: Mark): void {
  if (!s.cur) return;
  s.log.push({ w: s.cur.word, m });
  if (m === 'ok') s.score[s.turn % 2]++;
  if (m === 'buzz') s.score[s.turn % 2]--;
  draw(s);
}

function ready(ctx: Ctx, s: TabooState): void {
  const team = s.turn % 2;
  const members = ctx.playing.filter((p) => s.teams[p] === team);
  s.giver = members[s.gi[team]++ % members.length];
  s.phase = 'ready';
  s.cur = null;
  s.log = [];
  s.deadline = ctx.setTimer('ready', READY_MS);
}

function advance(ctx: Ctx, s: TabooState): void {
  for (const t of ['gap', 'ready', 'turn']) ctx.clearTimer(t);
  s.turn++;
  if (s.turn >= s.turns) finish(ctx, s);
  else ready(ctx, s);
}

function finish(ctx: Ctx, s: TabooState): void {
  for (const t of ['gap', 'ready', 'turn']) ctx.clearTimer(t);
  s.phase = 'end';
  s.cur = null;
  s.deadline = 0;
  if (s.score[0] === s.score[1]) for (const p of ctx.playing) ctx.award(p, 1);
  else {
    const win = s.score[0] > s.score[1] ? 0 : 1;
    for (const p of ctx.playing) if (s.teams[p] === win) ctx.award(p, 3);
  }
}
