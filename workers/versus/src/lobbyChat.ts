/**
 * LOBBY CHAT: one group chat per game, for everyone in it (owner idea 2026-10-30: "spectator group chats within a game";
 * owner ruling the same day: "spectator group chat can be lobby chat, and should include everyone in the game i think
 * including the player"). A Versus room's chat is every seated player and the stands; a live lobby / Practice game's is
 * its one player and the stands. R-LOBBY-CHAT-01.
 *
 * It rides the game's EXISTING socket (the Versus room object, the live game object) as `bc` relays the object
 * intercepts, like the pings (`pings.ts`). No new service, nothing in Supabase. The wire:
 *
 *   client -> object  `lobby_chat`        { cid, body, replyTo? } post a message (cid: the sender's own id for it; replyTo:
 *                                                                the id of the message it answers)
 *   object -> all     `lobby_chat`        LobbyChatMsg           stamped: id, from, name, role, at (the sender too: its cid
 *                                                                confirms the send), and `reply` (the quote) for an answer
 *   client -> object  `lobby_chat_sync`   { since? }             "I just arrived" (or "I am back"): the backlog, please
 *   object -> me      `lobby_chat_sync`   LobbyChatSync          the last `LOBBY_CHAT_BACKLOG` messages (only those after
 *                                                                `since` when it is still in the backlog) and whether I may post
 *   object -> sender  `lobby_chat_refused` { cid, reason }       a guest, too fast, or malformed
 *
 * REPLIES (owner 2026-10-30, R-LOBBY-CHAT-02: "lobby chat needs the same quality of life that dm's have"): a post may name
 * the message it answers (`replyTo`). The object looks it up in its own backlog and stamps the quote (`reply`: who wrote
 * it, their name and the start of it), so a quote is always the object's, never the payload's. An original that has left
 * the backlog leaves the answer without a quote. Like the rest, replies live only as long as the game.
 *
 * CATCH-UP (R-LOBBY-CHAT-02): a client whose socket came back asks the sync again with `since` (the newest message it
 * holds); the answer carries only what came after it (the whole backlog when `since` is gone), and the client merges by
 * id, so nothing sent while it was away is missed and nothing shows twice.
 *
 * COMPATIBILITY: an older client ignores the unknown events and the new fields (`reply`, `since`). An older Worker
 * ignores `replyTo` (the answer arrives without a quote) and `since` (the whole backlog, merged by id).
 * A newer client only opens the chat once a real
 * `lobby_chat_sync` answer arrives (it carries `msgs`), so on an older Worker (which would relay the request instead of
 * answering it) the chat simply never appears.
 *
 * Rules (`LobbyChat`, pure, on a clock passed in): only a member of the game may post (a seat or the stands), never a
 * guest; at most `LOBBY_CHAT_RATE` per sender (a token bucket: 1 a second, bursts of 5); a body is cleaned exactly as a
 * direct message is (`cleanDmBody`: control characters out, spaces collapsed, at most `DM_MAX_CHARS`). The name and role
 * are the server's, never the payload's. Muting is the reader's own (the client hides a muted sender).
 *
 * The backlog lives in the object's memory, mirrored to its own storage (a hibernation wake keeps it; the object's
 * storage goes with the game), never in Postgres.
 *
 * Dependency-free apart from the DM body rule (the UI imports it as `@game/versus-cf/lobbyChat`).
 */
import { cleanDmBody, DM_MAX_CHARS, DM_REPLY_SNIPPET } from './hubProtocol';

