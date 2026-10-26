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
import { duosMateOf, duosMemberView, duosTeamOf, versusGroupPairings, duosRandomFirst, type VersusGroupPairing, type VersusGroupSeat } from '@game/sim';
import type { CombatEvent, CombatResult } from '@game/core';
import { isRankedDuosRaw } from './rankedDuosView';
import type { VersusGroupMatchRaw, VersusGroupRoundRaw, VersusGroupSeatRow, VersusMatch, VersusRoundRow } from './versusRemote';

const seatsOf = (raw: VersusGroupMatchRaw): VersusGroupSeat[] => raw.seats.map((s) => s.seat);
const elimOf = (raw: VersusGroupMatchRaw): Partial<Record<VersusGroupSeat, number | null>> =>
  Object.fromEntries(raw.seats.map((s) => [s.seat, s.eliminatedRound]));

/** VERSUS DUOS (R-DUOS-01): this group-table match is played as Duos (a 2v2 room, or RANKED DUOS: the live pair against
 *  recorded teams seated virtually, `rankedDuosView.ts`). */
export const isDuosRaw = (raw: Pick<VersusGroupMatchRaw, 'options'> | null | undefined): boolean =>
  raw?.options?.mode === 'duos' || isRankedDuosRaw(raw);

/** RANKED DUOS: this round's opponent, as `withServedSeats` pinned it on the row. */
const rankedFoeOf = (raw: VersusGroupMatchRaw, round: number): { seat: VersusGroupSeat } | null => {
  const f = (raw as { rankedFoe?: { round: number; seat: VersusGroupSeat } | null }).rankedFoe;
  return f && f.round === round ? f : null;
};

/** A Duos round's fight order: the seeded 50/50 pick from the match seed + round (R-DUOS-ORDER-01), the same one the
 *  resolver fights (a committed fight's result carries the order it actually used, after an empty-board hand-over). */
export function duosFirstAt(raw: VersusGroupMatchRaw, round: number): { a: VersusGroupSeat; b: VersusGroupSeat } {
  const f = duosRandomFirst(Number(raw.seed), Math.max(1, round));
  // RANKED DUOS: the opponent is the round's recorded team (its board that fights first), by the lobby pairing.
  if (isRankedDuosRaw(raw)) return { a: f.a, b: rankedFoeOf(raw, Math.max(1, round))?.seat ?? f.b };
  return { a: f.a, b: f.b };
}

/** The round's fights (the public schedule every client and the resolver share). Duos: the one team fight, named by
 *  each team's FIRST board (both teammates are in it; `fightOf` / `foeIn` know). */
