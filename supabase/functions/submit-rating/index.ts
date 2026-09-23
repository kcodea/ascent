/**
 * submit-rating — the authoritative MEDAL RANK writer (2026-09-20; succeeds the ACCOUNTS C3 numeric writer).
 *
 * A client sends `{ runId, placement, seasonId, rulesVersion, seed?, seatKeys? }` — never a rating, never a
 * division, never a strength. `seatKeys` (2026-09-22) are the seven opponent seats' fight-ledger keys; the
 * database recomputes the LOBBY STRENGTH from the `run_fight_records` view at settle time and applies the
 * top-4 bonus itself (scaled by placement and strength) — the client's own number is only what it shows
 * before the settle.
 * This function, running as the SERVICE ROLE, calls the `settle_rank` database function, which does the whole
 * settlement in ONE transaction: it locks the caller's profile row, checks the `rank_results` ledger under
 * that lock (a duplicate returns the ORIGINAL result — never a second award), resolves the medal rules from
 * the locked profile, and writes profile + revision + the immutable result together. A failure anywhere rolls
 * the lot back: no half-settled state, no consumed dedupe key without points.
 *
 * VALIDATION before the call: placement is an integer 1–8; `seasonId` / `rulesVersion` must be the ones this
 * deployment serves (a client from another season or rules version is REJECTED — 409 — rather than settled
 * under rules it did not show); `runId` is a non-empty string ≤ 128 chars (a persisted UUID for runs started
 * since medals, `String(seed)` for older saved games — the client never regenerates it on retry).
 *
 * PARITY: the database's outcome is re-derived here from `_shared/lobbyRating.ts` and compared. A mismatch
 * does NOT overrule the committed SQL result (the ledger is what was written) — it flags `parity: false` and
 * logs, so a rules edit that missed one copy surfaces on the first real settlement.
 *
 * Deploy: `supabase functions deploy submit-rating` (see docs/rank-season-runbook.md for the full order).
 *
 * Deno runtime — NOT part of the Node monorepo build (the repo's tsc/eslint don't compile this directory).
 */
// @ts-nocheck — Deno globals + remote imports aren't visible to the repo's Node TypeScript config.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { RANK_RULES_VERSION, RANK_SEASON, isValidPlacement, resolveRankOutcome, sameRankOutcome, strengthBonusOf } from '../_shared/lobbyRating.ts';

