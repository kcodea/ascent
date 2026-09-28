/**
 * progression-inventory: open a level crate, equip a title (2026-09-28, account progression crates).
 *
 * The only path that opens a crate, grants a cosmetic from one, or changes the equipped title. A client sends
 * `{ action: 'open_crate', crateId }` or `{ action: 'equip_title', titleId }` (null takes the title off); it never
 * names a reward and never writes ownership, crates or the loadout. Running as the SERVICE ROLE, this calls the
 * `open_crate` / `equip_title` database functions, each ONE transaction under the per-user progression lock:
 * the reward is chosen at open time, weighted over the items still eligible, never a duplicate; an exhausted pool
 * answers `pool_exhausted` and keeps the crate sealed.
 *
 * Kept apart from `submit-progression` on purpose: settlement is a queued, retried request whose contract is
 * already live, and inventory actions are interactive. See packages/progression/src/inventory.ts.
 *
 * All the decision logic lives in `_shared/progressionInventory.ts`, GENERATED from
 * packages/progression/src/inventory.ts (`npm run progression:shared`) and unit tested there with a mocked
 * database. This file only verifies the caller's JWT and wires the service-role client.
 *
 * Deploy: `npx supabase functions deploy progression-inventory` (the owner runs it; see the runbook in
 * docs/devlog/2026-09-28-progression-crates.md). Env (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
 * `SUPABASE_SERVICE_ROLE_KEY`) is injected by Supabase.
 *
 * Deno runtime, NOT part of the Node monorepo build (the repo's tsc/eslint don't compile this directory).
 */
// @ts-nocheck: Deno globals + remote imports aren't visible to the repo's Node TypeScript config.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleInventory } from '../_shared/progressionInventory.ts';

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

  // WHO is calling: `getUser()` verifies the token server-side. Anonymous sessions are real user ids.
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const userId = !userErr && userData?.user ? userData.user.id : null;

  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }

  const admin = createClient(url, serviceKey);
  const res = await handleInventory(
    userId,
    body,
    (fn, args) => admin.rpc(fn, args),
    (msg, detail) => console.error(msg, detail),
  );
  return json(res.status, res.body);
});
