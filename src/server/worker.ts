// Worker entry: a tiny JSON API for rooms. Everything else is served from static assets (dist/).
import { isValidCode, makeCode, normalizeCode } from './codes';
import { ApiGate } from './limits';
import type { Env } from './room';

export { Room } from './room';

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

const limited = (retryAfter: number) => json({ error: 'rate_limited' }, 429, { 'retry-after': String(retryAfter) });

// One gate per isolate; see src/server/limits.ts for what that does and does not guarantee.
const gate = new ApiGate();

/** Cloudflare sets cf-connecting-ip. Local dev may not, so everyone shares one bucket there. */
const clientIp = (req: Request) => req.headers.get('cf-connecting-ip') ?? 'local';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean); // ["api", "rooms", CODE?, "ws"?]
    if (parts[0] !== 'api') return env.ASSETS.fetch(req);
    if (parts[1] !== 'rooms') return json({ error: 'not_found' }, 404);
    const ip = clientIp(req);

    if (parts.length === 2 && req.method === 'POST') {
      const g = gate.create(ip, Date.now());
      if (!g.ok) return limited(g.retryAfter);
      if (Number(req.headers.get('content-length') ?? 0) > 1024) return json({ error: 'too_big' }, 413);
      const body = (await req.json().catch(() => ({}))) as { lang?: string } | null;
      for (let i = 0; i < 12; i++) {
        const code = makeCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, lang: body?.lang }) });
        if (res.ok) return json({ code });
      }
      return json({ error: 'busy' }, 503);
    }

    const g = gate.lookup(ip, Date.now());
    if (!g.ok) return limited(g.retryAfter);
    const code = normalizeCode(parts[2] ?? '');
    if (!isValidCode(code)) {
      gate.miss(ip, Date.now());
      return json({ error: 'not_found' }, 404);
    }
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    let res: Response | null = null;
    if (parts.length === 3 && req.method === 'GET') res = await stub.fetch('https://room/info');
    else if (parts.length === 4 && parts[3] === 'ws') {
      // The Room reads the client IP from this header; always overwrite what the client sent.
      const fwd = new Request('https://room/ws', req);
      fwd.headers.set('x-sahra-ip', ip);
      res = await stub.fetch(fwd);
    }
    if (!res) return json({ error: 'not_found' }, 404);
    if (res.status === 404) gate.miss(ip, Date.now());
    return res;
  },
} satisfies ExportedHandler<Env>;