/** At most seven opponent keys, each a bounded string (an `author|hero|seed` or a `bot:kind:hero`). */
const MAX_SEAT_KEYS = 7;
const MAX_SEAT_KEY_LENGTH = 96;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** `raise exception '<code>'` inside `settle_rank` → the HTTP status the client maps to retryable/rejected. */
const SQL_ERROR_STATUS: Record<string, number> = {
  bad_placement: 400,
  bad_run_id: 400,
  unsupported_season: 409,
  unsupported_rules: 409,
  rate_limited: 429,
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'not_configured' });

  // WHO is calling — a client scoped to the caller's JWT. `getUser()` verifies the token server-side.
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json(401, { error: 'unauthenticated' });

  // INPUT — strict. A season / rules-version mismatch is a definite rejection (the client shows the truth
  // and keeps its request; an updated client can resubmit the same run id under the right version).
  let body: { runId?: unknown; placement?: unknown; seasonId?: unknown; rulesVersion?: unknown; seed?: unknown; seatKeys?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const runId = typeof body.runId === 'string' ? body.runId.trim().slice(0, 128) : '';
  const placement = typeof body.placement === 'number' ? body.placement : Number(body.placement);
  if (!runId) return json(400, { error: 'bad_run_id' });
  if (!isValidPlacement(placement)) return json(400, { error: 'bad_placement' });
  if (body.seasonId !== RANK_SEASON) return json(409, { error: 'unsupported_season', expected: RANK_SEASON });
  if (body.rulesVersion !== RANK_RULES_VERSION) return json(409, { error: 'unsupported_rules', expected: RANK_RULES_VERSION });
  const seed = typeof body.seed === 'number' && Number.isFinite(body.seed) && Number.isInteger(body.seed) ? body.seed : null;
  // The seat keys are OPTIONAL (an older client sends none → no bonus, exactly as before). Malformed entries are
  // dropped rather than rejected: a bad key costs the bonus, never the settlement.
  const seatKeys: string[] | null = Array.isArray(body.seatKeys)
    ? body.seatKeys.filter((k: unknown): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_SEAT_KEY_LENGTH).slice(0, MAX_SEAT_KEYS)
    : null;

  // THE SETTLEMENT — one atomic database call as the service role (RLS forbids every client rank write; the
  // function itself is executable by the service role only).
  const admin = createClient(url, serviceKey);
  const baseArgs = { p_user: user.id, p_run_id: runId, p_placement: placement, p_season: RANK_SEASON, p_rules_version: RANK_RULES_VERSION, p_seed: seed };
  let settled = await admin.rpc('settle_rank', { ...baseArgs, p_seat_keys: seatKeys });
  // A database that has not run the 2026-09-22 fight-ledger migration only knows the six-argument
  // `settle_rank`; PostgREST then answers "could not find the function" (PGRST202). Retry WITHOUT the seat keys
  // so the settlement still lands (with no bonus) — the same fallback-ladder discipline as the client's uploads.
  if (settled.error) {
    const text = `${String(settled.error.message ?? '')} ${String(settled.error.code ?? '')}`;
    if (/settle_rank|PGRST202/.test(text) && /(could not find|does not exist|PGRST202)/i.test(text)) settled = await admin.rpc('settle_rank', baseArgs);
  }
  if (settled.error) {
    const message = String(settled.error.message ?? '');
    const code = Object.keys(SQL_ERROR_STATUS).find((k) => message.includes(k));
    if (code) return json(SQL_ERROR_STATUS[code]!, { error: code });
    console.error('settle_rank failed', settled.error);
    return json(500, { error: 'settle_failed' });
  }

  const out = settled.data as { status?: string; result?: Record<string, unknown>; profile?: Record<string, unknown> } | null;
  if (!out || !out.result || !out.profile) return json(500, { error: 'settle_malformed' });

  // RUNTIME PARITY — re-derive the committed result from the shared TS rules and compare.
  let parity = true;
  try {
    const r = out.result as {
      placement: number;
      before: { divisionIndex: number; points: number; demotionReady?: boolean };
      after: { divisionIndex: number; points: number; demotionReady?: boolean };
      baseDelta: number; strengthBonus?: number; lobbyStrength?: number | null; appliedDelta: number; cappedPoints: number; wasPromotionGame: boolean;
      promotionKind: 'division' | 'medal' | null; requiredFinish: number | null;
      promotionUnlocked: boolean; promoted: boolean; wasDemotionGame: boolean; demotionUnlocked: boolean; demoted: boolean;
    };
    // The bonus is re-derived from the strength the SQL computed (the view is the SQL's to read); a pre-bonus row
    // carries neither key and reads 0.
    const bonus = typeof r.lobbyStrength === 'number' ? strengthBonusOf(r.lobbyStrength, r.placement) : (r.strengthBonus ?? 0);
    const expected = resolveRankOutcome(r.before, r.placement, bonus);
    parity = sameRankOutcome(expected, {
      placement: r.placement, before: r.before, after: r.after, baseDelta: r.baseDelta, strengthBonus: r.strengthBonus ?? 0, appliedDelta: r.appliedDelta,
      cappedPoints: r.cappedPoints, wasPromotionGame: r.wasPromotionGame, promotionKind: r.promotionKind ?? null,
      requiredFinish: r.requiredFinish ?? null, promotionUnlocked: r.promotionUnlocked, promoted: r.promoted,
      wasDemotionGame: r.wasDemotionGame === true, demotionUnlocked: r.demotionUnlocked === true, demoted: r.demoted,
    });
    if (!parity) console.error('rank parity mismatch', { user: user.id, runId, sql: out.result, ts: expected });
  } catch (e) {
    parity = false;
    console.error('rank parity check threw', e);
  }

  const position = (out.profile as { position?: { divisionIndex: number; points: number } }).position;
  return json(200, {
    status: 'confirmed',
    deduped: out.status === 'deduped',
    result: out.result,
    profile: out.profile,
    /** The derived reporting scalar, for anything still reading a number. */
    rating: position ? 100 * position.divisionIndex + position.points : null,
    parity,
  });
});
