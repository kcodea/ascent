import { describe, expect, it } from 'vitest';
import { visibleHandPreviews } from './handPreview';

/**
 * BUG bb5195d5 — "when rope wrangler triggers end of turn. it briefly displays 2x the amount of cards given
 * to hand, before correcting and displaying the correct amount."
 *
 * The invariant that matters is not "the previews are cleared at the right moment" — it is that the TOTAL the
 * player sees (real cards + previews) never jumps. These cases are written as that total.
 */
describe('End-of-Turn hand previews', () => {
  const previews = ['a', 'b', 'c', 'd', 'e']; // Rope Wrangler at 5 casts
  const room = 10;

  it('shows every preview before any card has really arrived', () => {
    expect(visibleHandPreviews({ previews, baseHandSize: 0, handSize: 0, room })).toEqual(previews);
  });

  it('THE BUG: as real cards land, the visible TOTAL stays constant', () => {
    for (let arrived = 0; arrived <= previews.length; arrived++) {
      const shown = visibleHandPreviews({ previews, baseHandSize: 0, handSize: arrived, room });
      expect(arrived + shown.length, `${arrived} arrived: the row must still show ${previews.length}`)
        .toBe(previews.length);
    }
  });

  it('shows nothing once the whole batch has committed', () => {
    expect(visibleHandPreviews({ previews, baseHandSize: 0, handSize: 5, room })).toEqual([]);
  });

  it('measures arrivals against the hand it STARTED with, not zero', () => {
    // A hand that already held 3 cards: 4 in hand means one grant has landed, not four.
    expect(visibleHandPreviews({ previews, baseHandSize: 3, handSize: 4, room })).toEqual(['b', 'c', 'd', 'e']);
  });

  it('respects the hand cap', () => {
    expect(visibleHandPreviews({ previews, baseHandSize: 0, handSize: 0, room: 2 })).toEqual(['a', 'b']);
    expect(visibleHandPreviews({ previews, baseHandSize: 0, handSize: 0, room: 0 })).toEqual([]);
  });

  it('a hand that SHRINKS mid-animation does not resurrect a preview', () => {
    // Clamped at 0 — a negative arrival count would slice from the end and re-show cards.
    expect(visibleHandPreviews({ previews, baseHandSize: 3, handSize: 1, room })).toEqual(previews);
  });
});
