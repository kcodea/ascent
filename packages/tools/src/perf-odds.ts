/**
 * Micro-benchmark for the odds probe (perf pass 2026-09-16): one-shot `computeCombatOdds` vs the largest
 * single step of `createOddsProbe`, at real greedy-bot boards from wave 2 up to wave 14.
 *
 *   npm run perf:odds
 *
 * The one-shot number is what the UI used to run as ONE synchronous block when the rIC timeout fired; the
 * step number is the new worst case an idle callback commits to before it can yield (10 sims). Same seeds, same result — `odds.test.ts`
 * pins the equality.
 */
import { performance } from 'node:perf_hooks';
import { CONFIG, createRun, reduce, computeCombatOdds, createOddsProbe, COMBAT_ODDS_SIMS, type CombatOddsInput, type RunState } from '@game/sim';

// ── the same trimmed greedy bot `perf.ts` / `odds.test.ts` use, so the boards are real play ──
const stat = (c: { attack: number; health: number }): number => c.attack + c.health;
function recruitStep(s: RunState): RunState {
  let n: RunState;
  if (s.board.length < CONFIG.boardMax && s.hand.length > 0) {
    const best = [...s.hand].sort((a, b) => stat(b) - stat(a))[0]!;
    n = reduce(s, { type: 'play', uid: best.uid });
    if (n !== s) return n;
  }
  if (s.tier < CONFIG.maxTier && s.embers >= s.upgradeCost && (s.upgradeCost <= 3 || s.board.length >= 4)) {
    n = reduce(s, { type: 'upgrade' });
    if (n !== s) return n;
  }
  if (s.embers >= CONFIG.minionCost && s.board.length + s.hand.length < CONFIG.boardMax && s.shop[0]) {
    n = reduce(s, { type: 'buy', uid: s.shop[0].uid });
    if (n !== s) return n;
  }
  return reduce(s, { type: 'faceOmen' });
}
interface OddsSample { input: CombatOddsInput; seed: number; wave: number; boardSize: number }
function harvestOddsInputs(seed: number, maxWave: number): OddsSample[] {
  let s = createRun(seed, undefined, 'practice'); // practice = invulnerable, so the greedy bot survives to a full late board
  const out: OddsSample[] = [];
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && s.wave <= maxWave && steps++ < 20000) {
    if (s.runeforgeOffer) { s = reduce(s, { type: 'skipRuneforge' }); continue; }
    if (s.questOffer) { s = reduce(s, { type: 'buyQuest', index: 0 }); continue; }
    if (s.discover) { s = reduce(s, { type: 'discover', index: 0 }); continue; }
    if (s.chooseOne) { s = reduce(s, { type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') {
      const lc = s.lastCombat;
      if (lc?.oddsInput && !lc.odds) out.push({ input: lc.oddsInput, seed: s.seed, wave: s.wave, boardSize: lc.oddsInput.player.length + lc.oddsInput.enemy.length });
      s = reduce(s, { type: 'resolveCombat' });
      continue;
    }
    const next = recruitStep(s);
    if (next === s) break; // wedged (nothing playable, End Turn refused) — keep what we have
    s = next;
  }
  return out;
}

const SLICE = 10; // matches ODDS_SLICE in Recruit.tsx
const REPS = 5;
const seeds = [11, 42, 777, 2026];
const samples = seeds.flatMap((s) => harvestOddsInputs(s, 14));

const median = (xs: number[]): number => { const a = [...xs].sort((x, y) => x - y); return a[a.length >> 1]!; };
const timeOneShot = (input: CombatOddsInput, seed: number, wave: number): number => median(Array.from({ length: REPS }, () => {
  const t = performance.now(); computeCombatOdds(input, seed, wave); return performance.now() - t;
}));
const timeMaxSlice = (input: CombatOddsInput, seed: number, wave: number): number => median(Array.from({ length: REPS }, () => {
  const probe = createOddsProbe(input, seed, wave);
  let worst = 0;
  while (!probe.done()) { const t = performance.now(); probe.step(SLICE); worst = Math.max(worst, performance.now() - t); }
  return worst;
}));

// warm the JIT on the biggest board first so the wave-2 row is not paying for compilation
{ const big = [...samples].sort((a, b) => b.boardSize - a.boardSize)[0]!; for (let i = 0; i < 3; i++) computeCombatOdds(big.input, big.seed, big.wave); }

console.log(`\n=== odds probe: one-shot (${COMBAT_ODDS_SIMS} sims) vs largest ${SLICE}-sim slice — median of ${REPS} ===`);
console.log('seed   wave  board  one-shot ms  max-slice ms');
const byWave = new Map<number, { oneShot: number[]; slice: number[] }>();
for (const { input, seed, wave, boardSize } of samples) {
  const one = timeOneShot(input, seed, wave);
  const sl = timeMaxSlice(input, seed, wave);
  const w = byWave.get(wave) ?? { oneShot: [], slice: [] };
  w.oneShot.push(one); w.slice.push(sl); byWave.set(wave, w);
  console.log(`${String(seed).padEnd(6)} ${String(wave).padEnd(5)} ${String(boardSize).padEnd(6)} ${one.toFixed(2).padStart(11)}  ${sl.toFixed(2).padStart(12)}`);
}
console.log(`\nper wave (max across seeds; ${Math.ceil(COMBAT_ODDS_SIMS / SLICE)} slices per probe):`);
for (const [wave, w] of [...byWave.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  wave ${String(wave).padEnd(3)} one-shot ${Math.max(...w.oneShot).toFixed(2).padStart(7)} ms   max slice ${Math.max(...w.slice).toFixed(2).padStart(6)} ms`);
}
