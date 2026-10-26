/**
 * RANKED DUOS (owner design 2026-10-26; docs/design/2026-10-26-ranked-duos.md): the pure rules the server and the client
 * share. Bundle-safe (imports nothing heavy): the `versus-resolve` bundle carries it.
 *
 * - The END-TURN GATE (owner: "the game will still halt/not progress into combat, and back to shop, until both players
 *   hit their end turn/combat gem"), as one formula: both teammates ended = the round closes at once; otherwise it closes
 *   5 s after the LATER of the clock's 0:00 and the first End Turn; nobody ended past 0:00 = it waits, up to the 30 s
 *   AFK backstop. A teammate on auto (disconnected / left) counts as ended from the moment they went auto.
 *   Mirrored by `versus_ranked_duos__close_at` (supabase/migrations/2026-10-29-ranked-duos.sql).
 * - TEAM NAMES (owner: "me and lemon could name our team CITRUS"): 2-16 letters, digits and single spaces; the server
 *   also runs the word filter (it stays off the client bundle). Default "Name1 & Name2", display only.
 * - The TEAM identity: the unordered pair of account ids.
 */

/** The team letters of a Ranked Duos table: `a` is the live pair (seats p1 + p2), `b` to `d` the recorded teams. */
export const RANKED_DUOS_TEAMS = ['a', 'b', 'c', 'd'] as const;
export type RankedDuosTeam = (typeof RANKED_DUOS_TEAMS)[number];
export const RANKED_DUOS_LIVE_TEAM: RankedDuosTeam = 'a';
export const RANKED_DUOS_SERVED_TEAMS: readonly RankedDuosTeam[] = ['b', 'c', 'd'];

/** A team pool starts on 30 Health plus both heroes' Armor (owner 2026-10-26). */
export const RANKED_DUOS_TEAM_HEALTH = 30;
/** The other teammate's window once one has ended and the clock is at 0:00 (owner: "a timer ... of 5 seconds"). */
export const RANKED_DUOS_END_GRACE_MS = 5_000;
/** Nobody ended this long past 0:00: the round closes as a timeout (an AFK safeguard, picked 2026-10-26). */
export const RANKED_DUOS_OVERTIME_BACKSTOP_MS = 30_000;

export interface RankedDuosGateInput {
  /** The shop's 0:00 (epoch ms), or null while the clock has not started (round 1's intro). */
  deadline: number | null;
  /** Each living live seat: when it ended (End Turn, or went auto), or null while it is still shopping. */
  ended: readonly (number | null)[];
}

/**
 * When the round's shop closes (epoch ms), or null when nothing closes it yet. `now` is not an input: the answer is a
 * moment, and the caller closes the round once its clock reaches it. Both ended closes "now", which the caller reads
 * as the latest end (any moment at or before now). Pure; the SQL twin must agree (db test).
 */
export function rankedDuosCloseAt(g: RankedDuosGateInput): number | null {
  const ends = g.ended;
  if (ends.length > 0 && ends.every((e) => e != null)) return Math.max(...(ends as number[]));
  if (g.deadline == null) return null;
  const first = ends.reduce<number | null>((m, e) => (e == null ? m : m == null ? e : Math.min(m, e)), null);
  if (first == null) return g.deadline + RANKED_DUOS_OVERTIME_BACKSTOP_MS;
  return Math.max(g.deadline, first) + RANKED_DUOS_END_GRACE_MS;
}

/** Shop actions are refused from 0:00 (owner: "you can't keep shopping, but can re-order board etc"); re-order, freeze
 *  and the teammate view stay open until the round closes. */
export function rankedDuosShoppingOpen(deadline: number | null, now: number): boolean {
  return deadline == null || now < deadline;
}

// ── Team names ────────────────────────────────────────────────────────────────────────────────────────────────────
export const TEAM_NAME_MIN = 2;
export const TEAM_NAME_MAX = 16;

/** Trim and collapse inner whitespace to single spaces (the stored form). */
export function cleanTeamName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export type TeamNameProblem = 'name_length' | 'name_chars';

/** The format half of the rule (the server adds `name_blocked` / `name_reserved` from the word filter). */
export function teamNameProblem(raw: string): TeamNameProblem | null {
  const name = cleanTeamName(raw);
  if (name.length < TEAM_NAME_MIN || name.length > TEAM_NAME_MAX) return 'name_length';
  if (!/^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/.test(name)) return 'name_chars';
  return null;
}

/** The name a team shows before it picks one: "Name1 & Name2" (computed, never stored). */
export function defaultTeamName(a: string, b: string): string {
  return `${a} & ${b}`;
}

/** The team identity: the two account ids in a fixed order (the SQL table stores `user_lo < user_hi`). */
export function teamPairOf(a: string, b: string): [string, string] {
  if (a === b) throw new RangeError('a team needs two different players');
  return a < b ? [a, b] : [b, a];
}
