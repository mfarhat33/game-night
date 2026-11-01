import { describe, expect, it } from 'vitest';
import { IDLE_MS, EMPTY_MS } from '../../src/server/core';
import {
  ApiGate,
  BUCKET_CAPACITY,
  CLOSE_POLICY,
  CLOSE_TOO_BIG,
  ConnGuard,
  CREATE_LIMIT,
  CREATE_WINDOW_MS,
  LOOKUP_LIMIT,
  MAX_MSG_BYTES,
  MAX_PLAYERS_PER_IP,
  MAX_STRIKES,
  MISS_LIMIT,
  TokenBucket,
  WindowCounter,
  validateMsg,
} from '../../src/server/limits';
import { makeRoom } from './helpers';

describe('token bucket', () => {
  it('allows a burst, then refills over time', () => {
    const b = new TokenBucket(10, 5, 0);
    for (let i = 0; i < 10; i++) expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.take(200)).toBe(true); // 0.2 s * 5/s = 1 token
    expect(b.take(200)).toBe(false);
    expect(b.take(10_000)).toBe(true);
  });
});

describe('connection guard', () => {
  const hello = JSON.stringify({ t: 'join', kind: 'player', name: 'A' });

  it('lets a drawing client through: a batch every 50 ms for a minute', () => {
    const g = new ConnGuard(0);
    const batch = JSON.stringify({ t: 'act', a: { type: 'pts', p: [1, 2, 3, 4] } });
    for (let t = 0; t < 60_000; t += 50) expect(g.check(batch, t).v).toBe('ok');
  });

  it('drops messages over the rate, then closes a socket that keeps flooding', () => {
    const g = new ConnGuard(0);
    let ok = 0;
    for (let i = 0; i < BUCKET_CAPACITY + 20; i++) if (g.check(hello, 0).v === 'ok') ok++;
    expect(ok).toBe(BUCKET_CAPACITY);
    expect(g.check(hello, 0).v).toBe('drop');
    let last = g.check(hello, 0);
    for (let i = 0; i < MAX_STRIKES + 5 && last.v !== 'close'; i++) last = g.check(hello, 0);
    expect(last).toMatchObject({ v: 'close', code: CLOSE_POLICY });
  });

  it('forgives a burst once the window passes', () => {
    const g = new ConnGuard(0);
    for (let i = 0; i < BUCKET_CAPACITY + 10; i++) g.check(hello, 0);
    expect(g.check(hello, 5000).v).toBe('ok');
  });

  it('closes on messages over the size cap, text or binary', () => {
    const g = new ConnGuard(0);
    const big = JSON.stringify({ t: 'act', a: 'x'.repeat(MAX_MSG_BYTES) });
    expect(g.check(big, 0)).toMatchObject({ v: 'close', code: CLOSE_TOO_BIG });
    expect(g.check(new ArrayBuffer(MAX_MSG_BYTES + 1), 0)).toMatchObject({ v: 'close', code: CLOSE_TOO_BIG });
    // Multi-byte text counts in bytes: 6000 Arabic letters are ~12 KB, 9000 are ~18 KB.
    expect(g.check(JSON.stringify({ t: 'act', a: 'ش'.repeat(6000) }), 0).v).toBe('ok');
    expect(g.check(JSON.stringify({ t: 'act', a: 'ش'.repeat(9000) }), 0).v).toBe('close');
  });

  it('answers bad_msg for junk and for null, arrays and numbers', () => {
    const g = new ConnGuard(0);
    for (const raw of ['not json', 'null', '[]', '5', '"x"', '{}', '{"t":5}', '{"t":"nope"}', '{"t":"kick"}', '{"t":"join","kind":"god"}', '{"t":"lang","lang":"fr"}']) {
      expect(g.check(raw, 0), raw).toEqual({ v: 'bad' });
    }
  });
});

