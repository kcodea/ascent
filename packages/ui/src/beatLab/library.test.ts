import { describe, it, expect } from 'vitest';
import { libraryRows, filterRows, fixtureBatch } from './library';

/** BEAT SYSTEM PR 7 — the Library data layer (browse every beat without playing). */
describe('beat library', () => {
  const rows = libraryRows();

  it('exposes the whole registry, one row per key', () => {
    expect(rows.length).toBeGreaterThan(600);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length); // unique keys
  });

  it('factory rows edit their FAMILY; rune/quest rows edit their exact source', () => {
    const factory = rows.find((r) => r.kindPrefix === 'factory')!;
    expect(factory.editKey).toBe(`family:${factory.entry.family}`);
    expect(factory.editsWholeFamily).toBe(true);
    const rune = rows.find((r) => r.kindPrefix === 'rune');
    if (rune) {
      expect(rune.editKey).toBe(`source:rune:${rune.id}:${rune.trigger}`);
      expect(rune.editsWholeFamily).toBe(false);
    }
  });

  it('filters by query and policy', () => {
    const own = filterRows(rows, '', 'ownBeat');
    expect(own.every((r) => r.entry.policy === 'ownBeat')).toBe(true);
    const avenge = filterRows(rows, 'avenge', null);
    expect(avenge.length).toBeGreaterThan(0);
    expect(avenge.every((r) => /avenge/i.test(r.key) || /avenge/i.test(r.entry.family))).toBe(true);
  });

  it('builds a playable synthetic fixture batch for a row (2 repeats, source-attributed)', () => {
    const row = rows.find((r) => r.trigger === 'endOfTurn') ?? rows[0]!;
    const batch = fixtureBatch(row);
    const triggers = batch.events.filter((e) => e.type === 'sourceTrigger');
    expect(triggers.length).toBe(2);
    expect(batch.events.filter((e) => e.type === 'statsChanged' && e.parentId).length).toBe(2);
    expect(triggers[0]!.type === 'sourceTrigger' && triggers[0]!.source.label).toContain('synthetic');
  });
});
