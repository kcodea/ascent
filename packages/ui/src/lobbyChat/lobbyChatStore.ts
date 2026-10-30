/**
 * LOBBY CHAT, the client (owner idea 2026-10-30: "spectator group chats within a game"; ruling the same day: "spectator
 * group chat can be lobby chat, and should include everyone in the game i think including the player";
 * R-LOBBY-CHAT-01). The wire and the server rules live in `@game/versus-cf/lobbyChat`; this is the client's half:
 *
 *  - THE SESSION SEAM (`setLobbyChatSession`): whichever socket carries the game installs `{ send, me, gameKey }`: the
 *    Versus room (players and the stands), a live lobby / Practice game's publisher (the player) and its watchers. On
 *    install it asks the object for the backlog (`lobby_chat_sync`). The chat only APPEARS once that answer arrives, so
 *    a host that has no chat (a Supabase-listed game, an older Worker) never shows an empty, dead panel.
 *  - RECEIVING (`receiveLobbyChatEvent`): every handler on the game's stream passes events here first, like the pings.
 *  - SENDING (`sendLobbyChat`): shown at once as "Sending", confirmed by the object's echo (same `cid`), or marked with
 *    the refusal (a guest, too fast). A local token bucket mirrors the server's, so a flood is refused before the wire.
 *  - THE READER'S OWN CONTROLS: Mute a sender (this game only, this device), the swear filter (the DM setting), and the
 *    Settings switch that hides lobby chat entirely (`setLobbyChatEnabled`, on by default, saved on this device).
 *
 *  - READ WHEN SEEN (owner 2026-10-30, R-LOBBY-CHAT-02: "lobby chat needs the same quality of life that dm's have", the
 *    DMs' R-DM-READ-01 rule): a message counts as unread unless the panel is open AND the page is visible and focused.
 *    Coming back to the page (visibilitychange / focus), pressing or focusing into the panel, typing or sending clears
 *    the count (`noteLobbyChatSeen`).
 *  - REPLIES (R-LOBBY-CHAT-02): a send may answer a stored message (`replyTo`); the object stamps the quote. Mine shows
 *    the quote while it is sending; the object's echo then decides (an older Worker sends none).
 *  - CATCH-UP (R-LOBBY-CHAT-02): when the game's socket comes back (`resyncLobbyChat`, called on every reconnect), the
 *    sync is asked again with `since` (the newest stored message held here); the answer is merged by id, so what was
 *    sent while the socket was down appears once, in order, and counts as unread when I was not looking.
 *
 * COST: messages are tiny and rare next to the game's own frames; a message re-renders the chat panel only (its own
 * store), never the game. Nothing here runs per frame.
 */
import { create } from 'zustand';
import {
  LOBBY_CHAT_BACKLOG, LOBBY_CHAT_EVENT, LOBBY_CHAT_RATE, LOBBY_CHAT_REFUSED_EVENT, LOBBY_CHAT_SYNC_EVENT, parseLobbyChatMsg, parseLobbyChatSync,
  LOBBY_CHAT_REPLY_SNIPPET, type LobbyChatMsg, type LobbyChatRefusal,
} from '@game/versus-cf/lobbyChat';
import { cleanDmBody } from '@game/versus-cf/hub';
import { pageSeen } from '../chat/pageSeen';

export { LOBBY_CHAT_MAX_CHARS } from '@game/versus-cf/lobbyChat';

export interface ShownChatMsg extends LobbyChatMsg {
  /** Mine and not yet confirmed, or refused. */
  state?: 'sending' | 'failed';
  error?: string;
}

export const LOBBY_CHAT_ERROR_TEXT: Record<LobbyChatRefusal | 'offline', string> = {
  guest: 'Sign in to chat.',
  rate: 'Slow down a little.',
  malformed: 'That message cannot be sent.',
  not_member: 'You are not in this game.',
  offline: 'Not connected. Try again in a moment.',
};
export const LOBBY_CHAT_GUEST_TEXT = 'Sign in to chat.';

const ENABLED_KEY = 'ascent.lobbyChat';
const OPEN_KEY = 'ascent.lobbyChatOpen';
const loadFlag = (key: string, dflt: boolean): boolean => {
  try { const v = localStorage.getItem(key); return v == null ? dflt : v !== 'false'; } catch { return dflt; }
};
const saveFlag = (key: string, on: boolean): void => {
  try { localStorage.setItem(key, String(on)); } catch { /* private mode: this session only */ }
};

