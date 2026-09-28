/**
 * submit-progression: the authoritative ACCOUNT XP writer (2026-09-27, account progression MVP).
 *
 * The only path that moves `profiles.account_xp` / `account_level` or grants a title. A client sends
 * `{ mode, runId, rulesVersion, comeback?, sourceId?, courseId?, courseVersion?, facts? }`, never an XP number,
 * never a level. Running as the SERVICE ROLE, this calls the `settle_progression` database function, which does
 * the whole settlement in ONE transaction under a per-user lock: dedupe against the immutable
 * `progression_results` ledger (a duplicate returns the ORIGINAL result), read the placement from the SOURCE
 * row (the accepted `rank_results` row, the caller's own `practice_games` row, or a unique tutorial claim),
 * check the progression epoch, compute XP, cross levels, grant Alpha Tester at Level 2, write the profile +
 * revision + ledger row together.
 *
 * ACHIEVEMENTS (2026-09-28): on the first request of every cold start it also pushes this build's achievement
 * definitions into `achievement_catalog` (`sync_achievement_catalog`), and `settle_progression` evaluates them in the
 * same transaction as the match XP. So adding or retuning an achievement is: edit
 * packages/progression/src/achievements.ts, `npm run progression:shared`, merge, redeploy THIS function.
 *
 * All the decision logic lives in `_shared/progressionServer.ts`, GENERATED from packages/progression/src/
 * server.ts (`npm run progression:shared`) and unit tested there with a mocked database. This file only
 * verifies the caller's JWT and wires the service-role client. The same module re-derives every settlement
 * from the shared TS rules and returns `parity: false` when the SQL disagrees (mirrors submit-rating).
 *
 * Deploy: `supabase functions deploy submit-progression` (the owner runs it; see the runbook in
 * docs/devlog/2026-09-27-account-progression-mvp.md). Env (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
 * `SUPABASE_SERVICE_ROLE_KEY`) is injected by Supabase.
 *
 * Deno runtime, NOT part of the Node monorepo build (the repo's tsc/eslint don't compile this directory).
 */
// @ts-nocheck: Deno globals + remote imports aren't visible to the repo's Node TypeScript config.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleSubmitProgression } from '../_shared/progressionServer.ts';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'not_configured' });

  // WHO is calling: a client scoped to the caller's JWT. `getUser()` verifies the token server-side. An
  // anonymous Supabase session is a real user id, so anonymous players earn XP too (owner 2026-09-27).
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const userId = !userErr && userData?.user ? userData.user.id : null;

  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }

  const admin = createClient(url, serviceKey);
  const res = await handleSubmitProgression(
    userId,
    body,
    (fn, args) => admin.rpc(fn, args),
    (msg, detail) => console.error(msg, detail),
  );
  return json(res.status, res.body);
});
