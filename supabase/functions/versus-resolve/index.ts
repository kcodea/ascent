/**
 * VERSUS — the authoritative round resolver (blueprint 3 + 4.1; owner rulings 2026-10-13).
 *
 * Runs the EXACT client combat: `engine.generated.js` is an esbuild bundle of `packages/sim/src/versus/server.ts`
 * (@game/core + @game/content + the pure Versus resolver). It is GENERATED and gitignored, so every deploy is:
 *
 *     npm run versus:bundle
 *     npx supabase functions deploy versus-resolve --no-verify-jwt
 *
 * (`--no-verify-jwt`: the project's publishable key is not a JWT, so the gateway check would refuse the parity
 * tool; every action that touches a match verifies the caller's own token with `auth.getUser()` below.)
 *
 * ACTIONS (POST JSON, `{ action, protocol, contentRevision, ... }`):
 *   - `health`  → `{ protocol, contentRevision }`. No auth.
 *   - `parity`  → `{ digest, canonical, contentRevision }`: resolve one fight from the posted sides and return the
 *                 canonical text. Pure computation, no database, no auth (Phase 0 proof: `npm run versus:parity --
 *                 remote <url>`). Body capped at `VERSUS_LIMITS.resolveBodyBytes`.
 *   - `finalize` → `{ matchId, round }`: settle a match's round from the two stored final submissions, ONE fight,
 *                 committed through `versus_commit_round` as the service role (idempotent). Needs a signed-in
 *                 caller (the user's access token as the bearer). Logic: `packages/sim/src/versus/finalize.ts`.
 *   - `finalize_group` → `{ matchId, round }`: the 3-4 player twin (VERSUS GROUP, owner 2026-10-24): every fight of the
 *                 round (pairing derived from the seats, one simulate() each), committed through
 *                 `versus_group_commit_round` (idempotent). Logic: `packages/sim/src/versus/groupFinalize.ts`.
 *   - `parity_group` → `{ digest, canonical }`: resolve one GROUP round from posted sides (no database, no auth), for
 *                 `npm run versus:parity -- remote`.
 *   - `finalize_duos` → `{ matchId, round }`: the 2v2 tag-team round (VERSUS DUOS, owner 2026-10-25): ONE fight, each
 *                 team's two boards in sequence, in the seeded 50/50 fight order (`duosRandomFirst`), committed through
 *                 `versus_duos_commit_round` (idempotent). Logic: `packages/sim/src/versus/duosFinalize.ts`.
 *   - `parity_duos` → `{ digest, canonical }`: resolve one DUOS round from posted sides (no database, no auth).
 *
 * HEALTH AND ARMOR (owner 2026-10-26, R-VERSUS-HEALTH-01, protocol 2): every finalize reads each seat's (Duos: team's)
 * stored pools and heroes, charges the lobby's capped damage and commits the pools with `p_vitals`. A stored side that
 * was not locked or promoted this round (`source` auto / empty) has its stale pool report dropped (`versusFreshSide`).
 * Needs `supabase/migrations/2026-10-28-versus-health.sql` applied first (the commit signatures changed).
 *
 * A client on another protocol or content revision is refused with 409 rather than resolved under rules it did not
 * show (same posture as `submit-rating`).
 *
 * Deno runtime — NOT part of the Node monorepo build (the repo's tsc/eslint don't compile this directory).
 */
// @ts-nocheck — Deno globals + the generated bundle aren't visible to the repo's Node TypeScript config.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  handleVersusFinalize,
  handleVersusGroupFinalize,
  handleVersusDuosFinalize,
  parityGroupRecord,
  parityDuosRecord,
  resolveVersusDuosRound,
  resolveVersusGroupRound,
  VERSUS_LIMITS,
  VERSUS_PROTOCOL,
  engineContentRevision,
  parityRecord,
  preparedSideError,
  resolveVersusFight,
  versusFreshSide,
} from './engine.generated.js';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const CONTENT = engineContentRevision();

/** Shared request gate: size cap, JSON, protocol + content identity. Returns the body or an error Response. */
async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > VERSUS_LIMITS.resolveBodyBytes) return json(413, { error: 'too_large' });
  const text = await req.text();
  if (text.length > VERSUS_LIMITS.resolveBodyBytes) return json(413, { error: 'too_large' });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json(400, { error: 'bad_body' }); }
  if (!body || typeof body !== 'object') return json(400, { error: 'bad_body' });
  return body as Record<string, unknown>;
}

