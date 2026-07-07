/*
 * Headless PERFORMANCE harness (perf is ASCENT's north star). Times the engine + run-loop hot paths over
 * large-scale, deterministic workloads so a regression shows up as a number, not a vibe. Run: `npm run perf`.
 *
 * It measures the paths a headless sim CAN measure — pure logic that also runs in the browser:
 *   1. simulate()  — the combat engine, across board archetypes incl. a keyword-heavy 7v7 ("tons of
 *                    magnetics": Divine Shield + Windfury both sides → the longest, busiest fights).
 *   2. reduce()    — per-dispatch cost in the recruit phase WITH a populated `lastCombat` (the state the
 *                    structuredClone-the-whole-event-log regression lived in).
 *   3. full run    — a greedy bot plays complete runs end to end (combat + economy + faceOmen odds sims),
 *                    the closest headless proxy for "is a whole session snappy".
 *
 * What it CANNOT measure: render/paint/animation cost (CSS box-shadow repaints, React reconcile, GSAP).
 * That's browser-only — see docs/performance.md for the manual DevTools workflow we use for those.
 *
 * Each metric prints avg + a coarse REGRESSION TRIPWIRE budget. Budgets are ~10–50× the expected value so
 * they only trip on an algorithmic regression (an accidental O(n²), a megaclone), never on machine variance.
 * The harness exits non-zero if any tripwire fires, so it can gate a commit / CI.
 */
import { simulate, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX, validateCards } from '@game/content';
import { createRun, reduce, CONFIG, HEROES, type RunState, type ShopCard } from '@game/sim';

validateCards();

interface Bench {
  label: string;
  iters: number;
  totalMs: number;
  perMs: number;
  note?: string;
  budgetMs?: number; // per-op tripwire; over → regression
}

/** Warm up (let V8 JIT settle), then time `iters` calls. `fn` receives the iteration index. */
function bench(label: string, iters: number, fn: (i: number) => void, opts: { budgetMs?: number; note?: string } = {}): Bench {
  const warm = Math.min(iters, 30);
  for (let i = 0; i < warm; i++) fn(i);
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn(i);
  const totalMs = performance.now() - t0;
  return { label, iters, totalMs, perMs: totalMs / iters, budgetMs: opts.budgetMs, note: opts.note };
}

const KW = (k: BoardMinion['keywords']): BoardMinion['keywords'] => k;
const make = (cardId: string, attack: number, health: number, keywords?: BoardMinion['keywords']): BoardMinion =>
  keywords ? { cardId, attack, health, keywords } : { cardId, attack, health };
const fill = (n: number, m: () => BoardMinion): BoardMinion[] => Array.from({ length: n }, m);

// ── 1. simulate() across board archetypes ────────────────────────────────────────────────────────
// `alley` is a vanilla body (no combat effect), so overriding stats/keywords isolates the keyword-handling
// cost — DS + Windfury on a beefy 7v7 is the worst case the user hit ("tons of magnetics equipped").
const ARCHETYPES: { label: string; player: BoardMinion[]; enemy: BoardMinion[] }[] = [
  { label: '2v2 vanilla', player: fill(2, () => make('alley', 2, 3)), enemy: fill(2, () => make('alley', 2, 3)) },
  { label: '4v4 vanilla', player: fill(4, () => make('alley', 3, 5)), enemy: fill(4, () => make('alley', 3, 5)) },
  { label: '7v7 vanilla', player: fill(7, () => make('alley', 4, 7)), enemy: fill(7, () => make('alley', 4, 7)) },
  {
    label: '7v7 keyword-heavy (DS+Windfury — "tons of magnetics")',
    player: fill(7, () => make('alley', 6, 12, KW(['DS', 'W']))),
    enemy: fill(7, () => make('alley', 6, 12, KW(['DS', 'W']))),
  },
];

const simBenches: Bench[] = [];
const SIM_ITERS = 600;
for (const a of ARCHETYPES) {
  // One reference run for the event count (the work proxy), then time the loop.
  const ref = simulate(a.player, a.enemy, makeRng(1), CARD_INDEX);
  const b = bench(`simulate · ${a.label}`, SIM_ITERS, (i) => {
    simulate(a.player, a.enemy, makeRng(i + 1), CARD_INDEX);
  }, { budgetMs: 1.5, note: `${ref.events.length} events/run` });
  simBenches.push(b);
}

