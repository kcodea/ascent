/**
 * IMITATION (B7) — THE TARGET-BOARD MODEL: "does this board look like the boards of runs that went on to survive?"
 *
 * A log-odds-ratio table over what a board VISIBLY holds, fit per wave band directly on the recorded
 * corpus (`trajectories.ts`): for every card, the log-odds that a survivor's board holds it against a non-survivor's
 * (the holders' survivor rate shrunk toward the band's base rate with `prior` pseudo-boards, as log-odds against the base), plus the same for GOLDENS per board
 * (Poisson rate ratio), DOMINANT-TRIBE SHARE (a Gaussian slope) and card PAIRS (the interaction left after the two
 * singles are credited, shrunk harder). Summing the ratios over a board gives the log-odds shift toward "survivor";
 * `scoreBoard` is that sum and `imitationTermOf` (term.ts) is what the strategist blends into the evaluator.
 *
 * Why naive Bayes and not the ridge model in `balance/value`: the value model reads SHAPE features (tier, stat
 * totals, keyword mix) — it cannot say "Standard Bearer" or "Chorus Drake". This one is a per-card table, so every
 * weight is a sentence a designer can check ("players who kept X at waves 8–10 survived 2.1 waves longer than
 * those who did not") and the strategist's line choice can read it card by card. No RNG; closed form; ~100 adds.
 */
import { CARD_INDEX } from '@game/content';
import type { SetId } from '@game/content';
import type { BoardSnapshot } from '../../snapshot';
import { bandOf, DEFAULT_BANDS, type Band } from './study';
import { DEFAULT_HORIZON, dominantTribe, goldenCount, isSurvivor, trajectoriesOf, type RunTrajectory, type TrajectoryBoard } from './trajectories';

export interface CardBandWeight {
  boards: number;
  survivors: number;
  /** The band's survivor rate among boards holding the card. */
  rate: number;
  /** Naive-Bayes log-likelihood ratio: + = survivors hold it more often than the eliminated do. Clipped to ±MAX_LLR. */
  weight: number;
  /** Mean waves survived after the board: holders vs the band's non-holders (the explanation column). */
  holdersAfter: number;
  othersAfter: number;
}

export interface BandBase { boards: number; survivors: number; rate: number }

export interface ImitationModel {
  schemaVersion: 1;
  name: string;
  setId: SetId;
  horizon: number;
  prior: number;
  bands: Band[];
  base: Record<string, BandBase>;
  /** cardId → bandId → weight. Cards below `minBoards` in a band are absent (weight 0 at inference). */
  cards: Record<string, Record<string, CardBandWeight>>;
  /** `a|b` (sorted ids) → bandId → the pair's interaction LLR beyond its two singles. */
  pairs: Record<string, Record<string, { boards: number; survivors: number; weight: number }>>;
  /** bandId → LLR per golden minion on the board (survivors' golden rate vs the eliminated's). */
  golden: Record<string, { survivorsMean: number; othersMean: number; perGolden: number }>;
  /** bandId → LLR slope per unit of dominant-tribe share above the band's mean share. */
  focus: Record<string, { mean: number; slope: number }>;
  /** bandId → the mean board size of survivors vs others (the SIZE reference the term leans on, not a weight). */
  size: Record<string, { survivorsMean: number; othersMean: number; perBody: number }>;
  meta: {
    corpus?: { name: string; digest: string };
    runs: number;
    boards: number;
    minBoards: number;
    pairMinBoards: number;
    validation?: ImitationValidation;
  };
}

export const MAX_LLR = 2;
export const MAX_PAIR_LLR = 1;

export interface FitOptions {
  name?: string;
  setId?: SetId;
  horizon?: number;
  /** Pseudo-board count the per-card statistic is shrunk toward the band's mean with. */
  prior?: number;
  /** A card needs this many boards in a band to get a weight. */
  minBoards?: number;
  pairMinBoards?: number;
  bands?: readonly Band[];
  corpus?: { name: string; digest: string };
  validation?: ImitationValidation;
  /** How a card's weight is derived: `odds` = shrunk log-odds ratio of the binary survivor label (default);
   *  `after` = the shrunk difference in mean waves-survived-after (holders − others) in band standard deviations. */
  mode?: 'odds' | 'after';
  /** Ablation: drop the card / pair / golden / focus / size terms (all on by default). */
  terms?: Partial<Record<'cards' | 'pairs' | 'golden' | 'focus' | 'size', boolean>>;
}

