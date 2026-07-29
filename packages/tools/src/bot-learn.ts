/**
 * `npm run bot:learn` — fit the learned success metrics from rollout trajectories.
 *
 * Two artifacts, both emitted as plain numbers into `packages/sim/src/runModel.data.ts`:
 *
 * 1. A RUN-STATE VALUE MODEL: ridge regression from end-of-turn state features to `winsAfter` (wins still to
 *    come from this state). Multi-target-lite: winsAfter carries both "will I win soon" and "will I live",
 *    and unlike final placement it gives every row a dense signal. Split by RUN (seed), never by row — the
 *    board-model leakage lesson (devlog 2026-07-29).
 *
 * 2. QUEST / RUNE VALUE TABLES: for every quest and rune id, the mean outcome (winsAfter) when it was picked,
 *    against the mean when it was offered and NOT picked — a causal contrast made possible by the forced
 *    exploration in `bot:rollouts`. This is the direct answer to "quest picks are scored by immediate
 *    evaluation, which cannot see the payoff": now the payoff is measured.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { FEATURE_NAMES } from '@game/sim';

const DIR = 'packages/tools/.cache/rollouts';

interface Row {
  kind: 'state' | 'quest' | 'rune';
  seed: number; round: number; wave: number;
  f?: number[]; offered?: string[]; picked?: string; forced?: number;
  wonNext?: number; survived3?: number; finalWins?: number; deathRound?: number; winsAfter?: number;
}

const rows: Row[] = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.jsonl'))) {
  for (const line of readFileSync(`${DIR}/${f}`, 'utf8').split('\n')) {
    if (line) rows.push(JSON.parse(line) as Row);
  }
}
const states = rows.filter((r) => r.kind === 'state' && r.f && r.winsAfter !== undefined);
console.log(`${rows.length} rows loaded — ${states.length} states, ${rows.filter((r) => r.kind === 'quest').length} quest picks, ${rows.filter((r) => r.kind === 'rune').length} rune picks`);

// ---------- 1. run-state value ----------
/** Ridge via normal equations + Gaussian elimination (same shape as board-train). */
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
      const fac = A[r]![c]!;
      if (!fac) continue;
      for (let j = c; j <= d; j++) A[r]![j]! -= fac * A[c]![j]!;
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

// Split by RUN. Wave-relative standardization, same rationale as the board model: the question is always
// "how good is this state FOR ITS ROUND", and raw features scale with wave.
const isTest = (seed: number): boolean => seed % 4 === 0;
const d = states[0]!.f!.length;
const perWave = new Map<number, { mean: number[]; scale: number[] }>();
for (const wave of new Set(states.map((s) => s.wave))) {
  const tr = states.filter((s) => s.wave === wave && !isTest(s.seed));
  if (tr.length < 30) continue;
  const mean = new Array<number>(d).fill(0), scale = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    const col = tr.map((s) => s.f![j]!);
    mean[j] = col.reduce((a, b) => a + b, 0) / col.length;
    const v = Math.sqrt(col.reduce((a, b) => a + (b - mean[j]!) ** 2, 0) / col.length);
    scale[j] = v > 1e-9 ? v : 1;
  }
  perWave.set(wave, { mean, scale });
}
const usable = states.filter((s) => perWave.has(s.wave));
const z = (s: Row): number[] => {
  const st = perWave.get(s.wave)!;
  return [...s.f!.map((v, j) => (v - st.mean[j]!) / st.scale[j]!), 1];
};
const tr = usable.filter((s) => !isTest(s.seed));
const te = usable.filter((s) => isTest(s.seed));
const yMean = tr.reduce((a, s) => a + s.winsAfter!, 0) / tr.length;
console.log(`\nvalue model: ${tr.length} train / ${te.length} test states (split by run)`);

let best = { lambda: 0, r: -Infinity, w: [] as number[] };
for (const lambda of [1, 10, 100, 1000]) {
  const w = ridge(tr.map(z), tr.map((s) => s.winsAfter! - yMean), lambda);
  const pred = te.map((s) => z(s).reduce((a, v, j) => a + v * w[j]!, 0) + yMean);
  const r = corr(pred, te.map((s) => s.winsAfter!));
  console.log(`  lambda ${String(lambda).padStart(5)}: held-out r=${r.toFixed(3)}`);
  if (r > best.r) best = { lambda, r, w };
}

