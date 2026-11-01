/**
 * R-HERO-POWER-REPLACED-02 (owner ruling 2026-11-01, picking all four left-native exceptions of R-HERO-POWER-REPLACED-01):
 * every passive that used to run on the hero's OWN clock now follows the HELD power.
 *
 *  1. Drakko's Drumline and Chronos' Timelapse quests count only while the power is held (either slot); a hero who
 *     gains one starts from 0 progress and completes it on the holding slot's own latch.
 *  2. Runesmith's turn-5 forge and Guardian's turn-8 Epic forge open for whoever holds the power on that turn.
 *  3. The Runesmith / Guardian every-forge discount follows the held power (Void's slot 1 included).
 *  4. Ancients pairings (and their power reshape) follow the slot-0 power.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, activePowers, ancientCombatMods, createRun, enableAncients, heroPowerText, openEpicRuneforge, reduce,
  type AncientId, type RunState, type ShopCard,
} from './index';
import { hasBattlecry } from './recruit';
import { pendingEpicForges } from './reducer';

const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
const nextTurn = (s: RunState): RunState => reduce({ ...s, phase: 'combat', lastCombat: win } as RunState, { type: 'resolveCombat' });

/** A low-tier minion of each shape the quests count, and one that counts for neither. */
const minions = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.ruby && !c.token && !c.henchman && c.tier <= 2);
const SHOUT = minions.find((c) => hasBattlecry(c) && !c.effects.some((e) => e.on === 'endOfTurn'))!.id;
const EOT = minions.find((c) => c.effects.some((e) => e.on === 'endOfTurn') && !hasBattlecry(c))!.id;

