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
 *  - TEAM CHAT (owner 2026-11-01: "in versus team modes, there should be a tab in lobby that has a team chat too";
 *    R-LOBBY-CHAT-TEAM-01): a second channel on the same socket. The object's LOBBY sync answer says `team: true` when
 *    I hold a team seat (Versus Duos, Ranked Duos); only then is the team backlog asked for, and once it answers the
 *    panel shows two tabs, Lobby and Team, each with its own unread count. Read-when-seen, replies, catch-up, mute and
 *    the swear filter work per tab exactly as they do for the lobby. A team chat belongs to its match: a full team
 *    answer (not a catch-up) REPLACES what I hold, so a new match's team chat starts empty. Spectators never get one.
 *
 * COST: messages are tiny and rare next to the game's own frames; a message re-renders the chat panel only (its own
 * store), never the game. Nothing here runs per frame.
 */
import { create } from 'zustand';
import {
  LOBBY_CHAT_BACKLOG, LOBBY_CHAT_EVENT, LOBBY_CHAT_RATE, LOBBY_CHAT_REFUSED_EVENT, LOBBY_CHAT_SYNC_EVENT, parseLobbyChatMsg, parseLobbyChatSync,
  LOBBY_CHAT_REPLY_SNIPPET, type LobbyChatChannel, type LobbyChatMsg, type LobbyChatRefusal, type LobbyChatSync,
} from '@game/versus-cf/lobbyChat';
import { cleanDmBody } from '@game/versus-cf/hub';
import { pageSeen } from '../chat/pageSeen';

export { LOBBY_CHAT_MAX_CHARS } from '@game/versus-cf/lobbyChat';
export type { LobbyChatChannel } from '@game/versus-cf/lobbyChat';

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
/** A team message refused because I no longer hold a team seat. */
export const LOBBY_CHAT_TEAM_GONE_TEXT = 'You are not on a team now.';

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
  /** Messages from others that arrived while I was not looking (the panel collapsed, the page away, the other tab). */
  unread: number;
  /** TEAM CHAT (R-LOBBY-CHAT-TEAM-01): the object says I hold a team seat (its lobby sync answer's `team`). */
  team: boolean;
  /** The object answered the TEAM sync: the Team tab shows. */
  teamAvailable: boolean;
  teamCanSend: boolean;
  teamMsgs: ShownChatMsg[];
  teamUnread: number;
  /** The tab I picked (the Lobby one whenever there is no team chat; see `lobbyChatTab`). */
  tab: LobbyChatChannel;
  /** The panel is expanded (kept on this device). */
  open: boolean;
  /** The Settings switch (on by default): off hides lobby chat entirely. */
  enabled: boolean;
  /** Senders I muted in this game. */
  muted: Readonly<Record<string, true>>;
  me: string | null;
}

const TEAM_RESET = { team: false, teamAvailable: false, teamCanSend: false, teamMsgs: [] as ShownChatMsg[], teamUnread: 0, tab: 'lobby' as LobbyChatChannel };

export const useLobbyChat = create<LobbyChatState>(() => ({
  gameKey: null, available: false, canSend: false, company: true, msgs: [], unread: 0, ...TEAM_RESET,
  open: loadFlag(OPEN_KEY, !smallTouch()), enabled: loadFlag(ENABLED_KEY, true), muted: {}, me: null,
}));

/** The tab the panel shows: the one I picked, but only while a team chat exists (else the lobby). */
export const lobbyChatTab = (s: Pick<LobbyChatState, 'team' | 'teamAvailable' | 'tab'>): LobbyChatChannel => (s.team && s.teamAvailable ? s.tab : 'lobby');
/** Both tabs' unread (the collapsed button's count). */
export const lobbyChatUnreadTotal = (s: Pick<LobbyChatState, 'unread' | 'teamUnread' | 'team'>): number => s.unread + (s.team ? s.teamUnread : 0);

