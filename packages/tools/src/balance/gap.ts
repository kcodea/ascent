/**
 * BALANCE BOT — `balance:gap`: the shared measuring stick for "how far is the pilot from real players".
 *
 *   npm run balance:gap -- --job <jobId> [--corpus set2-players-v1] [--out gap.md] [--format md|json]
 *
 * Reads the job's PILOT seats (every seat whose `policyId` is not `recording`) round by round — each `RoundRecord`
 * carries the served-board `snapshot` the pilot ended its recruit turn with — and the named RECORDED PLAYER CORPUS
 * (`out/corpus/<name>.json`, boards grouped into runs by `author | hero | seed`, exactly as `playerRunsFrom` seats
 * them), and prints, per wave 1..`maxWave`:
 *
 *   n · board stat total (Σ attack + health) median + p80 · minion count · golden count · mean tier · largest-tribe
 *   share (neutral excluded) · the GROWTH multiplier (median stat total at W ÷ at W−1)
 *
 * for the pilot and the corpus side by side; then the top-25 card frequencies at wave ≥ 10 (share of boards holding
 * the card) side by side; then the pilot's placement: histogram, mean with a lobby-level bootstrap 95% CI, firsts,
 * top-3, and the PASS LINE — owner 2026-09-15: mean placement under 4.0 passes, under 3.0 is strong, under 2.0
 * phenomenal. Everything is descriptive (evidence level 1); a recorded board carries no placement, so the corpus
 * side is shape only.
 *
 * A pilot round with an EMPTY board carries no `snapshot` and counts as a 0-stat, 0-minion board (the pilot fielded
 * nothing — that is a fact about the pilot, not a missing row). A corpus run with two uploads of one wave keeps the
 * last one in file order.
 */
import { CARD_INDEX, ENGINE_COMBOS, RECORDING_POLICY_ID, type BoardSnapshot, type EngineCombo, type LobbyRecord, type RoundRecord } from './deps';
import type { CorpusFile } from './corpus';
import { bootstrapMean, keyedRng, mean, median, type CI } from './stats';
import { fmt } from './aggregate';
import { pct } from './report';

export interface GapOptions {
  /** Waves 1..maxWave are tabulated (default 16). */
  maxWave?: number;
  /** Card-frequency table: boards from this wave on (default 10). */
  cardWaveMin?: number;
  /** Rows in the card-frequency table (default 25). */
  topCards?: number;
  bootstrapReps?: number;
  seed?: number;
}

/** One side's per-wave shape. Every mean carries its `n` (boards). */
export interface WaveShape {
  n: number;
  statMedian: number | undefined;
  statP80: number | undefined;
  minions: number | undefined;
  goldens: number | undefined;
  tier: number | undefined;
  largestTribeShare: number | undefined;
  /** `statMedian(W) / statMedian(W−1)`; undefined at wave 1 or when either side is empty / zero. */
  growth: number | undefined;
}

export interface CardFrequencyRow {
  cardId: string;
  name: string;
  tier: number;
  /** Share of boards (wave ≥ `cardWaveMin`) holding at least one copy. */
  pilotShare: number | undefined;
  corpusShare: number | undefined;
  pilotBoards: number;
  corpusBoards: number;
}

export type Verdict = 'phenomenal' | 'strong' | 'pass' | 'fail' | 'unmeasured';

/** B11: how often a run holds a FULL engine combo (every piece on the board) by a wave, per side. */
export interface EngineAssembly {
  /** Runs on each side (a pilot seat; a corpus run). */
  pilotRuns: number;
  corpusRuns: number;
  /** Share of runs holding at least one full combo on the board by wave 6 / by wave 8 / ever. */
  byWave6: { pilot: number | undefined; corpus: number | undefined };
  byWave8: { pilot: number | undefined; corpus: number | undefined };
  ever: { pilot: number | undefined; corpus: number | undefined };
  /** Per combo: runs that completed it by wave 6, by wave 8, ever; and the median wave it was first complete. */
  combos: { id: string; pilot6: number; corpus6: number; pilot8: number; corpus8: number; pilotEver: number; corpusEver: number; pilotFirstWave: number | undefined; corpusFirstWave: number | undefined }[];
  /** Pilot seats' mean placement split by "held a full engine by wave 6" (a descriptive split, not a cause). */
  placementSplit: { withEngine: { n: number; mean: number | undefined }; without: { n: number; mean: number | undefined } };
}