// ---------- 2. quest / rune contrasts ----------
interface Contrast { picked: number; nPicked: number; passed: number; nPassed: number }
function contrasts(kind: 'quest' | 'rune'): Record<string, Contrast> {
  const table: Record<string, Contrast> = {};
  for (const r of rows) {
    if (r.kind !== kind || !r.offered || r.winsAfter === undefined) continue;
    for (const id of r.offered) {
      const c = (table[id] ??= { picked: 0, nPicked: 0, passed: 0, nPassed: 0 });
      if (id === r.picked) { c.picked += r.winsAfter; c.nPicked++; }
      else { c.passed += r.winsAfter; c.nPassed++; }
    }
  }
  return table;
}
const printTop = (kind: 'quest' | 'rune', table: Record<string, Contrast>): void => {
  const scored = Object.entries(table)
    .filter(([, c]) => c.nPicked >= 20 && c.nPassed >= 20)
    .map(([id, c]) => ({ id, delta: c.picked / c.nPicked - c.passed / c.nPassed, n: c.nPicked }))
    .sort((a, b) => b.delta - a.delta);
  console.log(`\n${kind} value (winsAfter picked − passed, n≥20 each side): ${scored.length} ids`);
  for (const s of [...scored.slice(0, 5), ...scored.slice(-3)]) {
    console.log(`  ${s.delta >= 0 ? '+' : ''}${s.delta.toFixed(2)}  ${s.id} (n=${s.n})`);
  }
};
const questTable = contrasts('quest');
const runeTable = contrasts('rune');
printTop('quest', questTable);
printTop('rune', runeTable);

// ---------- emit ----------
const emitTable = (t: Record<string, Contrast>): Record<string, number> =>
  Object.fromEntries(Object.entries(t)
    .filter(([, c]) => c.nPicked >= 20 && c.nPassed >= 20)
    .map(([id, c]) => [id, Number((c.picked / c.nPicked - c.passed / c.nPassed).toFixed(3))]));

const banner = `/* AUTO-GENERATED by \`npm run bot:learn\` — do not edit by hand.
 * Learned from ${usable.length} end-of-turn states + ${rows.filter((r) => r.kind === 'quest').length} quest picks across self-play rollouts vs the real
 * player-board pool (\`npm run bot:rollouts\`). Value model: ridge on wave-relative features -> winsAfter,
 * held-out-by-run r=${best.r.toFixed(3)}. Quest/rune tables: mean winsAfter picked minus passed, causal via
 * forced exploration. Regenerate after content changes. Feature order = FEATURE_NAMES + [gold, maxGold,
 * tier, effectiveHp, handSize]. */`;
writeFileSync('packages/sim/src/runModel.data.ts',
  `${banner}\nexport interface WaveStats { mean: number[]; scale: number[] }\n` +
  `export const RUN_VALUE: { waves: Record<string, WaveStats>; w: number[]; b: number; testR: number } = ` +
  JSON.stringify({ waves: Object.fromEntries([...perWave].map(([k, v]) => [String(k), v])), w: best.w.slice(0, d), b: best.w[d]! + yMean, testR: best.r }) + `;\n` +
  `export const QUEST_VALUE: Record<string, number> = ${JSON.stringify(emitTable(questTable))};\n` +
  `export const RUNE_VALUE: Record<string, number> = ${JSON.stringify(emitTable(runeTable))};\n` +
  `export const RUN_MODEL_EXTRA_FEATURES = ['gold', 'maxGold', 'tier', 'effectiveHp', 'handSize'];\n`);
console.log(`\nwrote runModel.data.ts — value r=${best.r.toFixed(3)}, ${Object.keys(emitTable(questTable)).length} quests, ${Object.keys(emitTable(runeTable)).length} runes`);
console.log(`FEATURE_NAMES check: ${FEATURE_NAMES.length} board features + 5 extras = ${FEATURE_NAMES.length + 5}, rows have ${d}`);
