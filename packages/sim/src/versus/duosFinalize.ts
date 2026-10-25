/**
 * VERSUS DUOS: the server's round finalization (the `versus-resolve` Edge Function's `finalize_duos` action), a pure
 * handler over an injected store so Node tests drive exactly what Deno runs. The group twin is `groupFinalize.ts`.
 *
 * 1. Read the match. Only a match in `resolving` at the requested round is finalized; anything else answers with the
 *    current phase (a late or duplicate caller is a client catching up, not an error).
 * 2. The deployed engine must be the one the match was created under (content revision), or it refuses.
 * 3. Read every seat's FINAL side, resolve the round's ONE tag-team fight in the seeded 50/50 fight order
 *    (`duosRandomFirst` from the match seed + round, R-DUOS-ORDER-01; no player input) (`resolveVersusDuosRound`) and commit through `versus_duos_commit_round` (idempotent in SQL;
 *    team hearts, the knockout and the match end are applied there, under the row lock).
 *
 * Bundle-safe: imports only pure Versus siblings.
 */
import { canonicalDigest } from './canonical';
import { resolveVersusDuosRound, type VersusDuosRoundResult } from './duos';
import type { VersusGroupSeat } from './group';

export interface VersusDuosMatchRow {
  id: string;
  phase: string;
  round: number;
  seed: number | string;
  content_revision: string;
  options?: { mode?: string } | null;
}

export interface VersusDuosFinalizeStore {
  match(id: string): Promise<VersusDuosMatchRow | null>;
  /** Every seat's final prepared side for the round (absent / null = none stored). */
  finalSides(matchId: string, round: number): Promise<Partial<Record<VersusGroupSeat, unknown>>>;
  commit(args: { p_match: string; p_round: number; p_fight: unknown; p_digest: string }): Promise<unknown>;
  log(msg: string, detail?: unknown): void;
}

/** The commit payload (snake-free JSON the SQL reads with ->>). */
export function duosFightPayload(out: VersusDuosRoundResult): Record<string, unknown> {
  return {
    a: out.first.a, b: out.first.b, chair: out.chair, outcome: out.outcome, losingTeam: out.losingTeam,
    heartsLost: out.heartsLost, aResult: out.aResult, bResult: out.bResult,
  };
}

/** The digest the commit stores and the parity proof compares (the fight, both team perspectives). */
export function duosRoundDigest(out: VersusDuosRoundResult): string {
  return canonicalDigest({ round: out.round, fight: duosFightPayload(out) });
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
  const out = resolveVersusDuosRound({ matchSeed: Number(m.seed), round: m.round, sides });
  for (const [seat, why] of Object.entries(out.refused)) store.log(`versus duos finalize: ${seat} side refused, fighting empty`, why);
  const digest = duosRoundDigest(out);
  const committed = await store.commit({ p_match: matchId, p_round: m.round, p_fight: duosFightPayload(out), p_digest: digest });
  return {
    status: 200,
    body: { status: 'committed', round: m.round, first: out.first, outcome: out.outcome, heartsLost: out.heartsLost, digest, committed },
  };
}
