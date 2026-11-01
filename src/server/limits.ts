// Abuse limits with no Cloudflare APIs, so they can be unit tested in plain Node.
//
// Why not the Workers Rate Limiting binding? Cloudflare's docs for it say nothing about the Workers Free
// plan either way, they call its counts approximate and per data centre, and they advise against using IP
// addresses as keys. Rather than ship a deploy that might be refused on Free, everything here is plain code:
//  - per-socket limits live inside the Room Durable Object (one object per room, so they are exact), and
//  - per-IP limits in the Worker are counted in memory, per isolate. That is a soft limit: the Worker can run
//    in several isolates and data centres, each with its own counts, and counts reset when an isolate is
//    recycled. It still stops one script or one browser tab loop, which is the realistic abuse; a determined
//    distributed attacker is out of scope for the free plan (Cloudflare WAF rate-limiting rules are the next
//    step if it ever matters). Per-IP join failures are counted inside the room, where they are exact.

import { LANGS, type ClientMsg } from '../shared/protocol';

/** Largest WebSocket message we accept. Draw batches are well under 4 KB; this leaves room to grow. */
export const MAX_MSG_BYTES = 16 * 1024;
/** Players from one IP in one room. A whole family often shares one home Wi-Fi, so allow a full room (12). */
export const MAX_PLAYERS_PER_IP = 12;
/** Sockets in one room, and from one IP in one room (players, TVs and reconnects overlapping). */
export const MAX_SOCKETS_PER_ROOM = 48;
export const MAX_SOCKETS_PER_IP = 30;

/** Close codes (1008 policy violation, 1009 message too big). */
export const CLOSE_POLICY = 1008;
export const CLOSE_TOO_BIG = 1009;

// ---- per-IP counters ---------------------------------------------------------------------------

/** Counts events per key in fixed windows. Memory is bounded: expired keys are pruned and the map is capped. */
export class WindowCounter {
  private map = new Map<string, { n: number; end: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private maxKeys = 5000,
  ) {}

  private entry(key: string, now: number): { n: number; end: number } {
    let e = this.map.get(key);
    if (!e || e.end <= now) {
      if (this.map.size >= this.maxKeys) this.prune(now);
      e = { n: 0, end: now + this.windowMs };
      this.map.set(key, e);
    }
    return e;
  }

  private prune(now: number): void {
    for (const [k, e] of this.map) if (e.end <= now) this.map.delete(k);
    // Still full of live keys: drop the oldest ones.
    for (const k of this.map.keys()) {
      if (this.map.size < this.maxKeys * 0.9) break;
      this.map.delete(k);
    }
  }

  /** Count one event. Returns false once the key is over the limit for this window. */
  hit(key: string, now: number): boolean {
    return ++this.entry(key, now).n <= this.limit;
  }

  /** Is the key already over the limit? Does not count. */
  blocked(key: string, now: number): boolean {
    const e = this.map.get(key);
    return !!e && e.end > now && e.n >= this.limit;
  }

  /** Seconds until the key's window ends (for Retry-After). */
  retryAfter(key: string, now: number): number {
    const e = this.map.get(key);
    return e && e.end > now ? Math.max(1, Math.ceil((e.end - now) / 1000)) : 1;
  }
}

// ---- per-socket token bucket -------------------------------------------------------------------

export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    readonly capacity: number,
    readonly perSecond: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.perSecond);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

// Drawing sends one batch every 50 ms (20 per second) plus taps and guesses, so allow 40 per second
// sustained with a burst of 80. A person cannot reach that by hand; a script can.
export const BUCKET_CAPACITY = 80;
export const BUCKET_PER_SECOND = 40;
/** A socket that has this many messages dropped within STRIKE_WINDOW_MS is closed. */
export const MAX_STRIKES = 100;
export const STRIKE_WINDOW_MS = 10_000;

export type Verdict = { v: 'ok'; msg: ClientMsg } | { v: 'bad' } | { v: 'drop' } | { v: 'close'; code: number; reason: string };

/** Everything the Room checks before looking at a message from one socket. */
export class ConnGuard {
  private bucket: TokenBucket;
  private strikes = 0;
  private strikeEnd = 0;

