/**
 * THE PRESENCE MIRROR (R-FRIENDS-HUB-LIVE-01): the hub is the live source of presence and keeps `player_presence`
 * current for the server-side invite check (`friends__online`, a 300 s window) and older clients. A change goes at
 * once (never more often than every 5 s), a keep-alive every 2.5 minutes while connected, Offline once at the last close,
 * failures retry with backoff, and a woken hub never writes early.
 */
import { describe, expect, it } from 'vitest';
import { PresenceMirror } from '../src/core/presenceMirror';
import { HUB_PRESENCE_MIN_GAP_MS, HUB_PRESENCE_REFRESH_MS, HUB_PROTOCOL, HUB_PROTOCOL_MIN, isNudgeKind, type HubPresence } from '../src/hubProtocol';
import { MemoryDmBackend } from '../src/core/hubCore';

const ON: HubPresence = { status: 'online', mode: null, watchKind: null, watchId: null };
const GAME: HubPresence = { status: 'in_game', mode: 'ranked', watchKind: 'live', watchId: 'g1' };
/** The server's window: a row older than this reads Offline (friends__stale). */
const WINDOW_MS = 300_000;
/** The hub's sweep alarm fires every minute, so a due write can land up to a minute late. */
const SWEEP_MS = 60_000;

const run = () => {
  const writes: { at: number; p: HubPresence | null }[] = [];
  let now = 0;
  const m = new PresenceMirror();
  const flush = async (connected = true) => m.flush(now, async (p) => { writes.push({ at: now, p }); }, connected);
  return { m, writes, flush, at: (t: number) => { now = t; } };
};

describe('the presence mirror', () => {
  it('a change goes at once; a burst inside the gap is one more write, of the newest', async () => {
    const r = run();
    r.m.want(ON);
    expect(await r.flush()).toBe(true);
    r.at(1_000); r.m.want(GAME);
    expect(await r.flush()).toBe(false);
    expect(r.m.nextAt(1_000, true)).toBe(HUB_PRESENCE_MIN_GAP_MS);
    r.at(2_000); r.m.want({ ...GAME, watchId: 'g2' });
    r.at(HUB_PRESENCE_MIN_GAP_MS); expect(await r.flush()).toBe(true);
    expect(r.writes.map((w) => (w.p as HubPresence).watchId ?? null)).toEqual([null, 'g2']);
  });

  it('keeps the row inside the 300 s window while connected, even when the alarm fires a minute late', async () => {
    expect(HUB_PRESENCE_REFRESH_MS + SWEEP_MS).toBeLessThan(WINDOW_MS);
    const r = run();
    r.m.want(ON);
    await r.flush();
    r.at(HUB_PRESENCE_REFRESH_MS - 1); expect(await r.flush()).toBe(false);
    r.at(HUB_PRESENCE_REFRESH_MS); expect(await r.flush()).toBe(true);
    // Not connected: no keep-alive.
    r.at(3 * HUB_PRESENCE_REFRESH_MS); expect(await r.flush(false)).toBe(false);
    expect(r.m.nextAt(3 * HUB_PRESENCE_REFRESH_MS, false)).toBeNull();
  });

  it('the last game closing writes Offline once, and nothing after', async () => {
    const r = run();
    r.m.want(ON); await r.flush();
    r.at(10_000); r.m.want(null);
    expect(await r.flush(false)).toBe(true);
    r.at(10 * HUB_PRESENCE_REFRESH_MS); expect(await r.flush(false)).toBe(false);
    expect(r.writes.map((w) => w.p)).toEqual([ON, null]);
    expect(r.m.sentOffline).toBe(true);
  });

  it('a failed write retries with backoff, and sends the newest presence', async () => {
    const m = new PresenceMirror();
    m.want(ON);
    expect(await m.flush(0, async () => { throw new Error('down'); }, true)).toBe(false);
    expect(m.nextAt(0, true)).toBe(1_000);
    m.want(GAME);
    const got: (HubPresence | null)[] = [];
    expect(await m.flush(999, async (p) => { got.push(p); }, true)).toBe(false);
    expect(await m.flush(1_000, async (p) => { got.push(p); }, true)).toBe(true);
    expect(got).toEqual([GAME]);
  });

  it('a woken hub restores what it last wrote, so it never writes early', async () => {
    const a = run();
    a.m.want(ON); await a.flush();
    const b = new PresenceMirror();
    b.restore(a.m.snapshot());
    expect(b.idle).toBe(true);
    b.want(ON);
    expect(b.due(60_000, true)).toBe(false);
    expect(b.due(HUB_PRESENCE_REFRESH_MS, true)).toBe(true);
  });

  it('the memory backend records what was mirrored (the dev hub and the tests)', async () => {
    const be = new MemoryDmBackend();
    await be.mirrorPresence('u', ON);
    await be.mirrorPresence('u', null);
    expect(be.mirrored).toEqual([{ user: 'u', presence: ON }, { user: 'u', presence: null }]);
  });
});

describe('hub protocol 3 (nudges)', () => {
  it('adds the nudge and the inbox push without dropping any older client', () => {
    expect(HUB_PROTOCOL).toBe(3);
    expect(HUB_PROTOCOL_MIN).toBe(1);
    expect(isNudgeKind('friends')).toBe(true);
    expect(isNudgeKind('invite')).toBe(true);
    expect(isNudgeKind('dm')).toBe(false);
  });
});
