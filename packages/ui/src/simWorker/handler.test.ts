import { describe, expect, it } from 'vitest';
import { CONFIG, COMBAT_ODDS_SIMS, computeCombatOdds, createRun, loadStrengthReference, reduce, runLossCap, scoreBoard, type BoardSnapshot, type CombatOddsInput, type RunState, type StrengthReference } from '@game/sim';
import { createSimWorkerHandler, type SimWorkerHandler } from './handler';
import type { SimWorkerReply, SimWorkerRequest } from './protocol';

/**
 * WORKER PARITY (R-PERF-SIM-WORKER-01, perf pass 2026-11-18): the sim worker is the handler below behind a message
 * port. Every request and reply is passed through `structuredClone` here, exactly what `postMessage` does, so this
 * also proves the inputs survive the trip (no function, no class instance the clone would drop). The numbers that
 * come back must equal the one-shot main-thread functions byte for byte: the odds a player reads, the replay stamp,
 * the spectators' copy and the strength score the server stores do not move because the work moved.
 */

// The greedy bot of `packages/sim/src/odds.test.ts`: enough to harvest real, growing boards.
const stat = (c: { attack: number; health: number }): number => c.attack + c.health;
function recruitStep(s: RunState): RunState {
  let n: RunState;
  if (s.board.length < CONFIG.boardMax && s.hand.length > 0) {
    const best = [...s.hand].sort((a, b) => stat(b) - stat(a))[0]!;
    n = reduce(s, { type: 'play', uid: best.uid });
    if (n !== s) return n;
  }
  if (s.tier < CONFIG.maxTier && s.embers >= s.upgradeCost && (s.upgradeCost <= 3 || s.board.length >= 4)) {
    n = reduce(s, { type: 'upgrade' });
    if (n !== s) return n;
  }
  if (s.embers >= CONFIG.minionCost && s.board.length + s.hand.length < CONFIG.boardMax && s.shop[0]) {
    n = reduce(s, { type: 'buy', uid: s.shop[0].uid });
    if (n !== s) return n;
  }
  return reduce(s, { type: 'faceOmen' });
}
interface OddsSample { input: CombatOddsInput; seed: number; wave: number; cap: number }
function harvestOddsInputs(seed: number, maxWave: number): OddsSample[] {
  let s = createRun(seed, undefined, 'practice');
  const out: OddsSample[] = [];
  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && s.wave <= maxWave && steps++ < 20000) {
    if (s.runeforgeOffer) { s = reduce(s, { type: 'skipRuneforge' }); continue; }
    if (s.questOffer) { s = reduce(s, { type: 'buyQuest', index: 0 }); continue; }
    if (s.discover) { s = reduce(s, { type: 'discover', index: 0 }); continue; }
    if (s.chooseOne) { s = reduce(s, { type: 'chooseOne', index: 0 }); continue; }
    if (s.pendingTarget) { s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid }); continue; }
    if (s.phase === 'combat') {
      const lc = s.lastCombat;
      if (lc?.oddsInput && !lc.odds) out.push({ input: lc.oddsInput, seed: s.seed, wave: s.wave, cap: runLossCap(s) });
      s = reduce(s, { type: 'resolveCombat' });
      continue;
    }
    const next = recruitStep(s);
    if (next === s) break;
    s = next;
  }
  return out;
}