export interface GapReport {
  jobId: string;
  policyIds: string[];
  corpus: { name: string; digest: string; runs: number; boards: number; authors: number; maxWave: number };
  /** The PILOT rounds tabulated: lobbies with a pilot seat, and pilot boards seen. */
  pilot: { lobbies: number; boards: number; placed: number; failed: number };
  waves: { wave: number; pilot: WaveShape; corpus: WaveShape }[];
  cards: {
    waveMin: number;
    pilotBoards: number;
    corpusBoards: number;
    /** The pilot's top-N (with the corpus share beside each). */
    pilotTop: CardFrequencyRow[];
    /** The corpus' top-N (with the pilot share beside each). */
    corpusTop: CardFrequencyRow[];
  };
  /** B11 (additive): engine assembly, pilot vs corpus. */
  assembly: EngineAssembly;
  placement: {
    /** index 0 = 1st … index 7 = 8th. */
    histogram: number[];
    n: number;
    mean: CI;
    firsts: number;
    top3: number;
    firstRate: number | undefined;
    top3Rate: number | undefined;
    verdict: Verdict;
    /** The bar, as printed. */
    line: { pass: number; strong: number; phenomenal: number };
  };
}

export const PASS_LINE = { pass: 4.0, strong: 3.0, phenomenal: 2.0 } as const;

/** Owner 2026-09-15: < 4.0 passes, < 3.0 strong, < 2.0 phenomenal. `unmeasured` when there is no placed run. */
export function verdictOf(meanPlacement: number | undefined): Verdict {
  if (meanPlacement === undefined || Number.isNaN(meanPlacement)) return 'unmeasured';
  if (meanPlacement < PASS_LINE.phenomenal) return 'phenomenal';
  if (meanPlacement < PASS_LINE.strong) return 'strong';
  if (meanPlacement < PASS_LINE.pass) return 'pass';
  return 'fail';
}

// ───────────────────────────────────────────── board shape ─────────────────────────────────────────────

/** The one board shape both sides reduce to, so the pilot and the corpus are measured by the same function. */
interface Board { wave: number; tier: number; minions: readonly { cardId: string; attack: number; health: number; golden?: boolean }[] }

interface Shape { stat: number; minions: number; goldens: number; tier: number; largestTribeShare: number }

function shapeOf(b: Board): Shape {
  let stat = 0, goldens = 0;
  const tribes = new Map<string, number>();
  for (const m of b.minions) {
    stat += m.attack + m.health;
    if (m.golden) goldens++;
    const def = CARD_INDEX[m.cardId];
    const t1 = def?.tribe as string | undefined;
    const t2 = (def as { tribe2?: string } | undefined)?.tribe2;
    if (t1 && t1 !== 'neutral') tribes.set(t1, (tribes.get(t1) ?? 0) + 1);
    if (t2 && t2 !== 'neutral') tribes.set(t2, (tribes.get(t2) ?? 0) + 1);
  }
  let largest = 0;
  for (const k of tribes.values()) if (k > largest) largest = k;
  return { stat, minions: b.minions.length, goldens, tier: b.tier, largestTribeShare: b.minions.length ? largest / b.minions.length : 0 };
}

