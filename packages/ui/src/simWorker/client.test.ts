import { describe, expect, it } from 'vitest';
import { loadStrengthReference, scoreBoard, type BoardSnapshot, type CombatOdds, type CombatOddsInput, type StrengthReference } from '@game/sim';
import { createSimWorkerClient, type SimWorkerLike } from './client';
import { createSimWorkerHandler } from './handler';
import { runBackgroundOdds } from './backgroundOdds';
import { createStrengthScorer, type IdleDeadlineLike } from '../boardStrength/strengthScorer';
import type { SimWorkerReply, SimWorkerRequest } from './protocol';

/**
 * THE PAGE SIDE OF THE SIM WORKER (R-PERF-SIM-WORKER-01): jobs resolve by id, a cancelled job is dropped on both
 * sides, and every way the worker can fail (it cannot be created, it errors, it never answers, one job throws)
 * ends with the caller running the work itself, so nothing ever breaks.
 */

const ODDS: CombatOdds = { win: 0.5, draw: 0.1, lose: 0.4, avgLossDamage: 3, avgWinDamage: 4 };
const INPUT = { player: [], enemy: [], playerState: {}, enemyState: {}, config: {} } as unknown as CombatOddsInput;
const REQ = { input: INPUT, seed: 1, wave: 1, sims: 200, cap: 5 };

/** A worker the test answers by hand. */
function fakeWorker() {
  const sent: SimWorkerRequest[] = [];
  let terminated = false;
  const w: SimWorkerLike = {
    postMessage: (m) => { sent.push(m); },
    terminate: () => { terminated = true; },
    onmessage: null, onerror: null, onmessageerror: null,
  };
  return { w, sent, terminated: () => terminated, reply: (r: SimWorkerReply) => w.onmessage?.({ data: r }) };
}
const timers = () => {
  const fns: (() => void)[] = [];
  return { set: (fn: () => void): (() => void) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; }, fire: () => { for (const f of fns.splice(0)) f(); }, count: () => fns.length };
};

describe('the sim worker client', () => {
  it('creates the worker once, lazily, and resolves each job by id', async () => {
    const f = fakeWorker();
    let spawned = 0;
    const client = createSimWorkerClient(() => { spawned++; return f.w; });
    expect(spawned).toBe(0); // nothing until first use
    expect(client.prewarm()).toBe(true);
    const a = client.odds(REQ)!;
    const b = client.odds({ ...REQ, wave: 2 })!;
    expect(spawned).toBe(1);
    expect(f.sent.map((m) => m.t)).toEqual(['hello', 'warm', 'odds', 'odds']);
    const [idA, idB] = [(f.sent[2] as { id: number }).id, (f.sent[3] as { id: number }).id];
    f.reply({ t: 'odds', id: idB, odds: { ...ODDS, win: 0.9 } }); // out of order
    f.reply({ t: 'odds', id: idA, odds: ODDS });
    expect(await a.promise).toEqual(ODDS);
    expect((await b.promise).win).toBe(0.9);
    expect(client.inFlight()).toBe(0);
  });

  it('a cancelled job tells the worker, and a late reply for it is ignored', async () => {
    const f = fakeWorker();
    const client = createSimWorkerClient(() => f.w);
    const job = client.odds(REQ)!;
    let settled = false;
    void job.promise.then(() => { settled = true; }, () => { settled = true; });
    const id = (f.sent[1] as { id: number }).id;
    job.cancel();
    job.cancel(); // twice: one message
    expect(f.sent.filter((m) => m.t === 'cancel')).toEqual([{ t: 'cancel', id }]);
    f.reply({ t: 'odds', id, odds: ODDS });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(client.inFlight()).toBe(0);
  });

  it('no Worker here: every call says so and nothing is created', () => {
    const client = createSimWorkerClient(() => null);
    expect(client.odds(REQ)).toBeNull();
    expect(client.prewarm()).toBe(false);
    expect(client.available()).toBe(false);
  });

  it('a worker that errors rejects everything in flight and is never used again', async () => {
    const f = fakeWorker();
    let spawned = 0;
    const client = createSimWorkerClient(() => { spawned++; return f.w; });
    const job = client.odds(REQ)!;
    f.w.onerror?.(new Error('chunk failed to load'));
    await expect(job.promise).rejects.toThrow(/sim worker/);
    expect(f.terminated()).toBe(true);
    expect(client.available()).toBe(false);
    expect(client.odds(REQ)).toBeNull();
    expect(spawned).toBe(1);
  });

  it('a worker that never answers hello is written off at the timeout; one that does is kept', async () => {
    const dead = fakeWorker(); const t1 = timers();
    const c1 = createSimWorkerClient(() => dead.w, { setTimer: t1.set });
    const job = c1.odds(REQ)!;
    t1.fire();
    await expect(job.promise).rejects.toThrow(/never became ready/);
    expect(c1.available()).toBe(false);

    const live = fakeWorker(); const t2 = timers();
    const c2 = createSimWorkerClient(() => live.w, { setTimer: t2.set });
    c2.prewarm();
    expect(t2.count()).toBe(1);
    live.reply({ t: 'ready' });
    expect(t2.count()).toBe(0); // the timer is cancelled
    expect(c2.available()).toBe(true);
  });

  it('a request that cannot be cloned is handed back, and the worker stays in use', () => {
    const f = fakeWorker();
    const post = f.w.postMessage;
    f.w.postMessage = (m) => { if (m.t === 'odds' && m.wave === 99) throw new Error('DataCloneError'); post(m); };
    const client = createSimWorkerClient(() => f.w);
    expect(client.odds({ ...REQ, wave: 99 })).toBeNull();
    expect(client.available()).toBe(true);
    expect(client.odds(REQ)).not.toBeNull();
  });

  it('one failed job rejects that job only', async () => {
    const f = fakeWorker();
    const client = createSimWorkerClient(() => f.w);
    const a = client.odds(REQ)!; const b = client.odds(REQ)!;
    f.reply({ t: 'error', id: (f.sent[1] as { id: number }).id, message: 'a sim threw' });
    await expect(a.promise).rejects.toThrow(/a sim threw/);
    f.reply({ t: 'odds', id: (f.sent[2] as { id: number }).id, odds: ODDS });
    expect(await b.promise).toEqual(ODDS);
    expect(client.available()).toBe(true);
  });
});

