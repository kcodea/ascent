/**
 * `npm run strength -- <fetch|ref|backfill|measure>` — the board-strength tools (2026-09-30, R-LOBBY-09).
 *
 *  fetch     pull the live pool (anon REST GETs only) into packages/tools/.cache/strength-pool.json
 *  ref       build the FROZEN reference set (packages/sim/src/lobby/strengthReference.v1.json) from that pool.
 *            Run once per reference version; re-running it with a different pool changes every score.
 *  backfill  score every pool board against the committed reference and write a SQL file of UPDATEs
 *            (supabase/backfill/2026-09-30-board-strength-backfill.sql) for the OWNER to run. Never writes to the DB.
 *  measure   the distribution of scores, runs per rank band today, and how often each band would need widening.
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
  runAverageOf, runPercentileOf, type RunStrengthHistogramEntry, type BoardSnapshot, type StrengthReference, type StrengthHistogramEntry, STRENGTH_BANDS,
  bandSteps, inStrengthBand, type StrengthBand, MAX_SEATS_PER_PLAYER, RANK_MEDALS,
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
  const pctByRun = new Map<string, number[]>();
  for (const s of scored) {
    const others = entries(s.refWave).map((e) => (e.raw === s.raw ? { ...e, count: e.count - 1 } : e));
    const p = percentileOf(s.raw, others, true);
    if (p === null) continue;
    const list = pctByRun.get(s.runKey) ?? [];
    list.push(p);
    pctByRun.set(s.runKey, list);
  }
  const runs = eligibleRuns(pool);
  // A run's AVERAGE of board percentiles, then its strength = that average ranked among every scored run of the set
  // (the SQL's population: every pool_runs row with an average), itself counted once.
  const averages = new Map(pool.runs.filter((r) => r.setId === SET).map((r) => [r.key, runAverageOf(pctByRun.get(r.key) ?? [])]));
  const avgHist = new Map<number, number>();
  for (const a of averages.values()) if (a !== null) avgHist.set(a, (avgHist.get(a) ?? 0) + 1);
  const runHist = (skip: number): RunStrengthHistogramEntry[] => [...avgHist.entries()].map(([avg, count]) => ({ avg, count: avg === skip ? count - 1 : count }));
  const strength = new Map(runs.map((r) => {
    const a = averages.get(r.key) ?? null;
    return [r.key, a === null ? null : runPercentileOf(a, runHist(a), true)] as const;
  }));
  const avgValues = runs.map((r) => averages.get(r.key)).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  const values = [...strength.values()].filter((x): x is number => x !== null).sort((a, b) => a - b);
  const q = (p: number, xs = values): number => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
  console.log(`\neligible runs ${runs.length}, scored ${values.length}`);
  console.log(`run AVERAGE of board percentiles: min ${avgValues[0]} p10 ${q(0.1, avgValues)} median ${q(0.5, avgValues)} p90 ${q(0.9, avgValues)} max ${avgValues[avgValues.length - 1]}`);
  console.log(`run strength (ranked among runs): min ${values[0]} p10 ${q(0.1)} p25 ${q(0.25)} median ${q(0.5)} p75 ${q(0.75)} p90 ${q(0.9)} max ${values[values.length - 1]}`);
  const deciles = Array.from({ length: 10 }, (_, i) => values.filter((v) => v > i * 10 && v <= (i + 1) * 10).length);
  console.log('runs per decile (1-10, 11-20, ... 91-100):', deciles.join(' '));
  // Raw win rate by wave (the per-board spread the percentile sits on).
  for (const w of [...hist.keys()].sort((a, b) => a - b)) {
    const raws = scored.filter((s) => s.refWave === w).map((s) => s.raw).sort((a, b) => a - b);
    console.log(`  ref wave ${w}: ${raws.length} boards, raw p10 ${raws[Math.floor(raws.length * 0.1)]} median ${raws[Math.floor(raws.length / 2)]} p90 ${raws[Math.floor(raws.length * 0.9)]}, distinct values ${new Set(raws).size}`);
  }
  // Bands: runs in band per medal, seats fillable under the 4-per-player cap, and the widening a lobby needs.
  const owners = new Map(runs.map((r) => [r.key, r.userId ? `id:${r.userId}` : `name:${r.author.toLowerCase()}`]));
  const authorOf = new Map(runs.map((r) => [r.key, r.author]));
  for (const medal of RANK_MEDALS) {
    const band = STRENGTH_BANDS[medal];
    const steps = bandSteps(band);
    const report: string[] = [];
    for (const [si, b] of steps.entries()) {
      const inBand = runs.filter((r) => inStrengthBand(strength.get(r.key), b));
      const perOwner = new Map<string, number>();
      for (const r of inBand) perOwner.set(owners.get(r.key)!, (perOwner.get(owners.get(r.key)!) ?? 0) + 1);
      const fillable = [...perOwner.values()].reduce((a, n) => a + Math.min(MAX_SEATS_PER_PLAYER, n), 0);
      const authors = new Map<string, number>();
      for (const r of inBand) authors.set(authorOf.get(r.key)!, (authors.get(authorOf.get(r.key)!) ?? 0) + 1);
      report.push(`step ${si} ${fmtBand(b)}: ${inBand.length} runs, ${perOwner.size} players, fillable seats ${fillable} [${[...authors.entries()].sort((a, c) => c[1] - a[1]).map(([a, n]) => `${a} ${n}`).join(', ')}]`);
      if (fillable >= 7) break;
    }
    console.log(`\n${medal}:\n  ${report.join('\n  ')}`);
  }
  simulateLobbies(pool, strength);
  // Excluding each of the two big authors (the player never meets their own runs): how often widening kicks in.
  for (const me of ['LazerLemon', 'Orangez']) {
    const mine = runs.find((r) => r.author === me);
    const myOwner = mine ? owners.get(mine.key) : null;
    const lines: string[] = [];
    for (const medal of ['Bronze', 'Silver', 'Gold'] as const) {
      const steps = bandSteps(STRENGTH_BANDS[medal]);
      let used = 0;
      for (const [si, b] of steps.entries()) {
        const perOwner = new Map<string, number>();
        for (const r of runs) {
          if (owners.get(r.key) === myOwner || !inStrengthBand(strength.get(r.key), b)) continue;
          perOwner.set(owners.get(r.key)!, (perOwner.get(owners.get(r.key)!) ?? 0) + 1);
        }
        const fillable = [...perOwner.values()].reduce((a, n) => a + Math.min(MAX_SEATS_PER_PLAYER, n), 0);
        used = si;
        if (fillable >= 7) break;
      }
      lines.push(`${medal} needs ${used} widening step(s)`);
    }
    console.log(`\nas ${me}: ${lines.join('; ')}`);
  }
}

const fmtBand = (b: StrengthBand | null): string => (b ? `${b.min}-${b.max}` : 'uncapped');

/** Real lobbies over the live pool with every run's strength stamped: how often seat selection widens, per medal,
 *  as each of the two big authors (their own runs excluded) and as a newcomer. */
