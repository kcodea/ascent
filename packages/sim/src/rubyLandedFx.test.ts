import { describe, it, expect } from 'vitest';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { RUBY_ID } from './recruit';

/**
 * The RUBY LANDED FX signal — which cards a Ruby was played ON this action, for the per-cast detonation cue.
 *
 * Distinct from `rubyPowerFxSeq` (the Ruby-side twin of spell power), which fires when Ruby STRENGTH goes up
 * and explicitly never per cast. A card that does both must produce both, and these tests pin that they don't
 * get confused for one another.
 *
 * The offer case is a REGRESSION GUARD, not a nicety: the first cut of this signal read board minions only, via
 * the `rubiesOnThisTurn` counter. A Ruby targets `any`, so it also lands on tavern offers — and that path
 * deliberately never calls `fireOnRubyPlayed` (firing an offer's on-Ruby watchers would pay out a Ruby Broker
 * sitting in the shop), so the counter never moved and the cue was silently dead for every shop drop.
 */
const card = (uid: string, cardId: string, tribe: BoardCard['tribe'] = 'kobold'): BoardCard =>
  ({ uid, cardId, tribe, attack: 1, health: 1, keywords: [], golden: false });

const withRubyInHand = (extra: Partial<RunState>): RunState => ({
  ...createRun(1), phase: 'recruit', embers: 20,
  hand: [card('r1', RUBY_ID)],
  ...extra,
});

describe('rubyLandedFx stamp (which cards a Ruby landed on)', () => {
  it('a Ruby played from hand onto a BOARD minion names that minion', () => {
    const s = withRubyInHand({ board: [card('b1', 'stray'), card('b2', 'stray')] });
    const next = reduce(s, { type: 'play', uid: 'r1', targetUid: 'b1' });
    expect(next.rubyLandedFxSeq).toBe(1);
    expect(next.rubyLandedFx).toEqual([{ uid: 'b1', count: 1 }]);
  });

  /** The bug this file exists for. */
  it('a Ruby played onto a TAVERN OFFER names that offer', () => {
    const s = withRubyInHand({ board: [card('b1', 'stray')], shop: [{ uid: 'o1', cardId: 'stray' }] });
    const next = reduce(s, { type: 'play', uid: 'r1', targetUid: 'o1' });
    expect(next.rubyLandedFxSeq).toBe(1);
    expect(next.rubyLandedFx).toEqual([{ uid: 'o1', count: 1 }]);
  });

  it('does not name a minion the Ruby did not land on', () => {
    const s = withRubyInHand({ board: [card('b1', 'stray'), card('b2', 'stray')] });
    const next = reduce(s, { type: 'play', uid: 'r1', targetUid: 'b2' });
    expect(next.rubyLandedFx?.map((l) => l.uid)).not.toContain('b1');
  });

  /**
   * Frenzied Excavator — owner report 2026-08-02: "the ruby effect didn't play, I saw the old tendril".
   *
   * `battlecryPlayRubiesAll` applies its Rubies with a bare `addBuff` and never calls `fireOnRubyPlayed`,
   * unlike the two other board-wide Ruby factories. The first cut of this signal watched `rubiesOnThisTurn`,
   * which only that call moves, so the single most Ruby-ish card in the set played nothing. Keying off the
   * BUFF COUNT instead sees every path — and keeps seeing them whichever way the engine question is settled.
   */
  it('Frenzied Excavator names EVERY board minion, despite its bare addBuff path', () => {
    // DISTINCT cardIds on purpose: three copies of one minion TRIPLE the moment anything is played into them,
    // which collapses the board to a single golden body and quietly makes this test prove nothing.
    const s = withRubyInHand({
      hand: [card('f1', 'k_frenzied')],
      board: [card('b1', 'stray'), card('b2', 'spore')],
    });
    const next = reduce(s, { type: 'play', uid: 'f1' });
    // The Excavator joins the board as part of being played and is a friendly minion, so it takes one too.
    expect(next.rubyLandedFx?.map((l) => l.uid)).toEqual(expect.arrayContaining(['b1', 'b2', 'f1']));
    // Ungilded: exactly one Ruby each, so every land is a 1-stack.
    expect(next.rubyLandedFx?.every((l) => l.count === 1)).toBe(true);
    expect(next.rubyLandedFxSeq).toBe(1);
  });

  /**
   * THE GILDED CASE — the whole reason the signal carries a count.
   *
   * A gilded Frenzied Excavator reads "play 2 Rubies", and the board has to say two.
   *
   * WAS SKIPPED until the engine applied two (#828, now on main). `battlecryPlayRubiesAll` plays
   * ONE Ruby of doubled magnitude (`per = rubies × gold(self)` folded into the amount, a single `addBuff`),
   * where its sibling `spellPlayRubiesAll` loops `per` times and applies N genuine Rubies, firing the target's
   * watchers each time. Same concept, opposite implementations — and the Excavator's disagrees with its own
   * printed text.
   *
   * `battlecryPlayRubiesAll` now loops like its sibling, so the count exists at the source. This is the
   * end-to-end guard for the gilded case: engine applies two, signal carries two, UI stacks two.
   */
  it('a GILDED Frenzied Excavator reports a count of 2 on every minion', () => {
    const s = withRubyInHand({
      hand: [{ ...card('f1', 'k_frenzied'), golden: true }],
      board: [card('b1', 'stray'), card('b2', 'spore')],
    });
    const next = reduce(s, { type: 'play', uid: 'f1' });
    const counts = next.rubyLandedFx ?? [];
    expect(counts.length).toBeGreaterThan(0);
    // Asserted against the UNGILDED case rather than a bare 2, so this keeps meaning something if the card's
    // `rubies` param is ever retuned: gilded must simply be double.
    const plain = reduce(
      withRubyInHand({ hand: [card('f1', 'k_frenzied')], board: [card('b1', 'stray'), card('b2', 'spore')] }),
      { type: 'play', uid: 'f1' },
    ).rubyLandedFx ?? [];
    expect(counts.every((l) => l.count === 2)).toBe(true);
    expect(plain.every((l) => l.count === 1)).toBe(true);
  });

  /** An action with no Ruby in it must leave the signal alone, or the cue fires on unrelated turns. */
  it('does NOT stamp on an action with no Ruby played', () => {
    const s: RunState = { ...createRun(1), phase: 'recruit', embers: 20, board: [card('b1', 'stray')] };
    const next = reduce(s, { type: 'roll' });
    expect(next.rubyLandedFxSeq).toBeUndefined();
    expect(next.rubyLandedFx).toBeUndefined();
  });
});
