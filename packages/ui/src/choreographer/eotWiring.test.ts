import { describe, it, expect, vi } from 'vitest';
import { createRun, reduce, prepareActionWithPresentation, type RunState } from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { createTimelinePlayer } from './livePlayer';

/**
 * BEAT CHOREOGRAPHER PR 4 — the End-of-Turn wiring, end to end (blueprint §22.3–§22.4).
 *
 * `Recruit.tsx` composes four things: prepare → compile → play → commit. React rendering aside, that
 * composition IS the feature, and it is what could silently be wrong. This test runs the exact sequence
 * against real gameplay and asserts the properties the owner actually cares about:
 *
 *   - the run you continue into is the same one a plain dispatch would have produced;
 *   - gameplay resolves ONCE (no second `faceOmen`);
 *   - nothing is visible before its beat, and everything is visible at the end;
 *   - a skip mid-animation lands the identical state (so it can never softlock or diverge).
 */
const faceOmen = { type: 'faceOmen' } as never;

/** A recruit state with real End-of-Turn content: a board minion, plus the economy + Lapidary runes. */
function eotRun(seed = 3): RunState {
  const run = createRun(seed, 'warden');
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

/** Exactly what `playEndOfTurnAuthoritative` does, minus the React state setters. */
function playEndOfTurn(before: RunState, opts: { skipAfterMs?: number } = {}) {
  const prepared = prepareActionWithPresentation(before, faceOmen);
  const timeline = compileTimeline(normalizePresentationBatch(prepared.batch!));
  const committed: RunState[] = [];
  const activations: string[] = [];
  const player = createTimelinePlayer(timeline, {
    onBeatActivate: (b) => activations.push(b.id),
    onComplete: () => committed.push(prepared.after), // the store's commitPresentationAction
  });
  if (opts.skipAfterMs !== undefined) {
    player.advanceTo(opts.skipAfterMs);
    player.finish();
  } else {
    for (let t = 0; t <= timeline.durationMs + 16; t += 16) player.advanceTo(t);
  }
  return { prepared, timeline, player, committed, activations };
}

describe('the authoritative End-of-Turn path', () => {
  it('commits exactly the run a plain dispatch would have produced', () => {
    const before = eotRun();
    const expected = reduce(before, faceOmen);
    const { committed } = playEndOfTurn(before);
    expect(committed).toHaveLength(1);
    expect(JSON.stringify(committed[0])).toBe(JSON.stringify(expected));
  });

  it('resolves gameplay ONCE — the reducer is not run again by playback', () => {
    const before = eotRun();
    // Any second resolution would advance the wave twice / re-simulate; comparing to a single reduce catches it.
    const { prepared, committed } = playEndOfTurn(before);
    expect(committed[0]).toBe(prepared.after);
    expect(committed[0].wave).toBe(reduce(before, faceOmen).wave);
  });

  it('emits beats and delivers every consequence by the end', () => {
    const { timeline, player } = playEndOfTurn(eotRun());
    expect(timeline.beats.length).toBeGreaterThan(0);
    expect(player.projection().deliveredEventIds.size).toBe(timeline.consequenceDeliveries.length);
  });

  it('shows nothing before the first beat has started', () => {
    const before = eotRun();
    const prepared = prepareActionWithPresentation(before, faceOmen);
    const timeline = compileTimeline(normalizePresentationBatch(prepared.batch!));
    const player = createTimelinePlayer(timeline);
    player.advanceTo(0);
    expect(player.projection().deliveredEventIds.size).toBe(0);
  });

  it('commits exactly once even if playback is advanced past the end repeatedly', () => {
    const before = eotRun();
    const prepared = prepareActionWithPresentation(before, faceOmen);
    const timeline = compileTimeline(normalizePresentationBatch(prepared.batch!));
    const onComplete = vi.fn();
    const player = createTimelinePlayer(timeline, { onComplete });
    player.advanceTo(timeline.durationMs);
    player.advanceTo(timeline.durationMs * 2);
    player.finish();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('SKIPPING mid-animation commits the identical run (never a softlock, never a divergence)', () => {
    const before = eotRun();
    const expected = reduce(before, faceOmen);
    const { committed, player, timeline } = playEndOfTurn(before, { skipAfterMs: 50 });
    expect(committed).toHaveLength(1);
    expect(JSON.stringify(committed[0])).toBe(JSON.stringify(expected));
    // …and the visuals caught up rather than being lost.
    expect(player.projection().deliveredEventIds.size).toBe(timeline.consequenceDeliveries.length);
  });

  it('holds across several seeds', () => {
    for (const seed of [1, 7, 4242]) {
      const before = eotRun(seed);
      const { committed } = playEndOfTurn(before);
      expect(JSON.stringify(committed[0]), `seed ${seed}`).toBe(JSON.stringify(reduce(before, faceOmen)));
    }
  });

  it('a turn with NO End-of-Turn emission is detectable, so the caller can fall back', () => {
    // The empty-board case Recruit hands back to the legacy path rather than committing silently.
    const bare = { ...createRun(9, 'warden'), phase: 'recruit', board: [] } as RunState;
    const prepared = prepareActionWithPresentation(bare, faceOmen);
    const hasBeats = prepared.batch
      ? compileTimeline(normalizePresentationBatch(prepared.batch)).beats.length
      : 0;
    expect(hasBeats).toBe(0);
  });
});
