/**
 * LIVE PINGS + MENTORS, the server rule (R-PING-01..03; owner 2026-10-29): who may ping whom and who hears it, the mentor
 * change, and the per-sender limit. The Versus room (`room.ts relayPing`) and the lobby live object run exactly these.
 */
import { describe, expect, it } from 'vitest';
import { livePingRoom, PING_RATE, PingRateLimiter, routePing, routePingClear, routePingMentor, teammateOf, withMentor, type PingRoomView } from '../src/pings';

const ping = (over: Record<string, unknown> = {}) => ({ id: 'a.1', kind: 'check', owner: 'p1', target: { t: 'card', uid: '42', zone: 'shop' }, from: 'spoofed', ...over });

const duel: PingRoomView = { mode: 'duel', members: [{ userId: 'ann', role: 'p1' }, { userId: 'bob', role: 'p2' }, { userId: 'sam', role: 'spectator' }, { userId: 'tia', role: 'spectator' }], mentors: {} };
const duos: PingRoomView = {
  mode: 'duos',
  members: [{ userId: 'ann', role: 'p1' }, { userId: 'amy', role: 'p2' }, { userId: 'bob', role: 'p3' }, { userId: 'ben', role: 'p4' }, { userId: 'sam', role: 'spectator' }],
  mentors: {},
};
const lobby: PingRoomView = { mode: 'lobby', members: [{ userId: 'ann', role: 'p1' }, { userId: 'sam', role: 'spectator' }, { userId: 'tia', role: 'spectator' }], mentors: {} };

describe('routePing (R-PING-01..03)', () => {
  it('a player pings their own targets: the stands hear it, the opponent never does, from is stamped', () => {
    const r = routePing(duel, 'ann', ping());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ping.role).toBe('self');
    expect(r.ping.from).toBe('ann');
    expect(r.to.sort()).toEqual(['sam', 'tia']);
    expect(r.to).not.toContain('bob');
  });

  it('a solo lobby / Practice player pings: every spectator sees it', () => {
    const r = routePing(lobby, 'ann', ping());
    expect(r.ok && r.to.sort()).toEqual(['sam', 'tia']);
  });

  it('DUOS: teammates ping each other live; the other team never receives', () => {
    const mine = routePing(duos, 'ann', ping({ owner: 'p2' }));
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.ping.role).toBe('mate');
    expect(mine.to).toContain('amy');
    expect(mine.to).toContain('sam');
    expect(mine.to).not.toContain('bob');
    expect(mine.to).not.toContain('ben');
    // my own target: my teammate sees it too
    const self = routePing(duos, 'ann', ping({ owner: 'p1' }));
    expect(self.ok && self.to.sort()).toEqual(['amy', 'sam']);
  });

  it('an opponent can never ping a player', () => {
    expect(routePing(duel, 'bob', ping({ owner: 'p1' }))).toEqual({ ok: false, reason: 'not_allowed' });
    expect(routePing(duos, 'bob', ping({ owner: 'p1' }))).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('a spectator who is not a mentor is dropped', () => {
    expect(routePing(duel, 'sam', ping())).toEqual({ ok: false, reason: 'not_allowed' });
  });

  it('the promoted mentor pings: ONLY that player receives it', () => {
    const room = { ...duel, mentors: { p1: 'sam' } };
    const r = routePing(room, 'sam', ping());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ping.role).toBe('mentor');
    expect(r.to).toEqual(['ann']);
    // a mentor of p1 cannot ping p2's targets
    expect(routePing(room, 'sam', ping({ owner: 'p2' })).ok).toBe(false);
  });

  it('a demoted mentor is dropped; a mentor who took a seat is no longer a mentor', () => {
    const promoted = withMentor({}, { seat: 'p1', mentor: 'sam' });
    const demoted = withMentor(promoted, { seat: 'p1', mentor: null });
    expect(routePing({ ...duel, mentors: demoted }, 'sam', ping()).ok).toBe(false);
    const seated: PingRoomView = { ...duel, members: duel.members.map((m) => (m.userId === 'sam' ? { ...m, role: 'p3' } : m)), mentors: promoted };
    expect(routePing(seated, 'sam', ping()).ok).toBe(false);
  });

  it('a client role claim is ignored (the server derives it)', () => {
    const r = routePing(duel, 'ann', ping({ role: 'mentor' }));
    expect(r.ok && r.ping.role).toBe('self');
  });

  it('malformed payloads and empty seats are refused', () => {
    expect(routePing(duel, 'ann', { ...ping(), kind: 'nuke' }).ok).toBe(false);
    expect(routePing(duel, 'ann', { ...ping(), target: { t: 'card', uid: 'x"y', zone: 'shop' } }).ok).toBe(false);
    expect(routePing(duel, 'ann', ping({ owner: 'p4' }))).toEqual({ ok: false, reason: 'no_owner' });
    expect(routePing(duel, 'ann', ping({ target: { t: 'button', id: 'endturn' } })).ok).toBe(true);
  });
});