/** One channel's slice of the state, and the patch that writes it back. */
interface ChanView { msgs: ShownChatMsg[]; unread: number; available: boolean; canSend: boolean }
const chanOf = (s: LobbyChatState, c: LobbyChatChannel): ChanView => (c === 'team'
  ? { msgs: s.teamMsgs, unread: s.teamUnread, available: s.teamAvailable, canSend: s.teamCanSend }
  : { msgs: s.msgs, unread: s.unread, available: s.available, canSend: s.canSend });
function chanPatch(c: LobbyChatChannel, p: Partial<ChanView>): Partial<LobbyChatState> {
  if (c === 'lobby') return p;
  const out: Partial<LobbyChatState> = {};
  if (p.msgs) out.teamMsgs = p.msgs;
  if (p.unread != null) out.teamUnread = p.unread;
  if (p.available != null) out.teamAvailable = p.available;
  if (p.canSend != null) out.teamCanSend = p.canSend;
  return out;
}

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
const syncTimer: Record<LobbyChatChannel, ReturnType<typeof setTimeout> | null> = { lobby: null, team: null };
const SYNC_RETRY_MS = 2_000;
const SYNC_TRIES = 15;
const synced: Record<LobbyChatChannel, boolean> = { lobby: false, team: false };
function clearSyncTimer(c: LobbyChatChannel): void {
  if (syncTimer[c] != null) clearTimeout(syncTimer[c]!);
  syncTimer[c] = null;
}
/** The newest message the object stamped that I hold on `c` (a catch-up asks only for what came after it). */
function lastStoredId(c: LobbyChatChannel): string | null {
  const msgs = chanOf(useLobbyChat.getState(), c).msgs;
  for (let i = msgs.length - 1; i >= 0; i--) if (!msgs[i]!.state && !msgs[i]!.id.startsWith('local:')) return msgs[i]!.id;
  return null;
}
function askSync(s: Session, tries: number, c: LobbyChatChannel = 'lobby'): void {
  clearSyncTimer(c);
  if (session !== s || synced[c]) return;
  const since = chanOf(useLobbyChat.getState(), c).available ? lastStoredId(c) : null;
  const payload: { since?: string; channel?: 'team' } = since ? { since } : {};
  if (c === 'team') payload.channel = 'team';
  s.send(LOBBY_CHAT_SYNC_EVENT, payload);
  if (tries > 1) syncTimer[c] = setTimeout(() => askSync(s, tries - 1, c), SYNC_RETRY_MS);
}
let bucket = { tokens: LOBBY_CHAT_RATE.burst as number, at: 0 };
let clock: () => number = () => Date.now();
/** Tests: a fake clock. */
export function setLobbyChatClockForTests(fn: (() => number) | null): void { clock = fn ?? (() => Date.now()); }

const fresh = (gameKey: string | null, me: string | null): Partial<LobbyChatState> =>
  ({ gameKey, available: false, canSend: false, company: true, msgs: [], unread: 0, ...TEAM_RESET, muted: {}, me });

/**
 * Install the game's socket (or clear it: `null` with the same owner). The same game re-installed (a Versus channel
 * swap, a reconnect) keeps its messages and re-syncs; a new game starts empty.
 */
export function setLobbyChatSession(owner: string, next: { send: Session['send']; gameKey: string; me: string | null } | null): void {
  if (!next) {
    if (session?.owner !== owner) return;
    session = null;
    watchSeen(false);
    clearSyncTimer('lobby');
    clearSyncTimer('team');
    useLobbyChat.setState(fresh(null, null));
    return;
  }
  const same = useLobbyChat.getState().gameKey === next.gameKey;
  session = { owner, send: next.send, gameKey: next.gameKey };
  if (!same) { bucket = { tokens: LOBBY_CHAT_RATE.burst, at: 0 }; useLobbyChat.setState(fresh(next.gameKey, next.me?.toLowerCase() ?? null)); }
  else if (next.me) useLobbyChat.setState({ me: next.me.toLowerCase() });
  synced.lobby = false;
  synced.team = false;
  clearSyncTimer('team');
  watchSeen(true);
  askSync(session, SYNC_TRIES);
  // The team backlog is asked again once the lobby answer says I still hold a team seat.
}

