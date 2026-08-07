import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import * as cardText from './cardText';

/**
 * THE LIVE-TEXT RULE, ENFORCED (CLAUDE.md): a card whose magnitude depends on live run/combat state must print
 * the number it will actually produce right now — never the base rate alone.
 *
 * Groveweaver broke it (owner report 2026-07-25): its summon grant grows with every spell cast, but the printed
 * "+2/+4" never moved. The owner asked for an audit of the rest of Set 2, and an audit that lives only in a
 * chat message rots — so it lives here, as a test that fails when a NEW scaling card ships without a helper.
 *
 * How it works: any effect that reads a per-instance accrual field is a card whose printed magnitude can drift.
 * Each one must either be covered by a cardText helper or be listed below with the reason it doesn't need one.
 */

/** Factory ids that SIZE their grant from a per-instance accrual (`summonBonus` and friends). */
const SCALING_FACTORIES = new Set([
  'summonBuffTribeAsym',      // Groveweaver — grows per spell cast
  'scBeastAura',              // Kennelmaster — grows per Avenge
  'buffOnSummon',
  'rallyTribeAuraGrowing',    // Trophy Stalker
  'summonBuffTribeImprove',   // Mama Bear
  'onSummonTribeBuffThenDouble', // Denkeeper Oona — flat half grows per Avenge
]);

/**
 * Cards exempt from needing a text helper, each with the reason. An exemption is a claim that the printed text
 * is ALREADY honest — not a licence to skip the rule.
 */
const EXEMPT: Record<string, string> = {
  // Oona's own text names the doubling, and the flat half is shown by the Avenge counter on the card plate.
  b2_oona: 'the printed +1/+1 is the base of an Avenge-improved grant, surfaced by the Avenge meter',
};

/** Which helper covers which factory. */
const COVERED_BY: Record<string, (id: string) => string | null> = {
  summonBuffTribeAsym: (id) => cardText.asymSummonBuffText(id, 3),
  scBeastAura: (id) => cardText.summonBuffText(id, 3),
  buffOnSummon: (id) => cardText.summonBuffText(id, 3),
  rallyTribeAuraGrowing: (id) => cardText.summonBuffText(id, 3),
  summonBuffTribeImprove: (id) => cardText.summonImproveText(id, 3, false),
  onSummonTribeBuffThenDouble: () => null, // exempt above
};

describe('live card text — every scaling card prints its CURRENT value', () => {
  const scaling = Object.values(CARD_INDEX).filter((c) =>
    (c.effects ?? []).some((e) => SCALING_FACTORIES.has(e.do)),
  );

  it('the sweep actually finds cards (guards against a vacuous audit)', () => {
    expect(scaling.length).toBeGreaterThan(3);
  });

  it.each(
    Object.values(CARD_INDEX)
      .filter((c) => (c.effects ?? []).some((e) => SCALING_FACTORIES.has(e.do)))
      .map((c) => [c.name, c.id] as const),
  )('%s prints a live value once it has accrued', (_name, id) => {
    if (EXEMPT[id]) return;
    const def = CARD_INDEX[id]!;
    const eff = def.effects.find((e) => SCALING_FACTORIES.has(e.do))!;
    const live = COVERED_BY[eff.do]?.(id) ?? null;
    expect(live, `${def.name} (${eff.do}) has no cardText helper — its printed magnitude will go stale`).not.toBeNull();
    // A helper that returns the text unchanged is worse than none: it looks covered and isn't.
    expect(live, `${def.name}: the helper returned the printed text without injecting a live value`).toContain('{{');
  });

  it('Groveweaver specifically — the card that prompted the audit', () => {
    // The MECHANIC was fine all along: one spell raises the accrual and the next Beast really does land
    // bigger. What was broken was the printed rate, which never moved — so the card looked like it wasn't
    // improving. Numbers per the owner's 2026-08-04 balance: base +3/+3, +2/+2 per spell.
    const base = CARD_INDEX['b2_groveweaver']!.text;
    expect(base, 'the printed base rate').toContain('+3/+3');
    expect(cardText.asymSummonBuffText('b2_groveweaver', 0), 'no accrual → printed text is correct').toBeNull();
    expect(cardText.asymSummonBuffText('b2_groveweaver', 2), 'after one spell').toContain('{{+5/+5}}');
    expect(cardText.asymSummonBuffText('b2_groveweaver', 4), 'after two').toContain('{{+7/+7}}');
    expect(cardText.asymSummonBuffText('b2_groveweaver', 2, true), 'golden doubles the live value').toContain('{{+10/+10}}');
  });
});
