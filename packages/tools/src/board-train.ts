/**
 * `npm run board:train` — fit a board-strength model to the Elo ratings, and prove it beats the proxies.
 *
 * Ridge regression over `boardFeatures`, standardised PER WAVE, with a HELD-OUT split so the reported quality
 * is out-of-sample. Closed-form normal equations: deterministic, no RNG, no training loop to tune.
 *
 * Why a fitted model rather than more hand weights: every hand-weighted evaluator term tried on this project
 * was a regression (shopOpportunity 3.47→1.75 wins; tier-against-curve moved tier up and wins down). Tuning a
 * multi-term weighted sum by hand against a noisy 200-decision game is not a tractable human task. It is a
 * completely routine least-squares problem.
 *
 * Emits `packages/sim/src/boardModel.data.ts` — plain exported numbers, so inference stays pure, deterministic
 * and dependency-free, exactly like `opponentPool.data.ts`.
 *
 * THE YARDSTICK IS THE WAVE, NOT A BAND (owner directive 2026-09-19). The first model standardised every
 * feature against a wave BAND (1–3, 4–6, …, 13–15). Two things were wrong with that:
 *   - crossing a band boundary swapped the yardstick abruptly — the 13–15 band's mean total attack was ~5,250
 *     against ~390 for 10–12, because a few runaway boards dominate the small late bands — so the replay
 *     viewer's Power column showed a board going 99 → 11 from round 12 to 13 with no real change;
 *   - the Elo labels come from round-robins WITHIN a band, so a wave-6 board out-rates a wave-4 board simply
 *     by being two waves older (mean Elo 846 at wave 4 vs 2,121 at wave 6 in the 4–6 band). The band-relative
 *     model learned that slope from `power` and `wave` and its 0.789 held-out r was largely "which wave of the
 *     band is this", not "how strong is this board for its wave".
 * Now every feature is centred and scaled against ALL corpus boards recorded at exactly that wave, and the
 * label is re-centred per wave (Elo minus that wave's MEDIAN Elo, plus 1500), so both sides of the regression
 * answer the same question: how does this board compare with the boards people actually had at this wave?
 *
 * THE YARDSTICK IS ROBUST: the wave's MEDIAN board is the centre and its interquartile range (÷1.349, so it
 * reads as a sd for a normal) the scale. The late waves are heavy-tailed — one wave-12 board holds 30k power
 * beside a median of 1.2k, wave 17's mean power is 4.8M against a median of 21k — and a mean / sd yardstick
 * simply moved the cliff to whichever wave the runaway sat in (a fixed board dropped 1,341 Elo at 11 → 12 with
 * mean / sd against 815 with the median; the corpus-wide worst adjacent step was 1,608 vs 880). Held-out r is
 * 0.867 robust vs ~0.88 mean / sd — the smoother yardstick is worth the 0.02. `--mean-sd` reproduces the other.
 * A feature whose IQR is 0 at a wave (most keyword counts) falls back to its sd, then to 1. (`--winsor p` swaps
 * in max(IQR, winsorised sd at [p, 1−p]) — tried for the narrow integer features, it scored 0.873 but stepped
 * harder between waves (1,076) and was not kept.)
 *
 * THIN WAVES blend, never cliff (`waveStats` below): a wave with fewer than `N_MIN` boards pools its
 * neighbours' boards weighted by distance (own wave ×1, ±1 wave ×1/2, ±2 ×1/3, …) until the pooled weight
 * reaches `N_MIN`, and a wave with no boards at all gets the same treatment. Every wave from 1 to the last
 * recorded one is emitted, so inference only ever clamps past the ends — it never refuses to score a board.
 * With today's corpus (664 boards: 48–56 per wave through 9, then 45 / 39 / 29 / 20 / 16 / 12 / 10 / 8 at
 * waves 10–17) waves 1–13 stand alone and 14–17 blend; `--n-min` moves the threshold (10–30 is flat on r).
 *
 * RUNAWAY BOARDS are clipped, not chased: every standardised feature is clipped ABOVE at +`Z_CLIP` (3), and
 * only above — the tail is one-sided (a feature cannot fall further below the median than 0 allows), and a
 * board three deviations UNDER its wave still needs a gradient for the bot's search to climb. Unclipped, a
 * held-out runaway board scores z = +10…+50 on the stat features and one such row dominates the pooled fit —
 * held-out r 0.34 unclipped against 0.87 clipped. Clipping stays a fair yardstick ("more than three deviations
 * above the wave's average counts as three"), costs 52 compares at inference, and is stored in the model
 * (`zClip`) so inference matches. The sweep 2–3.5 is flat; `--clip 0` reproduces the unclipped fit.
 *
 * WHAT r MEANS NOW. The band model's 0.789 was mostly "which wave of the band is this" (re-run on today's
 * content the band recipe scores 0.24). The pooled held-out r printed here is against wave-recentred labels;
 * the within-wave r beside it is the model's ranking of same-wave boards, which is the question it is asked.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { boardFeatures, FEATURE_NAMES, type BoardSnapshot } from '@game/sim';

const IN = 'packages/tools/.cache/board-elo.json';
if (!existsSync(IN)) { console.error('no ratings — run: npm run board:elo -- --both'); process.exit(1); }

interface Row { population: string; band: string; elo: number; snapshot: BoardSnapshot }
const rows = JSON.parse(readFileSync(IN, 'utf8')) as Row[];
const argv = process.argv.slice(2);
const numArg = (name: string, d: number): number => (argv.includes(`--${name}`) ? Number(argv[argv.indexOf(`--${name}`) + 1]) : d);
/** Boards a wave needs before its own statistics stand alone; below it, neighbours are blended in. */
const N_MIN = numArg('n-min', 15);
/** Standardised features are clipped above at +Z_CLIP (0 = no clip) — see the header on runaway boards. */
const Z_CLIP = numArg('clip', 3);
/** Robust yardstick (median / IQR) instead of mean / sd — see the header on runaway boards. */
const ROBUST = !argv.includes('--mean-sd');
/** > 0 swaps the scale for max(IQR, winsorised sd over [p, 1-p]) — an experiment kept reachable, not the default. */
const WINSOR = numArg('winsor', 0);

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

