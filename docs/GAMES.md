# Adding a game to Sahra

A game is two small files plus one line in each registry. You do not need to touch the room,
the lobby, the Worker or the Durable Object.

```
src/server/games/<id>.ts   rules: state machine, private views, timers, scoring
src/server/games/index.ts  server registry (add one entry)
src/client/games/<id>.ts   drawing: renders views, sends actions, strings in ar and en
src/client/games/index.ts  client registry (add one entry)
test/unit/<id>.test.ts     rules tests (plain Node, no browser)
test/e2e/<id>.spec.ts      one full round with real browsers
```

Spy (`spy.ts` on both sides) is the reference implementation.

## How a round runs

1. In the lobby the host picks a game, a mode and settings. The room checks the player count.
2. The room calls `start(ctx, settings)`; you return your initial state (plain JSON).
3. Players send actions; the room calls `action(ctx, state, pid, action)`. Mutate `state` in place.
   Throw `new GameError('code')` to reject; the player sees a short message.
4. Timers you set with `ctx.setTimer(name, ms)` call `timer(ctx, state, name)` when they fire.
   They survive the Durable Object sleeping (they are stored and driven by one alarm).
5. After every change the room sends each connection its view:
   `publicView(ctx, state)` to everyone (the board), and `playerView(ctx, state, pid)` to each player.
   Never put secrets in the public view.
6. Award points with `ctx.award(pid, n)`; the room keeps the scoreboard across games.
7. When the round is over, stay in a final phase and render `ctx.hostControls()`:
   the host chooses "another round" (calls `start` again) or "back to lobby".

The room also handles: players leaving or being removed (`leave` hook, and the game ends by
itself if fewer than `minPlayers` remain), late joiners (they watch until the next round),
reconnects, the host role, language and persistence.

## Server interface (`src/server/games/types.ts`)

```ts
interface GameDef<S, Settings> {
  id: string; minPlayers: number; maxPlayers: number;
  modes: ('phones' | 'screen')[];          // first is the default
  defaults: Settings;                       // only these keys, with these types, are accepted
  clampSettings?(s): Settings;
  start(ctx, settings): S;
  action(ctx, state, pid, action): void;
  timer?(ctx, state, name): void;
  leave?(ctx, state, pid): void;
  publicView(ctx, state): unknown;
  playerView(ctx, state, pid): unknown;
}
```

`ctx` gives you `lang`, `mode`, `playing` (ids in this game), `hostId`, `name(pid)`,
`isConnected(pid)`, `now()`, `rand()`, `shuffle()`, `pick()`, `setTimer()`, `clearTimer()`,
`award()`, `pack(name)` and `trivia(topic)` (content in the room language).
Always use `ctx.rand()` and `ctx.now()` so unit tests are deterministic.

## Client interface (`src/client/games/types.ts`)

```ts
interface GameClient {
  id: string; icon: string; minPlayers: number; modes: Mode[];
  settings?: SettingSpec[];                 // rendered by the lobby for the host
  strings: { en: {...}, ar: {...} };        // must include "title" and "blurb"
  render(ctx: ViewCtx): Node;               // called on every update; return a fresh node
}
```

`ViewCtx` has `pub`, `priv` (null on the TV screen), `mode`, `isScreen`, `me`, `isHost`, `room`,
`name(pid)`, `send(action)`, `timer(deadline)` (a live countdown), `hostControls()`, and
`t(key)` / `g(key)` for strings (`g` reads your own `"<id>.<key>"` strings).

Modes: with `mode === 'screen'` the TV (`isScreen`) shows the board and phones show only what each
player needs; with `'phones'` each phone shows the board and its private part.

Use `h()` and `button()` from `src/client/dom.ts`. Pass text as children (never as `html`) so
content is always escaped. Keep UI-only state (like "card is face up") in module variables.

### Strings and language

