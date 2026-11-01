// Server game registry. To add a game: write src/server/games/<id>.ts and add it here.
import type { GameDef } from './types';
import { spy } from './spy';
import { draw } from './draw';
import { wordgrid } from './wordgrid';

export const GAMES: Record<string, GameDef> = Object.fromEntries([spy, draw, wordgrid].map((g) => [g.id, g as GameDef]));
