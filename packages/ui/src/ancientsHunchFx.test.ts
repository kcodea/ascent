/**
 * ANCIENTS × HUNCH presentation (2026-09-30). These drive the REAL presentation decisions from the sim's own events
 * and records, the layer the first Bonds build got wrong while its sim tests passed (owner on 5173: "ancient of bonds
 * doesnt have tendrils on it either"): a stat spell's own record swallowed the Bonds record for the same minion in
 * the Shop, and in combat the Bonds buff inherited the cast's `spellId`, so Growth's cast effect replaced its tendril.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type QuestCombatMods } from '@game/core';
import { HUNCH_BONDS_COMBAT_LABEL, type BuffFxEvent } from '@game/sim';
import { castFxReplacesTendril, heroPowerBuffLabelFor, labelBuffFxFor } from './choreo/bindings';
import { coalesceBuffFxByTarget } from './buffFxConfig';
import { spellPowerNarrationAnchor } from './choreo/spellPowerAnchor';

describe('Hunch × Bonds: tendrils from the hero-power button', () => {
  it('the combat label maps to Hunch, with no authored def replacing the generic ribbon', () => {
    expect(heroPowerBuffLabelFor(HUNCH_BONDS_COMBAT_LABEL)).toEqual({ heroId: 'hunch' });
    expect(labelBuffFxFor(HUNCH_BONDS_COMBAT_LABEL)).toBeNull();
  });

  it('SHOP: a stat spell buffing the same minion never swallows the Bonds record (both survive the coalesce)', () => {
    const spell: BuffFxEvent = { targetUid: 'a', attack: 1, health: 1, sourceCardId: '', sourceTribe: 'neutral', kind: 'spell' };
    const bonds: BuffFxEvent = { ...spell, attack: 2, health: 3, fromHeroPower: true };
    const out = coalesceBuffFxByTarget([spell, bonds]);
    expect(out).toContain(bonds);
    expect(out).toContain(spell);
    // Two ordinary records on one target still collapse to one (the Brightwing rule is unchanged).
    expect(coalesceBuffFxByTarget([spell, { ...spell }]).length).toBe(1);
  });

  it('COMBAT: every Bonds buff under a Growth cast carries no spellId, so it keeps its tendril', () => {
    const fatecarver: BoardMinion = { cardId: 'n2_fatecarver', attack: 4, health: 900, sourceUid: 'FC', chosenOption: 1 };
    const filler = (uid: string): BoardMinion => ({ cardId: 'sandbag', attack: 1, health: 900, sourceUid: uid });
    const mods = { ancientSpellEdges: { attack: 2, health: 3, label: HUNCH_BONDS_COMBAT_LABEL } } as Partial<QuestCombatMods>;
    const r = simulate([filler('L'), fatecarver, filler('R')], [{ cardId: 'sandbag', attack: 0, health: 90000 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['beast', 'dragon'], questMods: mods as QuestCombatMods }), combatSide({ tier: 1 }));
    const growth = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.spellId !== undefined);
    expect(growth.length, 'the fixture casts a spell with its own cast effect').toBeGreaterThan(0);
    expect(castFxReplacesTendril(growth[0]!.spellId), 'Growth replaces its OWN tendrils').toBe(true);
    const bonds = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === HUNCH_BONDS_COMBAT_LABEL);
    expect(bonds.length).toBeGreaterThan(0);
    for (const b of bonds) {
      expect(b.spellId).toBeUndefined();
      expect(castFxReplacesTendril(b.spellId)).toBe(false);
      expect(heroPowerBuffLabelFor(b.source)).toEqual({ heroId: 'hunch' });
    }
  });
});

describe('Hunch × Death: the +1/+1 plays at the hero power, not on the board', () => {
  it('a hero-power spell-power narration anchors on the power button; a minion one on its body', () => {
    const players = new Set(['m1']);
    expect(spellPowerNarrationAnchor({ type: 'sc', source: 'm1', text: '+1/+1 Spell Power', side: 'player', heroPower: true }, players))
      .toEqual({ kind: 'heroPower', attack: 1, health: 1 });
    expect(spellPowerNarrationAnchor({ type: 'sc', source: 'm1', text: '+2/+2 Spell Power' }, players))
      .toEqual({ kind: 'unit', uid: 'm1', attack: 2, health: 2 });
    expect(spellPowerNarrationAnchor({ type: 'sc', source: 'e1', text: '+2/+2 Spell Power' }, players)).toBeNull();
    expect(spellPowerNarrationAnchor({ type: 'sc', source: 'm1', text: 'hello' }, players)).toBeNull();
  });
});
