/**
 * submit-bug-report — the in-game Ctrl+B reporter's intake (2026-08-27).
 *
 * The client sends a BugReportEnvelope (schemaVersion 1): the player's description + the deterministic
 * incident capsule. This function, running as the SERVICE ROLE, is the ONLY writer of `bug_reports` (the
 * table has no client insert policy), so every guard here is unbypassable:
 *   · authenticated caller required (anonymous accounts count — same as the rest of the game);
 *   · 4 MB body ceiling (mirrors the client's trim ladder limit);
 *   · schemaVersion + required-field validation, description length cap, unknown top-level keys stripped;
 *   · `user_id` derived from the JWT, never the body;
 *   · idempotent by (user_id, client_report_id) — a retried upload returns the original row's id;
 *   · rate limit per user: 10 reports/hour, 30/day;
 *   · coarse server-side fingerprint → likely duplicates get LINKED (duplicate_of), never dropped —
 *     repeated reports are frequency evidence.
 *
 * Deploy: `supabase functions deploy submit-bug-report`. Then run the BUG REPORTS block in ../../../schema.sql.
 *
 * Deno runtime — NOT part of the Node monorepo build (the repo's tsc/eslint don't compile this directory).
 */
// @ts-nocheck — Deno globals + remote imports aren't visible to the repo's Node TypeScript config.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const MAX_BODY_BYTES = 4 * 1024 * 1024; // the blueprint's hard client limit, enforced server-side too
const MAX_DESCRIPTION = 2000;
const MIN_DESCRIPTION = 10;
const RATE_HOUR_MAX = 10;
const RATE_DAY_MAX = 30;
const ISSUE_TYPES = new Set(['mechanics', 'presentation', 'text_mismatch', 'softlock', 'performance', 'ui', 'other']);

const str = (v: unknown, max = 256): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;

/** Coarse dedupe fingerprint (blueprint §10): stable, low-cardinality fields only — never the free text. */
async function fingerprintOf(env: Record<string, unknown>, ctx: Record<string, unknown>): Promise<string> {
  const combat = (ctx.combat ?? null) as { rawEvents?: unknown[] } | null;
  const tail = Array.isArray(combat?.rawEvents)
    ? combat.rawEvents.slice(-8).map((e) => {
        const ev = e as Record<string, unknown>;
        return `${String(ev.type ?? '?')}:${String(ev.source ?? ev.cardId ?? '')}`;
      }).join(',')
    : '';
  const ui = (ctx.ui ?? {}) as Record<string, unknown>;
  const parts = [
    String(env.contentRevision ?? ''),
    String(env.issueType ?? ''),
    String(ctx.phase ?? ''),
    String(ctx.heroId ?? ''),
    String(ui.selectedCardId ?? ''),
    String(ui.pendingTargetCardId ?? ''),
    tail,
  ].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

  // Size gate BEFORE parsing: read the raw text and measure it.
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: 'payload_too_large', maxBytes: MAX_BODY_BYTES });
  let env: Record<string, unknown>;
  try { env = JSON.parse(raw) as Record<string, unknown>; } catch { return json(400, { error: 'bad_json' }); }

  // Schema + required fields. Unknown top-level keys are stripped by simply never reading them.
  if (env.schemaVersion !== 1) return json(422, { error: 'unsupported_schema_version', got: env.schemaVersion ?? null });
  const clientReportId = str(env.reportId, 128);
  const description = typeof env.description === 'string' ? env.description.slice(0, MAX_DESCRIPTION) : '';
  const issueType = typeof env.issueType === 'string' && ISSUE_TYPES.has(env.issueType) ? env.issueType : 'other';
  const ctx = (env.context ?? null) as Record<string, unknown> | null;
  const client = (env.client ?? null) as Record<string, unknown> | null;
  if (!clientReportId || !ctx || !client) return json(422, { error: 'missing_fields' });
  if (description.trim().length < MIN_DESCRIPTION) return json(422, { error: 'description_too_short' });

  const heroId = str(ctx.heroId);
  const setId = str(ctx.setId) ?? 'unknown';
  const mode = str(ctx.mode) ?? 'lobby';
  const phase = str(ctx.phase) ?? 'unknown';
  const seed = Number.isFinite(Number(ctx.seed)) ? Number(ctx.seed) : null;
  const wave = Number.isFinite(Number(ctx.wave)) ? Number(ctx.wave) : null;
  const patch = str(client.appVersion) && str(client.buildSha)
    ? `${str(client.appVersion)}+${str(client.buildSha)}` : null;
  const contentRevision = str(client.contentRevision) ?? patch ?? 'unknown';
  const playerCreatedAt = str(env.createdAt, 64);
  if (!heroId || seed === null || wave === null || !patch || !playerCreatedAt) return json(422, { error: 'missing_fields' });

  const admin = createClient(url, serviceKey);

  // Idempotency FIRST: a retry of an already-stored report must return the same id without burning rate limit.
  const { data: existing } = await admin.from('bug_reports')
    .select('id, duplicate_of').eq('user_id', user.id).eq('client_report_id', clientReportId).maybeSingle();
  if (existing) return json(200, { id: existing.id, duplicateOf: existing.duplicate_of ?? undefined });

  // Rate limits: 10/hour, 30/day per user.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const { count: hourCount } = await admin.from('bug_reports')
    .select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', hourAgo);
  if ((hourCount ?? 0) >= RATE_HOUR_MAX) return json(429, { error: 'rate_limited', window: 'hour' });
  const { count: dayCount } = await admin.from('bug_reports')
    .select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', dayAgo);
  if ((dayCount ?? 0) >= RATE_DAY_MAX) return json(429, { error: 'rate_limited', window: 'day' });

  // Fingerprint → link (never drop) the most recent same-print report as the duplicate target.
  const fingerprint = await fingerprintOf(env, ctx);
  const { data: dupe } = await admin.from('bug_reports')
    .select('id').eq('fingerprint', fingerprint).is('duplicate_of', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();

  // The stored `report` is the whole KNOWN-KEY envelope (the capsule verbatim inside it).
  const envelope = {
    schemaVersion: 1,
    reportId: clientReportId,
    createdAt: playerCreatedAt,
    description,
    issueType,
    context: ctx,
    client,
  };

  const { data: inserted, error: insErr } = await admin.from('bug_reports').insert({
    user_id: user.id,
    client_report_id: clientReportId,
    player_created_at: playerCreatedAt,
    issue_type: issueType,
    description,
    patch,
    content_revision: contentRevision,
    mode,
    set_id: setId,
    hero_id: heroId,
    seed,
    wave,
    phase,
    report: envelope,
    fingerprint,
    duplicate_of: dupe?.id ?? null,
  }).select('id').single();

  if (insErr) {
    // A race on the idempotency key lands here — re-read and return the winner.
    if (String(insErr.code) === '23505') {
      const { data: raced } = await admin.from('bug_reports')
        .select('id, duplicate_of').eq('user_id', user.id).eq('client_report_id', clientReportId).maybeSingle();
      if (raced) return json(200, { id: raced.id, duplicateOf: raced.duplicate_of ?? undefined });
    }
    return json(500, { error: 'insert_failed' });
  }

  return json(201, { id: inserted.id, duplicateOf: dupe?.id ?? undefined });
});
