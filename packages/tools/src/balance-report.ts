/**
 * Dev balance report (owner request 2026-07-13) — the CLI front end. Runs many seeded bot games across every
 * pickable hero and tallies OFFER / PICK / WIN rate for heroes, quests, runes, minions, and spells. Run with:
 *   npm run report            (default games/hero)
 *   npm run report -- 60      (60 games per hero)
 *
 * The actual sim + tally lives in `@game/sim` (`computeBalanceReport`) so the in-app dev panel and this CLI
 * share ONE implementation and produce identical numbers. This file is just argv + formatting; see
 * `balanceReport.ts` for the method + caveats.
 */
import { computeBalanceReport, BOT_BY_ID, BOTS, DEFAULT_BOT, type ReportRow } from '@game/sim';

// Usage: npm run report [games] [bot]  e.g.  npm run report -- 30 meta
// `bot` is one of the roster ids (greedy | tempo | midrange | meta); omitted = the default greedy bot.
const GAMES = Math.max(1, Number(process.argv[2] ?? 30) | 0);
const BOT_ARG = process.argv[3];
const bot = BOT_ARG ? BOT_BY_ID[BOT_ARG] : DEFAULT_BOT;
if (BOT_ARG && !bot) {
  console.error(`Unknown bot "${BOT_ARG}". Available: ${BOTS.map((b) => b.id).join(', ')}`);
  process.exit(1);
}
const policy = bot ?? DEFAULT_BOT;
const report = computeBalanceReport(GAMES, policy);

console.log(`\n=== ASCENT — dev balance report ===`);
console.log(`${GAMES} games/hero × ${report.heroes.length} heroes = ${report.totalRuns} runs · pilot: ${policy.name} (see header caveats)\n`);

const pct = (n: number): string => (n < 0 ? '  –  ' : `${String(n).padStart(3)}%`);

function table(title: string, rows: ReportRow[]): void {
  console.log(`── ${title} ──`);
  console.log(`  ${'name'.padEnd(26)} ${'offer'.padStart(6)} ${'pick'.padStart(6)} ${'win'.padStart(6)}  (n)`);
  for (const r of rows) {
    const offer = r.offerRate < 0 ? String(r.offered).padStart(5) : pct(r.offerRate);
    console.log(`  ${r.name.slice(0, 26).padEnd(26)} ${offer.padStart(6)} ${pct(r.pickRate).padStart(6)} ${pct(r.winRate).padStart(6)}  (${r.games})`);
  }
  console.log('');
}

// Heroes: no "offer/pick" (each is played a fixed number of games); show win rate only.
console.log(`── heroes (win rate over ${GAMES} games each) ──`);
report.heroes.forEach((r) => console.log(`  ${r.name.slice(0, 26).padEnd(26)} ${pct(r.winRate)}  (${r.wins}/${r.games})`));
console.log('');

table('quests (offer = % of runs offered · pick = greedy-bot take · win = when picked)', report.quests);
table('runes (offer = % of runs offered · win = when picked)', report.runes);
table('minions (offer = % of runs seen in shop · pick = bought/seen · win = when on final board)', report.minions);
table('spells (offer = % of runs seen in shop · pick = bought/seen · win = when on final board)', report.spells);
