import { describe, it, expect, vi } from 'vitest';
import { createRun, prepareActionWithPresentation, type RunState } from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { createTimelinePlayer, runTimeline } from './livePlayer';
import { EMPTY_PROJECTION, applyConsequenceToProjection, finalProjection, projectionAt, projectedResource } from './projection';
import type { ConsequenceEvent } from '@game/core';

/**
 * BEAT CHOREOGRAPHER PR 4 — projection + player (blueprint §22.4, §12).
 *
 * The behaviours these lock down are exactly the ones the old End-of-Turn animation could not guarantee:
 *   - a value is NOT visible before its delivery marker (the "stats granted the moment End Turn is hit" bug);
 *   - no consequence is dropped when frames are skipped;
 *   - skipping produces the same result as watching;
 *   - seeking backward rebuilds cleanly rather than leaving a half-applied state.
 */
const faceOmen = { type: 'faceOmen' } as never;

function eotRun(): RunState {
  const run = createRun(3, 'warden');
  return {
    ...run,
    phase: 'recruit',
    board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    runeCoffers: true,
    runeShopkeep: true,
    runeLapidary: true,
    upgradeCost: 9,
    playedThisTurn: ['a', 'b', 'c'],
  } as RunState;
}

const realTimeline = () => {
  const prepared = prepareActionWithPresentation(eotRun(), faceOmen);
  return compileTimeline(normalizePresentationBatch(prepared.batch!));
};

const cons = (id: string, over: Partial<ConsequenceEvent> = {}): ConsequenceEvent =>
  ({ type: 'statsChanged', id, sequence: 0, step: 1, target: { zone: 'board', uid: 'u1' }, attack: 1, health: 1, permanent: true, ...over }) as ConsequenceEvent;

describe('projection is a pure fold of visual deltas', () => {
  it('accumulates stat deltas per uid', () => {
    let p = applyConsequenceToProjection(EMPTY_PROJECTION, cons('a'));
    p = applyConsequenceToProjection(p, cons('b'));
    expect(p.boardStats.get('u1')).toEqual({ attack: 2, health: 2 });
  });

  it('is idempotent — re-delivering the same event changes nothing', () => {
    const once = applyConsequenceToProjection(EMPTY_PROJECTION, cons('a'));
    const twice = applyConsequenceToProjection(once, cons('a'));
    expect(twice.boardStats.get('u1')).toEqual({ attack: 1, health: 1 });
    expect(twice).toBe(once);
  });

  it('never mutates the projection it was given', () => {
    const before = applyConsequenceToProjection(EMPTY_PROJECTION, cons('a'));
    const snapshot = JSON.stringify([...before.boardStats]);
    applyConsequenceToProjection(before, cons('b'));
    expect(JSON.stringify([...before.boardStats])).toBe(snapshot);
  });

  it('routes by zone — hand, shop and board never cross-contaminate', () => {
    let p = applyConsequenceToProjection(EMPTY_PROJECTION, cons('a', { target: { zone: 'hand', uid: 'h1' } } as never));
    p = applyConsequenceToProjection(p, cons('b', { target: { zone: 'shop', uid: 's1' } } as never));
    expect(p.handStats.get('h1')).toEqual({ attack: 1, health: 1 });
    expect(p.shopStats.get('s1')).toEqual({ attack: 1, health: 1 });
    expect(p.boardStats.size).toBe(0);
  });

  it('tracks resources as deltas against the pre-action value', () => {
    const p = applyConsequenceToProjection(EMPTY_PROJECTION, { type: 'resourceChanged', id: 'r', sequence: 0, step: 1, resource: 'maxGold', amount: 1 } as ConsequenceEvent);
    expect(projectedResource(p, 'maxGold', 10)).toBe(11);
  });

  it('an unknown consequence type is a no-op, never a crash', () => {
    const p = applyConsequenceToProjection(EMPTY_PROJECTION, { type: 'somethingNew', id: 'x', sequence: 0, step: 1 } as unknown as ConsequenceEvent);
    expect(p.deliveredEventIds.has('x')).toBe(true);
  });
});