/**
 * The defaults, chosen by 5-fold-by-run cross-validation on `set2-players-v1` (2026-09-15; the sweep is in
 * docs/balance-bot.md "Imitation term (B7)"): the `after` mode beat the binary log-odds in the open / build bands
 * (AUC 0.61 / 0.65 vs 0.57 / 0.63), the FOCUS term was noise in every band (AUC 0.45–0.54 alone) and is OFF, goldens
 * + board size carry the scale band (0.66 alone), pairs add ~0.03 AUC at scale. The late band (11+) is not
 * predictive held-out (AUC 0.42–0.45) — read its weights as description, not prediction.
 */
export const DEFAULT_FIT = {
  mode: 'after' as const,
  prior: 8,
  minBoards: 8,
  pairMinBoards: 8,
  terms: { cards: true, pairs: true, golden: true, focus: false, size: true },
};

const ln = Math.log;
const clip = (x: number, m: number): number => Math.max(-m, Math.min(m, x));

interface BandRows { band: Band; rows: { run: string; b: TrajectoryBoard; survivor: boolean }[] }

function bandRows(runs: readonly RunTrajectory[], bands: readonly Band[], horizon: number): BandRows[] {
  return bands.map((band) => ({
    band,
    rows: runs.flatMap((r) => r.boards.filter((b) => b.wave >= band.from && b.wave <= band.to).map((b) => ({ run: r.key, b, survivor: isSurvivor(b, horizon) }))),
  }));
}

/**
 * The smoothed log-odds RATIO of surviving given the feature: the holders' survivor rate, shrunk toward the band's
 * base rate with `prior` pseudo-boards, against the base rate itself. `a` survivors of `n` holders; `base` = the
 * band's rate. With n = 4 and a = 4 at prior 8 the weight is ≈ +0.6, not +2 — a card seen on four boards is a hint,
 * not a verdict; with n = 25 and a = 1 (Embermouth Whelp at waves 5–7) it is ≈ −1.9.
 */
export function presenceLLR(a: number, n: number, base: number, prior: number): number {
  const p = Math.min(1 - 1e-3, Math.max(1e-3, (a + prior * base) / (n + prior)));
  const b = Math.min(1 - 1e-3, Math.max(1e-3, base));
  return clip(ln(p / (1 - p)) - ln(b / (1 - b)), MAX_LLR);
}

