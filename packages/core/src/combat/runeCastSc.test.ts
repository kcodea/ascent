import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';

/**
 * A RUNE'S COMBAT CAST ANNOUNCES ITSELF (owner ruling 2026-09-24: *"spells cast from runes and cards should use the
 * spell effects … they can stem from the rune if there needs to be a source position"*). Every combat cast logs one
 * "X casts Y" `sc` stamped `spellId`: that is what the spell's own cast effect (the `spellCastFx` cue) keys on.
 * Rune of Spellhide's Start-of-Combat re-cast resolved through `resolveCombatSpellCast` (so its buffs were tagged)
 * but never announced, so a bound spell would have lost BOTH its effect and its tendril. It now logs the `sc` with
 * `rune` (the caster) and `side`, so the effect stems from the rune's node for the player's own rune.
 */
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 90000 }];
const scs = (events: readonly CombatEvent[]) => events.filter((e): e is Extract<CombatEvent, { type: 'sc' }> => e.type === 'sc' && typeof e.spellId === 'string');

describe('Rune of Spellhide: the Start-of-Combat re-cast', () => {
  const beast: BoardMinion = { cardId: 'stray', attack: 2, health: 2 };
  // Combat uids are minted in board order, player side first: the lone player Beast is m0, an enemy one behind a
  // one-minion player wall is m1. The re-cast finds its Beast by COMBAT uid (`m.uid === rec.uid`), so these tests
  // hand it the combat uid directly. (The sim records the RUN uid, which lands on the body as `sourceUid`, not
  // `uid`: flagged separately as a gameplay bug, out of this presentation change's scope.)

  it('announces the cast once, stamped with the spell, the rune and the side; its buffs carry the spell', () => {
    const r = simulate([beast], wall, makeRng(3), CARD_INDEX, combatSide({ tier: 3, spellhide: [{ spellId: 'spiritfire', uid: 'm0' }] }), combatSide({ tier: 1 }));
    const sc = scs(r.events).filter((e) => e.rune === 'rune_spellhide');
    expect(sc).toHaveLength(1);
    expect(sc[0]).toMatchObject({ spellId: 'spiritfire', rune: 'rune_spellhide', side: 'player', text: 'Rune of Spellhide casts Spirit Fire' });
    const buffs = r.events.filter((e) => e.type === 'buff' && e.target === sc[0]!.source);
    expect(buffs.length, 'the re-cast buffed the Beast').toBeGreaterThan(0);
    expect(buffs.every((e) => e.type === 'buff' && e.spellId === 'spiritfire')).toBe(true);
  });

  it('an ENEMY seat\'s Spellhide is stamped enemy (the presentation only stems from the player\'s own rune node)', () => {
    const r = simulate(wall, [beast], makeRng(3), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 3, spellhide: [{ spellId: 'spiritfire', uid: 'm1' }] }));
    const sc = scs(r.events).filter((e) => e.rune === 'rune_spellhide');
    expect(sc).toHaveLength(1);
    expect(sc[0]!.side).toBe('enemy');
  });

  it('no remembered spell, no announcement', () => {
    const r = simulate([beast], wall, makeRng(3), CARD_INDEX, combatSide({ tier: 3 }), combatSide({ tier: 1 }));
    expect(scs(r.events).filter((e) => e.rune)).toHaveLength(0);
  });
});