Write Arabic natively, in a friendly Lebanese tone for UI and party words. The page is RTL in
Arabic, so use logical CSS (`margin-inline-start`, `text-align: start`) and wrap codes, numbers
and URLs that must stay left to right in an element with `dir="ltr"`.

### Test ids

Add `data-testid` to anything a test clicks or reads, prefixed with the game id
(for example `spy-card`, `spy-vote`).

## Content

Content is bundled at build time by `scripts/gen-content.mjs` into the Worker.
`ctx.pack('<name>')` reads `content/packs/<lang>/<name>.json`; `ctx.trivia('<topic>')` reads
`content/trivia/<lang>/<topic>.json`. If a file is missing, empty or invalid, the build falls back to
`test/fixtures/content/` with the same layout, so add a tiny fixture for your game (both languages).
Items missing required fields (listed in `REQUIRED` in the script) are dropped with a warning.

Content schema:

- `content/trivia/<lang>/<topic>.json`: `[{id, topic, difficulty (1|2|3), lang ("ar"|"en"), q, options [4 strings], answer (0..3), source}]`; topics `lbkw`, `sport`, `histgeo`, `science`
- `content/packs/<lang>/spy.json`: `[{id, place, pack ("lebanon"|"kuwait"|"general"), roles [5 to 7 strings]}]`
- `content/packs/<lang>/charades.json`: `[{id, word, pack, difficulty}]`
- `content/packs/<lang>/taboo.json`: `[{id, word, banned [5 strings]}]`
- `content/packs/<lang>/wordgrid.json`: `[{id, word}]`
- `content/packs/<lang>/draw.json`: `[{id, word, difficulty}]`

Keep state small: store ids or the few strings you need, not whole packs (one stored value is
limited to 2 MB, and the state is saved after every action).

## Tests

Unit: `test/unit/helpers.ts` has `makeRoom({ seed, lang })` which returns a room with a fake
clock (`advance(ms)` fires timers) and `add(name)` to join players. See `test/unit/spy.test.ts`.

End to end: `test/e2e/helpers.ts` gives `setupRoom(browser, { lang, count })` (each player is its own
browser context, like a separate phone), `startGame(host, id, mode)`, `openScreen(ctx, code)`,
`backToLobby`, `kick`, `expectDir`. A new game adds one spec that plays one round, for example:

```ts
test('one round of Taboo', async ({ browser }) => {
  const room = await setupRoom(browser, { lang: 'ar', count: 2 });
  try {
    await startGame(room.host.page, 'taboo', 'phones');
    // ...play using your data-testid hooks...
    await expect(room.host.page.getByTestId('taboo-result')).toBeVisible();
  } finally {
    await room.close();
  }
});
```

Run `npm run typecheck`, `npm test` and `npm run e2e` before pushing.

## Storage writes (Workers Free plan)

Durable Object storage on the Free plan allows 100,000 rows written per day (key-value put and
setAlarm count as rows). The room saves its state after every action, about 2 rows (state plus
alarm). Estimates per hour of play for a busy room (8 to 12 players):

| Game | Saves per hour | Rows written per hour |
| --- | --- | --- |
| Spy | about 300 | about 600 |
| Trivia | about 1,000 | about 2,000 |
| Charades, Taboo | about 400 | about 800 |
| Shabakeh (word grid) | about 350 | about 700 |
| Draw and guess | about 2,000 | about 4,000 |

Even drawing all evening stays well under the daily limit (more than 20 hours of play).

High-rate actions must not save every time. A game can implement quiet(ctx, state, pid, action):
return { ev, persist } for an action that is applied to the state but needs no full state
broadcast and no immediate save. ev is sent to the other connections as a small event (the client
handles it in GameClient.onEvent and paints directly); persist: true saves now, otherwise saves
are thinned to one every 5 seconds (QUIET_SAVE_MS). Draw and guess uses this for stroke point
batches (deltas only) and the end of each stroke. If the room sleeps, the unsaved tail of a drawing
may be lost; full views (join, reconnect, TV open) always carry the whole stroke log.