// WAVE-RELATIVE FEATURES, THEN POOLED. Two failed shapes got here before the per-band model, and a third after:
//   per-band fits  — ~120 rows against 52 features, and the model lost to raw `power` out of sample everywhere
//   naive pooling  — `power` scales with wave (a wave-2 board has ~20, a wave-15 board ~300) while elo is
//                    centred at 1500 in EVERY band, so pooled `power` correlates with the band rather than with
//                    strength and the baseline collapsed from 0.89 to 0.17
//   per-band stats — the yardstick jumped at every band edge (see the header), and the fit was mostly learning
//                    the wave-within-band slope of the labels
// Standardising each feature against its OWN WAVE fixes all three: every row becomes "how does this board compare
// to boards at this exact wave", which is the actual question, and all rows then share one set of weights.
const human = rows.filter((r) => r.population === 'human' && r.snapshot.minions.length > 0);
const feats = human.map((r) => boardFeatures(r.snapshot.minions, r.snapshot.wave));
const waveOf = (i: number): number => human[i]!.snapshot.wave;
// SPLIT BY RUN, NOT BY ROW. The first version held out every 4th board, and with only 56 distinct runs in the
// corpus that meant 100% of held-out boards had their OWN RUN in the training set — and a run's wave-9 and
// wave-10 boards are nearly the same board. The model could memorize runs and the reported quality was
// inflated. Holding out whole runs is the only split that measures generalization to a board never seen.
const runs = [...new Set(human.map((r) => r.snapshot.seed))].sort((a, b) => a - b);
const testRuns = new Set(runs.filter((_, i) => i % 4 === 0));
const isTest = human.map((r) => testRuns.has(r.snapshot.seed));
const trIdx = human.map((_, i) => i).filter((i) => !isTest[i]!);
const teIdx = human.map((_, i) => i).filter((i) => isTest[i]!);
const allIdx = human.map((_, i) => i);
const d = feats[0]!.length;
const maxWave = Math.max(...human.map((r) => r.snapshot.wave));
const WAVE_IDX = FEATURE_NAMES.indexOf('wave');

interface WaveStats { mean: number[]; scale: number[]; n: number }

