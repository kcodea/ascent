/**
 * IMITATION (B7) — THE PLAYER STUDY: what the recorded set-2 runs actually do, wave by wave.
 *
 * `studyCorpus` reduces the trajectories to the tables a designer (and the fitter) needs: the per-wave stat curve,
 * goldens / minions / tier per wave, tribe focus, which cards sit on boards that go on to survive vs boards that die
 * soon after, which card pairs co-occur, and the hero → tribe → core-card lines the end-game runs took.
 * `renderStudy` prints it as Markdown (`docs/balance-bot-player-study.md` is its output — regenerate, never hand-edit).
 *
 * Every number is descriptive: counts, medians, quantiles, rates. No model here — the fitter (`model.ts`) turns the
 * same counts into weights.
 */
import { CARD_INDEX } from '@game/content';
import type { Tribe } from '@game/core';
import type { BoardSnapshot } from '../../snapshot';
import {
  boardStats, DEFAULT_HORIZON, dominantTribe, goldenCount, isSurvivor, mean, meanMinionTier, quantile,
  trajectoriesOf, type RunTrajectory, type TrajectoryBoard,
} from './trajectories';

export interface WaveRow {
  wave: number;
  boards: number;
  runsAlive: number;
  statsMedian: number;
  statsP80: number;
  statsP20: number;
  goldensMean: number;
  goldensP80: number;
  minionsMean: number;
  tierMean: number;
  tierMedian: number;
  minionTierMean: number;
  dominantShareMedian: number;
  /** Share of boards at this wave whose run went on to survive `horizon` more waves (or reached the end). */
  survivorRate: number;
  /** Recorded fight results on the boards of this wave. */
  winRate: number;
}

export interface CardStudyRow {
  cardId: string;
  name: string;
  tier: number;
  tribe: string;
  /** Boards in the band holding the card. */
  boards: number;
  /** Distinct runs holding it in the band. */
  runs: number;
  goldenShare: number;
  survivorRate: number;
  /** The band's base survivor rate (the same for every row of a band). */
  baseRate: number;
  /** Mean waves survived after the board, holders vs the band's non-holders. */
  survivedAfterHolders: number;
  survivedAfterOthers: number;
}

export interface PairStudyRow {
  a: string;
  b: string;
  boards: number;
  survivorRate: number;
  /** The survivor rate the two cards' individual rates would predict if independent (geometric mean of lifts). */
  expectedRate: number;
}

export interface LineStudyRow {
  heroId: string;
  tribe: string;
  runs: number;
  reachedEnd: number;
  lastWaveMean: number;
  /** Cards that appeared on the final boards of these runs, most common first, with the share of the runs. */
  cores: { cardId: string; name: string; share: number }[];
}

export interface BandStudy {
  id: string;
  from: number;
  to: number;
  boards: number;
  baseRate: number;
  cards: CardStudyRow[];
  pairs: PairStudyRow[];
}

export interface CorpusStudy {
  setId: string;
  boards: number;
  runs: number;
  authors: number;
  horizon: number;
  lastWaveHistogram: Record<number, number>;
  waves: WaveRow[];
  bands: BandStudy[];
  /** Dominant tribe on the LAST board of every run, split by whether the run reached the end. */
  tribeFinish: { tribe: string; runs: number; reachedEnd: number; lastWaveMean: number }[];
  lines: LineStudyRow[];
  /** Cards on final boards of runs that reached the end vs runs eliminated by wave 10 — the two ends of the field. */
  endgameCards: { cardId: string; name: string; endRuns: number; earlyRuns: number }[];
}

export interface Band { id: string; from: number; to: number }

/** The default bands: where the strategist dies (8–12) is where the corpus is thickest. */
export const DEFAULT_BANDS: readonly Band[] = [
  { id: 'open', from: 1, to: 4 },
  { id: 'build', from: 5, to: 7 },
  { id: 'scale', from: 8, to: 10 },
  { id: 'late', from: 11, to: 99 },
];

export const bandOf = (wave: number, bands: readonly Band[] = DEFAULT_BANDS): Band | null =>
  bands.find((b) => wave >= b.from && wave <= b.to) ?? null;

const cardName = (id: string): string => CARD_INDEX[id]?.name ?? id;