export const LOBBY_CHAT_EVENT = 'lobby_chat';
export const LOBBY_CHAT_SYNC_EVENT = 'lobby_chat_sync';
export const LOBBY_CHAT_REFUSED_EVENT = 'lobby_chat_refused';
/** How many messages a late joiner is sent (and the most the object keeps). */
export const LOBBY_CHAT_BACKLOG = 100;
export const LOBBY_CHAT_MAX_CHARS = DM_MAX_CHARS;
/** The longest quoted snippet a reply carries, in characters (the direct messages' own). */
export const LOBBY_CHAT_REPLY_SNIPPET = DM_REPLY_SNIPPET;
/** Per sender: `per` messages a second sustained, bursts of `burst`. */
export const LOBBY_CHAT_RATE = { per: 1, burst: 5 } as const;
/** The object's storage key for the backlog. */
export const LOBBY_CHAT_STORAGE_KEY = 'lobbyChat';
/** The Worker stamps whether the caller is a guest (always set, so a client cannot forge it). */
export const GUEST_HEADER = 'X-Versus-Guest';

export type LobbyChatRole = 'player' | 'spectator';

/** The quote a reply shows: the message it answers, who wrote it and the start of it. */
export interface LobbyChatReply {
  id: string;
  from: string;
  name: string;
  body: string;
}

export interface LobbyChatMsg {
  id: string;
  from: string;
  name: string;
  role: LobbyChatRole;
  body: string;
  /** Epoch ms, on the object's clock. */
  at: number;
  /** The sender's own id for it (only meaningful to the sender). */
  cid?: string;
  /** The message this one answers (stamped by the object from its backlog). */
  reply?: LobbyChatReply;
}

export interface LobbyChatSync {
  msgs: LobbyChatMsg[];
  canSend: boolean;
  /** Set when `msgs` is only what came after this id (a catch-up), not the whole backlog. */
  since?: string;
}

export type LobbyChatRefusal = 'guest' | 'rate' | 'malformed' | 'not_member';

export interface LobbyChatSender {
  userId: string;
  /** Null when this account is not in the game (not seated, not in the stands). */
  role: LobbyChatRole | null;
  name: string;
  guest: boolean;
}

const CID = /^[A-Za-z0-9_:.-]{1,64}$/;
const clampName = (v: string): string => (v.trim() || 'Player').slice(0, 24);

/** Whether this sender may post at all (the composer's state). Pure. */
export const lobbyChatCanSend = (s: Pick<LobbyChatSender, 'role' | 'guest'>): boolean => !!s.role && !s.guest;

const snippet = (body: string): string => [...body].slice(0, LOBBY_CHAT_REPLY_SNIPPET).join('');

/** A reply's quote as a receiver accepts it, or null. Pure. */
export function parseLobbyChatReply(raw: unknown): LobbyChatReply | null {
  const r = raw as Partial<LobbyChatReply> | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !CID.test(r.id) || typeof r.from !== 'string' || !r.from) return null;
  const body = cleanDmBody(r.body);
  if (!body) return null;
  return { id: r.id, from: r.from, name: clampName(String(r.name ?? '')), body: snippet(body) };
}

/** A stamped message as a receiver accepts it, or null. Pure (the client runs it on every arrival). */
export function parseLobbyChatMsg(raw: unknown): LobbyChatMsg | null {
  const m = raw as Partial<LobbyChatMsg> | null;
  if (!m || typeof m !== 'object') return null;
  if (typeof m.id !== 'string' || !CID.test(m.id) || typeof m.from !== 'string' || !m.from) return null;
  if (m.role !== 'player' && m.role !== 'spectator') return null;
  if (typeof m.at !== 'number' || !Number.isFinite(m.at)) return null;
  const body = cleanDmBody(m.body);
  if (!body) return null;
  const out: LobbyChatMsg = { id: m.id, from: m.from, name: clampName(String(m.name ?? '')), role: m.role, body, at: m.at };
  if (typeof m.cid === 'string' && CID.test(m.cid)) out.cid = m.cid;
  const reply = m.reply == null ? null : parseLobbyChatReply(m.reply);
  if (reply) out.reply = reply;
  return out;
}

