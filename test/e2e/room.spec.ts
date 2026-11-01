import { expect, test } from '@playwright/test';
import { createRoom, expectDir, joinByLink } from './helpers';

test('two phones: host leaves and the other player becomes host', async ({ browser }) => {
  const { player: host, code } = await createRoom(browser, 'Rima', 'en');
  const guest = await joinByLink(browser, code, 'Sami');
  try {
    await expectDir(guest.page, 'en');
    await expect(guest.page.getByTestId('start')).toHaveCount(0);
    await host.page.getByTestId('leave').click();
    await host.page.getByTestId('confirm-yes').click();
    await expect(host.page.getByTestId('bye')).toBeVisible();
    await expect(guest.page.getByTestId('start')).toBeVisible();
    await expect(guest.page.getByTestId('player')).toHaveCount(1);
  } finally {
    await Promise.all([host.ctx.close(), guest.ctx.close()]);
  }
});

test('unknown room code shows a friendly message', async ({ page }) => {
  await page.goto('/ZZZZ');
  await expect(page.getByTestId('not-found')).toBeVisible();
});
