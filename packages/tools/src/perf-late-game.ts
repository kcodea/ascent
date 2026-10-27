/*
 * LATE-GAME logic check: does the game's LOGIC get slower as a lobby run gets longer? Run: `npm run perf:late`.
 *
 * `npm run perf` times the engine on small, fresh states. This one plays a whole 8-seat lobby game with a greedy
 * bot and, at every wave, times the non-graphics work the store does per action, so wave 1 and the last wave can
 * be compared directly:
 *
 *   reduce     - every dispatched action (the run logic itself), plus a fixed probe action (freeze) timed at the
 *                start of each shop so waves are compared on the SAME action
 *   faceOmen   - End Turn: our fight plus the other seats' fights
 *   resolve    - settleCombat + resolveCombat (the lobby table settling)
 *   telemetry  - recordTelemetryAction + observeAction (the store's commit:telemetry / commit:derive)
 *   replay     - the replay frame per action (shopFrameOf / deltaShopFrameOf / combatFrameOf + the array copy),
 *                the store's commit:replayFrame
 *   autosave   - serialize(run) + JSON.stringify of the save payload, the store's `autosave` (minus localStorage)
 *
 * It also prints the size of what is being carried (run JSON, save payload, replay frames), because "the state
 * grew" is the usual reason a step slows down. What it CANNOT see: React render, paint, GC pauses caused by the UI,
 * localStorage's own write time. Those need the in-game Perf HUD capture (docs/performance.md).
 *
 * Informational: it prints a late-vs-early ratio per step and flags anything that grew 2x or more. It never fails
 * the build, because a long game legitimately carries more data.
 */
import { CARD_INDEX, validateCards } from '@game/content';
import {
  createLobbyRun, reduce, serialize, CONFIG, HEROES,
  emptyTelemetryLog, recordTelemetryAction, beginDerive, observeAction,
  shopFrameOf, deltaShopFrameOf, combatFrameOf, snapshotBoard,
  type Action, type RunState, type ShopCard, type ReplayFrame, type ShopView, type BoardSnapshot,
} from '@game/sim';

validateCards();

const arg = (name: string, dflt: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : dflt;
};
const SEEDS = arg('seeds', 12); // try this many seeds, report the longest game (late waves are the point)
const PROBE_ITERS = arg('probe', 300);
const SAVE_ITERS = arg('saves', 7);

// ── The greedy bot (same shape as perf.ts) ──────────────────────────────────────────────────────────────────────
const stat = (c: { attack: number; health: number }): number => c.attack + c.health;
const offerValue = (o: ShopCard): number => {
  const d = CARD_INDEX[o.cardId];
  return (d ? d.attack + d.health + d.tier * 2 : 0) + (o.atk ?? 0) + (o.hp ?? 0);
};
const bestOffer = (s: RunState): ShopCard | undefined => [...s.shop].sort((a, b) => offerValue(b) - offerValue(a))[0];

/** The next action the bot would take (never applied here; the caller dispatches it so it can be timed). */
function nextAction(s: RunState, tried: Set<string>): Action {
  if (s.questOffer) return { type: 'buyQuest', index: 0 };
  if (s.discover) return { type: 'discover', index: 0 };
  if (s.chooseOne) return { type: 'chooseOne', index: 0 };
  if (s.pendingTarget) return { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid };
  if (s.runeforgeOffer) return tried.has('buyRune') ? { type: 'skipRuneforge' } : { type: 'buyRune', index: 0 };
  if (s.phase === 'combat') return tried.has('settleCombat') ? { type: 'resolveCombat' } : { type: 'settleCombat' };
  const cands: Action[] = [];
  if (s.board.length < CONFIG.boardMax && s.hand.length > 0) {
    cands.push({ type: 'play', uid: [...s.hand].sort((a, b) => stat(b) - stat(a))[0]!.uid });
  }
  if (s.tier < CONFIG.maxTier && s.embers >= s.upgradeCost && (s.upgradeCost <= 3 || s.board.length >= 4)) cands.push({ type: 'upgrade' });
  if (s.embers >= CONFIG.minionCost && s.board.length + s.hand.length < CONFIG.boardMax) {
    const o = bestOffer(s);
    if (o) cands.push({ type: 'buy', uid: o.uid });
  }
  if (s.heroReady && s.board.length > 0) cands.push({ type: 'heroPower', uid: [...s.board].sort((a, b) => stat(b) - stat(a))[0]!.uid });
  for (const a of cands) if (!tried.has(JSON.stringify(a))) return a;
  return { type: 'faceOmen' };
}

// ── Per-wave accumulators ───────────────────────────────────────────────────────────────────────────────────────
interface Agg { n: number; total: number; max: number }
const agg = (): Agg => ({ n: 0, total: 0, max: 0 });
const add = (a: Agg, ms: number): void => { a.n++; a.total += ms; if (ms > a.max) a.max = ms; };

