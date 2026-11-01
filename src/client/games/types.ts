// The browser side of a game. It renders views sent by the server and sends actions back.
import type { Lang, Mode, RoomSnapshot } from '../../shared/protocol';

export interface ViewCtx<Pub = any, Priv = any> {
  lang: Lang;
  t(key: string, vars?: Record<string, string | number>): string;
  /** Shortcut for t(`<gameId>.<key>`). */
  g(key: string, vars?: Record<string, string | number>): string;
  /** "screen": a TV shows the board and phones are controllers. "phones": each phone shows everything. */
  mode: Mode;
  /** True on the shared TV or laptop screen (not a player). */
  isScreen: boolean;
  /** This player's id (null on a screen). */
  me: string | null;
  isHost: boolean;
  room: RoomSnapshot;
  /** The game's shared view (from publicView on the server). */
  pub: Pub;
  /** This player's private view (from playerView). Null on a screen. */
  priv: Priv;
  name(pid: string): string;
  /** Send a game action to the server. */
  send(action: unknown): void;
  /** A live countdown element for a server deadline (ms). */
  timer(deadline: number): HTMLElement;
  /** Host buttons: another round and back to lobby (empty for non-hosts). */
  hostControls(): HTMLElement;
}

export type SettingSpec =
  | { key: string; kind: 'choice'; options: string[] }
  | { key: string; kind: 'number'; min: number; max: number; step: number };

export interface GameClient {
  id: string;
  /** Strings for both languages. Must include "title" and "blurb". Read with ctx.g(key). */
  strings: Record<Lang, Record<string, string>>;
  /** Small inline SVG icon for the game picker. */
  icon: string;
  minPlayers: number;
  modes: Mode[];
  /** Settings the host can change in the lobby. Labels: "<id>.set.<key>", choices: "<id>.opt.<key>.<value>". */
  settings?: SettingSpec[];
  /** A small event from the server's `quiet` hook (no re-render happens). Update module state and paint directly. */
  onEvent?(ev: unknown): void;
  /** Build the game view. Called on every state update; return a fresh node. */
  render(ctx: ViewCtx): Node;
}
