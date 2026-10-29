/**
 * THE FRIENDS HUB's rules in plain Node (R-DM-01, R-DM-02): the per-account rate limit (5 messages / 10 s), what a send
 * must carry, the body cleaning the client and hub share (500 characters), the presence bound, and the memory backend's
 * friends-only + block rules (the same rules the SQL enforces; `dm.db.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { checkSend, DmError, DmRateLimiter, dmErrorOf, MemoryDmBackend } from '../src/core/hubCore';
import { cleanDmBody, cleanPresence, DM_MAX_CHARS, DM_RATE, HUB_PRESENCE_MAX_CHARS } from '../src/hubProtocol';

const ANN = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-000000000002';
const CAT = '00000000-0000-4000-8000-000000000003';
const CID = '11111111-1111-4111-8111-111111111111';

const code = (f: () => unknown): string => {
  try { f(); } catch (e) { return (e as DmError).code; }
  return 'ok';
};

describe('rate limit (R-DM-01)', () => {
  it('allows 5 messages per 10 s, sliding', () => {
    const r = new DmRateLimiter();
    expect(DM_RATE).toEqual({ count: 5, windowMs: 10_000 });
    for (let i = 0; i < 5; i++) expect(r.take(1000 + i)).toBe(true);
    expect(r.take(2000)).toBe(false);
    expect(r.take(10_999)).toBe(false); // the first slot (t=1000) is still inside the window
    expect(r.take(11_000)).toBe(true); // ...and now it aged out
    expect(r.take(11_000)).toBe(false);
  });
});

describe('send arguments (R-DM-01)', () => {
  it('needs a client id, a friend that is not me, and a clean body', () => {
    expect(checkSend(ANN, { cid: CID, to: BOB, body: '  hi\n there  ' })).toEqual({ cid: CID, to: BOB, body: 'hi there' });
    expect(code(() => checkSend(ANN, { cid: 'nope', to: BOB, body: 'hi' }))).toBe('bad_body');
    expect(code(() => checkSend(ANN, { cid: CID, to: ANN, body: 'hi' }))).toBe('bad_target');
    expect(code(() => checkSend(ANN, { cid: CID, to: 'x', body: 'hi' }))).toBe('bad_target');
    expect(code(() => checkSend(ANN, { cid: CID, to: BOB, body: '   ' }))).toBe('bad_body');
    expect(code(() => checkSend(ANN, { cid: CID, to: BOB, body: 'x'.repeat(DM_MAX_CHARS + 1) }))).toBe('bad_body');
  });

  it('cleans control and invisible characters, and counts characters not bytes', () => {
    expect(cleanDmBody('a\u0000b\tc')).toBe('a b c');
    expect(cleanDmBody(`x${String.fromCharCode(0x202e)}y`)).toBe('x y');
    expect(cleanDmBody('🙂'.repeat(DM_MAX_CHARS))).toHaveLength(DM_MAX_CHARS * 2);
    expect(cleanDmBody(42)).toBeNull();
  });

  it('maps store errors to refusals, anything else to unavailable', () => {
    expect(dmErrorOf('{"message":"not_friends"}')).toBe('not_friends');
    expect(dmErrorOf('{"message":"blocked"}')).toBe('blocked');
    expect(dmErrorOf('upstream timeout')).toBe('unavailable');
  });
});

describe('presence (R-DM-01)', () => {
  it('keeps known fields and bounds the size', () => {
    expect(cleanPresence({ status: 'offline' })).toBeNull();
    expect(cleanPresence({ status: 'online', mode: null, extra: 1 })).toEqual({ status: 'online', mode: null, watchKind: null, watchId: null });
    const big = cleanPresence({ status: 'in_game', mode: 'ranked', game: { pad: 'x'.repeat(HUB_PRESENCE_MAX_CHARS) } });
    expect(big).toEqual({ status: 'in_game', mode: 'ranked', watchKind: null, watchId: null });
  });
});

describe('memory backend: friends only, blocks (R-DM-02)', () => {
  it('stores between friends once per client id, refuses others', async () => {
    const b = new MemoryDmBackend(() => 0);
    b.befriend(ANN, BOB);
    const row = await b.send(ANN, { cid: CID, to: BOB, body: 'hi' });
    expect(await b.send(ANN, { cid: CID, to: BOB, body: 'hi' })).toBe(row);
    await expect(b.send(ANN, { cid: CID.replace('1111-4', '2222-4'), to: CAT, body: 'hi' })).rejects.toMatchObject({ code: 'not_friends' });
    b.block(BOB, ANN);
    await expect(b.send(ANN, { cid: CID.replace('1111-4', '3333-4'), to: BOB, body: 'hi' })).rejects.toMatchObject({ code: 'blocked' });
    expect(await b.friendsOf(ANN)).toEqual([]);
  });
});
