import { expect, test } from '@playwright/test';
import { backToLobby, setupRoom, startGame, type Player } from './helpers';

interface Seat {
  p: Player;
  team: number;
  guide: boolean;
}

test('a full game of Shabakeh with four phones (en)', async ({ browser }) => {
  const room = await setupRoom(browser, { lang: 'en', count: 4 });
  const { host } = room;
  try {
    await startGame(host.page, 'wordgrid', 'phones');
    const seats: Seat[] = [];
    for (const p of room.players) {
      const me = p.page.getByTestId('wg-me');
      await expect(me).toBeVisible();
      seats.push({ p, team: Number(await me.getAttribute('data-team')), guide: (await me.getAttribute('data-guide')) === '1' });
    }
    expect(seats.filter((s) => s.guide)).toHaveLength(2);
    expect(seats.filter((s) => s.team === 0)).toHaveLength(2);

    // Only Guides get the secret key in their page.
    for (const s of seats) await expect(s.p.page.locator('[data-testid=wg-tile][data-key]')).toHaveCount(s.guide ? 25 : 0);
    await expect(host.page.getByTestId('wg-tile')).toHaveCount(25);

    const turn = async () => Number(await host.page.getByTestId('wg-turn').getAttribute('data-team'));
    const keyOf = (s: Seat) => s.p.page.getByTestId('wg-tile').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-key'))));
    const tile = (s: Seat, i: number) => s.p.page.locator(`[data-testid=wg-tile][data-i="${i}"]`);

    // Team A gives a clue (a word on the grid is refused on the spot), then taps a neutral tile: the turn passes.
    const a = await turn();
    const guideA = seats.find((s) => s.guide && s.team === a)!;
    const guessA = seats.find((s) => !s.guide && s.team === a)!;
    const keyA = await keyOf(guideA);
    expect(keyA.filter((k) => k === a)).toHaveLength(9);
    const board = await guideA.p.page.locator('[data-testid=wg-tile] .wg-w').first().textContent();
    await guideA.p.page.getByTestId('wg-clue-input').fill(board!);
    await guideA.p.page.getByTestId('wg-send').click();
    await expect(guideA.p.page.getByTestId('wg-error')).not.toBeEmpty();
    await guideA.p.page.getByTestId('wg-clue-input').fill('zzclue');
    await guideA.p.page.getByTestId('wg-num').nth(2).click();
    await guideA.p.page.getByTestId('wg-send').click();
    await expect(guessA.p.page.getByTestId('wg-clue')).toContainText('zzclue');
    await tile(guessA, keyA.indexOf(2)).click();
    await expect(host.page.getByTestId('wg-turn')).toHaveAttribute('data-team', String(1 - a));
    await expect(host.page.getByTestId('wg-turn')).toHaveAttribute('data-phase', 'clue');

    // Team B finds all of its tiles in one turn and wins.
    const b = 1 - a;
    const guideB = seats.find((s) => s.guide && s.team === b)!;
    const guessB = seats.find((s) => !s.guide && s.team === b)!;
    const keyB = await keyOf(guideB);
    await guideB.p.page.getByTestId('wg-clue-input').fill('zzother');
    await guideB.p.page.getByTestId('wg-num').nth(8).click();
    await guideB.p.page.getByTestId('wg-send').click();
    for (let i = 0; i < 25; i++) {
      if (keyB[i] !== b) continue;
      await tile(guessB, i).click();
      await expect(tile(guessB, i)).toHaveAttribute('data-up', '1');
    }
    for (const s of seats) await expect(s.p.page.getByTestId('wg-result')).toHaveAttribute('data-winner', String(b));
    await expect(host.page.getByTestId('wg-result')).toContainText('wins');
    // The key is revealed to everybody at the end.
    await expect(guessA.p.page.locator('[data-testid=wg-tile][data-kind="3"]')).toHaveCount(1);

    await backToLobby(host.page);
    for (const s of seats) {
      const score = host.page.locator(`[data-testid=player][data-name="${s.p.name}"] .score`);
      if (s.team === b) await expect(score).toContainText('3');
      else await expect(score).toHaveCount(0);
    }
  } finally {
    await room.close();
  }
});
