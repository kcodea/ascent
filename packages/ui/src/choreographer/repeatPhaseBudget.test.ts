import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import type { ConsequenceEvent } from '@game/core';
import { createRun, prepareActionWithPresentation, reduce, type BoardCard, type RunState } from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { createTimelinePlayer } from './livePlayer';
import { EMPTY_PROJECTION, applyConsequenceToProjection, applyConsequencesToProjection } from './projection';
import { REPEAT_PACING, isLongChain, repeatChainCapMs, repeatChainDurationMs, repeatChainSchedule, repeatTickFxIntensity } from './repeatPacing';

/**
 * SEVERAL REPEAT CHAINS SHARE ONE BUDGET (owner report 2026-10-26, R-REPEAT-05):
 *
 *   "kringle was triggering super slowly and causing freezes/massive slow downs"
 *
 * The owner's board held several golden Kringles after an Ale-heavy turn. Every Kringle tick is still its own beat
 * (R-REPEAT-01) and every chain still accelerates (R-REPEAT-04), but each chain used to get the whole 2.5 s cap, so
 * four Kringles played ten seconds of End of Turn, and the live player folded each delivery with a fresh copy of the
 * delivered-id set (quadratic in a long chain). These tests pin the shared budget, the rolling tail a shortened chain
 * keeps, the lighter ribbons of sped-up ticks, and the batched fold.
 */

const FULL = 540 + 170; // the shipped own-beat span (completion 540 + recovery 170)

describe('repeatChainCapMs — long chains split the End of Turn budget', () => {
  it('one long chain keeps the full single-chain cap', () => {
    expect(repeatChainCapMs(0)).toBe(REPEAT_PACING.capMs);
    expect(repeatChainCapMs(1)).toBe(REPEAT_PACING.capMs);
  });
  it('several long chains split the phase budget, never below the per-chain floor', () => {
    expect(repeatChainCapMs(2)).toBe(Math.min(REPEAT_PACING.capMs, REPEAT_PACING.phaseCapMs / 2));
    expect(repeatChainCapMs(4)).toBe(REPEAT_PACING.phaseCapMs / 4);
    expect(repeatChainCapMs(7)).toBe(REPEAT_PACING.minChainCapMs);
  });
  it('a Chronos double is not a long chain (it keeps its full pace)', () => {
    expect(isLongChain(2)).toBe(false);
    expect(isLongChain(REPEAT_PACING.longChainTicks)).toBe(true);
  });
  it('a chain under a shared cap keeps a lead-in AND a rolling tail (never one jump to the end)', () => {
    for (const n of [20, 61, 200]) {
      const cap = repeatChainCapMs(4);
      const s = repeatChainSchedule(n, FULL, REPEAT_PACING, cap);
      expect(s.length).toBe(n);
      expect(repeatChainDurationMs(s)).toBeLessThanOrEqual(cap + 1e-6);
      const slots = s.filter((t) => !t.sharesSlot).length;
      expect(slots, `${n} ticks roll over several slots`).toBeGreaterThanOrEqual(6);
      expect(s[0]!.accent && s[n - 1]!.accent).toBe(true);
    }
  });
  it('the single-chain schedule is unchanged at the default cap', () => {
    const s = repeatChainSchedule(50, FULL);
    expect(s.slice(0, 3).map((t) => Math.round(t.spanMs))).toEqual([FULL, Math.round(FULL * 0.7), Math.round(FULL * 0.45)]);
  });
});

describe('repeatTickFxIntensity — sped-up accents draw lighter ribbons', () => {
  it('a plain beat and the first full-pace tick are as authored; a sped-up tick is thinned', () => {
    expect(repeatTickFxIntensity(undefined)).toBe(1);
    expect(repeatTickFxIntensity({ scale: 1 })).toBe(1);
    expect(repeatTickFxIntensity({ scale: 0.7 })).toBe(REPEAT_PACING.accentFxIntensity);
    expect(REPEAT_PACING.accentFxIntensity).toBeGreaterThan(0);
    expect(REPEAT_PACING.accentFxIntensity).toBeLessThan(1);
  });
});

// ── The live path: four golden Kringles at End of Turn ─────────────────────────────────────────────────────────

const faceOmen = { type: 'faceOmen' } as never;
const body = (uid: string, cardId: string, golden = false): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  const k = golden ? 2 : 1;
  return { uid, cardId, tribe: d.tribe, attack: d.attack * k, health: d.health * k, keywords: [...d.keywords], golden };
};
const kringles = (count: number, played: number): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20, tier: 6, tribes: ['dwarf'],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
    board: [body('l', 'dw_brakka'), ...Array.from({ length: count }, (_, i) => body(`k${i}`, 'dw_foreman', true)), body('r', 'dw_edward')],
    playedThisTurn: Array.from({ length: played }, (_, i) => `x${i}`) } as RunState);

