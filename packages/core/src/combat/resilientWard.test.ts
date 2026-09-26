import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent, type Keyword } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * RESILIENT WARD (`RW`, Ancients POC, owner 2026-09-26: "Takes 2 hits to break"). It rides beside Ward (`DS`):
 *
 *   · the FIRST hit is absorbed like a Ward's and strips only the Resilient layer (`wardDowngrade`), leaving a plain
 *     Ward — it is not a break (`onLoseDivineShield` stays quiet, the break tally does not count it);
 *   · the SECOND hit breaks the Ward as usual (`shield`); the third lands.
 *   · Ward's existing rules carry over: it blocks Execute (the venom is not spent), a shield-bypassing destroy skips
 *     both layers, and every separate damage instance (Flurry's second swing, a Cleave splash) is a separate hit.
 *
 * Plus the two Warden Ancient combat mods that read Wards: Bonds (a Warded gain gives another Warded +5 Attack,
 * never re-triggering itself) and the Ward-break log Fortune / Genesis settle from.
 */
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
/** A plain body (Rising Pup): no on-damaged reactions to blur the hit order. */
const body = (attack: number, health: number, keywords: Keyword[]): BoardMinion => bm('u3_poochy', { attack, health, keywords });
const fight = (mine: BoardMinion[], foes: BoardMinion[], mods: object = {}, cards = CARD_INDEX, seed = 3) =>
  simulate(mine, foes, makeRng(seed), cards, combatSide({ tier: 6, questMods: mods }), combatSide({ tier: 6 }));
/** The ward-relevant events that landed on `uid`, in order. */
const hitsOn = (evs: CombatEvent[], uid: string): string[] =>
  evs.filter((e) => (e.type === 'wardDowngrade' || e.type === 'shield' || e.type === 'dmg' || e.type === 'poison') && e.target === uid).map((e) => e.type);

describe('Resilient Ward — takes 2 hits to break', () => {
  it('hit 1 downgrades to a plain Ward (absorbed), hit 2 breaks the Ward, hit 3 lands', () => {
    const r = fight([body(0, 20, ['DS', 'RW'])], [body(3, 500, [])]);
    const me = r.initial.player[0]!.uid;
    expect(hitsOn(r.events, me).slice(0, 3)).toEqual(['wardDowngrade', 'shield', 'dmg']);
    expect(r.initial.player[0]!.keywords).toEqual(expect.arrayContaining(['DS', 'RW']));
  });

  it('a body carrying only RW is normalised to a Ward as well (both layers)', () => {
    const r = fight([body(0, 20, ['RW'])], [body(3, 500, [])]);
    const me = r.initial.player[0]!.uid;
    expect(hitsOn(r.events, me).slice(0, 3)).toEqual(['wardDowngrade', 'shield', 'dmg']);
  });

  it('a plain Ward is unchanged: one hit breaks it', () => {
    const r = fight([body(0, 20, ['DS'])], [body(3, 500, [])]);
    const me = r.initial.player[0]!.uid;
    expect(hitsOn(r.events, me).slice(0, 2)).toEqual(['shield', 'dmg']);
    expect(r.events.some((e) => e.type === 'wardDowngrade')).toBe(false);
  });

  it('vs EXECUTE: both layers block it and the venom is not spent until a hit lands', () => {
    const r = fight([body(0, 20, ['DS', 'RW'])], [body(1, 500, ['V'])]);
    const me = r.initial.player[0]!.uid;
    const foe = r.initial.enemy[0]!.uid;
    expect(hitsOn(r.events, me)).toEqual(['wardDowngrade', 'shield', 'dmg', 'poison']);
    const venomLost = r.events.findIndex((e) => e.type === 'venomLost' && e.target === foe);
    const shieldAt = r.events.findIndex((e) => e.type === 'shield' && e.target === me);
    expect(venomLost).toBeGreaterThan(shieldAt); // spent only on the landed hit
  });

  it('MULTI-HIT (Flurry): each swing is its own hit — the first downgrades, the second breaks', () => {
    const r = fight([body(0, 20, ['DS', 'RW'])], [body(3, 500, ['W'])]);
    const me = r.initial.player[0]!.uid;
    const firstAttack = r.events.findIndex((e) => e.type === 'attack');
    const secondAttack = r.events.findIndex((e, i) => i > firstAttack && e.type === 'attack');
    const between = r.events.slice(firstAttack, secondAttack);
    expect(between.some((e) => e.type === 'wardDowngrade' && e.target === me)).toBe(true);
    expect(hitsOn(r.events, me).slice(0, 3)).toEqual(['wardDowngrade', 'shield', 'dmg']);
  });

  it('MULTI-HIT (Cleave splash): the splash is a separate hit on each Resilient neighbour', () => {
    const r = fight([body(0, 20, ['DS', 'RW', 'T']), body(0, 20, ['DS', 'RW']), body(0, 20, ['DS', 'RW'])], [body(3, 500, ['C'])]);
    const struck = new Set(r.events.filter((e) => e.type === 'wardDowngrade').map((e) => (e as { target: string }).target));
    expect(struck.size).toBeGreaterThanOrEqual(2); // the target and at least one neighbour, one layer each
  });

  it('a shield-bypassing DESTROY skips both layers (Ward\'s rule)', () => {
    const destroyer: CardDef = { ...CARD_INDEX.u3_poochy!, id: 'test_destroyer', name: 'Test Destroyer', keywords: ['SC'],
      effects: [{ on: 'startOfCombat', do: 'scDestroyHighestAttack' }] };
    const cards = { ...CARD_INDEX, test_destroyer: destroyer };
    const r = fight([body(9, 20, ['DS', 'RW'])], [{ cardId: 'test_destroyer', attack: 1, health: 50, keywords: ['SC'] } as unknown as BoardMinion], {}, cards);
    const me = r.initial.player[0]!.uid;
    expect(r.events.some((e) => (e.type === 'wardDowngrade' || e.type === 'shield') && e.target === me)).toBe(false);
    expect(r.events.some((e) => e.type === 'death' && e.target === me)).toBe(true);
  });

  it('Rebirth returns the FULL body, its Resilient Ward restored', () => {
    const r = fight([body(5, 5, ['DS', 'RW', 'RB'])], [body(100, 500, [])]);
    const back = r.events.find((e) => e.type === 'reborn') as Extract<CombatEvent, { type: 'reborn' }> | undefined;
    expect(back?.rebirth).toBe(true);
    expect(back?.keywords).toEqual(expect.arrayContaining(['DS', 'RW']));
  });

  it('is deterministic (same seed, same log)', () => {
    const a = fight([body(2, 20, ['DS', 'RW']), body(2, 9, ['DS'])], [body(3, 40, ['W']), body(2, 30, ['C'])], {}, CARD_INDEX, 11);
    const b = fight([body(2, 20, ['DS', 'RW']), body(2, 9, ['DS'])], [body(3, 40, ['W']), body(2, 30, ['C'])], {}, CARD_INDEX, 11);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});

describe('Warden Ancients — combat mods', () => {
  it('the Ward-break log: one entry per friendly BREAK (a downgrade is not a break), only with the mod', () => {
    const on = fight([body(0, 30, ['DS', 'RW'])], [body(3, 500, [])], { ancientTrackWardBreaks: true });
    expect(on.playerWardBreaks).toEqual(['u3_poochy']);
    const off = fight([body(0, 30, ['DS', 'RW'])], [body(3, 500, [])]);
    expect(off.playerWardBreaks).toBeUndefined();
  });

  it('BONDS: a Warded gain gives ANOTHER Warded friend +5 Attack, and that grant never re-triggers it', () => {
    // Rulebreaker's Crown doubles the left-most's Attack at Start of Combat: one gain on a Warded body.
    const r = fight([body(4, 50, ['DS']), body(1, 50, ['DS']), body(1, 50, [])], [body(0, 500, [])],
      { doubleLeftmostAttack: true, ancientBonds: { attack: 5, label: 'Ancient of Bonds' } });
    const [a, b] = r.initial.player.map((m) => m.uid);
    const bonds = r.events.filter((e) => e.type === 'buff' && e.source === 'Ancient of Bonds') as Extract<CombatEvent, { type: 'buff' }>[];
    expect(bonds).toHaveLength(1); // B's +5 is itself a Warded gain, but it does not fire Bonds again
    expect(bonds[0]).toMatchObject({ target: b, attack: 5, health: 0 });
    expect(bonds[0]!.target).not.toBe(a);
  });

  it('BONDS needs another Warded friend, and ignores gains on bodies without Ward', () => {
    const r = fight([body(4, 50, []), body(1, 50, ['DS'])], [body(0, 500, [])],
      { doubleLeftmostAttack: true, ancientBonds: { attack: 5, label: 'Ancient of Bonds' } });
    expect(r.events.some((e) => e.type === 'buff' && e.source === 'Ancient of Bonds')).toBe(false);
  });
});
