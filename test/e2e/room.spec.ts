import { expect, test } from '@playwright/test';
import { encode } from 'uqr';
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

test('the QR code encodes the room link', async ({ browser }) => {
  const { player: host, code } = await createRoom(browser, 'Rima', 'en');
  try {
    const link = `${new URL(host.page.url()).origin}/${code}`;
    const qr = host.page.getByTestId('qr').locator('svg');
    await expect(qr).toBeVisible();
    // Rebuild the module matrix from the drawn squares and compare it with a QR code made for the link.
    const { size, path } = await qr.evaluate((svg) => ({ size: Number(svg.getAttribute('viewBox')!.split(' ')[2]), path: svg.querySelector('path')!.getAttribute('d')! }));
    const drawn = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    for (const m of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) drawn[Number(m[2])][Number(m[1])] = true;
    const expected = encode(link, { ecc: 'M', border: 2 });
    expect(size).toBe(expected.size);
    expect(drawn).toEqual(expected.data);
    // And it is not just any code: another link gives a different picture.
    expect(drawn).not.toEqual(encode(`${link}X`, { ecc: 'M', border: 2 }).data);
    // The link it encodes really opens the join page for this room.
    const guest = await joinByLink(browser, code, 'Sami');
    await guest.ctx.close();
  } finally {
    await host.ctx.close();
  }
});

test('a socket cannot join twice and is closed for an oversized message', async ({ browser }) => {
  const { player: host, code } = await createRoom(browser, 'Rima', 'en');
  try {
    const result = await host.page.evaluate(async (c) => {
      const ws = new WebSocket(`ws://${location.host}/api/rooms/${c}/ws`);
      const got: string[] = [];
      let closeCode = 0;
      ws.onmessage = (e) => got.push(String(e.data));
      ws.onclose = (e) => (closeCode = e.code);
      await new Promise((r) => (ws.onopen = r));
      const wait = () => new Promise((r) => setTimeout(r, 400));
      ws.send(JSON.stringify({ t: 'join', kind: 'player', name: 'Extra' }));
      await wait();
      ws.send(JSON.stringify({ t: 'join', kind: 'player', name: 'Extra2' }));
      ws.send('null');
      await wait();
      ws.send(JSON.stringify({ t: 'act', a: 'x'.repeat(20_000) }));
      await wait();
      return { got, closeCode };
    }, code);
    expect(result.got.some((m) => m.includes('"already_joined"'))).toBe(true);
    expect(result.got.some((m) => m.includes('"bad_msg"'))).toBe(true);
    expect(result.closeCode).toBe(1009);
    await expect(host.page.getByTestId('player')).toHaveCount(2);
  } finally {
    await host.ctx.close();
  }
});
