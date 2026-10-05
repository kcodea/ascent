import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { spellScalesWithSpellPower } from './handBuffFx';

/**
 * R-HANDFX-01 — a spell-power gain pops ONLY the held spells whose printed value it moves. Before, every spell in
 * hand played the `hand-buff` cue (End of Turn's Aeon Guard / Void Curator, a mid-combat gain, Front to Back), so a
 * Lasso or a Mend looked buffed when nothing about it had changed (owner report 2026-10-05).
 */
describe('spellScalesWithSpellPower (R-HANDFX-01)', () => {
  it('a stat spell whose value spell power raises still pops', () => {
    for (const id of ['growth', 'bulwark', 'sp_dragonflame', 'wo_attack']) {
      expect(CARD_INDEX[id]?.spell, `${id} is a spell`).toBe(true);
      expect(spellScalesWithSpellPower(id), id).toBe(true);
    }
  });

  it('a spell spell power does not touch is never popped', () => {
    // Lasso / Mend / On the House grant no stats; Tower Shield and a Gift are flat by design.
    for (const id of ['lasso', 'mend', 'onthehouse', 'tower_shield', 'gift_encore']) {
      expect(CARD_INDEX[id]?.spell, `${id} is a spell`).toBe(true);
      expect(spellScalesWithSpellPower(id), id).toBe(false);
    }
  });

  it('a minion or a Ruby is never a spell-power pop (Rubies have their own channel)', () => {
    expect(spellScalesWithSpellPower('dw_brunni')).toBe(false);
    const ruby = Object.values(CARD_INDEX).find((c) => c.ruby);
    expect(ruby).toBeDefined();
    expect(spellScalesWithSpellPower(ruby!.id)).toBe(false);
  });
});
