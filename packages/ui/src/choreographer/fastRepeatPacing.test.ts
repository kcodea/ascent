import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, prepareActionWithPresentation, reduce, type BoardCard, type RunState } from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { createTimelinePlayer } from './livePlayer';
import { REPEAT_PACING, repeatChainDurationMs, repeatChainSchedule } from './repeatPacing';

/**
 * FAST REPEATS (owner 2026-09-27, R-REPEAT-04):
 *
 *   "kringle and other end of turn effects that REPEAT, need to go extremely fast, this is going to take me
 *   minutes to finish."
 *
 * Every repeat keeps its own tick and beat (R-REPEAT-01), but the chain ACCELERATES: a near-normal lead-in, a
 * geometric speed-up to a floor, then several ticks per slot, all under a hard cap. These tests pin the cap for
 * N = 5, 50 and 200, that every tick is still emitted and delivered, and that the stats land on the exact final
 * values.
 */

const FULL = 540 + 170; // the shipped own-beat span (completion 540 + recovery 170)

describe('repeatChainSchedule — the pure pacing curve', () => {
  it('a plain effect (one tick) is untouched', () => {
    expect(repeatChainSchedule(1, FULL)).toEqual([{ spanMs: FULL, sharesSlot: false, accent: true }]);
  });

  it('a Chronos double (two ticks) keeps both at full pace', () => {
    expect(repeatChainSchedule(2, FULL).map((t) => t.spanMs)).toEqual([FULL, FULL]);
  });

  for (const n of [5, 50, 200, 1000]) {
    it(`${n} ticks: one entry per tick, the whole chain under the ${REPEAT_PACING.capMs} ms cap`, () => {
      const s = repeatChainSchedule(n, FULL);
      expect(s.length).toBe(n);
      expect(repeatChainDurationMs(s)).toBeLessThanOrEqual(REPEAT_PACING.capMs);
      // The lead-in reads: the first three ticks are near-normal, never batched, always accented.
      expect(s.slice(0, 3).map((t) => Math.round(t.spanMs))).toEqual([FULL, Math.round(FULL * 0.7), Math.round(FULL * 0.45)]);
      expect(s.slice(0, 3).every((t) => t.accent && !t.sharesSlot)).toBe(true);
      // The final tick settles and is accented.
      expect(s[n - 1]!.accent).toBe(true);
      expect(s[n - 1]!.sharesSlot).toBe(false);
      expect(s[n - 1]!.spanMs).toBeGreaterThanOrEqual(REPEAT_PACING.settleMs);
      // Past the lead-in the ticks never slow down again (slot starts only).
      const slots = s.filter((t) => !t.sharesSlot).slice(3, -1).map((t) => t.spanMs);
      for (let i = 1; i < slots.length; i++) expect(slots[i]!).toBeLessThanOrEqual(slots[i - 1]! + 1e-9);
      // Accents (FX + sound) are spaced at least `accentGapMs` apart past the lead-in.
      let at = 0;
      const accentAt: number[] = [];
      for (const t of s) { if (!t.sharesSlot) { if (t.accent) accentAt.push(at); at += t.spanMs; } }
      for (let i = 3; i < accentAt.length - 1; i++) expect(accentAt[i]! - accentAt[i - 1]!).toBeGreaterThanOrEqual(REPEAT_PACING.accentGapMs);
    });
  }

  it('batches several ticks per slot once the count outruns the cap', () => {
    const s = repeatChainSchedule(200, FULL);
    expect(s.some((t) => t.sharesSlot)).toBe(true);
    expect(s.filter((t) => !t.sharesSlot).length, 'far fewer visual slots than ticks').toBeLessThan(40);
  });
});

// ── The live path: Kringle's End of Turn, compiled and played ─────────────────────────────────────────────────

const faceOmen = { type: 'faceOmen' } as never;
const body = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const kringle = (played: number): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20, tier: 6, tribes: ['dwarf'],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
    board: [body('l', 'dw_brakka'), body('k', 'dw_foreman'), body('r', 'dw_edward')],
    playedThisTurn: Array.from({ length: played }, (_, i) => `x${i}`) } as RunState);

describe('Kringle End of Turn — every tick emitted, the chain capped', () => {
  for (const played of [4, 49, 199]) {
    const ticks = played + 1;
    it(`${ticks} ticks: ${ticks} beats, every delivery lands, chain ≤ cap, exact final stats`, () => {
      const state = kringle(played);
      const prepared = prepareActionWithPresentation(state, faceOmen);
      const timeline = compileTimeline(normalizePresentationBatch(prepared.batch!));
      const mine = timeline.beats.filter((b) => b.source.uid === 'k');
      expect(mine.length, 'one beat per tick, never lumped').toBe(ticks);
      expect(mine.every((b) => b.pace), 'every tick is paced').toBe(true);
      expect(mine.map((b) => b.repeat!.index), 'tick order preserved').toEqual(Array.from({ length: ticks }, (_, i) => i));
      const chainMs = Math.max(...mine.map((b) => b.recoveryEndMs)) - Math.min(...mine.map((b) => b.startMs));
      expect(chainMs, 'the whole repeat chain is capped').toBeLessThanOrEqual(REPEAT_PACING.capMs + 1);
      // Every tick owns its own deliveries (two ends per tick).
      const perBeat = new Map<string, number>();
      for (const d of timeline.consequenceDeliveries) perBeat.set(d.beatId, (perBeat.get(d.beatId) ?? 0) + 1);
      for (const b of mine) expect(perBeat.get(b.id) ?? 0, `tick ${b.repeat!.index} delivers`).toBeGreaterThanOrEqual(2);

      // Stats roll tick by tick (real time): after the first tick lands, the ends carry exactly one grant.
      const player = createTimelinePlayer(timeline);
      const first = mine[0]!;
      player.advanceTo(first.deliveryMs + 2 * first.config.targetStaggerMs + 1);
      expect(player.projection().boardStats.get('l')).toEqual({ attack: 1, health: 2 });
      // …and at the end the projection is the committed truth, exactly.
      player.advanceTo(timeline.durationMs + 1);
      expect(player.projection().deliveredEventIds.size).toBe(timeline.consequenceDeliveries.length);
      const after = reduce(state, faceOmen);
      const base = (uid: string) => state.board.find((c) => c.uid === uid)!;
      const final = (uid: string) => after.board.find((c) => c.uid === uid)!;
      for (const uid of ['l', 'r']) {
        const d = player.projection().boardStats.get(uid)!;
        expect({ attack: base(uid).attack + d.attack, health: base(uid).health + d.health }, `${uid} lands on the exact final value`)
          .toEqual({ attack: final(uid).attack, health: final(uid).health });
      }
      // Presentation only: the prepared commit is byte-identical to a plain reduce.
      expect(JSON.stringify(prepared.after)).toBe(JSON.stringify(after));
    });
  }

  it('only accent ticks carry the cue; the quiet ones still deliver', () => {
    const timeline = compileTimeline(normalizePresentationBatch(prepareActionWithPresentation(kringle(99), faceOmen).batch!));
    const mine = timeline.beats.filter((b) => b.source.uid === 'k');
    const accents = mine.filter((b) => b.pace!.accent).length;
    expect(accents).toBeGreaterThanOrEqual(4);
    expect(accents, 'a hundred ticks do not ring a hundred times').toBeLessThan(25);
  });
});
