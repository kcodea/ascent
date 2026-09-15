/**
 * LEARNED VALUE — the DATASET BUILDER (`npm run balance:value:dataset -- --corpus set2-players-v1 --jobs a,b --out set2-v1`).
 *
 * Two sources, one row shape (`ValueRow` + provenance columns):
 *
 *  (a) THE RECORDED PLAYER CORPUS. Boards are regrouped into runs exactly as the lobby seats them
 *      (`playerRunsFrom`: author | hero | seed, ≥ 4 waves, one board per wave). A recording carries NO placement,
 *      so the label is SURVIVAL: waves the run lasted AFTER this board, normalised by the most it could have
 *      lasted (`(lastWave − w) / (maxWave − w)`, `maxWave` = the corpus' last recorded wave). `reachedTop` is the
 *      proxy for "a top finish" (`lastWave ≥ 14`). Caveat, printed in the report: a recording ends when its run
 *      ended — a lobby WINNER and the seat it beat on the same wave both stop there, so late survival is
 *      "reached the end-game", not "won".
 *
 *  (b) PINNED-LOBBY PILOT ROUNDS. For the PILOT seat of each lobby of each job (recorded seats are the corpus
 *      again and carry no snapshot), every round with a snapshot is a row: the same survival label (rounds the
 *      pilot lasted after this one, same normalisation), PLUS the pilot's final placement inverted to
 *      `(8 − placement) / 7` (1 = winner) and the fight result of THAT round (win 1 / tie ½ / loss 0) — these are
 *      kept as evaluation columns (the rank-correlation targets), not fitted.
 *
 * The originating run is the `group` of every row — the split key the roadmap requires ("split by originating
 * run … not individual boards from the same run"). Features come from `featuresOfSnapshot` — the SAME function
 * the evaluator's `featuresOf` calls — so nothing here can drift from inference.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCorpus, corpusDigest, type CorpusFile } from '../corpus';
import { loadJob, OUT_ROOT } from '../store';
import { playerRunsFrom, type BoardSnapshot } from '@game/sim';
import { featuresOfSnapshot, MECHANIC_BUCKETS, VALUE_FEATURE_NAMES, type ValueRow } from '@game/sim/balance/value/index';
import type { RoundRecord } from '../deps';
import { digest } from '@game/sim/balance/identity';

export type RowSource = 'corpus' | 'pinned';

export interface DatasetRow extends ValueRow {
  source: RowSource;
  heroId: string;
  /** `lastWave ≥ 14` for a corpus run; for a pilot, placement ≤ 2. */
  reachedTop: boolean;
  /** Raw waves survived after this board (before normalisation). */
  survivedAfter: number;
  /** Pinned rows only: `(8 − placement) / 7`. */
  placementScore?: number;
  /** Pinned rows only: this round's fight (win 1 / tie 0.5 / loss 0). */
  fightResult?: number;
}

export interface ValueDataset {
  schemaVersion: 1;
  name: string;
  setId: string;
  featureNames: string[];
  /** The bucket rules, verbatim, so the file explains its own columns. */
  buckets: { id: string; rule: string }[];
  /** The normaliser: the corpus' last recorded wave (a run at this wave has nothing left to survive). */
  maxWave: number;
  topWave: number;
  rows: DatasetRow[];
  provenance: {
    corpus: { name: string; digest: string; boards: number; runs: number; authors: number } | null;
    jobs: { jobId: string; lobbies: number; manifestDigest: string; policyId: string }[];
    /** Digest over the rows (order-independent) — stamped into the fitted model's provenance. */
    rowsDigest: string;
  };
}

export const REACHED_TOP_WAVE = 14;

export function datasetPath(name: string, root = OUT_ROOT): string {
  return join(root, 'value', `${name}.json`);
}

/** Corpus rows: one per (run, wave) with a board; label = normalised survival after the wave. */
export function corpusRows(corpus: CorpusFile, maxWave: number, topWave = REACHED_TOP_WAVE): DatasetRow[] {
  const runs = playerRunsFrom(corpus.boards, undefined, corpus.setId);
  const rows: DatasetRow[] = [];
  for (const run of runs) {
    const lastWave = run.snaps[run.snaps.length - 1]!.wave;
    for (const s of run.snaps) {
      const remaining = maxWave - s.wave;
      if (remaining <= 0) continue; // nothing left to survive — no label
      const survivedAfter = Math.max(0, lastWave - s.wave);
      rows.push({
        source: 'corpus', group: run.key, heroId: run.heroId, wave: s.wave,
        features: featuresOfSnapshot(s),
        survival: Math.min(1, survivedAfter / remaining), survivedAfter, reachedTop: lastWave >= topWave,
      });
    }
  }
  return rows;
}

const fightOf = (r: RoundRecord['result']): number | undefined => (r === 'win' ? 1 : r === 'tie' ? 0.5 : r === 'loss' ? 0 : undefined);

