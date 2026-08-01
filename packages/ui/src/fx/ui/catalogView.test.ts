import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, applyFilter, groupByLook, groupByCard, type FxCatalogEntry } from './catalogView';

const entry = (id: string, over: Partial<FxCatalogEntry> = {}): FxCatalogEntry => ({
  def: { version: 1, id, duration: 900, layers: [] },
  facets: { shape: 'Burst', hue: 'red', motion: 'in place' },
  bindings: { kinds: [], cards: [] },
  callSites: [],
  usage: 'unused',
  ...over,
});

describe('applyFilter', () => {
  const all = [
    entry('red-burst'),
    entry('blue-trail', { facets: { shape: 'Trail', hue: 'blue', motion: 'travels' } }),
    entry('bound-one', { bindings: { kinds: ['shieldGain'], cards: [] }, usage: 'bound' }),
    entry('code-one', { callSites: ['Recruit.tsx'], usage: 'code' }),
  ];

  it('returns everything for the empty filter', () => {
    expect(applyFilter(all, EMPTY_FILTER)).toHaveLength(4);
  });

  it('filters by hue', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, hues: ['blue'] }).map((e) => e.def.id)).toEqual(['blue-trail']);
  });

  it('filters by motion', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, motion: 'travels' }).map((e) => e.def.id)).toEqual(['blue-trail']);
  });

  /**
   * The three wiring states select separately. The old two-value facet put `code-one` — a def that plays on
   * every shop click — in the same bucket as a dead draft, which is the whole defect. `unused` must now mean
   * only the genuinely inert ones.
   */
  it('filters each wiring state apart from the others', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, usage: 'bound' }).map((e) => e.def.id)).toEqual(['bound-one']);
    expect(applyFilter(all, { ...EMPTY_FILTER, usage: 'code' }).map((e) => e.def.id)).toEqual(['code-one']);
    expect(applyFilter(all, { ...EMPTY_FILTER, usage: 'unused' }).map((e) => e.def.id))
      .toEqual(['red-burst', 'blue-trail']);
  });

  it('searches id, label, tags and card name', () => {
    const rich = [
      entry('x', { def: { version: 1, id: 'x', duration: 9, layers: [], label: 'Ember Lance' } }),
      entry('y', { def: { version: 1, id: 'y', duration: 9, layers: [], tags: ['impact'] } }),
      entry('z', { bindings: { kinds: [], cards: [{ cardId: 'bloodbinder', name: 'Bloodbinder', tribe: 'demon', missing: false }] } }),
    ];
    expect(applyFilter(rich, { ...EMPTY_FILTER, search: 'ember' }).map((e) => e.def.id)).toEqual(['x']);
    expect(applyFilter(rich, { ...EMPTY_FILTER, search: 'impact' }).map((e) => e.def.id)).toEqual(['y']);
    expect(applyFilter(rich, { ...EMPTY_FILTER, search: 'blood' }).map((e) => e.def.id)).toEqual(['z']);
  });

  // "Which effects does the recruit screen play?" should be a search, not a code hunt.
  it('searches the files that fire a def from code', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, search: 'recruit' }).map((e) => e.def.id)).toEqual(['code-one']);
  });

  it('search is case-insensitive and ignores surrounding whitespace', () => {
    const one = [entry('x', { def: { version: 1, id: 'x', duration: 9, layers: [], label: 'Ember Lance' } })];
    expect(applyFilter(one, { ...EMPTY_FILTER, search: '  EMBER ' })).toHaveLength(1);
  });

  it('combines filters as AND', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, hues: ['blue'], motion: 'in place' })).toEqual([]);
  });
});

describe('groupByLook', () => {
  it('groups on shape then colour, and keeps groups sorted', () => {
    const groups = groupByLook([
      entry('b', { facets: { shape: 'Trail', hue: 'blue', motion: 'travels' } }),
      entry('a'),
      entry('c'),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['Burst', 'Trail']);
    expect(groups[0].entries.map((e) => e.def.id)).toEqual(['a', 'c']);
  });
});

describe('groupByCard', () => {
  const cards = [
    { cardId: 'bloodbinder', name: 'Bloodbinder', tribe: 'demon', defId: 'ruby-lance' },
    { cardId: 'imp', name: 'Imp', tribe: 'demon', defId: null },
    { cardId: 'wolf', name: 'Wolf', tribe: 'beast', defId: null },
  ];

  it('groups by tribe, sorted, with cards sorted inside', () => {
    const groups = groupByCard(cards);
    expect(groups.map((g) => g.title)).toEqual(['beast', 'demon']);
    expect(groups[1].cards.map((c) => c.name)).toEqual(['Bloodbinder', 'Imp']);
  });

  // A tribe with no bespoke effects anywhere is the signal this lens exists to give.
  it('keeps a tribe whose cards all use defaults', () => {
    expect(groupByCard(cards).find((g) => g.title === 'beast')?.cards).toHaveLength(1);
  });
});

/**
 * Both helpers sort, and both sort COPIES. A regression here — someone "simplifying" `[...list].sort()` to
 * `list.sort()` — would reorder the caller's own array as a side effect of rendering, which React would
 * then see as unchanged state. It would be near-invisible in review and infuriating to debug, so it gets a
 * test rather than a comment.
 */
describe('purity', () => {
  it("neither filtering nor grouping reorders the caller's array", () => {
    const entries = [
      entry('c'),
      entry('a', { facets: { shape: 'Trail', hue: 'blue', motion: 'travels' } }),
      entry('b'),
    ];
    const before = entries.map((e) => e.def.id);
    applyFilter(entries, EMPTY_FILTER);
    groupByLook(entries);
    expect(entries.map((e) => e.def.id)).toEqual(before);
  });

  it("does not reorder the caller's card array either", () => {
    const cards = [
      { cardId: 'w', name: 'Wolf', tribe: 'beast', defId: null },
      { cardId: 'b', name: 'Bloodbinder', tribe: 'demon', defId: 'ruby-lance' },
    ];
    const before = cards.map((c) => c.cardId);
    groupByCard(cards);
    expect(cards.map((c) => c.cardId)).toEqual(before);
  });
});
