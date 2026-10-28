#!/usr/bin/env node
/**
 * `npm run db:ledger` — which repo SQL files has production applied? (Supabase cleanup 0.3.)
 *
 * Reads `ops.schema_ledger` (created by supabase/migrations/2026-11-07-ops-schema-ledger.sql, written by
 * `npm run db:apply`) and lists every file under supabase/migrations as:
 *
 *   applied   the ledger has this file at its current sha256
 *   CHANGED   the ledger has this file, but the file was edited after it was applied
 *   PENDING   the ledger has never seen this file
 *
 *   npm run db:ledger                 status (read-only); exits 1 when anything is PENDING or CHANGED
 *   npm run db:ledger -- --seed-sql   print the pre-ledger seed rows (the evidence-based backfill the ledger
 *                                     migration carries), from the live database + the repo
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, fileSha, flag, relFile, repoSqlFiles, runSql } from './lib.mjs';
import { repoDefinitions } from './drift.mjs';

const argv = process.argv.slice(2);
export const dq = (s) => { let t = 'q'; while (s.includes(`$${t}$`)) t += 'q'; return `$${t}$${s}$${t}$`; };

/** Migration files only (schema.sql is a concatenation of the history, not something `db:apply` runs). */
export const migrationFiles = () => repoSqlFiles().filter((f) => !f.endsWith('schema.sql'));

function liveFunctions() {
  return runSql(`
select p.proname, md5(regexp_replace(regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'), '[[:space:]]+', '', 'g')) as md5
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';`);
}

/**
 * Evidence that a file reached production, from its function bodies: `live` = one of its bodies is the live body;
 * `superseded` = its bodies are not live but a later file redefines each name; `missing` = it creates a function
 * production has never had (not applied). Files that define no function are `no-functions` (assumed applied).
 */
export function fileEvidence(files, live) {
  const liveBy = new Map();
  for (const r of live) { if (!liveBy.has(r.proname)) liveBy.set(r.proname, new Set()); liveBy.get(r.proname).add(r.md5); }
  const dropped = new Set();
  const all = files.map((f) => ({ f, defs: repoDefinitions(fs.readFileSync(f, 'utf8')) }));
  for (const { defs } of all) for (const d of defs) if (d.kind === 'drop') dropped.add(d.name);
  return all.map(({ f, defs }) => {
    const creates = defs.filter((d) => d.kind === 'create');
    if (!creates.length) return { file: relFile(f), status: 'no-functions' };
    const liveHits = creates.filter((d) => liveBy.get(d.name)?.has(d.md5)).length;
    const missing = creates.filter((d) => !liveBy.has(d.name) && !dropped.has(d.name)).map((d) => d.name);
    if (missing.length) return { file: relFile(f), status: 'missing', missing: [...new Set(missing)] };
    return { file: relFile(f), status: liveHits ? 'live' : 'superseded', liveHits, creates: creates.length };
  });
}

function seedSql() {
  const ev = fileEvidence(migrationFiles(), liveFunctions());
  const rows = [];
  const skipped = [];
  for (const e of ev) {
    if (e.status === 'missing') { skipped.push(e); continue; }
    const note = e.status === 'live' ? `pre-ledger: ${e.liveHits}/${e.creates} function bodies live (db:drift 2026-10-28)`
      : e.status === 'superseded' ? 'pre-ledger: function bodies superseded by later files (db:drift 2026-10-28)'
        : 'pre-ledger: no functions, assumed applied (db:drift 2026-10-28)';
    const sha = fileSha(path.join(ROOT, e.file));
    rows.push(`  ('${e.file}', '${sha}', '${note}')`);
  }
  for (const s of skipped) console.error(`-- NOT seeded (not applied): ${s.file} (missing live: ${s.missing.join(', ')})`);
  return rows.join(',\n');
}

function status() {
  let rows;
  try {
    rows = runSql(`
select file, sha256, applied_at, applied_by from ops.schema_ledger
where id in (select max(id) from ops.schema_ledger group by file);`);
  } catch (e) {
    if (!/schema_ledger|schema "ops"/.test(String(e.message))) throw e;
    console.log('db:ledger: ops.schema_ledger does not exist yet. Apply it first:\n  npm run db:apply -- supabase/migrations/2026-11-07-ops-schema-ledger.sql --yes');
    return 1;
  }
  const by = new Map(rows.map((r) => [r.file, r]));
  let bad = 0;
  for (const f of migrationFiles()) {
    const rel = relFile(f);
    const r = by.get(rel);
    const sha = fileSha(f);
    if (!r) { bad++; console.log(`PENDING  ${rel}`); continue; }
    if (r.sha256 !== sha) { bad++; console.log(`CHANGED  ${rel} (applied ${String(r.applied_at).slice(0, 16)} by ${r.applied_by}, file edited since)`); continue; }
    if (flag(argv, 'verbose')) console.log(`applied  ${rel} (${String(r.applied_at).slice(0, 16)} ${r.applied_by})`);
  }
  const known = new Set(migrationFiles().map((f) => relFile(f)));
  for (const r of rows) if (!known.has(r.file)) console.log(`(ledger only) ${r.file}`);
  console.log(`db:ledger: ${known.size} files, ${rows.length} ledger entries, ${bad} pending/changed`);
  return bad;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (flag(argv, 'seed-sql')) console.log(seedSql());
  else process.exit(status() ? 1 : 0);
}
