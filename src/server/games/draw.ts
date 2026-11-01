// Draw and guess: one player draws a secret word on a canvas, everyone else types guesses.
// The server owns the stroke log (compact integer point lists) so a reconnecting phone or the TV can redraw it.
import { GameError, type GameCtx as Ctx, type GameDef } from './types';

export interface DrawWord {
  id: string;
  word: string;
  difficulty?: number;
}

/** One stroke: colour index, width index and a flat [x0, y0, x1, y1, ...] list on a 0..1000 grid. */
export interface Stroke {
  c: number;
  w: number;
  p: number[];
}

type Phase = 'choose' | 'draw' | 'reveal' | 'end';
interface Entry {
  p: string;
  t: string;
  ok: boolean;
}

export interface DrawState {
  phase: Phase;
  order: string[];
  turn: number;
  drawer: string;
  options: string[];
  word: string;
  used: string[];
  strokes: Stroke[];
  feed: Entry[];
  correct: string[];
  gain: Record<string, number>;
  tot: Record<string, number>;
  deadline: number;
  drawMs: number;
  /** Changes with every turn, so clients know when to wipe their canvas. */
  stamp: number;
}

export interface DrawSettings extends Record<string, unknown> {
  seconds: number;
  rounds: number;
}

export const CHOOSE_MS = 15_000;
export const REVEAL_MS = 4_000;
export const COLORS = 3;
export const WIDTHS = 2;
export const MAX_POINTS = 8000;
export const MAX_STROKES = 300;
const MAX_BATCH = 240;
const MAX_FEED = 40;
const MAX_TEXT = 40;
const GRID = 1000;

/** Make two guesses comparable: case, spaces, Arabic letter variants and tashkeel do not matter. */
export function normalizeGuess(raw: string): string {
  const s = raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ـً-ٰٟۖ-ۭ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '')
    .replace(/\s/g, '');
  return s.length > 3 && s.startsWith('ال') ? s.slice(2) : s;
}

export const draw: GameDef<DrawState, DrawSettings> = {
  id: 'draw',
  minPlayers: 2,
  maxPlayers: 12,
  modes: ['phones', 'screen'],
  defaults: { seconds: 75, rounds: 1 },
  clampSettings: (s) => ({
    seconds: Math.min(180, Math.max(30, Math.round(s.seconds))),
    rounds: Math.min(3, Math.max(1, Math.round(s.rounds))),
  }),

  start(ctx, settings) {
    if (ctx.pack<DrawWord>('draw').length < 1) throw new GameError('no_content');
    const base = ctx.shuffle(ctx.playing);
    const order: string[] = [];
    for (let r = 0; r < settings.rounds; r++) order.push(...base);
    const s: DrawState = {
      phase: 'choose',
      order,
      turn: -1,
      drawer: '',
      options: [],
      word: '',
      used: [],
      strokes: [],
      feed: [],
      correct: [],
      gain: {},
      tot: {},
      deadline: 0,
      drawMs: settings.seconds * 1000,
      stamp: 0,
    };
    nextTurn(ctx, s);
    return s;
  },

  action(ctx, s, pid, a) {
    const type = a && typeof a === 'object' ? (a as { type?: unknown }).type : undefined;
    if (!ctx.playing.includes(pid)) throw new GameError('not_playing');
    if (type === 'pick' && s.phase === 'choose') {
      if (pid !== s.drawer) throw new GameError('not_drawer');
      const i = (a as { i?: unknown }).i;
      if (typeof i !== 'number' || !s.options[i]) throw new GameError('bad_choice');
      begin(ctx, s, s.options[i]);
    } else if (type === 'guess' && s.phase === 'draw') {
      guess(ctx, s, pid, (a as { text?: unknown }).text);
    } else if (s.phase === 'draw' && (type === 'pts' || type === 'undo' || type === 'clear')) {
      if (pid !== s.drawer) throw new GameError('not_drawer');
      if (type === 'undo') s.strokes.pop();
      else if (type === 'clear') s.strokes = [];
      else addPoints(s, a as { c?: unknown; w?: unknown; n?: unknown; p?: unknown });
    } else {
      throw new GameError('bad_action');
    }
  },

  timer(ctx, s, name) {
    if (name === 'choose' && s.phase === 'choose') begin(ctx, s, s.options[0]);
    else if (name === 'turn' && s.phase === 'draw') endTurn(ctx, s);
    else if (name === 'next' && s.phase === 'reveal') nextTurn(ctx, s);
  },

  leave(ctx, s, pid) {
    s.order = s.order.filter((p, i) => i <= s.turn || p !== pid);
    if (s.phase === 'end') return;
    if (pid === s.drawer) {
      if (s.phase === 'choose' || s.phase === 'draw') {
        s.word = s.word || s.options[0] || '';
        endTurn(ctx, s);
      }
    } else if (s.phase === 'draw') checkAll(ctx, s);
  },

  publicView(_ctx, s) {
    const show = s.phase === 'reveal' || s.phase === 'end';
    return {
      phase: s.phase,
      turn: s.turn,
      stamp: s.stamp,
      turns: s.order.length,
      drawer: s.drawer,
      deadline: s.deadline,
      hint: s.phase === 'draw' ? wordShape(s.word) : null,
      word: show ? s.word : null,
      strokes: s.phase === 'choose' ? [] : s.strokes,
      feed: s.feed,
      correct: s.correct,
      gain: show ? s.gain : null,
      tot: s.tot,
    };
  },

  playerView(_ctx, s, pid) {
    const drawer = pid === s.drawer;
    return {
      drawer,
      correct: s.correct.includes(pid),
      options: drawer && s.phase === 'choose' ? s.options : null,
      word: s.phase === 'draw' && (drawer || s.correct.includes(pid)) ? s.word : null,
    };
  },
};