/** Nearest-rank percentile of a sorted array. */
export function percentile(sorted: readonly number[], p: number): number | undefined {
  if (!sorted.length) return undefined;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

function waveShape(boards: readonly Board[], prevMedian: number | undefined): WaveShape {
  const shapes = boards.map(shapeOf);
  const stats = shapes.map((s) => s.stat).sort((a, b) => a - b);
  const statMedian = median(stats);
  const growth = prevMedian !== undefined && prevMedian > 0 && statMedian !== undefined ? statMedian / prevMedian : undefined;
  return {
    n: boards.length,
    statMedian, statP80: percentile(stats, 0.8),
    minions: mean(shapes.map((s) => s.minions)), goldens: mean(shapes.map((s) => s.goldens)), tier: mean(shapes.map((s) => s.tier)),
    largestTribeShare: mean(shapes.map((s) => s.largestTribeShare)),
    growth,
  };
}

/** Share of boards holding ≥ 1 copy of each card. */
function cardShares(boards: readonly Board[]): Map<string, number> {
  const held = new Map<string, number>();
  for (const b of boards) {
    const seen = new Set<string>();
    for (const m of b.minions) { if (seen.has(m.cardId)) continue; seen.add(m.cardId); held.set(m.cardId, (held.get(m.cardId) ?? 0) + 1); }
  }
  return held;
}

// ───────────────────────────────────────────── engine assembly (B11) ─────────────────────────────────────────────

/** Is every piece of `combo` on this board (one copy each; alternatives count)? */
function comboComplete(combo: EngineCombo, board: Board): boolean {
  const held = new Set(board.minions.map((m) => m.cardId));
  return combo.pieces.every((p) => p.ids.some((id) => held.has(id)));
}

/** For one run's boards (any order): per combo, the first wave it was complete on the board. */
function firstCompleteWaves(boards: readonly Board[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of [...boards].sort((x, y) => x.wave - y.wave)) {
    for (const c of ENGINE_COMBOS) if (!out.has(c.id) && comboComplete(c, b)) out.set(c.id, b.wave);
  }
  return out;
}

export function computeAssembly(pilotRuns: readonly { boards: Board[]; placement?: number }[], corpusRuns: readonly Board[][]): EngineAssembly {
  const pilotFirst = pilotRuns.map((r) => firstCompleteWaves(r.boards));
  const corpusFirst = corpusRuns.map((b) => firstCompleteWaves(b));
  const share = (list: readonly Map<string, number>[], by: number): number | undefined =>
    list.length ? list.filter((m) => [...m.values()].some((w) => w <= by)).length / list.length : undefined;
  const combos = ENGINE_COMBOS.map((c) => {
    const p = pilotFirst.map((m) => m.get(c.id)).filter((w): w is number => w !== undefined);
    const q = corpusFirst.map((m) => m.get(c.id)).filter((w): w is number => w !== undefined);
    return {
      id: c.id,
      pilot6: p.filter((w) => w <= 6).length, corpus6: q.filter((w) => w <= 6).length,
      pilot8: p.filter((w) => w <= 8).length, corpus8: q.filter((w) => w <= 8).length,
      pilotEver: p.length, corpusEver: q.length,
      pilotFirstWave: median([...p].sort((a, b) => a - b)), corpusFirstWave: median([...q].sort((a, b) => a - b)),
    };
  }).filter((c) => c.pilotEver + c.corpusEver > 0);
  const withEngine = pilotRuns.filter((r, i) => r.placement !== undefined && [...pilotFirst[i]!.values()].some((w) => w <= 6)).map((r) => r.placement!);
  const without = pilotRuns.filter((r, i) => r.placement !== undefined && ![...pilotFirst[i]!.values()].some((w) => w <= 6)).map((r) => r.placement!);
  return {
    pilotRuns: pilotRuns.length, corpusRuns: corpusRuns.length,
    byWave6: { pilot: share(pilotFirst, 6), corpus: share(corpusFirst, 6) },
    byWave8: { pilot: share(pilotFirst, 8), corpus: share(corpusFirst, 8) },
    ever: { pilot: share(pilotFirst, Infinity), corpus: share(corpusFirst, Infinity) },
    combos,
    placementSplit: { withEngine: { n: withEngine.length, mean: mean(withEngine) }, without: { n: without.length, mean: mean(without) } },
  };
}

// ───────────────────────────────────────────── the two populations ─────────────────────────────────────────────

/** The pilot's served board at the end of each recruit turn. An empty board (no snapshot) is a real 0-stat board. */
function pilotBoardOf(r: RoundRecord): Board {
  const s: BoardSnapshot | undefined = r.snapshot;
  return s ? { wave: r.round, tier: r.tier, minions: s.minions } : { wave: r.round, tier: r.tier, minions: [] };
}

/** The corpus' boards, one per run-wave (`author | hero | seed`, the lobby's own run key; the last upload wins). */
export function corpusBoards(file: Pick<CorpusFile, 'boards'>): { boards: Board[]; runs: number; authors: number; maxWave: number; byRun: Board[][] } {
  const byRunWave = new Map<string, BoardSnapshot>();
  const authors = new Set<string>();
  for (const b of file.boards) {
    const key = `${b.author ?? 'anon'}|${b.heroId}|${b.seed}|${b.wave}`;
    byRunWave.set(key, b);
    authors.add(b.author ?? 'anon');
  }
  const runs = new Map<string, Board[]>();
  let maxWave = 0;
  const boards: Board[] = [];
  for (const b of byRunWave.values()) {
    const key = `${b.author ?? 'anon'}|${b.heroId}|${b.seed}`;
    if (b.wave > maxWave) maxWave = b.wave;
    const board: Board = { wave: b.wave, tier: b.tier, minions: b.minions };
    boards.push(board);
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key)!.push(board);
  }
  return { boards, runs: runs.size, authors: authors.size, maxWave, byRun: [...runs.values()] };
}

