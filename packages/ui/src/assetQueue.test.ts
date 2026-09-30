import { describe, expect, it } from 'vitest';
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
