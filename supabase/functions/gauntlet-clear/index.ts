/**
 * gauntlet-clear: record a Gauntlet stage clear for a SIGNED-IN account (2026-09-29, Gauntlet account progress).
 *
 * A client sends `{ stage }` (an integer 1..10) after clearing that stage. Running as the SERVICE ROLE, this calls
 * the `record_gauntlet_clear` database function: ONE transaction under the per-user progression lock that records
 * the clear and, on the FIRST clear of that stage only, grants one sealed crate (`source = 'gauntlet:<n>'`). A
 * replay answers `{ status: 'already_cleared', crate: null }`. The server trusts the client's clear (owner
 * 2026-09-29): it does not re-simulate the run.
 *
 * Not signed in = no account progress, no crates: an ANONYMOUS session (a guest) is refused with 403
 * `sign_in_required`, so `is_anonymous` is read from the verified user here and handed to the handler.
 *
 * All the decision logic lives in `_shared/progressionGauntlet.ts`, GENERATED from
 * packages/progression/src/gauntlet.ts (`npm run progression:shared`) and unit tested there with a mocked
 * database. This file only verifies the caller's JWT and wires the service-role client.
 *
 * Deploy: `npx supabase functions deploy gauntlet-clear` (the owner runs it, after pasting
 * supabase/migrations/2026-09-29-gauntlet-progress.sql). Env (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
 * `SUPABASE_SERVICE_ROLE_KEY`) is injected by Supabase.
 *
 * Deno runtime, NOT part of the Node monorepo build (the repo's tsc/eslint don't compile this directory).
 */
// @ts-nocheck: Deno globals + remote imports aren't visible to the repo's Node TypeScript config.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleGauntletClear } from '../_shared/progressionGauntlet.ts';

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

  // WHO is calling: `getUser()` verifies the token server-side. Anonymous sessions are real user ids, so the
  // guest check reads `is_anonymous` off the verified user (never a client claim).
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const user = !userErr && userData?.user ? userData.user : null;
  const userId = user ? user.id : null;
  const anonymous = user ? user.is_anonymous === true : false;

  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_body' }); }

  const admin = createClient(url, serviceKey);
  // rows: these server RPCs return one jsonb result each, never a table (R-NET-01).
  const rpc = (fn: string, args: Record<string, unknown>) => admin.rpc(fn, args);
  const log = (msg: string, detail?: unknown) => console.error(msg, detail);
  const res = await handleGauntletClear(userId, anonymous, body, rpc, log);
  return json(res.status, res.body);
});
