/**
 * VERSUS GROUP — the 3-4 player match seen through the 1v1 client (owner 2026-10-24, R-VERSUS-GROUP-01/03).
 *
 * The 1v1 client (versusStore, versusTurn, VersusHud, the reconnect catch-up, the end gate) is built around one
 * opponent per match. A group player also has exactly ONE opponent per round (another seat, or a Copy), so the group
 * match is PROJECTED onto the 1v1 row from the viewer's seat: `p1` is always the viewer, `p2` this round's opponent.
 * Everything that truly needs the table (the "Players ready N/M" pill, the pause panel's name, the rail) reads
 * `match.group`. Pure functions of the server rows; nothing here talks to the network.
 *
 * THE VIEWER'S END: a seat that goes out is, for that player, a finished match: the projection is `complete` at the
 * round they went out in (rounds after it are not shown), with `end_reason` from why (`hearts` → the deciding fight is
 * watched first, as in 1v1; leaving or conceding → the end gate at once). The match goes on for the others.
 */
import { duosDefaultFirst, duosMateOf, duosMemberView, duosTeamOf, versusGroupPairings, type VersusGroupPairing, type VersusGroupSeat } from '@game/sim';
import type { CombatResult } from '@game/core';
import type { VersusGroupMatchRaw, VersusGroupRoundRaw, VersusGroupSeatRow, VersusMatch, VersusRoundRow } from './versusRemote';

const seatsOf = (raw: VersusGroupMatchRaw): VersusGroupSeat[] => raw.seats.map((s) => s.seat);
const elimOf = (raw: VersusGroupMatchRaw): Partial<Record<VersusGroupSeat, number | null>> =>
  Object.fromEntries(raw.seats.map((s) => [s.seat, s.eliminatedRound]));

/** VERSUS DUOS (R-DUOS-01): this group-table match is a 2v2 Duos match. */
export const isDuosRaw = (raw: Pick<VersusGroupMatchRaw, 'options'> | null | undefined): boolean => raw?.options?.mode === 'duos';

/** A Duos round's fight order: the server's (`duos_first`, the current round only), else the default alternation. */
export function duosFirstAt(raw: VersusGroupMatchRaw, round: number): { a: VersusGroupSeat; b: VersusGroupSeat } {
  return round === raw.round && raw.duos_first ? raw.duos_first : duosDefaultFirst(Math.max(1, round));
}

/** The round's fights (the public schedule every client and the resolver share). Duos: the one team fight, named by
 *  each team's FIRST board (both teammates are in it; `fightOf` / `foeIn` know). */
export function groupPairingAt(raw: VersusGroupMatchRaw, round: number): VersusGroupPairing[] {
  if (round < 1) return [];
  if (isDuosRaw(raw)) { const f = duosFirstAt(raw, round); return [{ a: f.a, b: f.b, copy: false, duos: true }]; }
  return versusGroupPairings(seatsOf(raw), elimOf(raw), round);
}

/** `seat`'s fight in a pairing (as side a, or as a real side b; never the copied seat of a Copy fight). */
export function fightOf<T extends { a: VersusGroupSeat; b: VersusGroupSeat; copy: boolean; duos?: boolean }>(fights: readonly T[], seat: VersusGroupSeat): T | null {
  return fights.find((f) => f.a === seat || (f.b === seat && !f.copy))
    // Duos: a team's second board is in its team's fight too.
    ?? fights.find((f) => !!f.duos && (f.a === duosMateOf(seat) || f.b === duosMateOf(seat)))
    ?? null;
}

/** `seat`'s opponent in a pairing: the other seat, or the Copy of a seat. */
export function foeIn(pairing: readonly VersusGroupPairing[], seat: VersusGroupSeat): { seat: VersusGroupSeat; copy: boolean } | null {
  const f = fightOf(pairing, seat);
  if (!f) return null;
  // Duos: my foe is the OTHER team's first board, whether I fight first or step in.
  if (f.duos) return { seat: duosTeamOf(seat) === duosTeamOf(f.a) ? f.b : f.a, copy: false };
  return f.a === seat ? { seat: f.b, copy: f.copy } : { seat: f.a, copy: false };
}

/** The viewer's seat row (by user id). */
export const groupSeatOf = (raw: VersusGroupMatchRaw, userId: string | null): VersusGroupSeatRow | null =>
  (userId ? raw.seats.find((s) => s.userId === userId) : null) ?? null;

/** The "Copy of X" name the client shows for a copied seat. */
export const copyName = (name: string): string => `Copy of ${name}`;

/**
 * The 1v1-shaped row from `userId`'s seat (see the header). A spectator (no seat) gets p1 / p2 = the real seats 1 and
 * 2 and the table in `group`; nothing drives a run for it.
 */
