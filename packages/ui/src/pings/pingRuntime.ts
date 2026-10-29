/**
 * LIVE PINGS + MENTORS, the client (owner design 2026-10-29; R-PING-01..05). The wire contract and the server rule live
 * in `@game/versus-cf/pings` (shared with the Versus room and the live object); this is the client's half:
 *
 *  - THE SESSION SEAM (`setPingSession`): whichever stream the game is on installs one adapter, `{ send, seat, mode }`.
 *    The Versus store (the room relay, Supabase or Cloudflare), a live lobby game's publisher (the player) and its
 *    watcher (`lobbylive:<id>`). With none installed a player still pings: the ping is a local note to self.
 *  - SENDING (`sendPing`): the context decides who I am to the target on screen (`pingContext`: my own screen = self,
 *    my Duos teammate's view = mate, a watched player who promoted me = mentor). Rate limited (`PING_RATE`); shown on my
 *    own screen at once as the confirmation, then broadcast.
 *  - RECEIVING (`receivePingEvent`): every handler on the game's stream passes events here. The Cloudflare room already
 *    dropped what I may not see; a Supabase broadcast channel cannot, so the receiver re-checks the same rule: a mentor
 *    ping only reaches the player it is for, from that player's own mentor; a player never shows an opponent's ping;
 *    receivers rate limit each sender too.
 *  - MENTORS (`setMyMentor`): the player names ONE spectator (or none). The player is the authority on its own mentor:
 *    a mentor message for MY seat that I did not send is ignored. It is re-announced whenever the stands change, so a
 *    late joiner learns who is mentoring.
 */
import { create } from 'zustand';
import {
  parsePing,
  parsePingClear,
  parsePingMentor,
  PING_BUTTON_KINDS,
  PING_CLEAR_EVENT,
  PING_CLEAR_RATE,
  PING_EVENT,
  PING_LIFE_MS,
  PING_MENTOR_EVENT,
  PING_RATE,
  PingRateLimiter,
  teammateOf,
  type PingKind,
  type PingClearMessage,
  type PingMentorMessage,
  type PingMessage,
  type PingMode,
  type PingRole,
  type PingSeat,
  type PingTarget,
} from '@game/versus-cf/pings';
import { currentUserId } from '../identity';
import { useGame } from '../store';
import { useSpectate } from '../versus/spectate';
import { useWatchers, watcherName, type Watcher } from '../versus/watchers';

export type { PingKind, PingSeat, PingTarget, PingRole };

/** One ping on screen. */
export interface ShownPing {
  key: string;
  kind: PingKind;
  owner: PingSeat;
  target: PingTarget;
  role: PingRole;
  /** The sender's name (a mentor's or teammate's caption). */
  name?: string;
  /** I sent it (my own confirmation). */
  mine: boolean;
  at: number;
}

export const usePings = create<{ list: ShownPing[] }>(() => ({ list: [] }));

export interface MentorEntry { id: string; name: string }
/** Each seat's mentor, as this client knows it (who is mentoring is shown on every screen). */
export const useMentors = create<{ bySeat: Partial<Record<PingSeat, MentorEntry>> }>(() => ({ bySeat: {} }));

export interface PingSession {
  /** Who installed it (a later clear by another owner is ignored). */
  owner: string;
  /** Broadcast on the game's stream; null = local only. */
  send: ((event: string, payload: unknown) => void) | null;
  /** My seat as a player, or null as a spectator. */
  seat: () => PingSeat | null;
  mode: () => PingMode;
  /** The game this is (a new key forgets the mentors: a mentor is for one game only). */
  gameKey: string;
}

let session: PingSession | null = null;
let clock: () => number = () => Date.now();
/** For the tests: a fake clock. */
export function setPingClockForTests(fn: (() => number) | null): void { clock = fn ?? (() => Date.now()); }

const sendLimit = new PingRateLimiter(PING_RATE);
const recvLimit = new PingRateLimiter(PING_RATE);
const clearLimit = new PingRateLimiter(PING_CLEAR_RATE);
let seq = 0;
let lastAnnounced: string | null = null;

/** Install the game's stream (or clear it: `null` with the same owner). */
export function setPingSession(owner: string, next: Omit<PingSession, 'owner'> | null): void {
  if (!next) {
    if (session?.owner !== owner) return;
    session = null;
    resetPings();
    return;
  }
  const changedGame = !session || session.gameKey !== next.gameKey;
  session = { ...next, owner };
  if (changedGame) resetPings();
  else announceMentor(true);
}