/** A phone held sideways: the chat starts collapsed there (it would take a big share of a small screen). */
const smallTouch = (): boolean => {
  try { return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse) and (max-height: 500px)').matches; } catch { return false; }
};

export interface LobbyChatState {
  /** The game this chat is for (null: none). */
  gameKey: string | null;
  /** The object answered the sync: this game has a lobby chat. */
  available: boolean;
  /** I may post (signed in, in the game). */
  canSend: boolean;
  /** Someone else is here to chat with (a lone player with nobody watching sees no panel). */
  company: boolean;
  msgs: ShownChatMsg[];
  /** Messages from others that arrived while I was not looking (the panel collapsed, or the page away). */
  unread: number;
  /** The panel is expanded (kept on this device). */
  open: boolean;
  /** The Settings switch (on by default): off hides lobby chat entirely. */
  enabled: boolean;
  /** Senders I muted in this game. */
  muted: Readonly<Record<string, true>>;
  me: string | null;
}

export const useLobbyChat = create<LobbyChatState>(() => ({
  gameKey: null, available: false, canSend: false, company: true, msgs: [], unread: 0,
  open: loadFlag(OPEN_KEY, !smallTouch()), enabled: loadFlag(ENABLED_KEY, true), muted: {}, me: null,
}));

interface Session {
  owner: string;
  send: (event: string, payload: unknown) => void;
  gameKey: string;
}
let session: Session | null = null;
/** Coming back to the page reads what arrived while I was away (installed while a session is). */
let unSeen: (() => void) | null = null;
function watchSeen(on: boolean): void {
  if (!on) { unSeen?.(); unSeen = null; return; }
  if (unSeen || typeof document === 'undefined' || typeof window === 'undefined') return;
  const onSeen = (): void => noteLobbyChatSeen();
  document.addEventListener('visibilitychange', onSeen);
  window.addEventListener('focus', onSeen);
  unSeen = () => { document.removeEventListener('visibilitychange', onSeen); window.removeEventListener('focus', onSeen); };
}
let seq = 0;
/** The sync is asked again until it is answered (a relay sent while the socket is still opening is dropped). */
let syncTimer: ReturnType<typeof setTimeout> | null = null;
const SYNC_RETRY_MS = 2_000;
const SYNC_TRIES = 15;
let synced = false;
/** The newest message the object stamped that I hold (a catch-up asks only for what came after it). */
function lastStoredId(): string | null {
  const msgs = useLobbyChat.getState().msgs;
  for (let i = msgs.length - 1; i >= 0; i--) if (!msgs[i]!.state && !msgs[i]!.id.startsWith('local:')) return msgs[i]!.id;
  return null;
}
function askSync(s: Session, tries: number): void {
  if (syncTimer != null) clearTimeout(syncTimer);
  syncTimer = null;
  if (session !== s || synced) return;
  const since = useLobbyChat.getState().available ? lastStoredId() : null;
  s.send(LOBBY_CHAT_SYNC_EVENT, since ? { since } : {});
  if (tries > 1) syncTimer = setTimeout(() => askSync(s, tries - 1), SYNC_RETRY_MS);
}
let bucket = { tokens: LOBBY_CHAT_RATE.burst as number, at: 0 };
let clock: () => number = () => Date.now();
/** Tests: a fake clock. */
export function setLobbyChatClockForTests(fn: (() => number) | null): void { clock = fn ?? (() => Date.now()); }

const fresh = (gameKey: string | null, me: string | null): Partial<LobbyChatState> =>
  ({ gameKey, available: false, canSend: false, company: true, msgs: [], unread: 0, muted: {}, me });

/**
 * Install the game's socket (or clear it: `null` with the same owner). The same game re-installed (a Versus channel
 * swap, a reconnect) keeps its messages and re-syncs; a new game starts empty.
 */
