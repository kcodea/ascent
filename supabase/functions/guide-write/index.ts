/**
 * guide-write: the only writer of guides (2026-10-12).
 *
 * The client sends `{ op, ... }` (`save`, `delete`, `importBuiltIns`, `setPublished`, `bookmark`, `unbookmark`, `report`, `setHidden`, `resolveReport`, `retagSets`). This function verifies the caller's token,
 * takes the user id from it (never from the body), then hands the request to `handleGuideWrite`
 * (../_shared/guidesServer.ts, GENERATED from packages/guides/src/server.ts), which checks shape, limits and the
 * word filter and calls the SQL functions as the SERVICE ROLE. The `guides` tables have no client write policy, so
 * every guard here and in the SQL is unbypassable:
 *   - authenticated caller required, and NOT a guest: an anonymous session is refused `sign_in_required`;
 *   - 64 KB body ceiling, measured in UTF-8 bytes (guideBodyTooLarge) and checked before the body is parsed; the
 *     declared Content-Length is checked first, and identity failures are answered before the body is read at all;
 *   - a Team Ascent guide can be written only by an account in `guide_team` (checked in SQL).
 *
 * Deploy: `npx supabase functions deploy guide-write`, after running supabase/migrations/2026-10-12-guides.sql.
 * Step 3 needs supabase/migrations/2026-10-13-guides-community.sql run first.
 * Step 4 needs supabase/migrations/2026-10-14-guides-moderation.sql run first.
 *
 * Deno runtime, NOT part of the Node monorepo build (the repo's tsc/eslint don't compile this directory).
 */
// @ts-nocheck: Deno globals + remote imports aren't visible to the repo's Node TypeScript config.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { guideBodyTooLarge, handleGuideWrite } from '../_shared/guidesServer.ts';
import { GUIDE_LIMITS } from '../_shared/guidesTypes.ts';

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

  // Identity failures are answered BEFORE the body is read (the handler keeps its own checks too).
  if (!userId) return json(401, { error: 'unauthenticated' });
  if (anonymous) return json(403, { error: 'sign_in_required' });

  // Size gate BEFORE parsing: refuse a declared oversize without reading it, then measure the real bytes.
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > GUIDE_LIMITS.bodyBytes) return json(413, { error: 'payload_too_large', maxBytes: GUIDE_LIMITS.bodyBytes });
  const raw = await req.text();
  if (guideBodyTooLarge(raw)) return json(413, { error: 'payload_too_large', maxBytes: GUIDE_LIMITS.bodyBytes });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'bad_body' }); }

  const admin = createClient(url, serviceKey);
  // rows: these server RPCs return one jsonb result each, never a table (R-NET-01).
  const rpc = (fn: string, args: Record<string, unknown>) => admin.rpc(fn, args);
  const log = (msg: string, detail?: unknown) => console.error(msg, detail);
  const res = await handleGuideWrite(userId, anonymous, body, rpc, log);
  return json(res.status, res.body);
});