export function projectGroupMatch(raw: VersusGroupMatchRaw, userId: string | null): VersusMatch {
  const meRow = groupSeatOf(raw, userId);
  const me = meRow?.seat ?? null;
  const out = me != null && meRow!.eliminatedRound != null;
  // A viewer who is out sees the match frozen at the round they went out in.
  const round = out ? Math.max(meRow!.eliminatedRound!, 0) : raw.round;
  const pairing = groupPairingAt(raw, Math.max(1, round));
  const foe = me ? foeIn(pairing, me) : null;
  const byseat = (s: VersusGroupSeat | null | undefined): VersusGroupSeatRow | null => (s ? raw.seats.find((x) => x.seat === s) ?? null : null);
  const p1 = me ? meRow! : byseat('p1');
  const p2 = me ? byseat(foe?.seat) : byseat('p2');
  const living = raw.seats.filter((s) => s.eliminatedRound == null);
  const counts = {
    locked: living.filter((s) => s.locked || s.auto).length,
    ready: living.filter((s) => s.ready || s.auto).length,
    intro: living.filter((s) => s.intro || s.auto).length,
    living: living.length,
  };
  const paused = byseat(raw.paused_seat);
  // The viewer's own end (out of the match) reads as a finished 1v1 match they lost; the table's end as itself.
  const phase = out ? 'complete' : raw.phase;
  const won = raw.phase === 'complete' && !!me && raw.winner_seat === me;
  const endReason = out
    ? (meRow!.outReason === 'hearts' ? 'hearts' : meRow!.outReason === 'missed' ? 'missed' : 'forfeit')
    : raw.end_reason;
  const p2Name = p2 ? (me && foe?.copy ? copyName(p2.name) : p2.name) : '';
  return {
    id: raw.id, room_id: raw.room_id, seed: raw.seed, set_id: raw.set_id, content_revision: raw.content_revision, protocol: raw.protocol,
    phase, revision: raw.revision, round,
    p1_user: p1?.userId ?? '', p2_user: p2 && !(me && foe?.copy) ? p2.userId : `copy:${p2?.userId ?? ''}`,
    p1_name: p1?.name ?? '', p2_name: p2Name,
    p1_hearts: p1?.hearts ?? 0, p2_hearts: p2?.hearts ?? 0,
    p1_hero: p1?.hero ?? null, p2_hero: p2?.hero ?? null,
    heroes_revealed: raw.heroes_revealed, hero_deadline: raw.hero_deadline, shop_starts_at: raw.shop_starts_at,
    shop_deadline: out ? null : raw.shop_deadline, combat_deadline: raw.combat_deadline,
    p1_locked: !!p1?.locked, p2_locked: !!p2?.locked, p1_ready: !!p1?.ready, p2_ready: !!p2?.ready,
    p1_intro: !!p1?.intro, p2_intro: !!p2?.intro, intro_deadline: raw.intro_deadline,
    // The pause is the table's: mine when I am the absent seat, else "the other side" (named in `group.pausedName`).
    paused_seat: !raw.paused_at || out ? null : raw.paused_seat === me ? 'p1' : 'p2',
    paused_at: out ? null : raw.paused_at, pause_grace_until: out ? null : raw.pause_grace_until, resume_at: out ? null : raw.resume_at,
    p1_auto: !!p1?.auto, p2_auto: !!p2?.auto, p1_missed: p1?.missed ?? 0, p2_missed: p2?.missed ?? 0,
    winner_seat: phase !== 'complete' ? null : won ? 'p1' : me ? 'p2' : raw.winner_seat === 'p1' ? 'p1' : raw.winner_seat ? 'p2' : null,
    end_reason: phase === 'complete' ? endReason : null,
    completed_at: out ? raw.completed_at ?? raw.serverNow ?? null : raw.completed_at,
    ...(raw.serverNow ? { serverNow: raw.serverNow } : {}),
    options: raw.options,
    group: {
      raw, me, foe, counts, pausedName: paused?.name ?? null, pausedUser: paused?.userId ?? null,
      ...(isDuosRaw(raw) ? { duos: { team: me ? duosTeamOf(me) : 'a', mate: me ? duosMateOf(me) : null, first: duosFirstAt(raw, Math.max(1, round)) } } : {}),
    },
  };
}