describe('routePingMentor (R-PING-03)', () => {
  it('only the seated player names their own mentor, and only a spectator in the room', () => {
    expect(routePingMentor(duel, 'ann', { seat: 'p1', mentor: 'sam', name: 'Sam' })).toEqual({ seat: 'p1', mentor: 'sam', name: 'Sam' });
    expect(routePingMentor(duel, 'sam', { seat: 'p1', mentor: 'sam' })).toBeNull(); // a spectator promoting themself
    expect(routePingMentor(duel, 'bob', { seat: 'p1', mentor: 'tia' })).toBeNull(); // an opponent naming my mentor
    expect(routePingMentor(duel, 'ann', { seat: 'p1', mentor: 'bob' })).toBeNull(); // a player cannot mentor
    expect(routePingMentor(duel, 'ann', { seat: 'p1', mentor: null })).toEqual({ seat: 'p1', mentor: null });
  });

  it('one mentor per player: naming another replaces the first', () => {
    const a = withMentor({}, { seat: 'p1', mentor: 'sam' });
    const b = withMentor(a, { seat: 'p1', mentor: 'tia' });
    expect(b).toEqual({ p1: 'tia' });
  });
});

describe('rate limit + teammates', () => {
  it(`allows ${PING_RATE.max} pings per ${PING_RATE.windowMs} ms per sender`, () => {
    const l = new PingRateLimiter();
    expect([0, 10, 20].map((t) => l.allow('ann', t))).toEqual([true, true, true]);
    expect(l.allow('ann', 30)).toBe(false);
    expect(l.allow('sam', 30)).toBe(true); // per sender
    expect(l.allow('ann', PING_RATE.windowMs + 1)).toBe(true);
  });

  it('teammates: Duos p1+p2 / p3+p4, the Ranked Duos party p1+p2, none in 1v1, Group or a lobby', () => {
    expect(teammateOf('duos', 'p3')).toBe('p4');
    expect(teammateOf('ranked_duos', 'p2')).toBe('p1');
    expect(teammateOf('duel', 'p1')).toBeNull();
    expect(teammateOf('group', 'p1')).toBeNull();
    expect(teammateOf('lobby', 'p1')).toBeNull();
  });
});

describe('livePingRoom: the Cloudflare live lobby / Practice object (R-PING-01..03)', () => {
  it('the player is p1, watchers are the stands; only the named mentor reaches the player, only the player hears it', () => {
    const room = livePingRoom('ann', ['sam', 'tia', 'ann'], 'sam');
    expect(room.members).toEqual([{ userId: 'ann', role: 'p1' }, { userId: 'sam', role: 'spectator' }, { userId: 'tia', role: 'spectator' }]);
    const own = routePing(room, 'ann', ping());
    expect(own.ok && own.to.sort()).toEqual(['sam', 'tia']);
    const mentor = routePing(room, 'sam', ping({ role: 'self' }));
    expect(mentor.ok && mentor.ping.role).toBe('mentor');
    expect(mentor.ok && mentor.to).toEqual(['ann']);
    expect(routePing(room, 'tia', ping()).ok).toBe(false);
    expect(routePingMentor(room, 'tia', { seat: 'p1', mentor: 'tia' })).toBeNull();
    expect(routePingMentor(room, 'ann', { seat: 'p1', mentor: 'tia' })).toEqual({ seat: 'p1', mentor: 'tia' });
  });

  it('with no mentor named, no watcher may ping', () => {
    expect(routePing(livePingRoom('ann', ['sam'], null), 'sam', ping()).ok).toBe(false);
  });
});

describe('routePingClear: a clear reaches every screen showing the ping (R-PING-05)', () => {
  const t = { t: 'card', uid: '42', zone: 'shop' };
  it('the player clears: the stands hear it, the opponent never does', () => {
    expect(routePingClear(duel, 'ann', { owner: 'p1', target: t })?.to.sort()).toEqual(['sam', 'tia']);
  });
  it('Duos: a teammate clears my ping; the other team is never told', () => {
    const r = routePingClear(duos, 'amy', { owner: 'p1', target: t });
    expect(r?.to).toContain('ann');
    expect(r?.to).not.toContain('bob');
    expect(r?.to).not.toContain('ben');
  });
  it('the mentor may clear; a plain spectator or an opponent may not', () => {
    const room = { ...lobby, mentors: { p1: 'sam' } };
    expect(routePingClear(room, 'sam', { owner: 'p1', target: t })?.to).toContain('ann');
    expect(routePingClear(room, 'tia', { owner: 'p1', target: t })).toBeNull();
    expect(routePingClear(duel, 'bob', { owner: 'p1', target: t })).toBeNull();
    expect(routePingClear(duel, 'ann', { owner: 'p1', target: { t: 'nope' } })).toBeNull();
  });
});