function identityError(body: Record<string, unknown>): Response | null {
  if (body.protocol !== VERSUS_PROTOCOL) return json(409, { error: 'protocol_mismatch', protocol: VERSUS_PROTOCOL, contentRevision: CONTENT });
  if (body.contentRevision !== CONTENT) return json(409, { error: 'content_mismatch', protocol: VERSUS_PROTOCOL, contentRevision: CONTENT });
  return null;
}

async function finalize(req: Request, body: Record<string, unknown>): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'not_configured' });
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const userId = !userErr && userData?.user ? userData.user.id : null;
  const admin = createClient(url, serviceKey);
  const store = {
    async match(id: string) {
      const { data, error } = await admin.from('versus_matches')
        .select('id, phase, round, seed, content_revision, p1_user, p2_user, p1_hero, p2_hero, options, p1_health, p1_armor, p2_health, p2_armor')
        .eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
    async finalSides(matchId: string, round: number) {
      // rows: at most two rows, one per seat (primary key match_id + round + seat) (R-NET-01).
      const { data, error } = await admin.from('versus_submissions').select('seat, prepared_side, final, source').eq('match_id', matchId).eq('round', round);
      if (error) throw error;
      const out = { p1: null, p2: null };
      for (const r of data ?? []) if (r.final) out[r.seat] = versusFreshSide(r.prepared_side, r.source);
      return out;
    },
    async commit(args: Record<string, unknown>) {
      // rows: the commit RPC returns one jsonb value, never a table (R-NET-01).
      const { data, error } = await admin.rpc('versus_commit_round', args);
      if (error) throw error;
      return data;
    },
    log: (msg: string, detail?: unknown) => console.error(msg, detail),
  };
  const res = await handleVersusFinalize(userId, body, CONTENT, store);
  return json(res.status, res.body);
}

async function finalizeGroup(req: Request, body: Record<string, unknown>): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'not_configured' });
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const userId = !userErr && userData?.user ? userData.user.id : null;
  const admin = createClient(url, serviceKey);
  const store = {
    async match(id: string) {
      const { data, error } = await admin.from('versus_group_matches').select('id, phase, round, seed, content_revision, options').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
    async seats(matchId: string) {
      // rows: at most four rows, one per seat (primary key match_id + seat) (R-NET-01).
      const { data, error } = await admin.from('versus_group_seats').select('seat, eliminated_round, hero, health, armor').eq('match_id', matchId);
      if (error) throw error;
      return data ?? [];
    },
    async finalSides(matchId: string, round: number) {
      // rows: at most four rows, one per seat (primary key match_id + round + seat) (R-NET-01).
      const { data, error } = await admin.from('versus_group_submissions').select('seat, prepared_side, final, source').eq('match_id', matchId).eq('round', round);
      if (error) throw error;
      const out: Record<string, unknown> = {};
      for (const r of data ?? []) if (r.final) out[r.seat] = versusFreshSide(r.prepared_side, r.source);
      return out;
    },
    async commit(args: Record<string, unknown>) {
      // rows: the commit RPC returns one jsonb value, never a table (R-NET-01).
      const { data, error } = await admin.rpc('versus_group_commit_round', args);
      if (error) throw error;
      return data;
    },
    log: (msg: string, detail?: unknown) => console.error(msg, detail),
  };
  const res = await handleVersusGroupFinalize(userId, body, CONTENT, store);
  return json(res.status, res.body);
}

async function finalizeDuos(req: Request, body: Record<string, unknown>): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'not_configured' });
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const userId = !userErr && userData?.user ? userData.user.id : null;
  const admin = createClient(url, serviceKey);
  const store = {
    async match(id: string) {
      const { data, error } = await admin.from('versus_group_matches').select('id, phase, round, seed, content_revision, options').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },
    async finalSides(matchId: string, round: number) {
      // rows: four rows, one per seat (primary key match_id + round + seat) (R-NET-01).
      const { data, error } = await admin.from('versus_group_submissions').select('seat, prepared_side, final, source').eq('match_id', matchId).eq('round', round);
      if (error) throw error;
      const out: Record<string, unknown> = {};
      for (const r of data ?? []) if (r.final) out[r.seat] = versusFreshSide(r.prepared_side, r.source);
      return out;
    },
    async commit(args: Record<string, unknown>) {
      // rows: the commit RPC returns one jsonb value, never a table (R-NET-01).
      const { data, error } = await admin.rpc('versus_duos_commit_round', args);
      if (error) throw error;
      return data;
    },
    async seats(matchId: string) {
      // rows: four rows, one per seat (primary key match_id + seat) (R-NET-01).
      const { data, error } = await admin.from('versus_group_seats').select('seat, hero').eq('match_id', matchId);
      if (error) throw error;
      return data ?? [];
    },
    async teams(matchId: string) {
      // rows: two rows, one per team (primary key match_id + team) (R-NET-01).
      const { data, error } = await admin.from('versus_group_teams').select('team, health, armor').eq('match_id', matchId);
      if (error) throw error;
      return data ?? [];
    },
    log: (msg: string, detail?: unknown) => console.error(msg, detail),
  };
  const res = await handleVersusDuosFinalize(userId, body, CONTENT, store);
  return json(res.status, res.body);
}

