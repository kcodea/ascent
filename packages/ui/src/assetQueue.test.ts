import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssetQueue, type Lane } from './assetQueue';

/**
 * The asset queue's contract (art pop-in fix 2026-09-29): strict lane order, a hard concurrency cap, one fetch per
 * key, raise-never-demote, and readiness that settles on failure too. The image and audio flavours ride on this,
 * so it is tested with a controllable fake loader instead of a DOM.
 */

/** A task per key that resolves (or rejects) only when the test says so. */
function harness(concurrency = 2) {
  const q = createAssetQueue(concurrency, { trackStarted: true });
  const pending = new Map<string, { resolve: () => void; reject: () => void }>();
  const calls: string[] = [];
  const req = (key: string, lane: Lane): void => q.request(key, lane, () => {
    calls.push(key);
    return new Promise<void>((resolve, reject) => { pending.set(key, { resolve, reject }); });
  });
  const finish = async (key: string, ok = true): Promise<void> => {
    const p = pending.get(key);
    if (!p) throw new Error(`${key} is not in flight`);
    pending.delete(key);
    if (ok) p.resolve(); else p.reject();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { q, req, finish, calls, inFlight: () => [...pending.keys()] };
}

describe('asset queue', () => {
  it('never runs more than `concurrency` tasks at once', async () => {
    const h = harness(2);
    for (const k of ['a', 'b', 'c', 'd', 'e']) h.req(k, 'set');
    expect(h.inFlight()).toEqual(['a', 'b']);
    await h.finish('a');
    expect(h.inFlight()).toEqual(['b', 'c']);
    await h.finish('b');
    await h.finish('c');
    expect(h.inFlight()).toEqual(['d', 'e']);
    expect(h.q.stats().inFlight).toBe(2);
  });

  it('setConcurrency widens the pipe at once and narrows it without cancelling in-flight work (the boot gate)', async () => {
    const h = harness(2);
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) h.req(k, 'set');
    h.q.setConcurrency(4);
    expect(h.inFlight()).toEqual(['a', 'b', 'c', 'd']);
    h.q.setConcurrency(1);
    expect(h.inFlight()).toEqual(['a', 'b', 'c', 'd']); // nothing cancelled
    await h.finish('a');
    await h.finish('b');
    await h.finish('c');
    expect(h.inFlight()).toEqual(['d']); // no new start until under the new cap
    await h.finish('d');
    expect(h.inFlight()).toEqual(['e']);
  });

  it('drains lanes strictly in priority order, FIFO within a lane', async () => {
    const h = harness(1);
    h.req('blocker', 'idle'); // occupies the one slot
    h.req('idle-1', 'idle');
    h.req('set-1', 'set');
    h.req('audio-1', 'audio');
    h.req('chrome-1', 'chrome');
    h.req('early-1', 'early');
    h.req('chrome-2', 'chrome');
    h.req('now-1', 'now');
    for (const k of ['blocker', 'now-1', 'chrome-1', 'chrome-2', 'early-1', 'set-1', 'audio-1', 'idle-1']) {
      expect(h.inFlight()).toEqual([k]);
      await h.finish(k);
    }
    expect(h.q.stats().started).toEqual(['blocker', 'now-1', 'chrome-1', 'chrome-2', 'early-1', 'set-1', 'audio-1', 'idle-1']);
  });

  it('fetches a key once — a repeat request (any lane) never runs the task again', async () => {
    const h = harness(4);
    h.req('card', 'set');
    h.req('card', 'now');
    h.req('card', 'idle');
    expect(h.calls).toEqual(['card']);
    await h.finish('card');
    h.req('card', 'now');
    expect(h.calls).toEqual(['card']);
    expect(h.q.ready('card')).toBe(true);
  });

  it('raises a queued key to a more urgent lane (the card that just appeared in the shop jumps the queue)', async () => {
    const h = harness(1);
    h.req('blocker', 'set');
    h.req('rest-1', 'set');
    h.req('rest-2', 'set');
    h.req('shop-card', 'idle');
    h.req('shop-card', 'now'); // it rendered
    await h.finish('blocker');
    expect(h.inFlight()).toEqual(['shop-card']);
  });

  it('never demotes: a later, less urgent request leaves the key where it was', async () => {
    const h = harness(1);
    h.req('blocker', 'set');
    h.req('other', 'early');
    h.req('hero', 'now');
    h.req('hero', 'idle');
    await h.finish('blocker');
    expect(h.inFlight()).toEqual(['hero']);
  });

  it('a failed task still settles — a broken file must never keep a card hidden', async () => {
    const h = harness(1);
    let told = 0;
    h.req('broken', 'now');
    h.q.subscribe('broken', () => { told++; });
    await h.finish('broken', false);
    expect(h.q.ready('broken')).toBe(true);
    expect(told).toBe(1);
  });

  it('subscribers hear once, when the key flips; a subscribe after ready fires asynchronously', async () => {
    const h = harness(1);
    const heard: string[] = [];
    h.req('x', 'now');
    h.q.subscribe('x', () => heard.push('first'));
    const off = h.q.subscribe('x', () => heard.push('unsubscribed'));
    off();
    await h.finish('x');
    expect(heard).toEqual(['first']);
    h.q.subscribe('x', () => heard.push('late'));
    expect(heard).toEqual(['first']);
    await Promise.resolve();
    expect(heard).toEqual(['first', 'late']);
  });

  it('resolve() marks a key ready from outside (an on-screen <img> won the race) and drops its queued copy', async () => {
    const h = harness(1);
    h.req('blocker', 'set');
    h.req('art', 'set');
    h.q.resolve('art');
    expect(h.q.ready('art')).toBe(true);
    await h.finish('blocker');
    expect(h.calls).toEqual(['blocker']); // never fetched again
    expect(h.q.stats().queued).toBe(0);
  });
});

