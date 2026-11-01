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

## Durable Object requests and duration (Workers Free plan)

The Free plan allows 100,000 Durable Object requests per day and 13,000 GB-s of duration per day.
Both are shared by the whole site (every room), and a Durable Object is billed 128 MB while it is
awake. Two billing rules matter here:

- An incoming WebSocket message counts as 1/20 of a request (20 messages = 1 request). Connecting a
  socket is a full request, HTTP calls to the room (create, lookup) are full requests, and every
  alarm run is one request. Outgoing messages and the `ping`/`pong` keepalive are free.
- With the Hibernation API a room costs no duration while it is idle between messages. It is billed
  (wall clock, 0.125 GB x seconds) only while it is awake handling messages or timers. Sleep follows
  a few seconds after the last event, so the estimate below counts about 10 awake seconds per message
  burst for a busy room, which is generous.

Estimates for one busy room (8 to 12 players, plus a TV) for one hour of play. Requests are billed
requests (messages / 20, plus connects, lookups and alarms); each player opens about 2 connections
(join and one reconnect) and does 1 lookup per join; the alarm runs about once a minute for timers.

| Game | Messages per hour | Billed requests per hour | Awake seconds per hour | Duration (GB-s) per hour |
| --- | --- | --- | --- | --- |
| Spy | about 1,500 | about 190 | about 900 | about 110 |
| Trivia | about 5,000 | about 400 | about 2,400 | about 300 |
| Charades, Taboo | about 2,000 | about 230 | about 1,200 | about 150 |
| Shabakeh (word grid) | about 1,800 | about 210 | about 1,000 | about 125 |
| Draw and guess | about 40,000 | about 2,100 | about 3,600 (awake all hour) | about 450 |

Draw is the heaviest: stroke batches go out every 50 ms while someone draws (about 20 messages per
second, 1 request per second after the 20:1 rule) and keep the room awake, so it is billed for the
whole hour. Against the daily limits that is roughly 45 hours of drawing for requests (100,000 / 2,100)
and about 28 hours for duration (13,000 / 450); the other games allow well over 100 hours. In
practice the site is not used around the clock in one day, so the limits are comfortable for a few
dozen evenings of play a day, but they are shared: ten drawing rooms at once for an hour is about
21,000 requests and 4,500 GB-s.

Abuse protection keeps stray traffic out of these numbers (see `src/server/limits.ts`): room
creation, room lookups and wrong-code guesses are throttled per IP in the Worker (Worker requests
for the API are separate from, and cheaper than, Durable Object requests), each socket has a token
bucket (40 messages per second, burst 80) and a 16 KB message cap, and rooms are deleted after 3
hours without a message (30 minutes if nobody ever joined), which also frees the storage.

High-rate actions must not save every time. A game can implement quiet(ctx, state, pid, action):
return { ev, persist } for an action that is applied to the state but needs no full state
broadcast and no immediate save. ev is sent to the other connections as a small event (the client
handles it in GameClient.onEvent and paints directly); persist: true saves now, otherwise saves
are thinned to one every 5 seconds (QUIET_SAVE_MS). Draw and guess uses this for stroke point
batches (deltas only) and the end of each stroke. If the room sleeps, the unsaved tail of a drawing
may be lost; full views (join, reconnect, TV open) always carry the whole stroke log.

## Removing players (bans)

When the host removes a player, the room remembers that player's token and lower-case name for the
rest of that room (up to 100 entries). The same token or name cannot join again, as a player or as
a screen. Bans are deliberately by token and name only, not by IP address: families share one Wi-Fi
network, so an IP ban would lock out the whole household. This makes a ban soft: someone who is
removed can come back by choosing a different name from a fresh browser. The host can remove them again.
