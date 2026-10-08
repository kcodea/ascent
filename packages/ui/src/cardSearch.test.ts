// packages/ui/src/cardSearch.test.ts
import { describe, expect, it } from 'vitest';
import { activeSet } from '@game/content';
import { cardRowsFor, filterCards, runeRowsFor, searchTerms, tribesIn, type CardRow } from './cardSearch';

const row = (p: Partial<CardRow>): CardRow => ({ id: 'x', name: 'X', tier: 1, spell: false, tribe: 'neutral', hay: 'x', ...p });
const ROWS: CardRow[] = [
  row({ id: 'a', tier: 1, tribe: 'demon', hay: 'imp demon' }),
  row({ id: 'b', tier: 3, tribe: 'beast', tribe2: 'demon', hay: 'hound beast demon deathrattle' }),
  row({ id: 'c', tier: 5, tribe: 'neutral', hay: 'golem' }),
  row({ id: 's', tier: 3, spell: true, tribe: 'neutral', hay: 'bolt spell' }),
];

describe('cardSearch', () => {
  it('splits a query into lowercase terms', () => { expect(searchTerms('  Imp  DEMON ')).toEqual(['imp', 'demon']); });
  it('no chips selected = no filter', () => {
    expect(filterCards(ROWS, { spell: false, terms: [], tiers: [], tribes: [] }).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('tier chips multi-select', () => {
    expect(filterCards(ROWS, { spell: false, terms: [], tiers: [1, 5], tribes: [] }).map((r) => r.id)).toEqual(['a', 'c']);
  });
  it('tribe chips multi-select; a dual-tribe minion matches either; Neutral is a tribe chip', () => {
    expect(filterCards(ROWS, { spell: false, terms: [], tiers: [], tribes: ['demon'] }).map((r) => r.id)).toEqual(['a', 'b']);
    expect(filterCards(ROWS, { spell: false, terms: [], tiers: [], tribes: ['neutral'] }).map((r) => r.id)).toEqual(['c']);
  });
  it('chips AND the search text', () => {
    expect(filterCards(ROWS, { spell: false, terms: ['deathrattle'], tiers: [3], tribes: ['demon'] }).map((r) => r.id)).toEqual(['b']);
  });
  it('spells ignore tribe chips but honour tier chips', () => {
    expect(filterCards(ROWS, { spell: true, terms: [], tiers: [3], tribes: ['demon'] }).map((r) => r.id)).toEqual(['s']);
  });
  it('tribesIn lists minion tribes with neutral last', () => {
    expect(tribesIn(ROWS)).toEqual(['beast', 'demon', 'neutral']);
  });
  it('builds real rows for the active set (no tokens, no archived)', () => {
    const rows = cardRowsFor(activeSet().id);
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.some((r) => r.spell)).toBe(true);
    expect(runeRowsFor(activeSet().id).some((r) => r.epic)).toBe(true);
  });
});
