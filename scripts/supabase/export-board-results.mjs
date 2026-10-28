#!/usr/bin/env node
/**
 * ARCHIVE `board_results` (Supabase cleanup P1.4, owner ruling 2026-10-28: "archive and stop reading it").
 *
 * READ-ONLY one-off for the lead to run. It sends ONE `select` (no writes, no DDL) through the Supabase CLI against the
 * linked project, and writes the whole table to the repo's gitignored `exports/` folder:
 *
 *   exports/board_results-<date>.json   every row, every column, ordered by id
 *   exports/board_results-<date>.csv    the same rows as CSV (header = the column names)
 *
 * It checks the export against the server's own row count, max id and md5 of the dump before writing, and prints them.
 * Dropping the table is a LATER phase; this script never touches it.
 *
 *   node scripts/supabase/export-board-results.mjs                 # linked project (supabase link was run)
 *   node scripts/supabase/export-board-results.mjs --project-ref <ref>
 *   node scripts/supabase/export-board-results.mjs --input saved.json   # parse a saved CLI answer (no network)
 *   [--out <dir>]  (default: exports)
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(arg('out', 'exports'));
const INPUT = arg('input', '');
const REF = arg('project-ref', '');
const CLI = 'supabase@2.120.0';

// ONE statement, a SELECT. The table is ~4.6k rows / ~1 MB, so the whole of it travels as one json value; the count,
// max id and md5 are computed by the server over the SAME text, so the file can be checked byte for byte.
const SQL = `
with d as (select coalesce(json_agg(t order by t.id), '[]'::json)::text as dump from public.board_results t)
select (select count(*) from public.board_results) as row_count,
       (select max(id) from public.board_results) as max_id,
       md5(d.dump) as dump_md5,
       d.dump
  from d;
`.trim();

/** Find the first object carrying a `dump` key anywhere in the CLI's JSON answer (its envelope differs by version). */
function findRow(v) {
  if (!v || typeof v !== 'object') return null;
  if (!Array.isArray(v) && typeof v.dump === 'string') return v;
  for (const x of Array.isArray(v) ? v : Object.values(v)) { const hit = findRow(x); if (hit) return hit; }
  return null;
}

function runQuery() {
  if (INPUT) return fs.readFileSync(INPUT, 'utf8');
  const sqlFile = path.join(OUT, '.board_results-export.sql');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(sqlFile, SQL);
  const cliArgs = ['--yes', CLI, 'db', 'query', '--linked', ...(REF ? ['--project-ref', REF] : []), '-f', sqlFile, '-o', 'json'];
  try {
    return execFileSync('npx', cliArgs, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  } finally {
    fs.rmSync(sqlFile, { force: true });
  }
}

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const raw = runQuery();
const start = raw.search(/[[{]/);
if (start < 0) throw new Error('The CLI answer has no JSON in it:\n' + raw.slice(0, 500));
const row = findRow(JSON.parse(raw.slice(start)));
if (!row) throw new Error('No row with a `dump` column in the CLI answer:\n' + raw.slice(0, 500));

const md5 = createHash('md5').update(row.dump, 'utf8').digest('hex');
const rows = JSON.parse(row.dump);
const count = Number(row.row_count);
const maxId = row.max_id === null ? null : Number(row.max_id);
if (md5 !== row.dump_md5) throw new Error(`md5 mismatch: server ${row.dump_md5}, received ${md5}`);
if (rows.length !== count) throw new Error(`row count mismatch: server ${count}, received ${rows.length}`);
const gotMax = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
if (count > 0 && gotMax !== maxId) throw new Error(`max id mismatch: server ${maxId}, received ${gotMax}`);

const date = new Date().toISOString().slice(0, 10);
fs.mkdirSync(OUT, { recursive: true });
const jsonFile = path.join(OUT, `board_results-${date}.json`);
const csvFile = path.join(OUT, `board_results-${date}.csv`);
fs.writeFileSync(jsonFile, JSON.stringify({ table: 'public.board_results', exportedAt: new Date().toISOString(), rowCount: count, maxId, dumpMd5: md5, rows }, null, 0));
const cols = [...rows.reduce((set, r) => { for (const k of Object.keys(r)) set.add(k); return set; }, new Set())];
fs.writeFileSync(csvFile, [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n');

console.log(`board_results archived: ${count} rows, max id ${maxId}, md5 ${md5}`);
console.log(`  ${path.relative(process.cwd(), jsonFile)} (${fs.statSync(jsonFile).size} B)`);
console.log(`  ${path.relative(process.cwd(), csvFile)} (${fs.statSync(csvFile).size} B)`);