describe('runBackgroundOdds', () => {
  it('takes the result from the worker and never calls back once cancelled', async () => {
    const f = fakeWorker();
    const client = createSimWorkerClient(() => f.w);
    const got: CombatOdds[] = [];
    runBackgroundOdds(REQ, (o) => got.push(o), { client });
    f.reply({ t: 'odds', id: (f.sent[1] as { id: number }).id, odds: ODDS });
    await Promise.resolve(); await Promise.resolve();
    expect(got).toEqual([ODDS]);

    const cancel = runBackgroundOdds(REQ, (o) => got.push(o), { client });
    cancel(); // a new fight began
    f.reply({ t: 'odds', id: (f.sent[2] as { id: number }).id, odds: ODDS });
    await Promise.resolve(); await Promise.resolve();
    expect(got.length).toBe(1);
    expect(f.sent.some((m) => m.t === 'cancel')).toBe(true);
  });

  it('with no worker the page runs the same probe itself (the fallback), in steps', async () => {
    const got: CombatOdds[] = [];
    // An empty matchup: every sim is a draw, so the fallback has a real, checkable answer.
    runBackgroundOdds({ ...REQ, sims: 12 }, (o) => got.push(o), { client: null });
    for (let i = 0; i < 200 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(got.length).toBe(1);
    expect(got[0]!.win + got[0]!.draw + got[0]!.lose).toBeCloseTo(1);
  }, 20_000);

  it('a worker that dies mid-job falls back to the page, which still answers', async () => {
    const f = fakeWorker();
    const client = createSimWorkerClient(() => f.w);
    const got: CombatOdds[] = [];
    runBackgroundOdds({ ...REQ, sims: 12 }, (o) => got.push(o), { client });
    f.w.onerror?.(new Error('gone'));
    for (let i = 0; i < 200 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(got.length).toBe(1);
  }, 20_000);
});

// ── The strength scorer over the worker ─────────────────────────────────────────────────────────────────────

const refP = loadStrengthReference();
const boardOf = (ref: StrengthReference, w: number, i: number): BoardSnapshot => ({ ...ref.waves[String(w)]![i]!, wave: w, setId: ref.setId } as BoardSnapshot);

/** A worker that is the REAL handler behind a cloning port (what the browser runs), drained by hand. */
function handlerWorker() {
  const tasks: (() => void)[] = [];
  let clock = 0;
  const w: SimWorkerLike = { postMessage: (m) => handler.onMessage(structuredClone(m)), terminate: () => {}, onmessage: null, onerror: null, onmessageerror: null };
  const handler = createSimWorkerHandler({
    post: (r) => { const data = structuredClone(r); queueMicrotask(() => w.onmessage?.({ data })); },
    defer: (fn) => { tasks.push(fn); },
    now: () => (clock += 1),
    loadReference: () => refP,
  });
  return {
    w,
    tick(): boolean { const fn = tasks.shift(); if (!fn) return false; fn(); return true; },
    async drain(): Promise<void> {
      for (let i = 0; i < 100_000; i++) {
        if (this.tick()) continue;
        await new Promise((r) => setTimeout(r, 0));
        if (tasks.length === 0 && handler.pending() === 0) return;
      }
    },
  };
}
function scorerOver(worker: SimWorkerLike | null) {
  const client = createSimWorkerClient(() => worker);
  let idle: ((d?: IdleDeadlineLike) => void) | null = null;
  const counts = { idle: 0 };
  let holding = false;
  const scorer = createStrengthScorer({
    loadReference: () => refP,
    requestSlice: (fn) => { counts.idle++; idle = fn; return () => { idle = null; }; },
    setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); },
    remote: { score: (board, atRound, onProgress) => client.strength(board, atRound, onProgress) },
    hold: () => holding,
  });
  return { scorer, client, counts, hold: (v: boolean) => { holding = v; }, tickIdle(d?: IdleDeadlineLike): boolean { const f = idle; idle = null; if (!f) return false; f(d); return true; } };
}

