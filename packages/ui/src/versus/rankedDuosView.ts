/**
 * RANKED DUOS, the client's view of the table (owner design 2026-10-26; docs/design/2026-10-26-ranked-duos.md). Pure.
 *
 * A Ranked Duos match is a group match with two REAL seats (p1 + p2, team `a`) and three recorded teams the server seats
 * (`b`, `c`, `d`). The client reuses the whole Versus Duos client (the tag-team fight playback, the member views, the
 * teammate view, passing) by seating every recorded member VIRTUALLY at a stable seat by its team letter (b = p3 / p4,
 * c = p5 / p6, d = p7 / p8, `rankedDuosSeatOf`), exactly as the resolver stamps them on the live fight. So:
 *  - `withServedSeats` extends the match row with those virtual seats (name, hero, the team pool, placement) and with
 *    THIS round's opponent (`rankedFoe`): the lobby's own pairing over teams (`pairRankedDuosTeams`), the same pure
 *    function the resolver runs, so the client knows its opponent while it shops, as in a solo lobby.
 *  - `rankedRoundsAsGroup` turns the committed rounds into the Duos round shape: the live team's fight (in full) first,
 *    the other pairing as a result only (owner Q11: you never watch it), every team's pool on its seats.
 *  - `rankedCloseAtMs`: when the round's shop closes (the end-turn gate), from the server's answer or the seat rows.
 */
import { defaultTeamName, duosMateOf, mirrorForEnemySeat, pairRankedDuosTeams, rankedDuosCloseAt, rankedDuosFirstOf, rankedDuosSeatOf, versusDuosStartingVitals, type RankedDuosEncounter, type VersusGroupSeat } from '@game/sim';
import type { CombatResult } from '@game/core';
import type { RankedDuosRoundRow, RankedDuosTableRaw, RankedDuosTeamRead, VersusGroupFightRow, VersusGroupMatchRaw, VersusGroupRoundRaw, VersusGroupSeatRow } from './versusRemote';

/** This group-table match is a Ranked Duos match. */
export const isRankedDuosRaw = (raw: Pick<VersusGroupMatchRaw, 'options'> | null | undefined): boolean => raw?.options?.mode === 'ranked_duos';

/** The number of teams a Ranked Duos table holds (places 1st to 4th). */
export const RANKED_DUOS_TEAM_COUNT = 4;

const seatOf = (team: string, member: 0 | 1): VersusGroupSeat => rankedDuosSeatOf(team, member) as VersusGroupSeat;
const teamOfSeat = (seat: string): string => String.fromCharCode(97 + Math.floor((Number(seat.slice(1)) - 1) / 2));

/** What the client knows about the recorded teams (one table read per shop + the team rows). */
export interface RankedDuosContext {
  table: RankedDuosTableRaw | null;
  teams: readonly RankedDuosTeamRead[];
  /** Every committed round's fights so far (the meetings that drive the pairing). */
  rounds: readonly RankedDuosRoundRow[];
}

/** This round's opponent of the live team, as the resolver will pair it. */
export interface RankedFoe {
  round: number;
  team: string;
  /** The seat of the opponent's board that fights first. */
  seat: VersusGroupSeat;
  ghost: boolean;
}

/** The meetings so far, in the resolver's shape (a ghost fight is a bye). */
export function rankedHistory(rounds: readonly RankedDuosRoundRow[]): RankedDuosEncounter[] {
  const out: RankedDuosEncounter[] = [];
  for (const r of rounds) for (const f of r.fights) out.push({ round: f.round, a: f.a_team, b: f.b_team, ...(f.ghost ? { bye: f.a_team } : {}) });
  return out;
}

/** The live team's opponent in `round` (the lobby's pairing over teams; the bye's ghost), or null before the table is known. */
export function rankedFoeAt(raw: VersusGroupMatchRaw, ctx: RankedDuosContext, round: number): RankedFoe | null {
  if (!ctx.table || !ctx.teams.length || round < 1) return null;
  const heroesOf = (team: string): [string | null, string | null] => {
    if (team === 'a') return [raw.seats.find((s) => s.seat === 'p1')?.hero ?? null, raw.seats.find((s) => s.seat === 'p2')?.hero ?? null];
    const m = ctx.table!.served.filter((s) => s.team === team);
    return [m.find((s) => s.member === 0)?.hero ?? null, m.find((s) => s.member === 1)?.hero ?? null];
  };
  const totalOf = (t: RankedDuosTeamRead): number => {
    if (t.health != null && t.armor != null) return t.health + t.armor;
    const [h0, h1] = heroesOf(t.team);
    const v = versusDuosStartingVitals(h0, h1);
    return v.health + v.armor;
  };
  const alive = ctx.teams.filter((t) => t.eliminated_round == null || t.eliminated_round >= round).sort((x, y) => x.team.localeCompare(y.team));
  const fallen = ctx.teams.filter((t) => t.eliminated_round != null && t.eliminated_round < round).map((t) => ({ team: t.team, eliminatedRound: t.eliminated_round! }));
  const history = rankedHistory(ctx.rounds).filter((e) => e.round < round);
  const pairing = pairRankedDuosTeams({ seed: Number(raw.seed) | 0, round, alive: alive.map((t) => ({ team: t.team, total: totalOf(t) })), history, fallen });
  const pair = pairing.pairs.find(([x, y]) => x === 'a' || y === 'a');
  const ghost = !pair && pairing.bye === 'a' && !!pairing.ghost;
  const team = pair ? (pair[0] === 'a' ? pair[1] : pair[0]) : ghost ? pairing.ghost! : null;
  if (!team) return null;
  const at = ghost ? fallen.find((f) => f.team === team)!.eliminatedRound : round;
  const order = ctx.table.orders?.[team];
  const first = rankedDuosFirstOf(team, order === 0 || order === 1 ? order : null, Number(raw.seed) | 0, at);
  return { round, team, seat: seatOf(team, first), ghost };
}

