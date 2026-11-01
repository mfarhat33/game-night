import { expect, test } from '@playwright/test';
import { expectDir, openScreen, setupRoom, startGame, whoShows } from './helpers';

// Headless Chromium has no tilt sensor, so the holder uses the on-screen Correct and Pass buttons.
test('a full round of Charades with the button fallback (ar)', async ({ browser }) => {
  const room = await setupRoom(browser, { lang: 'ar', count: 2 });
  const { host, players } = room;
  try {
    const tv = await openScreen(host.ctx, room.code);
    await startGame(host.page, 'charades', 'screen', { seconds: 10 });
    for (const p of players) await expectDir(p.page, 'ar');

    for (let turn = 0; turn < 2; turn++) {
      const holder = await whoShows(players, 'cha-start');
      const other = players.find((p) => p !== holder)!;
      await expect(other.page.getByTestId('cha-start')).toHaveCount(0);
      await holder.page.getByTestId('cha-start').click();

      // The holder sees the word; nobody else does, not even on the TV.
      const word = holder.page.getByTestId('cha-word');
      await expect(word).toBeVisible();
      const text = (await word.textContent())!.trim();
      expect(text.length).toBeGreaterThan(0);
      await expect(other.page.getByTestId('cha-word')).toHaveCount(0);
      await expect(tv.getByTestId('cha-word')).toHaveCount(0);
      await expect(other.page.locator('body')).not.toContainText(text);
      await expect(tv.getByTestId('timer')).toBeVisible();

      await holder.page.getByTestId('cha-correct').click();
      await expect(holder.page.getByTestId('cha-word')).not.toHaveText(text);
      await expect(other.page.getByTestId('cha-scores')).toContainText('1');
      await expect(tv.getByTestId('cha-scores')).toContainText('1');
      await holder.page.getByTestId('cha-pass').click();

      // The timer runs out, everyone sees the summary and the host moves on.
      for (const p of [...players.map((x) => x.page), tv]) await expect(p.getByTestId('cha-summary')).toBeVisible({ timeout: 20_000 });
      await expect(host.page.getByTestId('cha-summary')).toContainText(text);
      await host.page.getByTestId('cha-next').click();
    }

    for (const p of [...players.map((x) => x.page), tv]) await expect(p.getByTestId('cha-result')).toBeVisible();
    await expect(host.page.getByTestId('again')).toBeVisible();
  } finally {
    await room.close();
  }
});