/** Forget every ping and mentor (a new game, the stream closed). */
export function resetPings(): void {
  sendLimit.reset();
  recvLimit.reset();
  clearLimit.reset();
  lastAnnounced = null;
  if (usePings.getState().list.length) usePings.setState({ list: [] });
  if (Object.keys(useMentors.getState().bySeat).length) useMentors.setState({ bySeat: {} });
}

/** My seat as a player in this game, or null as a spectator. With no stream installed I am the lone player (`p1`). */
export function myPingSeat(): PingSeat | null {
  return session ? session.seat() : 'p1';
}
const modeNow = (): PingMode => session?.mode() ?? 'lobby';

/** The seat whose screen is on display: the watched (or teammate's) seat on the watch screen, else mine. */
export function onScreenSeat(): PingSeat {
  const sp = useSpectate.getState();
  if (sp.active) return sp.seat;
  return myPingSeat() ?? 'p1';
}

/**
 * May I ping what is on screen right now, and as whom? Null = right-click goes straight to Inspect (outside a game, a
 * replay, a plain spectator). Owner 2026-10-29: "Players should be able to ping on their own as well".
 */
export function pingContext(): { owner: PingSeat; role: PingRole } | null {
  const g = useGame.getState();
  const sp = useSpectate.getState();
  // THE WATCH SCREEN IS `replaying` TOO (spectate.ts sets it so nothing commits against the synthetic run), so only a
  // replay that is NOT the live watch screen closes the menu here. It used to close it for the teammate view and the
  // mentor's screen alike (owner 2026-10-29: "players should be able to ping their teammates board/minions etc as
  // well"; R-PING-06).
  if (g.showTitle || g.replaySession || (g.replaying && !sp.active)) return null;
  const mine = myPingSeat();
  if (sp.active) {
    if (sp.hero || sp.teammateHero) return null;
    if (sp.teammate) {
      if (!mine || teammateOf(modeNow(), mine) !== sp.seat) return null;
      return { owner: sp.seat, role: 'mate' };
    }
    if (mine) return null;
    const me = currentUserId();
    const m = useMentors.getState().bySeat[sp.seat];
    return me && m && m.id === me ? { owner: sp.seat, role: 'mentor' } : null;
  }
  if (!mine) return null; // a spectator off the watch screen
  if (g.run.phase !== 'recruit') return null;
  return { owner: mine, role: 'self' };
}

const sameTarget = (a: PingTarget, b: PingTarget): boolean =>
  a.t === 'card' ? b.t === 'card' && a.uid === b.uid && a.zone === b.zone : b.t === 'button' && a.id === b.id;

function show(p: Omit<ShownPing, 'key' | 'at'>, key: string): void {
  const now = clock();
  // One ping per target at a time: a new one replaces the last on the same target. A ping lives PING_LIFE_MS from its
  // arrival on THIS screen unless it is cleared sooner (owner 2026-10-29: "they should only last 5s if not cleared").
  const list = usePings.getState().list.filter((x) => now - x.at < PING_LIFE_MS && x.key !== key && !(x.owner === p.owner && sameTarget(x.target, p.target)));
  usePings.setState({ list: [...list, { ...p, key, at: now }] });
}

/** Drop pings past their life (the layer calls it when the next one is due; local only, nothing is sent). */
export function expirePings(now: number = clock()): void {
  const list = usePings.getState().list;
  const keep = list.filter((x) => now - x.at < PING_LIFE_MS);
  if (keep.length !== list.length) usePings.setState({ list: keep });
}

/** May I tell the other screens that `owner`'s ping was cleared? The player, the teammate and the mentor may; a plain
 *  spectator clears only on their own screen. */
function maySendClearFor(owner: PingSeat): boolean {
  const mine = myPingSeat();
  if (mine) return mine === owner || teammateOf(modeNow(), mine) === owner;
  const me = currentUserId();
  return !!me && useMentors.getState().bySeat[owner]?.id === me;
}

