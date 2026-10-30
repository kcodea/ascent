/**
 * DIRECT MESSAGES — the client state (owner 2026-10-29: "In game messaging should be direct messages through the friends
 * list, click a friend and a chat overlay pops up"; R-DM-01..05).
 *
 * THE HUB SOCKET (`startDirectMessages`, once at boot): while a signed-in ACCOUNT has the game open and this build
 * carries a Worker, one WebSocket to my friends hub (`workers/versus/src/hub.ts`). It carries:
 *   - my presence: sent at hello, and again whenever the presence beat (friendsStore) moved it (piggybacked on the beat's
 *     own settle, so no extra triggers); my connected friends' presence comes back live (`peer` pushes) and overrides
 *     the friends list's (60 s old at worst) status the moment it is newer;
 *   - messages: `send` (answered with the stored row), and `dm` pushes, a message to me (or from me, in another of my
 *     games) the moment it is stored.
 *
 * SUPABASE (`dmRemote.ts`), on demand only (R-DM-05): unread counts once per hub connection; a conversation's last 50
 * when it is opened (older pages on request); read receipts only when there was something unread; Report.
 *
 * READ WHEN SEEN (owner 2026-10-30, R-DM-READ-01: "if they are open and i come back to my tab the notification doesnt go
 * away when i respond"): a conversation is read whenever it is actually in front of me, meaning the chat window is on
 * its tab (pinned or not) AND the page is visible and focused (`viewing`). A message that arrives then is never counted
 * unread and never toasts; coming back to the page (visibilitychange / focus), pressing into the window, or sending in
 * it reads what arrived while I was away. Each of those is ONE `dm_mark_read` write, and only when something was
 * unread; live messages seen while looking are written in one coalesced write (`DM_READ_COALESCE_MS`), never one per
 * message.
 *
 * REPLIES (R-DM-REPLY-01): a message may answer an earlier one (`replyTo`, protocol 2); the stored row carries a short
 * copy of the original (`reply`) for the quote.
 *
 * NEVER A SILENT DROP (R-DM-05): a message typed while the hub is reconnecting is shown as "Sending" and kept in the
 * outbox; it goes the moment the hub is back (the same client id: stored once even if an earlier try landed). A
 * refusal (not friends, blocked, too fast) shows on the message with its reason. With no hub at all (a page the hub
 * would refuse, R-DM-HUB-URL-01) the composer says messages are not available right now; a socket that died for good
 * is reopened after HUB_RESTART_MS.
 */
import { create } from 'zustand';
import { contentRevision } from '@game/content';
import { VersusCfClient, VersusCfError } from '@game/versus-cf/client';
import {
  cleanDmBody, DM_MAX_CHARS, DM_REPLY_SNIPPET, HUB_PROTOCOL, HUB_SOCKET_PATH, type DmReplyPreview, type DmRow, type HubHelloAnswer, type HubPeer, type HubPush,
} from '@game/versus-cf/hub';
import { currentUserId } from '../../identity';
import { pageSeen } from '../../chat/pageSeen';
import { supabaseClient } from '../../remoteBoards';
import { useGame } from '../../store';
import { friendsHubUrl, isLocalHub } from './hubUrl';
import { useFriendsDock } from '../dock/dockStore';
import { friendsAccount, presenceNow, refreshFriendsList, useFriends } from '../friendsStore';
import type { Friend, PresenceReport } from '../friendsRemote';
import { parseActivity, parseGameStatus } from '../gameStatus';
import { dmRemote, DM_PAGE, type DmRemote, type DmReportReason } from './dmRemote';

export { DM_MAX_CHARS };

/** A message as the conversation shows it. A local one (not stored yet) has `state`. */
export interface DmMsg extends DmRow {
  state?: 'sending' | 'failed';
  /** Why it failed (a sentence). */
  error?: string;
}

export interface Conversation {
  /** Oldest first. */
  msgs: DmMsg[];
  loaded: boolean;
  loading: boolean;
  /** There may be older messages than the first one here. */
  hasOlder: boolean;
  failed: boolean;
}

export type HubStatus = 'off' | 'connecting' | 'open' | 'down';

