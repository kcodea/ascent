import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_CARDS, CARD_INDEX } from '@game/content';
import { spellDisplayText } from './recruit';

/**
 * SPELL POWER MUST SHOW (owner report 2026-07-26). Hoardflame printed "+4/+4" while a Spellbinder's +0/+1 was
 * in play — and worse, its factory never applied the bonus at all, so the printed lie was accurate to a broken
 * effect. The owner asked whether other spells share the defect; this test answers that continuously.
 *
 * The check is derived, not a hand-list: read `recruit.ts`, find which cast factories actually call
 * `spellAttackBonus`/`spellHealthBonus`, and require every spell using one of them to print a LIVE value once
 * spell power exists. A spell that grants a bonus it never shows is exactly the defect.
 */
const SRC = readFileSync(join(__dirname, 'recruit.ts'), 'utf8');

/** Factory ids whose body reads the run's spell power. */
function factoriesApplyingSpellPower(): Set<string> {
  const out = new Set<string>();
  // Bound each body by the NEXT factory declaration rather than by the first `\n  },` — a factory containing a
  // nested object closes on that token too, so the naive version ran past the end and attributed a NEIGHBOUR's
  // spell power to five innocent spells (Devour, Mend, Lasso, Last Stand, Executioner's Edge). A false positive
  // here is worse than none: it sends you rewriting text that was already correct.
  const decls = [...SRC.matchAll(/\n {2}([a-zA-Z][a-zA-Z0-9]*): \(ctx[^)]*\) => \{/g)];
  for (let i = 0; i < decls.length; i++) {
    const start = decls[i]!.index! + decls[i]![0].length;
    const end = i + 1 < decls.length ? decls[i + 1]!.index! : SRC.length;
    if (/spell(Attack|Health)Bonus\(/.test(SRC.slice(start, end))) out.add(decls[i]![1]!);
  }
  return out;
}

const APPLIES = factoriesApplyingSpellPower();

/** Every shop spell whose cast effect picks up spell power. */
const SCALING_SPELLS = ALL_CARDS.filter(
  (c) => c.spell && !c.token && (c.effects ?? []).some((e) => e.on === 'cast' && APPLIES.has(e.do)),
);

describe('spell power is visible on every spell that gets it', () => {
  it('the sweep found the factories and the spells (guards against a vacuous audit)', () => {
    expect(APPLIES.size, 'factories reading spell power').toBeGreaterThan(3);
    expect(SCALING_SPELLS.length, 'spells using them').toBeGreaterThan(5);
  });

  it.each(SCALING_SPELLS.map((c) => [c.name, c.id] as const))(
    '%s prints a live value when spell power is up',
    (_name, id) => {
      const printed = CARD_INDEX[id]!.text;
      const live = spellDisplayText(id, 2, 0, 3, 0, 0, 0, { tier: 4 }); // a tier for the tier-scaled ones
      expect(live, `${id}: printed text unchanged despite +2/+3 spell power`).not.toBe(printed);
      expect(live, `${id}: no live value injected`).toContain('{{');
    },
  );

  it('Hoardflame specifically — the card that prompted this', () => {
    // The owner's case: a +0/+1 spell buff and no Dragons played yet.
    expect(spellDisplayText('hoardflame', 0, 0, 1, 0, 0, 0, {}), 'shows +4/+5, not the printed +4/+4')
      .toContain('{{+4/+5}}');
    // …and the per-Dragon term still stacks on top of it.
    expect(spellDisplayText('hoardflame', 0, 0, 1, 0, 0, 0, { playedThisTurn: ['d2_embermouth', 'd2_embermouth'] }))
      .toContain('{{+6/+7}}');
    // With no spell power and no Dragons, the printed text is already correct and stays plain.
    expect(spellDisplayText('hoardflame', 0, 0, 0, 0, 0, 0, {})).toBe(CARD_INDEX['hoardflame']!.text);
  });

  it('Lantern Light — the only OTHER spell that shared the defect', () => {
    // Its grant is +Tier/+Tier plus spell power; the printed "+1/+1 for each Tavern Tier" showed neither.
    expect(spellDisplayText('lanternlight', 1, 0, 0, 0, 0, 0, { tier: 4 })).toContain('{{+5/+4}}');
    expect(spellDisplayText('lanternlight', 0, 0, 0, 0, 0, 0, { tier: 3 })).toContain('{{+3/+3}}');
  });
});