export function setLobbyChatSession(owner: string, next: { send: Session['send']; gameKey: string; me: string | null } | null): void {
  if (!next) {
    if (session?.owner !== owner) return;
    session = null;
    watchSeen(false);
    if (syncTimer != null) { clearTimeout(syncTimer); syncTimer = null; }
    useLobbyChat.setState(fresh(null, null));
    return;
  }
  const same = useLobbyChat.getState().gameKey === next.gameKey;
  session = { owner, send: next.send, gameKey: next.gameKey };
  if (!same) { bucket = { tokens: LOBBY_CHAT_RATE.burst, at: 0 }; useLobbyChat.setState(fresh(next.gameKey, next.me?.toLowerCase() ?? null)); }
  else if (next.me) useLobbyChat.setState({ me: next.me.toLowerCase() });
  synced = false;
  watchSeen(true);
  askSync(session, SYNC_TRIES);
}

/**
 * The game's socket came back (every reconnect calls this): catch up on what was sent while it was down. Only once
 * this game's chat is known (`available`); the first connect's own sync is the session install's.
 */
export function resyncLobbyChat(): void {
  if (!session || !useLobbyChat.getState().available) return;
  synced = false;
  askSync(session, SYNC_TRIES);
}

/** Whether anyone else is in the game (the lobby publisher's stands; Versus and watching always have company). */
export function setLobbyChatCompany(on: boolean): void {
  if (useLobbyChat.getState().company !== on) useLobbyChat.setState({ company: on });
}

const isMine = (m: LobbyChatMsg, me: string | null): boolean => !!me && m.from.toLowerCase() === me;

/** I am looking at the chat right now: the panel is open and the page is in front of me. */
const viewing = (s: LobbyChatState): boolean => s.open && s.enabled && pageSeen();

function counts(s: LobbyChatState, m: LobbyChatMsg): boolean {
  return !isMine(m, s.me) && !s.muted[m.from.toLowerCase()] && !viewing(s);
}

/** Something says I am looking at the open panel (the page came back, a press, focus or typing in it): read it. */
export function noteLobbyChatSeen(): void {
  const s = useLobbyChat.getState();
  if (s.unread && viewing(s)) useLobbyChat.setState({ unread: 0 });
}

/** A message that can be answered: a stored one (not one still sending or failed). */
export const canReplyToLobby = (m: ShownChatMsg): boolean => !m.state && !m.id.startsWith('local:');

/** One event off the game's stream: true when it was a lobby chat event (consumed). */
export function receiveLobbyChatEvent(event: string, payload: unknown): boolean {
  if (event === LOBBY_CHAT_EVENT) {
    const m = parseLobbyChatMsg(payload);
    if (!m || !session) return true;
    const s = useLobbyChat.getState();
    if (s.msgs.some((x) => x.id === m.id)) return true;
    const pending = m.cid && isMine(m, s.me) ? s.msgs.findIndex((x) => x.cid === m.cid && x.state) : -1;
    const msgs = s.msgs.slice();
    if (pending >= 0) msgs[pending] = m;
    else msgs.push(m);
    if (msgs.length > LOBBY_CHAT_BACKLOG + 20) msgs.splice(0, msgs.length - LOBBY_CHAT_BACKLOG);
    useLobbyChat.setState({ msgs, unread: s.unread + (pending < 0 && counts(s, m) ? 1 : 0) });
    return true;
  }
  if (event === LOBBY_CHAT_SYNC_EVENT) {
    const sync = parseLobbyChatSync(payload);
    if (!sync || !session) return true; // an older Worker relays another client's request: not an answer
    synced = true;
    const s = useLobbyChat.getState();
    // Merge by id (a full backlog, or a catch-up of what came after `since`): what I hold stays, what is new joins it in
    // the object's order, and a send of mine whose echo was lost while I was away is confirmed by its stored copy.
    const had = new Set(s.msgs.map((m) => m.id));
    const stored = s.msgs.filter((m) => !m.state && !m.id.startsWith('local:'));
    const incoming = sync.msgs.filter((m) => !had.has(m.id));
    const confirmed = new Set(incoming.filter((m) => m.cid && isMine(m, s.me)).map((m) => m.cid!));
    const pending = s.msgs.filter((m) => (m.state || m.id.startsWith('local:')) && !(m.cid && confirmed.has(m.cid)));
    const merged = [...stored, ...incoming].sort((x, y) => x.at - y.at);
    const msgs = [...merged, ...pending];
    if (msgs.length > LOBBY_CHAT_BACKLOG + 20) msgs.splice(0, msgs.length - LOBBY_CHAT_BACKLOG);
    const fresh_ = incoming.filter((m) => counts(s, m)).length;
    useLobbyChat.setState({ available: true, canSend: sync.canSend, msgs, unread: s.available ? s.unread + fresh_ : 0 });
    return true;
  }
  if (event === LOBBY_CHAT_REFUSED_EVENT) {
    const p = payload as { cid?: unknown; reason?: unknown } | null;
    const reason = (typeof p?.reason === 'string' && p.reason in LOBBY_CHAT_ERROR_TEXT ? p.reason : 'malformed') as LobbyChatRefusal;
    const s = useLobbyChat.getState();
    if (reason === 'guest' && s.canSend) useLobbyChat.setState({ canSend: false });
    if (typeof p?.cid !== 'string') return true;
    useLobbyChat.setState({ msgs: useLobbyChat.getState().msgs.map((m) => (m.cid === p.cid && m.state ? { ...m, state: 'failed', error: LOBBY_CHAT_ERROR_TEXT[reason] } : m)) });
    return true;
  }
  return false;
}