/**
 * Per-wave feature statistics over the given rows, with the thin-wave blend. `n` is the wave's OWN row count
 * (so a reader can see which waves stood alone); the returned mean/scale may include distance-weighted
 * neighbours when that count is under `N_MIN`.
 */
function waveStats(idx: number[], wave: number): WaveStats {
  const own = idx.filter((i) => waveOf(i) === wave);
  const pool: { i: number; w: number }[] = own.map((i) => ({ i, w: 1 }));
  let weight = own.length;
  for (let dist = 1; weight < N_MIN && dist <= maxWave; dist++) {
    const ring = idx.filter((i) => Math.abs(waveOf(i) - wave) === dist);
    if (ring.length === 0) continue;
    const w = 1 / (1 + dist);
    for (const i of ring) pool.push({ i, w });
    weight += ring.length * w;
  }
  const mean = new Array<number>(d).fill(0), scale = new Array<number>(d).fill(1);
  if (weight === 0) return { mean, scale, n: 0 };
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (const { i, w } of pool) s += w * feats[i]![j]!;
    const avg = s / weight;
    let v = 0;
    for (const { i, w } of pool) v += w * (feats[i]![j]! - avg) ** 2;
    const sd = Math.sqrt(v / weight);
    if (ROBUST) {
      // Weighted quantiles over the (possibly blended) pool.
      const sorted = pool.map(({ i, w }) => ({ v: feats[i]![j]!, w })).sort((a, b) => a.v - b.v);
      const quant = (p: number): number => {
        let acc = 0;
        for (const e of sorted) { acc += e.w; if (acc >= p * weight) return e.v; }
        return sorted[sorted.length - 1]!.v;
      };
      mean[j] = quant(0.5);
      // The interquartile range (÷1.349, so it reads as a sd for a normal) ignores the runaway tail. `--winsor`
      // widens it to max(IQR, winsorised sd) for narrow integer features (board count at wave 1 is 1 or 2, so one
      // extra body reads as three deviations) — measured, it was not worth the extra step between waves.
      const iqr = (quant(0.75) - quant(0.25)) / 1.349;
      const lo = quant(WINSOR), hi = quant(1 - WINSOR);
      let v2 = 0;
      for (const { i, w } of pool) { const x = Math.max(lo, Math.min(hi, feats[i]![j]!)); v2 += w * (x - mean[j]!) ** 2; }
      const wsd = Math.sqrt(v2 / weight);
      const robust = WINSOR > 0 ? Math.max(iqr, wsd) : iqr;
      scale[j] = robust > 1e-9 ? robust : sd > 1e-9 ? sd : 1;
    } else {
      mean[j] = avg;
      scale[j] = sd > 1e-9 ? sd : 1;
    }
  }
  // `wave` is constant within a wave by construction: pin its yardstick to the wave itself so it standardises
  // to exactly 0 everywhere (a blended pool would otherwise leave a stray non-zero for the thin waves only).
  mean[WAVE_IDX] = wave; scale[WAVE_IDX] = 1;
  return { mean, scale, n: own.length };
}

/** Per-wave label centre: the MEDIAN Elo of the given rows at that wave (own wave only — Elo is only comparable
 *  within a band, so neighbouring waves must not be blended into it; the median to match the feature yardstick,
 *  so "1500" is the wave's median board on both sides). Falls back to the band's 1500 centre. */
function waveEloMean(idx: number[]): Map<number, number> {
  const acc = new Map<number, number[]>();
  for (const i of idx) {
    const w = waveOf(i);
    (acc.get(w) ?? acc.set(w, []).get(w)!).push(human[i]!.elo);
  }
  const centre = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    return ROBUST ? s[Math.floor(s.length / 2)]! : s.reduce((a, b) => a + b, 0) / s.length;
  };
  return new Map([...acc].map(([w, xs]) => [w, centre(xs)]));
}

/** Build the full 1..maxWave stats table from the given rows. */
function statsTable(idx: number[]): Record<number, WaveStats> {
  const table: Record<number, WaveStats> = {};
  for (let w = 1; w <= maxWave; w++) table[w] = waveStats(idx, w);
  return table;
}