function waveRows(runs: readonly RunTrajectory[], horizon: number): WaveRow[] {
  const byWave = new Map<number, TrajectoryBoard[]>();
  for (const r of runs) for (const b of r.boards) (byWave.get(b.wave) ?? byWave.set(b.wave, []).get(b.wave)!).push(b);
  const rows: WaveRow[] = [];
  for (const wave of [...byWave.keys()].sort((a, b) => a - b)) {
    const bs = byWave.get(wave)!;
    const stats = bs.map((b) => boardStats(b.snap));
    const goldens = bs.map((b) => goldenCount(b.snap));
    const tiers = bs.map((b) => b.snap.tier);
    const known = bs.filter((b) => b.result === 'win' || b.result === 'lose' || b.result === 'draw');
    rows.push({
      wave,
      boards: bs.length,
      runsAlive: runs.filter((r) => r.firstWave <= wave && r.lastWave >= wave).length,
      statsMedian: quantile(stats, 0.5),
      statsP80: quantile(stats, 0.8),
      statsP20: quantile(stats, 0.2),
      goldensMean: mean(goldens),
      goldensP80: quantile(goldens, 0.8),
      minionsMean: mean(bs.map((b) => b.snap.minions.length)),
      tierMean: mean(tiers),
      tierMedian: quantile(tiers, 0.5),
      minionTierMean: mean(bs.map((b) => meanMinionTier(b.snap))),
      dominantShareMedian: quantile(bs.map((b) => dominantTribe(b.snap).share), 0.5),
      survivorRate: mean(bs.map((b) => (isSurvivor(b, horizon) ? 1 : 0))),
      winRate: known.length ? mean(known.map((b) => (b.result === 'win' ? 1 : 0))) : NaN,
    });
  }
  return rows;
}

function bandStudy(band: Band, runs: readonly RunTrajectory[], horizon: number, minBoards: number): BandStudy {
  const rows: { run: string; b: TrajectoryBoard; survivor: boolean }[] = [];
  for (const r of runs) for (const b of r.boards) if (b.wave >= band.from && b.wave <= band.to) rows.push({ run: r.key, b, survivor: isSurvivor(b, horizon) });
  const baseRate = mean(rows.map((r) => (r.survivor ? 1 : 0)));
  const allAfter = rows.map((r) => r.b.survivedAfter);

  const perCard = new Map<string, { boards: number; runs: Set<string>; golden: number; survivors: number; after: number[] }>();
  const perPair = new Map<string, { boards: number; survivors: number }>();
  for (const r of rows) {
    const ids = [...new Set(r.b.snap.minions.map((m) => m.cardId))].sort();
    for (const m of r.b.snap.minions) {
      const c = perCard.get(m.cardId) ?? { boards: 0, runs: new Set<string>(), golden: 0, survivors: 0, after: [] };
      if (!perCard.has(m.cardId)) perCard.set(m.cardId, c);
      if (m.golden) c.golden++;
    }
    for (const id of ids) {
      const c = perCard.get(id)!;
      c.boards++;
      c.runs.add(r.run);
      if (r.survivor) c.survivors++;
      c.after.push(r.b.survivedAfter);
    }
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = `${ids[i]}|${ids[j]}`;
      const p = perPair.get(k) ?? { boards: 0, survivors: 0 };
      if (!perPair.has(k)) perPair.set(k, p);
      p.boards++;
      if (r.survivor) p.survivors++;
    }
  }
  const totalAfter = allAfter.reduce((a, b) => a + b, 0);
  const cards: CardStudyRow[] = [];
  for (const [cardId, c] of perCard) {
    if (c.boards < minBoards) continue;
    const def = CARD_INDEX[cardId];
    const holdersAfter = c.after.reduce((a, b) => a + b, 0);
    const others = rows.length - c.boards;
    cards.push({
      cardId, name: cardName(cardId), tier: def?.tier ?? 0, tribe: def ? (def.tribe2 ? `${def.tribe}/${def.tribe2}` : def.tribe) : '?',
      boards: c.boards, runs: c.runs.size, goldenShare: c.boards ? c.golden / c.boards : 0,
      survivorRate: c.survivors / c.boards, baseRate,
      survivedAfterHolders: holdersAfter / c.boards,
      survivedAfterOthers: others ? (totalAfter - holdersAfter) / others : NaN,
    });
  }
  cards.sort((a, b) => b.boards - a.boards || a.cardId.localeCompare(b.cardId));
  const rateOf = new Map(cards.map((c) => [c.cardId, c.survivorRate] as const));
  const pairs: PairStudyRow[] = [];
  for (const [k, p] of perPair) {
    if (p.boards < minBoards) continue;
    const [a, b] = k.split('|') as [string, string];
    const ra = rateOf.get(a);
    const rb = rateOf.get(b);
    if (ra === undefined || rb === undefined) continue;
    // Independence-ish expectation: base × lift(a) × lift(b), clipped.
    const expected = Math.min(1, baseRate * (ra / Math.max(1e-6, baseRate)) * (rb / Math.max(1e-6, baseRate)));
    pairs.push({ a, b, boards: p.boards, survivorRate: p.survivors / p.boards, expectedRate: expected });
  }
  pairs.sort((x, y) => y.boards - x.boards || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  return { id: band.id, from: band.from, to: band.to, boards: rows.length, baseRate, cards, pairs };
}

