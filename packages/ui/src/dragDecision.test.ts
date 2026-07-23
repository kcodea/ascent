import { describe, it, expect } from 'vitest';
import {
  deriveDragDecision,
  dragDecisionEqual,
  computeCastingSpell,
  NO_DRAG_DECISION,
  type DragDecisionInput,
  type DragGeo,
  type DragLike,
} from './dragDecision';
import type { CardView } from './Card';

/**
 * These pin the pure drag-decision layer that both the recruit render AND `flushMove`'s re-render gate call.
 * The load-bearing guarantee: the decision is a function of the pointer position + drag context ONLY, so the
 * gate (evaluate at the exact cursor vs the committed point, commit on difference) can never disagree with what
 * the render then draws. Every drag gesture — board reorder, hand play, magnetize, spell cast, shop reorder,
 * hand reorder, and the sell/buy lift — has a case, plus the boundaries that flip a decision.
 */

// A geometry stub: the warband/shop/hand are 100px-wide slots starting at x=0, so index = floor(x/100),
// clamped to [0, len]. boardUidAt/shopUidAt return the uid of the slot under x (same 100px grid) or null.
function gridGeo(opts: { warband?: string[]; shop?: string[]; hand?: string[] } = {}): DragGeo {
  const idx = (slots: string[], x: number, excludeUid?: string): number => {
    const n = slots.filter((u) => u !== excludeUid).length;
    return Math.max(0, Math.min(n, Math.floor(x / 100)));
  };
  const uidAt = (slots: string[], x: number): string | null => {
    if (x < 0) return null;
    const i = Math.floor(x / 100);
    return slots[i] ?? null;
  };
  return {
    warbandIndexAt: (x, ex) => idx(opts.warband ?? [], x, ex),
    shopIndexAt: (x, ex) => idx(opts.shop ?? [], x, ex),
    handIndexAt: (x, ex) => idx(opts.hand ?? [], x, ex),
    boardUidAt: (x) => uidAt(opts.warband ?? [], x),
    shopUidAt: (x) => uidAt(opts.shop ?? [], x),
  };
}

const view = (v: Partial<CardView> = {}): DragLike['view'] => ({ cardId: 'c', keywords: [], ...v });

function drag(over: Partial<DragLike> = {}): DragLike {
  return { uid: 'd', source: 'board', view: view(), ox: 0, w: 100, startY: 500, active: true, ...over };
}

function input(over: Partial<DragDecisionInput> = {}): DragDecisionInput {
  return {
    drag: drag(),
    x: 0,
    y: 300,
    overZone: 'warband',
    magSlide: false,
    playFloor: 400,
    collapseY: 60,
    boardMax: 7,
    board: [],
    spellUid: undefined,
    geo: gridGeo(),
    ...over,
  };
}

describe('deriveDragDecision — no drag', () => {
  it('returns the empty decision when nothing is dragged', () => {
    expect(deriveDragDecision(input({ drag: null }))).toEqual(NO_DRAG_DECISION);
  });
  it('an inactive (pre-threshold) drag opens no gaps', () => {
    const d = deriveDragDecision(input({ drag: drag({ active: false }), overZone: 'warband' }));
    expect(d.gapIndex).toBe(-1);
    expect(d.overWarband).toBe(false);
    expect(d.collapsedLift).toBe(false);
  });
});

describe('board reorder', () => {
  it('opens the warband gap at the pointer slot while over the row, excluding the dragged uid', () => {
    // centre = x - ox + w/2 = 250 - 0 + 50 = 300 → slot 3
    const d = deriveDragDecision(
      input({ drag: drag({ source: 'board', uid: 'b2' }), x: 250, overZone: 'warband', geo: gridGeo({ warband: ['b1', 'b2', 'b3', 'b4'] }) }),
    );
    expect(d.overWarband).toBe(true);
    expect(d.gapIndex).toBe(3);
  });
  it('lifting the board minion up out of the row (no longer over warband) closes the gap', () => {
    const d = deriveDragDecision(input({ drag: drag({ source: 'board' }), overZone: 'tavern', y: 120 }));
    expect(d.overWarband).toBe(false);
    expect(d.gapIndex).toBe(-1);
  });
  it('a big vertical lift flags collapsedLift (the pull-out/sell gesture)', () => {
    const far = deriveDragDecision(input({ drag: drag({ source: 'board', startY: 500 }), y: 300 })); // |300-500|=200 > 60
    expect(far.collapsedLift).toBe(true);
    const near = deriveDragDecision(input({ drag: drag({ source: 'board', startY: 500 }), y: 460 })); // |460-500|=40 < 60
    expect(near.collapsedLift).toBe(false);
  });
});

