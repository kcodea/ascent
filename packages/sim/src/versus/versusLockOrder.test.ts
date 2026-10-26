import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R-VERSUS-LOCK-ORDER-01 — NO DEADLOCKS BETWEEN VERSUS RPCs (live Postgres log 2026-10-25 ~22:58: bursts of 40P01
 * "deadlock detected", ~8 backends queued on one versus_group_matches tuple).
 *
 * Two transactions can only deadlock on row locks if they take them in opposite orders. PGlite (the DB tests' engine) is
 * one connection, so it cannot run two transactions at once; instead this test PROVES the order statically. It replays
 * the migrations in the order the owner applies them, keeps the LATEST body of every function, expands every helper
 * call and the knockout trigger (`versus_group_seat_out_to_stands`, fired by an `eliminated_round` update on
 * `versus_group_seats`), and checks that every client / service RPC takes its per-match row locks in ONE global order:
 *
 *     match row (versus_matches | versus_group_matches)  <  room row (versus_rooms)  <  member rows
 *
 * (the match's seats rows are written only under its match lock, or as a transaction's single last lock).
 *
 * A lock of a LOWER class taken after a HIGHER one is a deadlock hazard against any RPC that takes the two the right
 * way round, unless that lower row is already held by the same transaction (re-touching the match it locked first).
 * If every RPC follows one total order, no cycle (and so no deadlock) between them is possible.
 *
 * Found (and fixed by 2026-10-26-versus-lock-order.sql): versus_heartbeat took its member row before the match;
 * versus_leave_room took the room before the match; the knockout trigger took the member row before the room.
 */

const root = join(__dirname, '../../../..');
/** The owner's apply order (same as the Versus DB tests), then the later files. */
const ORDER = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-16-versus-records.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql', '2026-10-24-versus-records-24.sql', '2026-10-24-versus-spectator-xp.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql', '2026-10-25-versus-duos-pass-back.sql',
  '2026-10-25-versus-duos-xp.sql', '2026-10-25-versus-test-bots.sql',
];
const FIX = '2026-10-26-versus-lock-order.sql';
/** The egress migration rewrites the heartbeat and the list prune again; the order must still hold. */
const EGRESS = '2026-10-27-versus-egress.sql';
/** Ranked Duos (2026-10-26): the gate, leaving, placement and the abandoned sweep. */
const RANKED_DUOS = '2026-10-29-ranked-duos.sql';

type Cls = 'match' | 'seats' | 'room' | 'member';
const RANK: Record<Cls, number> = { match: 1, seats: 0, room: 2, member: 3 };

/** name -> latest body, after applying `files` in order. */
function functionsOf(files: string[]): Map<string, string> {
  const fns = new Map<string, string>();
  for (const f of files) {
    const sql = readFileSync(join(root, 'supabase/migrations', f), 'utf8').replace(/--[^\n]*/g, '');
    const re = /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\([\s\S]*?\bas\s+\$\$([\s\S]*?)\$\$\s*;/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) fns.set(m[1]!.toLowerCase(), m[2]!.toLowerCase());
  }
  return fns;
}

const TABLE_CLASS: Record<string, Cls> = {
  versus_matches: 'match', versus_group_matches: 'match', versus_group_seats: 'seats', versus_rooms: 'room', versus_members: 'member',
};

interface Ev { at: number; cls: Cls | null; call?: string; trigger?: boolean }

