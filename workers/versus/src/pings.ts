/**
 * LIVE PINGS + MENTORS — the shared wire contract and its server-side rules (owner design 2026-10-29: "Start building live
 * pings for duos ... check mark, x, question mark, pass, and sell. With this, i want a player to be able to promote a
 * spectator to a mentor, which allows the mentor to use live pings for the player to help guide them through a game";
 * additions 2026-10-29: "Players should be able to ping on their own as well, and spectators should be able to see the
 * player pings").
 *
 * ONE small message, `PingMessage`, travels on whatever spectator stream the game already has: the Versus room's relay
 * (this Worker's `VersusRoom`), a live lobby game's Supabase broadcast channel (`lobbylive:<id>`), and the Cloudflare
 * live object being built for lobby / Practice spectating. The UI talks to all three through one adapter
 * (`packages/ui/src/pings/pingRuntime.ts`). A mentor promotion is a second message, `PingMentorMessage`.
 *
 * WHO MAY PING WHOM (`routePing`, the ONE rule every server enforces and every client re-checks):
 *  - SELF: a seated player pings their own shop, board, hand or buttons (a note to self). Seen by them, their Duos
 *    teammate and every spectator. Never by an opponent.
 *  - MATE: in Duos / Ranked Duos a player pings their TEAMMATE's targets (the teammate view). Same audience as SELF.
 *  - MENTOR: the one spectator a player promoted pings that player's targets. Seen by that player ONLY.
 *  - anyone else (a plain spectator, a demoted mentor, an opponent) is DROPPED.
 * The role is always derived by the server from who sent it, never trusted from the payload, and `from` is stamped
 * with the authenticated sender. Rate limit: `PING_RATE` per sender, on the server AND the client.
 *
 * Dependency-free: no imports (the UI imports it as `@game/versus-cf/pings`).
 */

export type PingSeat = 'p1' | 'p2' | 'p3' | 'p4';
export const PING_SEATS: readonly PingSeat[] = ['p1', 'p2', 'p3', 'p4'];

/** The five pings (owner 2026-10-29). Their art ships as `packages/ui/src/art/pings/<kind>.webp`. */
export type PingKind = 'check' | 'x' | 'question' | 'pass' | 'sell';
export const PING_KINDS: readonly PingKind[] = ['check', 'x', 'question', 'pass', 'sell'];

/** The shop buttons a ping may land on (their `data-spec` names in the UI). */
export type PingButton = 'upgrade' | 'refresh' | 'freeze' | 'heropower' | 'endturn';
export const PING_BUTTONS: readonly PingButton[] = ['upgrade', 'refresh', 'freeze', 'heropower', 'endturn'];

export type PingZone = 'shop' | 'board' | 'hand';
export const PING_ZONES: readonly PingZone[] = ['shop', 'board', 'hand'];

/** What a ping lands on: a card by its instance uid (it follows the card if it moves), or a shop button. */
export type PingTarget = { t: 'card'; uid: string; zone: PingZone } | { t: 'button'; id: PingButton };

export type PingRole = 'self' | 'mate' | 'mentor';

/** The wire message. `owner` is the seat whose screen the target is on; `from` is stamped by the server. */
export interface PingMessage {
  /** Unique per sender (a client counter + random), for de-duplication. */
  id: string;
  kind: PingKind;
  owner: PingSeat;
  target: PingTarget;
  from: string;
  /** Derived by the router (a client's own value is ignored). */
  role?: PingRole;
  /** The sender's display name (for the "Mentor" / teammate caption), clamped. */
  name?: string;
}

/** A player names (or clears) their mentor for this game. */
export interface PingMentorMessage {
  seat: PingSeat;
  /** The spectator's user id, or null to demote. */
  mentor: string | null;
  /** The mentor's display name, clamped. */
  name?: string;
}

export const PING_EVENT = 'ping';
export const PING_MENTOR_EVENT = 'ping_mentor';
/** At most `max` pings per sender in any `windowMs` (owner 2026-10-29: "e.g. 3 pings / 2 s per sender"). */
export const PING_RATE = { max: 3, windowMs: 2000 } as const;
/** How long a ping stays on its target before it fades. */
export const PING_LIFE_MS = 4000;