/** A mid-shop run with Power Shifter in hand and plenty of Gold. */
function shop(heroId: string, over: Partial<RunState> = {}): RunState {
  const s = createRun(5, heroId);
  return {
    ...s, phase: 'recruit', embers: 60, maxEmbers: 10, tier: 5, board: [],
    hand: [{ uid: 'ps', cardId: 'powershifter', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    shop: [], powerOffer: undefined, discover: undefined, questOffer: undefined, pendingPowerOffer: undefined,
    ...over,
  } as RunState;
}

/** Cast Power Shifter and take `heroId`'s power (the offer is pinned so the test does not depend on the roll). */
function shiftTo(s: RunState, heroId: string): RunState {
  const cast = reduce(s, { type: 'play', uid: 'ps' } as never);
  expect(cast.powerOffer?.slot, 'Power Shifter opened its Discover').toBe('shifter');
  return reduce({ ...cast, powerOffer: { heroIds: [heroId], slot: 'shifter' } } as RunState, { type: 'pickPower', index: 0 });
}

/** Buy `n` copies of `cardId` (each placed in the Shop for its buy). The hand is cleared of everything but the quest
 *  rewards and Power Shifter between buys, so the hand cap never interferes. */
function buy(s: RunState, cardId: string, n = 1): RunState {
  for (let i = 0; i < n; i++) {
    const uid = `t${i}_${s.uidSeq}`;
    s = reduce({ ...s, embers: 60, shop: [{ uid, cardId } as ShopCard], hand: s.hand.filter((c) => c.cardId === 'drummer' || c.cardId === 'chronos' || c.cardId === 'powershifter') } as RunState, { type: 'buy', uid });
  }
  return s;
}
const has = (s: RunState, cardId: string): boolean => s.hand.some((c) => c.cardId === cardId);

describe('R-HERO-POWER-REPLACED-02: Drakko\'s Drumline follows the held power', () => {
  it('native Drakko counts Shout buys and pays out at 5 (baseline)', () => {
    const s = buy(shop('drakko'), SHOUT, 5);
    expect(has(s, 'drummer')).toBe(true);
    expect(s.heroPowerSpent, 'the quest spent its own latch').toBe(true);
  });

  it('Drakko who Power Shifts Drumline away stops counting and never pays out', () => {
    let s = buy(shop('drakko'), SHOUT, 4);
    expect(s.drakkoBuys).toBe(4);
    s = shiftTo(s, 'nadja');
    s = buy(s, SHOUT, 3);
    expect(s.drakkoBuys, 'progress froze when the power left').toBe(4);
    expect(has(s, 'drummer'), 'no Drakko for a hero who no longer holds Drumline').toBe(false);
  });

  it('a Void holding Drumline in slot 1 runs it from 0, on slot 1\'s latch', () => {
    let s = shop('voidhero', { voidPowerIds: ['warden', 'drakko'] });
    expect(s.drakkoBuys).toBe(0);
    s = buy(s, SHOUT, 5);
    expect(has(s, 'drummer')).toBe(true);
    expect(s.heroPowerSpent2, 'slot 1 completed').toBe(true);
    expect(s.heroPowerSpent, 'slot 0 (Warden) is untouched').toBeFalsy();
  });

  it('a hero who never held Drumline does not count Shout buys', () => {
    const s = buy(shop('warden'), SHOUT, 5);
    expect(s.drakkoBuys).toBe(0);
    expect(has(s, 'drummer')).toBe(false);
  });
});

describe('R-HERO-POWER-REPLACED-02: Chronos\' Timelapse follows the held power', () => {
  it('Chronos who Power Shifts Timelapse away stops counting End of Turn buys', () => {
    let s = buy(shop('chronoshero'), EOT, 2);
    expect(s.eotMinionBuys).toBe(2);
    s = shiftTo(s, 'nadja');
    s = buy(s, EOT, 3);
    expect(s.eotMinionBuys).toBe(2);
    expect(has(s, 'chronos')).toBe(false);
  });

  it('a Void holding Timelapse runs it from 0 and pays out at 4', () => {
    const s = buy(shop('voidhero', { voidPowerIds: ['chronoshero', 'warden'] }), EOT, 4);
    expect(has(s, 'chronos')).toBe(true);
    expect(s.heroPowerSpent, 'slot 0 holds Timelapse').toBe(true);
  });
});

describe("R-HERO-POWER-REPLACED-02: Runesmith's turn-5 forge follows the held power", () => {
  const atTurn4 = (heroId: string, over: Partial<RunState> = {}): RunState => shop(heroId, { wave: 4, ...over });

  it('native Runesmith visits on turn 5 (baseline)', () => {
    const t5 = nextTurn(atTurn4('runesmith', { hand: [] }));
    expect(t5.wave).toBe(5);
    expect(t5.runeforgeOffer?.length).toBeGreaterThan(0);
    expect(t5.runeforgeNoCharge).toBeFalsy();
  });

  it('Runesmith who shifts Forgemaster away gets no turn-5 forge', () => {
    const t5 = nextTurn({ ...shiftTo(atTurn4('runesmith'), 'nadja'), hand: [] });
    expect(t5.wave).toBe(5);
    expect(t5.runeforgeOffer, 'no forge for a power no longer held').toBeUndefined();
  });

  it('a Void holding Forgemaster in slot 1 visits on turn 5 and spends slot 1\'s charge', () => {
    const t5 = nextTurn(atTurn4('voidhero', { voidPowerIds: ['warden', 'runesmith'], hand: [] }));
    expect(t5.runeforgeOffer?.length).toBeGreaterThan(0);
    for (const d of t5.runeforgeDiscounts!) expect(d, 'the holder\'s forge is discounted').toBeGreaterThan(0);
    const done = reduce(t5, { type: 'skipRuneforge' });
    expect(done.heroPowerSpent2).toBe(true);
    expect(done.heroPowerSpent).toBeFalsy();
  });
});

describe("R-HERO-POWER-REPLACED-02: Guardian's turn-8 Epic forge follows the held power", () => {
  const to8 = (s: RunState): RunState => { let t = { ...s, hand: [] } as RunState; while (t.wave < 8) t = nextTurn({ ...t, runeforgeOffer: undefined, questOffer: undefined, discover: undefined, pendingBasicForge: undefined, pendingEpicRuneforge: 0 } as RunState); return t; };

  it('native Guardian visits on turn 8 (baseline)', () => {
    const t8 = to8(shop('runeguard', { wave: 6 }));
    expect(t8.runeforgeEpic).toBe(true);
    expect(t8.runeforgeOffer?.length).toBeGreaterThan(0);
  });

  it('Guardian who shifts Runeguard away before turn 8 gets no turn-8 forge', () => {
    const t8 = to8(shiftTo(shop('runeguard', { wave: 6 }), 'nadja'));
    expect(t8.wave).toBe(8);
    expect(t8.runeforgeOffer, 'no Epic forge on turn 8').toBeUndefined();
    expect(pendingEpicForges(t8)).toBe(0);
  });

  it('a booking that is NOT the power\'s (Rune of the Epic Forge) still opens after Guardian shifts away', () => {
    const s = shop('runeguard', { wave: 6, epicForgeCount: 2 });
    expect(s.epicForgeWave).toBe(8);
    const t8 = to8(shiftTo(s, 'nadja'));
    expect(t8.runeforgeEpic, 'the rune\'s forge opens').toBe(true);
    expect(pendingEpicForges(t8), 'only one: the power\'s visit was dropped').toBe(0);
  });

  it('a Void who takes Runeguard on turn 4 visits on turn 8', () => {
    let s = shop('voidhero', { wave: 4 });
    s = reduce({ ...s, powerOffer: { heroIds: ['runeguard'], slot: 'void1' } } as RunState, { type: 'pickPower', index: 0 });
    s = reduce({ ...s, powerOffer: { heroIds: ['warden'], slot: 'void2' } } as RunState, { type: 'pickPower', index: 0 });
    expect(s.voidPowerIds).toEqual(['runeguard', 'warden']);
    const t8 = to8(s);
    expect(t8.runeforgeEpic).toBe(true);
    for (const d of t8.runeforgeDiscounts!) expect(d, 'the holder\'s forge is discounted').toBeGreaterThan(0);
  });

  it('a saved Guardian run from before the flag existed still drops the visit after a shift', () => {
    const s = shiftTo(shop('runeguard', { wave: 6 }), 'nadja');
    const legacy = { ...s, heroEpicForgeBooked: undefined } as RunState;
    expect(to8(legacy).runeforgeOffer).toBeUndefined();
  });
});

describe('R-HERO-POWER-REPLACED-02: the Runesmith / Guardian forge discount follows the held power', () => {
  const discounts = (s: RunState): (number | undefined)[] => { const t = { ...s } as RunState; openEpicRuneforge(t); return t.runeforgeDiscounts ?? []; };

  it('Runesmith who shifted Forgemaster away pays the same prices as any other hero', () => {
    const shifted = discounts({ ...createRun(4, 'runesmith'), adoptedPowerId: 'nadja' } as RunState);
    const other = discounts({ ...createRun(4, 'runesmith'), heroId: 'nadja' } as RunState);
    expect(shifted).toEqual(other);
    expect(shifted.filter((d) => d !== undefined).length, 'not every slot is discounted').toBeLessThan(shifted.length);
  });

  it('a hero who gains Runeguard (Power Shifter / Void slot 1) has every slot discounted', () => {
    for (const s of [
      { ...createRun(4, 'indy'), adoptedPowerId: 'runeguard' },
      { ...createRun(4, 'voidhero'), voidPowerIds: ['warden', 'runeguard'] },
    ] as RunState[]) {
      for (const d of discounts(s)) expect(d).toBeGreaterThan(0);
    }
  });
});

describe('R-HERO-POWER-REPLACED-02: Ancients pairings follow the held power', () => {
  const picked = (s: RunState, id: AncientId): RunState => {
    let t = enableAncients(s);
    t = { ...t, ancients: { ...t.ancients!, points: t.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
    t = reduce(t, { type: 'pickAncient', id });
    expect(t.ancients!.picked).toBe(id);
    return t;
  };

  it('Gildmaster × War: shifting Gildcrafter away ends the pairing (no Pummel charge, no use budget)', () => {
    const s = picked(shop('gildmaster'), 'war');
    expect(ancientCombatMods(s).ancientPummelCharge, 'baseline: the pairing is live').toBeDefined();
    const shifted = shiftTo(s, 'nadja');
    expect(ancientCombatMods(shifted).ancientPummelCharge).toBeUndefined();
    expect(heroPowerText(shifted)).not.toContain('Pummel');
  });

  it('a hero who holds Gildcrafter in slot 0 when the Ancient is picked gets Gildmaster × War', () => {
    const s = picked(shop('warden', { adoptedPowerId: 'gildmaster' }), 'war');
    expect(s.ancients!.powerOverrideFor).toBe('gildmaster');
    expect(ancientCombatMods(s).ancientPummelCharge).toBeDefined();
    expect(activePowers(s)[0]!.maxUses).toBe(3);
    const grown = { ...s, ancients: { ...s.ancients!, powerOverride: { ...(s.ancients!.powerOverride ?? {}), maxUses: 4 } } } as RunState;
    expect(activePowers(grown)[0]!.maxUses, 'the banked use lands on the held Gildcrafter').toBe(4);
  });

  it('Gildmaster × Time: the passive reshape leaves with the power and never lands on its replacement', () => {
    const s = picked(shop('gildmaster'), 'time');
    expect(activePowers(s)[0]!.passive).toBe(true);
    const shifted = shiftTo(s, 'nadja');
    expect(activePowers(shifted)[0]!.kind).toBe('gainMaxMana');
    expect(activePowers(shifted)[0]!.passive, 'Nadja\'s power keeps its own shape').toBeFalsy();
  });
});