/** A friend's live presence from the hub, stamped with when THIS client heard it. */
export interface LivePeer extends HubPeer {
  seenAt: number;
}

export interface DmToast {
  from: string;
  body: string;
  id: string;
  count: number;
}

export interface DmState {
  hub: HubStatus;
  convos: Record<string, Conversation>;
  unread: Record<string, number>;
  peers: Record<string, LivePeer>;
  toast: DmToast | null;
  /** Message ids I reported this session. */
  reported: Record<string, true>;
}

export const useDm = create<DmState>(() => ({ hub: 'off', convos: {}, unread: {}, peers: {}, toast: null, reported: {} }));
const get = useDm.getState;
const set = useDm.setState;

/** The sentence a refusal shows on the message. Plain short sentences (writing rule). */
export const DM_ERROR_TEXT: Record<string, string> = {
  not_friends: 'Not sent. You can only message friends.',
  blocked: 'Not sent. You cannot message this player.',
  rate_limited: 'Not sent. You are sending messages too fast.',
  bad_body: 'Not sent. Messages can be up to 500 characters.',
  bad_target: 'Not sent.',
  unavailable: 'Not sent. Messages are not available right now.',
};
export const DM_UNAVAILABLE_TEXT = 'Messages are not available right now.';
export const DM_RECONNECTING_TEXT = 'Reconnecting. Your messages will send when it is back.';
/** How long a new-message toast stays up. */
export const DM_TOAST_MS = 5_000;
/** Live messages I saw while looking are marked read in ONE write this long after the first (a burst is one write). */
export const DM_READ_COALESCE_MS = 1_200;

// ── the hub connection (injectable for the tests) ────────────────────────────────────────────────────────────

export interface HubConn {
  connect(): Promise<void>;
  request<T>(op: string, args: Record<string, unknown>): Promise<T>;
  close(): void;
}
export interface HubHandlers {
  hello: () => Record<string, unknown>;
  onHello: (d: HubHelloAnswer) => void;
  onPush: (m: HubPush) => void;
  /** `detail`: why a socket died (the close reason or code), when it will not reconnect by itself. */
  onStatus: (s: 'open' | 'down' | 'dead', detail?: string) => void;
}
/** Opens the hub socket, or null when this build has no Worker. */
export type HubFactory = (h: HubHandlers) => HubConn | null;

/** The longest the hub waits for my access token before trying again (a stuck session read must never stall it for good). */
export const HUB_TOKEN_TIMEOUT_MS = 8_000;

async function hubToken(base: string): Promise<string> {
  const c = supabaseClient();
  if (c) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const { data } = await Promise.race([
        c.auth.getSession(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new VersusCfError('token_timeout')), HUB_TOKEN_TIMEOUT_MS); }),
      ]);
      if (data.session?.access_token) return data.session.access_token;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const me = currentUserId();
  if (!me) throw new VersusCfError('not_signed_in');
  // A dev token works only on a local dev hub (DEV_AUTH=1); the live hub would refuse it, so wait for a real session.
  if (!isLocalHub(base)) throw new VersusCfError('not_signed_in');
  return `dev.${me}.dev`;
}

const defaultFactory: HubFactory = (h) => {
  const base = friendsHubUrl();
  if (!base || typeof WebSocket === 'undefined') return null;
  const c = new VersusCfClient({
    baseUrl: base, roomId: 'hub', path: HUB_SOCKET_PATH, token: () => hubToken(base), versusProtocol: 0, contentRevision: contentRevision(),
    ws: (url, protocols) => new WebSocket(url, protocols) as never,
    hello: h.hello,
    onHello: (d) => h.onHello(d as HubHelloAnswer),
    onPush: (m) => h.onPush(m as unknown as HubPush),
    onStatus: (s, detail) => h.onStatus(s, detail),
    requestTimeoutMs: 12_000,
    wake: (fn) => {
      if (typeof window === 'undefined') return () => undefined;
      window.addEventListener('online', fn);
      return () => window.removeEventListener('online', fn);
    },
  });
  return { connect: () => c.connect(), request: (op, args) => c.request(op as never, args), close: () => c.close() };
};