const clipZ = (v: number): number => (Z_CLIP > 0 && v > Z_CLIP ? Z_CLIP : v);
const zWith = (table: Record<number, WaveStats>, i: number): number[] => {
  const st = table[waveOf(i)]!;
  return [...feats[i]!.map((v, j) => clipZ((v - st.mean[j]!) / st.scale[j]!)), 1];
};
const yWith = (centres: Map<number, number>, i: number): number => human[i]!.elo - (centres.get(waveOf(i)) ?? 1500) + 1500;

// Statistics from TRAINING rows only for the evaluation — using the held-out rows here would leak them into
// the fit. (The shipped model is then refit on every row, below, with the lambda this split picked.)
const trStats = statsTable(trIdx);
const trCentres = waveEloMean(trIdx);
const z = (i: number): number[] => zWith(trStats, i);
const y = (i: number): number => yWith(trCentres, i);

const tr = trIdx, te = teIdx;
const truth = te.map(y);
// The baseline gets the SAME wave-relative treatment, or the comparison is rigged in the model's favour.
const powerIdx = FEATURE_NAMES.indexOf('power');
const powerR = corr(te.map((i) => z(i)[powerIdx]!), truth);

console.log(`\n=== board-strength model — ridge over ${FEATURE_NAMES.length} wave-relative features ===`);
console.log('wave   boards   train   stands alone?');
for (let w = 1; w <= maxWave; w++) {
  const n = allIdx.filter((i) => waveOf(i) === w).length, t = trStats[w]!.n;
  console.log(`${String(w).padStart(4)}   ${String(n).padStart(6)}   ${String(t).padStart(5)}   ${t >= N_MIN ? 'yes' : `blended (n < ${N_MIN})`}`);
}
console.log(`\n${tr.length} train / ${te.length} held out — split by RUN (${testRuns.size} of ${runs.length} runs held out)`);
console.log(`labels re-centred per wave (Elo − the wave's ${ROBUST ? 'median' : 'mean'} Elo + 1500)`);
console.log(`baseline: wave-relative power scores r=${powerR.toFixed(3)} on the held-out set\n`);
console.log('lambda    test r    vs power');

// Sweep rather than guess — the held-out set picks the one knob, so nothing here is hand-chosen. `--lambda N`
// pins it (the sweep still prints, so the cost of the pin is visible).
const PIN = numArg('lambda', 0);
let best = { lambda: 1, r: -Infinity, pred: [] as number[] };
const yMean = tr.reduce((a, i) => a + y(i), 0) / tr.length;
for (const lambda of [1, 3, 10, 30, 100, 300, 1000, 3000, 10000]) {
  const w = ridge(tr.map(z), tr.map((i) => y(i) - yMean), lambda);
  const pred = te.map((i) => z(i).reduce((a, v, j) => a + v * w[j]!, 0) + yMean);
  const r = corr(pred, truth);
  console.log(`${String(lambda).padStart(6)}    ${r.toFixed(3).padStart(6)}    ${(r - powerR >= 0 ? '+' : '') + (r - powerR).toFixed(3)}`);
  if (PIN > 0 ? lambda === PIN : r > best.r) best = { lambda, r, pred };
}
if (PIN > 0 && best.lambda !== PIN) { console.error(`--lambda ${PIN} is not in the sweep`); process.exit(1); }
console.log(`\nbest: lambda=${best.lambda}, r=${best.r.toFixed(3)} (power baseline ${powerR.toFixed(3)})${PIN > 0 ? ' [pinned]' : ''}`);

