// Reusable helpers for end-to-end tests. Each player is a separate browser context (own localStorage),
// like separate phones. A new game needs one spec file that calls setupRoom + startGame and plays a round.
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export type Lang = 'ar' | 'en';
export interface Player {
  name: string;
  ctx: BrowserContext;
  page: Page;
}
export interface Room {
  code: string;
  lang: Lang;
  players: Player[];
  host: Player;
  close(): Promise<void>;
}

export const NAMES: Record<Lang, string[]> = {
  ar: ['ريم', 'سامي', 'نور', 'جاد', 'لين', 'كريم'],
  en: ['Rima', 'Sami', 'Nour', 'Jad', 'Lynn', 'Karim'],
};

async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  return { name, ctx, page };
}

/** Host opens the home page, picks the language and creates a room. */
export async function createRoom(browser: Browser, name: string, lang: Lang): Promise<{ player: Player; code: string }> {
  const player = await newPlayer(browser, name);
  const { page } = player;
  await page.goto('/');
  await page.getByTestId(`lang-${lang}`).click();
  await page.locator('#name').fill(name);
  await page.getByTestId('create').click();
  const code = (await page.getByTestId('room-code').textContent({ timeout: 15_000 }))!.trim();
  expect(code).toMatch(/^[A-Z]{4}$/);
  return { player, code };
}

/** Join from the home page by typing the code. */
export async function joinByCode(browser: Browser, code: string, name: string): Promise<Player> {
  const player = await newPlayer(browser, name);
  await player.page.goto('/');
  await player.page.locator('#name').fill(name);
  await player.page.locator('#code').fill(code.toLowerCase());
  await player.page.getByTestId('join').click();
  await expect(player.page.getByTestId('room-code')).toHaveText(code);
  return player;
}

/** Join by opening the room link (what the QR code encodes). */
export async function joinByLink(browser: Browser, code: string, name: string): Promise<Player> {
  const player = await newPlayer(browser, name);
  await player.page.goto(`/${code}`);
  await player.page.locator('#join-name').fill(name);
  await player.page.getByTestId('join-go').click();
  await expect(player.page.getByTestId('room-code')).toHaveText(code);
  return player;
}

/** Create a room with `count` players: the host, one joining by code, the rest by link. */
export async function setupRoom(browser: Browser, opts: { lang: Lang; count: number }): Promise<Room> {
  const names = NAMES[opts.lang];
  const { player: host, code } = await createRoom(browser, names[0], opts.lang);
  const players = [host];
  for (let i = 1; i < opts.count; i++) players.push(i === 1 ? await joinByCode(browser, code, names[i]) : await joinByLink(browser, code, names[i]));
  await expect(host.page.getByTestId('player')).toHaveCount(opts.count);
  return { code, lang: opts.lang, players, host, close: () => closeAll(players) };
}

/** Open the room as a TV screen in an existing context (screens are not players). */
export async function openScreen(ctx: BrowserContext, code: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/${code}?tv`);
  await expect(page.getByTestId('room-code')).toHaveText(code);
  return page;
}

/** Host picks a game and mode, then starts. */
export async function startGame(host: Page, gameId: string, mode: 'phones' | 'screen' = 'phones'): Promise<void> {
  await host.getByTestId(`game-${gameId}`).click();
  await expect(host.getByTestId(`game-${gameId}`)).toHaveAttribute('aria-pressed', 'true');
  await host.getByTestId(`mode-${mode}`).click();
  await expect(host.getByTestId(`mode-${mode}`)).toHaveAttribute('aria-pressed', 'true');
  await host.getByTestId('start').click();
  await expect(host.getByTestId('start')).toHaveCount(0);
}

/** Host returns everyone to the lobby from a finished round. */
export async function backToLobby(host: Page): Promise<void> {
  await host.getByTestId('to-lobby').click();
  await expect(host.getByTestId('start')).toBeVisible();
}

export async function expectDir(page: Page, lang: Lang): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await expect(page.locator('html')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
}

/** Host removes a player through the confirm sheet. */
export async function kick(host: Page, name: string): Promise<void> {
  await host.locator(`[data-testid=player][data-name="${name}"]`).getByTestId('kick').click();
  await host.getByTestId('confirm-yes').click();
  await expect(host.locator(`[data-testid=player][data-name="${name}"]`)).toHaveCount(0);
}

export async function closeAll(players: Player[]): Promise<void> {
  await Promise.all(players.map((p) => p.ctx.close().catch(() => undefined)));
}