/** The handler behind a fake port: requests and replies are structured-cloned, deferred chunks run on `drain`. */
function port(over: { chunkMs?: number; loadReference?: () => Promise<StrengthReference> } = {}) {
  const replies: SimWorkerReply[] = [];
  const tasks: (() => void)[] = [];
  let clock = 0;
  const handler: SimWorkerHandler = createSimWorkerHandler({
    post: (r) => { replies.push(structuredClone(r)); },
    defer: (fn) => { tasks.push(fn); },
    now: () => (clock += 1), // every reading costs 1 ms: a chunk visibly spends its budget and yields
    loadReference: over.loadReference ?? loadStrengthReference,
    chunkMs: over.chunkMs,
  });
  return {
    replies, handler,
    send: (msg: SimWorkerRequest): void => handler.onMessage(structuredClone(msg)),
    /** Run one deferred chunk. False when none is waiting. */
    tick(): boolean { const fn = tasks.shift(); if (!fn) return false; fn(); return true; },
    async drain(): Promise<void> {
      for (let i = 0; i < 100_000; i++) {
        if (this.tick()) continue;
        await new Promise((r) => setTimeout(r, 0)); // the reference import
        if (tasks.length === 0 && handler.pending() === 0) return;
      }
      throw new Error('the worker never went idle');
    },
  };
}

const samples = harvestOddsInputs(20261118, 10);
const refP = loadStrengthReference();
const boardOf = (ref: StrengthReference, w: number, i: number): BoardSnapshot => ({ ...ref.waves[String(w)]![i]!, wave: w, setId: ref.setId } as BoardSnapshot);

describe('the sim worker: odds', () => {
  it('answers hello with ready', () => {
    const p = port();
    p.send({ t: 'hello' });
    expect(p.replies).toEqual([{ t: 'ready' }]);
  });

  it('returns exactly the one-shot odds, however the chunks fall', async () => {
    expect(samples.length).toBeGreaterThan(5);
    const picks = [samples[0]!, samples[Math.floor(samples.length / 2)]!, samples[samples.length - 1]!];
    for (const chunkMs of [1, 8, 1000]) {
      const p = port({ chunkMs });
      picks.forEach((s, i) => p.send({ t: 'odds', id: i + 1, input: s.input, seed: s.seed, wave: s.wave, sims: COMBAT_ODDS_SIMS, cap: s.cap }));
      await p.drain();
      picks.forEach((s, i) => {
        const reply = p.replies.find((r) => r.t === 'odds' && r.id === i + 1);
        const want = computeCombatOdds(s.input, s.seed, s.wave, s.cap);
        expect(reply).toEqual({ t: 'odds', id: i + 1, odds: want });
        expect(JSON.stringify((reply as { odds: unknown }).odds)).toBe(JSON.stringify(want)); // byte for byte, key order included
      });
    }
  }, 60_000);

  it('reads a mirrored fight from the enemy chair, as the page does (Versus, Duos)', async () => {
    const s = samples[samples.length - 1]!;
    const input: CombatOddsInput = { ...s.input, perspective: 'enemy', lossDamageMult: 1.5 };
    const p = port();
    p.send({ t: 'odds', id: 9, input, seed: s.seed, wave: s.wave, sims: COMBAT_ODDS_SIMS, cap: s.cap });
    await p.drain();
    expect(p.replies).toEqual([{ t: 'odds', id: 9, odds: computeCombatOdds(input, s.seed, s.wave, s.cap) }]);
  }, 30_000);

  it('a cancelled probe never answers, and the next one is unaffected', async () => {
    const [a, b] = [samples[samples.length - 1]!, samples[samples.length - 2]!];
    const p = port({ chunkMs: 1 });
    p.send({ t: 'odds', id: 1, input: a.input, seed: a.seed, wave: a.wave, sims: COMBAT_ODDS_SIMS, cap: a.cap });
    expect(p.tick()).toBe(true); // one chunk in: the probe is part done
    expect(p.handler.pending()).toBe(1);
    p.send({ t: 'cancel', id: 1 }); // a new fight began
    p.send({ t: 'odds', id: 2, input: b.input, seed: b.seed, wave: b.wave, sims: COMBAT_ODDS_SIMS, cap: b.cap });
    await p.drain();
    expect(p.replies).toEqual([{ t: 'odds', id: 2, odds: computeCombatOdds(b.input, b.seed, b.wave, b.cap) }]);
  }, 30_000);

  it('a probe that throws answers with an error for that job only', async () => {
    const s = samples[0]!;
    const p = port();
    p.send({ t: 'odds', id: 1, input: { ...s.input, player: null as unknown as CombatOddsInput['player'] }, seed: 1, wave: 1, sims: 5, cap: 5 });
    p.send({ t: 'odds', id: 2, input: s.input, seed: s.seed, wave: s.wave, sims: COMBAT_ODDS_SIMS, cap: s.cap });
    await p.drain();
    expect(p.replies.find((r) => r.t === 'error')).toMatchObject({ t: 'error', id: 1 });
    expect(p.replies.find((r) => r.t === 'odds')).toEqual({ t: 'odds', id: 2, odds: computeCombatOdds(s.input, s.seed, s.wave, s.cap) });
  }, 30_000);
});

