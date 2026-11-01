import { expect, test } from '@playwright/test';
import { expectDir, openScreen, setupRoom, startGame, whoShows } from './helpers';

test('a full game of Taboo with four phones (en)', async ({ browser }) => {
  const room = await setupRoom(browser, { lang: 'en', count: 4 });
  const { host, players } = room;
  try {
    await startGame(host.page, 'taboo', 'phones', { seconds: 10, rounds: 1 });
    for (const p of players) await expectDir(p.page, 'en');

    // Teams are balanced; the host can switch a player, but needs two on each team to begin.
    const team = (i: number) => host.page.getByTestId(`taboo-team-${i}`).locator('li');
    await expect(team(0)).toHaveCount(2);
    await expect(team(1)).toHaveCount(2);
    await host.page.getByTestId('taboo-team-0').getByTestId('taboo-swap').first().click();
    await expect(team(1)).toHaveCount(3);
    await expect(players[1].page.getByTestId('taboo-swap')).toHaveCount(0);
    await host.page.getByTestId('taboo-team-1').getByTestId('taboo-swap').first().click();
    await expect(team(0)).toHaveCount(2);
    await host.page.getByTestId('taboo-begin').click();

    for (let turn = 0; turn < 2; turn++) {
      const giver = await whoShows(players, 'taboo-start');
      await giver.page.getByTestId('taboo-start').click();
      const word = giver.page.getByTestId('taboo-word');
      await expect(word).toBeVisible();
      const text = (await word.textContent())!.trim();
      await expect(giver.page.getByTestId('taboo-banned')).toHaveCount(5);

      // The other team sees the card and has the buzzer; the giver's teammates see neither.
      const seeing = players.filter((p) => p !== giver);
      let buzzers = 0;
      let quiet = 0;
      for (const p of seeing) {
        await expect.poll(async () => (await p.page.getByTestId('taboo-card').count()) + (await p.page.getByTestId('taboo-score').count())).toBeGreaterThan(0);
        if (await p.page.getByTestId('taboo-buzz').count()) {
          buzzers++;
          await expect(p.page.getByTestId('taboo-word')).toHaveText(text);
        } else {
          quiet++;
          await expect(p.page.getByTestId('taboo-card')).toHaveCount(0);
          await expect(p.page.locator('body')).not.toContainText(text);
        }
      }
      expect(buzzers).toBe(2);
      expect(quiet).toBe(1);

      // Two right, one skip, one slip (-1): the team scores 1.
      const cur = giver.page.getByTestId('taboo-word');
      const next = async (btn: string) => {
        const before = (await cur.textContent())!.trim();
        await giver.page.getByTestId(btn).click();
        await expect(cur).not.toHaveText(before);
        return (await cur.textContent())!.trim();
      };
      await next('taboo-correct');
      await next('taboo-correct');
      const slipWord = await next('taboo-skip');
      for (const p of seeing) {
        if (!(await p.page.getByTestId('taboo-buzz').count())) continue;
        await expect(p.page.getByTestId('taboo-word')).toHaveText(slipWord); // the buzzer's card is up to date
        await p.page.getByTestId('taboo-buzz').click();
        break;
      }

      for (const p of players) await expect(p.page.getByTestId('taboo-summary')).toBeVisible({ timeout: 20_000 });
      await expect(host.page.getByTestId('taboo-summary').locator('li')).toHaveCount(4);
      await expect(host.page.getByTestId('taboo-summary').locator('.m-buzz')).toHaveCount(1);
      await host.page.getByTestId('taboo-next').click();
    }

    for (const p of players) await expect(p.page.getByTestId('taboo-result')).toBeVisible();
    // Both teams scored 1 (+2 -1 for correct x2 and a slip), so it is a tie.
    await expect(host.page.getByTestId('taboo-result')).toHaveAttribute('data-winner', '-1');
    await expect(host.page.getByTestId('again')).toBeVisible();
  } finally {
    await room.close();
  }
});

// With a TV: the board shows teams, score and timer, and never a card. Only phones hold the cards.
test('a full game of Taboo with a TV (ar)', async ({ browser }) => {
  const room = await setupRoom(browser, { lang: 'ar', count: 4 });
  const { host, players } = room;
  try {
    const tv = await openScreen(host.ctx, room.code);
    await startGame(host.page, 'taboo', 'screen', { seconds: 10, rounds: 1 });
    await expectDir(tv, 'ar');

    // The TV lists the teams but has no controls.
    await expect(tv.getByTestId('taboo-team-0').locator('li')).toHaveCount(2);
    await expect(tv.getByTestId('taboo-team-1').locator('li')).toHaveCount(2);
    await expect(tv.getByTestId('taboo-swap')).toHaveCount(0);
    await expect(tv.getByTestId('taboo-begin')).toHaveCount(0);
    await host.page.getByTestId('taboo-begin').click();

    for (let turn = 0; turn < 2; turn++) {
      const giver = await whoShows(players, 'taboo-start');
      await expect(tv.getByTestId('taboo-start')).toHaveCount(0);
      await giver.page.getByTestId('taboo-start').click();
      const word = giver.page.getByTestId('taboo-word');
      await expect(word).toBeVisible();
      const text = (await word.textContent())!.trim();

      await expect(tv.getByTestId('timer')).toBeVisible();
      await expect(tv.getByTestId('taboo-card')).toHaveCount(0);
      await expect(tv.getByTestId('taboo-buzz')).toHaveCount(0);
      await expect(tv.locator('body')).not.toContainText(text);

      await giver.page.getByTestId('taboo-correct').click();
      await expect(tv.getByTestId('taboo-score')).toContainText('1');
      await giver.page.getByTestId('taboo-correct').click();
      await expect(tv.getByTestId('taboo-score')).toContainText('2');

      for (const page of [...players.map((p) => p.page), tv]) await expect(page.getByTestId('taboo-summary')).toBeVisible({ timeout: 20_000 });
      await expect(tv.getByTestId('taboo-next')).toHaveCount(0);
      await host.page.getByTestId('taboo-next').click();
    }

    for (const page of [...players.map((p) => p.page), tv]) await expect(page.getByTestId('taboo-result')).toBeVisible();
    await expect(tv.getByTestId('taboo-result')).toHaveAttribute('data-winner', '-1');
  } finally {
    await room.close();
  }
});