/**
 * The game's socket came back (every reconnect calls this): catch up on what was sent while it was down. Only once
 * this game's chat is known (`available`); the first connect's own sync is the session install's.
 */
export function resyncLobbyChat(): void {
  if (!session || !useLobbyChat.getState().available) return;
  synced.lobby = false;
  synced.team = false;
  askSync(session, SYNC_TRIES);
}

/** Whether anyone else is in the game (the lobby publisher's stands; Versus and watching always have company). */
export function setLobbyChatCompany(on: boolean): void {
  if (useLobbyChat.getState().company !== on) useLobbyChat.setState({ company: on });
}

const isMine = (m: LobbyChatMsg, me: string | null): boolean => !!me && m.from.toLowerCase() === me;

/** I am looking at channel `c` right now: the panel is open on its tab and the page is in front of me. */
const viewing = (s: LobbyChatState, c: LobbyChatChannel): boolean => s.open && s.enabled && lobbyChatTab(s) === c && pageSeen();

function counts(s: LobbyChatState, m: LobbyChatMsg, c: LobbyChatChannel): boolean {
  return !isMine(m, s.me) && !s.muted[m.from.toLowerCase()] && !viewing(s, c);
}

/** Something says I am looking at the open panel (the page came back, a press, focus or typing in it): read its tab. */
export function noteLobbyChatSeen(): void {
  const s = useLobbyChat.getState();
  const c = lobbyChatTab(s);
  if (chanOf(s, c).unread && viewing(s, c)) useLobbyChat.setState(chanPatch(c, { unread: 0 }));
}

/** A message that can be answered: a stored one (not one still sending or failed). */
export const canReplyToLobby = (m: ShownChatMsg): boolean => !m.state && !m.id.startsWith('local:');

const trim = (msgs: ShownChatMsg[]): ShownChatMsg[] => {
  if (msgs.length > LOBBY_CHAT_BACKLOG + 20) msgs.splice(0, msgs.length - LOBBY_CHAT_BACKLOG);
  return msgs;
};

/** A sync answer on `c`: merged by id (a team's full answer replaces what I hold: a new match starts it empty). */
function applySync(c: LobbyChatChannel, sync: LobbyChatSync): void {
  const s = useLobbyChat.getState();
  const ch = chanOf(s, c);
  // Merge by id (a full backlog, or a catch-up of what came after `since`): what I hold stays, what is new joins it in
  // the object's order, and a send of mine whose echo was lost while I was away is confirmed by its stored copy.
  const replace = c === 'team' && !sync.since;
  const held = replace ? [] : ch.msgs;
  const had = new Set(held.map((m) => m.id));
  const stored = held.filter((m) => !m.state && !m.id.startsWith('local:'));
  const incoming = sync.msgs.filter((m) => !had.has(m.id));
  const confirmed = new Set(incoming.filter((m) => m.cid && isMine(m, s.me)).map((m) => m.cid!));
  const pending = ch.msgs.filter((m) => (m.state || m.id.startsWith('local:')) && !(m.cid && confirmed.has(m.cid)));
  const merged = [...stored, ...incoming].sort((x, y) => x.at - y.at);
  const msgs = trim([...merged, ...pending]);
  const known = new Set(ch.msgs.map((m) => m.id));
  const fresh_ = incoming.filter((m) => !known.has(m.id) && counts(s, m, c)).length;
  useLobbyChat.setState(chanPatch(c, { available: true, canSend: sync.canSend, msgs, unread: ch.available ? ch.unread + fresh_ : 0 }));
}

