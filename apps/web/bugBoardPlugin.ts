import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * BUG BOARD — DEV-ONLY middleware backing the in-game Bug Board (DEV MENU → 🐛 Bug Board). The board is the
 * owner's bug inbox: it lists `bug_reports` (minus the heavy `report` capsule), lets a click set
 * status/severity, and turns a hand-picked (or default) ordering into a WORK ORDER — priorities 1..N stamped
 * in Supabase plus `.local/bug-reports/work-order.json` on disk, the fixed contract the `bugs:pull` CLI and
 * a "fix the bug stack" Claude session read.
 *
 * `apply: 'serve'` — never part of a production build, which is WHY it may hold the service-role key: the
 * key is read from the untracked repo-root `.env` (`SUPABASE_SERVICE_ROLE_KEY`) and never travels past the
 * dev server. `VITE_SUPABASE_URL` comes from `apps/web/.env` (committed, public by design). Missing config
 * is a structured `not_configured` response the board renders as a setup hint — never a crash.
 *
 * Mirrors `rulebookPlugin.ts`: the validation/planning surface is pure functions
 * (`validateUpdate`, `planWorkOrderWrite`, `parseEnvFile`, `dupeCountsOf`) unit-tested without a server;
 * the middleware is a thin shell. All write destinations are FIXED by the plugin, never request-derived.
 */

export const MAX_BODY_BYTES = 256 * 1024;

export const BUG_STATUSES = ['new', 'triaged', 'reproduced', 'needs_info', 'fixed', 'closed', 'duplicate'] as const;
export const BUG_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

/** The light columns the board lists — everything EXCEPT the multi-MB `report` capsule. */
export const LIST_COLUMNS = [
  'id', 'created_at', 'status', 'severity', 'priority', 'issue_type', 'description', 'patch',
  'mode', 'set_id', 'hero_id', 'seed', 'wave', 'phase', 'fingerprint', 'duplicate_of',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hand-rolled `.env` parser (KEY=VALUE lines; `#` comments; optional single/double quotes; `export ` prefix
 * tolerated). Deliberately no dependency — this runs inside the dev server only.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export interface UpdateRequest { id: string; status?: string; severity?: string | null; priority?: number | null }

/** Validate a status/severity/priority update. Pure. Returns the exact PATCH payload or an error. */
export function validateUpdate(body: unknown): { error: string } | { id: string; patch: Record<string, unknown> } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  const { id, status, severity, priority } = body as UpdateRequest;
  if (typeof id !== 'string' || !UUID_RE.test(id)) return { error: 'bad report id' };
  const patch: Record<string, unknown> = {};
  if (status !== undefined) {
    if (!(BUG_STATUSES as readonly string[]).includes(status)) return { error: `status must be one of ${BUG_STATUSES.join('/')}` };
    patch.status = status;
  }
  if (severity !== undefined) {
    if (severity !== null && !(BUG_SEVERITIES as readonly string[]).includes(severity)) {
      return { error: `severity must be null or one of ${BUG_SEVERITIES.join('/')}` };
    }
    patch.severity = severity;
  }
  if (priority !== undefined) {
    if (priority !== null && (!Number.isInteger(priority) || priority < 0 || priority > 9999)) {
      return { error: 'priority must be null or an integer 0..9999' };
    }
    patch.priority = priority;
  }
  if (Object.keys(patch).length === 0) return { error: 'nothing to update' };
  return { id, patch };
}

export interface WorkOrderFile { generatedAt: string; orderedReportIds: string[]; notes?: string }

/**
 * Validate a work-order request + produce the file contents and the per-report priority stamps (1..N in the
 * given order). Pure — the whole testable surface of /__bugboard/work-order.
 */
export function planWorkOrderWrite(
  body: unknown,
  now: Date = new Date(),
): { error: string } | { file: WorkOrderFile; updates: { id: string; priority: number }[] } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  const { orderedReportIds, notes } = body as { orderedReportIds?: unknown; notes?: unknown };
  if (!Array.isArray(orderedReportIds) || orderedReportIds.length === 0) return { error: 'orderedReportIds must be a non-empty array' };
  if (orderedReportIds.length > 500) return { error: 'orderedReportIds is capped at 500' };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of orderedReportIds) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return { error: 'orderedReportIds must be report UUIDs' };
    if (seen.has(id)) return { error: `duplicate report id in order: ${id}` };
    seen.add(id);
    ids.push(id);
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 4000)) return { error: 'notes must be a string ≤ 4000 chars' };
  const trimmed = typeof notes === 'string' ? notes.trim() : '';
  const file: WorkOrderFile = {
    generatedAt: now.toISOString(),
    orderedReportIds: ids,
    ...(trimmed ? { notes: trimmed } : {}),
  };
  return { file, updates: ids.map((id, i) => ({ id, priority: i + 1 })) };
}