/**
 * Send `raw` (`replyTo`: the stored message it answers): null when it went (or there was nothing to send), else the
 * reason to show under the composer. Sending says I am looking (it reads the panel).
 */
export function sendLobbyChat(raw: string, replyTo: ShownChatMsg | null = null): string | null {
  const body = cleanDmBody(raw);
  if (body == null) return raw.trim() ? LOBBY_CHAT_ERROR_TEXT.malformed : null;
  const s = useLobbyChat.getState();
  if (!session || !s.available) return LOBBY_CHAT_ERROR_TEXT.offline;
  if (!s.canSend) return LOBBY_CHAT_GUEST_TEXT;
  const now = clock();
  bucket.tokens = Math.min(LOBBY_CHAT_RATE.burst, bucket.tokens + (bucket.at ? Math.max(0, now - bucket.at) / 1000 : 0) * LOBBY_CHAT_RATE.per);
  bucket.at = now;
  if (bucket.tokens < 1) return LOBBY_CHAT_ERROR_TEXT.rate;
  bucket.tokens -= 1;
  seq += 1;
  const cid = `lc${seq.toString(36)}${Math.floor(now % 1e6).toString(36)}`;
  const answers = replyTo && canReplyToLobby(replyTo) ? replyTo : null;
  const local: ShownChatMsg = { id: `local:${cid}`, cid, from: s.me ?? 'me', name: 'You', role: 'spectator', body, at: now, state: 'sending' };
  if (answers) local.reply = { id: answers.id, from: answers.from, name: answers.name, body: [...answers.body].slice(0, LOBBY_CHAT_REPLY_SNIPPET).join('') };
  useLobbyChat.setState({ msgs: [...s.msgs, local], ...(viewing(s) ? { unread: 0 } : {}) });
  // `replyTo` only when set: an older Worker never sees the field.
  session.send(LOBBY_CHAT_EVENT, answers ? { cid, body, replyTo: answers.id } : { cid, body });
  return null;
}

/** Retry a refused message (it goes out again as a new send). */
export function retryLobbyChat(cid: string): void {
  const m = useLobbyChat.getState().msgs.find((x) => x.cid === cid && x.state === 'failed');
  if (!m) return;
  useLobbyChat.setState({ msgs: useLobbyChat.getState().msgs.filter((x) => x !== m) });
  const orig = m.reply ? useLobbyChat.getState().msgs.find((x) => x.id === m.reply!.id) ?? null : null;
  sendLobbyChat(m.body, orig);
}

export function setLobbyChatOpen(open: boolean): void {
  saveFlag(OPEN_KEY, open);
  useLobbyChat.setState(open ? { open, unread: 0 } : { open });
}

/** The Settings switch: off hides lobby chat entirely (saved on this device). */
export function setLobbyChatEnabled(on: boolean): void {
  saveFlag(ENABLED_KEY, on);
  useLobbyChat.setState(on ? { enabled: on, unread: 0 } : { enabled: on });
}

/** Mute (or unmute) a sender in this game: their messages are hidden on my screen only. */
export function setLobbyChatMuted(userId: string, muted: boolean): void {
  const k = userId.toLowerCase();
  const next = { ...useLobbyChat.getState().muted };
  if (muted) next[k] = true;
  else delete next[k];
  useLobbyChat.setState({ muted: next });
}
