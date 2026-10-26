/**
 * VERSUS GROUP: the server's round finalization (the `versus-resolve` Edge Function's `finalize_group` action), a pure
 * handler over an injected store so Node tests drive exactly what Deno runs. The 1v1 twin is `finalize.ts`.
 *
 * 1. Read the match. Only a match in `resolving` at the requested round is finalized; anything else answers with the
 *    current phase (a late or duplicate caller is a client catching up, not an error).
 * 2. The deployed engine must be the one the match was created under (content revision), or it refuses.
 * 3. Read every seat's elimination round, stored Health and Armor (none yet = its hero's start) and FINAL side for the
 *    round, resolve EVERY fight of the round once (`resolveVersusGroupRound`: the pairing is derived from the seats,
 *    never from the request), charge each loser the lobby's capped damage (R-VERSUS-HEALTH-01), and commit through
 *    `versus_group_commit_round` (idempotent in SQL; the pools, knockouts, placements and the match end are applied
 *    there, under the row lock).
 *
 * Bundle-safe: imports only pure Versus siblings.
 */
import { canonicalDigest } from './canonical';
import { resolveVersusGroupRound, VERSUS_GROUP_SEATS, type VersusGroupEliminations, type VersusGroupRoundResult, type VersusGroupSeat } from './group';
import { storedVersusVitals, type VersusVitalsCommit } from './finalize';
import { reportedVitals, versusVitalsBefore, vitalsTotal, type VersusVitals } from './vitals';

export interface VersusGroupMatchRow {
  id: string;
  phase: string;
  round: number;
  seed: number | string;
  content_revision: string;
  /** The match's pinned options (a Duos match is a group-table match too: it is finalized by `finalize_duos`). */
  options?: { mode?: string; modifiers?: unknown } | null;
}

export interface VersusGroupSeatRow {
  seat: string;
  eliminated_round: number | null;
  /** The seat's hero (revealed before round 1) and its stored pools (null until round 1 commits). */
  hero?: string | null;
  health?: number | null;
  armor?: number | null;
}

export interface VersusGroupFinalizeStore {
  match(id: string): Promise<VersusGroupMatchRow | null>;
  seats(matchId: string): Promise<VersusGroupSeatRow[]>;
  /** Every seat's final prepared side for the round (absent / null = none stored). */
  finalSides(matchId: string, round: number): Promise<Partial<Record<VersusGroupSeat, unknown>>>;
  commit(args: { p_match: string; p_round: number; p_fights: unknown; p_digest: string; p_vitals: Partial<Record<VersusGroupSeat, VersusVitalsCommit>> }): Promise<unknown>;
  log(msg: string, detail?: unknown): void;
}

/** The commit payload for one fight (snake-free JSON the SQL reads with ->>). */
export function groupFightsPayload(out: VersusGroupRoundResult): unknown[] {
  return out.fights.map((f) => ({
    fight: f.fight, a: f.a, b: f.b, copy: f.copy, chair: f.chair, outcome: f.outcome, loser: f.loser, damage: f.damage,
    aResult: f.aResult, bResult: f.bResult,
  }));
}

/** The digest the commit stores and the parity proof compares (every fight, both perspectives, the pools). */
export function groupRoundDigest(out: VersusGroupRoundResult): string {
  return canonicalDigest({ round: out.round, fights: groupFightsPayload(out), ...(out.vitals ? { vitals: out.vitals } : {}) });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleVersusGroupFinalize(
  userId: string | null,
  body: Record<string, unknown>,
  engineContent: string,
  store: VersusGroupFinalizeStore,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!userId) return { status: 401, body: { error: 'not_signed_in' } };
  const matchId = body.matchId;
  const round = body.round;
  if (typeof matchId !== 'string' || !UUID.test(matchId)) return { status: 400, body: { error: 'bad_match' } };
  if (!Number.isInteger(round) || (round as number) < 1) return { status: 400, body: { error: 'bad_round' } };
  const m = await store.match(matchId);
  if (!m) return { status: 404, body: { error: 'no_match' } };
  if (m.options?.mode === 'duos') return { status: 400, body: { error: 'duos_match' } };
  if (m.phase !== 'resolving' || m.round !== round) return { status: 200, body: { status: 'not_resolving', phase: m.phase, round: m.round } };
  if (m.content_revision !== engineContent) {
    store.log('versus group finalize: engine content differs from the match', { match: m.content_revision, engine: engineContent });
    return { status: 409, body: { error: 'engine_mismatch', contentRevision: engineContent } };
  }
  const rows = await store.seats(matchId);
  const seats = rows.map((r) => r.seat).filter((s): s is VersusGroupSeat => (VERSUS_GROUP_SEATS as readonly string[]).includes(s));
  const eliminated: VersusGroupEliminations = {};
  for (const r of rows) if ((VERSUS_GROUP_SEATS as readonly string[]).includes(r.seat)) eliminated[r.seat as VersusGroupSeat] = r.eliminated_round;
  const sides = await store.finalSides(matchId, m.round);
  // Every seat still in fights on its stored pools (a fresh Mend report may raise its Armor); a ghost or a copy is never charged.
  const before: Partial<Record<VersusGroupSeat, VersusVitals>> = {};
  for (const r of rows) {
    if (!(VERSUS_GROUP_SEATS as readonly string[]).includes(r.seat) || r.eliminated_round != null) continue;
    const seat = r.seat as VersusGroupSeat;
    before[seat] = versusVitalsBefore(storedVersusVitals(r.health, r.armor, r.hero, m.options), [reportedVitals(sides[seat])]);
  }
  const out = resolveVersusGroupRound({ matchSeed: Number(m.seed), round: m.round, seats, eliminated, sides, vitals: before });
  for (const [seat, why] of Object.entries(out.refused)) store.log(`versus group finalize: ${seat} side refused, fighting empty`, why);
  const digest = groupRoundDigest(out);
  const vitals: Partial<Record<VersusGroupSeat, VersusVitalsCommit>> = {};
  for (const [seat, v] of Object.entries(out.vitals ?? {}) as [VersusGroupSeat, VersusVitals][]) {
    const hit = out.fights.find((f) => f.loser === seat);
    vitals[seat] = { ...v, damage: hit ? hit.damage : 0, before: vitalsTotal(before[seat]!) };
  }
  const committed = await store.commit({ p_match: matchId, p_round: m.round, p_fights: groupFightsPayload(out), p_digest: digest, p_vitals: vitals });
  return {
    status: 200,
    body: { status: 'committed', round: m.round, fights: out.fights.map((f) => ({ a: f.a, b: f.b, copy: f.copy, outcome: f.outcome })), digest, committed },
  };
}