interface WaveRow {
  wave: number;
  alive: number;
  dispatches: number;
  probeMs: number; // median reduce(freeze) at shop open
  reduce: Agg; // every recruit-phase dispatch except faceOmen
  faceOmen: Agg;
  resolve: Agg;
  telemetry: Agg;
  replay: Agg;
  saveMs: number; // median serialize + stringify at the turn boundary
  saveKb: number;
  runKb: number;
  replayFrames: number;
  combatEvents: number;
}

const time = <T>(fn: () => T): [T, number] => {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
};
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

function playLobby(seed: number, heroId: string): WaveRow[] {
  let s = createLobbyRun(seed, heroId, {}, 'lobby');
  let telemetry = emptyTelemetryLog();
  let derive = beginDerive(s);
  let replayFrames: ReplayFrame[] = [];
  let lastView: ShopView | null = null;
  const actions: Action[] = [];
  let boards: BoardSnapshot[] = [];
  const rows: WaveRow[] = [];
  let row: WaveRow | null = null;
  let tried = new Set<string>();
  let clock = 0;

  const openRow = (): WaveRow => ({
    wave: s.wave, alive: s.lobby?.seats.filter((x) => x.alive).length ?? 0, dispatches: 0,
    probeMs: 0, reduce: agg(), faceOmen: agg(), resolve: agg(), telemetry: agg(), replay: agg(),
    saveMs: 0, saveKb: 0, runKb: 0, replayFrames: 0, combatEvents: 0,
  });
  const probe = (r: WaveRow): void => {
    // The same cheap action every wave, so the comparison is about the STATE, not about which action ran.
    // A refused freeze (nothing to freeze) returns at once and would read as "fast", so it is left out (NaN).
    if (reduce(s, { type: 'freeze' }) === s) { r.probeMs = NaN; return; }
    const samples: number[] = [];
    for (let i = 0; i < PROBE_ITERS; i++) samples.push(time(() => reduce(s, { type: 'freeze' }))[1]);
    r.probeMs = median(samples);
  };
  const autosave = (r: WaveRow): void => {
    const samples: number[] = [];
    let bytes = 0;
    for (let i = 0; i < SAVE_ITERS; i++) {
      const [str, ms] = time(() => JSON.stringify({ run: serialize(s), actions, ...(boards.length ? { boards } : {}), telemetry, derive }));
      samples.push(ms);
      bytes = str.length;
    }
    r.saveMs = median(samples);
    r.saveKb = bytes / 1024;
    r.runKb = serialize(s).length / 1024;
    r.replayFrames = replayFrames.length;
  };

  row = openRow();
  probe(row);
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 20000) {
    const action = nextAction(s, tried);
    const before = s;
    const [next, ms] = time(() => reduce(before, action));
    row.dispatches++;
    if (action.type === 'faceOmen') add(row.faceOmen, ms);
    else if (action.type === 'settleCombat' || action.type === 'resolveCombat') add(row.resolve, ms);
    else add(row.reduce, ms);
    if (next === before) { tried.add(action.type === 'settleCombat' || action.type === 'buyRune' ? action.type : JSON.stringify(action)); continue; }
    if (action.type === 'settleCombat') tried.add('settleCombat');

    // The store's commit steps, in the store's order.
    actions.push(action);
    add(row.telemetry, time(() => {
      telemetry = recordTelemetryAction(telemetry, before, action, next);
      derive = observeAction(derive, before, action, next);
    })[1]);
    add(row.replay, time(() => {
      clock += 1000;
      if (action.type === 'faceOmen' && next.lastCombat) {
        replayFrames = [...replayFrames, combatFrameOf(before, next, clock)];
        if (next.mode === 'lobby') boards = [...boards, snapshotBoard(next)];
      } else if (next.phase === 'recruit' && before.phase !== 'recruit') {
        const f = shopFrameOf(next, 'turnStart', clock);
        lastView = f.view;
        replayFrames = [...replayFrames, f];
      } else if (next.phase === 'recruit' && before.phase === 'recruit' && lastView) {
        const d = deltaShopFrameOf(lastView, next, action.type, clock);
        lastView = d.view;
        replayFrames = [...replayFrames, d.frame];
      }
    })[1]);
    if (action.type === 'faceOmen') row.combatEvents = next.lastCombat?.events.length ?? 0;
    s = next;

    if (before.phase !== 'recruit' && s.phase === 'recruit') {
      // Turn boundary: the store autosaves here. Close this wave's row, open the next.
      autosave(row);
      rows.push(row);
      row = openRow();
      tried = new Set();
      probe(row);
    } else if (s.phase === 'recruit') {
      tried = new Set([...tried].filter((k) => k !== 'settleCombat'));
    }
  }
  if (row.dispatches > 0) { autosave(row); rows.push(row); }
  return rows;
}

// ── Pick the longest game across seeds (a short game has no "late") ─────────────────────────────────────────────
const heroes = HEROES.map((h) => h.id);
let best: { seed: number; hero: string; rows: WaveRow[] } | null = null;
for (let i = 0; i < SEEDS; i++) {
  const seed = 4100 + i;
  const hero = heroes[i % heroes.length]!;
  // A first, throwaway run per seed warms the JIT; only the longest game's rows are reported.
  const rows = playLobby(seed, hero);
  if (!best || rows.length > best.rows.length) best = { seed, hero, rows };
}
if (!best || best.rows.length < 4) {
  console.log('No game lasted 4+ waves; nothing to compare.');
  process.exit(0);
}
// Replay the chosen game once more so its numbers come from a warm JIT, not the first pass.
const rows = playLobby(best.seed, best.hero);

