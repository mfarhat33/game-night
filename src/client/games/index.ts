// Client game registry. To add a game: write src/client/games/<id>.ts and add it here (same id as the server).
import { drawClient } from './draw';
import { spyClient } from './spy';
import { triviaClient } from './trivia';
import { charadesClient } from './charades';
import { tabooClient } from './taboo';
import { wordgridClient } from './wordgrid';
import type { GameClient } from './types';

export const GAME_LIST: GameClient[] = [spyClient, triviaClient, charadesClient, tabooClient, drawClient, wordgridClient];
export const GAMES: Record<string, GameClient> = Object.fromEntries(GAME_LIST.map((g) => [g.id, g]));
