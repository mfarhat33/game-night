// Room logic with no Cloudflare APIs, so it can be unit tested in plain Node.
// The Durable Object (room.ts) feeds it messages and presence, then persists and broadcasts.
import {
  CLOSE_KICKED,
  CLOSE_LEFT,
  LANGS,
  MAX_PLAYERS,
  NAME_MAX,
  type ClientMsg,
  type ConnKind,
  type ErrorCode,
  type Lang,
  type Mode,
  type RoomSnapshot,
  type Selection,
} from '../shared/protocol';
import { GameError, type GameCtx, type GameDef } from './games/types';

export interface Player {
  id: string;
  name: string;
  token: string;
  joinedAt: number;
  score: number;
}

export interface GameRun {
  id: string;
  mode: Mode;
  playing: string[];
  settings: Record<string, unknown>;
  state: unknown;
}

export interface RoomState {
  v: 1;
  code: string;
  createdAt: number;
  lastActive: number;
  lang: Lang;
  hostId: string | null;
  players: Player[];
  sel: Selection;
  game: GameRun | null;
  /** Named deadlines in ms. "host" for host hand-over, "g:<name>" for game timers. */
  timers: Record<string, number>;
  seq: number;
}

export interface Deps {
  now(): number;
  rand(): number;
  token(): string;
  games: Record<string, GameDef>;
  pack(lang: Lang, name: string): unknown[];
  trivia(lang: Lang, topic: string): unknown[];
}

export const HOST_GRACE_MS = 20_000;
export const IDLE_MS = 12 * 60 * 60 * 1000;

export type Close = { pid: string; code: number; reason: 'kicked' | 'left' };
export type Outcome = { ok: true; close?: Close[] } | { ok: false; code: ErrorCode; detail?: string };
export type JoinResult = { ok: true; pid: string | null; token: string | null; kind: ConnKind } | { ok: false; code: ErrorCode };

export function newRoom(code: string, lang: Lang, games: Record<string, GameDef>, now: number): RoomState {
  const first = Object.values(games)[0];
  return {
    v: 1,
    code,
    createdAt: now,
    lastActive: now,
    lang,
    hostId: null,
    players: [],
    sel: { game: first?.id ?? '', mode: first?.modes[0] ?? 'phones', settings: { ...(first?.defaults ?? {}) } },
    game: null,
    timers: {},
    seq: 0,
  };
}

export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

function sanitizeSettings(def: GameDef, raw: unknown, base: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...def.defaults, ...base };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(def.defaults)) {
      const v = (raw as Record<string, unknown>)[k];
      if (v !== undefined && typeof v === typeof def.defaults[k]) out[k] = v;
    }
  }
  return def.clampSettings ? def.clampSettings(out) : out;
}

const fail = (code: ErrorCode, detail?: string): Outcome => ({ ok: false, code, detail });
const OK: Outcome = { ok: true };

export class RoomCore {
  /** Player ids with at least one open socket. Kept current by the adapter via setPresence. */
  online = new Set<string>();
  screens = 0;

  constructor(
    public s: RoomState,
    private d: Deps,
  ) {}

  // ---- presence -------------------------------------------------------------

  setPresence(online: Iterable<string>, screens: number): void {
    this.online = new Set(online);
    this.screens = screens;
    const s = this.s;
    if (s.hostId && this.online.has(s.hostId)) delete s.timers.host;
    else if (s.hostId && !s.timers.host) s.timers.host = this.d.now() + HOST_GRACE_MS;
    else if (!s.hostId && s.players.length) this.transferHost();
  }

  // ---- join ----------------------------------------------------------------

  join(msg: { kind?: unknown; name?: unknown; token?: unknown }): JoinResult {
    const s = this.s;
    s.lastActive = this.d.now();
    if (msg.kind === 'screen') return { ok: true, pid: null, token: null, kind: 'screen' };
    if (typeof msg.token === 'string' && msg.token) {
      const p = s.players.find((x) => x.token === msg.token);
      if (p) {
        this.online.add(p.id);
        if (s.hostId === p.id) delete s.timers.host;
        return { ok: true, pid: p.id, token: p.token, kind: 'player' };
      }
      if (msg.name === undefined) return { ok: false, code: 'bad_token' };
    }
    let name = cleanName(msg.name);
    if (!name) return { ok: false, code: 'name' };
    if (s.players.length >= MAX_PLAYERS) return { ok: false, code: 'full' };
    const taken = new Set(s.players.map((p) => p.name.toLowerCase()));
    if (taken.has(name.toLowerCase())) {
      let n = 2;
      while (taken.has(`${name} ${n}`.toLowerCase())) n++;
      name = `${name.slice(0, NAME_MAX - 3)} ${n}`;
    }
    const p: Player = { id: `p${++s.seq}`, name, token: this.d.token(), joinedAt: this.d.now(), score: 0 };
    s.players.push(p);
    this.online.add(p.id);
    if (!s.hostId) s.hostId = p.id;
    return { ok: true, pid: p.id, token: p.token, kind: 'player' };
  }

