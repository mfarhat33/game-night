# Sahra · سهرة

Party games for a night in, in Arabic and English. One person opens a room, everyone else joins
from their phone with a 4 letter code, a link or a QR code. No accounts, no app to install.

- Two ways to play, chosen per game: **TV + phones** (a TV or laptop shows the board, phones are
  controllers) or **phones only**.
- Arabic (right to left, Lebanese flavour) and English, switchable for the whole room.
- 2 to 12 players. Refresh-safe: a player who reloads drops straight back in. The host can remove
  players, and the host role passes on if the host leaves.
- Games: Spy, with more on the way.

Runs on Cloudflare Workers (free plan): static assets plus one Durable Object per room, using
WebSocket hibernation so idle rooms cost nothing. The front end is plain TypeScript with no
framework and no external calls (fonts and the QR code are bundled).

## Run locally

Needs Node 22.

```sh
npm install
npm run dev          # builds, then serves on http://localhost:8787
```

Open the page on your laptop, start a room, then join from other browser windows (or phones on
the same network using your machine's address).

```sh
npm run typecheck
npm test             # unit tests
npx playwright install chromium   # once
npm run e2e          # end to end tests with several browser contexts against wrangler dev
```

## Project layout

```
src/server/worker.ts     Worker: room API, everything else is static assets
src/server/room.ts       Room Durable Object (WebSocket hibernation, storage, alarms)
src/server/core.ts       room logic (players, host, timers, scores), unit tested
src/server/games/        game rules (server side) and registry
src/client/              browser app: home, lobby, game shell, i18n
src/client/games/        game views (browser side) and registry
content/                 game content (JSON), bundled at build time
scripts/                 content bundler and client build
test/                    unit tests, end to end tests, fixtures
```

## Add a game

See [docs/GAMES.md](docs/GAMES.md). In short: a rules file and a view file, one line in each
registry, a content fixture, a unit test and one end to end test.

## Deploy

The `Deploy` workflow (manual) runs `wrangler deploy` using the repository secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Credits

Arabic and Latin text set in IBM Plex Sans Arabic (SIL Open Font License), bundled via Fontsource.
