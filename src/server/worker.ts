// Worker entry: a tiny JSON API for rooms. Everything else is served from static assets (dist/).
import { isValidCode, makeCode, normalizeCode } from './codes';
import type { Env } from './room';

export { Room } from './room';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean); // ["api", "rooms", CODE?, "ws"?]
    if (parts[0] !== 'api') return env.ASSETS.fetch(req);
    if (parts[1] !== 'rooms') return json({ error: 'not_found' }, 404);

    if (parts.length === 2 && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { lang?: string };
      for (let i = 0; i < 12; i++) {
        const code = makeCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, lang: body.lang }) });
        if (res.ok) return json({ code });
      }
      return json({ error: 'busy' }, 503);
    }

    const code = normalizeCode(parts[2] ?? '');
    if (!isValidCode(code)) return json({ error: 'not_found' }, 404);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    if (parts.length === 3 && req.method === 'GET') return stub.fetch('https://room/info');
    if (parts.length === 4 && parts[3] === 'ws') return stub.fetch(new Request('https://room/ws', req));
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
