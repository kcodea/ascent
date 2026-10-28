#!/usr/bin/env node
/**
 * `npm run db:apply -- <file.sql> --yes` — apply ONE SQL file to production and record it in `ops.schema_ledger`
 * (Supabase cleanup 0.3, docs/design/2026-10-28-supabase-cleanup.md section 5.2).
 *
 *   npm run db:apply -- supabase/migrations/<file>.sql            dry run: prints what would happen, changes nothing
 *   npm run db:apply -- supabase/migrations/<file>.sql --yes      applies, records, then runs db:drift
 *   ... --record-only --yes   records a file that was already applied by hand (SQL Editor) without running it
 *   ... --force               re-applies a file the ledger already holds at the same content
 *   ... --note "<text>"       stored with the ledger row
 *
 * The LEAD runs this (owner rule: builders write migrations, never apply them). The ledger row is written right after
 * the file succeeds; if that insert fails the script prints the exact SQL to record it by hand. The file and its ledger
 * row are not one transaction on purpose: a migration manages its own `begin/commit`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, arg, fileSha, flag, relFile, runSql } from './lib.mjs';
import { dq } from './ledger.mjs';

const argv = process.argv.slice(2);
const target = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--note');
if (!target) { console.error('usage: npm run db:apply -- <file.sql> [--yes] [--record-only] [--force] [--note "..."]'); process.exit(2); }
const file = path.resolve(ROOT, target);
if (!fs.existsSync(file) || !file.endsWith('.sql')) { console.error(`db:apply: no such .sql file: ${target}`); process.exit(2); }
const rel = relFile(file);
if (!rel.startsWith('supabase/')) { console.error(`db:apply: only files under supabase/ are applied (got ${rel})`); process.exit(2); }

const sha = fileSha(file);
const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout?.trim() || null;
const by = process.env.DB_APPLY_BY || git('config', 'user.name') || process.env.USERNAME || process.env.USER || 'unknown';
const commit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--', rel);
const note = arg(argv, 'note', '') + (dirty ? `${arg(argv, 'note', '') ? ' ' : ''}(file differs from HEAD)` : '');
const recordOnly = flag(argv, 'record-only');

let prior = [];
try {
  prior = runSql(`select id, sha256, applied_at, applied_by from ops.schema_ledger where file = ${dq(rel)} order by id desc;`);
} catch (e) {
  if (!/schema_ledger|ops/.test(String(e.message))) throw e;
  console.log('db:apply: ops.schema_ledger does not exist yet (expected only for the ledger migration itself).');
}
const same = prior.find((r) => r.sha256 === sha);
console.log(`db:apply: ${rel}\n  sha256 ${sha}\n  by ${by} at ${commit?.slice(0, 9) ?? '?'}${dirty ? ' (UNCOMMITTED changes in this file)' : ''}`);
for (const r of prior) console.log(`  ledger: applied ${String(r.applied_at).slice(0, 16)} by ${r.applied_by}${r.sha256 === sha ? ' (same content)' : ' (different content)'}`);
if (same && !flag(argv, 'force') && !recordOnly) { console.error('db:apply: already applied at this content. Pass --force to run it again.'); process.exit(1); }
if (same && recordOnly) { console.log('db:apply: already recorded at this content; nothing to do.'); process.exit(0); }
if (!flag(argv, 'yes')) { console.log(`db:apply: DRY RUN. Re-run with --yes to ${recordOnly ? 'record' : 'apply and record'} it.`); process.exit(0); }

if (!recordOnly) {
  console.log('db:apply: applying...');
  runSql(fs.readFileSync(file, 'utf8'), { readOnly: false });
  console.log('db:apply: applied.');
}
const insert = `insert into ops.schema_ledger (file, sha256, applied_by, commit_sha, note) values (${dq(rel)}, '${sha}', ${dq(by)}, ${commit ? `'${commit}'` : 'null'}, ${dq((recordOnly ? 'recorded (applied by hand) ' : '') + note)}) returning id;`;
try {
  const [row] = runSql(insert, { readOnly: false });
  console.log(`db:apply: recorded as ledger row ${row?.id}.`);
} catch (e) {
  console.error(`db:apply: the file ${recordOnly ? 'was not run' : 'WAS APPLIED'} but recording failed:\n${e.message}\nRecord it by hand:\n${insert}`);
  process.exit(1);
}

console.log('db:apply: drift check after the apply:');
const d = spawnSync(process.execPath, [path.join(ROOT, 'scripts/supabase/drift.mjs')], { cwd: ROOT, stdio: 'inherit' });
process.exit(d.status ?? 0);
