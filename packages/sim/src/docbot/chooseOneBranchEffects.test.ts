import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CARD_INDEX } from '@game/content';
import { allEffectsOf, isStatSpell, spellDisplayText } from '../recruit';

/**
 * DOC BOT LANE `chooseOneBranchEffects` — a Choose One card's effects live in its BRANCHES, and every lookup
 * that reasons about "what this card does" has to look there too.
 *
 * ── The bug (owner report 2026-08-31) ─────────────────────────────────────────────────────────────────────
 *
 *   *"apples doesnt show the current values with spell power buffs."*
 *
 * Apples has `effects: []` and two `chooseOne` branches. Its second one fires
 * `spellBuffRandomFriendlies`, which folds the run's spell power into what it grants. But `spellDisplayText`
 * found that factory with `def.effects.find(...)`, which on a Choose One card is an empty list — so the card
 * printed a static "+1/+1" while actually granting more. `isStatSpell` had the identical hole, which also
 * kept Rune of Thrift from discounting a spell that plainly gives stats.
 *
 * ── Why this whole SHAPE is worth a lane ──────────────────────────────────────────────────────────────────
 *
 * `def.effects.find(...)` is the obvious way to ask what a card does, it is written all over the codebase,
 * and on a Choose One card it silently answers "nothing". Nothing about it looks wrong at the call site —
 * which is exactly the property that makes it worth a standing check rather than one fix.
 *
 * The rule is the card-text rule the repo already keeps: a printed magnitude that depends on live state must
 * print the live number. So this drives the real display function and demands the number MOVE.
 */

/** Factories that fold the run's spell power into what they grant, verified in `recruit.ts` factory bodies. */
const SCALES_WITH_SPELL_POWER = new Set(['spellBuffRandomFriendlies', 'spellBuffLeftmost']);

describe('Doc Bot — a Choose One branch is still an effect', () => {
  const chooseOneCards = ALL_CARDS.filter((c) => (c.chooseOne?.length ?? 0) > 0);

  it('finds Choose One cards at all (a floor — the sweep must not pass by matching nothing)', () => {
    expect(chooseOneCards.length, 'the pool has Choose One cards').toBeGreaterThan(5);
  });

  it('allEffectsOf sees branch effects that def.effects cannot', () => {
    // Apples is the worked case, and the asymmetry IS the bug: one list is empty, the other is not.
    const apples = CARD_INDEX['apples']!;
    expect(apples.effects.length, 'its top-level list is empty, as a Choose One card\u2019s usually is').toBe(0);
    expect(allEffectsOf(apples).map((e) => e.do)).toContain('spellBuffRandomFriendlies');
  });

  it('a spell that gives stats down a BRANCH still counts as a stat spell', () => {
    // Rune of Thrift discounts stat spells and Rune of the Gilded Ledger casts one; both read `isStatSpell`,
    // and both were silently skipping Apples.
    expect(isStatSpell(CARD_INDEX['apples'])).toBe(true);
  });

  it('every branch grant that scales with spell power PRINTS the scaled number', () => {
    // The card-text rule, applied to branches: with spell power up, the printed value must move.
    const stale: string[] = [];
    for (const def of chooseOneCards) {
      if (!def.spell) continue;
      const scaling = allEffectsOf(def).filter((e) => SCALES_WITH_SPELL_POWER.has(e.do));
      if (scaling.length === 0) continue;
      const flat = spellDisplayText(def.id, 0, 0, 0);
      const powered = spellDisplayText(def.id, 2, 0, 2);
      if (flat === powered) stale.push(def.id);
    }
    expect(stale,
      'these Choose One spells grant more than they print once spell power is up. The lookup that decides '
      + 'the printed value is reading `def.effects`, which is empty on a Choose One card \u2014 use '
      + '`allEffectsOf`').toEqual([]);
  });

  it('and a FLAT branch is left alone — the fix must not invent scaling', () => {
    // Apples' first option buffs the current shop and takes no spell power by design (`spellBuffTavern` is
    // flat, and says so). Greening it would be the same defect pointed the other way: a number that claims
    // to have grown when the effect will not grant it.
    const powered = spellDisplayText('apples', 2, 0, 2);
    expect(powered.includes('+2/+4'), 'the flat shop buff still prints its authored value').toBe(true);
  });
});