export interface StudyOptions {
  setId?: 'set2' | 'set3' | 'set1';
  horizon?: number;
  bands?: readonly Band[];
  /** A card / pair needs at least this many boards in a band to be listed. */
  minBoards?: number;
}

export function studyCorpus(boards: readonly BoardSnapshot[], opts: StudyOptions = {}): CorpusStudy {
  const horizon = opts.horizon ?? DEFAULT_HORIZON;
  const bands = opts.bands ?? DEFAULT_BANDS;
  const minBoards = opts.minBoards ?? 6;
  const runs = trajectoriesOf(boards, opts.setId);
  const hist: Record<number, number> = {};
  for (const r of runs) hist[r.lastWave] = (hist[r.lastWave] ?? 0) + 1;

  // Tribe finish + lines: the LAST board of every run.
  const byTribe = new Map<string, RunTrajectory[]>();
  const byLine = new Map<string, RunTrajectory[]>();
  for (const r of runs) {
    const last = r.boards[r.boards.length - 1]!;
    const t = dominantTribe(last.snap).tribe ?? 'none';
    (byTribe.get(t) ?? byTribe.set(t, []).get(t)!).push(r);
    const k = `${r.heroId}|${t}`;
    (byLine.get(k) ?? byLine.set(k, []).get(k)!).push(r);
  }
  const tribeFinish = [...byTribe].map(([tribe, rs]) => ({
    tribe, runs: rs.length, reachedEnd: rs.filter((r) => r.reachedEnd).length, lastWaveMean: mean(rs.map((r) => r.lastWave)),
  })).sort((a, b) => b.runs - a.runs || a.tribe.localeCompare(b.tribe));
  const lines: LineStudyRow[] = [...byLine].map(([k, rs]) => {
    const [heroId, tribe] = k.split('|') as [string, string];
    const counts = new Map<string, number>();
    for (const r of rs) for (const id of new Set(r.boards[r.boards.length - 1]!.snap.minions.map((m) => m.cardId))) counts.set(id, (counts.get(id) ?? 0) + 1);
    const cores = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([cardId, n]) => ({ cardId, name: cardName(cardId), share: n / rs.length }));
    return { heroId, tribe, runs: rs.length, reachedEnd: rs.filter((r) => r.reachedEnd).length, lastWaveMean: mean(rs.map((r) => r.lastWave)), cores };
  }).sort((a, b) => b.reachedEnd - a.reachedEnd || b.runs - a.runs || a.heroId.localeCompare(b.heroId));

  // End-game vs early-out final boards.
  const endCounts = new Map<string, number>();
  const earlyCounts = new Map<string, number>();
  for (const r of runs) {
    const last = r.boards[r.boards.length - 1]!;
    const ids = new Set(last.snap.minions.map((m) => m.cardId));
    if (r.reachedEnd) for (const id of ids) endCounts.set(id, (endCounts.get(id) ?? 0) + 1);
    else if (r.lastWave <= 10) for (const id of ids) earlyCounts.set(id, (earlyCounts.get(id) ?? 0) + 1);
  }
  const endgameCards = [...new Set([...endCounts.keys(), ...earlyCounts.keys()])]
    .map((cardId) => ({ cardId, name: cardName(cardId), endRuns: endCounts.get(cardId) ?? 0, earlyRuns: earlyCounts.get(cardId) ?? 0 }))
    .filter((c) => c.endRuns + c.earlyRuns >= 3)
    .sort((a, b) => b.endRuns - a.endRuns || a.earlyRuns - b.earlyRuns || a.cardId.localeCompare(b.cardId));

  return {
    setId: opts.setId ?? (boards[0]?.setId ?? 'set2'),
    boards: runs.reduce((n, r) => n + r.boards.length, 0),
    runs: runs.length,
    authors: new Set(runs.map((r) => r.author)).size,
    horizon,
    lastWaveHistogram: hist,
    waves: waveRows(runs, horizon),
    bands: bands.map((b) => bandStudy(b, runs, horizon, minBoards)),
    tribeFinish,
    lines,
    endgameCards,
  };
}

