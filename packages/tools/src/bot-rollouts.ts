/**
 * `npm run bot:rollouts` — the data engine: mass self-play with recorded trajectories.
 *
 * Plays headless runs against the real player-board pool and records, per run:
 *   - one row per ROUND: the end-of-shop-turn state (feature vector) — the value-function training states;
 *   - one row per QUEST / RUNE pick: what was offered, what was taken, and whether the pick was FORCED.
 * Outcomes are backfilled onto every row when the run ends (won next fight, survived +3, final wins, death
 * round), which is what turns states into supervised examples.
 *
 * EXPLORATION: in a seeded fraction of runs the quest/rune picks are randomized (and marked `forced: 1`).
 * A weak bot left to its own choices produces almost no data on lines it never tries — forcing coverage is
 * how self-play learns about options it would not naturally take. With only 2 human testers, this replaces
 * the human-trajectory warm start entirely (owner call 2026-07-29).
 *
 * Parallel via child processes of this same script (`--worker`), sharded by seed, resumable (a shard whose
 * output file exists is skipped). Deterministic per shard: same seed range + same explore rate = same rows.
 *
 *   npm run bot:rollouts -- --runs 2000 --workers 8 --explore 0.5
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import { makeRng } from '@game/core';
import {
  createRun, reduce, registerOpponents, createController, decide, boardFeatures,
  type RunState, type BoardSnapshot,
} from '@game/sim';

const argv = process.argv.slice(2);
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
};
const RUNS = num('runs', 1000);
const WORKERS = num('workers', 6);
const EXPLORE = num('explore', 0.5);
const WORKER_ID = num('worker', -1);
const OUT_DIR = 'packages/tools/.cache/rollouts';

interface Row {
  kind: 'state' | 'quest' | 'rune';
  seed: number; round: number; wave: number;
  /** boardFeatures + [gold, maxGold, tier, resolve+armor, handSize] appended. */
  f?: number[];
  /** Pick rows: what was offered and what was chosen. */
  offered?: string[]; picked?: string; forced?: number;
  // Backfilled outcomes:
  wonNext?: number; survived3?: number; finalWins?: number; deathRound?: number; winsAfter?: number;
}

function playAndRecord(seed: number, explore: boolean): Row[] {
  const rows: Row[] = [];
  let s: RunState = createRun(seed, 'drakko');
  let c = createController('roll', 'expert');
  const xrng = makeRng(seed ^ 0x9e3779b9);
  let g = 0;
  let lastRecordedRound = -1;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && g++ < 6000) {
    const d = decide(s, c);
    if (!d) break;
    c = d.controller;
    let action = d.action;

    // Exploration + recording of quest/rune picks.
    if (action.type === 'buyQuest' && s.questOffer?.length) {
      let index = action.index;
      let forced = 0;
      if (explore && xrng.next() < 0.7) { index = xrng.int(s.questOffer.length); forced = 1; }
      rows.push({ kind: 'quest', seed, round: s.history.length, wave: s.wave, offered: [...s.questOffer], picked: s.questOffer[index], forced });
      action = { type: 'buyQuest', index };
    } else if (action.type === 'buyRune' && s.runeforgeOffer?.length) {
      let index = action.index;
      let forced = 0;
      if (explore && xrng.next() < 0.7) { index = xrng.int(s.runeforgeOffer.length); forced = 1; }
      rows.push({ kind: 'rune', seed, round: s.history.length, wave: s.wave, offered: [...s.runeforgeOffer], picked: s.runeforgeOffer[index], forced });
      action = { type: 'buyRune', index };
    }

    // End-of-turn state row: capture the state the bot chose to go to combat with.
    if (action.type === 'faceOmen' && s.history.length !== lastRecordedRound) {
      lastRecordedRound = s.history.length;
      rows.push({
        kind: 'state', seed, round: s.history.length, wave: s.wave,
        f: [...boardFeatures(s.board, s.wave), s.embers, s.maxEmbers ?? 0, s.tier, s.resolve + (s.armor ?? 0), s.hand.length],
      });
    }

    const n = reduce(s, action);
    if (n === s) {
      // The forced pick was refused — fall back to the bot's own choice rather than stalling the run.
      const n2 = reduce(s, d.action);
      if (n2 === s) break;
      s = n2;
    } else s = n;
  }
  // Backfill outcomes.
  const finalWins = s.history.filter((r) => r === 'win').length;
  const death = s.resolve <= 0 ? s.history.length : 99;
  for (const r of rows) {
    r.wonNext = s.history[r.round] === 'win' ? 1 : 0;
    r.survived3 = s.history.length >= r.round + 3 || s.resolve > 0 ? 1 : 0;
    r.finalWins = finalWins;
    r.deathRound = death;
    r.winsAfter = s.history.slice(r.round).filter((x) => x === 'win').length;
  }
  return rows;
}

if (WORKER_ID >= 0) {
  // ---- worker: play a seed shard, write one JSONL file ----
  const human = JSON.parse(readFileSync('packages/tools/.cache/player-boards.json', 'utf8')) as BoardSnapshot[];
  registerOpponents(human);
  const from = num('from', 1), to = num('to', 100);
  const out = `${OUT_DIR}/shard-${from}-${to}.jsonl`;
  let buf: string[] = [];
  for (let seed = from; seed < to; seed++) {
    const explore = makeRng(seed).next() < EXPLORE;
    for (const row of playAndRecord(seed, explore)) buf.push(JSON.stringify(row));
    if (buf.length > 2000) { appendFileSync(out, buf.join('\n') + '\n'); buf = []; }
  }
  if (buf.length) appendFileSync(out, buf.join('\n') + '\n');
  console.log(`worker ${WORKER_ID}: seeds ${from}-${to} done`);
} else {
  // ---- parent: shard seeds across child processes, resume past finished shards ----
  mkdirSync(OUT_DIR, { recursive: true });
  const per = Math.ceil(RUNS / WORKERS);
  const t0 = Date.now();
  const children: Promise<void>[] = [];
  for (let w = 0; w < WORKERS; w++) {
    const from = 1 + w * per, to = Math.min(1 + RUNS, from + per);
    if (from >= to) continue;
    if (existsSync(`${OUT_DIR}/shard-${from}-${to}.jsonl`)) { console.log(`shard ${from}-${to}: exists, skipping`); continue; }
    children.push(new Promise((res) => {
      const p = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'packages/tools/src/bot-rollouts.ts',
        '--worker', String(w), '--from', String(from), '--to', String(to), '--explore', String(EXPLORE)],
        { stdio: 'inherit' });
      p.on('exit', () => res());
    }));
  }
  await Promise.all(children);
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith('.jsonl'));
  let rowCount = 0;
  for (const f of files) rowCount += readFileSync(`${OUT_DIR}/${f}`, 'utf8').split('\n').filter(Boolean).length;
  console.log(`\n${files.length} shards, ${rowCount} rows, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify({ runs: RUNS, explore: EXPLORE, shards: files, rows: rowCount }));
}