  // ---- messages ------------------------------------------------------------

  handle(pid: string | null, msg: ClientMsg): Outcome {
    const s = this.s;
    s.lastActive = this.d.now();
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return fail('bad_msg');
    if (!pid || !s.players.some((p) => p.id === pid)) return fail('not_joined');
    const isHost = s.hostId === pid;
    const hostOnly = (fn: () => Outcome): Outcome => (isHost ? fn() : fail('not_host'));

    switch (msg.t) {
      case 'lang':
        return hostOnly(() => {
          if (!LANGS.includes(msg.lang)) return fail('bad_msg');
          s.lang = msg.lang;
          return OK;
        });
      case 'select':
        return hostOnly(() => this.select(msg));
      case 'start':
        return hostOnly(() => (s.game ? fail('in_game') : this.startGame(s.sel.game, s.sel.mode, s.sel.settings)));
      case 'again':
        return hostOnly(() => (s.game ? this.startGame(s.game.id, s.game.mode, s.game.settings) : fail('no_game')));
      case 'end':
        return hostOnly(() => {
          this.endGame();
          return OK;
        });
      case 'kick':
        return hostOnly(() => {
          if (msg.id === pid || !s.players.some((p) => p.id === msg.id)) return fail('bad_msg');
          this.removePlayer(msg.id);
          return { ok: true, close: [{ pid: msg.id, code: CLOSE_KICKED, reason: 'kicked' }] };
        });
      case 'host':
        return hostOnly(() => {
          if (!s.players.some((p) => p.id === msg.id)) return fail('bad_msg');
          s.hostId = msg.id;
          delete s.timers.host;
          if (!this.online.has(msg.id)) s.timers.host = this.d.now() + HOST_GRACE_MS;
          return OK;
        });
      case 'leave':
        this.removePlayer(pid);
        return { ok: true, close: [{ pid, code: CLOSE_LEFT, reason: 'left' }] };
      case 'act':
        return this.act(pid, msg.a);
      default:
        return fail('bad_msg');
    }
  }

  private select(msg: Extract<ClientMsg, { t: 'select' }>): Outcome {
    const s = this.s;
    if (s.game) return fail('in_game');
    const gameId = msg.game ?? s.sel.game;
    const def = this.d.games[gameId];
    if (!def) return fail('unknown_game');
    const same = gameId === s.sel.game;
    const mode = msg.mode && def.modes.includes(msg.mode) ? msg.mode : same && def.modes.includes(s.sel.mode) ? s.sel.mode : def.modes[0];
    if (msg.mode && !def.modes.includes(msg.mode)) return fail('mode');
    s.sel = { game: gameId, mode, settings: sanitizeSettings(def, msg.settings, same ? s.sel.settings : {}) };
    return OK;
  }

  private startGame(gameId: string, mode: Mode, settings: Record<string, unknown>): Outcome {
    const s = this.s;
    const def = this.d.games[gameId];
    if (!def) return fail('unknown_game');
    const playing = s.players.filter((p) => this.online.has(p.id)).map((p) => p.id);
    if (playing.length < def.minPlayers) return fail('too_few', String(def.minPlayers));
    if (playing.length > def.maxPlayers) return fail('too_many', String(def.maxPlayers));
    const prev = s.game;
    this.clearGameTimers();
    const run: GameRun = { id: def.id, mode, playing, settings: sanitizeSettings(def, settings, {}), state: null };
    try {
      run.state = def.start(this.ctx(run), run.settings);
    } catch (e) {
      this.clearGameTimers();
      s.game = prev;
      if (e instanceof GameError) return fail('game', e.code);
      throw e;
    }
    s.game = run;
    return OK;
  }

  private act(pid: string, action: unknown): Outcome {
    const s = this.s;
    const run = s.game;
    if (!run) return fail('no_game');
    if (!run.playing.includes(pid) && s.hostId !== pid) return fail('not_joined');
    try {
      this.d.games[run.id].action(this.ctx(run), run.state, pid, action);
    } catch (e) {
      if (e instanceof GameError) return fail('game', e.code);
      throw e;
    }
    return OK;
  }

