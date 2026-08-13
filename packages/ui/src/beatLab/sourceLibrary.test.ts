import { describe, it, expect } from 'vitest';
import { sourceEntries, filterSources, fixtureBatchForTrigger } from './sourceLibrary';

/** BEAT SYSTEM PR 9 — the source-grouped library: findable by card name, surfaces EMPTY combat triggers. */
describe('source library', () => {
  const entries = sourceEntries();

  it('groups the whole registry surface by named source', () => {
    expect(entries.length).toBeGreaterThan(300);
    expect(entries.every((e) => e.name && e.triggers.length > 0)).toBe(true);
  });

  it('is findable by CARD NAME (the whole point) — Fleeting Vigor', () => {
    const hits = filterSources(entries, 'fleeting vigor');
    expect(hits.length).toBe(1);
    const fv = hits[0]!;
    expect(fv.name).toBe('Fleeting Vigor');
    expect(fv.kind).toBe('spell');
  });

  it('surfaces Fleeting Vigor\'s EMPTY Start-of-Combat trigger (the reported gap)', () => {
    const fv = filterSources(entries, 'fleeting vigor')[0]!;
    const cast = fv.triggers.find((t) => t.trigger === 'cast');
    const sc = fv.triggers.find((t) => t.trigger === 'startOfCombat');
    expect(cast?.coverage, 'the cast trigger is classified').toBe('classified');
    expect(sc, 'the derived Start-of-Combat moment exists').toBeTruthy();
    expect(sc!.coverage).toBe('empty');
    expect(sc!.derived).toBe(true);
    expect(sc!.editKey).toBe('source:spell:fleetingvigor:startOfCombat');
  });

  it('per-source edit keys — tuning one card does not move its siblings', () => {
    const fv = filterSources(entries, 'fleeting vigor')[0]!;
    expect(fv.triggers.every((t) => t.editKey.startsWith('source:spell:fleetingvigor:'))).toBe(true);
  });

  it('emptyOnly filter isolates sources with an unassigned trigger', () => {
    const empties = filterSources(entries, '', { emptyOnly: true });
    expect(empties.length).toBeGreaterThan(0);
    expect(empties.every((e) => e.hasEmpty)).toBe(true);
    expect(empties.some((e) => e.name === 'Fleeting Vigor')).toBe(true);
  });

  it('builds a playable synthetic fixture for a selected trigger', () => {
    const fv = filterSources(entries, 'fleeting vigor')[0]!;
    const sc = fv.triggers.find((t) => t.trigger === 'startOfCombat')!;
    const batch = fixtureBatchForTrigger(fv, sc);
    expect(batch.phase).toBe('startOfCombat');
    expect(batch.events.filter((e) => e.type === 'sourceTrigger').length).toBe(2);
  });

  it('runes and quests appear by name too', () => {
    expect(filterSources(entries, 'lapidary').some((e) => e.kind === 'rune')).toBe(true);
  });
});
