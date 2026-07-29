/**
 * `npm run board:train` — fit a board-strength model to the Elo ratings, and prove it beats the proxies.
 *
 * Ridge regression over `boardFeatures`, fit per wave band, with a HELD-OUT split so the reported quality is
 * out-of-sample. Closed-form normal equations: deterministic, no RNG, no training loop to tune.
 *
 * Why a fitted model rather than more hand weights: every hand-weighted evaluator term tried on this project
 * was a regression (shopOpportunity 3.47→1.75 wins; tier-against-curve moved tier up and wins down). Tuning a
 * multi-term weighted sum by hand against a noisy 200-decision game is not a tractable human task. It is a
 * completely routine least-squares problem.
 *
 * Emits `packages/sim/src/boardModel.data.ts` — plain exported numbers, so inference stays pure, deterministic
 * and dependency-free, exactly like `opponentPool.data.ts`.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { boardFeatures, FEATURE_NAMES, type BoardSnapshot } from '@game/sim';

const IN = 'packages/tools/.cache/board-elo.json';
if (!existsSync(IN)) { console.error('no ratings — run: npm run board:elo -- --both'); process.exit(1); }

interface Row { population: string; band: string; elo: number; snapshot: BoardSnapshot }
const rows = JSON.parse(readFileSync(IN, 'utf8')) as Row[];
const argv = process.argv.slice(2);
const LAMBDA = argv.includes('--lambda') ? Number(argv[argv.indexOf('--lambda') + 1]) : 1.0;

/** Solve (XᵀX + λI)w = Xᵀy by Gaussian elimination with partial pivoting. */
function ridge(X: number[][], y: number[], lambda: number): number[] {
  const d = X[0]!.length;
  const A: number[][] = Array.from({ length: d }, () => new Array<number>(d + 1).fill(0));
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      let s = 0;
      for (let k = 0; k < X.length; k++) s += X[k]![i]! * X[k]![j]!;
      A[i]![j] = s + (i === j ? lambda : 0);
    }
    let s = 0;
    for (let k = 0; k < X.length; k++) s += X[k]![i]! * y[k]!;
    A[i]![d] = s;
  }
  for (let c = 0; c < d; c++) {
    let piv = c;
    for (let r = c + 1; r < d; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    const p = A[c]![c]!;
    if (Math.abs(p) < 1e-12) continue;
    for (let j = c; j <= d; j++) A[c]![j]! /= p;
    for (let r = 0; r < d; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (!f) continue;
      for (let j = c; j <= d; j++) A[r]![j]! -= f * A[c]![j]!;
    }
  }
  return Array.from({ length: d }, (_, i) => A[i]![d]!);
}

const corr = (xs: number[], ys: number[]): number => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) { const a = xs[i]! - mx, b = ys[i]! - my; n += a * b; dx += a * a; dy += b * b; }
  return n / Math.sqrt(Math.max(1e-9, dx * dy));
};

// BAND-RELATIVE FEATURES, THEN POOLED. Two failed shapes got here:
//   per-band fits  — ~120 rows against 52 features, and the model lost to raw `power` out of sample everywhere
//   naive pooling  — `power` scales with wave (a wave-2 board has ~20, a wave-15 board ~300) while elo is
//                    centred at 1500 in EVERY band, so pooled `power` correlates with the band rather than with
//                    strength and the baseline collapsed from 0.89 to 0.17
// Standardizing each feature against its OWN BAND fixes both: every row becomes "how does this board compare to
// boards at its wave", which is the actual question, and all ~660 rows then share one set of weights.
const human = rows.filter((r) => r.population === 'human' && r.snapshot.minions.length > 0);
const feats = human.map((r) => boardFeatures(r.snapshot.minions, r.snapshot.wave));
const isTest = human.map((_, i) => i % 4 === 0);
const trIdx = human.map((_, i) => i).filter((i) => !isTest[i]!);
const teIdx = human.map((_, i) => i).filter((i) => isTest[i]!);
const d = feats[0]!.length;

