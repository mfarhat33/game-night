// Shabakeh (شبكة), a team word game on a 5x5 grid of words.
// Each team has a Guide who alone sees the secret key: which tiles belong to which team, which are
// neutral, and which one is the trap. The Guide gives a one word clue plus a number; teammates tap tiles.
// A wrong tile ends the turn. Tap the trap and your team loses. Find all your tiles first to win.
import { GameError, type GameCtx as Ctx, type GameDef } from './types';
import { normalizeGuess } from './draw';

export interface GridWord {
  id: string;
  word: string;
}

export const SIZE = 25;
export const NEUTRAL = 2;
export const TRAP = 3;
export const WIN_POINTS = 3;
type Team = 0 | 1;
type Phase = 'clue' | 'guess' | 'over';
type Reason = 'found' | 'trap' | 'forfeit';

export interface GridState {
  phase: Phase;
  words: string[];
  /** Per tile: 0 or 1 = that team, 2 = neutral, 3 = trap. Secret until the end. */
  key: number[];
  up: boolean[];
  teams: [string[], string[]];
  guide: [string, string];
  turn: Team;
  clue: { word: string; num: number } | null;
  left: number;
  picks: number;
  winner: Team | null;
  reason: Reason | null;
  last: { team: Team; i: number } | null;
}

export const wordgrid: GameDef<GridState, Record<string, never>> = {
  id: 'wordgrid',
  minPlayers: 4,
  maxPlayers: 12,
  modes: ['phones', 'screen'],
  defaults: {},

  start(ctx) {
    const seen = new Set<string>();
    const words: string[] = [];
    for (const w of ctx.shuffle(ctx.pack<GridWord>('wordgrid'))) {
      const n = normalizeGuess(w.word);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      words.push(w.word);
      if (words.length === SIZE) break;
    }
    if (words.length < SIZE) throw new GameError('no_content');
    const first = (ctx.rand() < 0.5 ? 0 : 1) as Team;
    const kinds = [...Array(9).fill(first), ...Array(8).fill(1 - first), ...Array(7).fill(NEUTRAL), TRAP];
    const people = ctx.shuffle(ctx.playing);
    const teams: [string[], string[]] = [[], []];
    people.forEach((p, i) => teams[i % 2].push(p));
    return {
      phase: 'clue',
      words,
      key: ctx.shuffle(kinds),
      up: Array(SIZE).fill(false),
      teams,
      guide: [teams[0][0], teams[1][0]],
      turn: first,
      clue: null,
      left: 0,
      picks: 0,
      winner: null,
      reason: null,
      last: null,
    };
  },

  action(ctx, s, pid, a) {
    const type = a && typeof a === 'object' ? (a as { type?: unknown }).type : undefined;
    const team = teamOf(s, pid);
    if (team === null) throw new GameError('not_playing');
    if (s.phase === 'over') throw new GameError('over');
    if (team !== s.turn) throw new GameError('not_your_turn');
    const isGuide = s.guide[team] === pid;
    if (type === 'clue' && s.phase === 'clue') {
      if (!isGuide) throw new GameError('not_guide');
      giveClue(s, a as { word?: unknown; num?: unknown });
    } else if (type === 'pick' && s.phase === 'guess') {
      if (isGuide) throw new GameError('guide_cant_pick');
      const i = (a as { i?: unknown }).i;
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= SIZE || s.up[i]) throw new GameError('bad_tile');
      pick(ctx, s, i);
    } else if (type === 'pass' && s.phase === 'guess') {
      if (isGuide) throw new GameError('guide_cant_pick');
      if (s.picks < 1) throw new GameError('pick_first');
      swap(s);
    } else {
      throw new GameError('bad_action');
    }
  },

  leave(ctx, s, pid) {
    const team = teamOf(s, pid);
    if (team !== null) s.teams[team] = s.teams[team].filter((p) => p !== pid);
    if (s.phase === 'over') return;
    for (const t of [0, 1] as Team[]) {
      // A team needs a Guide plus at least one guesser.
      if (s.teams[t].length < 2) return finish(ctx, s, (1 - t) as Team, 'forfeit');
      if (!s.teams[t].includes(s.guide[t])) s.guide[t] = s.teams[t][0];
    }
  },

  publicView(ctx, s) {
    const over = s.phase === 'over';
    return {
      phase: s.phase,
      tiles: s.words.map((w, i) => ({ w, up: s.up[i], k: s.up[i] || over ? s.key[i] : null })),
      teams: s.teams,
      guide: s.guide,
      turn: s.turn,
      clue: s.clue,
      left: s.left,
      picks: s.picks,
      todo: [todo(s, 0), todo(s, 1)],
      winner: s.winner,
      reason: s.reason,
      last: s.last,
      total: ctx.playing.length,
    };
  },

  playerView(_ctx, s, pid) {
    const team = teamOf(s, pid);
    const guide = team !== null && s.guide[team] === pid;
    return { team, guide, key: guide ? s.key : null };
  },
};

const teamOf = (s: GridState, pid: string): Team | null => (s.teams[0].includes(pid) ? 0 : s.teams[1].includes(pid) ? 1 : null);
const todo = (s: GridState, t: Team): number => s.key.filter((k, i) => k === t && !s.up[i]).length;

function giveClue(s: GridState, a: { word?: unknown; num?: unknown }): void {
  const word = typeof a.word === 'string' ? a.word.replace(/[<>]/g, '').trim() : '';
  if (!word || word.length > 24 || /\s/.test(word)) throw new GameError('one_word');
  const num = a.num;
  if (typeof num !== 'number' || !Number.isInteger(num) || num < 1 || num > 9) throw new GameError('bad_number');
  const c = normalizeGuess(word);
  if (!c) throw new GameError('one_word');
  for (let i = 0; i < SIZE; i++) {
    if (s.up[i]) continue;
    const w = normalizeGuess(s.words[i]);
    if (w === c || (Math.min(w.length, c.length) >= 3 && (w.includes(c) || c.includes(w)))) throw new GameError('clue_on_board');
  }
  s.clue = { word, num };
  s.left = num + 1;
  s.picks = 0;
  s.phase = 'guess';
}

function pick(ctx: Ctx, s: GridState, i: number): void {
  const mine = s.turn;
  s.up[i] = true;
  s.picks++;
  s.left--;
  s.last = { team: mine, i };
  const k = s.key[i];
  if (k === TRAP) return finish(ctx, s, (1 - mine) as Team, 'trap');
  if (todo(s, 0) === 0) return finish(ctx, s, 0, 'found');
  if (todo(s, 1) === 0) return finish(ctx, s, 1, 'found');
  if (k !== mine || s.left <= 0) swap(s);
}

function swap(s: GridState): void {
  s.turn = (1 - s.turn) as Team;
  s.phase = 'clue';
  s.clue = null;
  s.left = 0;
  s.picks = 0;
}

function finish(ctx: Ctx, s: GridState, winner: Team, reason: Reason): void {
  s.phase = 'over';
  s.winner = winner;
  s.reason = reason;
  for (const p of s.teams[winner]) ctx.award(p, WIN_POINTS);
}
