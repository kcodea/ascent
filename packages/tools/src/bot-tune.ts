/**
 * `npm run bot:tune` — search the evaluator weight space against the REAL objective.
 *
 * Hand-tuning these weights failed every time it was tried (shopOpportunity 3.47→1.75; tier-against-curve moved
 * tier up, wins down; the first hand-picked shape weights moved wins 3.65→3.20). The honest method is to treat
 * wins-vs-human-boards as a black-box objective and search. Deterministic: fixed config list + seeded jitter,
 * so a rerun reproduces the same table.
 */
import { readFileSync } from 'node:fs';
import { makeRng } from '@game/core';
import {
  createRun, reduce, registerOpponents, createController, decide, setEvaluationWeights, resetEvaluationWeights,
  type RunState, type BoardSnapshot, type EvaluationConfig,
} from '@game/sim';

const human = JSON.parse(readFileSync('packages/tools/.cache/player-boards.json', 'utf8')) as BoardSnapshot[];
registerOpponents(human);

const argv = process.argv.slice(2);
const SEEDS = Number(argv.includes('--seeds') ? argv[argv.indexOf('--seeds') + 1] : '20');

type W = Partial<EvaluationConfig['weights']>;
function score(weights: W): { wins: number; se: number; rounds: number; tier: number; triples: number } {
  setEvaluationWeights(weights);
  const outs: { wins: number; rounds: number; tier: number; triples: number }[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) {
    let s: RunState = createRun(seed, 'drakko');
    let c = createController('tune', 'expert');
    let g = 0;
    while (s.phase !== 'gameover' && s.phase !== 'victory' && g++ < 6000) {
      const d = decide(s, c); if (!d) break; c = d.controller;
      const n = reduce(s, d.action); if (n === s) break; s = n;
    }
    outs.push({ wins: s.history.filter((r) => r === 'win').length, rounds: s.history.length, tier: s.tier, triples: s.triplesMade });
  }
  resetEvaluationWeights();
  const wins = outs.map((o) => o.wins);
  const m = wins.reduce((a, b) => a + b, 0) / wins.length;
  const se = Math.sqrt(wins.reduce((a, b) => a + (b - m) ** 2, 0) / wins.length) / Math.sqrt(wins.length);
  const avg = (k: 'rounds' | 'tier' | 'triples') => outs.reduce((a, o) => a + o[k], 0) / outs.length;
  return { wins: m, se, rounds: avg('rounds'), tier: avg('tier'), triples: avg('triples') };
}

// The base points span the hypotheses worth separating; jittered variants search around whatever leads.
const NAMED: [string, W][] = [
  ['no-shape (macros only)', { tierDensity: 0, tribeFocus: 0, pairsHeld: 0 }],
  ['current defaults', {}],
  ['shape-heavy', { tierDensity: 30, tribeFocus: 18, pairsHeld: 14, fightStrength: 14, learnedStrength: 6 }],
  ['tier-only', { tierDensity: 28, tribeFocus: 0, pairsHeld: 0 }],
  ['focus-only', { tierDensity: 0, tribeFocus: 20, pairsHeld: 10 }],
  ['tier+econ', { tierDensity: 24, tribeFocus: 8, pairsHeld: 6, economy: 20, tierProgress: 16 }],
];

console.log(`\n=== bot:tune — expert vs REAL boards, ${SEEDS} seeds per config ===\n`);
console.log('config                        wins           rounds  tier  triples');
const results: { name: string; w: W; r: ReturnType<typeof score> }[] = [];
for (const [name, w] of NAMED) {
  const r = score(w);
  results.push({ name, w, r });
  console.log(`${name.padEnd(28)} ${r.wins.toFixed(2)} ±${r.se.toFixed(2)}    ${r.rounds.toFixed(1).padStart(6)}  ${r.tier.toFixed(1).padStart(4)}  ${r.triples.toFixed(2).padStart(7)}`);
}

// Jitter around the leader — seeded, so the whole run reproduces.
results.sort((a, b) => b.r.wins - a.r.wins);
const lead = results[0]!;
console.log(`\nleader: ${lead.name} — jittering 6 variants around it`);
const rng = makeRng(1234);
const KEYS: (keyof EvaluationConfig['weights'])[] = ['tierDensity', 'tribeFocus', 'pairsHeld', 'fightStrength', 'learnedStrength', 'economy', 'tierProgress'];
for (let i = 0; i < 6; i++) {
  const w: W = { ...lead.w };
  for (const k of KEYS) {
    const base = (w[k] ?? ({ tierDensity: 16, tribeFocus: 10, pairsHeld: 8, fightStrength: 26, learnedStrength: 12, economy: 12, tierProgress: 9 } as W)[k])!;
    (w as Record<string, number>)[k] = Math.max(0, Math.round(base * (0.5 + rng.next())));
  }
  const r = score(w);
  results.push({ name: `jitter-${i}`, w, r });
  console.log(`jitter-${i} ${JSON.stringify(w).slice(0, 76).padEnd(78)} ${r.wins.toFixed(2)} ±${r.se.toFixed(2)}  t${r.tier.toFixed(1)}`);
}

results.sort((a, b) => b.r.wins - a.r.wins);
console.log(`\nBEST: ${results[0]!.name} — ${results[0]!.r.wins.toFixed(2)} wins`);
console.log(JSON.stringify(results[0]!.w));