describe('the player withholds values until their delivery marker', () => {
  it('nothing is visible at time 0 — the bug where stats landed the instant End Turn was pressed', () => {
    const timeline = realTimeline();
    const player = createTimelinePlayer(timeline);
    player.advanceTo(0);
    const p = player.projection();
    expect(p.deliveredEventIds.size).toBe(0);
    expect(p.boardStats.size + p.resources.size + p.rubies.size).toBe(0);
  });

  it('a consequence appears only once the playhead passes its marker', () => {
    const timeline = realTimeline();
    const first = timeline.consequenceDeliveries[0];
    expect(first, 'the real batch produced a delivery').toBeTruthy();
    const player = createTimelinePlayer(timeline);
    player.advanceTo(first.atMs - 1);
    expect(player.projection().deliveredEventIds.has(first.consequence.id)).toBe(false);
    player.advanceTo(first.atMs);
    expect(player.projection().deliveredEventIds.has(first.consequence.id)).toBe(true);
  });

  it('every delivery happens strictly after its beat has activated', () => {
    const timeline = realTimeline();
    const order: string[] = [];
    const player = createTimelinePlayer(timeline, {
      onBeatActivate: (b) => order.push(`beat:${b.id}`),
      onConsequence: (d) => order.push(`cons:${d.beatId}`),
    });
    player.finish();
    const activatedAt = new Map<string, number>();
    order.forEach((entry, i) => {
      if (entry.startsWith('beat:')) activatedAt.set(entry.slice(5), i);
    });
    for (const [i, entry] of order.entries()) {
      if (!entry.startsWith('cons:')) continue;
      const beatId = entry.slice(5);
      expect(activatedAt.get(beatId), `${beatId} delivered before it activated`).toBeLessThan(i);
    }
  });
});

describe('no consequence is dropped when frames are skipped', () => {
  it('a single huge jump delivers everything in the window', () => {
    const timeline = realTimeline();
    const seen: string[] = [];
    const player = createTimelinePlayer(timeline, { onConsequence: (d) => seen.push(d.id) });
    player.advanceTo(timeline.durationMs + 1); // one frame covering the entire phase
    expect(seen.length).toBe(timeline.consequenceDeliveries.length);
  });

  it('frame-by-frame and one-big-jump reach an identical projection', () => {
    const timeline = realTimeline();
    const stepped = createTimelinePlayer(timeline);
    for (let t = 0; t <= timeline.durationMs + 16; t += 16) stepped.advanceTo(t);
    const jumped = createTimelinePlayer(timeline);
    jumped.advanceTo(timeline.durationMs + 16);
    expect([...stepped.projection().deliveredEventIds].sort()).toEqual([...jumped.projection().deliveredEventIds].sort());
  });

  it('a stalled tab (a 5-second gap) still delivers everything exactly once', () => {
    const timeline = realTimeline();
    const seen: string[] = [];
    const player = createTimelinePlayer(timeline, { onConsequence: (d) => seen.push(d.id) });
    player.advanceTo(1);
    player.advanceTo(5000);
    expect(new Set(seen).size).toBe(seen.length); // no duplicates
    expect(seen.length).toBe(timeline.consequenceDeliveries.length);
  });
});