export function fitImitation(boards: readonly BoardSnapshot[], opts: FitOptions = {}): ImitationModel {
  const horizon = opts.horizon ?? DEFAULT_HORIZON;
  const prior = opts.prior ?? DEFAULT_FIT.prior;
  const minBoards = opts.minBoards ?? DEFAULT_FIT.minBoards;
  const pairMinBoards = opts.pairMinBoards ?? DEFAULT_FIT.pairMinBoards;
  const bands = [...(opts.bands ?? DEFAULT_BANDS)];
  const mode = opts.mode ?? DEFAULT_FIT.mode;
  const on = (k: 'cards' | 'pairs' | 'golden' | 'focus' | 'size'): boolean => opts.terms?.[k] ?? DEFAULT_FIT.terms[k];
  const runs = trajectoriesOf(boards, opts.setId);
  const model: ImitationModel = {
    schemaVersion: 1,
    name: opts.name ?? 'imitation',
    setId: opts.setId ?? (boards[0]?.setId ?? 'set2'),
    horizon, prior, bands,
    base: {}, cards: {}, pairs: {}, golden: {}, focus: {}, size: {},
    meta: { ...(opts.corpus ? { corpus: opts.corpus } : {}), runs: runs.length, boards: runs.reduce((n, r) => n + r.boards.length, 0), minBoards, pairMinBoards, ...(opts.validation ? { validation: opts.validation } : {}) },
  };
  for (const { band, rows } of bandRows(runs, bands, horizon)) {
    const S = rows.filter((r) => r.survivor);
    const N = rows.filter((r) => !r.survivor);
    const A = S.length;
    const B = N.length;
    model.base[band.id] = { boards: rows.length, survivors: A, rate: rows.length ? A / rows.length : 0 };
    if (!rows.length) continue;
    // Goldens (Poisson rate ratio, floored so an all-zero class does not blow up).
    const gS = A ? S.reduce((n, r) => n + goldenCount(r.b.snap), 0) / A : 0;
    const gN = B ? N.reduce((n, r) => n + goldenCount(r.b.snap), 0) / B : 0;
    model.golden[band.id] = { survivorsMean: gS, othersMean: gN, perGolden: on('golden') && A && B ? clip(ln((gS + 0.1) / (gN + 0.1)), 1) : 0 };
    // Board size (bodies) — same treatment.
    const sS = A ? S.reduce((n, r) => n + r.b.snap.minions.length, 0) / A : 0;
    const sN = B ? N.reduce((n, r) => n + r.b.snap.minions.length, 0) / B : 0;
    model.size[band.id] = { survivorsMean: sS, othersMean: sN, perBody: on('size') && A && B ? clip(ln((sS + 0.5) / (sN + 0.5)), 0.5) : 0 };
    // Dominant-tribe share: Gaussian LLR slope (difference of means over pooled variance), damped.
    const shares = rows.map((r) => dominantTribe(r.b.snap).share);
    const meanAll = shares.reduce((a, b) => a + b, 0) / shares.length;
    const varAll = Math.max(0.01, shares.reduce((a, x) => a + (x - meanAll) ** 2, 0) / shares.length);
    const fS = A ? S.reduce((n, r) => n + dominantTribe(r.b.snap).share, 0) / A : meanAll;
    const fN = B ? N.reduce((n, r) => n + dominantTribe(r.b.snap).share, 0) / B : meanAll;
    model.focus[band.id] = { mean: meanAll, slope: on('focus') && A && B ? clip((fS - fN) / varAll, 3) : 0 };
    if (!on('cards')) continue;
    const afterMean = rows.reduce((n, r) => n + r.b.survivedAfter, 0) / rows.length;
    const afterSd = Math.max(0.5, Math.sqrt(rows.reduce((n, r) => n + (r.b.survivedAfter - afterMean) ** 2, 0) / rows.length));
    // Cards.
    const perCard = new Map<string, { a: number; b: number; after: number; boards: number }>();
    const perPair = new Map<string, { a: number; b: number; after: number }>();
    let totalAfter = 0;
    for (const r of rows) {
      totalAfter += r.b.survivedAfter;
      const ids = [...new Set(r.b.snap.minions.map((m) => m.cardId))].sort();
      for (const id of ids) {
        const c = perCard.get(id) ?? { a: 0, b: 0, after: 0, boards: 0 };
        if (!perCard.has(id)) perCard.set(id, c);
        if (r.survivor) c.a++; else c.b++;
        c.after += r.b.survivedAfter;
        c.boards++;
      }
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const k = `${ids[i]}|${ids[j]}`;
        const p = perPair.get(k) ?? { a: 0, b: 0, after: 0 };
        if (!perPair.has(k)) perPair.set(k, p);
        if (r.survivor) p.a++; else p.b++;
        p.after += r.b.survivedAfter;
      }
    }
    for (const [id, c] of perCard) {
      if (c.boards < minBoards) continue;
      const others = rows.length - c.boards;
      const holdersAfter = c.after / c.boards;
      const othersAfter = others ? (totalAfter - c.after) / others : holdersAfter;
      // `after` mode: the holders' mean, shrunk toward the band mean with `prior` pseudo-boards, minus the others', in SDs.
      const shrunk = (c.after + prior * afterMean) / (c.boards + prior);
      const w: CardBandWeight = {
        boards: c.boards, survivors: c.a, rate: c.a / c.boards,
        weight: mode === 'after' ? clip((shrunk - othersAfter) / afterSd, MAX_LLR) : presenceLLR(c.a, c.boards, A / rows.length, prior),
        holdersAfter, othersAfter,
      };
      (model.cards[id] ??= {})[band.id] = w;
    }
    if (!on('pairs')) continue;
    for (const [k, p] of perPair) {
      const n = p.a + p.b;
      if (n < pairMinBoards) continue;
      const [x, y] = k.split('|') as [string, string];
      const wx = model.cards[x]?.[band.id]?.weight ?? 0;
      const wy = model.cards[y]?.[band.id]?.weight ?? 0;
      // The pair's own statistic (same mode as the singles, shrunk twice as hard), minus what the two singles already say.
      const pairOthers = rows.length - n;
      const pairOthersAfter = pairOthers ? (totalAfter - p.after) / pairOthers : p.after / n;
      const own = mode === 'after'
        ? clip(((p.after + prior * 2 * afterMean) / (n + prior * 2) - pairOthersAfter) / afterSd, MAX_LLR)
        : presenceLLR(p.a, n, A / rows.length, prior * 2);
      const raw = own - (wx + wy);
      const weight = clip(raw, MAX_PAIR_LLR);
      if (Math.abs(weight) < 0.05) continue;
      (model.pairs[k] ??= {})[band.id] = { boards: n, survivors: p.a, weight };
    }
  }
  return model;
}