export function computeGap(jobId: string, lobbies: readonly LobbyRecord[], corpus: CorpusFile, opts: GapOptions = {}): GapReport {
  const maxWave = opts.maxWave ?? 16;
  const cardWaveMin = opts.cardWaveMin ?? 10;
  const topCards = opts.topCards ?? 25;
  const reps = opts.bootstrapReps ?? 1000;
  const rng = keyedRng(opts.seed ?? 1, 'gap:placement');

  // ── the pilot: every non-recording seat, rounds of completed (non-censored) lobbies ──────────────────────────
  const policyIds = new Set<string>();
  const pilotBoards: Board[] = [];
  const pilotRuns: { boards: Board[]; placement?: number }[] = [];
  const placements: { lobbyId: string; placement: number }[] = [];
  let lobbiesWithPilot = 0, placed = 0, failed = 0;
  for (const L of lobbies) {
    const pilots = L.seats.filter((s) => s.policyId !== RECORDING_POLICY_ID);
    if (!pilots.length) continue;
    lobbiesWithPilot++;
    for (const s of pilots) policyIds.add(s.policyId);
    const pilotSeatIds = new Set(pilots.map((s) => s.seatId));
    if (L.failure) { failed += pilots.length; continue; }
    for (const s of pilots) {
      if (s.termination === 'placed' && s.placement !== undefined) { placed++; placements.push({ lobbyId: L.lobbyId, placement: s.placement }); }
      else if (s.termination === 'failed') failed++;
    }
    for (const r of L.rounds) if (pilotSeatIds.has(r.seatId)) pilotBoards.push(pilotBoardOf(r));
    for (const s of pilots) {
      pilotRuns.push({ boards: L.rounds.filter((r) => r.seatId === s.seatId).map(pilotBoardOf), ...(s.termination === 'placed' && s.placement !== undefined ? { placement: s.placement } : {}) });
    }
  }

  // ── the corpus ──────────────────────────────────────────────────────────────────────────────────────────────
  const C = corpusBoards(corpus);

  // ── per wave ────────────────────────────────────────────────────────────────────────────────────────────────
  const waves: GapReport['waves'] = [];
  let prevPilot: number | undefined, prevCorpus: number | undefined;
  for (let w = 1; w <= maxWave; w++) {
    const p = waveShape(pilotBoards.filter((b) => b.wave === w), prevPilot);
    const c = waveShape(C.boards.filter((b) => b.wave === w), prevCorpus);
    waves.push({ wave: w, pilot: p, corpus: c });
    prevPilot = p.statMedian; prevCorpus = c.statMedian;
  }

  // ── card frequency at wave ≥ cardWaveMin ────────────────────────────────────────────────────────────────────
  const pLate = pilotBoards.filter((b) => b.wave >= cardWaveMin);
  const cLate = C.boards.filter((b) => b.wave >= cardWaveMin);
  const pHeld = cardShares(pLate), cHeld = cardShares(cLate);
  const row = (cardId: string): CardFrequencyRow => {
    const def = CARD_INDEX[cardId];
    const pb = pHeld.get(cardId) ?? 0, cb = cHeld.get(cardId) ?? 0;
    return {
      cardId, name: def?.name ?? cardId, tier: Number(def?.tier ?? 0),
      pilotShare: pLate.length ? pb / pLate.length : undefined, corpusShare: cLate.length ? cb / cLate.length : undefined,
      pilotBoards: pb, corpusBoards: cb,
    };
  };
  const top = (held: Map<string, number>): CardFrequencyRow[] =>
    [...held.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, topCards).map(([id]) => row(id));

  // ── placement ───────────────────────────────────────────────────────────────────────────────────────────────
  const histogram = Array.from({ length: 8 }, () => 0);
  for (const p of placements) if (p.placement >= 1 && p.placement <= 8) histogram[p.placement - 1]!++;
  const partials = new Map<string, { sum: number; n: number }>();
  for (const p of placements) { const x = partials.get(p.lobbyId) ?? { sum: 0, n: 0 }; x.sum += p.placement; x.n++; partials.set(p.lobbyId, x); }
  const meanCI = bootstrapMean([...partials.values()], reps, rng);
  const firsts = histogram[0]!, top3 = histogram[0]! + histogram[1]! + histogram[2]!;

  return {
    jobId, policyIds: [...policyIds].sort(),
    corpus: { name: corpus.name, digest: corpus.digest, runs: C.runs, boards: C.boards.length, authors: C.authors, maxWave: C.maxWave },
    pilot: { lobbies: lobbiesWithPilot, boards: pilotBoards.length, placed, failed },
    waves,
    cards: { waveMin: cardWaveMin, pilotBoards: pLate.length, corpusBoards: cLate.length, pilotTop: top(pHeld), corpusTop: top(cHeld) },
    assembly: computeAssembly(pilotRuns, C.byRun),
    placement: {
      histogram, n: placements.length, mean: meanCI, firsts, top3,
      firstRate: placements.length ? firsts / placements.length : undefined, top3Rate: placements.length ? top3 / placements.length : undefined,
      verdict: verdictOf(meanCI.est), line: { ...PASS_LINE },
    },
  };
}