// ── rendering ─────────────────────────────────────────────────────────────────────────────────────────────

const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : '—');
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '—');
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : '—');
const pct = (x: number): string => (Number.isFinite(x) ? `${(x * 100).toFixed(0)}%` : '—');
const signed = (x: number): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(1)}` : '—');

export function renderStudy(s: CorpusStudy, opts: { corpusName?: string; digest?: string; date?: string; topCards?: number; topPairs?: number } = {}): string {
  const top = opts.topCards ?? 18;
  const topPairs = opts.topPairs ?? 12;
  const out: string[] = [];
  out.push(`# The recorded set-2 players — a study of the corpus (${opts.date ?? 'generated'})`);
  out.push('');
  out.push(`> GENERATED by \`npm run balance:imitation:study\` from corpus **${opts.corpusName ?? s.setId}**${opts.digest ? ` (digest \`${opts.digest}\`)` : ''}: ` +
    `${s.boards} boards, ${s.runs} runs (≥ 4 waves), ${s.authors} authors. Regenerate it; do not hand-edit. ` +
    `A board is a **survivor** when its run went on for ≥ ${s.horizon} more waves AND reached at least wave 12 (the median finish), or reached wave 14+ (the end-game); ` +
    `"survived after" is the number of waves the run played after that board fought. A recording carries no placement, so survival is the label throughout.`);
  out.push('');
  out.push('## How far the runs got');
  out.push('');
  const hist = Object.entries(s.lastWaveHistogram).sort((a, b) => Number(a[0]) - Number(b[0]));
  out.push(`| last wave | ${hist.map(([w]) => w).join(' | ')} |`);
  out.push(`|---|${hist.map(() => '---').join('|')}|`);
  out.push(`| runs | ${hist.map(([, n]) => n).join(' | ')} |`);
  out.push('');
  const reached = Object.entries(s.lastWaveHistogram).filter(([w]) => Number(w) >= 14).reduce((n, [, k]) => n + k, 0);
  out.push(`${reached} of ${s.runs} runs (${pct(reached / s.runs)}) reached the end-game (wave 14+); the median run ended at wave ` +
    `${f0(quantile(Object.entries(s.lastWaveHistogram).flatMap(([w, n]) => Array<number>(n).fill(Number(w))), 0.5))}.`);
  out.push('');
  out.push('## The per-wave curve');
  out.push('');
  out.push('Total board stats = Σ(attack + health). "Survivor" = the share of boards at that wave whose run went on ≥ 3 more waves and reached at least wave 12 (or reached the end). "Win" = the recorded result of the fight that board went into.');
  out.push('');
  out.push('| wave | boards | runs alive | stats p20 / median / p80 | goldens mean (p80) | minions | shop tier mean | minion tier mean | dominant-tribe share (median) | survivor | win |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const w of s.waves) {
    out.push(`| ${w.wave} | ${w.boards} | ${w.runsAlive} | ${f0(w.statsP20)} / **${f0(w.statsMedian)}** / ${f0(w.statsP80)} | ${f2(w.goldensMean)} (${f0(w.goldensP80)}) | ${f1(w.minionsMean)} | ${f2(w.tierMean)} | ${f2(w.minionTierMean)} | ${pct(w.dominantShareMedian)} | ${pct(w.survivorRate)} | ${pct(w.winRate)} |`);
  }
  out.push('');
  out.push('## Where the runs finish, by dominant tribe on the final board');
  out.push('');
  out.push('| dominant tribe | runs | reached end | last wave mean |');
  out.push('|---|---|---|---|');
  for (const t of s.tribeFinish) out.push(`| ${t.tribe} | ${t.runs} | ${t.reachedEnd} (${pct(t.reachedEnd / t.runs)}) | ${f1(t.lastWaveMean)} |`);
  out.push('');
  out.push('## Cards that survive, per wave band');
  out.push('');
  out.push('For every band: the cards that appear on the most boards, with the share of those boards whose run survived ≥ 3 more waves (against the band\'s base rate), and how many waves the holders\' runs went on for compared with the non-holders\'. Cards on fewer than 6 boards in the band are omitted. **"golden"** = the share of holdings that were golden.');
  for (const b of s.bands) {
    out.push('');
    out.push(`### Waves ${b.from}–${b.to === 99 ? '18' : b.to} (${b.id}) — ${b.boards} boards, base survivor rate ${pct(b.baseRate)}`);
    out.push('');
    out.push('| card | tier | tribe | boards (runs) | golden | survivor | vs base | survived after: holders / others |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const c of b.cards.slice(0, top)) {
      out.push(`| ${c.name} (\`${c.cardId}\`) | ${c.tier} | ${c.tribe} | ${c.boards} (${c.runs}) | ${pct(c.goldenShare)} | ${pct(c.survivorRate)} | ${signed((c.survivorRate - c.baseRate) * 100)} pp | ${f1(c.survivedAfterHolders)} / ${f1(c.survivedAfterOthers)} |`);
    }
    const strong = [...b.cards].filter((c) => c.boards >= 8).sort((x, y) => (y.survivorRate - y.baseRate) - (x.survivorRate - x.baseRate)).slice(0, 6);
    const weak = [...b.cards].filter((c) => c.boards >= 8).sort((x, y) => (x.survivorRate - x.baseRate) - (y.survivorRate - y.baseRate)).slice(0, 6);
    out.push('');
    out.push(`Strongest survival lift (≥ 8 boards): ${strong.map((c) => `${c.name} ${signed((c.survivorRate - c.baseRate) * 100)} pp`).join('; ')}.`);
    out.push('');
    out.push(`Weakest (boards that die soon after): ${weak.map((c) => `${c.name} ${signed((c.survivorRate - c.baseRate) * 100)} pp`).join('; ')}.`);
    if (b.pairs.length) {
      out.push('');
      out.push('Most common card PAIRS on one board in this band (survivor rate vs what the two cards\' individual rates would predict):');
      out.push('');
      out.push('| pair | boards | survivor | expected |');
      out.push('|---|---|---|---|');
      for (const p of b.pairs.slice(0, topPairs)) out.push(`| ${cardName(p.a)} + ${cardName(p.b)} | ${p.boards} | ${pct(p.survivorRate)} | ${pct(p.expectedRate)} |`);
    }
  }
  out.push('');
  out.push('## Final boards: the end-game runs vs the runs eliminated by wave 10');
  out.push('');
  out.push('How many runs held the card on their LAST recorded board — among runs that reached wave 14+ ("end") and runs eliminated at wave ≤ 10 ("early").');
  out.push('');
  out.push('| card | end runs | early runs |');
  out.push('|---|---|---|');
  for (const c of s.endgameCards.slice(0, 30)) out.push(`| ${c.name} (\`${c.cardId}\`) | ${c.endRuns} | ${c.earlyRuns} |`);
  out.push('');
  out.push('## Hero → tribe → core cards');
  out.push('');
  out.push('Every (hero, dominant tribe on the final board) pair the corpus holds, with the cards most often on those final boards. Runs per hero are thin (70 runs over ~40 heroes), so read these as the LINES players took, not as hero strength.');
  out.push('');
  out.push('| hero | tribe | runs | reached end | last wave mean | core cards (share of runs) |');
  out.push('|---|---|---|---|---|---|');
  for (const l of s.lines) out.push(`| ${l.heroId} | ${l.tribe} | ${l.runs} | ${l.reachedEnd} | ${f1(l.lastWaveMean)} | ${l.cores.map((c) => `${c.name} ${pct(c.share)}`).join(', ')} |`);
  out.push('');
  return out.join('\n');
}

export type { Tribe };
