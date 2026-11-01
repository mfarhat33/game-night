// Wire protocol shared by the Worker and the browser client.

export type Lang = 'ar' | 'en';
export const LANGS: readonly Lang[] = ['ar', 'en'];

/** How a game is shown: one shared screen plus phones as controllers, or phones only. */
export type Mode = 'screen' | 'phones';

/** A connection is a player (phone) or a shared screen (TV or laptop, not a player). */
export type ConnKind = 'player' | 'screen';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 12;
export const NAME_MAX = 20;

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
  score: number;
}

export interface Selection {
  game: string;
  mode: Mode;
  settings: Record<string, unknown>;
}

export interface RoomSnapshot {
  code: string;
  lang: Lang;
  hostId: string | null;
  players: PlayerInfo[];
  screens: number;
  sel: Selection;
  /** The running game, or null while in the lobby. */
  game: { id: string; mode: Mode; playing: string[]; settings: Record<string, unknown> } | null;
}

export type ErrorCode =
  | 'not_found'
  | 'full'
  | 'name'
  | 'bad_token'
  | 'not_host'
  | 'not_joined'
  | 'bad_msg'
  | 'unknown_game'
  | 'too_few'
  | 'too_many'
  | 'mode'
  | 'in_game'
  | 'no_game'
  | 'game';

export type ServerMsg =
  | { t: 'welcome'; id: string | null; token: string | null; kind: ConnKind }
  | {
      t: 'state';
      /** Server clock (ms) when sent; clients use it to correct countdowns. */
      now: number;
      room: RoomSnapshot;
      /** Shared game view (the board). Null in the lobby. */
      pub: unknown;
      /** This player's private game view. Null for screens, lobby, or players not in the game. */
      priv: unknown;
    }
  | { t: 'error'; code: ErrorCode; detail?: string }
  | { t: 'bye'; reason: 'kicked' | 'left' | 'closed' };

export type ClientMsg =
  | { t: 'join'; kind: ConnKind; name?: string; token?: string }
  | { t: 'lang'; lang: Lang }
  | { t: 'select'; game?: string; mode?: Mode; settings?: Record<string, unknown> }
  | { t: 'start' }
  | { t: 'again' }
  | { t: 'end' }
  | { t: 'kick'; id: string }
  | { t: 'host'; id: string }
  | { t: 'leave' }
  | { t: 'act'; a: unknown };

/** WebSocket close codes used by the room. */
export const CLOSE_KICKED = 4001;
export const CLOSE_LEFT = 4002;
export const CLOSE_GONE = 4004;