export function groupPairingAt(raw: VersusGroupMatchRaw, round: number): VersusGroupPairing[] {
  if (round < 1) return [];
  if (isRankedDuosRaw(raw) && !rankedFoeOf(raw, round)) return []; // the recorded table is not known yet
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
  // The pill counts the PLAYERS still in (a Ranked Duos recorded member is never waited on).
  const living = raw.seats.filter((s) => s.eliminatedRound == null && !s.served);
  const counts = {
    locked: living.filter((s) => s.locked || s.auto).length,
    ready: living.filter((s) => s.ready || s.auto).length,
    intro: living.filter((s) => s.intro || s.auto).length,
    living: living.length,
  };
  const paused = byseat(raw.paused_seat);
  // The viewer's own end (out of the match) reads as a finished 1v1 match they lost; the table's end as itself.
  const phase = out ? 'complete' : raw.phase;
  // Duos: placement is by team, so my teammate's win is mine (R-DUOS-01).
  const won = raw.phase === 'complete' && !!me && !!raw.winner_seat
    && (raw.winner_seat === me || (isDuosRaw(raw) && duosTeamOf(raw.winner_seat) === duosTeamOf(me)));
  const endReason = out
    ? (meRow!.outReason === 'hearts' ? 'hearts' : meRow!.outReason === 'missed' ? 'missed' : 'forfeit')
    : raw.end_reason;
  const p2Name = p2 ? (me && foe?.copy ? copyName(p2.name) : p2.name) : '';
  return {
    id: raw.id, room_id: raw.room_id, seed: raw.seed, set_id: raw.set_id, content_revision: raw.content_revision, protocol: raw.protocol,
    phase, revision: raw.revision, round,
    p1_user: p1?.userId ?? '', p2_user: p2 && !(me && foe?.copy) ? p2.userId : `copy:${p2?.userId ?? ''}`,
    p1_name: p1?.name ?? '', p2_name: p2Name,
    p1_health: p1?.health ?? null, p1_armor: p1?.armor ?? null, p2_health: p2?.health ?? null, p2_armor: p2?.armor ?? null,
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

/** The 1v1 row's pools from my side: my seat's and my opponent's after the round, and the damage the loser took. */
function poolsOf(r: VersusGroupRoundRaw, meSeat: VersusGroupSeat, foeSeat: VersusGroupSeat, loser: 'p1' | 'p2' | null, damage: number | null | undefined) {
  const mine = r.vitals?.[meSeat];
  const theirs = r.vitals?.[foeSeat];
  return {
    p1_health: mine?.health ?? null, p1_armor: mine?.armor ?? null, p2_health: theirs?.health ?? null, p2_armor: theirs?.armor ?? null,
    p1_damage: loser === 'p1' ? damage ?? null : 0, p2_damage: loser === 'p2' ? damage ?? null : 0,
  };
}

/** Each seat's OWN result in a round (its fight's side; a Copy is nobody's). */
export function resultsOf(r: VersusGroupRoundRaw): Partial<Record<VersusGroupSeat, CombatResult>> {
  const out: Partial<Record<VersusGroupSeat, CombatResult>> = {};
  // Duos: ONE team fight; each seat's own view carries only its board's carry-backs (`duosMemberView`).
  const d = r.fights[0];
  if (d && isDuosFight(d)) {
    // Both teams of the fight (Ranked Duos: the recorded team sits at its virtual seats, `rankedDuosView.ts`).
    for (const seat of [d.a_seat, duosMateOf(d.a_seat), d.b_seat, duosMateOf(d.b_seat)]) {
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
 * opponent's (or the Copy's) side, pools mine and theirs. Every row also carries every seat's own result (`results`,
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
    // board's view; the outcome, the damage and the pool are my team's.
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
        ...poolsOf(r, meSeat, foeSeat, d.heart_lost_by == null ? null : duosTeamOf(d.heart_lost_by) === duosTeamOf(meSeat) ? 'p1' : 'p2', d.damage),
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
      ...poolsOf(r, meSeat, foeSeat, lost == null ? null : lost === meSeat ? 'p1' : 'p2', f.damage),
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

/** The rail's seat id for `seat` as seen from `viewer` (`versusGroupLobby`'s order: s0 = the viewer, then the others in
 *  seat order; in Duos the teammate first). */
export function duosLobbySeatId(raw: VersusGroupMatchRaw, viewer: VersusGroupSeat, seat: VersusGroupSeat): string | null {
  if (seat === viewer) return 's0';
  const mate = isDuosRaw(raw) ? duosMateOf(viewer) : null;
  const others = raw.seats.map((x) => x.seat).filter((x) => x !== viewer).sort()
    .sort((x, y) => (x === mate ? -1 : y === mate ? 1 : 0));
  const i = others.indexOf(seat);
  return i < 0 ? null : `s${i + 1}`;
}

/** VERSUS DUOS RAIL (R-DUOS-VIEW-01, lead ruling 2026-10-25): team rows stay together. The rail's ranked order picks
 *  which TEAM comes first; inside a team the rows keep their ranked order. Teams are the seat pairs `s0`+`s1` (you and
 *  your teammate, `duosLobbySeatId`) and `s2`+`s3`. Pure: the same rows, regrouped. */
export function groupDuosRailRows<R extends { id: string }>(rows: readonly R[]): R[] {
  // Teams are seat pairs: s0+s1, s2+s3, and in Ranked Duos s4+s5 and s6+s7 (four teams of two).
  const team = (id: string): number => { const n = Number(id.slice(1)); return Number.isFinite(n) ? Math.floor(n / 2) : 99; };
  const first = new Map<number, number>();
  rows.forEach((r, i) => { const t = team(r.id); if (!first.has(t)) first.set(t, i); });
  return rows.map((r, i) => ({ r, i })).sort((a, b) => (first.get(team(a.r.id))! - first.get(team(b.r.id))!) || a.i - b.i).map((x) => x.r);
}

/** The seat whose board fights on `side` (`tagged` = after that side's hand-off), from the viewer's seat. */
function duosActiveSeat(result: CombatResult, viewer: VersusGroupSeat, side: 'player' | 'enemy', tagged: boolean): VersusGroupSeat | null {
  const first = result.duosFirst;
  if (!first) return null;
  const mine = duosTeamOf(viewer);
  const team = side === 'player' ? mine : mine === 'a' ? 'b' : 'a';
  const head = first[team as 'a' | 'b'] as VersusGroupSeat;
  return tagged ? duosMateOf(head) : head;
}

/** WHO IS FIGHTING NOW in a Duos replay (R-DUOS-TAGTEAM-01, R-SYMMETRY-01), after the first `end` events: the rail
 *  seat id of the board on each side when it is not the default (`foeSeatId`: the other team's second board once it
 *  stepped in; `selfSeatId`: my TEAMMATE's board while it fights on my side), and the latest hand-off for the plate.
 *  Both sides by one rule, so my hero slot follows my side's board exactly as the foe's slot follows theirs. Pure. */
export interface DuosCombatNow {
  foeSeatId: string | null;
  selfSeatId: string | null;
  tag: { side: 'player' | 'enemy'; seat: VersusGroupSeat; at: number; kind: 'in' | 'first' } | null;
}
export function duosCombatAt(combat: CombatResult, raw: VersusGroupMatchRaw, viewer: VersusGroupSeat, events: readonly CombatEvent[], end: number): DuosCombatNow {
  const tagged = { player: false, enemy: false };
  let tag: DuosCombatNow['tag'] = null;
  for (let i = 0; i < Math.min(end, events.length); i++) {
    const e = events[i];
    if (e?.type !== 'tagIn') continue;
    tagged[e.side] = true;
    const s = duosActiveSeat(combat, viewer, e.side, true);
    if (s) tag = { side: e.side, seat: s, at: i, kind: 'in' };
  }
  const mine = duosActiveSeat(combat, viewer, 'player', tagged.player);
  // The fight opens with my TEAMMATE's board: say so on my side.
  if (!tag) {
    const lead = duosActiveSeat(combat, viewer, 'player', false);
    if (lead && lead !== viewer) tag = { side: 'player', seat: lead, at: -1, kind: 'first' };
  }
  const foe = tagged.enemy ? duosActiveSeat(combat, viewer, 'enemy', true) : null;
  return {
    foeSeatId: foe ? duosLobbySeatId(raw, viewer, foe) : null,
    selfSeatId: mine && mine !== viewer ? duosLobbySeatId(raw, viewer, mine) : null,
    tag,
  };
}
