/**
 * VERSUS DUOS: the server's round finalization (the `versus-resolve` Edge Function's `finalize_duos` action), a pure
 * handler over an injected store so Node tests drive exactly what Deno runs. The group twin is `groupFinalize.ts`.
 *
 * 1. Read the match. Only a match in `resolving` at the requested round is finalized; anything else answers with the
 *    current phase (a late or duplicate caller is a client catching up, not an error).
 * 2. The deployed engine must be the one the match was created under (content revision), or it refuses.
 * 3. Read every seat's FINAL side, resolve the round's ONE tag-team fight in the alternating fight order
 *    (`duosAlternatingFirst` from the match seed + round, R-DUOS-ORDER-01; no player input) (`resolveVersusDuosRound`), charge
 *    the losing team's shared pool the lobby's capped damage (R-DUOS-HEALTH-01: stored, else 30 Health + both heroes'
 *    Armor), and commit through `versus_duos_commit_round` (idempotent in SQL; the pools, the knockout and the match end
 *    are applied there, under the row lock).
 *
 * Bundle-safe: imports only pure Versus siblings.
 */
import { canonicalDigest } from './canonical';
import { duosTeamSeats, resolveVersusDuosRound, resolveVersusDuosTable, type VersusDuosEliminations, type VersusDuosRoundResult, type VersusDuosTableResult, type VersusDuosTeam, type VersusDuosTeamId } from './duos';
import type { VersusVitalsCommit } from './finalize';
import type { VersusGroupSeat } from './group';
import { reportedVitals, versusDuosStartingVitals, versusVitalsBefore, vitalsTotal, type VersusVitals } from './vitals';

export interface VersusDuosMatchRow {
  id: string;
  phase: string;
  round: number;
  seed: number | string;
  content_revision: string;
  options?: { mode?: string; modifiers?: unknown } | null;
}

/** A team's stored pool (null until round 1 commits). */
export interface VersusDuosTeamRow {
  team: string;
  health?: number | null;
  armor?: number | null;
  eliminated_round?: number | null;
}

export interface VersusDuosFinalizeStore {
  match(id: string): Promise<VersusDuosMatchRow | null>;
  /** Every seat's final prepared side for the round (absent / null = none stored). */
  finalSides(matchId: string, round: number): Promise<Partial<Record<VersusGroupSeat, unknown>>>;
  /** Every seat's hero (a team's starting pool reads both). */
  seats(matchId: string): Promise<{ seat: string; hero?: string | null }[]>;
  /** Every team's stored pool. */
  teams(matchId: string): Promise<VersusDuosTeamRow[]>;
  commit(args: { p_match: string; p_round: number; p_fight?: unknown; p_fights?: unknown; p_digest: string; p_vitals: Partial<Record<VersusDuosTeamId, VersusVitalsCommit>> }): Promise<unknown>;
  log(msg: string, detail?: unknown): void;
}

/** The commit payload (snake-free JSON the SQL reads with ->>). */
export function duosFightPayload(out: VersusDuosRoundResult): Record<string, unknown> {
  return {
    a: out.first.a, b: out.first.b, chair: out.chair, outcome: out.outcome, losingTeam: out.losingTeam,
    damage: out.damage, aResult: out.aResult, bResult: out.bResult,
  };
}

/** The digest the commit stores and the parity proof compares (the fight, both team perspectives, the pools). */
export function duosRoundDigest(out: VersusDuosRoundResult): string {
  return canonicalDigest({ round: out.round, fight: duosFightPayload(out), ...(out.vitals ? { vitals: out.vitals } : {}) });
}

