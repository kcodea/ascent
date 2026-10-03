import { describe, expect, it } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, runeSynergies } from '@game/content';
import { combatSide, extraTriggerFires, instantiate, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { createRun, deserialize, serialize, type BoardCard, type RunState } from './state';
import { reduce, runeforgePool } from './reducer';
import { isTribe, playedThisTurnFor } from './recruit';

/**
 * RUNE OF DRAKKO (owner 2026-10-03): "add this rune to set 2 and 3: All Drakko - 4 cost: Get a Drakko with
 * Dragon/Spirit type." Follow-ups: pool "Epic"; name "Rune of Drakko"; gate "if either tribe is in a set it should
 * be offered. categorize it as a dragon and/or spirit rune".
 *
 * The granted body is `n2_drakko_dragonspirit`: Drakko (`drummer`) printed as a Dragon / Spirit dual type, so every
 * def-level, id-keyed and combat tribe check sees both types with no special-casing.
 */
const TOKEN = 'n2_drakko_dragonspirit';

const card = (uid: string, cardId: string, golden = false): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
};

const forgeRun = (setId: 'set1' | 'set2' | 'set3', tribes: string[]): RunState =>
  ({ ...createRun(7, undefined, 'ascent', undefined, setId), tribes, runeforgeEpic: true } as RunState);

describe('the Dragon / Spirit Drakko', () => {
  it("is Drakko's body and rule, printed as a Dragon / Spirit dual type, forge-only", () => {
    const d = CARD_INDEX[TOKEN]!;
    const base = CARD_INDEX['drummer']!;
    expect(d.name).toBe('Drakko');
    expect([d.tribe, d.tribe2]).toEqual(['dragon', 'spirit']);
    expect([d.tier, d.attack, d.health]).toEqual([base.tier, base.attack, base.health]);
    expect([d.text, d.goldenText]).toEqual([base.text, base.goldenText]);
    expect(d.triggerMultiplier).toMatchObject({ families: ['battlecry'], factor: 2, group: 'drummer' });
    expect(d.token, 'never drawable from a shop').toBe(true);
  });

  it('shares Drakko\'s non-stacking multiplier slot: with a regular Drakko it is still twice, never four times', () => {
    const get = (id: string) => CARD_INDEX[id];
    expect(extraTriggerFires('battlecry', [{ cardId: TOKEN }], get)).toBe(1);
    expect(extraTriggerFires('battlecry', [{ cardId: TOKEN }, { cardId: 'drummer' }], get)).toBe(1);
    expect(extraTriggerFires('battlecry', [{ cardId: TOKEN, golden: true }, { cardId: 'drummer' }], get)).toBe(2);
    // A DIFFERENT multiplier still multiplies with it (the group is Drakko's, not a global one).
    expect(extraTriggerFires('endOfTurn', [{ cardId: TOKEN }, { cardId: 'chronos' }], get)).toBe(1);
  });
});