/** One event off the game's stream: true when it was a lobby chat event (consumed). */
export function receiveLobbyChatEvent(event: string, payload: unknown): boolean {
  if (event === LOBBY_CHAT_EVENT) {
    const m = parseLobbyChatMsg(payload);
    if (!m || !session) return true;
    const c: LobbyChatChannel = m.channel === 'team' ? 'team' : 'lobby';
    const s = useLobbyChat.getState();
    if (c === 'team' && !s.team) return true; // never shown to a reader the object did not name a team member
    const ch = chanOf(s, c);
    if (ch.msgs.some((x) => x.id === m.id)) return true;
    const pending = m.cid && isMine(m, s.me) ? ch.msgs.findIndex((x) => x.cid === m.cid && x.state) : -1;
    const msgs = ch.msgs.slice();
    if (pending >= 0) msgs[pending] = m;
    else msgs.push(m);
    useLobbyChat.setState(chanPatch(c, { msgs: trim(msgs), unread: ch.unread + (pending < 0 && counts(s, m, c) ? 1 : 0) }));
    return true;
  }
  if (event === LOBBY_CHAT_SYNC_EVENT) {
    const sync = parseLobbyChatSync(payload);
    if (!sync || !session) return true; // an older Worker relays another client's request: not an answer
    if (sync.channel === 'team') {
      if (!useLobbyChat.getState().team) return true;
      synced.team = true;
      clearSyncTimer('team');
      applySync('team', sync);
      return true;
    }
    synced.lobby = true;
    clearSyncTimer('lobby');
    applySync('lobby', sync);
    // TEAM CHAT: the lobby answer says whether I hold a team seat. Gained: ask the team backlog. Lost: drop the tab.
    const s = useLobbyChat.getState();
    if (sync.team) {
      if (!s.team) useLobbyChat.setState({ team: true });
      if (!synced.team && syncTimer.team == null) askSync(session, SYNC_TRIES, 'team');
    } else if (s.team) {
      clearSyncTimer('team');
      useLobbyChat.setState({ ...TEAM_RESET });
    }
    return true;
  }
  if (event === LOBBY_CHAT_REFUSED_EVENT) {
    const p = payload as { cid?: unknown; reason?: unknown; channel?: unknown } | null;
    const reason = (typeof p?.reason === 'string' && p.reason in LOBBY_CHAT_ERROR_TEXT ? p.reason : 'malformed') as LobbyChatRefusal;
    const team = p?.channel === 'team';
    const s = useLobbyChat.getState();
    if (reason === 'guest' && s.canSend) useLobbyChat.setState({ canSend: false, teamCanSend: false });
    if (team && reason === 'not_member') useLobbyChat.setState({ teamCanSend: false });
    if (typeof p?.cid !== 'string') return true;
    const text = team && reason === 'not_member' ? LOBBY_CHAT_TEAM_GONE_TEXT : LOBBY_CHAT_ERROR_TEXT[reason];
    const mark = (msgs: ShownChatMsg[]): ShownChatMsg[] => (msgs.some((m) => m.cid === p.cid && m.state)
      ? msgs.map((m) => (m.cid === p.cid && m.state ? { ...m, state: 'failed', error: text } : m)) : msgs);
    const now = useLobbyChat.getState();
    useLobbyChat.setState({ msgs: mark(now.msgs), teamMsgs: mark(now.teamMsgs) });
    return true;
  }
  return false;
}

/**
 * Send `raw` (`replyTo`: the stored message it answers) on `channel` (default: the tab the panel shows): null when it
 * went (or there was nothing to send), else the reason to show under the composer. Sending says I am looking.
 */