describe('message validation', () => {
  it('accepts well formed messages of every type', () => {
    const good = [
      { t: 'join', kind: 'player', name: 'A', token: 'x' },
      { t: 'join', kind: 'screen' },
      { t: 'lang', lang: 'ar' },
      { t: 'select', game: 'spy', mode: 'screen', settings: { a: 1 } },
      { t: 'select' },
      { t: 'start' },
      { t: 'again' },
      { t: 'end' },
      { t: 'kick', id: 'p1' },
      { t: 'host', id: 'p1' },
      { t: 'leave' },
      { t: 'act', a: null },
      { t: 'act', a: { type: 'pick', i: 0 } },
    ];
    for (const m of good) expect(validateMsg(m), JSON.stringify(m)).toBe(m);
  });
  it('rejects null and wrong shapes without throwing', () => {
    for (const m of [null, undefined, 1, 'a', [], { t: 'select', settings: 5 }, { t: 'select', mode: 'x' }, { t: 'act' }, { t: 'join', kind: 'player', name: 5 }]) {
      expect(validateMsg(m)).toBeNull();
    }
  });
});

describe('window counter and API gate', () => {
  it('counts per key per window and then resets', () => {
    const c = new WindowCounter(3, 1000);
    expect([1, 2, 3, 4].map(() => c.hit('a', 0))).toEqual([true, true, true, false]);
    expect(c.blocked('a', 500)).toBe(true);
    expect(c.hit('b', 0)).toBe(true);
    expect(c.retryAfter('a', 400)).toBe(1);
    expect(c.hit('a', 1000)).toBe(true);
  });
  it('stays bounded when many keys arrive', () => {
    const c = new WindowCounter(1, 1000, 100);
    for (let i = 0; i < 1000; i++) c.hit(`ip${i}`, 0);
    expect((c as unknown as { map: Map<string, unknown> }).map.size).toBeLessThanOrEqual(100);
  });
  it('limits room creation per IP', () => {
    const g = new ApiGate();
    for (let i = 0; i < CREATE_LIMIT; i++) expect(g.create('1.1.1.1', 0).ok).toBe(true);
    const r = g.create('1.1.1.1', 1000);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.retryAfter).toBeGreaterThan(0);
    expect(g.create('2.2.2.2', 1000).ok).toBe(true); // other clients are not affected
    expect(g.create('1.1.1.1', CREATE_WINDOW_MS + 1).ok).toBe(true);
  });
  it('limits lookups per IP', () => {
    const g = new ApiGate();
    for (let i = 0; i < LOOKUP_LIMIT; i++) expect(g.lookup('1.1.1.1', 0).ok).toBe(true);
    expect(g.lookup('1.1.1.1', 1).ok).toBe(false);
    expect(g.lookup('3.3.3.3', 1).ok).toBe(true);
  });
  it('cuts off an IP that keeps asking for rooms that do not exist, but not one that typos once', () => {
    const g = new ApiGate();
    g.miss('1.1.1.1', 0);
    expect(g.lookup('1.1.1.1', 1).ok).toBe(true);
    for (let i = 1; i < MISS_LIMIT; i++) g.miss('1.1.1.1', i);
    expect(g.lookup('1.1.1.1', 100).ok).toBe(false);
    expect(g.lookup('2.2.2.2', 100).ok).toBe(true);
    expect(g.lookup('1.1.1.1', 11 * 60_000).ok).toBe(true);
  });
});