const ID = /^[A-Za-z0-9_:.-]{1,64}$/;
const isSeat = (v: unknown): v is PingSeat => typeof v === 'string' && (PING_SEATS as readonly string[]).includes(v);
const clampName = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 24) : undefined);

/** Validate a ping payload; null when malformed. `from` and `role` are carried through as-is (the router overwrites). */
export function parsePing(payload: unknown): PingMessage | null {
  const p = payload as Partial<PingMessage> | null;
  if (!p || typeof p !== 'object') return null;
  if (typeof p.id !== 'string' || !ID.test(p.id)) return null;
  if (!(PING_KINDS as readonly unknown[]).includes(p.kind)) return null;
  if (!isSeat(p.owner)) return null;
  const t = p.target as Partial<PingTarget> | undefined;
  let target: PingTarget;
  if (t?.t === 'card') {
    const c = t as { uid?: unknown; zone?: unknown };
    if (typeof c.uid !== 'string' || !ID.test(c.uid) || !(PING_ZONES as readonly unknown[]).includes(c.zone)) return null;
    target = { t: 'card', uid: c.uid, zone: c.zone as PingZone };
  } else if (t?.t === 'button') {
    const b = t as { id?: unknown };
    if (!(PING_BUTTONS as readonly unknown[]).includes(b.id)) return null;
    target = { t: 'button', id: b.id as PingButton };
  } else return null;
  const from = typeof p.from === 'string' && ID.test(p.from) ? p.from : '';
  const role = p.role === 'self' || p.role === 'mate' || p.role === 'mentor' ? p.role : undefined;
  const out: PingMessage = { id: p.id, kind: p.kind as PingKind, owner: p.owner, target, from };
  if (role) out.role = role;
  const name = clampName(p.name);
  if (name) out.name = name;
  return out;
}

export function parsePingMentor(payload: unknown): PingMentorMessage | null {
  const p = payload as Partial<PingMentorMessage> | null;
  if (!p || typeof p !== 'object' || !isSeat(p.seat)) return null;
  if (p.mentor !== null && (typeof p.mentor !== 'string' || !ID.test(p.mentor))) return null;
  const out: PingMentorMessage = { seat: p.seat, mentor: p.mentor };
  const name = clampName(p.name);
  if (name && p.mentor) out.name = name;
  return out;
}

/** The game's mode, as far as teammates go. `lobby` = a lobby / Practice game (one player, `p1`, and the stands). */
export type PingMode = 'duel' | 'group' | 'duos' | 'ranked_duos' | 'lobby';

/** A seat's teammate, or null (Duos: p1+p2 vs p3+p4; a Ranked Duos party room: p1+p2). */
export function teammateOf(mode: PingMode, seat: PingSeat): PingSeat | null {
  if (mode === 'duos') return seat === 'p1' ? 'p2' : seat === 'p2' ? 'p1' : seat === 'p3' ? 'p4' : 'p3';
  if (mode === 'ranked_duos') return seat === 'p1' ? 'p2' : seat === 'p2' ? 'p1' : null;
  return null;
}

/** One member of the room / live game: a seat ('p1'..'p4') or the stands. */
export interface PingMember {
  userId: string;
  role: string;
}

export interface PingRoomView {
  mode: PingMode;
  members: readonly PingMember[];
  /** Each seat's promoted mentor (user id). */
  mentors: Partial<Record<PingSeat, string>>;
}

export type PingRoute =
  | { ok: true; ping: PingMessage & { role: PingRole }; to: string[] }
  | { ok: false; reason: 'malformed' | 'no_owner' | 'not_allowed' };

/** The seat a user holds, or null (a spectator, or not in the room). */
const seatOfUser = (room: PingRoomView, userId: string): PingSeat | null => {
  const r = room.members.find((m) => m.userId === userId)?.role;
  return isSeat(r) ? r : null;
};
const userOfSeat = (room: PingRoomView, seat: PingSeat): string | null => room.members.find((m) => m.role === seat)?.userId ?? null;
const isSpectator = (room: PingRoomView, userId: string): boolean => room.members.some((m) => m.userId === userId && m.role === 'spectator');