let factory: HubFactory = defaultFactory;
let remote: DmRemote = dmRemote;
let conn: HubConn | null = null;
let connFor = '';
let started = false;
let unreadReadFor = '';
let hellos = 0;
let lastPresenceKey = '';
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
/** When the friends list last arrived (a hub peer heard after it is newer than it). */
let listAt = 0;
/** Sends waiting for the hub (in order). */
let outbox: { cid: string; to: string; body: string; replyTo: string | null }[] = [];
/** Friends whose live messages I saw while looking but the store still has unread (one coalesced write). */
const pendingRead = new Set<string>();
let readTimer: ReturnType<typeof setTimeout> | null = null;

/** Tests: a fake hub and a fake Supabase. */
export function setDmDepsForTests(deps: { factory?: HubFactory; remote?: DmRemote }): void {
  if (deps.factory) factory = deps.factory;
  if (deps.remote) remote = deps.remote;
}

const me = (): string => (useGame.getState().account.userId ?? '').toLowerCase();
const presenceWire = (p: PresenceReport): Record<string, unknown> | null =>
  p.status === 'offline' ? null : { status: p.status, mode: p.mode, watchKind: p.watchKind, watchId: p.watchId, game: p.game ?? null, activity: p.activity ?? null };
const presenceKey = (p: Record<string, unknown> | null): string => JSON.stringify(p);

function onHello(d: HubHelloAnswer): void {
  const now = Date.now();
  const peers: Record<string, LivePeer> = {};
  for (const p of d.peers ?? []) peers[p.userId.toLowerCase()] = { ...p, userId: p.userId.toLowerCase(), seenAt: now };
  set({ peers, hub: 'open' });
  flushOutbox();
  // Unread counts: once per connection (a reconnect re-reads them: the socket may have missed pushes).
  hellos += 1;
  void loadUnread();
}

function onPush(m: HubPush): void {
  if (m.t === 'peer') {
    const id = m.peer.userId.toLowerCase();
    set({ peers: { ...get().peers, [id]: { ...m.peer, userId: id, seenAt: Date.now() } } });
    return;
  }
  if (m.t === 'dm') receive(m.msg);
}

/**
 * A hub socket that will not come back by itself (a refused hello, a socket closed for good) is replaced by a fresh one
 * after `HUB_RESTART_MS`, so messages never stay "not available" for the rest of the session (R-DM-HUB-URL-01). Two
 * deaths are final: an old client the hub no longer speaks to (`version_mismatch`), and a game replaced by a newer one
 * of mine (`replaced`: more than HUB_MAX_SOCKETS open games; reopening would only close the other one).
 */
export const HUB_RESTART_MS = 30_000;
const FINAL_DEATHS = new Set(['version_mismatch', '4409', 'replaced', '4000']);

function clearRestart(): void {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
}

/** A socket that died for a final reason (its refused hello and its close may come in either order). */
let finalConn: HubConn | null = null;

function scheduleRestart(c: HubConn, detail: string | undefined): void {
  if (detail && FINAL_DEATHS.has(detail)) { finalConn = c; clearRestart(); return; }
  if (conn !== c || restartTimer || finalConn === c) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    if (conn !== c || !connFor) return;
    c.close();
    conn = null;
    openHub();
  }, HUB_RESTART_MS);
}

function onStatus(c: HubConn | null, s: 'open' | 'down' | 'dead', detail?: string): void {
  if (c && conn !== c) return;
  if (s === 'open') { set({ hub: 'open' }); return; }
  set({ hub: s === 'dead' ? 'off' : 'down' });
  if (s === 'dead' && c) scheduleRestart(c, detail);
}

/** Open a hub socket for the account in `connFor` (the conversations, unread counts and outbox are kept). */
function openHub(): void {
  let made: HubConn | null = null;
  const c = factory({
    hello: () => {
      const p = presenceWire(presenceNow());
      lastPresenceKey = presenceKey(p);
      return { protocol: HUB_PROTOCOL, presence: p, build: contentRevision() };
    },
    onHello, onPush,
    onStatus: (st, detail) => onStatus(made, st, detail),
  });
  if (!c) return;
  made = c;
  conn = c;
  set({ hub: 'connecting' });
  c.connect().catch((e: unknown) => {
    if (conn !== c) return;
    set({ hub: 'down' });
    scheduleRestart(c, (e as VersusCfError)?.code);
  });
}

