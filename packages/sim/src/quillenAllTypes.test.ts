import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNES, EPIC_RUNES } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import { defIsTribe } from './recruit';

/**
 * QUILLEN + off-set tribes (owner report 2026-08-20: "i ate an undead, beast, and dwarf and this was my
 * discover at tier 5" — only TWO cards came back).
 *
 * Archive banks the archived minion's TYPE and pays a Discover per banked type. Its pool filter was a
 * hand-rolled `c.tribe === t || c.tribe2 === t`, which cannot see an ALL-TYPES card. Set 2 carries no Undead
 * and no Mech, so those two types matched nothing at all — and the one pick silently vanished. The cards that
 * genuinely count as every type (Paragon T5, Standard Bearer T3) were sitting right there in the pool.
 */
describe('defIsTribe — an All-types card counts as EVERY tribe', () => {
  it('matches an off-set tribe the card never prints', () => {
    for (const id of ['n2_paragon', 'n2_standardbearer']) {
      const def = CARD_INDEX[id]!;
      expect(def.tribe, `${id} prints neutral — the pair is only reachable via universalTribe`).toBe('neutral');
      expect(defIsTribe(def, 'undead'), `${id} must count as Undead`).toBe(true);
      expect(defIsTribe(def, 'mech'), `${id} must count as Mech`).toBe(true);
      expect(defIsTribe(def, 'beast')).toBe(true);
    }
  });

  it('does NOT make every card universal, and never matches "neutral" specially', () => {
    const plain = CARD_INDEX['d2_cinderchef']!; // a real Dragon
    expect(defIsTribe(plain, 'dragon')).toBe(true);
    expect(defIsTribe(plain, 'undead'), 'an ordinary card must not match an unrelated tribe').toBe(false);
    // `neutral` is excluded from the universal shortcut, matching instance-level `isTribe`.
    expect(defIsTribe(CARD_INDEX['n2_paragon']!, 'neutral')).toBe(true); // its printed tribe IS neutral
  });
});

describe("Quillen's Archive pays out for a tribe the set does not carry", () => {
  // Reproduces the owner's board: two types already banked, then ARCHIVE an Undead body (a real targeted
  // hero-power dispatch — Archive removes the minion and records its type) so the 3-count bucket pays.
  const undeadCard = Object.values(CARD_INDEX).find((c) => c.tribe === 'undead' && !c.spell && !c.ruby)!;
  const bc = (uid: string, cardId: string) => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
  };
  const armed = (): RunState => ({
    ...createRun(9, 'quillen'), phase: 'recruit', tier: 5, heroReady: true, embers: 20,
    archivedTribes: ['beast', 'dwarf'],
    board: [bc('u1', undeadCard.id)], hand: [],
  } as unknown as RunState);

  it('archiving an UNDEAD at Tier 5 pays all three banked types, not two', () => {
    const next = reduce(armed(), { type: 'heroPower', uid: 'u1' } as never);
    const picks = next.discover ?? [];
    expect(picks.length, 'beast + dwarf + undead should each contribute a pick').toBe(3);
  });

  it('the UNDEAD pick is an All-types card — Set 2 carries no other Undead', () => {
    const next = reduce(armed(), { type: 'heroPower', uid: 'u1' } as never);
    const picks = next.discover ?? [];
    const universal = picks.filter((id) => CARD_INDEX[id]?.universalTribe);
    expect(universal.length, `no All-types card in ${picks.join(', ')} — the Undead slot found nothing`).toBeGreaterThanOrEqual(1);
  });
});

describe('Rune of Pillaging + Rune of Soul Taxes are drawable again (owner 2026-08-20)', () => {
  // Both were `sets: ['set1']` — and set 1 is `enabled: false`, so the forge filter
  // (`!rn.sets || rn.sets.includes(runSet)`) hid them from every live run. Ungating + repricing.
  const find = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;

  it('neither is set-gated any more, so a set-2 run can offer them', () => {
    for (const id of ['rune_pillaging', 'rune_soul_taxes']) {
      expect(find(id).sets, `${id} must not be gated to a disabled set`).toBeUndefined();
    }
  });

  it('ship at the owner’s costs', () => {
    expect(find('rune_pillaging').cost).toBe(4);
    expect(find('rune_soul_taxes').cost).toBe(3);
  });

  it('their granted bodies resolve even though they are out-of-set Undead', () => {
    // The acceptance the owner stated: not in the shop, fine as a reward. CARD_INDEX is global by design.
    for (const id of ['pillager', 'soulsman']) {
      expect(CARD_INDEX[id], `${id} must resolve for the grant`).toBeDefined();
      expect(CARD_INDEX[id]!.tribe).toBe('undead');
    }
  });
});
