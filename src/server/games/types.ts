// The server side of a game. A game is a small state machine that the Room runs.
// The Room owns players, scores, timers and persistence; the game owns its own state.
import type { Lang, Mode } from '../../shared/protocol';

/** Throw this from a game hook to reject an action. The code is sent to the player. */
export class GameError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface GameCtx {
  readonly lang: Lang;
  readonly mode: Mode;
  /** Ids of players in this game, in join order. Late joiners are not included. */
  readonly playing: readonly string[];
  readonly hostId: string | null;
  name(pid: string): string;
  isConnected(pid: string): boolean;
  /** Server time in ms. */
  now(): number;
  /** Random float in [0, 1). Seeded in tests. */
  rand(): number;
  shuffle<T>(items: readonly T[]): T[];
  pick<T>(items: readonly T[]): T;
  /** Start (or restart) a named timer. Returns the deadline in ms. `timer()` is called when it fires. */
  setTimer(name: string, ms: number): number;
  clearTimer(name: string): void;
  /** Add points to the room scoreboard (kept across games). */
  award(pid: string, points: number): void;
  /** Content for this game in the room language: content/packs/<lang>/<name>.json. */
  pack<T = unknown>(name: string): T[];
  /** Trivia questions for a topic in the room language: content/trivia/<lang>/<topic>.json. */
  trivia<T = unknown>(topic: string): T[];
}

export interface GameDef<S = any, Settings extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  minPlayers: number;
  maxPlayers: number;
  /** Modes this game supports. The first is the default. */
  modes: Mode[];
  /** Default settings. Only keys present here are accepted from the host, with the same type. */
  defaults: Settings;
  /** Optional extra clamping of settings sent by the host. */
  clampSettings?(s: Settings): Settings;
  /** Build the initial state. Throw GameError to refuse (for example, missing content). */
  start(ctx: GameCtx, settings: Settings): S;
  /** Handle a player action. Mutate `state` in place. Throw GameError to reject. */
  action(ctx: GameCtx, state: S, pid: string, action: any): void;
  /** A timer set with ctx.setTimer fired. */
  timer?(ctx: GameCtx, state: S, name: string): void;
  /** A player in `playing` left or was removed. They are already gone from ctx.playing. */
  leave?(ctx: GameCtx, state: S, pid: string): void;
  /** The shared view: shown on the host screen, and to every phone. Must not leak secrets. */
  publicView(ctx: GameCtx, state: S): unknown;
  /** The private view for one player in `playing`. */
  playerView(ctx: GameCtx, state: S, pid: string): unknown;
}