describe('joining', () => {
  it('lets a whole family on one home Wi-Fi fill a room', () => {
    const r = makeRoom();
    for (let i = 0; i < MAX_PLAYERS_PER_IP; i++) expect(r.core.join({ kind: 'player', name: `P${i}` }, 'ipA').ok).toBe(true);
    expect(r.core.join({ kind: 'player', name: 'Extra' }, 'ipA').ok).toBe(false);
    expect(r.core.join({ kind: 'player', name: 'Other' }, 'ipB').ok).toBe(false);
  });
  it('lets a known player reconnect by token even when their IP is at the limit', () => {
    const r = makeRoom();
    const first = r.core.join({ kind: 'player', name: 'P0' }, 'ipA');
    for (let i = 1; i < MAX_PLAYERS_PER_IP; i++) r.core.join({ kind: 'player', name: `P${i}` }, 'ipA');
    expect(first.ok && r.core.join({ kind: 'player', token: first.token }, 'ipA').ok).toBe(true);
  });
  it('bans a removed player by token and by name for the rest of the room', () => {
    const r = makeRoom();
    const host = r.add('Host');
    const bad = r.add('Sami');
    r.core.handle(host.id, { t: 'kick', id: bad.id });
    expect(r.core.join({ kind: 'player', token: bad.token })).toEqual({ ok: false, code: 'banned' });
    expect(r.core.join({ kind: 'player', token: bad.token, name: 'Fresh' })).toEqual({ ok: false, code: 'banned' });
    expect(r.core.join({ kind: 'player', name: 'Sami' })).toEqual({ ok: false, code: 'banned' });
    expect(r.core.join({ kind: 'player', name: '  sAMI ' })).toEqual({ ok: false, code: 'banned' });
    expect(r.core.join({ kind: 'player', name: 'Nour' }).ok).toBe(true);
  });
  it('does not ban a player who leaves on their own', () => {
    const r = makeRoom();
    r.add('Host');
    const b = r.add('Sami');
    r.core.handle(b.id, { t: 'leave' });
    expect(r.core.join({ kind: 'player', name: 'Sami' }).ok).toBe(true);
  });
  it('keeps bans in the saved state', () => {
    const r = makeRoom();
    const host = r.add('Host');
    const bad = r.add('Sami');
    r.core.handle(host.id, { t: 'kick', id: bad.id });
    expect(JSON.parse(JSON.stringify(r.core.s)).banned).toEqual({ tokens: [bad.token], names: ['sami'] });
  });
});

describe('handling bad messages', () => {
  it('rejects null and non-objects instead of throwing', () => {
    const r = makeRoom();
    const a = r.add('A');
    for (const m of [null, undefined, 5, 'x', []]) expect(r.core.handle(a.id, m as never)).toEqual({ ok: false, code: 'bad_msg' });
  });
});

describe('room expiry', () => {
  it('deletes a room after inactivity even if a phone is still connected', () => {
    const r = makeRoom();
    const a = r.add('A');
    r.online(a.id);
    r.clock.t += IDLE_MS - 1000;
    expect(r.core.alarm().expired).toBe(false);
    r.clock.t += 1000;
    expect(r.core.alarm().expired).toBe(true);
  });
  it('activity pushes expiry back', () => {
    const r = makeRoom();
    const a = r.add('A');
    r.clock.t += IDLE_MS - 1000;
    r.core.handle(a.id, { t: 'lang', lang: 'ar' });
    r.clock.t += IDLE_MS - 1000;
    expect(r.core.alarm().expired).toBe(false);
  });
  it('deletes a room nobody joined much sooner', () => {
    const r = makeRoom();
    expect(EMPTY_MS).toBeLessThan(IDLE_MS);
    expect(r.core.nextAlarm()).toBe(r.core.s.lastActive + EMPTY_MS);
    r.clock.t += EMPTY_MS;
    expect(r.core.alarm().expired).toBe(true);
  });
});

describe('round 2 fixes', () => {
  it('a screen cannot rejoin with a banned token', () => {
    const r = makeRoom();
    const host = r.add('Host');
    const bad = r.add('Sami');
    r.core.handle(host.id, { t: 'kick', id: bad.id });
    expect(r.core.join({ kind: 'screen', token: bad.token })).toEqual({ ok: false, code: 'banned' });
    expect(r.core.join({ kind: 'screen' }).ok).toBe(true);
  });
  it('messages from non-members do not keep a room alive', () => {
    const r = makeRoom();
    r.add('A');
    const before = r.core.s.lastActive;
    r.clock.t += 1000;
    expect(r.core.handle(null, { t: 'start' })).toMatchObject({ ok: false, code: 'not_joined' });
    expect(r.core.handle('p99', { t: 'start' })).toMatchObject({ ok: false });
    expect(r.core.s.lastActive).toBe(before);
  });
  it('a room with a TV connected is not deleted after EMPTY_MS', () => {
    const r = makeRoom();
    r.core.setPresence([], 1);
    r.clock.t += EMPTY_MS;
    expect(r.core.nextAlarm()).toBe(r.core.s.lastActive + IDLE_MS);
    expect(r.core.alarm().expired).toBe(false);
    r.core.setPresence([], 0);
    expect(r.core.alarm().expired).toBe(true);
  });
});
