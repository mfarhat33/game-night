import { RoomCore, newRoom, type Deps } from '../../src/server/core';
import { GAMES } from '../../src/server/games';
import type { GameDef } from '../../src/server/games/types';
import type { Lang } from '../../src/shared/protocol';
import spyEn from '../fixtures/content/packs/en/spy.json';
import spyAr from '../fixtures/content/packs/ar/spy.json';
import chaEn from '../fixtures/content/packs/en/charades.json';
import chaAr from '../fixtures/content/packs/ar/charades.json';
import tabEn from '../fixtures/content/packs/en/taboo.json';
import tabAr from '../fixtures/content/packs/ar/taboo.json';

/** Deterministic random numbers (mulberry32). */
export function seeded(seed = 1): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TestRoom {
  core: RoomCore;
  clock: { t: number };
  /** Join a player and mark them online. Returns their id and token. */
  add(name: string): { id: string; token: string };
  /** Set who is online (others are offline). */
  online(...ids: string[]): void;
  advance(ms: number): void;
}

const PACKS: Record<string, Record<string, unknown[]>> = {
  en: { spy: spyEn, charades: chaEn, taboo: tabEn },
  ar: { spy: spyAr, charades: chaAr, taboo: tabAr },
};

export function makeRoom(opts: { games?: Record<string, GameDef>; lang?: Lang; seed?: number; packs?: typeof PACKS; trivia?: Record<string, Record<string, unknown[]>> } = {}): TestRoom {
  const clock = { t: 1_000_000 };
  let n = 0;
  const packs = opts.packs ?? PACKS;
  const deps: Deps = {
    now: () => clock.t,
    rand: seeded(opts.seed ?? 7),
    token: () => `tok${++n}`,
    games: opts.games ?? GAMES,
    pack: (lang, name) => packs[lang]?.[name] ?? [],
    trivia: (lang, topic) => opts.trivia?.[lang]?.[topic] ?? [],
  };
  const core = new RoomCore(newRoom('BCDF', opts.lang ?? 'en', deps.games, clock.t), deps);
  // Rooms start with the first registered game selected; the older tests expect Spy.
  const spy = deps.games.spy;
  if (spy) core.s.sel = { game: 'spy', mode: spy.modes[0], settings: { ...spy.defaults } };
  return {
    core,
    clock,
    add(name) {
      const r = core.join({ kind: 'player', name });
      if (!r.ok || !r.pid || !r.token) throw new Error(`join failed: ${JSON.stringify(r)}`);
      core.setPresence([...core.online, r.pid], core.screens);
      return { id: r.pid, token: r.token };
    },
    online(...ids) {
      core.setPresence(ids, core.screens);
    },
    advance(ms) {
      clock.t += ms;
      if (core.nextAlarm() <= clock.t) core.alarm();
    },
  };
}