/** Per-fingerprint row counts (a count > 1 means the same incident was reported repeatedly). Pure. */
export function dupeCountsOf(rows: { fingerprint?: string | null }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const f = r.fingerprint;
    if (typeof f === 'string' && f.length > 0) counts[f] = (counts[f] ?? 0) + 1;
  }
  return counts;
}

/* ────────────────────────────────────── the dev-server shell ────────────────────────────────────── */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const ROOT_ENV_PATH = path.join(REPO_ROOT, '.env');
const WEB_ENV_PATH = path.join(HERE, '.env');
const WORK_ORDER_DIR = path.join(REPO_ROOT, '.local', 'bug-reports');
const WORK_ORDER_PATH = path.join(WORK_ORDER_DIR, 'work-order.json');

interface BoardConfig { url: string; serviceKey: string }

/** Load Supabase config from the two .env files. Structured error (the UI's setup hint), never a throw. */
async function loadConfig(): Promise<{ error: string; hint: string } | BoardConfig> {
  let serviceKey: string | undefined;
  try {
    serviceKey = parseEnvFile(await readFile(ROOT_ENV_PATH, 'utf8')).SUPABASE_SERVICE_ROLE_KEY;
  } catch { /* missing root .env — reported below */ }
  let url: string | undefined = process.env.VITE_SUPABASE_URL;
  try {
    url = parseEnvFile(await readFile(WEB_ENV_PATH, 'utf8')).VITE_SUPABASE_URL ?? url;
  } catch { /* missing apps/web/.env — reported below */ }
  if (!serviceKey) {
    return { error: 'not_configured', hint: 'add SUPABASE_SERVICE_ROLE_KEY to .env at the repo root (untracked — never commit it)' };
  }
  if (!url) return { error: 'not_configured', hint: 'add VITE_SUPABASE_URL to apps/web/.env' };
  return { url: url.replace(/\/$/, ''), serviceKey };
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

/** PostgREST call with the service key. Returns the parsed body (or throws with the REST error text). */
async function rest(cfg: BoardConfig, pathAndQuery: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: cfg.serviceKey,
      Authorization: `Bearer ${cfg.serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function bugBoardPlugin(): Plugin {
  return {
    name: 'bug-board',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__bugboard/list', (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          if (req.method !== 'GET') { send(res, 405, { error: 'method_not_allowed' }); return; }
          const cfg = await loadConfig();
          if ('error' in cfg) { send(res, 503, cfg); return; }
          try {
            const rows = await rest(cfg,
              `bug_reports?select=${LIST_COLUMNS.join(',')}&order=priority.asc.nullslast,created_at.desc&limit=1000`,
              { headers: { Prefer: 'return=representation' } }) as { fingerprint?: string | null }[];
            send(res, 200, { rows, dupeCounts: dupeCountsOf(rows) });
          } catch (e) {
            send(res, 502, { error: 'supabase_error', detail: (e as Error).message });
          }
        })();
      });

      server.middlewares.use('/__bugboard/update', (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          if (req.method !== 'POST') { send(res, 405, { error: 'method_not_allowed' }); return; }
          const cfg = await loadConfig();
          if ('error' in cfg) { send(res, 503, cfg); return; }
          try {
            const plan = validateUpdate(await readBody(req));
            if ('error' in plan) { send(res, 400, plan); return; }
            await rest(cfg, `bug_reports?id=eq.${plan.id}`, { method: 'PATCH', body: JSON.stringify(plan.patch) });
            send(res, 200, { ok: true });
          } catch (e) {
            send(res, 502, { error: 'supabase_error', detail: (e as Error).message });
          }
        })();
      });

      server.middlewares.use('/__bugboard/work-order', (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          if (req.method !== 'POST') { send(res, 405, { error: 'method_not_allowed' }); return; }
          const cfg = await loadConfig();
          if ('error' in cfg) { send(res, 503, cfg); return; }
          try {
            const plan = planWorkOrderWrite(await readBody(req));
            if ('error' in plan) { send(res, 400, plan); return; }
            // Stamp priorities in Supabase FIRST (the durable copy), then write the local handoff file.
            for (const u of plan.updates) {
              await rest(cfg, `bug_reports?id=eq.${u.id}`, { method: 'PATCH', body: JSON.stringify({ priority: u.priority }) });
            }
            await mkdir(WORK_ORDER_DIR, { recursive: true });
            await writeFile(WORK_ORDER_PATH, `${JSON.stringify(plan.file, null, 2)}\n`);
            send(res, 200, { ok: true, path: '.local/bug-reports/work-order.json', count: plan.updates.length });
          } catch (e) {
            send(res, 502, { error: 'supabase_error', detail: (e as Error).message });
          }
        })();
      });
    },
  };
}