describe('Rune of Drakko', () => {
  it('is an Epic 4-cost rune in Set 2 and Set 3, gated on Dragon OR Spirit, that grants exactly the token', () => {
    const r = RUNE_INDEX['rune_drakko']!;
    expect(r.name).toBe('Rune of Drakko');
    expect(r.cost).toBe(4);
    expect(r.epic).toBe(true);
    expect(EPIC_RUNES.some((x) => x.id === 'rune_drakko')).toBe(true);
    expect(RUNES.some((x) => x.id === 'rune_drakko'), 'Epic pool only').toBe(false);
    expect(r.sets).toEqual(['set2', 'set3']);
    expect(r.tribes).toEqual(['dragon', 'spirit']);
    expect(r.text).toBe('Get a **Drakko** that is a **Dragon** and a **Spirit**.');
    expect(r.reward).toEqual({ kind: 'grant', cards: [TOKEN] });
  });

  it('is categorised as BOTH a Dragon and a Spirit rune for the forge synergy pick', () => {
    expect([...runeSynergies(RUNE_INDEX['rune_drakko']!)].sort()).toEqual(['dragon', 'spirit']);
  });

  it('the Epic forge offers it in Set 2 and Set 3 when EITHER tribe rolled, never in Set 1, never without both', () => {
    expect(runeforgePool(forgeRun('set2', ['kobold', 'dragon', 'beast', 'demon', 'dwarf']))).toContain('rune_drakko');
    expect(runeforgePool(forgeRun('set3', ['kobold', 'dwarf', 'undead', 'spirit', 'celestial']))).toContain('rune_drakko');
    expect(runeforgePool(forgeRun('set3', ['kobold', 'dwarf', 'undead', 'celestial']))).not.toContain('rune_drakko');
    expect(runeforgePool(forgeRun('set2', ['kobold', 'beast', 'demon', 'dwarf']))).not.toContain('rune_drakko');
    expect(runeforgePool(forgeRun('set1', ['beast', 'dragon', 'mech', 'undead', 'demon']))).not.toContain('rune_drakko');
    // The Basic forge never offers it.
    const basic = { ...forgeRun('set2', ['kobold', 'dragon', 'beast', 'demon', 'dwarf']), runeforgeEpic: undefined } as RunState;
    expect(runeforgePool(basic)).not.toContain('rune_drakko');
  });

  it('buying it puts the Dragon / Spirit Drakko in hand, and the grant survives save/restore', () => {
    let s: RunState = { ...createRun(3, undefined, 'ascent', undefined, 'set2'), hand: [], embers: 50 };
    s = { ...s, runeforgeOffer: ['rune_drakko'], runeforgeEpic: true };
    s = reduce(s, { type: 'buyRune', index: 0 });
    const got = s.hand.filter((c) => c.cardId === TOKEN);
    expect(got).toHaveLength(1);
    expect(isTribe(got[0]!, 'dragon') && isTribe(got[0]!, 'spirit')).toBe(true);
    const restored = deserialize(serialize(s));
    expect(restored.hand.filter((c) => c.cardId === TOKEN)).toHaveLength(1);
    expect(s.ownedRunes).toContain('rune_drakko');
    expect(restored.ownedRunes).toContain('rune_drakko');
  });
});

describe('it counts as a Dragon AND a Spirit for synergies', () => {
  it('shop: playing it grows a Dragon watcher (Vaultkeeper) and a Spirit hand-watcher, and tallies both tribes', () => {
    let s: RunState = {
      ...createRun(5, undefined, 'ascent', undefined, 'set3'),
      board: [card('vk', 'd2_herzog')],
      hand: [card('dk', TOKEN), card('sl', 'sp3_slumbering')],
      embers: 10,
    };
    const vk0 = s.board[0]!.attack, sl0 = s.hand[1]!.attack;
    s = reduce(s, { type: 'play', uid: 'dk' });
    expect(s.board.some((c) => c.cardId === TOKEN), 'the Drakko was played').toBe(true);
    expect(s.board.find((c) => c.uid === 'vk')!.attack, 'Vaultkeeper: "whenever you play a Dragon"').toBeGreaterThan(vk0);
    expect(s.hand.find((c) => c.uid === 'sl')!.attack, 'Slumbering: "whenever you play a Spirit"').toBe(sl0 + 4);
    expect(playedThisTurnFor(s, 'dragon')).toBe(1);
    expect(playedThisTurnFor(s, 'spirit')).toBe(1);
  });

  it('combat: the instance is a Dragon / Spirit, and a Dragon payoff (Traveling Skald) buffs it when it attacks', () => {
    let n = 0;
    const m = instantiate({ cardId: TOKEN, attack: 3, health: 5 } as BoardMinion, 'player', CARD_INDEX, () => `u${n++}`);
    expect([m.tribe, m.tribe2]).toEqual(['dragon', 'spirit']);

    const bm = (cardId: string, attack: number, health: number): BoardMinion =>
      ({ cardId, attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])] } as unknown as BoardMinion);
    const r = simulate(
      [bm(TOKEN, 3, 50), bm('d2_skald', 1, 50)],
      [bm('k_candleback', 1, 60)],
      makeRng(1), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }),
    );
    const drakko = r.initial.player[0]!.uid;
    const firstAttack = r.events.findIndex((e) => e.type === 'attack' && e.attacker === drakko);
    expect(firstAttack, 'the Drakko swings').toBeGreaterThanOrEqual(0);
    const skald = r.initial.player[1]!.uid;
    const buffed = r.events.slice(firstAttack).some((e: CombatEvent) =>
      e.type === 'buff' && e.target === drakko && e.source === skald && e.attack === 3 && e.health === 2);
    expect(buffed, 'Skald: "When another friendly Dragon attacks, give it +3/+2"').toBe(true);
  });
});