/** The row-lock events of one body, in source order (helper calls left for expansion). */
function eventsOf(body: string, known: Set<string>): Ev[] {
  const out: Ev[] = [];
  const table = '(versus_matches|versus_group_matches|versus_group_seats|versus_rooms|versus_members)\\b';
  // SELECT / PERFORM ... FROM <t> ... FOR UPDATE (one statement). SKIP LOCKED never waits, so it cannot close a cycle.
  for (const m of body.matchAll(new RegExp(`(?:select|perform)[^;]*?from\\s+public\\.${table}[^;]*?for\\s+update(?:\\s+of\\s+\\w+)?(\\s+skip\\s+locked)?`, 'g'))) {
    if (!m[2]) out.push({ at: m.index!, cls: TABLE_CLASS[m[1]!]! });
  }
  // UPDATE / DELETE FROM <t>. An INSERT makes a NEW row nobody else holds (not a wait), and a statement whose rows come
  // from a SKIP LOCKED subquery never waits either.
  for (const m of body.matchAll(new RegExp(`\\b(update|delete\\s+from)\\s+public\\.${table}([^;]*)`, 'g'))) {
    if (/skip\s+locked/.test(m[3]!)) continue;
    const cls = TABLE_CLASS[m[2]!]!;
    out.push({ at: m.index!, cls });
    // The knockout trigger fires on an eliminated_round update of the seats.
    if (cls === 'seats' && m[1] === 'update' && /eliminated_round\s*=/.test(m[3]!)) out.push({ at: m.index! + 1, cls: null, trigger: true });
  }
  for (const m of body.matchAll(/public\.(versus_\w+)\s*\(/g)) {
    const name = m[1]!;
    if (known.has(name)) out.push({ at: m.index!, cls: null, call: name });
  }
  return out.sort((a, b) => a.at - b.at);
}

function expand(name: string, fns: Map<string, string>, depth = 0, seen: string[] = []): Cls[] {
  const body = fns.get(name);
  if (!body || depth > 12 || seen.includes(name)) return [];
  const out: Cls[] = [];
  for (const e of eventsOf(body, new Set(fns.keys()))) {
    if (e.cls) out.push(e.cls);
    else if (e.trigger) out.push(...expand('versus_group__seat_out_to_stands', fns, depth + 1, [...seen, name]));
    else if (e.call) out.push(...expand(e.call, fns, depth + 1, [...seen, name]));
  }
  return out;
}

/**
 * The first out-of-order lock in a sequence, or null. SEATS are the match's own rows: under the match lock they are
 * serialized with every other writer of that match (all of which lock the match first), so their place in the order
 * does not matter; WITHOUT the match lock (versus_duos_hand_room) a seats write must be the transaction's last lock.
 */
function violation(seq: Cls[]): string | null {
  const held = new Set<Cls>();
  let top = 0;
  let loose = false;
  for (const c of seq) {
    if (loose && !held.has(c)) return `${c} after unguarded seats`; // re-touching a row it already holds is no new wait
    if (c === 'seats') { if (!held.has('match')) loose = true; continue; }
    if (RANK[c] < top && !held.has(c)) return `${c} after ${(Object.keys(RANK) as Cls[]).find((k) => RANK[k] === top)}`;
    held.add(c);
    top = Math.max(top, RANK[c]);
  }
  return null;
}

/** The RPCs callers reach (helpers are `versus__*` / `versus_group__*` / `versus_duos__*` / `versus_dev__*` /
 *  `versus_ranked_duos__*`). */
const isEntry = (n: string): boolean => /^versus_/.test(n) && !/^versus_(group_|duos_|dev_|ranked_duos_)?_/.test(n);

function report(files: string[]): Record<string, string> {
  const fns = functionsOf(files);
  const out: Record<string, string> = {};
  for (const n of [...fns.keys()].filter(isEntry).sort()) {
    const v = violation(expand(n, fns));
    if (v) out[n] = v;
  }
  return out;
}

describe('R-VERSUS-LOCK-ORDER-01: every Versus RPC takes its row locks in one global order', () => {
  it('the checker sees the deadlocks the live log showed (before the fix)', () => {
    const before = report(ORDER);
    expect(before.versus_heartbeat).toBe('match after member');
    expect(before.versus_list_rooms).toBe('room after member');
    expect(before.versus_leave_room).toBe('match after room');
    // The knockout trigger (member, then room) inside a round commit.
    expect(before.versus_group_commit_round).toBe('room after member');
  });

  it('after 2026-10-26-versus-lock-order.sql no RPC takes a lock out of order', () => {
    expect(report([...ORDER, FIX])).toEqual({});
  });

  it('after 2026-10-27-versus-egress.sql (heartbeat presence + room bump, rate-limited prune) the order still holds', () => {
    expect(report([...ORDER, FIX, EGRESS])).toEqual({});
  });

  it('after 2026-10-29-ranked-duos.sql (submit / reconcile hand-over, leaving, placement, the sweep) the order still holds', () => {
    expect(report([...ORDER, FIX, EGRESS, '2026-10-28-versus-health.sql', RANKED_DUOS, '2026-10-30-ranked-duos-client.sql'])).toEqual({});
  });

  it('after 2026-11-01-ranked-duos-party.sql (friends-only, the party join, the Live Games heartbeat) the order still holds', () => {
    expect(report([...ORDER, FIX, EGRESS, '2026-10-28-versus-health.sql', RANKED_DUOS, '2026-10-30-ranked-duos-client.sql',
      '2026-10-31-ranked-duos-live-fixes.sql', '2026-11-01-ranked-duos-party.sql'])).toEqual({});
  });

  it('after 2026-11-01-versus-ready-signal.sql (the re-lock and un-ready in every mode) the order still holds', () => {
    expect(report([...ORDER, FIX, EGRESS, '2026-10-28-versus-health.sql', RANKED_DUOS, '2026-10-30-ranked-duos-client.sql',
      '2026-10-31-ranked-duos-live-fixes.sql', '2026-11-01-ranked-duos-party.sql', '2026-11-01-ranked-duos-sweep-cron.sql', '2026-11-01-versus-ready-signal.sql'])).toEqual({});
  });
});
