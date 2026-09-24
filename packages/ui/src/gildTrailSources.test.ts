import { describe, expect, it } from 'vitest';
import { gildArrivalMs, resolveGildSources, snapshotGildCandidates, type GildSnap } from './gildTrailSources';

const snap = (entries: [string, GildSnap][]): Map<string, GildSnap> => new Map(entries);
const FALLBACK = { x: 500, y: 300 };

describe('resolveGildSources', () => {
  it('starts a trail at every consumed copy, in layout order', () => {
    const prev = snap([
      ['a', { cardId: 'imp', x: 100, y: 400 }],
      ['b', { cardId: 'imp', x: 220, y: 400 }],
      ['c', { cardId: 'imp', x: 700, y: 650 }],
    ]);
    expect(resolveGildSources({ prev, present: new Set(), cardId: 'imp', need: 3, fallback: FALLBACK }))
      .toEqual([{ x: 100, y: 400 }, { x: 220, y: 400 }, { x: 700, y: 650 }]);
  });

  it('skips a copy that is still on screen (a fourth copy is not part of the triple)', () => {
    const prev = snap([
      ['a', { cardId: 'imp', x: 100, y: 400 }],
      ['b', { cardId: 'imp', x: 220, y: 400 }],
      ['c', { cardId: 'imp', x: 340, y: 400 }],
      ['d', { cardId: 'imp', x: 460, y: 400 }],
    ]);
    const out = resolveGildSources({ prev, present: new Set(['d']), cardId: 'imp', need: 3, fallback: FALLBACK });
    expect(out).toEqual([{ x: 100, y: 400 }, { x: 220, y: 400 }, { x: 340, y: 400 }]);
  });

  it('ignores cards of a different cardId that left in the same commit', () => {
    const prev = snap([
      ['a', { cardId: 'imp', x: 100, y: 400 }],
      ['x', { cardId: 'ogre', x: 150, y: 400 }],
      ['b', { cardId: 'imp', x: 220, y: 400 }],
    ]);
    const out = resolveGildSources({ prev, present: new Set(), cardId: 'imp', need: 2, fallback: FALLBACK });
    expect(out).toEqual([{ x: 100, y: 400 }, { x: 220, y: 400 }]);
  });

  it('launches the bought third copy from where the buy was released', () => {
    // The bought copy was minted and consumed inside one commit, so it never appears in `prev`.
    const prev = snap([
      ['a', { cardId: 'imp', x: 100, y: 400 }],
      ['b', { cardId: 'imp', x: 220, y: 400 }],
    ]);
    const out = resolveGildSources({
      prev, present: new Set(), cardId: 'imp', need: 3, fallback: FALLBACK,
      bought: { uid: 'b9', at: { x: 640, y: 120 } },
    });
    expect(out).toEqual([{ x: 100, y: 400 }, { x: 220, y: 400 }, { x: 640, y: 120 }]);
  });

  it('does not use the buy when the bought card is still on screen (it was not consumed)', () => {
    const prev = snap([
      ['a', { cardId: 'imp', x: 100, y: 400 }],
      ['b', { cardId: 'imp', x: 220, y: 400 }],
    ]);
    const out = resolveGildSources({
      prev, present: new Set(['b9']), cardId: 'imp', need: 2, fallback: FALLBACK,
      bought: { uid: 'b9', at: { x: 640, y: 120 } },
    });
    expect(out).toEqual([{ x: 100, y: 400 }, { x: 220, y: 400 }]);
  });

  it('pads any copy it cannot place with distinct points around the fallback', () => {
    // e.g. a copy that arrived and was consumed in one commit by some path other than a drag-buy.
    const prev = snap([['a', { cardId: 'imp', x: 100, y: 400 }]]);
    const out = resolveGildSources({ prev, present: new Set(), cardId: 'imp', need: 3, fallback: FALLBACK, spread: 100 });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ x: 100, y: 400 });
    expect(out.slice(1)).toEqual([{ x: 450, y: 300 }, { x: 550, y: 300 }]);
  });

  it('never returns more trails than copies consumed', () => {
    const prev = snap([
      ['a', { cardId: 'imp', x: 1, y: 1 }], ['b', { cardId: 'imp', x: 2, y: 2 }], ['c', { cardId: 'imp', x: 3, y: 3 }],
    ]);
    const out = resolveGildSources({
      prev, present: new Set(), cardId: 'imp', need: 2, fallback: FALLBACK, bought: { uid: 'z', at: { x: 9, y: 9 } },
    });
    expect(out).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
  });
});

describe('gildArrivalMs', () => {
  const layers = [
    { primitive: 'ribbon', anchor: 'travel', at: 0, travelMs: 360, stagger: 70, params: {} },
    { primitive: 'burst', anchor: 'source', at: 0, stagger: 70, params: {} },
    { primitive: 'burst', anchor: 'target', at: 360, stagger: 70, params: {} },
  ];

  it('is when the LAST copy\'s landing layer fires', () => {
    expect(gildArrivalMs({ layers }, 0)).toBe(360);
    expect(gildArrivalMs({ layers }, 2)).toBe(360 + 70 * 2);
  });

  it('falls back to the end of the travel when there is no target layer', () => {
    const noTarget = layers.filter((l) => l.anchor !== 'target');
    expect(gildArrivalMs({ layers: noTarget }, 1)).toBe(360 + 70);
  });

  it('is 0 for a def with no travel and no target (reveal at once)', () => {
    expect(gildArrivalMs({ layers: [layers[1]] }, 2)).toBe(0);
  });

  it('is 0 when the def is missing', () => {
    expect(gildArrivalMs(undefined, 2)).toBe(0);
  });
});

describe('snapshotGildCandidates', () => {
  const measure = (uid: string): { x: number; y: number } | null => (uid === 'gone' ? null : { x: uid.length * 10, y: 5 });

  it('measures only cards that could complete a triple (need - 1 copies held)', () => {
    const cards = [
      { uid: 'a1', cardId: 'imp' }, { uid: 'a2', cardId: 'imp' },   // two imps: one more makes a triple
      { uid: 'o1', cardId: 'ogre' },                                // a single ogre can't triple yet
    ];
    const out = snapshotGildCandidates(cards, 3, measure);
    expect([...out.keys()]).toEqual(['a1', 'a2']);
    expect(out.get('a1')).toEqual({ cardId: 'imp', x: 20, y: 5 });
  });

  it('under a two-copy gild, a single held copy is already a candidate', () => {
    const out = snapshotGildCandidates([{ uid: 'o1', cardId: 'ogre' }], 2, measure);
    expect([...out.keys()]).toEqual(['o1']);
  });

  it('skips golden cards (they cannot triple again) and cards it cannot measure', () => {
    const cards = [
      { uid: 'a1', cardId: 'imp' }, { uid: 'gone', cardId: 'imp' }, { uid: 'g1', cardId: 'imp', golden: true },
    ];
    const out = snapshotGildCandidates(cards, 3, measure);
    expect([...out.keys()]).toEqual(['a1']);
  });
});