describe('the strength scorer over the sim worker', () => {
  it('hands every job to the worker, runs nothing on the page, and records what the one-shot scorer would', async () => {
    const ref = await refP;
    const hw = handlerWorker();
    const s = scorerOver(hw.w);
    const final = boardOf(ref, 12, 9);
    s.scorer.enqueue(5, boardOf(ref, 6, 20));
    s.scorer.enqueue(5, final);
    s.scorer.enqueueCarried(5, final, 15);
    s.scorer.rush(5);
    expect(s.scorer.pending(5)).toBe(5);
    expect(s.scorer.progress(5)).toEqual({ done: 0, total: 5 * 160 });
    const done = s.scorer.settled(5, 60_000);
    await hw.drain();
    const scores = await done;
    expect(s.counts.idle).toBe(0); // not one idle slice was ever asked for
    expect(scores.get(6)).toEqual(scoreBoard(boardOf(ref, 6, 20), ref));
    expect(scores.get(12)).toEqual(scoreBoard(final, ref));
    for (const round of [13, 14, 15]) expect(s.scorer.carried(5).get(round)).toBe(scoreBoard(final, ref, round)!.raw);
    expect(s.scorer.progress(5)).toEqual({ done: 800, total: 800 });
    expect(s.scorer.fightsRun()).toBe(800);
    expect(s.scorer.pending(5)).toBe(0);
  }, 60_000);

  it('forgetting a run cancels its jobs in the worker; a late reply changes nothing', async () => {
    const ref = await refP;
    const hw = handlerWorker();
    const s = scorerOver(hw.w);
    s.scorer.enqueue(8, boardOf(ref, 9, 3));
    await new Promise((r) => setTimeout(r, 0)); hw.tick(); await new Promise((r) => setTimeout(r, 0)); hw.tick(); // part done
    s.scorer.forget(8);
    await hw.drain();
    expect(s.client.inFlight()).toBe(0);
    expect(s.scorer.scores(8).size).toBe(0);
    expect(s.scorer.pending(8)).toBe(0);
  }, 30_000);

  it('a worker that dies hands the work back: the page scores every board still out, to the same numbers', async () => {
    const ref = await refP;
    const dead: SimWorkerLike = { postMessage: () => {}, terminate: () => {}, onmessage: null, onerror: null, onmessageerror: null };
    const s = scorerOver(dead);
    const a = boardOf(ref, 5, 3);
    s.scorer.enqueue(3, a);
    expect(s.counts.idle).toBe(0);
    dead.onerror?.(new Error('gone'));
    await new Promise((r) => setTimeout(r, 0));
    expect(s.counts.idle).toBe(1); // back on the idle queue
    expect(s.client.inFlight()).toBe(0);
    s.tickIdle(); await new Promise((r) => setTimeout(r, 0)); // loads the reference
    while (s.tickIdle({ didTimeout: false, timeRemaining: () => 50 })) { /* drain */ }
    expect(s.scorer.scores(3).get(5)).toEqual(scoreBoard(a, ref));
    const idleBefore = s.counts.idle;
    s.scorer.enqueue(3, boardOf(ref, 6, 1)); // and later boards never go to the dead worker
    expect(s.counts.idle).toBe(idleBefore + 1);
    expect(s.client.inFlight()).toBe(0);
  }, 30_000);

  it('the fallback never works in a forced slice while a fight is playing', async () => {
    const ref = await refP;
    const s = scorerOver(null); // no worker at all
    s.scorer.enqueue(4, boardOf(ref, 5, 3));
    s.tickIdle(); await new Promise((r) => setTimeout(r, 0)); // loads the reference
    s.hold(true);
    for (let i = 0; i < 10; i++) expect(s.tickIdle({ didTimeout: true, timeRemaining: () => 0 })).toBe(true);
    expect(s.scorer.fightsRun()).toBe(0); // forced callbacks during the fight ran nothing, and kept asking
    let left = 2;
    s.tickIdle({ didTimeout: false, timeRemaining: () => (left-- > 0 ? 50 : 0) }); // real idle time during the fight is still used
    expect(s.scorer.fightsRun()).toBeGreaterThan(0);
    s.hold(false);
    const before = s.scorer.fightsRun();
    if (s.scorer.pending(4) > 0) { s.tickIdle({ didTimeout: true, timeRemaining: () => 0 }); expect(s.scorer.fightsRun()).toBeGreaterThan(before); } // in the shop a forced slice runs one step
  }, 30_000);
});
