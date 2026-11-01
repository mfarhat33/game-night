// WebSocket link to a room, with automatic reconnect and a keepalive ping.
import { CLOSE_GONE, CLOSE_KICKED, CLOSE_LEFT, type ClientMsg, type ServerMsg } from '../shared/protocol';

export type Status = 'connecting' | 'open' | 'closed';

export class Link {
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;
  private ping: number | undefined;
  private timer: number | undefined;

  constructor(
    private code: string,
    /** Builds the join message, called on every (re)connect so it can use a fresh token. */
    private hello: () => ClientMsg,
    private onMsg: (m: ServerMsg) => void,
    private onStatus: (s: Status) => void,
  ) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.stopped && (!this.ws || this.ws.readyState > 1)) this.open();
    });
  }

  open(): void {
    clearTimeout(this.timer);
    if (this.stopped) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/rooms/${this.code}/ws`);
    this.ws = ws;
    this.onStatus('connecting');
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus('open');
      ws.send(JSON.stringify(this.hello()));
      clearInterval(this.ping);
      this.ping = window.setInterval(() => ws.readyState === 1 && ws.send('ping'), 25_000);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      try {
        this.onMsg(JSON.parse(e.data));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      clearInterval(this.ping);
      if ([CLOSE_KICKED, CLOSE_LEFT, CLOSE_GONE].includes(e.code)) this.stopped = true;
      this.onStatus('closed');
      if (this.stopped) return;
      const wait = Math.min(5000, 400 * 2 ** this.retry++);
      this.timer = window.setTimeout(() => this.open(), wait);
    };
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.ping);
    this.ws?.close();
  }
}
