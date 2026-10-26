import { describe, expect, it } from 'vitest';
import { EPIC_RUNES, RUNES } from '@game/content';
import { activePowers, createRun, heroGrantOf, reduce, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/**
 * R-HERO-GRANT-RELEASE-01 (owner report + ruling 2026-10-26).
 *
 * Report: "runemaster got a new hero power here but the art didnt change to it. can you fix that". A Runesmith
 * who took Rune of Shopkeep at his turn-5 forge, then gained a new power (Power Shifter), kept the Shopkeep bell
 * art AND the "Shopkeep" label on the button; only the cost coin (3) came from the new power. Root cause: the
 * slot's grant (`heroGrantArt`) was never released on a power swap, and every surface prefers the grant.
 *
 * Ruling: "this would replace whatever rune mechanic he has, so if he had a rune that was passively doing
 * something, that would not be active anymore. (the one he selected from his hero power)". So the swap also
 * switches the hero's forge rune off. Runeforge-bought runes are untouched.
 */

/** Runesmith at his turn-5 forge, buying `runeId` there (the real `buyRune` path). */
function runesmithTook(runeId: string, seed = 11): RunState {
  const s = {
    ...createRun(seed, 'runesmith'), phase: 'recruit', wave: 5, embers: 50, maxEmbers: 50,
    powerOffer: undefined, discover: undefined, questOffer: undefined,
    runeforgeOffer: [runeId], runeforgeDiscounts: [0],
  } as RunState;
  return reduce(s, { type: 'buyRune', index: 0 } as never);
}

/** A Runeforge visit that is NOT the hero's (the universal turn-6 one / a quest's), buying `runeId`. */
function forgeBuys(s: RunState, runeId: string): RunState {
  return reduce({ ...s, embers: 50, runeforgeNoCharge: true, runeforgeOffer: [runeId], runeforgeDiscounts: [0] } as RunState, { type: 'buyRune', index: 0 } as never);
}

/** Gain a new power through Power Shifter's pick (the real `pickPower` path), rigged to `heroId`. */
function shiftTo(s: RunState, heroId: string): RunState {
  return reduce({ ...s, discover: undefined, chooseOne: undefined, powerOffer: { heroIds: [heroId, 'warden'], slot: 'shifter' } } as RunState, { type: 'pickPower', index: 0 });
}

/** One End of Turn's upgrade-cost cut. */
function eotCut(s: RunState): number {
  const t = structuredClone({ ...s, upgradeCost: 9 }) as RunState;
  applyEndOfTurn(t);
  return 9 - t.upgradeCost;
}

describe('R-HERO-GRANT-RELEASE-01: the button follows the CURRENT power', () => {
  it('the owner run: Shopkeep from the forge, then Goldspring (cost 3) — the slot releases Shopkeep', () => {
    const t5 = runesmithTook('rune_shopkeep');
    expect(heroGrantOf(t5), 'before: the forge rune IS the power').toEqual({ kind: 'rune', id: 'rune_shopkeep' });
    const swapped = shiftTo(t5, 'nadja');
    expect(activePowers(swapped)[0]!.name).toBe('Goldspring');
    expect(swapped.heroGrantArt, 'the grant leaves the slot').toBeUndefined();
    expect(heroGrantOf(swapped)).toBeUndefined();
  });

  it('a stale grant from a save written before the fix never paints over the new power', () => {
    const stale = { ...shiftTo(runesmithTook('rune_shopkeep'), 'nadja'), heroGrantArt: { kind: 'rune', id: 'rune_shopkeep' } } as RunState;
    expect(heroGrantOf(stale)).toBeUndefined();
  });

  it('Guardian: his turn-8 Epic rune leaves the slot too', () => {
    const s = {
      ...createRun(5, 'runeguard'), phase: 'recruit', wave: 8, embers: 30, runeforgeEpic: true,
      runeforgeOffer: ['rune_dawnclaw'], runeforgeDiscounts: [0], powerOffer: undefined, discover: undefined,
    } as RunState;
    const t8 = reduce(s, { type: 'buyRune', index: 0 } as never);
    expect(heroGrantOf(t8)).toEqual({ kind: 'rune', id: 'rune_dawnclaw' });
    const swapped = shiftTo(t8, 'nadja');
    expect(heroGrantOf(swapped)).toBeUndefined();
    expect(swapped.ownedRunes ?? []).not.toContain('rune_dawnclaw');
  });

  it('a forge visited AFTER the swap is not the hero power any more: it never claims the slot', () => {
    const s = shiftTo({ ...createRun(5, 'runeguard'), phase: 'recruit', wave: 7, powerOffer: undefined, discover: undefined } as RunState, 'nadja');
    const t8 = reduce({ ...s, wave: 8, embers: 30, runeforgeEpic: true, runeforgeOffer: ['rune_dawnclaw'], runeforgeDiscounts: [0] } as RunState, { type: 'buyRune', index: 0 } as never);
    expect(t8.heroGrantArt).toBeUndefined();
    expect(t8.ownedRunes, 'an ordinary rune instead').toContain('rune_dawnclaw');
  });

  it('a SECOND power beside slot 0 (Second Calling / Void slot 1) replaces nothing and releases nothing', () => {
    const s = { ...runesmithTook('rune_shopkeep'), voidPowerIds: ['runesmith', 'nadja'] } as RunState;
    expect(heroGrantOf(s)).toEqual({ kind: 'rune', id: 'rune_shopkeep' });
    expect(s.runeShopkeep).toBe(true);
  });
});

describe('R-HERO-GRANT-RELEASE-01: the replaced power\'s rune stops working', () => {
  it('Shopkeep: cuts the upgrade cost every End of Turn before the swap, never after', () => {
    const t5 = runesmithTook('rune_shopkeep');
    expect(eotCut(t5), 'before: the passive fires').toBe(3);
    const swapped = shiftTo(t5, 'nadja');
    expect(swapped.runeShopkeep).toBeUndefined();
    expect(swapped.ownedRunes ?? []).not.toContain('rune_shopkeep');
    expect(eotCut(swapped), 'after: it does not').toBe(0);
  });

  it('a combat rune: its flag leaves the combat mods, other runes\' flags stay', () => {
    let s = runesmithTook('rune_warding');
    s = forgeBuys(s, 'rune_fury'); // the universal forge, after his
    expect(s.questFlags).toMatchObject({ runeWarding: true, runeFury: true });
    s = shiftTo(s, 'nadja');
    expect(s.questFlags?.runeWarding, 'his forge rune is off').toBeUndefined();
    expect(s.questFlags?.runeFury, 'the Runeforge rune keeps working').toBe(true);
    expect(s.flagCopies?.runeWarding ?? 0).toBe(0);
    expect(s.ownedRunes).toEqual(['rune_fury']);
  });

  it('a Runeforge copy of the SAME rune keeps working; only the hero\'s copy leaves', () => {
    let s = runesmithTook('rune_shopkeep');
    s = forgeBuys(s, 'rune_shopkeep');
    s = shiftTo(s, 'nadja');
    expect(s.ownedRunes).toEqual(['rune_shopkeep']);
    expect(s.runeShopkeep).toBe(true);
    expect(eotCut(s)).toBe(3);
  });

  it('what the rune already delivered stays (the immediate Shopkeep cut, granted cards)', () => {
    const t5 = runesmithTook('rune_shopkeep');
    const swapped = shiftTo(t5, 'nadja');
    expect(swapped.upgradeCost).toBe(t5.upgradeCost);
  });

  it('is identical after a save round-trip (restore / replay read the same footprint)', () => {
    const t5 = runesmithTook('rune_warding');
    const live = shiftTo(t5, 'nadja');
    const restored = shiftTo(JSON.parse(JSON.stringify(t5)) as RunState, 'nadja');
    expect(JSON.stringify(restored.questFlags)).toBe(JSON.stringify(live.questFlags));
    expect(restored.ownedRunes).toEqual(live.ownedRunes);
    expect(shiftTo(t5, 'nadja').questFlags).toEqual(live.questFlags); // deterministic
  });

  // EVERY rune, through the same generic footprint: after the swap the run's ongoing rune state is what it was
  // before the pick. Forge BOOKINGS (Epic Forge, Ornate Clock) are delivered visits, not a passive, and stay.
  const NOT_PASSIVE = new Set(['rune_epic_forge', 'rune_ornate_clock']);
  const DELIVERED = /^(hand|board|shop|pool|discover|embers|maxEmbers|uidSeq|rngCursor|upgradeCost|cardBuffs|tavernBuyBonus|freeRolls|goldSpent|goldSpentThisTurn|pendingQuestRewards|chooseBothCharges|heroPowerSpent|heroReady|powerLatches|adoptedPowerId|adoptedSeeded|seededPowers|equipment|runeforgeOffer|runeforgeDiscounts|powerOffer|runeProcs|shopMinionsEaten)$|^discover|Fx($|[A-Z])|Seq$|Eaten$|Fired|^last[A-Z]|^beat/;
  const ids = [...new Set([...RUNES, ...EPIC_RUNES].map((r) => r.id))].filter((id) => !NOT_PASSIVE.has(id));
  it.each(ids)('%s: switched back off by the swap', (id) => {
    const before = JSON.parse(JSON.stringify({ ...createRun(11, 'runesmith') })) as Record<string, unknown>;
    const t5 = runesmithTook(id);
    expect(t5.heroGrantArt).toEqual({ kind: 'rune', id });
    const after = JSON.parse(JSON.stringify(shiftTo(t5, 'nadja'))) as Record<string, unknown>;
    const left: string[] = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (DELIVERED.test(k) || k === 'phase' || k === 'wave' || k === 'questOffer' || k === 'discover') continue;
      const a = JSON.stringify(before[k]); const b = JSON.stringify(after[k]);
      if (a === undefined && (b === '0' || b === '[]' || b === '{}' || b === 'false')) continue;
      if (a !== b) left.push(`${k}: ${a} -> ${b}`);
    }
    expect(left).toEqual([]);
  });
});

describe('R-HERO-GRANT-RELEASE-01: a hero QUEST grant', () => {
  it('leaves the slot on a swap (the quest itself keeps running as an ordinary quest)', () => {
    const s = { ...createRun(3, 'fi'), phase: 'recruit', wave: 2, heroGrantArt: { kind: 'quest', id: 'hq_spare_forge' }, activeQuests: [{ questId: 'hq_spare_forge', progress: 0, completed: false }], powerOffer: undefined, discover: undefined, questOffer: undefined } as RunState;
    expect(heroGrantOf(s)).toEqual({ kind: 'quest', id: 'hq_spare_forge' });
    const swapped = shiftTo(s, 'nadja');
    expect(heroGrantOf(swapped)).toBeUndefined();
    expect(swapped.activeQuests?.map((q) => q.questId)).toContain('hq_spare_forge');
  });
});