/** Word lengths, e.g. [3, 5] for "ice cream"; spaces split words. */
function wordShape(word: string): number[] {
  return word
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w].length);
}

function nextTurn(ctx: Ctx, s: DrawState): void {
  ctx.clearTimer('next');
  let i = s.turn + 1;
  while (i < s.order.length && !ctx.playing.includes(s.order[i])) i++;
  s.turn = i;
  s.stamp = ctx.now();
  s.strokes = [];
  s.feed = [];
  s.correct = [];
  s.gain = {};
  if (i >= s.order.length) {
    s.phase = 'end';
    s.deadline = 0;
    s.drawer = '';
    return;
  }
  const all = ctx.pack<DrawWord>('draw');
  const fresh = all.filter((w) => !s.used.includes(w.id));
  const seen = new Set<string>();
  const options: DrawWord[] = [];
  for (const w of ctx.shuffle(fresh.length >= 3 ? fresh : all)) {
    if (seen.has(w.word)) continue;
    seen.add(w.word);
    options.push(w);
    if (options.length === 3) break;
  }
  s.phase = 'choose';
  s.drawer = s.order[i];
  s.options = options.map((w) => w.word);
  s.used = [...s.used, ...options.map((w) => w.id)].slice(-60);
  s.word = '';
  s.deadline = ctx.setTimer('choose', CHOOSE_MS);
}

function begin(ctx: Ctx, s: DrawState, word: string): void {
  ctx.clearTimer('choose');
  s.word = word;
  s.options = [];
  s.phase = 'draw';
  s.deadline = ctx.setTimer('turn', s.drawMs);
}

function guess(ctx: Ctx, s: DrawState, pid: string, raw: unknown): void {
  if (pid === s.drawer) throw new GameError('drawer_cant_guess');
  if (s.correct.includes(pid)) throw new GameError('already');
  if (typeof raw !== 'string') throw new GameError('bad_guess');
  const text = raw.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!text) throw new GameError('bad_guess');
  if (normalizeGuess(text) !== normalizeGuess(s.word)) return void pushFeed(s, { p: pid, t: text, ok: false });
  // Faster is better: 2 to 5 points by time left, plus one for the first to get it.
  const left = Math.max(0, s.deadline - ctx.now());
  const pts = 1 + Math.ceil((4 * left) / s.drawMs) + (s.correct.length === 0 ? 1 : 0);
  s.correct.push(pid);
  pushFeed(s, { p: pid, t: '', ok: true });
  give(ctx, s, pid, pts);
  give(ctx, s, s.drawer, 2);
  checkAll(ctx, s);
}

function give(ctx: Ctx, s: DrawState, pid: string, n: number): void {
  ctx.award(pid, n);
  s.gain[pid] = (s.gain[pid] ?? 0) + n;
  s.tot[pid] = (s.tot[pid] ?? 0) + n;
}

function pushFeed(s: DrawState, e: Entry): void {
  s.feed.push(e);
  if (s.feed.length > MAX_FEED) s.feed.splice(0, s.feed.length - MAX_FEED);
}

function checkAll(ctx: Ctx, s: DrawState): void {
  const guessers = ctx.playing.filter((p) => p !== s.drawer && ctx.isConnected(p));
  if (s.correct.length > 0 && guessers.every((p) => s.correct.includes(p))) endTurn(ctx, s);
}

function endTurn(ctx: Ctx, s: DrawState): void {
  ctx.clearTimer('turn');
  ctx.clearTimer('choose');
  s.phase = 'reveal';
  s.deadline = ctx.setTimer('next', REVEAL_MS);
}

const int = (v: number): number => Math.min(GRID, Math.max(0, Math.round(v)));
const total = (s: DrawState): number => s.strokes.reduce((n, k) => n + k.p.length, 0);

function addPoints(s: DrawState, a: { c?: unknown; w?: unknown; n?: unknown; p?: unknown }): void {
  const p = a.p;
  if (!Array.isArray(p) || p.length < 2 || p.length % 2 || p.length > MAX_BATCH || p.some((v) => typeof v !== 'number' || !Number.isFinite(v))) throw new GameError('bad_points');
  const pts = (p as number[]).map(int);
  if (total(s) + pts.length > MAX_POINTS * 2) throw new GameError('too_much');
  const last = s.strokes[s.strokes.length - 1];
  if (a.n === true || !last) {
    const c = Number(a.c);
    const w = Number(a.w);
    if (!Number.isInteger(c) || c < 0 || c >= COLORS || !Number.isInteger(w) || w < 0 || w >= WIDTHS) throw new GameError('bad_style');
    if (s.strokes.length >= MAX_STROKES) throw new GameError('too_much');
    s.strokes.push({ c, w, p: pts });
  } else {
    last.p.push(...pts);
  }
}