/**
 * The match row with the recorded teams seated (virtual p3..p8, marked `served`) and this round's opponent pinned
 * (`rankedFoe`). The two real seats keep everything they had. Pure; returns `raw` itself when nothing is known yet.
 */
export function withServedSeats(raw: VersusGroupMatchRaw, ctx: RankedDuosContext): VersusGroupMatchRaw & { rankedFoe?: RankedFoe | null } {
  if (!isRankedDuosRaw(raw) || !ctx.table) return raw;
  const real = raw.seats.filter((s) => !s.served);
  const served: VersusGroupSeatRow[] = ctx.table.served.map((s) => {
    const t = ctx.teams.find((x) => x.team === s.team);
    return {
      seat: seatOf(s.team, s.member), userId: `served:${s.team}${s.member}`, name: s.name,
      health: t?.health ?? null, armor: t?.armor ?? null, hero: s.hero,
      locked: true, ready: true, intro: true, auto: false, missed: 0,
      eliminatedRound: t?.eliminated_round ?? null, outReason: t?.eliminated_round != null ? 'hearts' : null,
      placement: t?.placement ?? null, served: true, team: s.team,
    };
  });
  // The live pair's own pool and place ride its team row too (the seats mirror it once a round has been committed).
  const live = ctx.teams.find((t) => t.team === 'a');
  const realSeats = real.map((s) => ({ ...s, team: 'a', ...(live?.placement != null && s.placement == null ? { placement: live.placement } : {}) }));
  const round = Math.max(1, raw.round);
  return { ...raw, seats: [...realSeats, ...served], rankedFoe: rankedFoeAt(raw, ctx, round), servedTeamNames: ctx.table.teamNames ?? {} };
}

/** A minimal result for a fight the client never watches (owner Q11): who won and the damage, nothing to play. */
function resultOnly(outcome: 'a' | 'b' | 'draw', aLost: number, bLost: number): CombatResult {
  return {
    result: outcome === 'draw' ? 'draw' : outcome === 'a' ? 'win' : 'lose',
    initial: { player: [], enemy: [] }, events: [], playerDamage: aLost, enemyDamage: bLost,
  } as unknown as CombatResult;
}

/** The committed rounds in the Versus Duos shape, from the live team's side (see the header). Pure. */
export function rankedRoundsAsGroup(rows: readonly RankedDuosRoundRow[]): VersusGroupRoundRaw[] {
  const out: VersusGroupRoundRaw[] = [];
  for (const r of rows) {
    const live = r.fights.find((f) => f.live_result);
    if (!live?.live_result?.duosFirst) continue;
    const res = live.live_result;
    const first = res.duosFirst!;
    const liveIsA = live.a_team === 'a';
    const foeTeam = liveIsA ? live.b_team : live.a_team;
    const flip = (x: 'a' | 'b'): 'a' | 'b' => ((x === 'a') === liveIsA ? 'a' : 'b');
    const fights: VersusGroupFightRow[] = [{
      round: r.round, fight: 0, a_seat: first.a, b_seat: first.b as VersusGroupSeat, b_copy: false,
      chair: flip(live.chair), outcome: live.outcome === 'draw' ? 'draw' : flip(live.outcome),
      heart_lost_by: live.loser === 'a' ? first.a : live.loser === foeTeam ? first.b as VersusGroupSeat : null,
      damage: live.damage, a_result: res, b_result: mirrorForEnemySeat(res), a_scout: null, b_scout: null,
    }];
    for (const f of r.fights) {
      if (f === live) continue;
      const fa = seatOf(f.a_team, f.first?.[f.a_team] ?? 0);
      const fb = seatOf(f.b_team, f.first?.[f.b_team] ?? 0);
      fights.push({
        round: r.round, fight: fights.length, a_seat: fa, b_seat: fb, b_copy: false, chair: f.chair, outcome: f.outcome,
        heart_lost_by: f.loser === f.a_team ? fa : f.loser === f.b_team ? fb : null, damage: f.damage,
        a_result: resultOnly(f.outcome, f.loser === f.a_team ? f.damage : 0, f.loser === f.b_team ? f.damage : 0),
        b_result: resultOnly(f.outcome === 'draw' ? 'draw' : f.outcome === 'a' ? 'b' : 'a', f.loser === f.b_team ? f.damage : 0, f.loser === f.a_team ? f.damage : 0),
        a_scout: null, b_scout: null,
      });
    }
    const vitals: VersusGroupRoundRaw['vitals'] = {};
    for (const [team, v] of Object.entries(r.vitals ?? {})) {
      for (const m of [0, 1] as const) (vitals as Record<string, { health: number; armor: number }>)[seatOf(team, m)] = { health: v.health, armor: v.armor };
    }
    out.push({ round: r.round, vitals, eliminated: [], fights });
  }
  return out;
}