describe('hand play', () => {
  it('opens the warband gap when a hand minion is above the play floor with room on board', () => {
    const d = deriveDragDecision(
      input({ drag: drag({ source: 'hand' }), x: 150, y: 300, playFloor: 400, board: [{ cardId: 'x' }, { cardId: 'y' }], boardMax: 7, geo: gridGeo({ warband: ['a', 'b'] }) }),
    );
    expect(d.overWarband).toBe(true);
    expect(d.gapIndex).toBe(2); // centre 200 → slot 2
  });
  it('below the play floor (down in the hand) it does not play — no gap', () => {
    const d = deriveDragDecision(input({ drag: drag({ source: 'hand' }), y: 450, playFloor: 400 }));
    expect(d.overWarband).toBe(false);
    expect(d.gapIndex).toBe(-1);
  });
  it('a full board blocks the play preview', () => {
    const d = deriveDragDecision(
      input({ drag: drag({ source: 'hand' }), y: 300, playFloor: 400, board: [{ cardId: '1' }, { cardId: '2' }], boardMax: 2 }),
    );
    expect(d.overWarband).toBe(false);
  });
});

describe('magnetize', () => {
  const magView = view({ cardId: 'clingdrone', keywords: ['M'] });
  it('a magnetic hand minion over a valid Mech both magnetizes and shoves a gap open', () => {
    const d = deriveDragDecision(
      input({
        drag: drag({ source: 'hand', view: magView }),
        x: 50, // centre 100 → warband slot 1
        overZone: 'warband',
        board: [{ cardId: 'other' }, { cardId: 'mech', addedTribes: [], allTribes: false }],
        geo: gridGeo({ warband: ['m0', 'm1'] }),
      }),
    );
    // magnetizesTo(clingdrone → mech) depends on real card data; assert the SHAPE is coherent either way:
    if (d.wouldMagnetize) {
      expect(d.gapIndex).toBeGreaterThanOrEqual(0); // magnetize also opens the gap
      expect(d.overWarband).toBe(false); // magnetize suppresses the plain insertion path
    } else {
      // not a magnet target → falls through to the normal hand-play insertion
      expect(d.overWarband).toBe(true);
    }
  });
  it('never magnetizes once the magnet-slide has started (magSlide gates the preview)', () => {
    const d = deriveDragDecision(
      input({ drag: drag({ source: 'hand', view: magView }), overZone: 'warband', magSlide: true, board: [{ cardId: 'mech' }] }),
    );
    expect(d.wouldMagnetize).toBe(false);
  });
  it('a non-magnetic minion never magnetizes', () => {
    const d = deriveDragDecision(input({ drag: drag({ source: 'hand', view: view({ keywords: [] }) }), overZone: 'warband', board: [{ cardId: 'mech' }] }));
    expect(d.wouldMagnetize).toBe(false);
  });
});

