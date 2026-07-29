/**
 * `npm run board:elo` — rate boards by fighting them against each other.
 *
 * Produces ground-truth board strength with no hand-tuning: boards in a wave band play a full round-robin (both
 * orderings), and Bradley-Terry turns the results into ratings that account for opponent quality. Synergy needs
 * no encoding — a board whose package wins simply wins more fights.
 *
 * Writes `packages/tools/.cache/board-elo.json`, the training set for a learned board evaluator.
 *
 *   npm run board:elo                    # committed synthetic pool
 *   npm run board:elo -- --human         # real player boards (npm run boards:fetch first)
 *   npm run board:elo -- --both          # both, so the two populations can be compared directly
 *   npm run board:elo -- --cap 60        # sample opponents instead of a full round-robin
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { poolOf, createRun, rateBand, type BoardSnapshot, type RatedBoard, OPPONENT_POOL_DATA } from '@game/sim';

const argv = process.argv.slice(2);
const has = (n: string): boolean => argv.includes(`--${n}`);
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
};
const CAP = num('cap', 80);
const HUMAN = has('human') || has('both');
const SYNTH = has('both') || !has('human');

const CACHE = 'packages/tools/.cache/player-boards.json';
function humanBoards(): BoardSnapshot[] {
  if (!existsSync(CACHE)) { console.error(`no board cache — run: npm run boards:fetch`); process.exit(1); }
  return JSON.parse(readFileSync(CACHE, 'utf8')) as BoardSnapshot[];
}

// Both sides need one card pool, and it must be a real run's pinned set rather than the global index — the same
// narrowing combat applies, so a rating can't be inflated by cards the run could never draw.
const poolIds = poolOf(createRun(1, 'drakko')).all.map((c) => c.id);

const population: { label: string; boards: BoardSnapshot[] }[] = [];
if (SYNTH) population.push({ label: 'synthetic', boards: [...OPPONENT_POOL_DATA] });
if (HUMAN) population.push({ label: 'human', boards: humanBoards() });

// Bands, not exact waves: a wave-7 and a wave-8 board are comparable, and banding gives each rating enough
// opponents to be stable. Rating is only ever meaningful WITHIN a band — a strong wave-3 board is not a strong
// wave-15 board, which is the mistake raw `power` makes.
const BANDS: [number, number][] = [[1, 3], [4, 6], [7, 9], [10, 12], [13, 15], [16, 20]];
const bandOf = (w: number): number => BANDS.findIndex(([lo, hi]) => w >= lo && w <= hi);

interface Row extends RatedBoard { population: string; band: string }
const rows: Row[] = [];

for (const { label, boards } of population) {
  console.log(`\n=== ${label}: ${boards.length} boards ===`);
  console.log('band     n    fights   mean elo   spread (p10→p90)');
  for (let b = 0; b < BANDS.length; b++) {
    const inBand = boards.filter((x) => bandOf(x.wave) === b && x.minions.length > 0);
    if (inBand.length < 4) continue;
    const t0 = Date.now();
    const rated = rateBand(inBand, poolIds, CAP);
    const elos = rated.map((r) => r.elo).sort((a, z) => a - z);
    const p = (q: number): number => elos[Math.min(elos.length - 1, Math.floor(q * elos.length))]!;
    const fights = rated.reduce((a, r) => a + r.fights, 0) / 2;
    console.log(
      `${`${BANDS[b]![0]}-${BANDS[b]![1]}`.padEnd(8)} ${String(inBand.length).padStart(3)}  ` +
      `${String(fights).padStart(7)}  ${(elos.reduce((a, z) => a + z, 0) / elos.length).toFixed(0).padStart(8)}   ` +
      `${p(0.1).toFixed(0)} → ${p(0.9).toFixed(0)}   (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    for (const r of rated) rows.push({ ...r, population: label, band: `${BANDS[b]![0]}-${BANDS[b]![1]}` });
  }
}

mkdirSync('packages/tools/.cache', { recursive: true });
writeFileSync('packages/tools/.cache/board-elo.json', JSON.stringify(
  rows.map((r) => ({ population: r.population, band: r.band, elo: r.elo, score: r.score, fights: r.fights, snapshot: r.snapshot })),
));
console.log(`\nwrote ${rows.length} rated boards → packages/tools/.cache/board-elo.json`);

// Does the rating disagree with the proxies it is meant to replace? If `power` explained board strength we
// would not need any of this, so the correlation is the headline result.
const corr = (xs: number[], ys: number[]): number => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { const a = xs[i]! - mx, b = ys[i]! - my; num += a * b; dx += a * a; dy += b * b; }
  return num / Math.sqrt(Math.max(1e-9, dx * dy));
};
console.log('\n=== does raw power explain strength? (correlation with elo, within band) ===');
for (const band of [...new Set(rows.map((r) => r.band))]) {
  for (const pop of [...new Set(rows.map((r) => r.population))]) {
    const g = rows.filter((r) => r.band === band && r.population === pop);
    if (g.length < 8) continue;
    console.log(
      `  ${pop.padEnd(10)} band ${band.padEnd(6)} n=${String(g.length).padStart(3)}  ` +
      `power r=${corr(g.map((r) => r.snapshot.power), g.map((r) => r.elo)).toFixed(2)}  ` +
      `count r=${corr(g.map((r) => r.snapshot.minions.length), g.map((r) => r.elo)).toFixed(2)}`,
    );
  }
}
console.log('');
