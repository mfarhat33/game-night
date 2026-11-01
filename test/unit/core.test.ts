import { describe, expect, it } from 'vitest';
import { HOST_GRACE_MS, IDLE_MS, cleanName } from '../../src/server/core';
import { MAX_PLAYERS } from '../../src/shared/protocol';
import { makeRoom } from './helpers';

describe('room core', () => {
  it('first player becomes host; names are cleaned and made unique', () => {
    const r = makeRoom();
    const a = r.add('  Rami  ');
    const b = r.add('rami');
    expect(r.core.s.hostId).toBe(a.id);
    expect(r.core.snapshot().players.map((p) => p.name)).toEqual(['Rami', 'rami 2']);
    expect(b.id).not.toBe(a.id);
    expect(cleanName('<b>\nx</b>')).toBe('b x/b');
    expect(r.core.join({ kind: 'player', name: '   ' })).toEqual({ ok: false, code: 'name' });
  });

  it('caps the room at 12 players', () => {
    const r = makeRoom();
    for (let i = 0; i < MAX_PLAYERS; i++) r.add(`P${i}`);
    expect(r.core.join({ kind: 'player', name: 'late' })).toEqual({ ok: false, code: 'full' });
  });

  it('reconnects a player by token and rejects unknown tokens', () => {
    const r = makeRoom();
    const a = r.add('Maya');
    r.online();
    expect(r.core.snapshot().players[0].connected).toBe(false);
    const again = r.core.join({ kind: 'player', token: a.token });
    expect(again).toMatchObject({ ok: true, pid: a.id, token: a.token });
    expect(r.core.join({ kind: 'player', token: 'nope' })).toEqual({ ok: false, code: 'bad_token' });
    expect(r.core.join({ kind: 'player', token: 'nope', name: 'Maya' })).toMatchObject({ ok: true });
  });

  it('screens join without becoming players', () => {
    const r = makeRoom();
    expect(r.core.join({ kind: 'screen' })).toEqual({ ok: true, pid: null, token: null, kind: 'screen' });
    expect(r.core.s.players).toHaveLength(0);
  });

  it('only the host can kick, and kicking closes the player and forgets their token', () => {
    const r = makeRoom();
    const a = r.add('A');
    const b = r.add('B');
    expect(r.core.handle(b.id, { t: 'kick', id: a.id })).toEqual({ ok: false, code: 'not_host' });
    expect(r.core.handle(a.id, { t: 'kick', id: a.id })).toMatchObject({ ok: false });
    const out = r.core.handle(a.id, { t: 'kick', id: b.id });
    expect(out).toMatchObject({ ok: true, close: [{ pid: b.id, reason: 'kicked' }] });
    expect(r.core.s.players.map((p) => p.id)).toEqual([a.id]);
    expect(r.core.join({ kind: 'player', token: b.token })).toEqual({ ok: false, code: 'bad_token' });
  });

  it('hands the host role over when the host leaves', () => {
    const r = makeRoom();
    const a = r.add('A');
    const b = r.add('B');
    r.add('C');
    r.core.handle(a.id, { t: 'leave' });
    expect(r.core.s.hostId).toBe(b.id);
  });

  it('hands the host role over when the host stays offline past the grace time', () => {
    const r = makeRoom();
    const a = r.add('A');
    const b = r.add('B');
    r.online(b.id); // host drops
    r.advance(HOST_GRACE_MS - 1000);
    expect(r.core.s.hostId).toBe(a.id);
    r.advance(2000);
    expect(r.core.s.hostId).toBe(b.id);
  });

  it('keeps the host when they come back in time (page refresh)', () => {
    const r = makeRoom();
    const a = r.add('A');
    const b = r.add('B');
    r.online(b.id);
    r.advance(5000);
    r.core.join({ kind: 'player', token: a.token });
    r.online(a.id, b.id);
    r.advance(HOST_GRACE_MS);
    expect(r.core.s.hostId).toBe(a.id);
  });

  it('host can switch language and pick a game; others cannot', () => {
    const r = makeRoom();
    const a = r.add('A');
    const b = r.add('B');
    expect(r.core.handle(a.id, { t: 'lang', lang: 'ar' })).toEqual({ ok: true });
    expect(r.core.snapshot().lang).toBe('ar');
    expect(r.core.handle(b.id, { t: 'lang', lang: 'en' })).toMatchObject({ ok: false, code: 'not_host' });
    expect(r.core.handle(a.id, { t: 'select', game: 'nope' })).toMatchObject({ ok: false, code: 'unknown_game' });
    expect(r.core.handle(a.id, { t: 'select', game: 'spy', mode: 'screen', settings: { minutes: 99, bogus: 1 } })).toEqual({ ok: true });
    expect(r.core.s.sel).toEqual({ game: 'spy', mode: 'screen', settings: { minutes: 15, voteSeconds: 60, pack: 'all' } });
  });

  it('refuses to start with too few players, then starts and returns to the lobby', () => {
    const r = makeRoom();
    const a = r.add('A');
    r.add('B');
    expect(r.core.handle(a.id, { t: 'start' })).toMatchObject({ ok: false, code: 'too_few' });
    r.add('C');
    expect(r.core.handle(a.id, { t: 'start' })).toEqual({ ok: true });
    expect(r.core.snapshot().game).toMatchObject({ id: 'spy', playing: ['p1', 'p2', 'p3'] });
    expect(Object.keys(r.core.s.timers)).toContain('g:round');
    expect(r.core.handle(a.id, { t: 'end' })).toEqual({ ok: true });
    expect(r.core.s.game).toBeNull();
    expect(Object.keys(r.core.s.timers).filter((k) => k.startsWith('g:'))).toEqual([]);
  });

  it('ends the game when it drops below the minimum', () => {
    const r = makeRoom();
    const a = r.add('A');
    const b = r.add('B');
    r.add('C');
    r.core.handle(a.id, { t: 'start' });
    r.core.handle(a.id, { t: 'kick', id: b.id });
    expect(r.core.s.game).toBeNull();
  });

  it('expires an idle, empty room', () => {
    const r = makeRoom();
    r.add('A');
    r.online();
    expect(r.core.alarm().expired).toBe(false);
    r.clock.t += IDLE_MS;
    expect(r.core.alarm().expired).toBe(true);
  });

  it('late joiners watch until the next round', () => {
    const r = makeRoom();
    const a = r.add('A');
    r.add('B');
    r.add('C');
    r.core.handle(a.id, { t: 'start' });
    const d = r.add('D');
    expect(r.core.playerView(d.id)).toBeNull();
    expect(r.core.handle(d.id, { t: 'act', a: { type: 'ready' } })).toMatchObject({ ok: false, code: 'not_joined' });
    r.core.handle(a.id, { t: 'again' });
    expect(r.core.playerView(d.id)).not.toBeNull();
  });
});
