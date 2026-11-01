// Server game registry. To add a game: write src/server/games/<id>.ts and add it here.
import type { GameDef } from './types';
import { spy } from './spy';
import { trivia } from './trivia';
import { charades } from './charades';
import { taboo } from './taboo';

export const GAMES: Record<string, GameDef> = Object.fromEntries([spy, trivia, charades, taboo].map((g) => [g.id, g as GameDef]));