/** Open (or close) the hub for whoever is signed in now. */
function syncConnection(): void {
  const want = started && friendsAccount() && useFriends.getState().deployed ? me() : '';
  if (want === connFor) return;
  clearRestart();
  conn?.close();
  conn = null;
  connFor = want;
  outbox = [];
  unreadReadFor = '';
  lastPresenceKey = '';
  set({ hub: 'off', convos: {}, unread: {}, peers: {}, toast: null });
  if (!want) return;
  openHub();
}

/** My presence moved (the beat answered): tell my friends through the hub, once per change. */
function syncPresence(): void {
  if (!conn || get().hub !== 'open') return;
  const p = presenceWire(presenceNow());
  const key = presenceKey(p);
  if (key === lastPresenceKey || !p) return;
  lastPresenceKey = key;
  conn.request('presence', { presence: p }).catch(() => { lastPresenceKey = ''; });
}

/** Start the hub's lifecycle (once, at boot). Returns a stop function (tests). */
export function startDirectMessages(): () => void {
  if (started) return () => undefined;
  started = true;
  const unGame = useGame.subscribe((s, prev) => {
    if (s.account.userId !== prev.account.userId || s.account.anonymous !== prev.account.anonymous) syncConnection();
  });
  const unFriends = useFriends.subscribe((s, prev) => {
    if (s.deployed !== prev.deployed) syncConnection();
    if (s.list !== prev.list && s.list) listAt = Date.now();
    if (s.inbox !== prev.inbox) syncPresence();
  });
  // A conversation I am looking at is read the moment it opens.
  const unDock = useFriendsDock.subscribe((s, prev) => {
    if (s.dmWith && s.dmWith !== prev.dmWith) void openConversation(s.dmWith);
  });
  // Coming back to the page with a conversation showing reads it (R-DM-READ-01).
  const onSeen = (): void => { noteDmSeen(); };
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (hasDom) {
    document.addEventListener('visibilitychange', onSeen);
    window.addEventListener('focus', onSeen);
  }
  syncConnection();
  return () => {
    started = false;
    unGame(); unFriends(); unDock();
    if (hasDom) {
      document.removeEventListener('visibilitychange', onSeen);
      window.removeEventListener('focus', onSeen);
    }
    syncConnection();
  };
}

