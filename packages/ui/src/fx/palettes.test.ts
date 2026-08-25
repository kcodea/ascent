import { describe, it, expect } from 'vitest';
import { PALETTE_LIBRARY, PALETTE_STOP_LABELS, PALETTE_PRESETS } from './palettes';

describe('palette library', () => {
  const all = Object.values(PALETTE_LIBRARY).flatMap((g) => Object.entries(g));
  it('labels are rim->core', () => expect(PALETTE_STOP_LABELS).toEqual(['Rim', 'Outer', 'Inner', 'Core']));
  it('every preset is 4 valid stops', () => {
    for (const [, cols] of all) {
      expect(cols).toHaveLength(4);
      cols.forEach((c) => { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(0xffffff); });
    }
  });
  it('names are unique across groups', () => {
    const names = all.map(([n]) => n); expect(new Set(names).size).toBe(names.length);
  });
  it('includes the original presets', () => {
    for (const k of Object.keys(PALETTE_PRESETS)) expect(all.some(([n]) => n.toLowerCase() === k)).toBe(true);
  });
});