// ───────────────────────────────────────────── rendering ─────────────────────────────────────────────

export interface GapRenderOptions { format: 'md' | 'json' }

const x = (v: number | undefined): string => (v === undefined ? '—' : `×${v.toFixed(2)}`);
const VERDICT_TEXT: Record<Verdict, string> = {
  phenomenal: 'PHENOMENAL (< 2.0)', strong: 'STRONG (< 3.0)', pass: 'PASS (< 4.0)', fail: 'FAIL (≥ 4.0 — below the bar)', unmeasured: 'UNMEASURED (no placed pilot run)',
};

export function renderGap(g: GapReport, opts: GapRenderOptions): string {
  if (opts.format === 'json') return JSON.stringify(g, null, 2);
  const o: string[] = [];
  o.push(`# Pilot ↔ players gap — job \`${g.jobId}\` vs corpus \`${g.corpus.name}\``);
  o.push('');
  o.push(`Pilot: ${g.policyIds.join(', ') || '(none)'} — ${g.pilot.lobbies} lobbies, ${g.pilot.boards} end-of-turn boards, ${g.pilot.placed} placed, ${g.pilot.failed} failed.`);
  o.push(`Corpus: \`${g.corpus.name}\` (digest ${g.corpus.digest}) — ${g.corpus.runs} runs / ${g.corpus.boards} boards / ${g.corpus.authors} authors, last recorded wave ${g.corpus.maxWave}.`);
  o.push('');
  o.push('Descriptive only (evidence level 1). A recorded board carries no placement, so the corpus side is board SHAPE; the pilot side is the served board it ended each recruit turn with (an empty board counts as 0). Stat total = Σ attack + health over the board.');
  o.push('');

  o.push('## Placement (pilot seats)');
  o.push('');
  const pl = g.placement;
  const meanText = pl.mean.est === undefined ? '—' : pl.mean.lobbies < 2 ? `${fmt(pl.mean.est)} [single lobby]` : `${fmt(pl.mean.est)} [${fmt(pl.mean.lo)}, ${fmt(pl.mean.hi)}]`;
  o.push(`- **Mean placement ${meanText}** (n=${pl.n}, ${pl.mean.lobbies} lobbies, lobby-level bootstrap 95% CI) → **${VERDICT_TEXT[pl.verdict]}**`);
  o.push(`- Pass line (owner 2026-09-15): < ${pl.line.pass.toFixed(1)} pass · < ${pl.line.strong.toFixed(1)} strong · < ${pl.line.phenomenal.toFixed(1)} phenomenal`);
  o.push(`- Firsts ${pl.firsts} (${pct(pl.firstRate)}) · top-3 ${pl.top3} (${pct(pl.top3Rate)})`);
  o.push('');
  o.push('| place | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th |');
  o.push('|---|---|---|---|---|---|---|---|---|');
  o.push(`| runs | ${pl.histogram.join(' | ')} |`);
  o.push('');

  o.push('## Board shape by wave — pilot vs corpus');
  o.push('');
  o.push('Each cell reads `pilot / corpus`. Stat median + p80 over boards at that wave; minions, goldens, tier, largest-tribe share (neutral excluded) are means.');
  o.push('');
  o.push('| wave | n | stat median | stat p80 | minions | goldens | tier | largest tribe |');
  o.push('|---|---|---|---|---|---|---|---|');
  const pair = (a: number | undefined, b: number | undefined, dp: number): string => `${fmt(a, dp)} / ${fmt(b, dp)}`;
  for (const w of g.waves) {
    const p = w.pilot, c = w.corpus;
    o.push(`| ${w.wave} | ${p.n} / ${c.n} | ${pair(p.statMedian, c.statMedian, 0)} | ${pair(p.statP80, c.statP80, 0)} | ${pair(p.minions, c.minions, 1)} | ${pair(p.goldens, c.goldens, 2)} | ${pair(p.tier, c.tier, 2)} | ${pct(p.largestTribeShare)} / ${pct(c.largestTribeShare)} |`);
  }
  o.push('');

  o.push('## Growth multiplier by wave (median stat total at W ÷ at W−1)');
  o.push('');
  o.push('| wave | ' + g.waves.map((w) => w.wave).join(' | ') + ' |');
  o.push('|---|' + g.waves.map(() => '---').join('|') + '|');
  o.push('| pilot | ' + g.waves.map((w) => x(w.pilot.growth)).join(' | ') + ' |');
  o.push('| corpus | ' + g.waves.map((w) => x(w.corpus.growth)).join(' | ') + ' |');
  o.push('');

  o.push('## Engine assembly (B11) — runs holding a FULL engine combo on the board');
  o.push('');
  const A = g.assembly;
  o.push(`Combos from \`strategy/combos.ts\` (every piece on the board at once; alternatives count). Runs: pilot ${A.pilotRuns}, corpus ${A.corpusRuns}.`);
  o.push('');
  o.push('| | by wave 6 | by wave 8 | ever |');
  o.push('|---|---|---|---|');
  o.push(`| pilot | ${pct(A.byWave6.pilot)} | ${pct(A.byWave8.pilot)} | ${pct(A.ever.pilot)} |`);
  o.push(`| corpus | ${pct(A.byWave6.corpus)} | ${pct(A.byWave8.corpus)} | ${pct(A.ever.corpus)} |`);
  o.push('');
  o.push(`Pilot placement, split by a full engine by wave 6: with ${fmt(A.placementSplit.withEngine.mean)} (n=${A.placementSplit.withEngine.n}) · without ${fmt(A.placementSplit.without.mean)} (n=${A.placementSplit.without.n}) — a descriptive split, not a cause.`);
  o.push('');
  o.push('| combo | pilot: by w6 / by w8 / ever (median first wave) | corpus: by w6 / by w8 / ever (median first wave) |');
  o.push('|---|---|---|');
  for (const c of A.combos) o.push(`| ${c.id} | ${c.pilot6} / ${c.pilot8} / ${c.pilotEver} (${fmt(c.pilotFirstWave, 0)}) | ${c.corpus6} / ${c.corpus8} / ${c.corpusEver} (${fmt(c.corpusFirstWave, 0)}) |`);
  o.push('');

  o.push(`## Card frequency at wave ≥ ${g.cards.waveMin} (share of boards holding the card)`);
  o.push('');
  o.push(`Pilot boards ${g.cards.pilotBoards}; corpus boards ${g.cards.corpusBoards}. Left: the pilot's top ${g.cards.pilotTop.length}; right: the corpus' top ${g.cards.corpusTop.length}; each row also shows the other side's share.`);
  o.push('');
  o.push('| # | pilot card | T | pilot | corpus | | corpus card | T | corpus | pilot |');
  o.push('|---|---|---|---|---|---|---|---|---|---|');
  const rows = Math.max(g.cards.pilotTop.length, g.cards.corpusTop.length);
  for (let i = 0; i < rows; i++) {
    const a = g.cards.pilotTop[i], b = g.cards.corpusTop[i];
    const left = a ? `${a.name} | ${a.tier} | ${pct(a.pilotShare)} | ${pct(a.corpusShare)}` : '— | | | ';
    const right = b ? `${b.name} | ${b.tier} | ${pct(b.corpusShare)} | ${pct(b.pilotShare)}` : '— | | | ';
    o.push(`| ${i + 1} | ${left} | | ${right} |`);
  }
  o.push('');
  return o.join('\n');
}