  constructor(now: number) {
    this.bucket = new TokenBucket(BUCKET_CAPACITY, BUCKET_PER_SECOND, now);
  }

  check(data: string | ArrayBuffer, now: number): Verdict {
    const size = typeof data === 'string' ? data.length * 3 /* worst case UTF-8, cheap upper bound */ : data.byteLength;
    // Strings: length is in UTF-16 units; only measure exactly when the cheap bound is over the cap.
    if (size > MAX_MSG_BYTES && (typeof data !== 'string' || new TextEncoder().encode(data).length > MAX_MSG_BYTES)) {
      return { v: 'close', code: CLOSE_TOO_BIG, reason: 'too big' };
    }
    if (!this.bucket.take(now)) {
      if (now >= this.strikeEnd) {
        this.strikes = 0;
        this.strikeEnd = now + STRIKE_WINDOW_MS;
      }
      return ++this.strikes > MAX_STRIKES ? { v: 'close', code: CLOSE_POLICY, reason: 'slow down' } : { v: 'drop' };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
    } catch {
      return { v: 'bad' };
    }
    const msg = validateMsg(raw);
    return msg ? { v: 'ok', msg } : { v: 'bad' };
  }
}

// ---- message validation ------------------------------------------------------------------------

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const optStr = (x: unknown) => x === undefined || typeof x === 'string';

/** Returns the message if it is an object of a known type with fields of the right type, else null. */
export function validateMsg(raw: unknown): ClientMsg | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'join':
      return (raw.kind === 'player' || raw.kind === 'screen') && optStr(raw.name) && optStr(raw.token) ? (raw as ClientMsg) : null;
    case 'lang':
      return LANGS.includes(raw.lang as never) ? (raw as ClientMsg) : null;
    case 'select':
      return optStr(raw.game) && (raw.mode === undefined || raw.mode === 'screen' || raw.mode === 'phones') && (raw.settings === undefined || isObj(raw.settings)) ? (raw as ClientMsg) : null;
    case 'kick':
    case 'host':
      return typeof raw.id === 'string' ? (raw as ClientMsg) : null;
    case 'start':
    case 'again':
    case 'end':
    case 'leave':
      return raw as ClientMsg;
    case 'act':
      return 'a' in raw ? (raw as ClientMsg) : null;
    default:
      return null;
  }
}

// ---- per-IP limits on the HTTP API ---------------------------------------------------------------

export const CREATE_LIMIT = 30; // rooms per IP per 10 minutes
export const CREATE_WINDOW_MS = 10 * 60_000;
export const LOOKUP_LIMIT = 240; // GET /api/rooms/CODE and WebSocket upgrades per IP per minute
export const LOOKUP_WINDOW_MS = 60_000;
export const MISS_LIMIT = 12; // lookups of rooms that do not exist, per IP per 10 minutes
export const MISS_WINDOW_MS = 10 * 60_000;

export type GateResult = { ok: true } | { ok: false; retryAfter: number };

/** Throttles room creation, room lookups and wrong-code guesses per client IP. Counts live in memory (see top of file). */
export class ApiGate {
  private creates = new WindowCounter(CREATE_LIMIT, CREATE_WINDOW_MS);
  private lookups = new WindowCounter(LOOKUP_LIMIT, LOOKUP_WINDOW_MS);
  private misses = new WindowCounter(MISS_LIMIT, MISS_WINDOW_MS);

  create(ip: string, now: number): GateResult {
    return this.creates.hit(ip, now) ? { ok: true } : { ok: false, retryAfter: this.creates.retryAfter(ip, now) };
  }

  /** Call before a lookup or WebSocket upgrade. */
  lookup(ip: string, now: number): GateResult {
    if (this.misses.blocked(ip, now)) return { ok: false, retryAfter: this.misses.retryAfter(ip, now) };
    return this.lookups.hit(ip, now) ? { ok: true } : { ok: false, retryAfter: this.lookups.retryAfter(ip, now) };
  }

  /** Call when a lookup found no such room (or the code was malformed): code guessing looks like this. */
  miss(ip: string, now: number): void {
    this.misses.hit(ip, now);
  }
}