  endGame(): void {
    this.clearGameTimers();
    this.s.game = null;
  }

  private clearGameTimers(): void {
    for (const k of Object.keys(this.s.timers)) if (k.startsWith('g:')) delete this.s.timers[k];
  }

  removePlayer(pid: string): void {
    const s = this.s;
    s.players = s.players.filter((p) => p.id !== pid);
    this.online.delete(pid);
    const run = s.game;
    if (run && run.playing.includes(pid)) {
      run.playing = run.playing.filter((x) => x !== pid);
      const def = this.d.games[run.id];
      if (run.playing.length < def.minPlayers) this.endGame();
      else def.leave?.(this.ctx(run), run.state, pid);
    }
    if (s.hostId === pid) this.transferHost();
  }

  /** Hand the host role to the earliest joined player who is online (or anyone, if nobody is). */
  transferHost(): void {
    const s = this.s;
    const next = s.players.find((p) => this.online.has(p.id) && p.id !== s.hostId) ?? s.players.find((p) => p.id !== s.hostId);
    s.hostId = next?.id ?? (s.players.some((p) => p.id === s.hostId) ? s.hostId : null);
    delete s.timers.host;
    if (s.hostId && !this.online.has(s.hostId)) s.timers.host = this.d.now() + HOST_GRACE_MS;
  }

  // ---- timers --------------------------------------------------------------

  nextAlarm(): number {
    return Math.min(this.s.lastActive + IDLE_MS, ...Object.values(this.s.timers));
  }

  /** Run due timers. Returns expired=true when the room should be deleted. */
  alarm(): { expired: boolean } {
    const s = this.s;
    const now = this.d.now();
    const due = Object.entries(s.timers)
      .filter(([, at]) => at <= now)
      .sort((a, b) => a[1] - b[1]);
    for (const [key, at] of due) {
      if (s.timers[key] !== at) continue; // changed by an earlier timer
      delete s.timers[key];
      if (key === 'host') {
        if (s.hostId && !this.online.has(s.hostId) && s.players.some((p) => this.online.has(p.id))) this.transferHost();
        else if (s.hostId && !this.online.has(s.hostId)) s.timers.host = now + HOST_GRACE_MS * 3;
      } else if (key.startsWith('g:') && s.game) {
        this.d.games[s.game.id].timer?.(this.ctx(s.game), s.game.state, key.slice(2));
      }
    }
    const idle = now - s.lastActive >= IDLE_MS && this.online.size === 0 && this.screens === 0;
    return { expired: idle };
  }

  // ---- views ---------------------------------------------------------------

  snapshot(): RoomSnapshot {
    const s = this.s;
    return {
      code: s.code,
      lang: s.lang,
      hostId: s.hostId,
      players: s.players.map((p) => ({ id: p.id, name: p.name, connected: this.online.has(p.id), score: p.score })),
      screens: this.screens,
      sel: s.sel,
      game: s.game ? { id: s.game.id, mode: s.game.mode, playing: s.game.playing, settings: s.game.settings } : null,
    };
  }

  publicView(): unknown {
    const run = this.s.game;
    return run ? this.d.games[run.id].publicView(this.ctx(run), run.state) : null;
  }

  playerView(pid: string | null): unknown {
    const run = this.s.game;
    if (!run || !pid || !run.playing.includes(pid)) return null;
    return this.d.games[run.id].playerView(this.ctx(run), run.state, pid);
  }

  ctx(run: GameRun): GameCtx {
    const s = this.s;
    const d = this.d;
    const shuffle = <T>(items: readonly T[]): T[] => {
      const a = items.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(d.rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    return {
      lang: s.lang,
      mode: run.mode,
      playing: run.playing,
      hostId: s.hostId,
      name: (pid) => s.players.find((p) => p.id === pid)?.name ?? '?',
      isConnected: (pid) => this.online.has(pid),
      now: () => d.now(),
      rand: () => d.rand(),
      shuffle,
      pick: (items) => items[Math.floor(d.rand() * items.length)],
      setTimer: (name, ms) => (s.timers[`g:${name}`] = d.now() + Math.max(0, ms)),
      clearTimer: (name) => void delete s.timers[`g:${name}`],
      award: (pid, pts) => {
        const p = s.players.find((x) => x.id === pid);
        if (p) p.score += pts;
      },
      pack: <T>(name: string) => d.pack(s.lang, name) as T[],
      trivia: <T>(topic: string) => d.trivia(s.lang, topic) as T[],
    };
  }
}