/** Each seat's OWN result in a round (its fight's side; a Copy is nobody's). */
export function resultsOf(r: VersusGroupRoundRaw): Partial<Record<VersusGroupSeat, CombatResult>> {
  const out: Partial<Record<VersusGroupSeat, CombatResult>> = {};
  // Duos: ONE team fight; each seat's own view carries only its board's carry-backs (`duosMemberView`).
  const d = r.fights[0];
  if (d && isDuosFight(d)) {
    for (const seat of ['p1', 'p2', 'p3', 'p4'] as const) {
      const teamA = duosTeamOf(seat) === 'a';
      out[seat] = duosMemberView(teamA ? d.a_result : d.b_result, (teamA ? d.a_seat : d.b_seat) === seat ? 0 : 1);
    }
    return out;
  }
  for (const f of r.fights) {
    out[f.a_seat] = f.a_result;
    if (!f.b_copy) out[f.b_seat] = f.b_result;
  }
  return out;
}

/**
 * The 1v1-shaped round rows from `userId`'s seat: p1_result = my fight from my side, p2_result = the same fight from my
 * opponent's (or the Copy's) side, hearts mine and theirs. Every row also carries every seat's own result (`results`,
 * for a spectator) and the raw round. A viewer who is out gets the rounds up to the one they went out in.
 */
export function projectGroupRounds(raw: VersusGroupMatchRaw, rounds: readonly VersusGroupRoundRaw[], userId: string | null): Record<number, VersusRoundRow> {
  const meRow = groupSeatOf(raw, userId);
  const me = meRow?.seat ?? null;
  const cutoff = meRow?.eliminatedRound ?? Infinity;
  const out: Record<number, VersusRoundRow> = {};
  for (const r of rounds) {
    if (r.round > cutoff) continue;
    const results = resultsOf(r);
    // VERSUS DUOS: the one team fight. p1 = me (my own board's view: `duosMemberView`), p2 = the other team's first
    // board's view; the outcome and the hearts are my team's.
    const d = r.fights[0];
    if (d && isDuosFight(d)) {
      const meSeat = me ?? d.a_seat;
      const iAmA = duosTeamOf(meSeat) === duosTeamOf(d.a_seat);
      const foeSeat = iAmA ? d.b_seat : d.a_seat;
      out[r.round] = {
        match_id: raw.id, round: r.round,
        chair: (d.chair === 'a') === iAmA ? 'p1' : 'p2',
        outcome: d.outcome === 'draw' ? 'draw' : (d.outcome === 'a') === iAmA ? 'p1' : 'p2',
        heart_lost_by: d.heart_lost_by == null ? null : duosTeamOf(d.heart_lost_by) === duosTeamOf(meSeat) ? 'p1' : 'p2',
        p1_result: results[meSeat] ?? null,
        p2_result: results[foeSeat] ?? null,
        digest: '',
        p1_hearts: r.hearts[meSeat] ?? 0,
        p2_hearts: r.hearts[foeSeat] ?? 0,
        p1_scout: iAmA ? d.a_scout : d.b_scout,
        p2_scout: iAmA ? d.b_scout : d.a_scout,
        results,
        group: r,
      };
      continue;
    }
    const mine = me ? r.fights.find((f) => f.a_seat === me || (f.b_seat === me && !f.b_copy)) ?? null : null;
    const f = mine ?? r.fights[0];
    if (!f) continue;
    const iAmA = !mine || mine.a_seat === me;
    const foeSeat = iAmA ? f.b_seat : f.a_seat;
    const meSeat = me ?? f.a_seat;
    const lost = f.heart_lost_by;
    const myOutcome = f.outcome === 'draw' ? 'draw' : (f.outcome === 'a') === iAmA ? 'p1' : 'p2';
    out[r.round] = {
      match_id: raw.id, round: r.round,
      chair: (f.chair === 'a') === iAmA ? 'p1' : 'p2',
      outcome: myOutcome,
      heart_lost_by: lost == null ? null : lost === meSeat ? 'p1' : 'p2',
      p1_result: iAmA ? f.a_result : f.b_result,
      p2_result: iAmA ? f.b_result : f.a_result,
      digest: '',
      p1_hearts: r.hearts[meSeat] ?? 0,
      p2_hearts: r.hearts[foeSeat] ?? 0,
      p1_scout: iAmA ? f.a_scout : f.b_scout,
      p2_scout: iAmA ? f.b_scout : f.a_scout,
      results,
      group: r,
    };
  }
  return out;
}

/** A seat's own result in a stored round row, 1v1 or group (`p1_result` / `p2_result` / `results`). */
export function roundResultFor(row: VersusRoundRow | undefined, seat: VersusGroupSeat): CombatResult | null {
  if (!row) return null;
  if (row.results) return row.results[seat] ?? null;
  return ((seat === 'p1' ? row.p1_result : seat === 'p2' ? row.p2_result : null) as CombatResult | null) ?? null;
}

/** A committed fight row is a Duos team fight (its result carries the order). */
export const isDuosFight = (f: { a_result: CombatResult }): boolean => !!f.a_result?.duosFirst;