/** The sender's role toward `owner`'s targets, or null when they may not ping them. Pure. */
export function pingRoleOf(room: PingRoomView, sender: string, owner: PingSeat): PingRole | null {
  const seat = seatOfUser(room, sender);
  if (seat) {
    if (seat === owner) return 'self';
    if (teammateOf(room.mode, seat) === owner) return 'mate';
    return null; // an opponent never pings
  }
  if (room.mentors[owner] === sender && isSpectator(room, sender)) return 'mentor';
  return null;
}

/**
 * Route one ping: who may send it and who receives it (never the sender: their own screen shows it locally). Pure.
 *  - mentor: the owner only;
 *  - self / mate: the owner, the owner's teammate, and every spectator. Never an opponent seat.
 */
export function routePing(room: PingRoomView, sender: string, payload: unknown): PingRoute {
  const msg = parsePing(payload);
  if (!msg) return { ok: false, reason: 'malformed' };
  const ownerUser = userOfSeat(room, msg.owner);
  if (!ownerUser) return { ok: false, reason: 'no_owner' };
  const role = pingRoleOf(room, sender, msg.owner);
  if (!role) return { ok: false, reason: 'not_allowed' };
  const ping = { ...msg, from: sender, role };
  const to = new Set<string>();
  if (role === 'mentor') {
    to.add(ownerUser);
  } else {
    to.add(ownerUser);
    const mate = teammateOf(room.mode, msg.owner);
    const mateUser = mate ? userOfSeat(room, mate) : null;
    if (mateUser) to.add(mateUser);
    for (const m of room.members) if (m.role === 'spectator') to.add(m.userId);
  }
  to.delete(sender);
  return { ok: true, ping, to: [...to] };
}

/**
 * A mentor change: only the seated player themself may name their mentor, and only a spectator in the room may be named.
 * Returns the cleaned message (sent to everyone, so every screen can show who is mentoring), or null to drop it. Pure.
 */
export function routePingMentor(room: PingRoomView, sender: string, payload: unknown): PingMentorMessage | null {
  const msg = parsePingMentor(payload);
  if (!msg) return null;
  if (seatOfUser(room, sender) !== msg.seat) return null;
  if (msg.mentor !== null && !isSpectator(room, msg.mentor)) return null;
  return msg;
}

/** Apply a routed mentor change to a mentors map (a new object). A spectator mentors at most one player. Pure. */
export function withMentor(mentors: Partial<Record<PingSeat, string>>, msg: PingMentorMessage): Partial<Record<PingSeat, string>> {
  const next: Partial<Record<PingSeat, string>> = { ...mentors };
  if (msg.mentor === null) delete next[msg.seat];
  else next[msg.seat] = msg.mentor;
  return next;
}

/** A sliding-window rate limiter keyed by sender (`PING_RATE`). In memory; a restart only ever errs generous. */
export class PingRateLimiter {
  private readonly at = new Map<string, number[]>();
  constructor(private readonly rate: { max: number; windowMs: number } = PING_RATE) {}
  /** Take one slot for `key` at `now`; false when over the limit. */
  allow(key: string, now: number): boolean {
    const keep = (this.at.get(key) ?? []).filter((t) => now - t < this.rate.windowMs && now >= t);
    if (keep.length >= this.rate.max) { this.at.set(key, keep); return false; }
    keep.push(now);
    this.at.set(key, keep);
    if (this.at.size > 256) for (const [k, v] of this.at) if (!v.some((t) => now - t < this.rate.windowMs)) this.at.delete(k);
    return true;
  }
  reset(): void { this.at.clear(); }
}

/**
 * The ping room of a LIVE lobby / Practice game (the Cloudflare live object, `liveGame.ts`): its one player is seat `p1`,
 * everyone watching is in the stands, and the player may have named one of them Mentor. Pure.
 */
export function livePingRoom(owner: string | null, watchers: Iterable<string>, mentor: string | null): PingRoomView {
  const members: PingMember[] = [];
  if (owner) members.push({ userId: owner, role: 'p1' });
  for (const w of watchers) if (w !== owner) members.push({ userId: w, role: 'spectator' });
  return { mode: 'lobby', members, mentors: mentor ? { p1: mentor } : {} };
}