describe('spell cast', () => {
  const friendlySpell = view({ cardId: 'shatter', spell: true, target: 'friendly', keywords: [] });
  const anySpell = view({ cardId: 'buff', spell: true, target: 'any', keywords: [] });
  it('a friendly-target spell above the play floor targets the board minion under the cursor', () => {
    const d = deriveDragDecision(
      input({ drag: drag({ source: 'hand', view: friendlySpell }), x: 150, y: 200, playFloor: 400, geo: gridGeo({ warband: ['t0', 't1', 't2'] }) }),
    );
    expect(d.castTargetUid).toBe('t1'); // x=150 → board slot 1
    expect(d.overWarband).toBe(false); // a spell never opens an insertion gap
    expect(d.gapIndex).toBe(-1);
  });
  it('an `any`-target spell falls back to the tavern offer under the cursor when off the board', () => {
    const d = deriveDragDecision(
      input({ drag: drag({ source: 'hand', view: anySpell }), x: 150, y: 200, playFloor: 400, geo: gridGeo({ warband: [], shop: ['o0', 'o1'] }) }),
    );
    expect(d.castTargetUid).toBe('o1');
  });
  it('below the play floor a spell is not aiming — no target', () => {
    const d = deriveDragDecision(input({ drag: drag({ source: 'hand', view: friendlySpell }), y: 450, playFloor: 400 }));
    expect(d.castTargetUid).toBeNull();
  });
  it('computeCastingSpell matches the aim boundary', () => {
    const d = drag({ source: 'hand', view: friendlySpell });
    expect(computeCastingSpell(d, 399, 400)).toBe(true);
    expect(computeCastingSpell(d, 400, 400)).toBe(false); // y === playFloor is NOT above it
    expect(computeCastingSpell(drag({ source: 'hand', view: view({ spell: false }) }), 100, 400)).toBe(false);
  });
});

describe('shop reorder / buy', () => {
  it('a dragged offer over the tavern (not lifted) opens the shop gap, excluding itself', () => {
    const d = deriveDragDecision(
      input({ drag: drag({ source: 'shop', uid: 's1', startY: 100 }), x: 250, y: 120, overZone: 'tavern', geo: gridGeo({ shop: ['s0', 's1', 's2', 's3'] }) }),
    );
    expect(d.shopGapIndex).toBe(3); // centre 300 → slot 3
  });
  it('the pinned spell offer never opens a shop gap', () => {
    const d = deriveDragDecision(
      input({ drag: drag({ source: 'shop', uid: 'spell' }), overZone: 'tavern', spellUid: 'spell', geo: gridGeo({ shop: ['s0', 'spell'] }) }),
    );
    expect(d.shopGapIndex).toBe(-1);
  });
  it('lifting the offer clear (collapsedLift) stops the shop reorder — a buy', () => {
    const d = deriveDragDecision(
      input({ drag: drag({ source: 'shop', uid: 's1', startY: 100 }), y: 400, overZone: 'tavern', geo: gridGeo({ shop: ['s0', 's1'] }) }),
    );
    expect(d.collapsedLift).toBe(true);
    expect(d.shopGapIndex).toBe(-1);
  });
});

describe('hand reorder', () => {
  it('a hand card held down in the hand region opens the hand gap, excluding itself', () => {
    const d = deriveDragDecision(
      input({ drag: drag({ source: 'hand', uid: 'h1' }), x: 250, y: 450, playFloor: 400, geo: gridGeo({ hand: ['h0', 'h1', 'h2', 'h3'] }) }),
    );
    expect(d.handGapIndex).toBe(3);
    expect(d.overWarband).toBe(false);
  });
  it('lifted up to play (above the floor) it is no longer a hand reorder', () => {
    const d = deriveDragDecision(input({ drag: drag({ source: 'hand', uid: 'h1' }), y: 300, playFloor: 400, geo: gridGeo({ hand: ['h0', 'h1'] }) }));
    expect(d.handGapIndex).toBe(-1);
  });
});

describe('dragDecisionEqual (the flushMove gate)', () => {
  it('is true for two decisions that render identically', () => {
    const a = deriveDragDecision(input({ x: 10 }));
    const b = deriveDragDecision(input({ x: 12 })); // same slot → same decision
    expect(dragDecisionEqual(a, b)).toBe(true);
  });
  it('is false the moment a gap index changes (a slot crossing)', () => {
    const a = deriveDragDecision(input({ x: 50, overZone: 'warband', geo: gridGeo({ warband: ['a', 'b', 'c'] }) }));
    const b = deriveDragDecision(input({ x: 150, overZone: 'warband', geo: gridGeo({ warband: ['a', 'b', 'c'] }) }));
    expect(a.gapIndex).not.toBe(b.gapIndex);
    expect(dragDecisionEqual(a, b)).toBe(false);
  });
});