function dropAndTell(match: (x: ShownPing) => boolean, tell: boolean): void {
  const list = usePings.getState().list;
  const gone = list.filter(match);
  if (gone.length === 0) return;
  usePings.setState({ list: list.filter((x) => !match(x)) });
  if (!tell || !session?.send) return;
  const sent = new Set<string>();
  for (const g of gone) {
    const k = `${g.owner}|${JSON.stringify(g.target)}`;
    if (sent.has(k) || !maySendClearFor(g.owner) || !clearLimit.allow('me', clock())) continue;
    sent.add(k);
    session.send(PING_CLEAR_EVENT, { owner: g.owner, target: g.target } satisfies PingClearMessage);
  }
}

/** Clear one ping (a left- or right-click on it): on every screen showing it. */
export function clearPing(key: string): void {
  dropAndTell((x) => x.key === key, true);
}

/**
 * MY OWN live ping on `target` on the screen on display, or null (R-PING-07). Only a ping I placed counts: a teammate's,
 * a mentor's or the player's own ping on the same target is not mine to clear this way (their right-click opens the fan).
 */
export function myPingOn(target: PingTarget): ShownPing | null {
  const owner = onScreenSeat();
  const now = clock();
  return usePings.getState().list.find((x) => x.mine && x.owner === owner && now - x.at < PING_LIFE_MS && sameTarget(x.target, target)) ?? null;
}

/**
 * A single right-click (a phone: long-press) on a target that carries MY ping clears it, on every screen that shows it
 * (owner 2026-10-29: "players in general should be able to clear their own pings on friends boards etc too by right
 * clicking the minion/button etc once"; R-PING-07). Answers whether one was cleared (then no fan opens).
 */
export function clearMyPingOn(target: PingTarget): boolean {
  const p = myPingOn(target);
  if (!p) return false;
  clearPing(p.key);
  return true;
}

/** Clear every ping on a card (it is being moved: dragged, sold, played), on every screen showing it. */
export function clearPingsOnCard(uid: string): void {
  dropAndTell((x) => x.target.t === 'card' && x.target.uid === uid, true);
}

/** A ping whose target left this screen (the shop closed, the card is gone): dropped here only (every screen sees its
 *  own target go). */
export function forgetPing(key: string): void {
  dropAndTell((x) => x.key === key, false);
}

const myName = (): string => (useGame.getState().playerName ?? '').trim();

/**
 * Ping `target` (on the screen now on display) with `kind`. Answers false when pings are not available here or the rate
 * limit refused it. Shows it on my own screen at once, then sends it on the stream.
 */
export function sendPing(kind: PingKind, target: PingTarget): boolean {
  const ctx = pingContext();
  if (!ctx) return false;
  if (target.t === 'button' && !PING_BUTTON_KINDS.includes(kind)) return false; // a button takes the top three only
  const me = currentUserId() ?? 'me';
  if (!sendLimit.allow(me, clock())) return false;
  seq += 1;
  const id = `${me.slice(0, 12)}.${seq}.${Math.floor(clock() % 1e6)}`;
  const msg: PingMessage = { id, kind, owner: ctx.owner, target, from: me, role: ctx.role };
  const name = myName();
  if (name) msg.name = name.slice(0, 24);
  show({ kind, owner: ctx.owner, target, role: ctx.role, name: msg.name, mine: true }, `${me}:${id}`);
  session?.send?.(PING_EVENT, msg);
  return true;
}

/**
 * The receiver's rule (the same as the server's, for a stream that cannot enforce it). Pure; exported for tests.
 *  - a MENTOR ping: only the player it is for, only from the mentor that player named;
 *  - a player's own / teammate ping: a seated receiver shows it only for its own seat or its teammate's (never an
 *    opponent's); a spectator shows it.
 */
export function acceptPing(m: PingMessage, ctx: { mySeat: PingSeat | null; mode: PingMode; mentorOf: (s: PingSeat) => string | null }): boolean {
  if (m.role === 'mentor') return ctx.mySeat === m.owner && !!m.from && ctx.mentorOf(m.owner) === m.from;
  if (ctx.mySeat) return m.owner === ctx.mySeat || teammateOf(ctx.mode, ctx.mySeat) === m.owner;
  return true;
}

