/**
 * `npm run bot:ladder` — measure how strong the bots actually are, with error bars.
 *
 * Built because two evaluator "improvements" in a row were shipped on 10-seed samples and both turned out to be
 * regressions once measured properly: the standard error at that sample size is around ±0.6 wins, which is
 * larger than every difference being reasoned about. Any claim about bot strength that isn't accompanied by a
 * seed count and an error bar is noise.
 *
 *   npm run bot:ladder                     # every difficulty + the legacy policy, 30 seeds
 *   npm run bot:ladder -- --seeds 60       # tighter error bars
 *   npm run bot:ladder -- --diff hard      # one tier only
 *   npm run bot:ladder -- --hero soren     # a specific hero
 *   npm run bot:ladder -- --diagnose       # per-round win rate + why runs end
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRun, reduce, DEFAULT_BOT, OPPONENT_POOL, OPPONENT_POOL_DATA, registerOpponents, type BoardSnapshot, type RunState } from '@game/sim';
import { createController, decide, toBotVisibleState, fightScore, type BotDifficultyId } from '@game/sim';

// WHAT THE BOT ACTUALLY FIGHTS — state it, because it changes the answer more than any evaluator tweak.
//
//   default      the committed pool: 160 boards, every one `origin: 'synthetic'`
//   --human      real player boards pulled by `npm run boards:fetch` (origin 'self')
//   --procedural no pool at all, so every fight falls through to `buildEnemyBoard`
//
// `OPPONENT_POOL` ships EMPTY and only the web store loads boards into it, so a headless tool that forgets to
// register measures the --procedural case by accident — against the same generator `fightScore` scores with,
// which is train-on-test and inflates every number.
const PROCEDURAL_ONLY = process.argv.includes('--procedural');
const HUMAN = process.argv.includes('--human');
let poolLabel = 'PROCEDURAL ONLY — the same generator the evaluator scores against';
if (HUMAN) {
  const path = 'packages/tools/.cache/player-boards.json';
  if (!existsSync(path)) { console.error(`no board cache at ${path} — run: npm run boards:fetch`); process.exit(1); }
  const boards = JSON.parse(readFileSync(path, 'utf8')) as BoardSnapshot[];
  registerOpponents(boards);
  poolLabel = `REAL PLAYER boards (${OPPONENT_POOL.length} registered)`;
} else if (!PROCEDURAL_ONLY) {
  registerOpponents([...OPPONENT_POOL_DATA]);
  poolLabel = `committed pool (${OPPONENT_POOL.length} boards, all synthetic) + procedural fallback`;
}

const argv = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name: string): boolean => argv.includes(`--${name}`);

const SEEDS = Number(flag('seeds', '30'));
const HERO = flag('hero', 'drakko')!;
const ONLY = flag('diff');
const DIAGNOSE = has('diagnose');
const TIERS: (BotDifficultyId | 'legacy')[] = ONLY ? [ONLY as BotDifficultyId] : ['legacy', 'easy', 'normal', 'hard', 'expert'];

interface RunOutcome {
  wins: number;
  rounds: number;
  finalTier: number;
  triples: number;
  died: boolean;
  goldWasted: number;
  turns: number;
  history: RunState['history'];
}

function playRun(seed: number, tier: BotDifficultyId | 'legacy'): RunOutcome {
  let s: RunState = createRun(seed, HERO);
  let controller = createController('ladder', tier === 'legacy' ? 'normal' : tier);
  let guard = 0;
  let goldWasted = 0;
  let turns = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < 6000) {
    let action;
    if (tier === 'legacy') {
      action = DEFAULT_BOT.act(s);
    } else {
      const d = decide(s, controller);
      if (!d) break;
      controller = d.controller;
      action = d.action;
    }
    // Gold still in hand at the moment the turn ends is gold that bought nothing.
    if (action.type === 'faceOmen') { goldWasted += s.embers; turns++; }
    const next = reduce(s, action);
    if (next === s) break;
    s = next;
  }
  return {
    wins: s.history.filter((r) => r === 'win').length,
    rounds: s.history.length,
    finalTier: s.tier,
    triples: s.triplesMade,
    died: s.resolve <= 0,
    goldWasted,
    turns,
    history: s.history,
  };
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const stderr = (xs: number[]): number => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length)) / Math.sqrt(Math.max(1, xs.length));
};

const seeds = Array.from({ length: SEEDS }, (_, i) => i + 1);
console.log(`\n=== bot ladder — ${SEEDS} seeds, hero ${HERO} ===`);
console.log(`opponents: ${poolLabel}`);
console.log('tier      wins            rounds  tier  triples  died  gold/turn   r17  wonR17  survived');

const perTier = new Map<string, RunOutcome[]>();
for (const tier of TIERS) {
  const runs = seeds.map((s) => playRun(s, tier));
  perTier.set(tier, runs);
  const w = runs.map((r) => r.wins);
  console.log(
    `${String(tier).padEnd(9)} ${mean(w).toFixed(2)} ±${stderr(w).toFixed(2)}`.padEnd(26) +
    `${mean(runs.map((r) => r.rounds)).toFixed(1).padStart(6)}  ` +
    `${mean(runs.map((r) => r.finalTier)).toFixed(1).padStart(4)}  ` +
    `${mean(runs.map((r) => r.triples)).toFixed(2).padStart(7)}  ` +
    `${String(runs.filter((r) => r.died).length).padStart(4)}  ` +
    `${mean(runs.map((r) => r.goldWasted / Math.max(1, r.turns))).toFixed(2).padStart(9)}` +
    // Reaching round 17 at all, winning THAT round, and surviving the whole course are three different things
    // and collapsing them hides which one the bot fails at.
    `${String(runs.filter((r) => r.history.length >= 17).length).padStart(6)}` +
    `${String(runs.filter((r) => r.history[16] === 'win').length).padStart(8)}` +
    `${String(runs.filter((r) => !r.died && r.history.length >= 17).length).padStart(10)}`,
  );
}

// Par is the Oath — the win count a run is expected to cover. Printed so "3 wins" has something to mean.
console.log(`\npar (Oath) is 9 wins over the 15 scored rounds.`);

if (DIAGNOSE) {
  console.log('\n=== per-round win rate ===');
  const rounds = 17;
  const header = ['tier'.padEnd(9), ...Array.from({ length: rounds }, (_, i) => String(i + 1).padStart(4))].join('');
  console.log(header);
  for (const [tier, runs] of perTier) {
    const cells: string[] = [];
    for (let r = 0; r < rounds; r++) {
      const played = runs.filter((x) => x.history.length > r);
      if (played.length === 0) { cells.push('   ·'); continue; }
      const wins = played.filter((x) => x.history[r] === 'win').length;
      cells.push(`${Math.round((100 * wins) / played.length)}`.padStart(4));
    }
    console.log(tier.padEnd(9) + cells.join(''));
  }

  console.log('\n=== board strength vs the wave-appropriate threat panel ===');
  console.log('(fightScore against the procedural curve — legal public knowledge, not the pinned opponent)');
  for (const tier of TIERS) {
    if (tier === 'legacy') continue;
    for (const wave of [4, 7, 10, 13]) {
      const samples = seeds.slice(0, 6).map((seed) => {
        let s: RunState = createRun(seed, HERO);
        let c = createController('probe', tier as BotDifficultyId);
        let g = 0;
        while (s.wave < wave && s.phase !== 'gameover' && s.phase !== 'victory' && g++ < 4000) {
          const d = decide(s, c); if (!d) break;
          c = d.controller;
          const n = reduce(s, d.action); if (n === s) break;
          s = n;
        }
        return fightScore(toBotVisibleState(s));
      });
      console.log(
        `  ${String(tier).padEnd(8)} wave ${String(wave).padStart(2)}  ` +
        `winRate ${mean(samples.map((f) => f.winRate)).toFixed(2)}  ` +
        `margin ${mean(samples.map((f) => f.margin)).toFixed(2)}  ` +
        `dmg ${mean(samples.map((f) => f.averageDamage)).toFixed(2)}`,
      );
    }
  }
}
console.log('');
