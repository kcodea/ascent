/**
 * The v2 strength commands (strength v2 design 2026-11-16; docs/superpowers/specs/2026-11-16-strength-v2-design.md):
 * `ref --v2`, `measure --v2` and `validate`. Tooling only: the candidate reference lives in the gitignored tool
 * cache, the game reads none of this, and nothing here writes to the backend.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  createStrengthProbe, runLongEnough, STRENGTH_BANDS, RANK_MEDALS, bandVersionLabel, lastReferenceRound, loadStrengthReference, scoreBoard,
  type BoardSnapshot, type StrengthReference,
} from '@game/sim';
import { getAll, liveRunsOf, loadLivePool, type LiveRun } from './livePool';
import { SET, roundRobin, trimForReference } from './refBuild';
import { pickReferenceIndices, referenceBuckets, REF_PICK_V2 } from './refPick.lib';
import { driftOf, inBandV2, peakCapRows, rateRunsV2, rawRoundsOfRun, seatsOf, type RawRound, type RunV2 } from './measureV2.lib';
import { gapCalibration, rateFights, runRecords, type FightRow } from './validate.lib';
import { applyV2Sql, backfillRowsOfRun, backfillV2Sql, type BackfillRow } from './backfillV2.lib';

export const REF_V2_VERSION = 'set2-v2';
export const REF_V2_CANDIDATE = 'packages/tools/.cache/strengthReference.v2.candidate.json';
const SCORES_V2_CACHE = 'packages/tools/.cache/strength-scores-v2.json';
const PEAK_CAPS = [60, 70, 80, 90, 95] as const;

const ownerOf = (r: Pick<LiveRun, 'userId' | 'author'>): string | null =>
  (r.userId ? `id:${r.userId}` : r.author && r.author !== 'anon' ? `name:${r.author.toLowerCase()}` : null);
const lastRoundOf = (r: LiveRun): number => r.boards.reduce((m, b) => Math.max(m, b.wave), 0);
const minionsOf = (s: BoardSnapshot): number => s.minions?.length ?? 0;

/** The runs v2 counts: live, of the set, and long enough (round 7). */
async function v2Runs(): Promise<{ runs: LiveRun[]; tooShort: number }> {
  const live = liveRunsOf(await loadLivePool(), SET);
  const runs = live.filter((r) => runLongEnough(lastRoundOf(r)));
  return { runs, tooShort: live.length - runs.length };
}

export function loadCandidateReference(): StrengthReference {
  if (!existsSync(REF_V2_CANDIDATE)) throw new Error('no candidate v2 reference: run `npm run strength -- ref --v2` first');
  return JSON.parse(readFileSync(REF_V2_CANDIDATE, 'utf8')) as StrengthReference;
}

export async function buildReferenceV2(): Promise<void> {
  const { runs, tooShort } = await v2Runs();
  console.log(`live runs ${runs.length + tooShort}, dropped by the 7-round floor ${tooShort}`);
  // One real board with minions per run per round.
  const byRound = new Map<number, { snap: BoardSnapshot; owner: string | null; key: string }[]>();
  for (const r of runs) {
    const seen = new Set<number>();
    for (const b of r.boards) {
      if (seen.has(b.wave)) continue;
      seen.add(b.wave);
      if (minionsOf(b.snapshot) === 0) continue;
      const list = byRound.get(b.wave) ?? [];
      list.push({ snap: b.snapshot, owner: ownerOf(r), key: `${r.key}|${b.wave}` });
      byRound.set(b.wave, list);
    }
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);
  const starts = referenceBuckets(new Map(rounds.map((w) => [w, byRound.get(w)!.length])));
  const out: StrengthReference = { version: REF_V2_VERSION, setId: SET, fightsPerRef: 4, waves: {} };
  for (const [i, start] of starts.entries()) {
    const end = starts[i + 1] ?? Infinity;
    const t0 = performance.now();
    // Deterministic order before the round robin (the pool's order is an accident of the fetch).
    const list = rounds.filter((w) => w >= start && w < end).flatMap((w) => byRound.get(w)!).sort((a, b) => a.key.localeCompare(b.key));
    const rr = roundRobin(list.map((x) => x.snap), start);
    const order = list.map((x, k) => ({ ...x, s: rr[k]! })).sort((x, y) => x.s - y.s || x.key.localeCompare(y.key));
    const picks = pickReferenceIndices(order.map((x) => x.owner), REF_PICK_V2);
    out.waves[String(start)] = picks.map((k) => trimForReference(order[k]!.snap));
    const per = new Map<string, number>();
    for (const k of picks) per.set(order[k]!.owner ?? '(none)', (per.get(order[k]!.owner ?? '(none)') ?? 0) + 1);
    console.log(`wave ${start}: ${list.length} boards, round robin ${Math.round(performance.now() - t0)} ms, ${picks.length} refs, most from one player ${Math.max(...per.values())}`);
  }
  mkdirSync(dirname(REF_V2_CANDIDATE), { recursive: true });
  const text = JSON.stringify(out);
  writeFileSync(REF_V2_CANDIDATE, text);
  console.log(`wrote ${REF_V2_CANDIDATE} (${Math.round(text.length / 1024)} KB). NOT committed, NOT read by the game.`);
}