/** The digest of a 3-4 team round (R-VERSUS-EIGHT-01): every fight, both perspectives, the pools. */
export function duosTableDigest(out: VersusDuosTableResult): string {
  return canonicalDigest({ round: out.round, fights: out.fights, ...(out.vitals ? { vitals: out.vitals } : {}) });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleVersusDuosFinalize(
  userId: string | null,
  body: Record<string, unknown>,
  engineContent: string,
  store: VersusDuosFinalizeStore,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!userId) return { status: 401, body: { error: 'not_signed_in' } };
  const matchId = body.matchId;
  const round = body.round;
  if (typeof matchId !== 'string' || !UUID.test(matchId)) return { status: 400, body: { error: 'bad_match' } };
  if (!Number.isInteger(round) || (round as number) < 1) return { status: 400, body: { error: 'bad_round' } };
  const m = await store.match(matchId);
  if (!m) return { status: 404, body: { error: 'no_match' } };
  if (m.options && m.options.mode !== 'duos') return { status: 400, body: { error: 'not_duos' } };
  if (m.phase !== 'resolving' || m.round !== round) return { status: 200, body: { status: 'not_resolving', phase: m.phase, round: m.round } };
  if (m.content_revision !== engineContent) {
    store.log('versus duos finalize: engine content differs from the match', { match: m.content_revision, engine: engineContent });
    return { status: 409, body: { error: 'engine_mismatch', contentRevision: engineContent } };
  }
  const sides = await store.finalSides(matchId, m.round);
  const [seatRows, teamRows] = await Promise.all([store.seats(matchId), store.teams(matchId)]);
  const heroOf = (seat: VersusGroupSeat): string | null => seatRows.find((r) => r.seat === seat)?.hero ?? null;
  // Each team fights on its stored shared pool (none yet = 30 Health + both heroes' Armor); a fresh Mend report from
  // either teammate may raise its Armor.
  const teams = (teamRows.length > 2 ? teamRows.map((r) => r.team) : ['a', 'b']) as VersusDuosTeamId[];
  const before: Partial<Record<VersusDuosTeamId, VersusVitals>> = {};
  for (const t of teams) {
    const [x, y] = duosTeamSeats(t);
    const row = teamRows.find((r) => r.team === t);
    const stored = row && row.health != null && row.armor != null
      ? { health: Number(row.health), armor: Number(row.armor) }
      : versusDuosStartingVitals(heroOf(x), heroOf(y), m.options);
    before[t] = versusVitalsBefore(stored, [reportedVitals(sides[x]), reportedVitals(sides[y])]);
  }
  // THREE OR FOUR TEAMS (R-VERSUS-EIGHT-01): the round's fights over the teams still in. Only their pools move.
  if (teams.length > 2) {
    const eliminated: VersusDuosEliminations = {};
    for (const r of teamRows) eliminated[r.team as VersusDuosTeamId] = r.eliminated_round ?? null;
    const live = Object.fromEntries(teams.filter((t) => eliminated[t] == null).map((t) => [t, before[t]!]));
    const table = resolveVersusDuosTable({ matchSeed: Number(m.seed), round: m.round, teams, eliminated, sides, vitals: live });
    for (const [seat, why] of Object.entries(table.refused)) store.log(`versus duos finalize: ${seat} side refused, fighting empty`, why);
    const tableDigest = duosTableDigest(table);
    const commitVitals: Partial<Record<VersusDuosTeamId, VersusVitalsCommit>> = {};
    for (const t of teams) {
      const v = table.vitals?.[t];
      if (v) commitVitals[t] = { ...v, damage: table.fights.find((f) => f.losingTeam === t)?.damage ?? 0, before: vitalsTotal(before[t]!) };
    }
    const done = await store.commit({ p_match: matchId, p_round: m.round, p_fights: table.fights, p_digest: tableDigest, p_vitals: commitVitals });
    return { status: 200, body: { status: 'committed', round: m.round, digest: tableDigest, committed: done } };
  }
  const out = resolveVersusDuosRound({ matchSeed: Number(m.seed), round: m.round, sides, vitals: before });
  for (const [seat, why] of Object.entries(out.refused)) store.log(`versus duos finalize: ${seat} side refused, fighting empty`, why);
  const digest = duosRoundDigest(out);
  const vitals: Partial<Record<VersusDuosTeamId, VersusVitalsCommit>> = {};
  for (const t of ['a', 'b'] as const) {
    const v = out.vitals?.[t];
    if (v) vitals[t] = { ...v, damage: out.losingTeam === t ? out.damage : 0, before: vitalsTotal(before[t]!) };
  }
  const committed = await store.commit({ p_match: matchId, p_round: m.round, p_fight: duosFightPayload(out), p_digest: digest, p_vitals: vitals });
  return {
    status: 200,
    body: { status: 'committed', round: m.round, first: out.first, outcome: out.outcome, damage: out.damage, digest, committed },
  };
}
