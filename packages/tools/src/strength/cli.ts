/**
 * `npm run strength -- <fetch|ref|backfill|measure>` — the board-strength tools (2026-09-30, R-LOBBY-09).
 *
 *  fetch     pull the live pool (anon REST GETs only) into packages/tools/.cache/strength-pool.json
 *  ref       build the FROZEN reference set (packages/sim/src/lobby/strengthReference.v1.json) from that pool.
 *            Run once per reference version; re-running it with a different pool changes every score.
 *  backfill  score every pool board against the committed reference and write a SQL file of UPDATEs
 *            (supabase/backfill/2026-09-30-board-strength-backfill.sql) for the OWNER to run. Never writes to the DB.
 *  measure   the distribution of scores, runs per rank band today, and how often each band would need widening.
 *            A run's strength is its round-weighted average ranked among runs (R-LOBBY-12, restored 2026-10-06); the
 *            measure prints the retired final-board percentile (`runFinalStrengthOf`, 2026-10-03 to 2026-10-06)
 *            beside it for comparison. Since the split bands (R-LOBBY-13, 2026-10-06) it also prints each run's EARLY
 *            (rounds 1-9) and LATE (10+) ratings, and per medal the runs, players and seats under the 4-per-player cap
 *            each split band holds (old weighted bands beside them), and the mean early rating of the runs a band
 *            seats.
 *
 * Nothing here writes to the backend.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { makeRng, simulate } from '@game/core';
import { CARD_INDEX, poolFor, type SetId } from '@game/content';
import {
  opponentBoard, sideFromSnapshot, STRENGTH_REF_VERSION, loadStrengthReference, createStrengthProbe, percentileOf,
  OPPONENT_POOL, registerOpponentRuns, createRunLobby, resetLobbyDrivers, playableHeroes, strengthBandForDivision,
  runAverageOf, runWeightedAverageOf, runPercentileOf, runFinalStrengthOf, type RunStrengthHistogramEntry, type BoardSnapshot, type StrengthReference, type StrengthHistogramEntry, STRENGTH_BANDS,
  bandSteps, inStrengthBand, type StrengthBand, MAX_SEATS_PER_PLAYER, RANK_MEDALS, type RankMedal,
  earlyLateStrengthOf, rankAmongRuns, runInStrengthBand, matchScoreOf, bandVersionLabel, type RunStrengths,
} from '@game/sim';
import { loadLivePool, type LivePool, type LiveRun } from './livePool';

const REF_OUT = 'packages/sim/src/lobby/strengthReference.v1.json';
const BACKFILL_OUT = 'supabase/backfill/2026-09-30-board-strength-backfill.sql';
const SCORES_CACHE = 'packages/tools/.cache/strength-scores.json';
/** Boards per reference wave (owner: "~30 real boards per wave ... spanning weak to strong"). */
const REFS_PER_WAVE = 30;
/** A wave with fewer eligible boards than this is merged, with every later wave, into one last reference wave. */
const MIN_REF_WAVE_BOARDS = 20;
const SET: SetId = 'set2';

/** Combat-only fields: the reference file ships in the web build (lazily), so display fields are dropped. */
const DISPLAY_ONLY = ['id', 'author', 'ownerId', 'remote', 'cosmetics', 'capturedAt', 'patch', 'quests', 'runes', 'rating', 'result', 'origin', 'wins', 'armor', 'runStrength'] as const;
function trimForReference(s: BoardSnapshot): BoardSnapshot {
  const out = { ...s, resolve: 0, triples: 0, power: 0 } as BoardSnapshot & Record<string, unknown>;
  for (const k of DISPLAY_ONLY) delete out[k];
  return out;
}

function eligibleRuns(pool: LivePool): LiveRun[] {
  return pool.runs.filter((r) => r.eligible && r.setId === SET);
}