function simulateLobbies(pool: LivePool, strength: Map<string, number | null>): void {
  OPPONENT_POOL.length = 0;
  const runs = eligibleRuns(pool).map((r) => r.boards.map((b) => ({
    ...b.snapshot, wave: b.wave, remote: true as const, ...(r.userId ? { ownerId: r.userId } : {}),
    ...(typeof strength.get(r.key) === 'number' ? { runStrength: strength.get(r.key)! } : {}),
  })));
  registerOpponentRuns(runs);
  const heroes = playableHeroes().map((h) => h.id);
  const me = (author: string): string | null => eligibleRuns(pool).find((r) => r.author === author)?.userId ?? null;
  for (const who of ['newcomer', 'LazerLemon', 'Orangez']) {
    const exclude = who === 'newcomer' ? null : me(who);
    const out: string[] = [];
    for (const [medal, division] of [['Bronze', 0], ['Silver', 3], ['Gold', 6], ['Platinum', 9]] as const) {
      const hist = new Map<number, number>();
      let generated = 0; let meanStrength = 0; let n = 0;
      const LOBBIES = 200;
      for (let i = 0; i < LOBBIES; i++) {
        const lobby = createRunLobby(1000 + i, heroes[i % heroes.length]!, {}, SET, { excludeOwnerId: exclude, strengthBand: strengthBandForDivision(division) });
        resetLobbyDrivers(lobby.seats);
        const w = lobby.poolAtStart?.band?.widenings ?? 0;
        hist.set(w, (hist.get(w) ?? 0) + 1);
        generated += lobby.seats.filter((s) => s.kind === 'hybrid' || s.kind === 'bot').length;
        for (const s of lobby.seats) { const v = s.runKey ? strength.get(s.runKey) : null; if (typeof v === 'number') { meanStrength += v; n++; } }
      }
      out.push(`${medal}: widenings ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}x${v}`).join(' ')}, generated seats/lobby ${(generated / LOBBIES).toFixed(2)}, mean seat strength ${(meanStrength / Math.max(1, n)).toFixed(1)}`);
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
