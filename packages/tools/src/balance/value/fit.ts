/**
 * LEARNED VALUE — FIT + VALIDATION (`balance:value:fit`, `balance:value:report`).
 *
 * Validation is K-fold BY ORIGINATING RUN (the row's `group`), never by board: two boards of one run share the
 * same label and most of their features, so a board-level split would leak the answer into the held-out fold and
 * report an R² the model does not have. Each fold fits the full model (per-wave stats + band weights) on the other
 * folds' rows only.
 *
 * The NULL MODEL predicts the training fold's per-wave mean label — the number to beat, because survival is
 * mostly explained by the wave already (a wave-12 board has little left to survive whatever it looks like).
 * The report prints held-out R² / MAE / Spearman for both and the lift, overall and per source.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LAMBDA, fit, predict, type ValueModel, type ValueRow } from '@game/sim/balance/value/index';
import { fnv1a } from '../stats';
import type { DatasetRow, ValueDataset } from './dataset';

export const MODELS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../sim/src/balance/value/models');

export interface Metrics {
  n: number;
  r2: number;
  mae: number;
  /** Spearman rank correlation between prediction and realised survival. */
  spearman: number;
}

export interface SourceValidation {
  model: Metrics;
  null: Metrics;
  /** Pinned rows only: Spearman of the prediction against the pilot's final placement score and this round's fight,
   *  computed WITHIN each wave (rows-weighted mean over waves with ≥ 8 rows) — pooling across waves would only
   *  re-measure the wave. */
  placementSpearman?: number;
  fightSpearman?: number;
}

export interface Validation {
  folds: number;
  lambda: number;
  overall: SourceValidation;
  bySource: Record<string, SourceValidation>;
  byBand: Record<string, { model: Metrics; null: Metrics }>;
}

export interface Prediction { row: DatasetRow; pred: number; nullPred: number }

/** Rank with average ties. */
export function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x || a.i - b.i);
  const out = new Array<number>(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1]!.x === idx[i]!.x) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]!.i] = r;
    i = j + 1;
  }
  return out;
}