/** One board per run per wave (the first), grouped by wave. */
function boardsByWave(runs: readonly LiveRun[]): Map<number, BoardSnapshot[]> {
  const out = new Map<number, BoardSnapshot[]>();
  for (const r of runs) {
    const seen = new Set<number>();
    for (const b of r.boards) {
      if (seen.has(b.wave)) continue;
      seen.add(b.wave);
      const list = out.get(b.wave) ?? [];
      list.push(b.snapshot);
      out.set(b.wave, list);
    }
  }
  return out;
}

/** Round robin inside one wave: every pair fights once (sides alternate by pair), seeded. Returns win rates. */
function roundRobin(boards: readonly BoardSnapshot[], wave: number): number[] {
  const poolIds = poolFor(SET).all.map((c) => c.id);
  const sides = boards.map((b) => sideFromSnapshot(b, b.tier, poolIds));
  const pts = boards.map(() => 0);
  const games = boards.map(() => 0);
  for (let i = 0; i < boards.length; i++) {
    for (let j = i + 1; j < boards.length; j++) {
      const flip = (i + j) % 2 === 1;
      const [a, b] = flip ? [j, i] : [i, j];
      const r = simulate(opponentBoard(boards[a]!), opponentBoard(boards[b]!), makeRng((wave * 7919) ^ (a * 104729) ^ (b * 1299709)), CARD_INDEX, sides[a]!, sides[b]!);
      const pa = r.result === 'win' ? 1 : r.result === 'draw' ? 0.5 : 0;
      pts[a]! += pa; pts[b]! += 1 - pa; games[a]!++; games[b]!++;
    }
  }
  return pts.map((p, i) => (games[i]! ? p / games[i]! : 0.5));
}

async function buildReference(): Promise<void> {
  const pool = await loadLivePool();
  const byWave = boardsByWave(eligibleRuns(pool));
  const waves = [...byWave.keys()].sort((a, b) => a - b);
  // The last reference wave absorbs every thin wave after it.
  const buckets = new Map<number, BoardSnapshot[]>();
  let last: number | null = null;
  for (const w of waves) {
    const list = byWave.get(w)!;
    if (last !== null && (list.length < MIN_REF_WAVE_BOARDS || buckets.get(last)!.length < MIN_REF_WAVE_BOARDS)) {
      buckets.get(last)!.push(...list);
      continue;
    }
    buckets.set(w, [...list]);
    last = w;
  }
  const out: StrengthReference = { version: STRENGTH_REF_VERSION, setId: SET, fightsPerRef: 2, waves: {} };
  for (const [w, list] of buckets) {
    const t0 = performance.now();
    // Deterministic order before the round robin (the pool's order is an accident of the fetch).
    const sorted = [...list].sort((a, b) => `${a.author}|${a.heroId}|${a.seed}|${a.wave}`.localeCompare(`${b.author}|${b.heroId}|${b.seed}|${b.wave}`));
    const rr = roundRobin(sorted, w);
    const order = sorted.map((b, i) => ({ b, s: rr[i]! })).sort((x, y) => x.s - y.s);
    // Evenly spaced by rank, weakest to strongest: the reference spans the whole wave.
    const k = Math.min(REFS_PER_WAVE, order.length);
    const picks = new Set<number>();
    for (let i = 0; i < k; i++) picks.add(Math.round((i * (order.length - 1)) / Math.max(1, k - 1)));
    out.waves[String(w)] = [...picks].sort((a, b) => a - b).map((i) => trimForReference(order[i]!.b));
    console.log(`wave ${w}: ${list.length} boards, round robin ${Math.round(performance.now() - t0)} ms, ${out.waves[String(w)]!.length} refs`);
  }
  writeFileSync(REF_OUT, JSON.stringify(out));
  console.log(`wrote ${REF_OUT} (${Math.round(JSON.stringify(out).length / 1024)} KB)`);
}

interface ScoredBoard { rowId: string; runKey: string; wave: number; raw: number; refWave: number }

