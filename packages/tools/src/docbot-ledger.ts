/**
 * `npm run docbot:ledger [-- --in <dir> ...]` — DOC BOT 2.0 WP G, blueprint §12.3.
 *
 * Folds every `findings.json` it can find into ONE ledger keyed by fingerprint, so the two questions the
 * workbench inbox has to answer finally have a substrate: *is this new?* and *how long has this stood?*
 *
 * Inputs (all optional, all additive):
 *   --in <dir>       a directory to scan for `findings.json` (repeatable). Defaults to `artifacts/` — the
 *                    nightly's output root and where the `--out` sweeps land.
 *   --file <path>    a single findings.json (repeatable).
 *   --ledger <path>  the ledger to grow (default `.local/docbot/ledger.json`).
 *   --date <YYYY-MM-DD>  the sighting date for THIS fold (default today). Explicit so a backfill of older
 *                    artifacts records honest first-seen dates instead of stamping everything "today".
 *   --print [n]      print the n most-recently-seen entries (default 20) after folding.
 *   --dry-run        fold and report, write nothing.
 *
 * THE LEDGER IS DERIVED (§4.6). It lives in the gitignored `.local/docbot/`, is rebuildable from artifacts
 * alone, and is NEVER hand-edited — `foldLedger` is the only writer, and it is pure + order-insensitive
 * (`ledger.test.ts` proves both, including that two identical findings fold to one entry).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  DECISIONS, } from '@game/rules';
import {
  bucketOf, emitLedgerJson, foldLedger, parseLedger, summarizeFold,
  type DocbotFinding, type LedgerBatch, type LedgerFile,
} from '@game/sim';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(`--${name}`);
const all = (name: string): string[] => {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === `--${name}` && argv[i + 1] && !argv[i + 1]!.startsWith('--')) out.push(argv[i + 1]!);
  });
  return out;
};

const LEDGER_PATH = flag('ledger') ?? join('.local', 'docbot', 'ledger.json');
const date = flag('date') ?? new Date().toISOString().slice(0, 10);
const dirs = all('in');
const files = all('file');
if (dirs.length === 0 && files.length === 0) dirs.push('artifacts');

/** Every `findings.json` under `root`, depth-first, sorted — the fold order must not depend on the FS. */
function findFindingsFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'findings.json') out.push(p);
    }
  };
  if (statSync(root).isDirectory()) walk(root);
  return out.sort();
}

const paths = [...new Set([...dirs.flatMap(findFindingsFiles), ...files])].sort();
if (paths.length === 0) {
  console.log(`no findings.json found under ${[...dirs, ...files].join(', ')} — nothing to fold.`);
  console.log('  Produce some: `npm run docbot:contracts -- --out artifacts/docbot-contracts`');
  process.exit(0);
}

/** The batch label: the artifact directory's own name ('docbot-nightly', 'docbot-contracts', …). */
const labelOf = (p: string): string => {
  const parent = dirname(p);
  const name = parent.split(/[\\/]/).filter(Boolean).pop() ?? parent;
  return name === '.' ? 'findings' : name;
};

const batches: LedgerBatch[] = [];
const readErrors: string[] = [];
for (const p of paths) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, 'utf8'));
    if (!Array.isArray(parsed)) {
      readErrors.push(`${p}: findings.json must be a JSON ARRAY of DocbotFinding`);
      continue;
    }
    batches.push({ source: labelOf(p), date, findings: parsed as DocbotFinding[] });
  } catch (err) {
    readErrors.push(`${p}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
// §4.3 — an unreadable artifact is reported, never silently skipped into a clean-looking fold.
if (readErrors.length > 0) {
  console.error('UNREADABLE ARTIFACTS (not folded):');
  for (const e of readErrors) console.error(`  ✕ ${e}`);
}

let previous: LedgerFile | null = null;
if (existsSync(LEDGER_PATH)) {
  const { ledger, errors } = parseLedger(readFileSync(LEDGER_PATH, 'utf8'));
  if (errors.length > 0) {
    console.error(`existing ledger at ${LEDGER_PATH} is unusable — refusing to overwrite it:`);
    for (const e of errors) console.error(`  ✕ ${e}`);
    process.exit(1);
  }
  previous = ledger ?? null;
}

const decidedRuleIds = new Set(Object.keys(DECISIONS as Record<string, unknown>));
const next = foldLedger({ previous, batches, generatedAt: new Date().toISOString(), decidedRuleIds });
const summary = summarizeFold(previous, next, batches);

console.log(`\nDOCBOT LEDGER — folded ${summary.batchesFolded} batch(es), ${summary.findingsRead} finding(s) read`);
for (const b of batches) console.log(`  · ${b.source} (${b.date}) — ${b.findings.length} finding(s)`);
console.log(`\n  entries: ${summary.entriesBefore} → ${summary.entriesAfter} (${summary.newFingerprints.length} new fingerprint(s))`);

const buckets = new Map<string, number>();
for (const e of next.entries) buckets.set(bucketOf(e), (buckets.get(bucketOf(e)) ?? 0) + 1);
console.log(`  §15.1 buckets: ${[...buckets.entries()].sort().map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'}`);

if (has('print')) {
  const n = Number(flag('print') ?? '20') || 20;
  const rows = [...next.entries].sort((a, b) => (a.lastSeen.date < b.lastSeen.date ? 1 : -1)).slice(0, n);
  console.log(`\n  most recently seen (${rows.length}):`);
  for (const e of rows) {
    console.log(`    ${e.fingerprint}  ${bucketOf(e).padEnd(21)} ×${String(e.occurrences).padStart(3)}  ${e.lane} — ${e.title.slice(0, 80)}`);
  }
}

if (has('dry-run')) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}
mkdirSync(dirname(LEDGER_PATH), { recursive: true });
writeFileSync(LEDGER_PATH, emitLedgerJson(next));
console.log(`\n  ledger → ${LEDGER_PATH} (gitignored, derived — never hand-edit it)\n`);
