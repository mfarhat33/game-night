import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
const { default: worker } = await import('../../src/server/worker');

const env = {
  ROOMS: { idFromName: (n: string) => n, get: () => ({ fetch: async () => new Response('no', { status: 404 }) }) },
  ASSETS: { fetch: async () => new Response('asset') },
} as never;
const req = (path: string, ip: string, headers: Record<string, string> = {}) => new Request(`https://x${path}`, { headers: { 'cf-connecting-ip': ip, ...headers } });

describe('worker miss counting', () => {
  it('websocket 404s on a well formed code never lock an IP out', async () => {
    for (let i = 0; i < 40; i++) {
      const res = await worker.fetch(req('/api/rooms/BCDF/ws', '9.9.9.9', { Upgrade: 'websocket' }), env);
      expect(res.status).toBe(404);
    }
    expect((await worker.fetch(req('/api/rooms/BCDF', '9.9.9.9'), env)).status).toBe(404);
  });
  it('repeated /info lookups of missing rooms do lock the IP out', async () => {
    const codes = ['BCDF', 'BCDG', 'BCDH', 'BCDJ', 'BCDK', 'BCDM', 'BCDN', 'BCDP', 'BCDQ', 'BCDR', 'BCDS', 'BCDT', 'BCDV'];
    const statuses: number[] = [];
    for (const c of codes) statuses.push((await worker.fetch(req(`/api/rooms/${c}`, '8.8.8.8'), env)).status);
    expect(statuses.at(-1)).toBe(429);
  });
});