// ── 2. reduce() per dispatch, with a populated lastCombat ─────────────────────────────────────────
// Play into a mid-game recruit state that has a real `lastCombat` (the big event log the reducer used to
// deep-clone on every click). Then time a benign, always-accepted dispatch (freeze toggles each call).
function midGameState(): RunState {
  let s = createRun(7, 'rohan');
  // Build a small board first — an empty board → a 0-event fight, which wouldn't populate lastCombat.
  for (let k = 0; k < 6 && s.phase === 'recruit'; k++) {
    const before = s;
    if (s.hand.length > 0 && s.board.length < CONFIG.boardMax) s = reduce(s, { type: 'play', uid: s.hand[0]!.uid });
    else if (s.shop[0]) s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    if (s === before) break;
  }
  s = reduce(s, { type: 'faceOmen' });
  s = reduce(s, { type: 'resolveCombat' }); // → recruit, lastCombat now holds the fought event log
  return s;
}
const reduceState = midGameState();
const reduceBench = bench('reduce · dispatch w/ populated lastCombat (freeze)', 4000, () => {
  reduce(reduceState, { type: 'freeze' });
}, { budgetMs: 0.5, note: `lastCombat: ${reduceState.lastCombat?.events.length ?? 0} events (shared by ref, not cloned)` });

// ── 3. full greedy bot runs (combat + economy + faceOmen odds sims, end to end) ───────────────────
// A trimmed copy of the player-curve greedy bot — enough to drive a complete run deterministically.
const stat = (c: { attack: number; health: number }): number => c.attack + c.health;
const offerValue = (o: ShopCard): number => {
  const d = CARD_INDEX[o.cardId];
  return (d ? d.attack + d.health + d.tier * 2 : 0) + (o.atk ?? 0) + (o.hp ?? 0);
};
const bestOffer = (s: RunState): ShopCard | undefined => [...s.shop].sort((a, b) => offerValue(b) - offerValue(a))[0];

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
  if (s.embers >= CONFIG.minionCost && s.board.length + s.hand.length < CONFIG.boardMax) {
    const o = bestOffer(s);
    if (o) {
      n = reduce(s, { type: 'buy', uid: o.uid });
      if (n !== s) return n;
    }
  }
  if (s.heroReady && s.board.length > 0) {
    const best = [...s.board].sort((a, b) => stat(b) - stat(a))[0]!;
    n = reduce(s, { type: 'heroPower', uid: best.uid });
    if (n !== s) return n;
  }
  return reduce(s, { type: 'faceOmen' });
}

function playRun(seed: number, heroId: string): { waves: number; dispatches: number } {
  let s = createRun(seed, heroId);
  let steps = 0;
  let dispatches = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 20000) {
    dispatches++;
    if (s.questOffer) { s = reduce(s, { type: 'buyQuest', index: 0 }); continue; }
    if (s.discover) { s = reduce(s, { type: 'discover', index: 0 }); continue; }
    if (s.chooseOne) { s = reduce(s, { type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') { s = reduce(s, { type: 'resolveCombat' }); continue; }
    s = recruitStep(s);
  }
  return { waves: s.wave, dispatches };
}
const heroes = HEROES.map((h) => h.id);
const RUN_ITERS = 24; // each wave fires faceOmen (1000 odds sims), so a run is thousands of simulate() calls
const runBench = bench('full run · greedy bot, end to end', RUN_ITERS, (i) => {
  playRun(2000 + i, heroes[i % heroes.length]!);
}, { budgetMs: 600 });
// Note computed AFTER the bench (one extra representative run), so the counts reflect real play.
{
  const sample = playRun(9999, heroes[0]!);
  runBench.note = `~${sample.waves} waves, ${sample.dispatches} dispatches/run (each wave's faceOmen runs 1000 odds sims)`;
}

// ── Report ────────────────────────────────────────────────────────────────────────────────────────
const all = [...simBenches, reduceBench, runBench];
const fmt = (n: number): string => (n < 1 ? n.toFixed(4) : n < 100 ? n.toFixed(2) : n.toFixed(0));
console.log('\n=== ASCENT — performance harness ===');
console.log('(headless: engine + run-loop logic only — render/paint cost is browser-only, see docs/performance.md)\n');
let regressed = false;
for (const b of all) {
  const over = b.budgetMs !== undefined && b.perMs > b.budgetMs;
  if (over) regressed = true;
  const flag = b.budgetMs === undefined ? '' : over ? '  ✗ OVER BUDGET' : '  ✓';
  const budget = b.budgetMs === undefined ? '' : `  (budget ${fmt(b.budgetMs)}ms)`;
  console.log(`${b.label}`);
  console.log(`   ${fmt(b.perMs)} ms/op · ${b.iters} iters · ${fmt(b.totalMs)} ms total${budget}${flag}`);
  if (b.note) console.log(`   ${b.note}`);
}
console.log('\nREGRESSION TRIPWIRE: budgets are ~10–50× the expected value (catch algorithmic regressions, not');
console.log('machine variance). Record this run\'s numbers; a 2×+ jump on the same machine is a real regression.');
console.log(regressed ? '\n✗ A metric is OVER BUDGET — investigate before shipping.\n' : '\n✓ All metrics within budget.\n');

if (regressed) process.exit(1);