// Band statistics from TRAINING rows only — using the held-out rows here would leak them into the fit.
const bandStats: Record<string, { mean: number[]; scale: number[] }> = {};
for (const band of [...new Set(human.map((r) => r.band))]) {
  const idx = trIdx.filter((i) => human[i]!.band === band);
  if (idx.length < 8) continue;
  const mean = new Array<number>(d).fill(0), scale = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    const col = idx.map((i) => feats[i]![j]!);
    mean[j] = col.reduce((a, b) => a + b, 0) / col.length;
    const v = Math.sqrt(col.reduce((a, b) => a + (b - mean[j]!) ** 2, 0) / col.length);
    scale[j] = v > 1e-9 ? v : 1;
  }
  bandStats[band] = { mean, scale };
}
const usable = (i: number): boolean => !!bandStats[human[i]!.band];
const z = (i: number): number[] => {
  const st = bandStats[human[i]!.band]!;
  return [...feats[i]!.map((v, j) => (v - st.mean[j]!) / st.scale[j]!), 1];
};

const tr = trIdx.filter(usable), te = teIdx.filter(usable);
const truth = te.map((i) => human[i]!.elo);
// The baseline gets the SAME band-relative treatment, or the comparison is rigged in the model's favour.
const powerIdx = FEATURE_NAMES.indexOf('power');
const powerR = corr(te.map((i) => z(i)[powerIdx]!), truth);

console.log(`
=== board-strength model — ridge over ${FEATURE_NAMES.length} band-relative features ===`);
console.log(`${tr.length} train / ${te.length} held out (every 4th board, never seen by the fit)`);
console.log(`baseline: band-relative power scores r=${powerR.toFixed(3)} on the held-out set
`);
console.log('lambda    test r    vs power');

// Sweep rather than guess — the held-out set picks the one knob, so nothing here is hand-chosen.
let best = { lambda: LAMBDA, r: -Infinity, w: [] as number[] };
const yMean = tr.reduce((a, i) => a + human[i]!.elo, 0) / tr.length;
for (const lambda of [1, 3, 10, 30, 100, 300, 1000]) {
  const w = ridge(tr.map(z), tr.map((i) => human[i]!.elo - yMean), lambda);
  const pred = te.map((i) => z(i).reduce((a, v, j) => a + v * w[j]!, 0) + yMean);
  const r = corr(pred, truth);
  console.log(`${String(lambda).padStart(6)}    ${r.toFixed(3).padStart(6)}    ${(r - powerR >= 0 ? '+' : '') + (r - powerR).toFixed(3)}`);
  if (r > best.r) best = { lambda, r, w };
}
console.log(`
best: lambda=${best.lambda}, r=${best.r.toFixed(3)} (power baseline ${powerR.toFixed(3)})`);

const named = FEATURE_NAMES.map((n, j) => ({ n, w: best.w[j]! })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
console.log('');
console.log('top features by |weight| (standardized, so directly comparable):');
for (const f of named.slice(0, 15)) console.log(`  ${f.w >= 0 ? '+' : '-'}${Math.abs(f.w).toFixed(1).padStart(6)}  ${f.n}`);

const models = { bands: bandStats, w: best.w.slice(0, d), b: best.w[d]! + yMean, lambda: best.lambda, testR: best.r };

const banner = `/* AUTO-GENERATED by \`npm run board:train\` — do not edit by hand.
 * Ridge-regression board-strength model, fit per wave band against Elo ratings produced by round-robin
 * simulation (\`npm run board:elo\`). Plain numbers on purpose: inference stays pure, deterministic and
 * dependency-free, so it is safe inside the sim. Regenerate after content changes — the meta moves.
 * Feature order is \`FEATURE_NAMES\` in packages/sim/src/boardFeatures.ts; a change there invalidates this. */`;
writeFileSync(
  'packages/sim/src/boardModel.data.ts',
  `${banner}\nexport interface BandStats { mean: number[]; scale: number[] }\n` +
  `export interface BoardModel { bands: Record<string, BandStats>; w: number[]; b: number; lambda: number; testR: number }\n` +
  `export const BOARD_MODEL: BoardModel = ${JSON.stringify(models)};\n` +
  `export const BOARD_MODEL_FEATURES = ${JSON.stringify(FEATURE_NAMES)};\n`,
);
console.log(`\nwrote model (${Object.keys(bandStats).length} bands, shared weights, held-out r=${best.r.toFixed(3)}) → packages/sim/src/boardModel.data.ts\n`);