describe('the sim worker: board strength', () => {
  it('scores a board, and its carried rounds, exactly as the one-shot scorer does', async () => {
    const ref = await refP;
    const board = boardOf(ref, 12, 9);
    const p = port();
    p.send({ t: 'warm' });
    p.send({ t: 'strength', id: 1, board });
    p.send({ t: 'strength', id: 2, board, atRound: 14 });
    p.send({ t: 'strength', id: 3, board: { ...board, minions: [] } }); // unscorable: null, no fight
    await p.drain();
    expect(p.replies.find((r) => r.t === 'strength' && r.id === 1)).toEqual({ t: 'strength', id: 1, score: scoreBoard(board, ref), total: 160 });
    expect(p.replies.find((r) => r.t === 'strength' && r.id === 2)).toEqual({ t: 'strength', id: 2, score: scoreBoard(board, ref, 14), total: 160 });
    expect(p.replies.find((r) => r.t === 'strength' && r.id === 3)).toEqual({ t: 'strength', id: 3, score: null, total: 0 });
    // Progress is reported on the way, never past the total.
    const progress = p.replies.filter((r) => r.t === 'progress');
    expect(progress.length).toBeGreaterThan(0);
    for (const r of progress) if (r.t === 'progress') { expect(r.done).toBeLessThan(r.total); expect(r.total).toBe(160); }
  }, 60_000);

  it('the odds jump the queue: a board being scored waits for the probe the player is about to read', async () => {
    const ref = await refP;
    const s = samples[samples.length - 1]!;
    const p = port({ chunkMs: 1 });
    p.send({ t: 'strength', id: 1, board: boardOf(ref, 9, 3) });
    await new Promise((r) => setTimeout(r, 0));
    p.tick(); await new Promise((r) => setTimeout(r, 20)); p.tick(); // the reference is in, the board has begun
    p.send({ t: 'odds', id: 2, input: s.input, seed: s.seed, wave: s.wave, sims: COMBAT_ODDS_SIMS, cap: s.cap });
    await p.drain();
    const order = p.replies.filter((r) => r.t === 'odds' || r.t === 'strength').map((r) => r.t);
    expect(order).toEqual(['odds', 'strength']);
    expect(p.replies.find((r) => r.t === 'strength')).toEqual({ t: 'strength', id: 1, score: scoreBoard(boardOf(ref, 9, 3), ref), total: 160 });
  }, 60_000);

  it('a reference that cannot load fails every board job, and the odds still work', async () => {
    const ref = await refP;
    const s = samples[0]!;
    const p = port({ loadReference: () => Promise.reject(new Error('offline')) });
    p.send({ t: 'strength', id: 1, board: boardOf(ref, 3, 1) });
    p.send({ t: 'odds', id: 2, input: s.input, seed: s.seed, wave: s.wave, sims: COMBAT_ODDS_SIMS, cap: s.cap });
    await p.drain();
    expect(p.replies.find((r) => r.t === 'error')).toMatchObject({ t: 'error', id: 1 });
    expect(p.replies.some((r) => r.t === 'odds' && r.id === 2)).toBe(true);
    expect(p.handler.pending()).toBe(0);
  }, 30_000);
});