/** An inbound ping (any stream). Answers whether it was shown. */
export function receivePing(payload: unknown): boolean {
  const m = parsePing(payload);
  if (!m) return false;
  const me = currentUserId();
  if (me && m.from === me) return false; // my own echo: already shown
  const ok = acceptPing(m, { mySeat: myPingSeat(), mode: modeNow(), mentorOf: (s) => useMentors.getState().bySeat[s]?.id ?? null });
  if (!ok) return false;
  if (!recvLimit.allow(m.from || m.owner, clock())) return false;
  show({ kind: m.kind, owner: m.owner, target: m.target, role: m.role ?? 'self', name: m.name, mine: false }, `${m.from}:${m.id}`);
  return true;
}

/** An inbound mentor change. The PLAYER is the authority on its own mentor: one for my seat that I did not send is ignored. */
export function receiveMentor(payload: unknown): boolean {
  const m = parsePingMentor(payload);
  if (!m) return false;
  if (myPingSeat() === m.seat) return false;
  applyMentor(m);
  return true;
}

function applyMentor(m: PingMentorMessage): void {
  const cur = useMentors.getState().bySeat;
  const had = cur[m.seat];
  if (m.mentor === null) {
    if (!had) return;
    const next = { ...cur };
    delete next[m.seat];
    useMentors.setState({ bySeat: next });
    return;
  }
  if (had && had.id === m.mentor && had.name === (m.name ?? '')) return;
  useMentors.setState({ bySeat: { ...cur, [m.seat]: { id: m.mentor, name: m.name ?? '' } } });
}

/** An inbound CLEAR: drop the pings on that target. A seated receiver takes one only for its own or its teammate's
 *  seat (the same audience rule as a ping). */
export function receivePingClear(payload: unknown): boolean {
  const m = parsePingClear(payload);
  if (!m) return false;
  const mine = myPingSeat();
  if (mine && m.owner !== mine && teammateOf(modeNow(), mine) !== m.owner) return false;
  const list = usePings.getState().list;
  const keep = list.filter((x) => !(x.owner === m.owner && sameTarget(x.target, m.target)));
  if (keep.length === list.length) return false;
  usePings.setState({ list: keep });
  return true;
}

/** Every handler on a game's stream passes its events here first. True = it was a ping event (handled). */
export function receivePingEvent(event: string, payload: unknown): boolean {
  if (event === PING_EVENT) { receivePing(payload); return true; }
  if (event === PING_CLEAR_EVENT) { receivePingClear(payload); return true; }
  if (event === PING_MENTOR_EVENT) { receiveMentor(payload); return true; }
  return false;
}

/** My mentor (as a player), or null. */
export function myMentor(): MentorEntry | null {
  const s = myPingSeat();
  return s ? useMentors.getState().bySeat[s] ?? null : null;
}

/**
 * Promote one spectator to Mentor, or demote (null). A player only; one mentor at a time (naming another replaces the
 * first). Answers false when I hold no seat.
 */
export function setMyMentor(w: Pick<Watcher, 'id' | 'name'> | null): boolean {
  const seat = myPingSeat();
  if (!seat) return false;
  if (w && w.id.startsWith('anon:')) return false; // an unnamed watcher row (an older server) cannot be promoted
  applyMentor({ seat, mentor: w ? w.id : null, name: w ? watcherName(w).slice(0, 24) : undefined });
  announceMentor(true);
  return true;
}

/** Tell the stream who my mentor is (or that I have none). `force`: even when unchanged (a newcomer). */
function announceMentor(force = false): void {
  const seat = session?.seat();
  if (!seat || !session?.send) return;
  const m = useMentors.getState().bySeat[seat];
  const key = m ? `${m.id}\u0001${m.name}` : '';
  if (!force && key === lastAnnounced) return;
  if (!m && lastAnnounced === null) return; // never had one: nothing to say
  lastAnnounced = key;
  const msg: PingMentorMessage = { seat, mentor: m?.id ?? null };
  if (m?.name) msg.name = m.name;
  session.send(PING_MENTOR_EVENT, msg);
}

// The stands changed (someone joined or left): a mentor who left is demoted, and the rest hear who is mentoring.
useWatchers.subscribe((s, prev) => {
  if (s.list === prev.list) return;
  const seat = myPingSeat();
  const m = seat ? useMentors.getState().bySeat[seat] : null;
  if (m && !s.list.some((w) => w.id === m.id)) { setMyMentor(null); return; }
  if (m) announceMentor(true);
});

/** For the tests. */
export function resetPingRuntimeForTests(): void {
  session = null;
  seq = 0;
  resetPings();
}
