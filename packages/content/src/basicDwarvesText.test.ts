import { describe, expect, it } from 'vitest';
import { RUNES } from './runes';
import { runeSynergies } from './runeSynergy';

/** Rune of Basic Dwarves said "Get a **Dwarve**" (owner 2026-09-27: "fix rune of basic dwarves text"). The typo also
 *  hid the rune from the board-fit matcher, whose Dwarf word is /dwar(f|ves|ven)/. */
describe('Rune of Basic Dwarves', () => {
  const rune = RUNES.find((r) => r.id === 'rune_basic_dwarf')!;
  it('reads "Get a Dwarf", like its Basic siblings', () => {
    expect(rune.text).toBe('Get a **Dwarf**. Repeat every **Start of Turn**.');
  });
  it('is tagged Dwarf for the Runeforge board-fit', () => {
    expect(runeSynergies(rune)).toContain('dwarf');
  });
});
