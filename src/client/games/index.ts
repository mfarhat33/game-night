// Client game registry. To add a game: write src/client/games/<id>.ts and add it here (same id as the server).
import { spyClient } from './spy';
import type { GameClient } from './types';

export const GAME_LIST: GameClient[] = [spyClient];
export const GAMES: Record<string, GameClient> = Object.fromEntries(GAME_LIST.map((g) => [g.id, g]));