// ── Report ──────────────────────────────────────────────────────────────────────────────────────────────────────
const f2 = (n: number): string => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
const f3 = (n: number): string => (n < 0.1 ? n.toFixed(4) : f2(n));
const avg = (a: Agg): number => (a.n ? a.total / a.n : 0);
const pad = (v: string, w: number): string => v.padStart(w);

console.log(`\n=== ASCENT: late-game logic check (lobby, seed ${best.seed}, hero ${best.hero}, ${rows.length} waves) ===`);
console.log('ms per call. "avg/max" = across that wave\'s calls. Sizes in KB. Logic only: no React, paint or localStorage.\n');
const head = ['wave', 'seats', 'acts', 'probe', 'reduce avg/max', 'endTurn', 'resolve', 'telem avg', 'replay avg/max', 'autosave', 'save KB', 'run KB', 'frames', 'events'];
const widths = [4, 5, 4, 7, 15, 8, 8, 9, 15, 8, 8, 7, 6, 6];
console.log(head.map((h, i) => pad(h, widths[i]!)).join(' '));
for (const r of rows) {
  const cells = [
    String(r.wave), String(r.alive), String(r.dispatches), Number.isFinite(r.probeMs) ? f3(r.probeMs) : '-',
    `${f3(avg(r.reduce))}/${f2(r.reduce.max)}`, f2(r.faceOmen.max), f2(r.resolve.max), f3(avg(r.telemetry)),
    `${f3(avg(r.replay))}/${f2(r.replay.max)}`, f2(r.saveMs), f2(r.saveKb), f2(r.runKb), String(r.replayFrames), String(r.combatEvents),
  ];
  console.log(cells.map((c, i) => pad(c, widths[i]!)).join(' '));
}

// Early = first 3 waves, late = last 3. Ratio > 2 is flagged as growth worth a look.
const early = rows.slice(0, 3);
const late = rows.slice(-3);
const mean = (rs: WaveRow[], pick: (r: WaveRow) => number): number => {
  const xs = rs.map(pick).filter((x) => Number.isFinite(x));
  return xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0;
};
const metrics: { label: string; pick: (r: WaveRow) => number; budgetMs?: number }[] = [
  { label: 'reduce probe (freeze), median', pick: (r) => r.probeMs },
  { label: 'reduce, avg per shop action', pick: (r) => avg(r.reduce) },
  { label: 'reduce, worst shop action', pick: (r) => r.reduce.max },
  { label: 'End Turn (faceOmen)', pick: (r) => r.faceOmen.max },
  { label: 'settle + resolve combat, worst', pick: (r) => r.resolve.max },
  { label: 'telemetry + derive, avg', pick: (r) => avg(r.telemetry) },
  { label: 'replay frame, avg', pick: (r) => avg(r.replay) },
  { label: 'replay frame, worst', pick: (r) => r.replay.max },
  { label: 'autosave (serialize+stringify)', pick: (r) => r.saveMs },
  { label: 'save payload KB', pick: (r) => r.saveKb },
  { label: 'run state KB', pick: (r) => r.runKb },
];
console.log(`\nEarly (waves ${early.map((r) => r.wave).join(',')}) vs late (waves ${late.map((r) => r.wave).join(',')}):`);
const grew: string[] = [];
for (const m of metrics) {
  const e = mean(early, m.pick);
  const l = mean(late, m.pick);
  const ratio = e > 0 ? l / e : 0;
  const flag = ratio >= 2 ? '  << grew' : '';
  if (ratio >= 2) grew.push(`${m.label} (${ratio.toFixed(1)}x)`);
  console.log(`  ${m.label.padEnd(34)} ${pad(f3(e), 9)} -> ${pad(f3(l), 9)}   ${ratio ? ratio.toFixed(2) + 'x' : '-'}${flag}`);
}
console.log(grew.length
  ? `\nGrew 2x or more from early to late: ${grew.join('; ')}.`
  : '\nNothing grew 2x or more from early to late.');
// Any single call over the 240 Hz frame budget drops a frame by itself, whatever the trend says.
const BUDGET_MS = 4.17;
const over: string[] = [];
for (const r of rows) {
  for (const [label, ms] of [['shop action', r.reduce.max], ['End Turn', r.faceOmen.max], ['settle/resolve', r.resolve.max], ['replay frame', r.replay.max], ['autosave', r.saveMs]] as const) {
    if (ms > BUDGET_MS) over.push(`wave ${r.wave} ${label} ${f2(ms)} ms`);
  }
}
console.log(over.length
  ? `Over the ${BUDGET_MS} ms frame budget (240 Hz) in a single call: ${over.join('; ')}.\n`
  : `No single call went over the ${BUDGET_MS} ms frame budget (240 Hz).\n`);