/** A sync answer, or null (an older Worker's relayed request has no `msgs`). Pure. */
export function parseLobbyChatSync(raw: unknown): LobbyChatSync | null {
  const p = raw as Partial<LobbyChatSync> | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.msgs)) return null;
  const msgs = p.msgs.slice(-LOBBY_CHAT_BACKLOG).map(parseLobbyChatMsg).filter((m): m is LobbyChatMsg => !!m);
  const out: LobbyChatSync = { msgs, canSend: p.canSend === true };
  if (typeof p.since === 'string' && CID.test(p.since)) out.since = p.since;
  return out;
}

/** One game's chat: the backlog and the per-sender limit. */
export class LobbyChat {
  private msgs: LobbyChatMsg[] = [];
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private seq = 0;

  /** Restore a stored backlog (a wake). */
  load(raw: unknown): void {
    this.msgs = Array.isArray(raw) ? raw.map(parseLobbyChatMsg).filter((m): m is LobbyChatMsg => !!m).slice(-LOBBY_CHAT_BACKLOG) : [];
    this.seq = this.msgs.length;
  }

  /** The backlog as stored and sent (oldest first). A copy. */
  backlog(): LobbyChatMsg[] {
    return this.msgs.slice();
  }

  /**
   * The answer to a sync: the backlog, or (a catch-up, `payload.since` naming a message still in it) only what came
   * after that message.
   */
  sync(sender: Pick<LobbyChatSender, 'role' | 'guest'>, payload?: unknown): LobbyChatSync {
    const since = (payload as { since?: unknown } | null | undefined)?.since;
    const at = typeof since === 'string' ? this.msgs.findIndex((m) => m.id === since) : -1;
    if (at >= 0) return { msgs: this.msgs.slice(at + 1), canSend: lobbyChatCanSend(sender), since: since as string };
    return { msgs: this.backlog(), canSend: lobbyChatCanSend(sender) };
  }

  /** Take one send from `key`'s bucket at `now`. */
  private allow(key: string, now: number): boolean {
    const b = this.buckets.get(key) ?? { tokens: LOBBY_CHAT_RATE.burst, at: now };
    b.tokens = Math.min(LOBBY_CHAT_RATE.burst, b.tokens + (Math.max(0, now - b.at) / 1000) * LOBBY_CHAT_RATE.per);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    if (this.buckets.size > 256) for (const [k, v] of this.buckets) if (v.tokens >= LOBBY_CHAT_RATE.burst - 1 && now - v.at > 10_000) this.buckets.delete(k);
    return true;
  }

  /** Post one message: the stamped message to fan out to everyone (the sender too), or why it was dropped. */
  post(sender: LobbyChatSender, payload: unknown, now: number): { ok: true; msg: LobbyChatMsg } | { ok: false; reason: LobbyChatRefusal; cid?: string } {
    const p = payload as { cid?: unknown; body?: unknown; replyTo?: unknown } | null;
    const cid = p && typeof p.cid === 'string' && CID.test(p.cid) ? p.cid : undefined;
    if (sender.guest) return { ok: false, reason: 'guest', cid };
    if (!sender.role) return { ok: false, reason: 'not_member', cid };
    const body = cleanDmBody(p?.body);
    if (!body) return { ok: false, reason: 'malformed', cid };
    if (!this.allow(sender.userId, now)) return { ok: false, reason: 'rate', cid };
    this.seq += 1;
    const msg: LobbyChatMsg = { id: `${now.toString(36)}-${this.seq.toString(36)}`, from: sender.userId, name: clampName(sender.name), role: sender.role, body, at: now };
    if (cid) msg.cid = cid;
    // A reply: the quote is the object's own copy of the original (never the payload's), while it is still kept.
    const orig = typeof p?.replyTo === 'string' ? this.msgs.find((m) => m.id === p.replyTo) : undefined;
    if (orig) msg.reply = { id: orig.id, from: orig.from, name: orig.name, body: snippet(orig.body) };
    this.msgs.push(msg);
    if (this.msgs.length > LOBBY_CHAT_BACKLOG) this.msgs.splice(0, this.msgs.length - LOBBY_CHAT_BACKLOG);
    return { ok: true, msg };
  }
}
