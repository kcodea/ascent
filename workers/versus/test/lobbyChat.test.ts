/**
 * LOBBY CHAT (R-LOBBY-CHAT-01): the rules on a fake clock (root vitest, no workerd). The fan-out over real sockets, the
 * player included, is `test/it/live.it.ts` ("LOBBY CHAT end to end in workerd").
 */
import { describe, expect, it } from 'vitest';
import {
  LOBBY_CHAT_BACKLOG, LOBBY_CHAT_MAX_CHARS, LOBBY_CHAT_RATE, LOBBY_CHAT_REPLY_SNIPPET, LobbyChat, lobbyChatCanSend, parseLobbyChatMsg, parseLobbyChatSync, type LobbyChatSender,
} from '../src/lobbyChat';

const T0 = Date.UTC(2026, 9, 30, 12, 0, 0);
const player: LobbyChatSender = { userId: 'p', role: 'player', name: 'Ann', guest: false };
const fan: LobbyChatSender = { userId: 's', role: 'spectator', name: 'Bo', guest: false };

describe('lobby chat (R-LOBBY-CHAT-01)', () => {
  it('the player and the stands both post; the name and role are the server\'s, the body is cleaned', () => {
    const c = new LobbyChat();
    const a = c.post(player, { cid: 'c1', body: '  hi \n  all ', name: 'Forged', role: 'spectator' }, T0);
    expect(a).toMatchObject({ ok: true, msg: { from: 'p', name: 'Ann', role: 'player', body: 'hi all', cid: 'c1', at: T0 } });
    expect(c.post(fan, { body: 'gl' }, T0)).toMatchObject({ ok: true, msg: { from: 's', role: 'spectator' } });
  });

  it('a guest or an outsider never posts; a guest still reads the backlog', () => {
    const c = new LobbyChat();
    c.post(player, { body: 'hello' }, T0);
    expect(c.post({ ...fan, guest: true }, { cid: 'g', body: 'x' }, T0)).toEqual({ ok: false, reason: 'guest', cid: 'g' });
    expect(c.post({ ...fan, role: null }, { body: 'x' }, T0)).toMatchObject({ ok: false, reason: 'not_member' });
    expect(c.sync({ role: 'spectator', guest: true })).toMatchObject({ canSend: false, msgs: [{ body: 'hello' }] });
    expect(lobbyChatCanSend(fan)).toBe(true);
  });

  it('empty or over-long bodies are refused', () => {
    const c = new LobbyChat();
    expect(c.post(fan, { body: '   ' }, T0)).toMatchObject({ ok: false, reason: 'malformed' });
    expect(c.post(fan, { body: 'a'.repeat(LOBBY_CHAT_MAX_CHARS + 1) }, T0)).toMatchObject({ ok: false, reason: 'malformed' });
    expect(c.post(fan, { body: 'a'.repeat(LOBBY_CHAT_MAX_CHARS) }, T0).ok).toBe(true);
  });

  it('rate limit: a burst of 5, then 1 a second, per sender (another sender is unaffected)', () => {
    const c = new LobbyChat();
    for (let i = 0; i < LOBBY_CHAT_RATE.burst; i++) expect(c.post(fan, { body: `m${i}` }, T0).ok).toBe(true);
    expect(c.post(fan, { body: 'too fast' }, T0 + 100)).toMatchObject({ ok: false, reason: 'rate' });
    expect(c.post(player, { body: 'mine' }, T0 + 100).ok).toBe(true);
    expect(c.post(fan, { body: 'later' }, T0 + 1100).ok).toBe(true);
    expect(c.post(fan, { body: 'again' }, T0 + 1200).ok).toBe(false);
  });

  it('a late joiner gets the last 100, oldest first; a wake restores them', () => {
    const c = new LobbyChat();
    for (let i = 0; i < LOBBY_CHAT_BACKLOG + 20; i++) c.post({ ...fan, userId: `u${i}` }, { body: `n${i}` }, T0 + i);
    const b = c.backlog();
    expect(b).toHaveLength(LOBBY_CHAT_BACKLOG);
    expect(b[0]!.body).toBe('n20');
    expect(b[b.length - 1]!.body).toBe(`n${LOBBY_CHAT_BACKLOG + 19}`);
    const woke = new LobbyChat();
    woke.load(JSON.parse(JSON.stringify(b)));
    expect(woke.backlog()).toEqual(b);
    // New ids after a wake never collide with the restored ones.
    const next = woke.post(player, { body: 'after' }, T0 + 500);
    expect(next.ok && b.every((m) => m.id !== next.msg.id)).toBe(true);
  });

  it('receivers: a stamped message parses; an older Worker\'s relayed request (no msgs, no stamps) does not', () => {
    const c = new LobbyChat();
    const r = c.post(player, { cid: 'c', body: 'yo' }, T0);
    expect(r.ok && parseLobbyChatMsg(JSON.parse(JSON.stringify(r.msg)))).toMatchObject({ body: 'yo' });
    expect(parseLobbyChatMsg({ cid: 'c', body: 'raw relay' })).toBeNull();
    expect(parseLobbyChatSync({})).toBeNull();
    expect(parseLobbyChatSync(c.sync(fan))).toMatchObject({ canSend: true, msgs: [{ body: 'yo' }] });
  });
});

