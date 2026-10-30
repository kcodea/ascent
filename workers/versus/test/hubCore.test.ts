/**
 * THE FRIENDS HUB's rules in plain Node (R-DM-01, R-DM-02): the per-account rate limit (5 messages / 10 s), what a send
 * must carry, the body cleaning the client and hub share (500 characters), the presence bound, and the memory backend's
 * friends-only + block rules (the same rules the SQL enforces; `dm.db.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { checkSend, DmError, DmRateLimiter, dmErrorOf, MemoryDmBackend } from '../src/core/hubCore';
import { cleanDmBody, cleanPresence, cleanReplyPreview, DM_MAX_CHARS, DM_RATE, DM_REPLY_SNIPPET, HUB_PRESENCE_MAX_CHARS, HUB_PROTOCOL, HUB_PROTOCOL_MIN } from '../src/hubProtocol';

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
    expect(checkSend(ANN, { cid: CID, to: BOB, body: '  hi\n there  ' })).toEqual({ cid: CID, to: BOB, body: 'hi there', replyTo: null });
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

describe('replies (protocol 2, R-DM-REPLY-01)', () => {
  it('a send may name the message it answers; anything that is not a message id is dropped, never refused', () => {
    const ORIG = '22222222-2222-4222-8222-222222222222';
    expect(checkSend(ANN, { cid: CID, to: BOB, body: 'yes', replyTo: ORIG.toUpperCase() }).replyTo).toBe(ORIG);
    expect(checkSend(ANN, { cid: CID, to: BOB, body: 'yes', replyTo: 'nope' }).replyTo).toBeNull();
    expect(checkSend(ANN, { cid: CID, to: BOB, body: 'yes' }).replyTo).toBeNull();
    expect(HUB_PROTOCOL).toBe(2);
    expect(HUB_PROTOCOL_MIN).toBe(1); // old clients keep working: they never send it and ignore it on rows
  });

  it('the memory backend keeps a reply to this conversation with a short quote, and drops one to another', async () => {
    const b = new MemoryDmBackend(() => 0);
    b.befriend(ANN, BOB);
    b.befriend(ANN, CAT);
    const cid = (n: number): string => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
    const q = await b.send(BOB, { cid: cid(1), to: ANN, body: 'should we add minions to duos? '.repeat(10) });
    const other = await b.send(CAT, { cid: cid(2), to: ANN, body: 'hello' });
    const r = await b.send(ANN, { cid: cid(3), to: BOB, body: 'yes', replyTo: q.id });
    expect(r.replyTo).toBe(q.id);
    expect(r.reply).toMatchObject({ id: q.id, from: BOB });
    expect([...r.reply!.body]).toHaveLength(DM_REPLY_SNIPPET);
    const stray = await b.send(ANN, { cid: cid(4), to: BOB, body: 'no', replyTo: other.id });
    expect(stray).toMatchObject({ replyTo: null, reply: null, body: 'no' });
  });

  it('the quote on a stored row is read safely', () => {
    expect(cleanReplyPreview({ id: 'x', from: 'ABC', body: 'hi' })).toEqual({ id: 'x', from: 'abc', body: 'hi' });
    expect(cleanReplyPreview(null)).toBeNull();
    expect(cleanReplyPreview({ id: 1 })).toBeNull();
  });
});