/** Tests: forget everything. */
export function resetDmForTests(): void {
  clearRestart();
  conn?.close();
  conn = null; connFor = ''; started = false; outbox = []; unreadReadFor = ''; lastPresenceKey = ''; listAt = 0;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  if (readTimer) { clearTimeout(readTimer); readTimer = null; }
  pendingRead.clear();
  factory = defaultFactory;
  remote = dmRemote;
  set({ hub: 'off', convos: {}, unread: {}, peers: {}, toast: null, reported: {} });
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────

const emptyConvo = (): Conversation => ({ msgs: [], loaded: false, loading: false, hasOlder: false, failed: false });
const friendOf = (row: DmRow, mine: string): string => (row.from === mine ? row.to : row.from);

function putConvo(id: string, c: Conversation): void {
  set({ convos: { ...get().convos, [id]: c } });
}

/** Merge rows into a conversation (by id; my own local copy is replaced by its stored row via the client id). */
function merge(list: DmMsg[], rows: DmMsg[]): DmMsg[] {
  const out = [...list];
  for (const r of rows) {
    const i = out.findIndex((m) => m.id === r.id || (!!r.cid && m.cid === r.cid && m.from === r.from));
    if (i >= 0) out[i] = { ...out[i], ...r, state: r.state, error: r.error };
    else out.push(r);
  }
  return out.sort((a, b) => (a.state === 'sending' || a.state === 'failed' ? 1 : 0) - (b.state === 'sending' || b.state === 'failed' ? 1 : 0) || a.at.localeCompare(b.at));
}

/** The page is in front of me: visible, and focused where the browser can tell (the shared chat rule). */
export { pageSeen };

/** I am looking at this conversation right now (the chat window is open on its tab, pinned or not, and the page is seen). */
export function viewing(friendId: string): boolean {
  const d = useFriendsDock.getState();
  return !!d.dmWith && d.dmWith.toLowerCase() === friendId.toLowerCase() && pageSeen();
}

/**
 * Something says I am looking at the open conversation (the page came back, a press or focus in the chat window): read
 * it. A no-op (no write) when nothing in it is unread.
 */
export function noteDmSeen(): void {
  const d = useFriendsDock.getState().dmWith;
  if (d && pageSeen()) void markRead(d);
}

function receive(row: DmRow): void {
  const mine = me();
  const id = friendOf(row, mine);
  const c = get().convos[id];
  if (c?.loaded) putConvo(id, { ...c, msgs: merge(c.msgs, [row]) });
  if (row.from === mine) return;
  if (viewing(id)) {
    // Seen as it lands: never unread, no toast; the store hears it in one coalesced write.
    if (get().unread[id]) void markRead(id);
    else queueRead(id);
    return;
  }
  set({ unread: { ...get().unread, [id]: (get().unread[id] ?? 0) + 1 } });
  showToast({ from: id, body: row.body, id: row.id, count: get().unread[id]! });
  // The toast needs the friend's name: read the list once if no friends surface has yet.
  if (!useFriends.getState().list) void refreshFriendsList();
}

function showToast(t: DmToast): void {
  set({ toast: t });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastTimer = null; if (get().toast?.id === t.id) set({ toast: null }); }, DM_TOAST_MS);
}
export function dismissDmToast(): void {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  set({ toast: null });
}

async function loadUnread(): Promise<void> {
  const who = me();
  const key = `${who}:${hellos}`;
  if (!who || unreadReadFor === key) return;
  unreadReadFor = key;
  try {
    const u = await remote.unread();
    if (me() !== who) return;
    const unread: Record<string, number> = {};
    const seen: string[] = [];
    for (const [id, v] of Object.entries(u)) {
      if (viewing(id)) seen.push(id); else unread[id] = v.count;
    }
    set({ unread });
    // The conversation in front of me had messages waiting: they are read now (one write each).
    for (const id of seen) void markRead(id, true);
    // Messages that arrived while I was away: one toast for the newest.
    const newest = Object.entries(u).filter(([id]) => !viewing(id)).map(([id, v]) => ({ id, v }))
      .sort((a, b) => (b.v.last?.at ?? '').localeCompare(a.v.last?.at ?? ''))[0];
    if (newest?.v.last) {
      showToast({ from: newest.id, body: newest.v.last.body, id: newest.v.last.id, count: newest.v.count });
      if (!useFriends.getState().list) void refreshFriendsList();
    }
  } catch { unreadReadFor = ''; }
}

/** Open a conversation: its last 50 on the first open, and it is read. */
export async function openConversation(friendId: string): Promise<void> {
  const id = friendId.toLowerCase();
  const c = get().convos[id] ?? emptyConvo();
  if (!c.loaded && !c.loading && connFor) {
    putConvo(id, { ...c, loading: true, failed: false });
    try {
      const rows = await remote.history(id, null);
      const cur = get().convos[id] ?? emptyConvo();
      putConvo(id, { msgs: merge(cur.msgs, [...rows].reverse()), loaded: true, loading: false, hasOlder: rows.length >= DM_PAGE, failed: false });
    } catch {
      putConvo(id, { ...(get().convos[id] ?? emptyConvo()), loading: false, failed: true });
    }
  }
  if ((get().unread[id] ?? 0) > 0 || pendingRead.has(id)) void markRead(id);
  if (get().toast?.from === id) dismissDmToast();
}

