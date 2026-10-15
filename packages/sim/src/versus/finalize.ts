/**
 * VERSUS — the server's round finalization (the `versus-resolve` Edge Function's `finalize` action), written as a
 * pure handler over an injected store so Node tests drive exactly what Deno runs.
 *
 * 1. Read the match. Only a match in `resolving` at the requested round is finalized; anything else answers with
 *    the current row (a late or duplicate caller is not an error, it is a client catching up).
 * 2. The deployed engine must be the one the match was created under (content revision), or it refuses: a fight
 *    resolved under other cards would contradict both clients.
 * 3. Read both FINAL sides (a missing or malformed one fights as the empty side, logged), fight ONCE, commit through
 *    `versus_commit_round` (idempotent in SQL: concurrent finalizers converge on the first committed row).
 *
 * Bundle-safe: imports only pure Versus siblings.
 */
import { canonicalDigest } from './canonical';
import { resolveVersusFight, versusSideOrEmpty } from './combat';
import type { VersusSeat } from './constants';

export interface VersusMatchRow {
  id: string;
  phase: string;
  round: number;
  seed: number | string;
  content_revision: string;
  p1_user: string;
  p2_user: string;
}

export interface VersusFinalizeStore {
  match(id: string): Promise<VersusMatchRow | null>;
  /** The two seats' final prepared sides for the round (null = none stored). */
  finalSides(matchId: string, round: number): Promise<Record<VersusSeat, unknown>>;
  commit(args: {
    p_match: string; p_round: number; p_chair: VersusSeat; p_outcome: VersusSeat | 'draw'; p_heart_lost_by: VersusSeat | null;
    p_p1: unknown; p_p2: unknown; p_digest: string;
  }): Promise<unknown>;
  log(msg: string, detail?: unknown): void;
}

export interface VersusFinalizeResponse {
  status: number;
  body: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleVersusFinalize(
  userId: string | null,
  body: Record<string, unknown>,
  engineContent: string,
  store: VersusFinalizeStore,
): Promise<VersusFinalizeResponse> {
  if (!userId) return { status: 401, body: { error: 'not_signed_in' } };
  const matchId = body.matchId;
  const round = body.round;
  if (typeof matchId !== 'string' || !UUID.test(matchId)) return { status: 400, body: { error: 'bad_match' } };
  if (!Number.isInteger(round) || (round as number) < 1) return { status: 400, body: { error: 'bad_round' } };
  const m = await store.match(matchId);
  if (!m) return { status: 404, body: { error: 'no_match' } };
  if (m.phase !== 'resolving' || m.round !== round) return { status: 200, body: { status: 'not_resolving', phase: m.phase, round: m.round } };
  if (m.content_revision !== engineContent) {
    store.log('versus finalize: engine content differs from the match', { match: m.content_revision, engine: engineContent });
    return { status: 409, body: { error: 'engine_mismatch', contentRevision: engineContent } };
  }
  const stored = await store.finalSides(matchId, m.round);
  const p1 = versusSideOrEmpty(stored.p1);
  const p2 = versusSideOrEmpty(stored.p2);
  if (p1.error && p1.error !== 'missing') store.log('versus finalize: p1 side refused, fighting empty', p1.error);
  if (p2.error && p2.error !== 'missing') store.log('versus finalize: p2 side refused, fighting empty', p2.error);
  const out = resolveVersusFight({ matchSeed: Number(m.seed), round: m.round, p1: p1.side, p2: p2.side });
  const digest = canonicalDigest({ chair: out.chair, outcome: out.outcome, heartLostBy: out.heartLostBy, p1: out.p1, p2: out.p2 });
  const committed = await store.commit({
    p_match: matchId, p_round: m.round, p_chair: out.chair, p_outcome: out.outcome, p_heart_lost_by: out.heartLostBy,
    p_p1: out.p1, p_p2: out.p2, p_digest: digest,
  });
  return { status: 200, body: { status: 'committed', round: m.round, outcome: out.outcome, digest, committed } };
}
