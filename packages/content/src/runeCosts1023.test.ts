import { describe, expect, it } from 'vitest';
import { RUNES, EPIC_RUNES, ARCHIVED_RUNES, RUNE_INDEX } from './runes';

/**
 * Owner rune cost pass 2026-10-23 (R-RUNE-COSTS-1023-01): Basic 3/4/5 -> -1 and 6+ -> -2; Epic 4/5/6/7 -> -1 and
 * 8+ -> -2. The pass leaves no Basic rune above 4 Gold and no Epic rune above 6 Gold, so a later edit that
 * reprices one above those caps is a deliberate owner call and should update this test with it.
 */
describe('rune cost pass 2026-10-23', () => {
  const all = [...RUNES, ...EPIC_RUNES, ...ARCHIVED_RUNES];

  it('no Basic rune costs more than 4 and no Epic rune more than 6', () => {
    expect(all.filter((r) => !r.epic && r.cost > 4).map((r) => r.id)).toEqual(['rune_top_hat']); // owner kept Top Hat at 6
    expect(all.filter((r) => r.epic && r.cost > 6).map((r) => r.id)).toEqual([]);
  });

  it('spot checks: each band moved by its step, 1-2 Basic and 1-3 Epic unchanged', () => {
    const cost = (id: string) => RUNE_INDEX[id]?.cost;
    expect(cost('rune_spellslinging')).toBe(4); // Basic 5 -> 4
    expect(cost('rune_epic_forge')).toBe(2); // Basic 3 -> 2
    expect(cost('rune_top_hat')).toBe(6); // owner 2026-10-23: "put top hat back to 6 cost"
    expect(cost('rune_happy_birthday')).toBe(2); // Basic 2, unchanged
    expect(cost('rune_ornate_clock')).toBe(1); // Basic 1, unchanged
    expect(cost('rune_roseys_garden')).toBe(3); // Epic 4 -> 3
    expect(cost('rune_frontline_glory')).toBe(6); // Epic 8 -> 6
    expect(cost('rune_return_customers')).toBe(3); // Epic 3, unchanged
  });
});