/** The page before the oldest message I have. */
export async function loadOlder(friendId: string): Promise<void> {
  const id = friendId.toLowerCase();
  const c = get().convos[id];
  if (!c?.loaded || c.loading || !c.hasOlder) return;
  const oldest = c.msgs.find((m) => !m.state);
  putConvo(id, { ...c, loading: true });
  try {
    const rows = await remote.history(id, oldest?.at ?? null);
    const cur = get().convos[id]!;
    putConvo(id, { ...cur, msgs: merge(cur.msgs, [...rows].reverse()), loading: false, hasOlder: rows.length >= DM_PAGE });
  } catch {
    putConvo(id, { ...get().convos[id]!, loading: false });
  }
}

/**
 * Everything from this friend is read: the badge, the dock count and their toast go, and the store hears it in ONE
 * write, only when something was unread (or a live message I saw is waiting for its write; `force`: the store says so).
 */
export async function markRead(friendId: string, force = false): Promise<void> {
  const id = friendId.toLowerCase();
  const had = (get().unread[id] ?? 0) > 0;
  if (!force && !had && !pendingRead.has(id)) return;
  pendingRead.delete(id);
  if (had) { const u = { ...get().unread }; delete u[id]; set({ unread: u }); }
  if (get().toast?.from === id) dismissDmToast();
  try { await remote.markRead(id); } catch { /* the next open marks it again */ }
}

/** A live message seen as it landed: written read with any others in the same burst. */
function queueRead(id: string): void {
  pendingRead.add(id);
  if (readTimer) return;
  readTimer = setTimeout(() => {
    readTimer = null;
    for (const f of [...pendingRead]) void markRead(f);
  }, DM_READ_COALESCE_MS);
}

/** All unread messages (the dock button's badge). */
export const totalUnread = (u: Record<string, number>): number => Object.values(u).reduce((a, b) => a + b, 0);

// ── sending ──────────────────────────────────────────────────────────────────────────────────────────────────