async function scoreAll(): Promise<{ pool: LivePool; scored: ScoredBoard[]; ref: StrengthReference }> {
  const pool = await loadLivePool();
  const ref = await loadStrengthReference();
  if (!Object.keys(ref.waves).length) throw new Error('the reference set is empty: run `npm run strength -- ref` first');
  const scored: ScoredBoard[] = [];
  let fights = 0;
  // Timed the way the client runs it: in steps of STEP fights (one idle slice with no idle time to spare).
  const STEP = 4;
  const stepMs: number[] = [];
  const boardMs: number[] = [];
  const t0 = performance.now();
  for (const run of pool.runs) {
    for (const b of run.boards) {
      const tb = performance.now();
      const probe = createStrengthProbe({ ...b.snapshot, wave: b.wave }, ref);
      for (;;) { const ts = performance.now(); const done = probe.step(STEP); stepMs.push(performance.now() - ts); if (done) break; }
      const s = probe.result();
      if (!s) continue;
      boardMs.push(performance.now() - tb);
      fights += s.fights;
      scored.push({ rowId: b.rowId, runKey: run.key, wave: b.wave, raw: s.raw, refWave: s.wave });
    }
  }
  const ms = performance.now() - t0;
  const pctl = (xs: number[], p: number): string => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]!.toFixed(1); };
  console.log(`scored ${scored.length} boards, ${fights} fights in ${Math.round(ms)} ms (${(ms / Math.max(1, fights)).toFixed(3)} ms per fight)`);
  console.log(`per board: median ${pctl(boardMs, 0.5)} ms, p95 ${pctl(boardMs, 0.95)} ms, max ${pctl(boardMs, 1)} ms; per ${STEP}-fight step: median ${pctl(stepMs, 0.5)} ms, p99 ${pctl(stepMs, 0.99)} ms, max ${pctl(stepMs, 1)} ms`);
  mkdirSync(dirname(SCORES_CACHE), { recursive: true });
  writeFileSync(SCORES_CACHE, JSON.stringify(scored));
  return { pool, scored, ref };
}

async function backfill(): Promise<void> {
  const { scored, ref } = await scoreAll();
  const lines = [
    '-- BOARD STRENGTH BACKFILL (2026-09-30, R-LOBBY-09). Generated by `npm run strength -- backfill`; do not edit.',
    `-- Reference ${ref.version}. Run AFTER supabase/migrations/2026-09-30-board-strength.sql. Idempotent: it only`,
    '-- fills boards that have no score yet, then refreshes every run\'s percentile once.',
    'begin;',
    '-- Each value is (boards.id, raw win rate, reference wave).',
    'update public.boards b set strength_raw = v.raw, strength_ref = ' + `'${ref.version}'` + ', strength_wave = v.wave',
    'from (values',
    scored.map((s, i) => `  ('${s.rowId}'::uuid, ${s.raw}, ${s.refWave})${i === scored.length - 1 ? '' : ','}`).join('\n'),
    ') as v(id, raw, wave)',
    'where b.id = v.id and b.strength_raw is null;',
    'select public.pool_strength_refresh();',
    'commit;',
    '',
  ];
  mkdirSync(dirname(BACKFILL_OUT), { recursive: true });
  writeFileSync(BACKFILL_OUT, lines.join('\n'));
  console.log(`wrote ${BACKFILL_OUT} (${scored.length} boards)`);
}

