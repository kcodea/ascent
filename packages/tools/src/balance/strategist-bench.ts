/**
 * `npm run balance:strategist-bench [-- --seeds 20 --start 100 --set set2 --explore rotate|0 --heroes fibbsy,flint,tiff]`
 *
 * B4 — the strategist's mixed self-play benchmark (four strategist + four generalist seats per lobby, smoke budget)
 * with a lobby-level 95% interval on the paired placement advantage, and the line-diversity census for the
 * exploration population. Prints; writes nothing. The same numbers gate `strategy/benchmark.test.ts` at a smaller
 * seed count.
 */
import { lineDiversity, renderLineDiversity, renderMixedBenchmark, runMixedBenchmark } from '@game/sim/balance/strategy/benchmark';
import { renderPackageCensus } from '@game/sim/balance/strategy/packages';
import type { SetId } from '@game/content';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string): string => { const i = args.indexOf(`--${name}`); return i >= 0 && args[i + 1] ? args[i + 1]! : dflt; };
const setId = opt('set', 'set2') as SetId;
const count = Number(opt('seeds', '20'));
const start = Number(opt('start', '100'));
const exploreArg = opt('explore', '0');
const exploration = exploreArg === 'rotate' ? 'rotate' as const : Number(exploreArg);
const heroes = opt('heroes', 'fibbsy,flint,tiff').split(',').filter(Boolean);
const seeds = Array.from({ length: count }, (_, i) => start + i);

console.log(renderPackageCensus(setId));
console.log('');
const r = runMixedBenchmark({ setId, seeds, exploration });
console.log(renderMixedBenchmark(r, `strategist(${exploreArg}) vs generalist, ${setId}, seeds ${start}…${start + count - 1}`));
console.log('');
console.log(`[b4 line diversity] exploration population (strategist:rotate), 30 seeds per hero, ${setId}`);
console.log(renderLineDiversity(lineDiversity(heroes, Array.from({ length: 30 }, (_, i) => 1 + i), setId)));
if (r.advantage.hi < 0) {
  console.error('\nSTRATEGIST REGRESSION: the paired advantage interval sits wholly below 0 — diagnose before shipping.');
  process.exitCode = 1;
}
