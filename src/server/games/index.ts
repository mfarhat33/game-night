// Server game registry. To add a game: write src/server/games/<id>.ts and add it here.
import type { GameDef } from './types';
import { spy } from './spy';

export const GAMES: Record<string, GameDef> = Object.fromEntries([spy].map((g) => [g.id, g as GameDef]));
