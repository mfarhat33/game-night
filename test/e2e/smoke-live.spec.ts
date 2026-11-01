// Short smoke: create a room, a second phone joins, start Trivia and answer one question.
// Runs with the local suite, and against the deployed site when BASE_URL is set (smoke-live workflow).
import { expect, test } from '@playwright/test';
import { setupRoom, startGame } from './helpers';

test('smoke: create, join, start Trivia, answer one question', async ({ browser }) => {
  const room = await setupRoom(browser, { lang: 'en', count: 2 });
  try {
    await startGame(room.host.page, 'trivia', 'phones', { count: 5, seconds: 30 });
    for (const p of room.players) {
      await expect(p.page.getByTestId('trivia-question')).toBeVisible();
      await expect(p.page.getByTestId('trivia-answer')).toHaveCount(4);
    }
    for (const p of room.players) await p.page.getByTestId('trivia-answer').first().click();
    for (const p of room.players) await expect(p.page.getByTestId('trivia-verdict')).toBeVisible();
  } finally {
    await room.close();
  }
});