describe('lobby chat replies and catch-up (R-LOBBY-CHAT-02)', () => {
  it("a reply carries the object's own quote of the original (never the payload's); a gone original leaves none", () => {
    const c = new LobbyChat();
    const orig = c.post(player, { body: `nice roll ${'x'.repeat(300)}` }, T0);
    if (!orig.ok) throw new Error('post');
    const r = c.post(fan, { body: 'agreed', replyTo: orig.msg.id, reply: { id: 'forged', from: 'z', name: 'Z', body: 'forged' } }, T0 + 10);
    expect(r).toMatchObject({ ok: true, msg: { body: 'agreed', reply: { id: orig.msg.id, from: 'p', name: 'Ann' } } });
    expect(r.ok && [...r.msg.reply!.body].length).toBe(LOBBY_CHAT_REPLY_SNIPPET);
    expect(r.ok && r.msg.reply!.body.startsWith('nice roll')).toBe(true);
    // An id the backlog does not hold: the message goes, without a quote.
    const lost = c.post(fan, { body: 'what?', replyTo: 'gone-1' }, T0 + 20);
    expect(lost.ok && 'reply' in lost.msg).toBe(false);
    // Receivers keep a well-formed quote and drop a broken one.
    expect(r.ok && parseLobbyChatMsg(JSON.parse(JSON.stringify(r.msg)))?.reply).toMatchObject({ id: orig.msg.id, name: 'Ann' });
    expect(r.ok && parseLobbyChatMsg({ ...r.msg, reply: { id: 'x' } })).toMatchObject({ body: 'agreed' });
    expect(r.ok && 'reply' in parseLobbyChatMsg({ ...r.msg, reply: { id: 'x' } })!).toBe(false);
  });

  it('a sync with `since` answers only what came after it; an unknown `since` gets the whole backlog', () => {
    const c = new LobbyChat();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) { const r = c.post({ ...fan, userId: `u${i}` }, { body: `n${i}` }, T0 + i); if (r.ok) ids.push(r.msg.id); }
    const part = c.sync(fan, { since: ids[1] });
    expect(part.since).toBe(ids[1]);
    expect(part.msgs.map((m) => m.body)).toEqual(['n2', 'n3']);
    expect(parseLobbyChatSync(JSON.parse(JSON.stringify(part)))).toMatchObject({ since: ids[1], msgs: [{ body: 'n2' }, { body: 'n3' }] });
    expect(c.sync(fan, { since: ids[3] }).msgs).toEqual([]);
    const all = c.sync(fan, { since: 'long-gone' });
    expect(all.since).toBeUndefined();
    expect(all.msgs).toHaveLength(4);
    expect(c.sync(fan, {}).msgs).toHaveLength(4);
  });
});