export function spearman(a: readonly number[], b: readonly number[]): number {
  if (a.length < 3) return 0;
  const ra = ranks(a); const rb = ranks(b);
  const ma = ra.reduce((s, x) => s + x, 0) / ra.length; const mb = rb.reduce((s, x) => s + x, 0) / rb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { const x = ra[i]! - ma; const y = rb[i]! - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export function metrics(pred: readonly number[], actual: readonly number[]): Metrics {
  const n = actual.length;
  if (!n) return { n: 0, r2: 0, mae: 0, spearman: 0 };
  const mean = actual.reduce((s, x) => s + x, 0) / n;
  let sse = 0, sst = 0, mae = 0;
  for (let i = 0; i < n; i++) { const e = pred[i]! - actual[i]!; sse += e * e; sst += (actual[i]! - mean) ** 2; mae += Math.abs(e); }
  return { n, r2: sst > 0 ? 1 - sse / sst : 0, mae: mae / n, spearman: spearman(pred, actual) };
}

/** Deterministic fold assignment by run: FNV over the group key. */
export const foldOf = (group: string, folds: number): number => parseInt(fnv1a(group), 16) % folds;

/** Rows-weighted mean of the per-wave Spearman between the prediction and `key` (waves with ≥ 8 rows). */
function withinWaveSpearman(ps: readonly Prediction[], key: (r: DatasetRow) => number | undefined): number | undefined {
  const byWave = new Map<number, Prediction[]>();
  for (const p of ps) if (key(p.row) !== undefined) { const l = byWave.get(p.row.wave) ?? []; l.push(p); byWave.set(p.row.wave, l); }
  let num = 0, den = 0;
  for (const list of byWave.values()) {
    if (list.length < 8) continue;
    num += spearman(list.map((p) => p.pred), list.map((p) => key(p.row)!)) * list.length; den += list.length;
  }
  return den ? num / den : undefined;
}

function nullPredictor(train: readonly ValueRow[]): (wave: number) => number {
  const sum = new Map<number, { s: number; n: number }>();
  let gs = 0, gn = 0;
  for (const r of train) { const e = sum.get(r.wave) ?? { s: 0, n: 0 }; e.s += r.survival; e.n++; sum.set(r.wave, e); gs += r.survival; gn++; }
  return (wave) => { const e = sum.get(wave); return e && e.n ? e.s / e.n : gn ? gs / gn : 0; };
}

const withRowWeights = (rows: readonly DatasetRow[], pinnedWeight: number): DatasetRow[] =>
  rows.map((r) => (r.source === 'pinned' ? { ...r, weight: pinnedWeight } : r));

/** Held-out predictions for every row, each produced by a model that never saw the row's run. */
export function crossValidate(ds: ValueDataset, opts: { folds?: number; lambda?: number; pinnedWeight?: number } = {}): { predictions: Prediction[]; validation: Validation } {
  const folds = opts.folds ?? 5;
  const lambda = opts.lambda ?? DEFAULT_LAMBDA;
  const rows = withRowWeights(ds.rows, opts.pinnedWeight ?? 1);
  const predictions: Prediction[] = [];
  for (let f = 0; f < folds; f++) {
    const train = rows.filter((r) => foldOf(r.group, folds) !== f);
    const test = rows.filter((r) => foldOf(r.group, folds) === f);
    if (!train.length || !test.length) continue;
    const model = fit(train, { lambda, setId: ds.setId });
    const nul = nullPredictor(train);
    for (const row of test) {
      const p = predict(model, row.features);
      const np = nul(row.wave);
      predictions.push({ row, pred: p ?? np, nullPred: np });
    }
  }
  const summarise = (ps: readonly Prediction[]): SourceValidation => {
    const out: SourceValidation = { model: metrics(ps.map((p) => p.pred), ps.map((p) => p.row.survival)), null: metrics(ps.map((p) => p.nullPred), ps.map((p) => p.row.survival)) };
    const pl = withinWaveSpearman(ps, (r) => r.placementScore); if (pl !== undefined) out.placementSpearman = pl;
    const fr = withinWaveSpearman(ps, (r) => r.fightResult); if (fr !== undefined) out.fightSpearman = fr;
    return out;
  };
  const bySource: Record<string, SourceValidation> = {};
  for (const s of ['corpus', 'pinned']) { const ps = predictions.filter((p) => p.row.source === s); if (ps.length) bySource[s] = summarise(ps); }
  const byBand: Validation['byBand'] = {};
  const full = fit(rows, { lambda, setId: ds.setId });
  for (const b of full.bands) {
    const ps = predictions.filter((p) => p.row.wave >= b.lo && p.row.wave <= b.hi);
    if (ps.length) byBand[b.name] = { model: metrics(ps.map((p) => p.pred), ps.map((p) => p.row.survival)), null: metrics(ps.map((p) => p.nullPred), ps.map((p) => p.row.survival)) };
  }
  return { predictions, validation: { folds, lambda, overall: summarise(predictions), bySource, byBand } };
}

/** Fit the final model on EVERY row, stamping the dataset's provenance and the held-out validation into `meta`. */
export function fitFinal(ds: ValueDataset, name: string, opts: { lambda?: number; pinnedWeight?: number; folds?: number } = {}): { model: ValueModel; validation: Validation } {
  const { validation } = crossValidate(ds, opts);
  const model = fit(withRowWeights(ds.rows, opts.pinnedWeight ?? 1), {
    name, setId: ds.setId, lambda: opts.lambda ?? DEFAULT_LAMBDA,
    meta: {
      dataset: { name: ds.name, rows: ds.rows.length, rowsDigest: ds.provenance.rowsDigest, maxWave: ds.maxWave, topWave: ds.topWave },
      provenance: ds.provenance,
      label: 'normalised survival: (lastWave − wave) / (maxWave − wave); recordings carry no placement',
      pinnedWeight: opts.pinnedWeight ?? 1,
      validation,
    },
  });
  return { model, validation };
}

export function modelPath(name: string, dir = MODELS_DIR): string { return join(dir, `${name}.json`); }

export function writeModel(model: ValueModel, dir = MODELS_DIR): string {
  mkdirSync(dir, { recursive: true });
  const path = modelPath(model.name, dir);
  // Weights rounded to 6 significant digits keep the committed file small; inference reads them as-is.
  const compact: ValueModel = {
    ...model,
    bands: model.bands.map((b) => ({ ...b, weights: b.weights.map(round6), bias: round6(b.bias) })),
    waveStats: Object.fromEntries(Object.entries(model.waveStats).map(([w, s]) => [w, { mean: s.mean.map(round6), std: s.std.map(round6) }])),
  };
  writeFileSync(path, `${JSON.stringify(compact, null, 1)}\n`, 'utf8');
  return path;
}

const round6 = (x: number): number => Number(x.toPrecision(6));

const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : 'n/a');
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));

