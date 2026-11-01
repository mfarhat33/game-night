// The Room Durable Object: one per room code. Uses the WebSocket Hibernation API so an idle
// room costs nothing; all state lives in storage and is reloaded when the object wakes.
import { DurableObject } from 'cloudflare:workers';
import { CLOSE_GONE, LANGS, type ClientMsg, type Lang, type ServerMsg } from '../shared/protocol';
import { getPack, getTrivia } from './content';
import { RoomCore, newRoom, type Deps, type RoomState } from './core';
import { GAMES } from './games';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

interface Attachment {
  pid: string | null;
  kind: 'player' | 'screen' | null;
}

const deps: Deps = {
  now: () => Date.now(),
  rand: () => {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    return b[0] / 2 ** 32;
  },
  token: () => crypto.randomUUID().replace(/-/g, ''),
  games: GAMES,
  pack: getPack,
  trivia: getTrivia,
};

export class Room extends DurableObject<Env> {
  private core: RoomCore | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      const s = await ctx.storage.get<RoomState>('room');
      if (s) this.core = new RoomCore(s, deps);
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init' && req.method === 'POST') {
      if (this.core) return new Response('taken', { status: 409 });
      const body = (await req.json().catch(() => ({}))) as { code?: string; lang?: string };
      const lang: Lang = LANGS.includes(body.lang as Lang) ? (body.lang as Lang) : 'ar';
      this.core = new RoomCore(newRoom(String(body.code), lang, GAMES, Date.now()), deps);
      await this.save();
      return Response.json({ code: this.core.s.code });
    }
    if (url.pathname === '/info') {
      if (!this.core) return Response.json({ exists: false }, { status: 404 });
      return Response.json({ exists: true, lang: this.core.s.lang, players: this.core.s.players.length });
    }
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      if (!this.core) return new Response('no such room', { status: 404 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ pid: null, kind: null } satisfies Attachment);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const core = this.core;
    if (!core) return ws.close(CLOSE_GONE, 'gone');
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch {
      return this.send(ws, { t: 'error', code: 'bad_msg' });
    }
    this.presence();
    const att = (ws.deserializeAttachment() ?? { pid: null, kind: null }) as Attachment;

    if (msg.t === 'join') {
      const r = core.join(msg);
      if (!r.ok) return this.send(ws, { t: 'error', code: r.code });
      ws.serializeAttachment({ pid: r.pid, kind: r.kind } satisfies Attachment);
      this.send(ws, { t: 'welcome', id: r.pid, token: r.token, kind: r.kind });
      this.presence();
      await this.commit();
      return;
    }

    const out = core.handle(att.pid, msg);
    if (!out.ok) return this.send(ws, { t: 'error', code: out.code, detail: out.detail });
    for (const c of out.close ?? []) {
      for (const sock of this.socketsOf(c.pid)) {
        this.send(sock, { t: 'bye', reason: c.reason });
        sock.serializeAttachment({ pid: null, kind: null } satisfies Attachment);
        sock.close(c.code, c.reason);
      }
    }
    if (out.quiet) {
      if (out.quiet.ev !== undefined) for (const w of this.open(ws)) if ((w.deserializeAttachment() as Attachment | null)?.kind) this.send(w, { t: 'ev', ev: out.quiet.ev });
      if (core.saveDue(out)) await this.save();
      return;
    }
    this.presence();
    await this.commit();
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    await this.dropped(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropped(ws);
  }

  async alarm(): Promise<void> {
    const core = this.core;
    if (!core) return;
    this.presence();
    const { expired } = core.alarm();
    if (expired) {
      for (const ws of this.ctx.getWebSockets()) ws.close(CLOSE_GONE, 'expired');
      this.core = null;
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.commit();
  }

  // ---- helpers -------------------------------------------------------------

  private async dropped(ws: WebSocket): Promise<void> {
    if (!this.core) return;
    this.presence(ws);
    await this.commit(ws);
  }

  private open(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((w) => w !== except && w.readyState === WebSocket.OPEN);
  }

  private socketsOf(pid: string): WebSocket[] {
    return this.open().filter((w) => (w.deserializeAttachment() as Attachment | null)?.pid === pid);
  }

  private presence(except?: WebSocket): void {
    const online: string[] = [];
    let screens = 0;
    for (const w of this.open(except)) {
      const a = w.deserializeAttachment() as Attachment | null;
      if (a?.pid) online.push(a.pid);
      else if (a?.kind === 'screen') screens++;
    }
    this.core?.setPresence(online, screens);
  }

  private async save(): Promise<void> {
    if (!this.core) return;
    this.core.markSaved();
    await this.ctx.storage.put('room', this.core.s);
    await this.ctx.storage.setAlarm(this.core.nextAlarm());
  }

  /** Persist, then send every connection its own view. */
  private async commit(except?: WebSocket): Promise<void> {
    const core = this.core;
    if (!core) return;
    await this.save();
    const now = Date.now();
    const room = core.snapshot();
    const pub = core.publicView();
    for (const w of this.open(except)) {
      const a = w.deserializeAttachment() as Attachment | null;
      if (!a?.kind) continue;
      this.send(w, { t: 'state', now, room, pub, priv: core.playerView(a.pid) });
    }
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // socket went away; presence is fixed on the next event
    }
  }
}
