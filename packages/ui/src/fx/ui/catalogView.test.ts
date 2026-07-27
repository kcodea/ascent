import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, applyFilter, groupByLook, groupByCard, type FxCatalogEntry } from './catalogView';

const entry = (id: string, over: Partial<FxCatalogEntry> = {}): FxCatalogEntry => ({
  def: { version: 1, id, duration: 900, layers: [] },
  facets: { shape: 'Burst', hue: 'red', motion: 'in place' },
  bindings: { kinds: [], cards: [] },
  ...over,
});

describe('applyFilter', () => {
  const all = [
    entry('red-burst'),
    entry('blue-trail', { facets: { shape: 'Trail', hue: 'blue', motion: 'travels' } }),
    entry('bound-one', { bindings: { kinds: ['shieldGain'], cards: [] } }),
  ];

  it('returns everything for the empty filter', () => {
    expect(applyFilter(all, EMPTY_FILTER)).toHaveLength(3);
  });

  it('filters by hue', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, hues: ['blue'] }).map((e) => e.def.id)).toEqual(['blue-trail']);
  });

  it('filters by motion', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, motion: 'travels' }).map((e) => e.def.id)).toEqual(['blue-trail']);
  });

  it('filters by bound / unbound', () => {
    expect(applyFilter(all, { ...EMPTY_FILTER, bound: 'bound' }).map((e) => e.def.id)).toEqual(['bound-one']);
    expect(applyFilter(all, { ...EMPTY_FILTER, bound: 'unbound' })).toHaveLength(2);
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
