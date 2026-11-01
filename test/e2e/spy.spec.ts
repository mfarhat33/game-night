import { expect, test } from '@playwright/test';
import { backToLobby, expectDir, kick, openScreen, setupRoom, startGame, type Lang, type Player } from './helpers';

async function readCard(p: Player): Promise<{ spy: boolean; place: string }> {
  const card = p.page.getByTestId('spy-card');
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const spy = ((await card.getAttribute('class')) ?? '').includes('is-spy');
  return { spy, place: (await p.page.getByTestId('spy-place').textContent())!.trim() };
}

for (const lang of ['ar', 'en'] as Lang[]) {
  test(`room basics and a full round of Spy (${lang})`, async ({ browser }) => {
    const room = await setupRoom(browser, { lang, count: 3 });
    const { host, players } = room;
    const [, second, third] = players;
    try {
      for (const p of players) await expectDir(p.page, lang);

      // The host can switch the language for the whole room.
      const other: Lang = lang === 'ar' ? 'en' : 'ar';
      await host.page.getByTestId(`lang-${other}`).click();
      await expectDir(second.page, other);
      await host.page.getByTestId(`lang-${lang}`).click();
      await expectDir(second.page, lang);

      // Reconnect after a refresh keeps the same player.
      await second.page.reload();
      await expect(second.page.getByTestId('room-code')).toHaveText(room.code);
      await expect(second.page.getByTestId('wait-host')).toBeVisible();
      await expectDir(second.page, lang);
      await expect(host.page.getByTestId('player')).toHaveCount(3);

      // English plays with a TV screen, Arabic with phones only.
      const tv = lang === 'en' ? await openScreen(host.ctx, room.code) : null;
      await startGame(host.page, 'spy', tv ? 'screen' : 'phones');
      if (tv) await expect(tv.getByTestId('timer')).toBeVisible();

      const cards = await Promise.all(players.map(readCard));
      expect(cards.filter((c) => c.spy)).toHaveLength(1);
      const spyIdx = cards.findIndex((c) => c.spy);
      const spy = players[spyIdx];
      const place = cards.find((c) => !c.spy)!.place;
      for (const c of cards) if (!c.spy) expect(c.place).toBe(place);

      // A majority (2 of 3) is ready, which opens the vote: the others pick the spy, the spy picks someone else.
      for (const p of players.slice(0, 2)) await p.page.getByTestId('spy-ready').click();
      for (const p of players) {
        const target = p === spy ? players.find((x) => x !== spy)!.name : spy.name;
        await p.page.getByTestId('spy-vote').filter({ hasText: target }).click();
        await expect(p.page.getByTestId('spy-vote')).toHaveCount(0);
      }

      // Caught: the spy guesses a wrong place.
      const options = (await spy.page.getByTestId('spy-guess').allTextContents()).map((s) => s.trim());
      const wrong = options.find((o) => o !== place)!;
      await spy.page.getByTestId('spy-guess').filter({ hasText: wrong }).first().click();
      for (const p of players) await expect(p.page.getByTestId('spy-result')).toHaveAttribute('data-outcome', 'caught');
      await expect(host.page.getByTestId('spy-result')).toContainText(place);
      if (tv) await expect(tv.getByTestId('spy-result')).toContainText(spy.name);

      // Back to the lobby with scores, then the host removes a player.
      await backToLobby(host.page);
      const scorer = players.find((p) => p !== spy)!;
      await expect(host.page.locator(`[data-testid=player][data-name="${scorer.name}"]`)).toContainText('2');
      await kick(host.page, third.name);
      await expect(third.page.getByTestId('bye')).toBeVisible();
      await expect(host.page.getByTestId('player')).toHaveCount(2);
      // The removed player's token is forgotten: reloading asks for a name again.
      await third.page.goto(`/${room.code}`);
      await expect(third.page.locator('#join-name')).toBeVisible();
    } finally {
      await room.close();
    }
  });
}
