/**
 * Shared plumbing for the `db:*` scripts (Supabase cleanup Phase 0, docs/design/2026-10-28-supabase-cleanup.md).
 *
 * Every query goes through the pinned Supabase CLI (`supabase db query --linked`, the Management API), so the scripts
 * need the same login the lead already uses and never hold a database password. READ-ONLY by default: the text is
 * prefixed with `set default_transaction_read_only = on`, so a stray write fails instead of landing. Only
 * `apply.mjs` opts out, and only for the file it was told to apply plus its own ledger insert.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'zcwhbejpqcdcfdpfxeza';
export const CLI = process.env.SUPABASE_CLI || 'supabase@2.120.0';

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
/** A file's ledger hash: line endings normalized, so a CRLF checkout and an LF checkout agree. */
export const fileSha = (f) => sha256(fs.readFileSync(f, 'utf8').split('\r\n').join('\n'));

/**
 * Run SQL against the linked project and return the LAST statement's rows (the CLI's JSON output).
 * `readOnly: false` is reserved for `db:apply`.
 */
export function runSql(sql, { readOnly = true } = {}) {
  const text = readOnly ? `set default_transaction_read_only = on;\n${sql}` : sql;
  const tmp = path.join(os.tmpdir(), `ascent-db-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(tmp, text);
  try {
    const args = ['--yes', CLI, 'db', 'query', '--linked', '--project-ref', PROJECT_REF, '--output-format', 'json', '--agent', 'no', '-f', tmp];
    const r = spawnSync('npx', args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) {
      const msg = [r.stdout, r.stderr].filter(Boolean).join('\n').replace(/^Initialising login role\.\.\.\s*$/m, '').trim();
      throw new Error(`supabase db query failed (exit ${r.status}): ${msg}`);
    }
    const out = r.stdout.trim();
    const start = out.indexOf('[');
    if (start < 0) return [];
    return JSON.parse(out.slice(start));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** One JSON value from a query written as `select <jsonb expr> as v`. */
export function runJson(sql) {
  const rows = runSql(sql);
  const v = rows[0]?.v;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

export const arg = (argv, k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
export const flag = (argv, k) => argv.includes(`--${k}`);
export const today = () => new Date().toISOString().slice(0, 10);

/** The repo's SQL history in the order the drift check reads it: schema.sql first, then migrations by filename. */
export function repoSqlFiles(root = ROOT) {
  const dir = path.join(root, 'supabase/migrations');
  return [
    path.join(root, 'schema.sql'),
    ...fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(dir, f)),
  ].filter((f) => fs.existsSync(f));
}

/** Repo-relative, forward slashes: the ledger's `file` key. */
export const relFile = (f, root = ROOT) => path.relative(root, f).split(path.sep).join('/');

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)} GB`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} MB`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)} kB`;
  return `${v} B`;
}
export const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
export const fmtMs = (n) => { const v = Number(n) || 0; return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v.toFixed(0)} ms`; };

/** A markdown table from rows + [header, cell(row)] columns. */
export function mdTable(rows, cols) {
  const head = `| ${cols.map((c) => c[0]).join(' | ')} |`;
  const sep = `|${cols.map((c) => (c[2] === 'r' ? '---:' : '---')).join('|')}|`;
  const body = rows.map((r) => `| ${cols.map((c) => String(c[1](r)).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}
