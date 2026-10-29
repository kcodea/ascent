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
 * NEVER A SILENT DROP (R-DM-05): a message typed while the hub is reconnecting is shown as "Sending" and kept in the
 * outbox; it goes the moment the hub is back (the same client id: stored once even if an earlier try landed). A
 * refusal (not friends, blocked, too fast) shows on the message with its reason. With no hub at all (no Worker in this
 * build) the composer says messages are not available right now.
 */
import { create } from 'zustand';
import { contentRevision } from '@game/content';
import { VersusCfClient, VersusCfError } from '@game/versus-cf/client';
import { cleanDmBody, DM_MAX_CHARS, HUB_PROTOCOL, HUB_SOCKET_PATH, type DmRow, type HubHelloAnswer, type HubPeer, type HubPush } from '@game/versus-cf/hub';
import { currentUserId } from '../../identity';
import { supabaseClient } from '../../remoteBoards';
import { useGame } from '../../store';
import { friendsHubUrl } from './hubUrl';
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
  onStatus: (s: 'open' | 'down' | 'dead') => void;
}
/** Opens the hub socket, or null when this build has no Worker. */
export type HubFactory = (h: HubHandlers) => HubConn | null;

async function hubToken(): Promise<string> {
  const c = supabaseClient();
  if (c) {
    const { data } = await c.auth.getSession();
    if (data.session?.access_token) return data.session.access_token;
  }
  const me = currentUserId();
  if (!me) throw new VersusCfError('not_signed_in');
  return `dev.${me}.dev`; // a dev Worker only (DEV_AUTH=1); a deployed one refuses it
}

const defaultFactory: HubFactory = (h) => {
  const base = friendsHubUrl();
  if (!base || typeof WebSocket === 'undefined') return null;
  const c = new VersusCfClient({
    baseUrl: base, roomId: 'hub', path: HUB_SOCKET_PATH, token: hubToken, versusProtocol: 0, contentRevision: contentRevision(),
    ws: (url, protocols) => new WebSocket(url, protocols) as never,
    hello: h.hello,
    onHello: (d) => h.onHello(d as HubHelloAnswer),
    onPush: (m) => h.onPush(m as unknown as HubPush),
    onStatus: (s) => h.onStatus(s),
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
/** When the friends list last arrived (a hub peer heard after it is newer than it). */
let listAt = 0;
/** Sends waiting for the hub (in order). */
let outbox: { cid: string; to: string; body: string }[] = [];

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

function onStatus(s: 'open' | 'down' | 'dead'): void {
  if (s === 'open') { set({ hub: 'open' }); return; }
  set({ hub: s === 'dead' ? 'off' : 'down' });
}

/** Open (or close) the hub for whoever is signed in now. */
function syncConnection(): void {
  const want = started && friendsAccount() && useFriends.getState().deployed ? me() : '';
  if (want === connFor) return;
  conn?.close();
  conn = null;
  connFor = want;
  outbox = [];
  unreadReadFor = '';
  lastPresenceKey = '';
  set({ hub: 'off', convos: {}, unread: {}, peers: {}, toast: null });
  if (!want) return;
  const c = factory({
    hello: () => {
      const p = presenceWire(presenceNow());
      lastPresenceKey = presenceKey(p);
      return { protocol: HUB_PROTOCOL, presence: p, build: contentRevision() };
    },
    onHello, onPush, onStatus,
  });
  if (!c) return;
  conn = c;
  set({ hub: 'connecting' });
  c.connect().catch(() => { if (conn === c) set({ hub: 'down' }); });
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
  syncConnection();
  return () => {
    started = false;
    unGame(); unFriends(); unDock();
    syncConnection();
  };
}

/** Tests: forget everything. */
export function resetDmForTests(): void {
  conn?.close();
  conn = null; connFor = ''; started = false; outbox = []; unreadReadFor = ''; lastPresenceKey = ''; listAt = 0;
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
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

/** I am looking at this conversation right now (the chat window is open on its tab and the page is visible). */
export function viewing(friendId: string): boolean {
  const d = useFriendsDock.getState();
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  return !!d.dmWith && d.dmWith.toLowerCase() === friendId.toLowerCase() && visible;
}

function receive(row: DmRow): void {
  const mine = me();
  const id = friendOf(row, mine);
  const c = get().convos[id];
  if (c?.loaded) putConvo(id, { ...c, msgs: merge(c.msgs, [row]) });
  if (row.from === mine) return;
  if (viewing(id)) { void markRead(id, true); return; }
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
    for (const [id, v] of Object.entries(u)) if (!viewing(id)) unread[id] = v.count;
    set({ unread });
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
  if ((get().unread[id] ?? 0) > 0) void markRead(id);
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

/** Everything from this friend is read (one write, only when something was unread; `force`: a live message I saw). */
export async function markRead(friendId: string, force = false): Promise<void> {
  const id = friendId.toLowerCase();
  if (!force && !(get().unread[id] ?? 0)) return;
  if (get().unread[id]) { const u = { ...get().unread }; delete u[id]; set({ unread: u }); }
  try { await remote.markRead(id); } catch { /* the next open marks it again */ }
}

/** All unread messages (the dock button's badge). */
export const totalUnread = (u: Record<string, number>): number => Object.values(u).reduce((a, b) => a + b, 0);

// ── sending ──────────────────────────────────────────────────────────────────────────────────────────────────

const newCid = (): string => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8, '0')}-0000-4000-8000-${Math.floor(Math.random() * 1e12).toString(16).padStart(12, '0')}`);

/** Send a message. Answers null when it is on its way (or queued), else a sentence saying why not. */
export function sendDm(friendId: string, raw: string): string | null {
  const to = friendId.toLowerCase();
  const body = cleanDmBody(raw);
  if (body == null) return raw.trim() ? DM_ERROR_TEXT.bad_body! : null;
  if (!connFor || !conn) return DM_UNAVAILABLE_TEXT;
  const cid = newCid();
  const local: DmMsg = { id: `local:${cid}`, cid, from: me(), to, body, at: new Date().toISOString(), readAt: null, state: 'sending' };
  const c = get().convos[to] ?? emptyConvo();
  putConvo(to, { ...c, msgs: merge(c.msgs, [local]) });
  outbox.push({ cid, to, body });
  flushOutbox();
  return null;
}

/** Try a failed message again (same client id: stored once even if an earlier try landed). */
export function retryDm(friendId: string, cid: string): void {
  const to = friendId.toLowerCase();
  const c = get().convos[to];
  const m = c?.msgs.find((x) => x.cid === cid && x.state === 'failed');
  if (!c || !m) return;
  putConvo(to, { ...c, msgs: merge(c.msgs, [{ ...m, state: 'sending', error: undefined }]) });
  if (!outbox.some((o) => o.cid === cid)) outbox.push({ cid, to, body: m.body });
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
        const row = await c.request<DmRow>('send', { cid: o.cid, to: o.to, body: o.body });
        outbox.shift();
        const cv = get().convos[o.to] ?? emptyConvo();
        putConvo(o.to, { ...cv, msgs: merge(cv.msgs, [{ ...row, from: row.from.toLowerCase(), to: row.to.toLowerCase(), state: undefined, error: undefined }]) });
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