/** Score every fielded round of the v2 runs against the candidate reference (cached per reference file). */
async function rateLive(): Promise<{ rated: RunV2[]; raws: RawRound[]; tooShort: number; ref: StrengthReference; bucketOf: (round: number) => number; lastRef: number }> {
  const { runs, tooShort } = await v2Runs();
  const refText = existsSync(REF_V2_CANDIDATE) ? readFileSync(REF_V2_CANDIDATE, 'utf8') : '';
  const ref = loadCandidateReference();
  const stamp = createHash('sha1').update(refText).digest('hex');
  const refRounds = Object.keys(ref.waves).map(Number).sort((a, b) => a - b);
  const lastRef = refRounds[refRounds.length - 1]!;
  /** The reference round a round is scored against (its own, else the nearest below; the last covers the rest). */
  const bucketOf = (round: number): number => refRounds.filter((w) => w <= round).pop() ?? refRounds[0]!;
  let cache: { stamp: string; scores: Record<string, number> } = { stamp, scores: {} };
  if (existsSync(SCORES_V2_CACHE)) {
    const c = JSON.parse(readFileSync(SCORES_V2_CACHE, 'utf8')) as typeof cache;
    if (c.stamp === stamp) cache = c;
  }
  let fights = 0;
  let unscorable = 0;
  const t0 = performance.now();
  const raws: RawRound[] = [];
  for (const run of runs) {
    const first = new Map<number, BoardSnapshot>();
    for (const b of run.boards) if (!first.has(b.wave)) first.set(b.wave, b.snapshot);
    raws.push(...rawRoundsOfRun({ key: run.key, boards: [...first].map(([wave, s]) => ({ wave, minions: minionsOf(s) })) }, lastRef, (boardWave, atRound) => {
      const k = `${run.key}|${boardWave}|${atRound}`;
      const hit = cache.scores[k];
      if (typeof hit === 'number') return hit;
      const probe = createStrengthProbe({ ...first.get(boardWave)!, wave: boardWave }, ref, atRound);
      probe.step(probe.total());
      const res = probe.result();
      if (!res) unscorable++;
      fights += probe.total();
      return (cache.scores[k] = res ? res.raw : 0);
    }));
  }
  if (fights > 0) {
    mkdirSync(dirname(SCORES_V2_CACHE), { recursive: true });
    writeFileSync(SCORES_V2_CACHE, JSON.stringify(cache));
    console.log(`scored ${fights} fights in ${Math.round((performance.now() - t0) / 1000)} s (${((performance.now() - t0) / fights).toFixed(3)} ms per fight)`);
  }
  if (unscorable) console.log(`WARNING: ${unscorable} boards could not be scored and count as raw 0`);
  const owners = new Map(runs.map((r) => [r.key, ownerOf(r)] as const));
  return { rated: rateRunsV2(raws, owners, bucketOf), raws, tooShort, ref, bucketOf, lastRef };
}