/** A retrying queue whose tasks the test settles by hand; fake timers drive the backoff. */
function retryHarness(delays: readonly number[] = [1000, 3000, 8000], concurrency = 1) {
  const gaveUp: [string, number][] = [];
  const q = createAssetQueue(concurrency, { trackStarted: true, onGiveUp: (k, n) => gaveUp.push([k, n]) });
  const pending = new Map<string, { resolve: () => void; reject: () => void }>();
  const attempts: { key: string; attempt: number; last: boolean }[] = [];
  const task = (key: string) => (_lane: Lane, a: { attempt: number; last: boolean }) => {
    attempts.push({ key, ...a });
    return new Promise<void>((resolve, reject) => { pending.set(key, { resolve, reject }); });
  };
  const req = (key: string, lane: Lane = 'now'): void => q.request(key, lane, task(key), { retryDelays: delays });
  const finish = async (key: string, ok: boolean): Promise<void> => {
    const p = pending.get(key);
    if (!p) throw new Error(`${key} is not in flight`);
    pending.delete(key);
    if (ok) p.resolve(); else p.reject();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { q, req, finish, attempts, gaveUp, task, inFlight: () => [...pending.keys()] };
}

describe('asset queue: failed loads retry (owner report 2026-09-30, a round-12 shop of blank ovals)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a failed task retries after its backoff and succeeds on a later attempt; it is never ready in between', async () => {
    vi.useFakeTimers();
    const h = retryHarness();
    h.req('art');
    await h.finish('art', false);
    expect(h.q.ready('art')).toBe(false);
    expect(h.q.settled('art')).toBe(false);
    expect(h.q.stats().backingOff).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(h.inFlight()).toEqual([]); // still waiting out the 1 s backoff
    await vi.advanceTimersByTimeAsync(1);
    expect(h.inFlight()).toEqual(['art']);
    await h.finish('art', false);
    await vi.advanceTimersByTimeAsync(2999);
    expect(h.inFlight()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); // the 3 s backoff
    await h.finish('art', true);
    expect(h.q.ready('art')).toBe(true);
    expect(h.attempts.map((a) => a.attempt)).toEqual([0, 1, 2]);
    expect(h.attempts.every((a) => !a.last)).toBe(true);
  });

  it('a key backing off holds no slot: the pipe keeps serving everything else, and the retry re-enters its lane', async () => {
    vi.useFakeTimers();
    const h = retryHarness();
    h.req('flaky');
    h.req('next', 'set');
    await h.finish('flaky', false);
    expect(h.inFlight()).toEqual(['next']); // the one slot went straight to the next key
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.inFlight()).toEqual(['next']); // the retry queues behind the cap, never over it
    expect(h.q.stats().queued).toBe(1);
    await h.finish('next', true);
    expect(h.inFlight()).toEqual(['flaky']);
  });

  it('respects the cap: 1 try + one per delay, the last flagged `last`, then FAILED (settled, never ready)', async () => {
    vi.useFakeTimers();
    const h = retryHarness();
    let heard = 0;
    h.req('gone');
    h.q.subscribe('gone', () => { heard++; });
    for (const wait of [1000, 3000, 8000]) {
      await h.finish('gone', false);
      await vi.advanceTimersByTimeAsync(wait);
    }
    await h.finish('gone', false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.attempts.map((a) => [a.attempt, a.last])).toEqual([[0, false], [1, false], [2, false], [3, true]]);
    expect(h.inFlight()).toEqual([]);
    expect(h.q.failed('gone')).toBe(true);
    expect(h.q.settled('gone')).toBe(true);
    expect(h.q.ready('gone')).toBe(false);
    expect(h.gaveUp).toEqual([['gone', 4]]);
    expect(heard).toBe(1);
    h.req('gone', 'now'); // a later render asking again does not restart it
    expect(h.inFlight()).toEqual([]);
  });

  it('retryFailed (the network came back) re-queues every failed key with fresh attempts, and cuts a backoff short', async () => {
    vi.useFakeTimers();
    const h = retryHarness([1000], 2);
    h.req('a');
    h.req('b');
    await h.finish('a', false);
    await vi.advanceTimersByTimeAsync(1000);
    await h.finish('a', false); // a: failed for good
    await h.finish('b', false); // b: backing off
    expect(h.q.failed('a')).toBe(true);
    expect(h.q.stats().backingOff).toBe(1);
    expect(h.q.retryFailed()).toBe(2);
    expect(h.inFlight().sort()).toEqual(['a', 'b']);
    expect(h.q.failed('a')).toBe(false);
    await h.finish('a', true);
    await h.finish('b', true);
    expect(h.q.ready('a') && h.q.ready('b')).toBe(true);
    expect(h.attempts.filter((x) => x.key === 'a').map((x) => x.attempt)).toEqual([0, 1, 0]);
  });

  it('fail() from outside (an on-screen <img> errored) re-fetches a READY key through the pipe, and subscribers hear both flips', async () => {
    vi.useFakeTimers();
    const h = retryHarness();
    const heard: boolean[] = [];
    h.req('card');
    h.q.subscribe('card', () => heard.push(h.q.ready('card')));
    await h.finish('card', true);
    h.q.fail('card');
    expect(h.q.ready('card')).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.inFlight()).toEqual(['card']);
    await h.finish('card', true);
    expect(heard).toEqual([true, false, true]);
    // A key the queue never ran (marked ready from outside) can be failed with a task to run.
    h.q.resolve('outside');
    h.q.fail('outside', h.task('outside'), { retryDelays: [500] });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.inFlight()).toEqual(['outside']);
  });

  it('without a retry policy a failure still settles as ready (the audio bank is unchanged)', async () => {
    const h = harness(1);
    h.req('sfx', 'audio');
    await h.finish('sfx', false);
    expect(h.q.ready('sfx')).toBe(true);
    expect(h.q.stats().retries).toBe(0);
  });
});