/** When the round's shop closes (epoch ms, server time), or null while nothing closes it yet: the server's own answer
 *  when the row carries it, else the gate rule over the seat rows (`rankedDuosCloseAt`). */
export function rankedCloseAtMs(raw: VersusGroupMatchRaw): number | null {
  if (raw.phase !== 'shop') return null;
  if (raw.closeAt) return Date.parse(raw.closeAt);
  const deadline = raw.shop_deadline ? Date.parse(raw.shop_deadline) : null;
  const live = raw.seats.filter((s) => !s.served && s.eliminatedRound == null);
  const ended = live.map((s) => {
    const iso = raw.endedAt?.[s.seat] ?? (s.locked ? s.lockedAt : null) ?? (s.auto ? s.autoSince : null) ?? s.leftAt ?? raw.leftAt?.[s.seat] ?? null;
    if (iso) return Date.parse(iso);
    return s.locked || s.auto || s.leftAt || raw.leftAt?.[s.seat] ? (deadline ?? 0) : null;
  });
  return rankedDuosCloseAt({ deadline, ended });
}

/** Has anyone on the live team ended this round (the 5 s window counts down only then)? */
export function rankedSomeoneEnded(raw: VersusGroupMatchRaw): boolean {
  return raw.seats.some((s) => !s.served && s.eliminatedRound == null && (s.locked || s.auto || !!s.leftAt || !!raw.leftAt?.[s.seat]));
}

/** The teammate of a live seat (p1 <-> p2). */
export const rankedMateOf = (seat: VersusGroupSeat): VersusGroupSeat => duosMateOf(seat);

/** A virtual seat's team letter. */
export const rankedTeamOfSeat = teamOfSeat;

/** `rankedCloseAtMs` as the ISO time the store's deadline checks read (null = nothing closes the shop yet). */
export function rankedCloseIso(raw: VersusGroupMatchRaw): string | null {
  const ms = rankedCloseAtMs(raw);
  return ms == null || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
}

/**
 * Each team's name as the rail shows it (owner 2026-10-26: "shown on the rail"), keyed by the rail id of the team's
 * FIRST row: the pair's own name (my team: the match's `teamName`; a recorded duo run: its pair's name), else the default
 * "Name1 & Name2". The rail ids follow `duosLobbySeatId` (s0 + s1 = my team, then s2 + s3, s4 + s5, s6 + s7).
 */
export function rankedTeamLabels(raw: VersusGroupMatchRaw, viewer: VersusGroupSeat, names: Readonly<Record<string, string>> = {}): Record<string, string> {
  const mate = duosMateOf(viewer);
  const others = raw.seats.map((x) => x.seat).filter((x) => x !== viewer).sort().sort((x, y) => (x === mate ? -1 : y === mate ? 1 : 0));
  const idOf = (seat: string): string => (seat === viewer ? 's0' : `s${others.indexOf(seat as VersusGroupSeat) + 1}`);
  const out: Record<string, string> = {};
  const byTeam = new Map<string, VersusGroupSeatRow[]>();
  for (const s of raw.seats) {
    const t = s.served ? (s.team ?? teamOfSeat(s.seat)) : 'a';
    byTeam.set(t, [...(byTeam.get(t) ?? []), s]);
  }
  for (const [team, seats] of byTeam) {
    const sorted = [...seats].sort((x, y) => x.seat.localeCompare(y.seat));
    const own = team === 'a' ? raw.teamName : names[team];
    const label = own || defaultTeamName(sorted[0]?.name ?? '', sorted[1]?.name ?? '');
    const ids = sorted.map((s) => idOf(s.seat)).sort();
    if (ids[0]) out[ids[0]] = label;
  }
  return out;
}
