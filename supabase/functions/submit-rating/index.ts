/**
 * submit-rating — the authoritative rating writer (ACCOUNTS C3).
 *
 * A client sends `{ runId, placement }` — never a rating. This function, running as the SERVICE ROLE, reads
 * the caller's CURRENT stored rating and computes the new one itself, so a client can't inflate it. One rating
 * per (player, run) via the `rated_runs` ledger; a simple per-player rate limit on top.
 *
 * Deploy: `supabase functions deploy submit-rating`. Then run the C3 block in `schema.sql` (it creates
 * `rated_runs` and revokes the client's legacy `submit_own_rating` RPC). Until both are done, the client keeps
 * using that RPC fallback and nothing breaks.
 *
 * Deno runtime — NOT part of the Node monorepo build (the repo's tsc/eslint don't compile this directory).
 */
// @ts-nocheck — Deno globals + remote imports aren't visible to the repo's Node TypeScript config.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { lobbyRatingAfter } from '../_shared/lobbyRating.ts';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Per-player rate limit: at most this many rated runs inside the window below. A normal player finishes far
 *  fewer; this only trips on scripted spam. */
const RATE_MAX = 20;
const RATE_WINDOW_MS = 10 * 60 * 1000;

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

  // Input: a run id (for dedupe) + a lobby placement. NO rating — the server derives that.
  let body: { runId?: unknown; placement?: unknown };
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }
  const runId = typeof body.runId === 'string' ? body.runId.slice(0, 128) : String(body.runId ?? '');
  const placement = Number(body.placement);
  if (!runId || !Number.isFinite(placement) || placement < 1 || placement > 8) {
    return json(400, { error: 'bad_input' });
  }

  // Service-role client — the authoritative writer, bypassing RLS (which forbids every client rating write).
  const admin = createClient(url, serviceKey);

  // DEDUPE: one rating per (player, run). Insert the ledger row FIRST; a unique violation means this run was
  // already rated, so return the current rating unchanged — idempotent under a retried submit.
  const ledger = await admin.from('rated_runs').insert({ user_id: user.id, run_id: runId }).select('run_id');
  if (ledger.error) {
    if (ledger.error.code === '23505') {
      const cur = await admin.from('profiles').select('rating').eq('user_id', user.id).maybeSingle();
      return json(200, { rating: cur.data?.rating ?? 0, deduped: true });
    }
    return json(500, { error: 'ledger_failed' });
  }

  // RATE LIMIT: count this player's recent ledger rows. Cheap; the ledger is already indexed by (user, time).
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const recent = await admin.from('rated_runs')
    .select('run_id', { count: 'exact', head: true })
    .eq('user_id', user.id).gte('created_at', since);
  if ((recent.count ?? 0) > RATE_MAX) return json(429, { error: 'rate_limited' });

  // AUTHORITATIVE COMPUTE — from the STORED rating, never a client-supplied one. A missing row = a new player
  // at rating 0 (the starting rating); the profile is upserted so the ladder always has a row to rank.
  const prof = await admin.from('profiles').select('rating').eq('user_id', user.id).maybeSingle();
  const ratingBefore = typeof prof.data?.rating === 'number' ? prof.data.rating : 0;
  const ratingAfter = lobbyRatingAfter(ratingBefore, placement);

  const write = await admin.from('profiles')
    .upsert({ user_id: user.id, rating: ratingAfter, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('rating');
  if (write.error) return json(500, { error: 'write_failed' });

  return json(200, { rating: ratingAfter, delta: ratingAfter - ratingBefore });
});
