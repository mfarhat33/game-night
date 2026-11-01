import { expect, test } from '@playwright/test';
import { expectDir, openScreen, setupRoom, startGame } from './helpers';

test('a full round of Trivia with a TV screen (en)', async ({ browser }) => {
  const room = await setupRoom(browser, { lang: 'en', count: 2 });
  const { host, players } = room;
  try {
    const tv = await openScreen(host.ctx, room.code);
    await startGame(host.page, 'trivia', 'screen', { count: 5, seconds: 30 });
    await expectDir(tv, 'en');

    for (let q = 0; q < 5; q++) {
      // The TV shows the question and options; the phones only have the coloured answer buttons.
      await expect(tv.getByTestId('trivia-question')).toBeVisible();
      await expect(tv.getByTestId('trivia-opt-3')).toBeVisible();
      for (const p of players) {
        await expect(p.page.getByTestId('trivia-answer')).toHaveCount(4);
        await expect(p.page.getByTestId('trivia-question')).toHaveCount(0);
      }
      await players[0].page.getByTestId('trivia-answer').nth(q % 4).click();
      await players[1].page.getByTestId('trivia-answer').nth((q + 1) % 4).click();
      // Reveal: the right answer is marked on the TV and each phone gets a verdict.
      for (const p of players) await expect(p.page.getByTestId('trivia-verdict')).toBeVisible();
      await expect(tv.locator('.trivia-opt.right')).toHaveCount(1);
      await expect(tv.getByTestId('trivia-board')).toBeVisible();
      await host.page.getByTestId('trivia-next').click();
    }

    for (const p of [...players.map((x) => x.page), tv]) {
      await expect(p.getByTestId('trivia-result')).toBeVisible();
      await expect(p.getByTestId('trivia-board').locator('li')).toHaveCount(2);
    }
    await expect(host.page.getByTestId('again')).toBeVisible();
  } finally {
    await room.close();
  }
});

test('Trivia on phones only (ar)', async ({ browser }) => {
  const room = await setupRoom(browser, { lang: 'ar', count: 2 });
  const { host, players } = room;
  try {
    await startGame(host.page, 'trivia', 'phones', { count: 5, seconds: 30 });
    for (const p of players) {
      await expectDir(p.page, 'ar');
      await expect(p.page.getByTestId('trivia-question')).toBeVisible();
      await expect(p.page.getByTestId('trivia-answer')).toHaveCount(4);
    }
    for (let q = 0; q < 5; q++) {
      for (const p of players) await p.page.getByTestId('trivia-answer').first().click();
      for (const p of players) await expect(p.page.getByTestId('trivia-verdict')).toBeVisible();
      await host.page.getByTestId('trivia-next').click();
    }
    for (const p of players) await expect(p.page.getByTestId('trivia-result')).toBeVisible();
  } finally {
    await room.close();
  }
});
