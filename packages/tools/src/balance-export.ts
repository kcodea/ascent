/**
 * FULL balance-report export (owner ask 2026-08-08). `npm run report` prints a readable table; this writes the
 * SAME report — every row, no truncation, every raw counter — to machine-readable files you can sort, diff or
 * drop into a spreadsheet.
 *
 *   npm run report:export                 (30 games/hero, default pilot, → ./balance-export/)
 *   npm run report:export -- 60           (60 games/hero)
 *   npm run report:export -- 60 meta      (…piloted by the `meta` bot)
 *   npm run report:export -- 60 meta out  (…written to ./out/)
 *
 * Emits, for one run of the simulation:
 *   balance-report.json   the whole `BalanceReport` verbatim + a run header (games, pilot, totals, timestamp)
 *   balance-<table>.csv   one CSV per table (heroes / quests / runes / minions / spells)
 *
 * Deliberately shares `computeBalanceReport` with the CLI and the in-app dev panel, so the exported numbers
 * are the SAME numbers those show — a divergent export would be worse than none. Read the caveats in
 * `balanceReport.ts`: rates are co-occurrence over BOT games, so treat them as a package signal, not as
 * isolated card power.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBalanceReport, BOT_BY_ID, BOTS, DEFAULT_BOT, type BalanceReport, type ReportRow } from '@game/sim';

const GAMES = Math.max(1, Number(process.argv[2] ?? 30) | 0);
const BOT_ARG = process.argv[3];
const OUT_DIR = process.argv[4] ?? 'balance-export';

const bot = BOT_ARG ? BOT_BY_ID[BOT_ARG] : DEFAULT_BOT;
if (BOT_ARG && !bot) {
  console.error(`Unknown bot "${BOT_ARG}". Available: ${BOTS.map((b) => b.id).join(', ')}`);
  process.exit(1);
}
const policy = bot ?? DEFAULT_BOT;

console.log(`Simulating ${GAMES} games/hero · pilot: ${policy.name}…`);
const started = Date.now();
const report: BalanceReport = computeBalanceReport(GAMES, policy);
const elapsedMs = Date.now() - started;

mkdirSync(OUT_DIR, { recursive: true });

/** RFC-4180 escaping: quote when the value holds a comma, quote or newline; double any inner quotes. */
const cell = (v: string | number): string => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One table → CSV. Raw counters come FIRST so the file is useful even if the derived rates are ignored;
 *  a rate of −1 means "no denominator" (never offered / never played) and is written as an empty cell so a
 *  spreadsheet doesn't average a sentinel into the data. */
function csv(rows: ReportRow[]): string {
  const head = ['id', 'name', 'offered', 'picked', 'games', 'wins', 'offerRate', 'pickRate', 'winRate'];
  const body = rows.map((r) => [
    r.id, r.name, r.offered, r.picked, r.games, r.wins,
    r.offerRate < 0 ? '' : r.offerRate,
    r.pickRate < 0 ? '' : r.pickRate,
    r.winRate < 0 ? '' : r.winRate,
  ].map(cell).join(','));
  return [head.join(','), ...body].join('\n') + '\n';
}

const tables: [string, ReportRow[]][] = [
  ['heroes', report.heroes],
  ['quests', report.quests],
  ['runes', report.runes],
  ['minions', report.minions],
  ['spells', report.spells],
];

const meta = {
  generatedAt: new Date(started).toISOString(),
  gamesPerHero: report.gamesPerHero,
  totalRuns: report.totalRuns,
  pilot: { id: policy.id, name: policy.name },
  elapsedMs,
  rowCounts: Object.fromEntries(tables.map(([n, rows]) => [n, rows.length])),
  caveats: [
    'Rates are co-occurrence over BOT-piloted games, not isolated card power (no ablation).',
    'winRate credits every card on the final board of a winning run.',
    'A rate of -1 in JSON (empty in CSV) means no denominator: never offered, or never played.',
    'Spell and rune samples are thinner than minions — one spell offer per shop, runes at turn 6.',
    'SPELLS have no winRate by construction: win credit is awarded to the FINAL BOARD, and a cast spell is '
      + 'never on it. Read the spell offered/picked columns (pickRate = bot take-up), not its wins.',
  ],
};

writeFileSync(join(OUT_DIR, 'balance-report.json'), JSON.stringify({ meta, report }, null, 2));
for (const [name, rows] of tables) writeFileSync(join(OUT_DIR, `balance-${name}.csv`), csv(rows));

const totalRows = tables.reduce((n, [, rows]) => n + rows.length, 0);
console.log(`\nWrote ${tables.length + 1} files to ${OUT_DIR}/ — ${totalRows} rows across ${tables.length} tables`);
for (const [name, rows] of tables) console.log(`  balance-${name}.csv`.padEnd(28) + `${rows.length} rows`);
console.log(`  balance-report.json`.padEnd(28) + `full report + header`);
console.log(`\n${report.totalRuns} runs simulated in ${(elapsedMs / 1000).toFixed(1)}s · pilot ${policy.name}`);
