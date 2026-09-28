/**
 * progression-inventory: open a level crate, equip a title, equip a skin (2026-09-28, account progression crates;
 * `equip_cosmetic` added with skins v1 the same day: `{ action: 'equip_cosmetic', slot, targetId, cosmeticId }`,
 * cosmeticId null = Default).
 *
 * THE CATALOG SYNC (owner 2026-09-28: "make it automated when i add skins"). On the first request of every cold
 * start, BEFORE anything else (so even the anon 401 probe triggers it), this function pushes the catalog it was
 * deployed with (`_shared/progressionCosmetics.ts`, generated from packages/progression/src/cosmetics.ts) to
 * `sync_cosmetic_catalog`. So deploying this function IS how a new cosmetic reaches the database. It is the only
 * writer of the catalog; see `syncCatalogOnce` for why submit-progression does not sync.
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
import { handleInventory, syncCatalogOnce } from '../_shared/progressionInventory.ts';

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

  const admin = createClient(url, serviceKey);
  const rpc = (fn: string, args: Record<string, unknown>) => admin.rpc(fn, args);
  const log = (msg: string, detail?: unknown) => console.error(msg, detail);
  // Once per cold start; never throws; an unchanged catalog is one read (see progressionInventory.ts).
  await syncCatalogOnce(rpc, log);

  // WHO is calling: `getUser()` verifies the token server-side. Anonymous sessions are real user ids.
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const userId = !userErr && userData?.user ? userData.user.id : null;

  let body: unknown;
  try { body = await req.json(); } catch { return json(400, { error: 'bad_json' }); }

  const res = await handleInventory(userId, body, rpc, log);
  return json(res.status, res.body);
});