const GROUP_SEATS = ['p1', 'p2', 'p3', 'p4'];

function parityDuos(body: Record<string, unknown>): Response {
  const { matchSeed, round, sides, vitals } = body as Record<string, any>;
  if (!Number.isInteger(matchSeed) || !Number.isInteger(round) || round < 1 || round > 999) return json(400, { error: 'bad_round' });
  if (!sides || typeof sides !== 'object') return json(400, { error: 'bad_side' });
  for (const s of GROUP_SEATS) {
    if (sides[s] == null) continue;
    const e = preparedSideError(sides[s]);
    if (e) return json(400, { error: 'bad_side', detail: e });
  }
  const out = resolveVersusDuosRound({ matchSeed, round, sides, ...(vitals && typeof vitals === 'object' ? { vitals } : {}) });
  const rec = parityDuosRecord(out);
  return json(200, { digest: rec.digest, canonical: rec.canonical, contentRevision: CONTENT, protocol: VERSUS_PROTOCOL });
}

function parityGroup(body: Record<string, unknown>): Response {
  const { matchSeed, round, seats, eliminated, sides, vitals } = body as Record<string, any>;
  if (!Number.isInteger(matchSeed) || !Number.isInteger(round) || round < 1 || round > 999) return json(400, { error: 'bad_round' });
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 4 || seats.some((s: unknown) => !GROUP_SEATS.includes(s as string))) return json(400, { error: 'bad_seats' });
  if (!sides || typeof sides !== 'object' || (eliminated != null && typeof eliminated !== 'object')) return json(400, { error: 'bad_side' });
  for (const s of seats) {
    const e = preparedSideError(sides[s]);
    if (e) return json(400, { error: 'bad_side', detail: e });
  }
  const out = resolveVersusGroupRound({ matchSeed, round, seats, eliminated: eliminated ?? {}, sides, ...(vitals && typeof vitals === 'object' ? { vitals } : {}) });
  const rec = parityGroupRecord(out);
  return json(200, { digest: rec.digest, canonical: rec.canonical, contentRevision: CONTENT, protocol: VERSUS_PROTOCOL });
}

function parity(body: Record<string, unknown>): Response {
  const matchSeed = body.matchSeed;
  const round = body.round;
  if (!Number.isInteger(matchSeed) || !Number.isInteger(round) || (round as number) < 1 || (round as number) > 999) return json(400, { error: 'bad_round' });
  const e1 = preparedSideError(body.p1);
  const e2 = preparedSideError(body.p2);
  if (e1 || e2) return json(400, { error: 'bad_side', detail: e1 ?? e2 });
  const vitals = body.vitals && typeof body.vitals === 'object' ? { vitals: body.vitals } : {};
  const out = resolveVersusFight({ matchSeed, round, p1: body.p1, p2: body.p2, ...vitals });
  const rec = parityRecord(out);
  return json(200, { digest: rec.digest, canonical: rec.canonical, contentRevision: CONTENT, protocol: VERSUS_PROTOCOL });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const body = await readBody(req);
  if (body instanceof Response) return body;
  if (body.action === 'health') return json(200, { protocol: VERSUS_PROTOCOL, contentRevision: CONTENT });
  const bad = identityError(body);
  if (bad) return bad;
  try {
    if (body.action === 'parity') return parity(body);
    if (body.action === 'finalize') return await finalize(req, body);
    if (body.action === 'finalize_group') return await finalizeGroup(req, body);
    if (body.action === 'parity_group') return parityGroup(body);
    if (body.action === 'finalize_duos') return await finalizeDuos(req, body);
    if (body.action === 'parity_duos') return parityDuos(body);
    return json(400, { error: 'unknown_action' });
  } catch (e) {
    console.error('versus-resolve failed', e);
    return json(500, { error: 'resolver_failed' });
  }
});