const q = (xs: readonly number[], p: number): number => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))] ?? 0; };
function corr(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; syy += (ys[i]! - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

export async function measureV2(): Promise<void> {
  const { rated, raws, tooShort, ref, bucketOf } = await rateLive();
  console.log(`\nSTRENGTH V2 MEASURE (candidate reference ${ref.version}, ${ref.fightsPerRef} fights per reference board)`);
  console.log(`runs measured ${rated.length}; live runs dropped by the 7-round floor ${tooShort}`);

  console.log('\nDRIFT (real boards against the reference; RE-BASELINE when the median is over 0.60 or the 90th percentile over 0.92)');
  const realByBucket = new Map<number, number[]>();
  for (const r of raws) {
    if (r.carried) continue;
    const list = realByBucket.get(bucketOf(r.round)) ?? [];
    list.push(r.raw);
    realByBucket.set(bucketOf(r.round), list);
  }
  for (const w of [...realByBucket.keys()].sort((a, b) => a - b)) {
    const xs = realByBucket.get(w)!;
    const d = driftOf(xs);
    console.log(`  round ${w}: ${xs.length} boards, median ${d.median.toFixed(3)}, p90 ${d.p90.toFixed(3)}, distinct ${new Set(xs).size}${d.rebaseline ? '  RE-BASELINE' : ''}`);
  }

  const both = rated.filter((r) => r.early !== null && r.late !== null);
  console.log(`\nEARLY vs LATE correlation over ${both.length} runs: ${corr(both.map((r) => r.early!), both.map((r) => r.late!)).toFixed(2)} (every run has a LATE rating: ${rated.every((r) => r.late !== null)})`);

  console.log('\nBANDS (today\'s band table on the v2 ratings): runs in band / players / seats at up to 3 per player');
  for (const medal of RANK_MEDALS) {
    const band = STRENGTH_BANDS[medal];
    const inBand = rated.filter((r) => inBandV2(r, band));
    console.log(`  ${medal.padEnd(9)} ${bandVersionLabel(band).padEnd(14)}: ${inBand.length} runs, ${new Set(inBand.map((r) => r.owner)).size} players, ${seatsOf(inBand)} seats`);
  }

  console.log('\nPEAK CAPS (a run is removed when its best real board from round 4 on is over the cap): runs left / removed / seats left');
  for (const medal of RANK_MEDALS) {
    const rows = peakCapRows(rated, STRENGTH_BANDS[medal], PEAK_CAPS);
    console.log(`  ${medal.padEnd(9)} ${rows.map((r) => `cap ${r.cap}: ${r.runs} left, ${r.removed} removed, ${r.seats} seats`).join(' | ')}`);
  }

  console.log('\nWHAT A PLAYER CAN FACE (the board each in-band run fields that round, carried final boards included: median / 90th percentile / strongest)');
  for (const medal of RANK_MEDALS) {
    const inBand = rated.filter((r) => inBandV2(r, STRENGTH_BANDS[medal]));
    const cells: string[] = [];
    for (let round = 1; round <= 15; round++) {
      const xs = inBand.flatMap((r) => r.rounds.filter((x) => x.round === round).map((x) => x.value));
      if (xs.length) cells.push(`r${round} ${q(xs, 0.5)}/${q(xs, 0.9)}/${Math.max(...xs)}`);
    }
    console.log(`  ${medal.padEnd(9)} ${cells.join('  ')}`);
  }
}

export const BACKFILL_V2_OUT = 'packages/tools/.cache/strength-backfill-v2.sql';
export const APPLY_V2_OUT = 'packages/tools/.cache/strength-v2-apply.sql';
const MIGRATION_V2 = 'supabase/migrations/2026-11-23-strength-v2.sql';

/** Score EVERY pool board of the set (live or not) against the COMMITTED reference, plus each run's carried rounds,
 *  and write the SQL file an owner runs. Never writes to the backend. */
export async function backfillV2(): Promise<void> {
  const pool = await loadLivePool();
  const ref = await loadStrengthReference();
  const lastRef = lastReferenceRound(ref);
  const rows: BackfillRow[] = [];
  let fights = 0;
  const t0 = performance.now();
  const runs = pool.runs.filter((r) => r.setId === SET);
  for (const run of runs) {
    const first = new Map<number, BoardSnapshot>();
    for (const b of run.boards) if (!first.has(b.wave)) first.set(b.wave, b.snapshot);
    rows.push(...backfillRowsOfRun(run.boards.map((b) => ({ rowId: b.rowId, wave: b.wave, minions: minionsOf(b.snapshot) })), lastRef, ref.version, (boardWave, atRound) => {
      const s = scoreBoard({ ...first.get(boardWave)!, wave: boardWave, setId: SET }, ref, atRound);
      if (s) fights += s.fights;
      return s ? { raw: s.raw, refWave: s.wave } : null;
    }));
  }
  mkdirSync(dirname(BACKFILL_V2_OUT), { recursive: true });
  writeFileSync(BACKFILL_V2_OUT, backfillV2Sql(ref.version, rows));
  console.log(`scored ${runs.length} runs, ${rows.length} boards, ${fights} fights in ${Math.round((performance.now() - t0) / 1000)} s`);
  writeFileSync(APPLY_V2_OUT, applyV2Sql(readFileSync(MIGRATION_V2, 'utf8'), ref.version, rows));
  console.log(`wrote ${APPLY_V2_OUT}: the strength v2 migration with this backfill inside its transaction. FIRST APPLY: an OWNER runs this one file, then Ship Ascent.`);
  console.log(`wrote ${BACKFILL_V2_OUT}: the backfill alone, for a later top-up (then select public.pool_refresh_dirty();).`);
}

export async function validate(): Promise<void> {
  const { rated, lastRef } = await rateLive();
  const at = new Map<string, number>();
  for (const r of rated) for (const x of r.rounds) at.set(`${r.key}|${x.round}`, x.value);
  const fights = await getAll<FightRow>('lobby_fights?select=round,run_a,run_b,outcome&order=id.asc');
  const measured = new Set(rated.map((r) => r.key));
  // Past the last reference round a run whose recording has ended still fields its final board: the value it
  // carries at the last reference round stands for every later round.
  const res = rateFights(fights, (key, round) => at.get(`${key}|${round}`) ?? (round > lastRef ? at.get(`${key}|${lastRef}`) ?? null : null), (key) => measured.has(key));
  console.log(`\nSTRENGTH V2 VALIDATE: fights read ${fights.length}, rated ${res.rated.length}, skipped: generated seat ${res.skipped.generated}, a run outside the live window ${res.skipped.runNotMeasured}, a round with no percentile ${res.skipped.roundNotMeasured}`);

  console.log('\nHOW OFTEN THE STRONGER BOARD REALLY WON, by percentile gap');
  for (const row of gapCalibration(res.rated)) console.log(`  gap ${row.bucket.padEnd(6)}: ${String(row.fights).padStart(5)} fights, stronger board won ${(100 * row.strongerWinRate).toFixed(1)}%`);

  const rec = runRecords(res.rated);
  const MIN = 20;
  const byKey = new Map(rated.map((r) => [r.key, r] as const));
  const rows = [...rec].flatMap(([key, v]) => {
    const r = byKey.get(key);
    if (!r) return [];
    return [
      ...(v.early.fights >= MIN && r.early !== null ? [{ key, half: 'early', rating: r.early, rate: v.early.points / v.early.fights, fights: v.early.fights }] : []),
      ...(v.late.fights >= MIN && r.late !== null ? [{ key, half: 'late', rating: r.late, rate: v.late.points / v.late.fights, fights: v.late.fights }] : []),
    ];
  });
  for (const half of ['early', 'late']) {
    const xs = rows.filter((r) => r.half === half);
    console.log(`\n${half.toUpperCase()} rating vs real ${half} win rate over ${xs.length} runs with at least ${MIN} fights: correlation ${xs.length < 3 ? 'n/a (too few runs)' : corr(xs.map((r) => r.rating), xs.map((r) => r.rate)).toFixed(2)}`);
  }
  console.log('\nRUNS WHOSE RESULTS DISAGREE MOST WITH THEIR RATING (rating / real win rate / fights)');
  for (const r of [...rows].sort((a, b) => Math.abs(b.rating / 100 - b.rate) - Math.abs(a.rating / 100 - a.rate)).slice(0, 20)) {
    console.log(`  ${r.key} ${r.half}: rating ${r.rating}, won ${(100 * r.rate).toFixed(0)}% of ${r.fights}`);
  }
}