export function sendLobbyChat(raw: string, replyTo: ShownChatMsg | null = null, channel?: LobbyChatChannel): string | null {
  const body = cleanDmBody(raw);
  if (body == null) return raw.trim() ? LOBBY_CHAT_ERROR_TEXT.malformed : null;
  const s = useLobbyChat.getState();
  const c = channel ?? lobbyChatTab(s);
  const ch = chanOf(s, c);
  if (!session || !ch.available || (c === 'team' && !s.team)) return LOBBY_CHAT_ERROR_TEXT.offline;
  if (!ch.canSend) return c === 'team' && s.canSend ? LOBBY_CHAT_TEAM_GONE_TEXT : LOBBY_CHAT_GUEST_TEXT;
  const now = clock();
  bucket.tokens = Math.min(LOBBY_CHAT_RATE.burst, bucket.tokens + (bucket.at ? Math.max(0, now - bucket.at) / 1000 : 0) * LOBBY_CHAT_RATE.per);
  bucket.at = now;
  if (bucket.tokens < 1) return LOBBY_CHAT_ERROR_TEXT.rate;
  bucket.tokens -= 1;
  seq += 1;
  const cid = `lc${seq.toString(36)}${Math.floor(now % 1e6).toString(36)}`;
  const answers = replyTo && canReplyToLobby(replyTo) ? replyTo : null;
  const local: ShownChatMsg = { id: `local:${cid}`, cid, from: s.me ?? 'me', name: 'You', role: c === 'team' ? 'player' : 'spectator', body, at: now, state: 'sending' };
  if (c === 'team') local.channel = 'team';
  if (answers) local.reply = { id: answers.id, from: answers.from, name: answers.name, body: [...answers.body].slice(0, LOBBY_CHAT_REPLY_SNIPPET).join('') };
  useLobbyChat.setState(chanPatch(c, { msgs: [...ch.msgs, local], ...(viewing(s, c) ? { unread: 0 } : {}) }));
  // `replyTo` / `channel` only when set: an older Worker never sees the fields (and is never sent a team message).
  const out: { cid: string; body: string; replyTo?: string; channel?: 'team' } = { cid, body };
  if (answers) out.replyTo = answers.id;
  if (c === 'team') out.channel = 'team';
  session.send(LOBBY_CHAT_EVENT, out);
  return null;
}

/** Retry a refused message (it goes out again as a new send, on its own channel). */
export function retryLobbyChat(cid: string): void {
  const s = useLobbyChat.getState();
  const c: LobbyChatChannel = s.teamMsgs.some((x) => x.cid === cid && x.state === 'failed') ? 'team' : 'lobby';
  const list = chanOf(s, c).msgs;
  const m = list.find((x) => x.cid === cid && x.state === 'failed');
  if (!m) return;
  const rest = list.filter((x) => x !== m);
  useLobbyChat.setState(chanPatch(c, { msgs: rest }));
  const orig = m.reply ? rest.find((x) => x.id === m.reply!.id) ?? null : null;
  sendLobbyChat(m.body, orig, c);
}

export function setLobbyChatOpen(open: boolean): void {
  saveFlag(OPEN_KEY, open);
  if (!open) { useLobbyChat.setState({ open }); return; }
  // Opening reads the tab it opens on; the other tab keeps its own count.
  useLobbyChat.setState({ open, ...chanPatch(lobbyChatTab(useLobbyChat.getState()), { unread: 0 }) });
}

/** Pick the Lobby or Team tab (R-LOBBY-CHAT-TEAM-01): looking at it reads it. */
export function setLobbyChatTab(tab: LobbyChatChannel): void {
  useLobbyChat.setState({ tab });
  noteLobbyChatSeen();
}

/** The Settings switch: off hides lobby chat entirely (saved on this device). */
export function setLobbyChatEnabled(on: boolean): void {
  saveFlag(ENABLED_KEY, on);
  useLobbyChat.setState(on ? { enabled: on, unread: 0, teamUnread: 0 } : { enabled: on });
}

/** Mute (or unmute) a sender in this game: their messages are hidden on my screen only (both tabs). */
export function setLobbyChatMuted(userId: string, muted: boolean): void {
  const k = userId.toLowerCase();
  const next = { ...useLobbyChat.getState().muted };
  if (muted) next[k] = true;
  else delete next[k];
  useLobbyChat.setState({ muted: next });
}