/** Pilot rows from one job: the pilot seat's rounds that carry a snapshot. */
export function pinnedRows(jobId: string, maxWave: number, root = OUT_ROOT): { rows: DatasetRow[]; lobbies: number; manifestDigest: string; policyId: string } {
  const job = loadJob(jobId, root);
  const rows: DatasetRow[] = [];
  for (const lobby of job.lobbies) {
    if (lobby.failure) continue;
    for (const seat of lobby.seats) {
      if (seat.policyId === 'recording' || seat.termination === 'failed') continue;
      const lastRound = seat.eliminatedRound ?? lobby.roundsPlayed;
      const placementScore = seat.placement ? (8 - seat.placement) / 7 : undefined;
      const rounds = lobby.rounds.filter((r) => r.seatId === seat.seatId && r.snapshot).sort((a, b) => a.round - b.round);
      for (const r of rounds) {
        const snap: BoardSnapshot = r.snapshot!;
        const remaining = maxWave - r.round;
        if (remaining <= 0) continue;
        const survivedAfter = Math.max(0, lastRound - r.round);
        rows.push({
          source: 'pinned', group: `${jobId}:${lobby.lobbyId}:${seat.seatId}`, heroId: seat.heroId, wave: r.round,
          features: featuresOfSnapshot(snap, r.round, { goldUnspent: r.goldUnspent, hand: r.hand.map((cardId) => ({ cardId })) }),
          survival: Math.min(1, survivedAfter / remaining), survivedAfter,
          reachedTop: (seat.placement ?? 9) <= 2,
          ...(placementScore !== undefined ? { placementScore } : {}),
          ...(fightOf(r.result) !== undefined ? { fightResult: fightOf(r.result)! } : {}),
        });
      }
    }
  }
  return { rows, lobbies: job.lobbies.length, manifestDigest: job.identity.manifestDigest, policyId: job.manifest.policy.id };
}

const rowKey = (r: DatasetRow): string => `${r.source}|${r.group}|${r.wave}|${r.survival.toFixed(6)}|${r.features.map((x) => (x === null ? 'null' : x.toFixed(6))).join(',')}`;

export function buildDataset(opts: { name: string; corpusName?: string; jobIds?: readonly string[]; root?: string; topWave?: number }): ValueDataset {
  const root = opts.root ?? OUT_ROOT;
  const corpus = opts.corpusName ? loadCorpus(opts.corpusName, root) : null;
  const topWave = opts.topWave ?? REACHED_TOP_WAVE;
  // The normaliser is the corpus' last recorded wave; a pilot that outlasted it is clamped to 1.
  let maxWave = corpus ? Math.max(0, ...corpus.boards.map((b) => b.wave)) : 0;
  const jobs: ValueDataset['provenance']['jobs'] = [];
  const pinned: DatasetRow[] = [];
  if (!maxWave) {
    for (const id of opts.jobIds ?? []) { const j = loadJob(id, root); for (const l of j.lobbies) maxWave = Math.max(maxWave, l.roundsPlayed); }
  }
  for (const id of opts.jobIds ?? []) {
    const p = pinnedRows(id, maxWave, root);
    pinned.push(...p.rows);
    jobs.push({ jobId: id, lobbies: p.lobbies, manifestDigest: p.manifestDigest, policyId: p.policyId });
  }
  const rows = [...(corpus ? corpusRows(corpus, maxWave, topWave) : []), ...pinned];
  const setId = corpus?.setId ?? (jobs.length ? loadJob(jobs[0]!.jobId, root).manifest.setId : 'set2');
  const runs = corpus ? playerRunsFrom(corpus.boards, undefined, corpus.setId) : [];
  return {
    schemaVersion: 1, name: opts.name, setId,
    featureNames: [...VALUE_FEATURE_NAMES],
    buckets: MECHANIC_BUCKETS.map((b) => ({ id: b.id, rule: b.rule })),
    maxWave, topWave, rows,
    provenance: {
      corpus: corpus ? { name: corpus.name, digest: corpusDigest(corpus.boards), boards: corpus.boards.length, runs: runs.length, authors: new Set(runs.map((r) => r.author)).size } : null,
      jobs,
      rowsDigest: digest(rows.map(rowKey).sort().join('\n')),
    },
  };
}

export function writeDataset(ds: ValueDataset, root = OUT_ROOT): string {
  const path = datasetPath(ds.name, root);
  mkdirSync(join(root, 'value'), { recursive: true });
  writeFileSync(path, JSON.stringify(ds), 'utf8');
  return path;
}

export function loadDataset(name: string, root = OUT_ROOT): ValueDataset {
  const path = datasetPath(name, root);
  if (!existsSync(path)) throw new Error(`balance:value — no dataset "${name}" at ${path}; build one with balance:value:dataset`);
  const ds = JSON.parse(readFileSync(path, 'utf8')) as ValueDataset;
  if (ds.schemaVersion !== 1) throw new Error(`balance:value — dataset "${name}" schemaVersion ${String(ds.schemaVersion)}; expected 1`);
  return ds;
}
export function describeDataset(ds: ValueDataset): string {
  const by = (s: RowSource) => ds.rows.filter((r) => r.source === s);
  const groups = (rows: DatasetRow[]) => new Set(rows.map((r) => r.group)).size;
  const c = by('corpus'); const p = by('pinned');
  const lines = [
    `dataset ${ds.name} (${ds.setId}) — ${ds.rows.length} rows, ${ds.featureNames.length} features, maxWave ${ds.maxWave}, reachedTop = lastWave ≥ ${ds.topWave}`,
    `  corpus: ${c.length} rows / ${groups(c)} runs${ds.provenance.corpus ? ` (${ds.provenance.corpus.name} @ ${ds.provenance.corpus.digest}: ${ds.provenance.corpus.boards} boards, ${ds.provenance.corpus.authors} authors)` : ''}`,
    `  pinned: ${p.length} rows / ${groups(p)} pilot runs from ${ds.provenance.jobs.map((j) => `${j.jobId} (${j.lobbies} lobbies, ${j.policyId})`).join(', ') || 'no jobs'}`,
    `  rows digest ${ds.provenance.rowsDigest}`,
  ];
  const waves = new Map<number, number>();
  for (const r of ds.rows) waves.set(r.wave, (waves.get(r.wave) ?? 0) + 1);
  lines.push(`  rows per wave: ${[...waves.entries()].sort((a, b) => a[0] - b[0]).map(([w, n]) => `${w}:${n}`).join(' ')}`);
  return lines.join('\n');
}