async function measure(): Promise<void> {
  const { pool, scored } = await scoreAll();
  // Per-wave histograms, then each board's percentile (itself included, as the server does).
  const hist = new Map<number, Map<number, number>>();
  for (const s of scored) {
    const h = hist.get(s.refWave) ?? new Map<number, number>();
    h.set(s.raw, (h.get(s.raw) ?? 0) + 1);
    hist.set(s.refWave, h);
  }
  const entries = (w: number): StrengthHistogramEntry[] => [...(hist.get(w) ?? new Map()).entries()].map(([raw, count]) => ({ raw, count }));
  const pctByRun = new Map<string, { round: number; value: number }[]>();
  for (const s of scored) {
    const others = entries(s.refWave).map((e) => (e.raw === s.raw ? { ...e, count: e.count - 1 } : e));
    const p = percentileOf(s.raw, others, true);
    if (p === null) continue;
    const list = pctByRun.get(s.runKey) ?? [];
    list.push({ round: s.wave, value: p });
    pctByRun.set(s.runKey, list);
  }
  const runs = eligibleRuns(pool);
  // A run's AVERAGE of board percentiles (round-weighted since 2026-09-30), then its strength = that average ranked
  // among every scored run of the set (the SQL's population: every pool_runs row with an average), itself counted once.
  const strengthBy = (avgOf: (rounds: { round: number; value: number }[]) => number | null): { averages: Map<string, number | null>; strength: Map<string, number | null> } => {
    const averages = new Map(pool.runs.filter((r) => r.setId === SET).map((r) => [r.key, avgOf(pctByRun.get(r.key) ?? [])]));
    const avgHist = new Map<number, number>();
    for (const a of averages.values()) if (a !== null) avgHist.set(a, (avgHist.get(a) ?? 0) + 1);
    const runHist = (skip: number): RunStrengthHistogramEntry[] => [...avgHist.entries()].map(([avg, count]) => ({ avg, count: avg === skip ? count - 1 : count }));
    const strength = new Map(runs.map((r) => {
      const a = averages.get(r.key) ?? null;
      return [r.key, a === null ? null : runPercentileOf(a, runHist(a), true)] as const;
    }));
    return { averages, strength };
  };
  const plain = strengthBy((rs) => runAverageOf(rs.map((r) => r.value)));
  // THE RUN'S STRENGTH (R-LOBBY-12, restored 2026-10-06, owner: "matchmaking algorithm -> backtrack to the weighted
  // version"): the round-weighted average ranked among runs. `final` is the retired 2026-10-03 to 2026-10-06 rule (the
  // final board's percentile, used directly), printed beside it for comparison.
  const { averages, strength: weighted } = strengthBy((rs) => runWeightedAverageOf(rs));
  const strength = weighted;
  const final = new Map(runs.map((r) => [r.key, runFinalStrengthOf(pctByRun.get(r.key) ?? [])] as const));
  const WATCH = [/^Rooks\|albus\|1018031655$/, /^Orangez\|/];
  console.log('\nweighted average ranked among runs (current) vs final board (retired 2026-10-06):');
  for (const r of runs.filter((x) => WATCH.some((re) => re.test(x.key)))) {
    const rs = pctByRun.get(r.key) ?? [];
    const last = rs.length ? Math.max(...rs.map((x) => x.round)) : null;
    console.log(`  ${r.key}: weighted ${weighted.get(r.key)}, final board ${final.get(r.key)} (last round ${last})`);
  }
  const bandCount = (m: Map<string, number | null>, lo: number, hi: number): number => [...m.values()].filter((v) => typeof v === 'number' && v >= lo && v <= hi).length;
  for (const medal of RANK_MEDALS) {
    const b = WEIGHTED_BANDS[medal];
    const [lo, hi] = b ? [b.min, b.max] : [0, 100];
    console.log(`  ${medal} ${fmtBand(b)} (weighted-era bands): weighted ${bandCount(weighted, lo, hi)} runs, final board ${bandCount(final, lo, hi)} runs`);
  }
  // Before / after the round weighting: the runs whose strength moves most, with their per-group means.
  const groupMeans = (key: string): string => {
    const rs = pctByRun.get(key) ?? [];
    const g = (lo: number, hi: number): string => { const xs = rs.filter((r) => r.round >= lo && r.round <= hi).map((r) => r.value); return xs.length ? `${Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)} (${xs.length})` : '-'; };
    return `r1-5 ${g(-Infinity, 5)}, r6-9 ${g(6, 9)}, r10+ ${g(10, Infinity)}`;
  };
  const moved = runs.map((r) => ({ key: r.key, before: plain.strength.get(r.key), after: weighted.get(r.key), avgBefore: plain.averages.get(r.key), avgAfter: averages.get(r.key) }))
    .filter((m): m is { key: string; before: number; after: number; avgBefore: number; avgAfter: number } => typeof m.before === 'number' && typeof m.after === 'number')
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
  const plainValues = [...plain.strength.values()].filter((x): x is number => x !== null);
  console.log(`
round weighting: mean |change| ${(moved.reduce((a, m) => a + Math.abs(m.after - m.before), 0) / Math.max(1, moved.length)).toFixed(1)}, runs moving >= 10: ${moved.filter((m) => Math.abs(m.after - m.before) >= 10).length} of ${moved.length}`);
  for (const m of moved.slice(0, 8)) console.log(`  ${m.key}: strength ${m.before} -> ${m.after} (average ${m.avgBefore} -> ${m.avgAfter}); ${groupMeans(m.key)}`);
  const bandShare = (vals: number[], lo: number, hi: number): string => `${vals.filter((v) => v >= lo && v <= hi).length}`;
  for (const [name, lo, hi] of [['Bronze', 0, 30], ['Silver', 10, 40], ['Gold', 20, 65], ['Diamond', 10, 100], ['Ascendant', 20, 100]] as const) {
    console.log(`  ${name} ${lo}-${hi}: plain ${bandShare(plainValues, lo, hi)} runs, weighted ${bandShare([...weighted.values()].filter((x): x is number => x !== null), lo, hi)} runs`);
  }
  const avgValues = runs.map((r) => averages.get(r.key)).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  const values = [...strength.values()].filter((x): x is number => x !== null).sort((a, b) => a - b);
  const q = (p: number, xs = values): number => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
  console.log(`\neligible runs ${runs.length}, scored ${values.length}`);
  console.log(`run AVERAGE of board percentiles: min ${avgValues[0]} p10 ${q(0.1, avgValues)} median ${q(0.5, avgValues)} p90 ${q(0.9, avgValues)} max ${avgValues[avgValues.length - 1]}`);
  console.log(`run strength (weighted average ranked among runs): min ${values[0]} p10 ${q(0.1)} p25 ${q(0.25)} median ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)} max ${values[values.length - 1]}`);
  const deciles = Array.from({ length: 10 }, (_, i) => values.filter((v) => v > i * 10 && v <= (i + 1) * 10).length);
  console.log('runs per decile (1-10, 11-20, ... 91-100):', deciles.join(' '));
  // Raw win rate by wave (the per-board spread the percentile sits on).
  for (const w of [...hist.keys()].sort((a, b) => a - b)) {
    const raws = scored.filter((s) => s.refWave === w).map((s) => s.raw).sort((a, b) => a - b);
    console.log(`  ref wave ${w}: ${raws.length} boards, raw p10 ${raws[Math.floor(raws.length * 0.1)]} median ${raws[Math.floor(raws.length / 2)]} p90 ${raws[Math.floor(raws.length * 0.9)]}, distinct values ${new Set(raws).size}`);
  }
  // EARLY / LATE (R-LOBBY-13): each run's rounds 1-9 and 10+ means, ranked among the set's runs (the SQL population:
  // every pool_runs row of the set with that average).
  const elAvg = new Map(pool.runs.filter((r) => r.setId === SET).map((r) => [r.key, earlyLateStrengthOf(pctByRun.get(r.key) ?? [])] as const));
  const earlyRank = rankAmongRuns([...elAvg].map(([k, v]) => [k, v.early] as const));
  const lateRank = rankAmongRuns([...elAvg].map(([k, v]) => [k, v.late] as const));
  const ratingsOf = (key: string): RunStrengths => ({ strength: strength.get(key) ?? null, early: earlyRank.get(key) ?? null, late: lateRank.get(key) ?? null });
  const earlyValues = runs.map((r) => earlyRank.get(r.key)).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  const lateValues = runs.map((r) => lateRank.get(r.key)).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  console.log(`\nEARLY rating (rounds 1-9 mean, ranked): ${earlyValues.length} runs, median ${q(0.5, earlyValues)}; LATE rating (rounds 10+): ${lateValues.length} runs (${runs.length - lateValues.length} ended before round 10), median ${q(0.5, lateValues)}`);
  const corr = (xs: number[], ys: number[]): number => {
    const n = xs.length; const mx = xs.reduce((a, b) => a + b, 0) / n; const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0; let sxx = 0; let syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; syy += (ys[i]! - my) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  };
  const both = runs.filter((r) => typeof earlyRank.get(r.key) === 'number' && typeof lateRank.get(r.key) === 'number');
  if (both.length > 2) console.log(`correlation EARLY vs LATE over ${both.length} runs: ${corr(both.map((r) => earlyRank.get(r.key)!), both.map((r) => lateRank.get(r.key)!)).toFixed(2)}`);

  // Bands: runs in band per medal, seats fillable under the 4-per-player cap, and the widening a lobby needs. The
  // split bands (current) first, the weighted-era bands beside them.
  const owners = new Map(runs.map((r) => [r.key, r.userId ? `id:${r.userId}` : `name:${r.author.toLowerCase()}`]));
  const authorOf = new Map(runs.map((r) => [r.key, r.author]));
  const meanOf = (xs: number[]): string => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : '-');
  console.log('\nSPLIT BANDS (R-LOBBY-13) vs the weighted-era bands: runs in band / players / seats fillable under the cap; mean EARLY rating of the in-band runs');
  for (const medal of RANK_MEDALS) {
    const fill = (inBand: typeof runs): { players: number; seats: number } => {
      const per = new Map<string, number>();
      for (const r of inBand) per.set(owners.get(r.key)!, (per.get(owners.get(r.key)!) ?? 0) + 1);
      return { players: per.size, seats: [...per.values()].reduce((a, n) => a + Math.min(MAX_SEATS_PER_PLAYER, n), 0) };
    };
    const cur = STRENGTH_BANDS[medal];
    const old = WEIGHTED_BANDS[medal];
    const inCur = runs.filter((r) => runInStrengthBand(ratingsOf(r.key), cur));
    const inOld = runs.filter((r) => inStrengthBand(strength.get(r.key), old));
    const fc = fill(inCur); const fo = fill(inOld);
    const early = (rs: typeof runs): string => meanOf(rs.map((r) => earlyRank.get(r.key)).filter((x): x is number => typeof x === 'number'));
    const late = (rs: typeof runs): string => meanOf(rs.map((r) => lateRank.get(r.key)).filter((x): x is number => typeof x === 'number'));
    const steps = bandSteps(cur);
    let widen = 0;
    for (const [si, b] of steps.entries()) { widen = si; if (fill(runs.filter((r) => runInStrengthBand(ratingsOf(r.key), b))).seats >= 7) break; }
    console.log(`  ${medal.padEnd(9)} split ${bandVersionLabel(cur).padEnd(10)}: ${inCur.length} runs, ${fc.players} players, ${fc.seats} seats, mean early ${early(inCur)} late ${late(inCur)}, widenings to seat 7: ${widen}`
      + `   | weighted ${fmtBand(old).padEnd(8)}: ${inOld.length} runs, ${fo.seats} seats, mean early ${early(inOld)} late ${late(inOld)}`);
  }
  // OVERALL CAPS (R-LOBBY-15, owner 2026-10-09): per medal, the split band without its cap vs with it (the current
  // table), the seats each fills under the per-player cap, the widening steps to seat 7, and which overall strengths
  // the cap removes.
  console.log('\nOVERALL CAPS (R-LOBBY-15): split band without the cap -> with the cap (runs / players / seats under the 4-per-player cap); overall strengths removed');
  const fillOf = (inBand: typeof runs): { players: number; seats: number } => {
    const per = new Map<string, number>();
    for (const r of inBand) per.set(owners.get(r.key)!, (per.get(owners.get(r.key)!) ?? 0) + 1);
    return { players: per.size, seats: [...per.values()].reduce((a, n) => a + Math.min(MAX_SEATS_PER_PLAYER, n), 0) };
  };
  for (const medal of RANK_MEDALS) {
    const capped = STRENGTH_BANDS[medal];
    const uncapped: StrengthBand | null = capped ? { min: capped.min, max: capped.max, ...(typeof capped.earlyWeight === 'number' ? { earlyWeight: capped.earlyWeight } : {}) } : null;
    const without = runs.filter((r) => runInStrengthBand(ratingsOf(r.key), uncapped));
    const withCap = runs.filter((r) => runInStrengthBand(ratingsOf(r.key), capped));
    const removed = without.filter((r) => !withCap.includes(r)).map((r) => strength.get(r.key)).filter((x): x is number => typeof x === 'number').sort((x, y) => y - x);
    const fw = fillOf(without); const fc = fillOf(withCap);
    let widen = 0;
    for (const [si, b] of bandSteps(capped).entries()) { widen = si; if (fillOf(runs.filter((r) => runInStrengthBand(ratingsOf(r.key), b))).seats >= 7) break; }
    const capLabel = typeof capped?.overallCap === 'number' ? `cap ${capped.overallCap}` : 'no cap';
    console.log(`  ${medal.padEnd(9)} ${capLabel.padEnd(7)}: ${without.length} -> ${withCap.length} runs, ${fw.players} -> ${fc.players} players, ${fw.seats} -> ${fc.seats} seats, widenings to seat 7: ${widen}${removed.length ? `, removed overall ${removed.join(', ')}` : ''}`);
  }
  for (const medal of RANK_MEDALS) {
    const band = STRENGTH_BANDS[medal];
    const steps = bandSteps(band);
    const report: string[] = [];
    for (const [si, b] of steps.entries()) {
      const inBand = runs.filter((r) => runInStrengthBand(ratingsOf(r.key), b));
      const perOwner = new Map<string, number>();
      for (const r of inBand) perOwner.set(owners.get(r.key)!, (perOwner.get(owners.get(r.key)!) ?? 0) + 1);
      const fillable = [...perOwner.values()].reduce((a, n) => a + Math.min(MAX_SEATS_PER_PLAYER, n), 0);
      const authors = new Map<string, number>();
      for (const r of inBand) authors.set(authorOf.get(r.key)!, (authors.get(authorOf.get(r.key)!) ?? 0) + 1);
      report.push(`step ${si} ${b ? bandVersionLabel(b) : 'uncapped'}: ${inBand.length} runs, ${perOwner.size} players, fillable seats ${fillable} [${[...authors.entries()].sort((a, c) => c[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(', ')}]`);
      if (fillable >= 7) break;
    }
    console.log(`\n${medal}:\n  ${report.join('\n  ')}`);
  }
  simulateLobbies(pool, strength, earlyRank, lateRank);
}

