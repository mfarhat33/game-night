import { expect, test, type Page } from '@playwright/test';
import { backToLobby, expectDir, openScreen, setupRoom, startGame, type Player } from './helpers';

/** Wait until one of the players shows `testid`, and return that player. */
async function whoHas(players: Player[], testid: string): Promise<Player> {
  let found: Player | undefined;
  await expect
    .poll(
      async () => {
        for (const p of players) if (await p.page.getByTestId(testid).count()) found = p;
        return !!found;
      },
      { timeout: 25_000 },
    )
    .toBe(true);
  return found!;
}

const inkPixels = (page: Page) =>
  page.getByTestId('draw-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== 255 || d[i + 1] !== 250 || d[i + 2] !== 240) n++;
    return n;
  });

async function scribble(page: Page, dy: number): Promise<void> {
  const box = (await page.getByTestId('draw-canvas').boundingBox())!;
  const x = (f: number) => box.x + box.width * f;
  const y = (f: number) => box.y + box.height * f;
  await page.mouse.move(x(0.2), y(0.2 + dy));
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(x(0.2 + i * 0.05), y(0.2 + dy + (i % 3) * 0.04), { steps: 2 });
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
}

test('a full game of Draw and Guess with a TV (ar)', async ({ browser }) => {
  const room = await setupRoom(browser, { lang: 'ar', count: 3 });
  const { host, players } = room;
  try {
    const tv = await openScreen(host.ctx, room.code);
    await expectDir(tv, 'ar');
    await startGame(host.page, 'draw', 'screen');
    await expect(tv.getByTestId('timer')).toBeVisible();

    for (let turn = 0; turn < players.length; turn++) {
      const drawer = await whoHas(players, 'draw-opt');
      const guessers = players.filter((p) => p !== drawer);
      await expect(drawer.page.getByTestId('draw-opt')).toHaveCount(3);
      const word = ((await drawer.page.getByTestId('draw-opt').first().textContent()) ?? '').trim();
      await drawer.page.getByTestId('draw-opt').first().click();
      await expect(drawer.page.getByTestId('draw-word')).toContainText(word);
      await expect(tv.getByTestId('draw-hint')).toBeVisible();
      // In TV mode the guessers' phones are controllers only: no canvas, no word.
      await expect(guessers[0].page.getByTestId('draw-canvas')).toHaveCount(0);
      await expect(guessers[0].page.getByTestId('draw-word')).toHaveCount(0);
      await expect(guessers[0].page.getByTestId('draw-hint')).toBeVisible();

      if (turn === 0) {
        // Colours, widths and undo, then a drawing that shows up on the TV.
        await drawer.page.getByTestId('draw-color-1').click();
        await drawer.page.getByTestId('draw-width-1').click();
        await scribble(drawer.page, 0);
        await expect.poll(() => inkPixels(drawer.page)).toBeGreaterThan(200);
        await expect.poll(() => inkPixels(tv)).toBeGreaterThan(200);
        await drawer.page.getByTestId('draw-undo').click();
        await expect.poll(() => inkPixels(drawer.page)).toBe(0);
        await expect.poll(() => inkPixels(tv)).toBe(0);
        await drawer.page.getByTestId('draw-color-2').click();
        await scribble(drawer.page, 0.3);
        await expect.poll(() => inkPixels(tv)).toBeGreaterThan(200);
        // A TV that reloads redraws the stroke log.
        await tv.reload();
        await expect.poll(() => inkPixels(tv)).toBeGreaterThan(200);
        // A wrong guess goes to the feed on the TV.
        const wrong = guessers[0].page.getByTestId('draw-guess');
        await wrong.fill('كلمة غلط');
        await wrong.press('Enter');
        await expect(tv.getByTestId('draw-feed')).toContainText('كلمة غلط');
        await expect(wrong).toHaveValue('');
      }

      // Correct guesses, written loosely: other alef, a vowel mark, extra spaces.
      for (const g of guessers) {
        await g.page.getByTestId('draw-guess').fill(` ${word.replace('ا', 'أ')}َ `);
        await g.page.getByTestId('draw-send').click();
      }
      await expect(tv.getByTestId('draw-reveal')).toContainText(word);
      await expect(tv.getByTestId('draw-feed')).toContainText(guessers[1].name);
    }

    for (const page of [...players.map((p) => p.page), tv]) await expect(page.getByTestId('draw-result')).toBeVisible();
    await backToLobby(host.page);
    for (const p of players) await expect(host.page.locator(`[data-testid=player][data-name="${p.name}"] .score`)).not.toHaveText('0');
  } finally {
    await room.close();
  }
});

test('a full game of Draw and Guess with phones only (en)', async ({ browser }) => {
  const room = await setupRoom(browser, { lang: 'en', count: 2 });
  const { host, players } = room;
  try {
    await startGame(host.page, 'draw', 'phones', { rounds: 1 });
    await expectDir(players[1].page, 'en');

    for (let turn = 0; turn < players.length; turn++) {
      const drawer = await whoHas(players, 'draw-opt');
      const guesser = players.find((p) => p !== drawer)!;
      const word = ((await drawer.page.getByTestId('draw-opt').first().textContent()) ?? '').trim();
      await drawer.page.getByTestId('draw-opt').first().click();
      await expect(drawer.page.getByTestId('draw-word')).toContainText(word);

      // Phones only: the guesser's phone has the canvas too, but never the word.
      await expect(guesser.page.getByTestId('draw-canvas')).toBeVisible();
      await expect(guesser.page.getByTestId('draw-word')).toHaveCount(0);
      await expect(guesser.page.getByTestId('draw-hint')).toBeVisible();

      if (turn === 0) {
        await scribble(drawer.page, 0);
        await expect.poll(() => inkPixels(drawer.page)).toBeGreaterThan(200);
        await expect.poll(() => inkPixels(guesser.page)).toBeGreaterThan(200);
        const wrong = guesser.page.getByTestId('draw-guess');
        await wrong.fill('definitely not it');
        await wrong.press('Enter');
        await expect(guesser.page.getByTestId('draw-feed')).toContainText('definitely not it');
        await expect(drawer.page.getByTestId('draw-feed')).toContainText('definitely not it');
      }

      await guesser.page.getByTestId('draw-guess').fill(`  ${word.toUpperCase()} `);
      await guesser.page.getByTestId('draw-send').click();
      for (const p of players) await expect(p.page.getByTestId('draw-reveal')).toContainText(word);
    }

    for (const p of players) await expect(p.page.getByTestId('draw-result')).toBeVisible();
    await backToLobby(host.page);
    for (const p of players) await expect(host.page.locator(`[data-testid=player][data-name="${p.name}"] .score`)).not.toHaveText('0');
  } finally {
    await room.close();
  }
});