// ── scoring ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ScoredCard { cardId: string; golden: boolean; weight: number; inHand: boolean }
export interface BoardScore {
  band: string | null;
  cards: ScoredCard[];
  pairs: { key: string; weight: number }[];
  goldenTerm: number;
  focusTerm: number;
  sizeTerm: number;
  total: number;
}

export interface ScoreInput {
  wave: number;
  board: readonly { cardId: string; golden: boolean }[];
  /** Hand minions (never spells), credited at `handCredit` while the board has room. */
  hand?: readonly { cardId: string; golden: boolean }[];
  boardMax?: number;
}

export const HAND_CREDIT = 0.5;

/** The imitation log-odds of `input` at its wave: null when the model has no band for the wave. Pure. */
export function scoreBoard(model: ImitationModel, input: ScoreInput): BoardScore | null {
  const band = bandOf(input.wave, model.bands);
  if (!band) return null;
  const id = band.id;
  const cards: ScoredCard[] = [];
  let total = 0;
  for (const c of input.board) {
    const w = model.cards[c.cardId]?.[id]?.weight ?? 0;
    cards.push({ cardId: c.cardId, golden: c.golden, weight: w, inHand: false });
    total += w;
  }
  const room = (input.boardMax ?? 7) - input.board.length;
  if (input.hand && room > 0) {
    let credited = 0;
    for (const c of input.hand) {
      if (credited >= room) break;
      const w = (model.cards[c.cardId]?.[id]?.weight ?? 0) * HAND_CREDIT;
      if (w === 0) continue;
      cards.push({ cardId: c.cardId, golden: c.golden, weight: w, inHand: true });
      total += w;
      credited++;
    }
  }
  const ids = [...new Set(input.board.map((c) => c.cardId))].sort();
  const pairs: { key: string; weight: number }[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const k = `${ids[i]}|${ids[j]}`;
    const w = model.pairs[k]?.[id]?.weight;
    if (w) { pairs.push({ key: k, weight: w }); total += w; }
  }
  const goldens = input.board.filter((c) => c.golden).length;
  const goldenTerm = goldens * (model.golden[id]?.perGolden ?? 0);
  const share = dominantShareOf(input.board);
  const f = model.focus[id];
  const focusTerm = f ? f.slope * (share - f.mean) * 0.25 : 0; // damped: share moves 0..1, keep it a nudge
  const sz = model.size[id];
  const sizeTerm = sz ? sz.perBody * (input.board.length - (sz.survivorsMean + sz.othersMean) / 2) : 0;
  total += goldenTerm + focusTerm + sizeTerm;
  return { band: id, cards, pairs, goldenTerm, focusTerm, sizeTerm, total };
}

