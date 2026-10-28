#!/usr/bin/env node
/**
 * `npm run db:drift` — does the live database run the functions the repo says it runs? (Supabase cleanup 0.2,
 * docs/design/2026-10-28-supabase-cleanup.md section 5.)
 *
 * For every function in `public` it compares the live body (`pg_proc.prosrc`) with the LAST definition of that name in
 * the repo's SQL history (schema.sql, then supabase/migrations/*.sql in filename order). Both sides are normalized the
 * same way: `--` comments and all whitespace stripped (bodies are often applied with comments removed, so a raw byte
 * compare reports false drift), then md5. Verdicts:
 *
 *   OK        live = the repo's last definition
 *   OLDER     live = an EARLIER repo definition (a stale overload, or files applied out of filename order)
 *   NOMATCH   live matches no repo definition at all (edited by hand in production)
 *   NOREPO    a live function the repo never defines
 *   NOTLIVE   the repo's last word creates a function production does not have (a migration not applied yet)
 *
 * Known, explained exceptions live in scripts/supabase/drift-known.json (`"<VERDICT> <name>": "why"`). The script
 * exits 1 on any finding NOT in that file, so it can gate an apply or run nightly. Read-only.
 *
 *   npm run db:drift [-- --verbose] [--live <tsv-or-json from an earlier pull>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, arg, flag, md5, relFile, repoSqlFiles, runSql } from './lib.mjs';

const argv = process.argv.slice(2);
const VERBOSE = flag(argv, 'verbose');
const KNOWN_FILE = path.join(ROOT, 'scripts/supabase/drift-known.json');

/** Comments + whitespace out, exactly as the live query does it (`[[:space:]]` = these six). */
export const normalizeBody = (s) => s.replace(/--[^\n]*/g, '').replace(/[ \t\r\n\f\v]+/g, '');

/**
 * Every `create [or replace] function [public.]name(` in a SQL text, with its normalized body md5, in text order.
 * Also every `drop function [if exists] [public.]name` (a later drop retires the name from the repo's last word).
 */
export function repoDefinitions(text) {
  const out = [];
  const re = /\b(create\s+(?:or\s+replace\s+)?function|drop\s+function(?:\s+if\s+exists)?)\s+(?:public\.)?"?([a-z_0-9]+)"?(\s*\()?/gi;
  let m;
  while ((m = re.exec(text))) {
    const name = m[2].toLowerCase();
    // Prose in a `--` comment ("we drop function x here") is not a definition.
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    if (text.slice(lineStart, m.index).includes('--')) continue;
    if (/^create/i.test(m[1]) && !m[3]) continue;
    if (/^drop/i.test(m[1])) { out.push({ name, kind: 'drop', at: m.index }); continue; }
    const rest = text.slice(m.index, m.index + 400_000);
    const dq = /(\$[a-z_0-9]*\$)/i.exec(rest);
    if (!dq) continue;
    const start = dq.index + dq[1].length;
    const end = rest.indexOf(dq[1], start);
    if (end < 0) continue;
    out.push({ name, kind: 'create', at: m.index, md5: md5(normalizeBody(rest.slice(start, end))) });
  }
  return out;
}

/** name -> ordered [{file, md5}] + the set of names whose last word in the repo is a drop. */
export function repoIndex(files) {
  const defs = new Map();
  const lastWord = new Map();
  for (const f of files) {
    for (const d of repoDefinitions(fs.readFileSync(f, 'utf8'))) {
      lastWord.set(d.name, d.kind);
      if (d.kind !== 'create') continue;
      if (!defs.has(d.name)) defs.set(d.name, []);
      defs.get(d.name).push({ file: relFile(f), md5: d.md5 });
    }
  }
  return { defs, dropped: new Set([...lastWord].filter(([, k]) => k === 'drop').map(([n]) => n)) };
}

/** Classify live rows ({proname, args, md5}) against the repo index. */
export function classify(live, { defs, dropped }) {
  const findings = [];
  let ok = 0;
  const liveNames = new Set();
  for (const r of live) {
    liveNames.add(r.proname);
    const d = defs.get(r.proname);
    if (!d) { findings.push({ verdict: 'NOREPO', name: r.proname, args: r.args }); continue; }
    if (d[d.length - 1].md5 === r.md5) { ok++; continue; }
    const hit = d.findLastIndex((x) => x.md5 === r.md5);
    if (hit >= 0) findings.push({ verdict: 'OLDER', name: r.proname, args: r.args, live: d[hit].file, repoLast: d[d.length - 1].file, defs: d.length });
    else findings.push({ verdict: 'NOMATCH', name: r.proname, args: r.args, repoLast: d[d.length - 1].file, defs: d.length });
  }
  for (const [name, d] of defs) {
    if (!liveNames.has(name) && !dropped.has(name)) findings.push({ verdict: 'NOTLIVE', name, repoLast: d[d.length - 1].file });
  }
  return { ok, findings };
}

function pullLive() {
  const from = arg(argv, 'live', '');
  if (from) return JSON.parse(fs.readFileSync(from, 'utf8'));
  return runSql(`
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       md5(regexp_replace(regexp_replace(p.prosrc, '--[^\\n]*', '', 'g'), '[[:space:]]+', '', 'g')) as md5
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prokind in ('f', 'p')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
order by 1, 2;`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const live = pullLive();
  const { ok, findings } = classify(live, repoIndex(repoSqlFiles()));
  const known = fs.existsSync(KNOWN_FILE) ? JSON.parse(fs.readFileSync(KNOWN_FILE, 'utf8')) : {};
  const keyOf = (f) => `${f.verdict} ${f.name}`;
  const fresh = findings.filter((f) => !(keyOf(f) in known));
  const stale = Object.keys(known).filter((k) => !k.startsWith('_') && !findings.some((f) => keyOf(f) === k));
  const line = (f) => `${f.verdict.padEnd(7)} ${f.name}(${(f.args ?? '').slice(0, 60)})${f.live ? ` live=${f.live}` : ''}${f.repoLast ? ` repo-last=${f.repoLast}` : ''}${f.defs ? ` (${f.defs} defs)` : ''}`;

  console.log(`db:drift: ${live.length} live functions; ${ok} = the repo's last definition; ${findings.length} findings (${findings.length - fresh.length} known, ${fresh.length} new)`);
  if (VERBOSE) for (const f of findings.filter((x) => keyOf(x) in known)) console.log(`  known   ${line(f)}  # ${known[keyOf(f)]}`);
  for (const f of fresh) console.log(`  NEW     ${line(f)}`);
  for (const k of stale) console.log(`  resolved (remove from drift-known.json): ${k}`);
  process.exit(fresh.length ? 1 : 0);
}