describe('four golden Kringles — every tick lands, the whole End of Turn fits the shared budget', () => {
  it('61 ticks each: 244 beats, every delivery, all chains inside the phase budget, exact final stats', () => {
    const state = kringles(4, 60);
    const prepared = prepareActionWithPresentation(state, faceOmen);
    const timeline = compileTimeline(normalizePresentationBatch(prepared.batch!));
    const cap = repeatChainCapMs(4);
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const mine = timeline.beats.filter((b) => b.source.uid === `k${k}`);
      expect(mine.length, `Kringle ${k}: one beat per tick`).toBe(61);
      const chainMs = Math.max(...mine.map((b) => b.recoveryEndMs)) - Math.min(...mine.map((b) => b.startMs));
      expect(chainMs, `Kringle ${k}: its chain fits its share`).toBeLessThanOrEqual(cap + 1);
      total += chainMs;
    }
    expect(total, 'the four chains together fit the phase budget').toBeLessThanOrEqual(REPEAT_PACING.phaseCapMs + 4);

    const player = createTimelinePlayer(timeline);
    player.advanceTo(timeline.durationMs + 1);
    expect(player.projection().deliveredEventIds.size).toBe(timeline.consequenceDeliveries.length);
    const after = reduce(state, faceOmen);
    for (const uid of ['l', 'r']) {
      const base = state.board.find((c) => c.uid === uid)!;
      const final = after.board.find((c) => c.uid === uid)!;
      const d = player.projection().boardStats.get(uid)!;
      expect({ attack: base.attack + d.attack, health: base.health + d.health }, `${uid} lands on the exact final value`)
        .toEqual({ attack: final.attack, health: final.health });
    }
    // Presentation only: the prepared commit is byte-identical to a plain reduce.
    expect(JSON.stringify(prepared.after)).toBe(JSON.stringify(after));
  });

  it('a lone Kringle keeps the full single-chain pace', () => {
    const timeline = compileTimeline(normalizePresentationBatch(prepareActionWithPresentation(kringles(1, 60), faceOmen).batch!));
    const mine = timeline.beats.filter((b) => b.source.uid === 'k0');
    const chainMs = Math.max(...mine.map((b) => b.recoveryEndMs)) - Math.min(...mine.map((b) => b.startMs));
    expect(chainMs).toBeGreaterThan(repeatChainCapMs(4));
    expect(chainMs).toBeLessThanOrEqual(REPEAT_PACING.capMs + 1);
  });
});

describe('the projection folds a batch once (no per-delivery copy of the delivered set)', () => {
  const stat = (id: string, uid: string, attack: number, health: number): ConsequenceEvent =>
    ({ id, type: 'statsChanged', target: { uid, zone: 'board' }, attack, health } as unknown as ConsequenceEvent);

  it('a batch fold equals folding one at a time, duplicates included, and never mutates its input', () => {
    const cs = [stat('a', 'x', 1, 2), stat('b', 'y', 3, 4), stat('a', 'x', 1, 2), stat('c', 'x', 5, 6)];
    let one = EMPTY_PROJECTION;
    for (const c of cs) one = applyConsequenceToProjection(one, c);
    const batch = applyConsequencesToProjection(EMPTY_PROJECTION, cs);
    expect([...batch.deliveredEventIds]).toEqual([...one.deliveredEventIds]);
    expect([...batch.boardStats]).toEqual([...one.boardStats]);
    expect(EMPTY_PROJECTION.deliveredEventIds.size).toBe(0);
    expect(EMPTY_PROJECTION.boardStats.size).toBe(0);
  });

  it('eight thousand deliveries fold in linear time (an algorithmic tripwire, not a benchmark)', () => {
    const cs = Array.from({ length: 8000 }, (_, i) => stat(`e${i}`, i % 2 ? 'l' : 'r', 1, 2));
    const t0 = performance.now();
    const p = applyConsequencesToProjection(EMPTY_PROJECTION, cs);
    const ms = performance.now() - t0;
    expect(p.deliveredEventIds.size).toBe(8000);
    expect(p.boardStats.get('l')).toEqual({ attack: 4000, health: 8000 });
    expect(ms, 'the old per-delivery copy took seconds here').toBeLessThan(400);
  });
});