export function dominantShareOf(board: readonly { cardId: string }[]): number {
  const counts = new Map<string, number>();
  for (const c of board) {
    const def = CARD_INDEX[c.cardId];
    if (!def) continue;
    for (const t of [def.tribe, def.tribe2]) if (t && t !== 'neutral') counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best = 0;
  for (const n of counts.values()) if (n > best) best = n;
  return board.length ? best / board.length : 0;
}

/** A card's weight in a band (0 when unknown). */
export const cardWeight = (model: ImitationModel, cardId: string, bandId: string): number => model.cards[cardId]?.[bandId]?.weight ?? 0;

/** The mean of a card's weights over `bandIds` (missing bands count 0). */
export const cardWeightOver = (model: ImitationModel, cardId: string, bandIds: readonly string[]): number =>
  bandIds.length ? bandIds.reduce((n, b) => n + cardWeight(model, cardId, b), 0) / bandIds.length : 0;

// ── validation ────────────────────────────────────────────────────────────────────────────────────────────

export interface BandMetrics { boards: number; auc: number; nullAuc: number; spearman: number }
export interface ImitationValidation { folds: number; overall: BandMetrics; byBand: Record<string, BandMetrics> }

function ranks(xs: readonly number[]): number[] {
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

export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length < 3) return NaN;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = rx.reduce((a, b) => a + b, 0) / rx.length;
  const my = ry.reduce((a, b) => a + b, 0) / ry.length;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < rx.length; i++) { const dx = rx[i]! - mx; const dy = ry[i]! - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Area under the ROC curve of `score` for `label` (Mann-Whitney), NaN without both classes. */
export function auc(scores: readonly number[], labels: readonly boolean[]): number {
  const r = ranks(scores);
  let pos = 0; let sumPos = 0;
  for (let i = 0; i < r.length; i++) if (labels[i]) { pos++; sumPos += r[i]!; }
  const neg = r.length - pos;
  if (!pos || !neg) return NaN;
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** K-fold BY RUN: fit on the other folds, score the held-out boards, AUC per band against the survivor label.
 *  The null is a score of 0 for every board (AUC 0.5). */
export function crossValidateImitation(boards: readonly BoardSnapshot[], opts: FitOptions & { folds?: number } = {}): ImitationValidation {
  const folds = opts.folds ?? 5;
  const horizon = opts.horizon ?? DEFAULT_HORIZON;
  const runs = trajectoriesOf(boards, opts.setId);
  const keys = runs.map((r) => r.key).sort();
  const foldOf = new Map(keys.map((k, i) => [k, i % folds] as const));
  const held: { band: string; score: number; survivor: boolean; after: number }[] = [];
  for (let f = 0; f < folds; f++) {
    const trainKeys = new Set(keys.filter((k) => foldOf.get(k) !== f));
    const trainBoards = boards.filter((b) => trainKeys.has(`${b.author ?? 'anon'}|${b.heroId}|${b.seed}`));
    const m = fitImitation(trainBoards, opts);
    for (const r of runs) {
      if (foldOf.get(r.key) === f) for (const b of r.boards) {
        const s = scoreBoard(m, { wave: b.wave, board: b.snap.minions.map((x) => ({ cardId: x.cardId, golden: !!x.golden })) });
        if (s) held.push({ band: s.band!, score: s.total, survivor: isSurvivor(b, horizon), after: b.survivedAfter });
      }
    }
  }
  const metrics = (rows: typeof held): BandMetrics => ({
    boards: rows.length,
    auc: auc(rows.map((r) => r.score), rows.map((r) => r.survivor)),
    nullAuc: 0.5,
    spearman: spearman(rows.map((r) => r.score), rows.map((r) => r.after)),
  });
  const byBand: Record<string, BandMetrics> = {};
  for (const b of opts.bands ?? DEFAULT_BANDS) byBand[b.id] = metrics(held.filter((r) => r.band === b.id));
  return { folds, overall: metrics(held), byBand };
}

export function validateImitationModel(raw: unknown): raw is ImitationModel {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Partial<ImitationModel>;
  return m.schemaVersion === 1 && typeof m.name === 'string' && Array.isArray(m.bands) && !!m.cards && !!m.base && !!m.golden && !!m.focus && !!m.pairs && !!m.size;
}

// ── report ────────────────────────────────────────────────────────────────────────────────────────────────

const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : '—');
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '—');
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '—');
const sgn = (x: number): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(2)}` : '—');

/** The explainable table: per band, the cards with the largest |weight| and the plain-English survival column. */
export function renderImitationReport(model: ImitationModel, opts: { top?: number } = {}): string {
  const top = opts.top ?? 20;
  const out: string[] = [];
  out.push(`# Imitation model ${model.name} (${model.setId}) — horizon ${model.horizon}, prior ${model.prior}, ${model.meta.runs} runs / ${model.meta.boards} boards${model.meta.corpus ? `, corpus ${model.meta.corpus.name} ${model.meta.corpus.digest}` : ''}`);
  const v = model.meta.validation;
  if (v) {
    out.push(`held-out (${v.folds}-fold by run): AUC ${f2(v.overall.auc)} (null 0.50), Spearman vs waves-survived ${f2(v.overall.spearman)}; ` +
      model.bands.map((b) => `${b.id} AUC ${f2(v.byBand[b.id]?.auc ?? NaN)} ρ ${f2(v.byBand[b.id]?.spearman ?? NaN)} (n ${v.byBand[b.id]?.boards ?? 0})`).join(', '));
  }
  for (const b of model.bands) {
    const base = model.base[b.id];
    if (!base) continue;
    out.push('');
    out.push(`## ${b.id} (waves ${b.from}–${b.to === 99 ? '18' : b.to}): ${base.boards} boards, base survivor rate ${pct(base.rate)}; golden LLR ${sgn(model.golden[b.id]?.perGolden ?? 0)} per golden (survivors ${f2(model.golden[b.id]?.survivorsMean ?? 0)} vs ${f2(model.golden[b.id]?.othersMean ?? 0)}); focus slope ${sgn(model.focus[b.id]?.slope ?? 0)}; size LLR ${sgn(model.size[b.id]?.perBody ?? 0)} per body (${f1(model.size[b.id]?.survivorsMean ?? 0)} vs ${f1(model.size[b.id]?.othersMean ?? 0)})`);
    const rows = Object.entries(model.cards).map(([id, bands]) => ({ id, w: bands[b.id] })).filter((r): r is { id: string; w: CardBandWeight } => !!r.w)
      .sort((x, y) => Math.abs(y.w.weight) - Math.abs(x.w.weight) || x.id.localeCompare(y.id));
    out.push('');
    out.push('| card | boards | survivor rate | weight | players who kept it survived … |');
    out.push('|---|---|---|---|---|');
    for (const r of rows.slice(0, top)) {
      const longer = r.w.othersAfter > 0 ? (r.w.holdersAfter / r.w.othersAfter - 1) * 100 : NaN;
      out.push(`| ${CARD_INDEX[r.id]?.name ?? r.id} (\`${r.id}\`) | ${r.w.boards} | ${pct(r.w.rate)} (base ${pct(base.rate)}) | ${sgn(r.w.weight)} | ${f1(r.w.holdersAfter)} vs ${f1(r.w.othersAfter)} waves (${Number.isFinite(longer) ? `${longer >= 0 ? '+' : ''}${longer.toFixed(0)}%` : '—'}) |`);
    }
    const pairs = Object.entries(model.pairs).map(([k, bands]) => ({ k, w: bands[b.id] })).filter((p): p is { k: string; w: { boards: number; survivors: number; weight: number } } => !!p.w)
      .sort((x, y) => Math.abs(y.w.weight) - Math.abs(x.w.weight)).slice(0, 8);
    if (pairs.length) out.push(`pairs (interaction beyond the singles): ${pairs.map((p) => `${p.k.split('|').map((id) => CARD_INDEX[id]?.name ?? id).join(' + ')} ${sgn(p.w.weight)} (${p.w.boards})`).join('; ')}`);
  }
  return out.join('\n');
}