function metricsLine(label: string, v: SourceValidation): string[] {
  const lift = v.model.r2 - v.null.r2;
  const lines = [
    `  ${pad(label, 10)} n=${v.model.n}  model R² ${f3(v.model.r2)}  MAE ${f3(v.model.mae)}  ρ ${f3(v.model.spearman)}   |   null R² ${f3(v.null.r2)}  MAE ${f3(v.null.mae)}  ρ ${f3(v.null.spearman)}   |   lift R² ${lift >= 0 ? '+' : ''}${f3(lift)}`,
  ];
  if (v.placementSpearman !== undefined || v.fightSpearman !== undefined) {
    lines.push(`  ${pad('', 10)} within-wave rank corr (pinned): prediction vs final placement ρ ${f3(v.placementSpearman ?? NaN)}, vs this round's fight ρ ${f3(v.fightSpearman ?? NaN)}`);
  }
  return lines;
}

/** The readable report: validation, then the top ±10 weights per band — "what wins". */
export function renderValueReport(model: ValueModel, validation: Validation | null, opts: { top?: number; buckets?: { id: string; rule: string }[] } = {}): string {
  const top = opts.top ?? 10;
  const out: string[] = [];
  const meta = model.meta as { dataset?: { name: string; rows: number; rowsDigest: string; maxWave: number }; provenance?: { corpus?: { name: string; digest: string; runs: number; boards: number } | null; jobs?: { jobId: string; lobbies: number }[] } };
  out.push(`# Learned value model ${model.name} (${model.setId}) — λ ${model.lambda}, ${model.featureNames.length} features, bands ${model.bands.map((b) => `${b.name} [${b.lo}–${b.hi === 99 ? '∞' : b.hi}] n=${b.n}`).join(', ')}`);
  if (meta.dataset) out.push(`dataset ${meta.dataset.name}: ${meta.dataset.rows} rows (digest ${meta.dataset.rowsDigest}), maxWave ${meta.dataset.maxWave}`);
  if (meta.provenance?.corpus) out.push(`corpus ${meta.provenance.corpus.name} @ ${meta.provenance.corpus.digest}: ${meta.provenance.corpus.boards} boards / ${meta.provenance.corpus.runs} runs`);
  if (meta.provenance?.jobs?.length) out.push(`pinned jobs: ${meta.provenance.jobs.map((j) => `${j.jobId} (${j.lobbies} lobbies)`).join(', ')}`);
  out.push('');
  out.push('Label = normalised survival after the board: (lastWave − wave) / (maxWave − wave). Recordings have NO placement — survival is the label; a run that reached the end-game scores 1 whether it won or lost the final.');
  out.push('');
  if (validation) {
    out.push(`## Held-out validation (${validation.folds}-fold, split by ORIGINATING RUN, never by board)`);
    out.push(...metricsLine('overall', validation.overall));
    for (const [s, v] of Object.entries(validation.bySource)) out.push(...metricsLine(s, v));
    out.push('  by band:');
    for (const [b, v] of Object.entries(validation.byBand)) out.push(`    ${pad(b, 6)} n=${v.model.n}  model R² ${f3(v.model.r2)} ρ ${f3(v.model.spearman)}  |  null R² ${f3(v.null.r2)} ρ ${f3(v.null.spearman)}`);
    out.push('');
  }
  out.push(`## Top ±${top} weights per wave band (standardised per wave: +1 = one wave-σ more of the feature than the typical board at that wave)`);
  for (const b of model.bands) {
    out.push('');
    out.push(`### ${b.name} (waves ${b.lo}–${b.hi === 99 ? '∞' : b.hi}, n=${b.n}, intercept ${f3(b.bias)})`);
    if (!b.n) { out.push('  (no rows)'); continue; }
    const ranked = b.weights.map((w, i) => ({ name: model.featureNames[i]!, w })).sort((a, c) => Math.abs(c.w) - Math.abs(a.w));
    const pos = ranked.filter((r) => r.w > 0).slice(0, top);
    const neg = ranked.filter((r) => r.w < 0).slice(0, top);
    out.push(`  ${pad('helps survival', 34)} | ${pad('hurts survival', 34)}`);
    out.push(`  ${'-'.repeat(34)} | ${'-'.repeat(34)}`);
    for (let i = 0; i < Math.max(pos.length, neg.length); i++) {
      const p = pos[i]; const n = neg[i];
      out.push(`  ${pad(p ? `${pad(p.name, 20)} +${f3(p.w)}` : '', 34)} | ${pad(n ? `${pad(n.name, 20)} ${f3(n.w)}` : '', 34)}`);
    }
  }
  if (opts.buckets?.length) {
    out.push('');
    out.push('## Mechanic buckets (from the effect vocabulary in packages/content/src/schema.ts)');
    for (const b of opts.buckets) out.push(`  ${pad(b.id, 16)} ${b.rule}`);
  }
  return out.join('\n');
}