describe('skip, seek and completion', () => {
  it('skipping delivers the same projection as watching in full', () => {
    const timeline = realTimeline();
    const watched = createTimelinePlayer(timeline);
    for (let t = 0; t <= timeline.durationMs + 16; t += 16) watched.advanceTo(t);
    const skipped = createTimelinePlayer(timeline);
    skipped.finish();
    expect([...skipped.projection().deliveredEventIds].sort()).toEqual([...watched.projection().deliveredEventIds].sort());
    expect([...skipped.projection().boardStats]).toEqual([...watched.projection().boardStats]);
  });

  it('onComplete fires exactly once, even across finish() then advanceTo()', () => {
    const onComplete = vi.fn();
    const player = createTimelinePlayer(realTimeline(), { onComplete });
    player.finish();
    player.finish();
    player.advanceTo(99999);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('seeking backward rebuilds rather than leaving a half-applied state', () => {
    const timeline = realTimeline();
    const player = createTimelinePlayer(timeline);
    player.advanceTo(timeline.durationMs);
    player.seek(0);
    expect(player.projection().deliveredEventIds.size).toBe(0);
    player.advanceTo(timeline.durationMs);
    expect([...player.projection().deliveredEventIds].sort())
      .toEqual([...finalProjection(timeline).deliveredEventIds].sort());
  });

  it('projectionAt is a pure function of time', () => {
    const timeline = realTimeline();
    const mid = Math.floor(timeline.durationMs / 2);
    expect(JSON.stringify([...projectionAt(timeline, mid).deliveredEventIds]))
      .toBe(JSON.stringify([...projectionAt(timeline, mid).deliveredEventIds]));
  });
});

describe('runTimeline drives the player and cleans up', () => {
  it('advances with an injected clock and completes', () => {
    const timeline = realTimeline();
    const onComplete = vi.fn();
    const player = createTimelinePlayer(timeline, { onComplete });
    let t = 0;
    const queue: (() => void)[] = [];
    const cancel = runTimeline(player, { now: () => t, raf: (cb) => { queue.push(cb); return queue.length; }, cancel: () => {} });
    for (let i = 0; i < 200 && queue.length; i++) {
      t += 100;
      queue.shift()!();
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
    cancel();
  });

  it('speed scales pacing without changing WHAT is delivered', () => {
    const timeline = realTimeline();
    const run = (speed: number) => {
      const player = createTimelinePlayer(timeline);
      let t = 0;
      const queue: (() => void)[] = [];
      runTimeline(player, { speed, now: () => t, raf: (cb) => { queue.push(cb); return 1; }, cancel: () => {} });
      for (let i = 0; i < 500 && queue.length; i++) { t += 16; queue.shift()!(); }
      return [...player.projection().deliveredEventIds].sort();
    };
    expect(run(4)).toEqual(run(1));
  });

  it('cancelling stops the loop (no orphaned rAF holding a prepared transaction)', () => {
    const player = createTimelinePlayer(realTimeline());
    let t = 0;
    const queue: (() => void)[] = [];
    const cancel = runTimeline(player, { now: () => t, raf: (cb) => { queue.push(cb); return 1; }, cancel: () => {} });
    cancel();
    const before = queue.length;
    t += 100;
    queue.shift()?.();
    expect(queue.length).toBeLessThanOrEqual(before); // the cancelled tick queued nothing new
    expect(player.isComplete()).toBe(false);
  });
});

describe('Rubies move the numbers, not just the gems (live-playtest regression 2026-08-13)', () => {
  // Found by playing it: the board sat at its BASE stats for the whole animation and then snapped at commit.
  // `rubyPlayed` was tracked as a count only, so the Lapidary's cascade played over frozen numbers — the
  // "stats appear all at once at the end" symptom, in the one place the projection could not see the gain.
  it('a rubyPlayed consequence applies its stat delta to the board', () => {
    const p = applyConsequenceToProjection(EMPTY_PROJECTION, {
      type: 'rubyPlayed', id: 'r', sequence: 0, step: 1,
      target: { zone: 'board', uid: 'u1' }, count: 2, attack: 2, health: 2,
    } as ConsequenceEvent);
    expect(p.rubies.get('u1')).toBe(2);
    expect(p.boardStats.get('u1')).toEqual({ attack: 2, health: 2 });
  });

  it('a Ruby with a run-wide bonus carries the FULL delta — the UI never re-derives rubyBonus', () => {
    const p = applyConsequenceToProjection(EMPTY_PROJECTION, {
      type: 'rubyPlayed', id: 'r', sequence: 0, step: 1,
      target: { zone: 'board', uid: 'u1' }, count: 1, attack: 3, health: 3, // 1 Ruby × (1 + bonus 2)
    } as ConsequenceEvent);
    expect(p.boardStats.get('u1')).toEqual({ attack: 3, health: 3 });
  });

  it('an old event with no delta still records the count without inventing stats', () => {
    const p = applyConsequenceToProjection(EMPTY_PROJECTION, {
      type: 'rubyPlayed', id: 'r', sequence: 0, step: 1, target: { zone: 'board', uid: 'u1' }, count: 1,
    } as ConsequenceEvent);
    expect(p.rubies.get('u1')).toBe(1);
    expect(p.boardStats.size).toBe(0);
  });

  it('a real Lapidary turn shows the board CHANGING mid-timeline, not only at the end', () => {
    const timeline = realTimeline();
    const player = createTimelinePlayer(timeline);
    player.advanceTo(0);
    const atStart = JSON.stringify([...player.projection().boardStats]);
    player.advanceTo(timeline.durationMs);
    const atEnd = JSON.stringify([...player.projection().boardStats]);
    expect(atStart).toBe('[]');
    expect(atEnd).not.toBe('[]'); // the fixture's Lapidary rubies reach the board through the projection
  });
});