const fmtBand = (b: StrengthBand | null): string => (b ? `${b.min}-${b.max}` : 'uncapped');

/** The weighted-era band table (#1871, restored 2026-10-06, replaced the same day by the split bands): printed beside
 *  the split bands for comparison. */
const WEIGHTED_BANDS: Readonly<Record<RankMedal, StrengthBand | null>> = {
  Bronze: { min: 0, max: 30 }, Silver: { min: 10, max: 40 }, Gold: { min: 20, max: 65 }, Platinum: null, Diamond: { min: 10, max: 100 }, Ascendant: { min: 20, max: 100 },
};

/** Real lobbies over the live pool with every run's strength stamped: how often seat selection widens, per medal,
 *  with everyone's runs eligible, your own included (owner 2026-09-30). */
function simulateLobbies(pool: LivePool, strength: Map<string, number | null>, early: Map<string, number | null>, late: Map<string, number | null>): void {
  OPPONENT_POOL.length = 0;
  const num = (m: Map<string, number | null>, k: string): number | undefined => { const v = m.get(k); return typeof v === 'number' ? v : undefined; };
  const runs = eligibleRuns(pool).map((r) => r.boards.map((b) => ({
    ...b.snapshot, wave: b.wave, remote: true as const, ...(r.userId ? { ownerId: r.userId } : {}),
    ...(num(strength, r.key) !== undefined ? { runStrength: num(strength, r.key)! } : {}),
    ...(num(early, r.key) !== undefined ? { runStrengthEarly: num(early, r.key)! } : {}),
    ...(num(late, r.key) !== undefined ? { runStrengthLate: num(late, r.key)! } : {}),
  })));
  registerOpponentRuns(runs);
  const heroes = playableHeroes().map((h) => h.id);
  // Your own runs are seated like anyone else's (owner 2026-09-30), so who is asking no longer changes the table: one
  // perspective covers newcomer, LazerLemon and Orangez alike.
  for (const who of ['any player (own runs included)']) {
    const out: string[] = [];
    for (const [medal, division] of [['Bronze', 0], ['Silver', 3], ['Gold', 6], ['Platinum', 9], ['Diamond', 12], ['Ascendant', 15]] as const) {
      const hist = new Map<number, number>();
      let generated = 0; let meanStrength = 0; let n = 0; let top = 0; let bottom = 0; let tables = 0; let ll = 0; let oz = 0;
      let earlySum = 0; let earlyN = 0; let scoreSum = 0; let scoreN = 0;
      const band = strengthBandForDivision(division);
      const LOBBIES = 200;
      for (let i = 0; i < LOBBIES; i++) {
        const lobby = createRunLobby(1000 + i, heroes[i % heroes.length]!, {}, SET, { strengthBand: strengthBandForDivision(division) });
        resetLobbyDrivers(lobby.seats);
        const w = lobby.poolAtStart?.band?.widenings ?? 0;
        hist.set(w, (hist.get(w) ?? 0) + 1);
        generated += lobby.seats.filter((s) => s.kind === 'hybrid' || s.kind === 'bot').length;
        for (const st of lobby.seats) { if (st.runKey?.startsWith('LazerLemon|')) ll++; if (st.runKey?.startsWith('Orangez|')) oz++; }
        const seated: number[] = [];
        for (const s of lobby.seats) { const v = s.runKey ? strength.get(s.runKey) : null; if (typeof v === 'number') { meanStrength += v; n++; seated.push(v); } }
        for (const s of lobby.seats) {
          if (!s.runKey) continue;
          const e = early.get(s.runKey); if (typeof e === 'number') { earlySum += e; earlyN++; }
          const sc = matchScoreOf({ strength: strength.get(s.runKey), early: e, late: late.get(s.runKey) }, band?.earlyWeight);
          if (typeof sc === 'number') { scoreSum += sc; scoreN++; }
        }
        if (seated.length) { top += Math.max(...seated); bottom += Math.min(...seated); tables++; }
      }
      out.push(`${medal}: widenings ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}x${v}`).join(' ')}, generated seats/lobby ${(generated / LOBBIES).toFixed(2)}, mean seat strength ${(meanStrength / Math.max(1, n)).toFixed(1)}, mean seat EARLY ${(earlySum / Math.max(1, earlyN)).toFixed(1)}, mean seat match score ${(scoreSum / Math.max(1, scoreN)).toFixed(1)}, strongest seat ${(top / Math.max(1, tables)).toFixed(1)}, weakest seat ${(bottom / Math.max(1, tables)).toFixed(1)}, LazerLemon seats ${(ll / LOBBIES).toFixed(2)}, Orangez seats ${(oz / LOBBIES).toFixed(2)}`);
    }
    console.log(`\nlobbies as ${who} (200 per medal):\n  ${out.join('\n  ')}`);
  }
  OPPONENT_POOL.length = 0;
}

const cmd = process.argv[2];
if (cmd === 'fetch') {
  const p = await loadLivePool(true);
  console.log(`fetched ${p.runs.length} runs, ${p.runs.reduce((a, r) => a + r.boards.length, 0)} boards`);
} else if (cmd === 'ref') await buildReference();
else if (cmd === 'backfill') await backfill();
else if (cmd === 'measure') await measure();
else { console.error('usage: npm run strength -- <fetch|ref|backfill|measure>'); process.exit(1); }
