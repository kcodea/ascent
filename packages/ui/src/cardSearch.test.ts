// packages/ui/src/cardSearch.test.ts
import { describe, expect, it } from 'vitest';
import { ARCHIVED_CARDS, ARCHIVED_RUNES, CARD_INDEX, RUNE_INDEX, SETS, activeSet, type SetId } from '@game/content';
import { archivedCardRows, archivedRuneRows, cardRowsFor, filterCards, runeRowsFor, searchTerms, tribesIn, type CardRow } from './cardSearch';

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

describe('the archive rows (Scene Builder "Archived" option, owner ask 2026-10-10)', () => {
  it('lists every archived minion and spell (tokens excluded), each flagged and resolvable by id', () => {
    const rows = archivedCardRows();
    expect(rows.map((r) => r.id).sort()).toEqual(ARCHIVED_CARDS.filter((c) => !c.token).map((c) => c.id).sort());
    expect(rows.some((r) => r.spell)).toBe(true);
    expect(rows.some((r) => !r.spell)).toBe(true);
    for (const r of rows) {
      expect(r.archived, r.id).toBe(true);
      expect(CARD_INDEX[r.id], r.id).toBeDefined();
      expect(r.hay, r.id).toContain('archived');
    }
  });
  it('lists every archived rune, each flagged and resolvable through RUNE_INDEX', () => {
    const rows = archivedRuneRows();
    expect(rows.map((r) => r.id).sort()).toEqual(ARCHIVED_RUNES.map((r) => r.id).sort());
    for (const r of rows) { expect(r.archived).toBe(true); expect(RUNE_INDEX[r.id], r.id).toBeDefined(); }
  });
  it('archived content never leaks into a set list', () => {
    const archived = new Set([...ARCHIVED_CARDS.map((c) => c.id), ...ARCHIVED_RUNES.map((r) => r.id)]);
    for (const id of Object.keys(SETS) as SetId[]) {
      expect(cardRowsFor(id).filter((r) => r.archived || (archived.has(r.id) && !CARD_INDEX[r.id]?.gift))).toEqual([]);
      expect(runeRowsFor(id).filter((r) => r.archived || archived.has(r.id))).toEqual([]);
    }
  });
  it('search and the tier filters work across the archived lists', () => {
    const rows = archivedCardRows();
    const minion = rows.find((r) => !r.spell)!;
    const byName = filterCards(rows, { spell: false, terms: searchTerms(minion.name), tiers: [], tribes: [] });
    expect(byName.map((r) => r.id)).toContain(minion.id);
    const tiered = filterCards(rows, { spell: false, terms: [], tiers: [minion.tier], tribes: [] });
    expect(tiered.length).toBeGreaterThan(0);
    expect(tiered.every((r) => r.tier === minion.tier && !r.spell)).toBe(true);
    expect(filterCards(rows, { spell: true, terms: ['archived'], tiers: [], tribes: [] }).length).toBe(rows.filter((r) => r.spell).length);
  });
});