const newCid = (): string => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, '0')}-0000-4000-8000-${Math.floor(Math.random() * 1e12).toString(16).padStart(12, '0')}`);

/** The quote a reply shows, made from the message it answers. */
export const replyPreviewOf = (m: Pick<DmRow, 'id' | 'from' | 'body'>): DmReplyPreview =>
  ({ id: m.id, from: m.from.toLowerCase(), body: [...m.body].slice(0, DM_REPLY_SNIPPET).join('') });

/** A message that can be answered: a stored one (not one still sending or failed). */
export const canReplyTo = (m: DmMsg): boolean => !m.state && !m.id.startsWith('local:');

/**
 * Send a message (`replyTo`: the stored message it answers). Answers null when it is on its way (or queued), else a
 * sentence saying why not. Sending in a conversation reads it (I am clearly looking at it).
 */
export function sendDm(friendId: string, raw: string, replyTo: DmMsg | null = null): string | null {
  const to = friendId.toLowerCase();
  const body = cleanDmBody(raw);
  if (body == null) return raw.trim() ? DM_ERROR_TEXT.bad_body! : null;
  if (!connFor || !conn) return DM_UNAVAILABLE_TEXT;
  const cid = newCid();
  const answers = replyTo && canReplyTo(replyTo) ? replyTo : null;
  const local: DmMsg = {
    id: `local:${cid}`, cid, from: me(), to, body, at: new Date().toISOString(), readAt: null, state: 'sending',
    replyTo: answers?.id ?? null, reply: answers ? replyPreviewOf(answers) : null,
  };
  const c = get().convos[to] ?? emptyConvo();
  putConvo(to, { ...c, msgs: merge(c.msgs, [local]) });
  outbox.push({ cid, to, body, replyTo: answers?.id ?? null });
  flushOutbox();
  void markRead(to);
  return null;
}

/** Try a failed message again (same client id: stored once even if an earlier try landed). */
export function retryDm(friendId: string, cid: string): void {
  const to = friendId.toLowerCase();
  const c = get().convos[to];
  const m = c?.msgs.find((x) => x.cid === cid && x.state === 'failed');
  if (!c || !m) return;
  putConvo(to, { ...c, msgs: merge(c.msgs, [{ ...m, state: 'sending', error: undefined }]) });
  if (!outbox.some((o) => o.cid === cid)) outbox.push({ cid, to, body: m.body, replyTo: m.replyTo ?? null });
  flushOutbox();
}

let flushing = false;
/** Send the outbox in order while the hub is open. A lost connection keeps the rest for the next open. */
function flushOutbox(): void {
  if (flushing || !conn || get().hub !== 'open') return;
  const c = conn;
  flushing = true;
  void (async () => {
    while (outbox.length && conn === c && get().hub === 'open') {
      const o = outbox[0]!;
      try {
        // `replyTo` only when set: a protocol 1 hub never sees the field.
        const args: Record<string, unknown> = { cid: o.cid, to: o.to, body: o.body };
        if (o.replyTo) args.replyTo = o.replyTo;
        const row = await c.request<DmRow>('send', args);
        outbox.shift();
        const cv = get().convos[o.to] ?? emptyConvo();
        // The quote is what the STORE kept (an older hub, or the replies SQL not applied yet, keeps none): never one the
        // friend will not see.
        putConvo(o.to, { ...cv, msgs: merge(cv.msgs, [{
          ...row, from: row.from.toLowerCase(), to: row.to.toLowerCase(), replyTo: row.replyTo ?? null, reply: row.reply ?? null, state: undefined, error: undefined,
        }]) });
      } catch (e) {
        const code = (e as VersusCfError)?.code ?? 'unavailable';
        // Lost on the way (a timeout, a dropped socket): keep it; the next open sends it.
        if (code === 'timeout' || code === 'closed' || code === 'unavailable' || code === 'not_ready') break;
        outbox.shift();
        const cv = get().convos[o.to] ?? emptyConvo();
        const m = cv.msgs.find((x) => x.cid === o.cid);
        if (m) putConvo(o.to, { ...cv, msgs: merge(cv.msgs, [{ ...m, state: 'failed', error: DM_ERROR_TEXT[code] ?? DM_ERROR_TEXT.unavailable }]) });
      }
    }
    flushing = false;
  })();
}

// ── live presence over the friends list ──────────────────────────────────────────────────────────────────────

/**
 * A friend as shown right now: the list's row, with the hub's live presence laid over it when the hub heard it AFTER
 * the list arrived (the hub's word is seconds old, the list's up to a minute). A friend on another build's hub is
 * never heard, so their list row stands. Pure apart from the module's `listAt`.
 */
export function liveFriend(f: Friend, peers: Record<string, LivePeer>, at: number = listAt): Friend {
  const p = peers[f.userId.toLowerCase()];
  if (!p || p.seenAt <= at) return f;
  if (!p.presence) {
    if (f.status === 'offline') return f;
    return { ...f, status: 'offline', mode: null, watchKind: null, watchId: null, game: null, activity: null, lastSeen: new Date(p.seenAt).toISOString() };
  }
  const pr = p.presence;
  const wk = pr.watchKind === 'live' || pr.watchKind === 'versus' ? pr.watchKind : null;
  return {
    ...f, status: pr.status, mode: pr.mode ?? null, watchKind: wk, watchId: wk ? pr.watchId ?? null : null,
    game: pr.status === 'in_game' ? parseGameStatus(pr.game) : null,
    activity: pr.status === 'online' ? parseActivity(pr.activity) : null,
    lastSeen: new Date(p.seenAt).toISOString(),
  };
}

/** The friends list with live presence laid over it (stable when nothing changed). */
let liveCache: { list: readonly Friend[] | null; peers: Record<string, LivePeer> | null; at: number; out: Friend[] } = { list: null, peers: null, at: -1, out: [] };
export function liveFriends(list: readonly Friend[] | null | undefined, peers: Record<string, LivePeer>): Friend[] {
  if (!list) return [];
  if (liveCache.list === list && liveCache.peers === peers && liveCache.at === listAt) return liveCache.out;
  const out = list.map((f) => liveFriend(f, peers));
  liveCache = { list, peers, at: listAt, out };
  return out;
}

/** Report a message sent to me. Resolves true when it was recorded. */
export async function reportDm(messageId: string, reason: DmReportReason = 'abuse'): Promise<boolean> {
  try {
    await remote.report(messageId, reason);
    set({ reported: { ...get().reported, [messageId]: true } });
    return true;
  } catch {
    return false;
  }
}