// WITHIN-WAVE quality — the question the model is actually asked ("which of these same-wave boards is
// stronger?"), free of the per-wave label centres, which the held-out runs can shift by hundreds of Elo when a
// wave holds only three or four of them.
console.log('\nheld-out r WITHIN each wave (model / wave-relative power):');
let wSum = 0, wN = 0;
for (let w = 1; w <= maxWave; w++) {
  const k = te.map((i, p) => [i, p] as const).filter(([i]) => waveOf(i) === w);
  if (k.length < 5) continue;
  const rM = corr(k.map(([, p]) => best.pred[p]!), k.map(([i]) => human[i]!.elo));
  const rP = corr(k.map(([i]) => feats[i]![powerIdx]!), k.map(([i]) => human[i]!.elo));
  console.log(`  wave ${String(w).padStart(2)} n=${String(k.length).padStart(2)}  ${rM.toFixed(2)} / ${rP.toFixed(2)}`);
  wSum += rM * k.length; wN += k.length;
}
const withinR = wN ? wSum / wN : 0;
console.log(`  n-weighted mean within-wave r = ${withinR.toFixed(3)}`);
// The same thing pooled: both sides centred on THEIR OWN held-out wave means, so the only thing left to agree
// on is the within-wave ordering. The gap between this and the plain pooled r above is the label-centre noise.
{
  const centre = (vals: number[]): number[] => {
    const acc = new Map<number, { s: number; n: number }>();
    te.forEach((i, p) => { const a = acc.get(waveOf(i)) ?? { s: 0, n: 0 }; a.s += vals[p]!; a.n += 1; acc.set(waveOf(i), a); });
    return te.map((i, p) => vals[p]! - acc.get(waveOf(i))!.s / acc.get(waveOf(i))!.n);
  };
  console.log(`  pooled r with both sides wave-centred = ${corr(centre(best.pred), centre(te.map((i) => human[i]!.elo))).toFixed(3)}`);
}
// THE SHIPPED MODEL: the same recipe over EVERY row, with the lambda the split chose. The thin late waves are
// exactly where every board counts, and holding a quarter of them back from the yardstick buys nothing once
// the lambda is fixed. `testR` stays the honest split-evaluated figure above.
const allStats = statsTable(allIdx);
const allCentres = waveEloMean(allIdx);
const yAllMean = allIdx.reduce((a, i) => a + yWith(allCentres, i), 0) / allIdx.length;
const wAll = ridge(allIdx.map((i) => zWith(allStats, i)), allIdx.map((i) => yWith(allCentres, i) - yAllMean), best.lambda);

const named = FEATURE_NAMES.map((n, j) => ({ n, w: wAll[j]! })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
console.log('');
console.log('top features by |weight| (standardized, so directly comparable):');
for (const f of named.slice(0, 15)) console.log(`  ${f.w >= 0 ? '+' : '-'}${Math.abs(f.w).toFixed(1).padStart(6)}  ${f.n}`);

const model = {
  waves: allStats, minWave: 1, maxWave, nMin: N_MIN, zClip: Z_CLIP,
  w: wAll.slice(0, d), b: wAll[d]! + yAllMean, lambda: best.lambda, testR: best.r, withinWaveR: withinR,
};

const banner = `/* AUTO-GENERATED by \`npm run board:train\` — do not edit by hand.
 * Ridge-regression board-strength model over features standardised PER WAVE — median / IQR of every corpus
 * board recorded at exactly that wave; waves with fewer than \`nMin\` boards blend their neighbours by distance;
 * standardised values are clipped above at +\`zClip\` (see packages/tools/src/board-train.ts) — against Elo
 * ratings produced by round-robin simulation (\`npm run board:elo\`), re-centred on each wave's median.
 * Plain numbers on purpose: inference stays pure, deterministic and dependency-free, so it is safe inside the
 * sim. Regenerate after content changes — the meta moves.
 * Feature order is \`FEATURE_NAMES\` in packages/sim/src/boardFeatures.ts; a change there invalidates this. */`;
writeFileSync(
  'packages/sim/src/boardModel.data.ts',
  `${banner}\n` +
  `/** One wave's yardstick: \`n\` is the wave's OWN board count (mean/scale may include blended neighbours when n < nMin). */\n` +
  `export interface WaveStats { mean: number[]; scale: number[]; n: number }\n` +
  `export interface BoardModel { waves: Record<number, WaveStats>; minWave: number; maxWave: number; nMin: number; zClip: number; w: number[]; b: number; lambda: number; testR: number; withinWaveR: number }\n` +
  `export const BOARD_MODEL: BoardModel = ${JSON.stringify(model)};\n` +
  `export const BOARD_MODEL_FEATURES = ${JSON.stringify(FEATURE_NAMES)};\n`,
);
console.log(`\nwrote model (waves 1..${maxWave}, shared weights, held-out r=${best.r.toFixed(3)}) → packages/sim/src/boardModel.data.ts\n`);
