import { describe, it, expect } from 'vitest';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';

/**
 * The VEINSTORM shop-gem signal (`veinstormFx`).
 *
 * Veinstorm gems the whole shop as ONE event — a spanning volley with a single sound — where a lone Ruby
 * dragged onto an offer is a per-card gem. Both land the same 'Ruby' buff, so only Veinstorm's chokepoint
 * (`stampVeinstormRubies`) can tell them apart. These tests pin that the reducer does: Veinstorm drives
 * `veinstormFx` and its offers are EXCLUDED from `rubyLandedFx`; anything else stays on `rubyLandedFx`.
 */
const mkSpell = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

const withVeinstorm = (shop: RunState['shop']): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 999, shop, hand: [mkSpell('vs', 'veinstorm')] });

describe('veinstormFx (the shop-gem span signal)', () => {
  it('a Veinstorm CAST stamps every gemmed offer, onRefresh false', () => {
    const s = withVeinstorm([{ uid: 'o1', cardId: 'sandbag' }, { uid: 'o2', cardId: 'sandbag' }]);
    const next = reduce(s, { type: 'play', uid: 'vs', targetUid: undefined });
    expect(next.veinstormFxSeq ?? 0).toBeGreaterThan(0);
    expect(next.veinstormFx?.onRefresh).toBe(false);
    expect(new Set(next.veinstormFx?.uids)).toEqual(new Set(['o1', 'o2']));
  });

  /** The signal carries the EXACT per-offer Ruby value it added (base 1/1 + rubyBonus), so the badge hold
   *  withholds precisely what landed rather than averaging it out of the buff. Every gemmed offer gained it. */
  it('carries the per-offer Ruby amount that landed', () => {
    const s = withVeinstorm([{ uid: 'o1', cardId: 'sandbag' }]);
    const next = reduce(s, { type: 'play', uid: 'vs', targetUid: undefined });
    expect(next.veinstormFx?.attack).toBe(1); // base 1 + rubyBonus 0 on a fresh run
    expect(next.veinstormFx?.health).toBe(1);
    // …and it is the real gain on the offer.
    const gained = next.shop.find((o) => o.uid === 'o1')?.buffs?.find((b) => b.source === 'Ruby');
    expect(gained).toMatchObject({ attack: next.veinstormFx?.attack, health: next.veinstormFx?.health });
  });

  it('excludes the gemmed offers from rubyLandedFx, so they never fire both cues', () => {
    const s = withVeinstorm([{ uid: 'o1', cardId: 'sandbag' }, { uid: 'o2', cardId: 'sandbag' }]);
    const next = reduce(s, { type: 'play', uid: 'vs', targetUid: undefined });
    // The offers are handled by the span; the per-card cascade must be empty for them.
    expect(next.rubyLandedFx ?? []).toEqual([]);
    expect(next.rubyLandedFxSeq ?? 0).toBe(0);
  });

  /** The whole point of the split: a single Ruby on ONE offer is an ordinary gem, not the span. */
  it('a lone Ruby dragged onto an offer stays on rubyLandedFx and does NOT fire veinstormFx', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      hand: [{ uid: 'r1', cardId: 'ruby', tribe: 'kobold', attack: 1, health: 1, keywords: [], golden: false }],
      shop: [{ uid: 'o1', cardId: 'sandbag' }],
    };
    const next = reduce(s, { type: 'play', uid: 'r1', targetUid: 'o1' });
    expect(next.rubyLandedFx?.map((l) => l.uid)).toEqual(['o1']);
    expect(next.veinstormFxSeq ?? 0).toBe(0);
  });

  /** The signal is transient — a later unrelated action must not re-fire it. */
  it('does not re-fire on a following action', () => {
    const s = withVeinstorm([{ uid: 'o1', cardId: 'sandbag' }]);
    const cast = reduce(s, { type: 'play', uid: 'vs', targetUid: undefined });
    const seqAfterCast = cast.veinstormFxSeq ?? 0;
    const later = reduce(cast, { type: 'freeze' });
    expect(later.veinstormFxSeq ?? 0).toBe(seqAfterCast); // unchanged — no new stamp
    expect(later.veinstormStamped).toBeUndefined();       // scratch cleared
  });
});
