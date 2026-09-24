import { describe, it, expect } from 'vitest';
import { combatSide, damageMeterOf, damageMeterReading, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';
import { CARD_INDEX, poolFor } from '@game/content';

/**
 * `pummelTrigger` (2026-09-21) — PUMMEL (X) as an observable combat event. The owner's keyword for the
 * damage-dealt meter: "Pummel (X): Triggers each time this minion has dealt another X damage. The damage count
 * carries over between combats." Han Gover reads "Pummel (40): Get a Dwarven Ale. (Once per combat)" and
 * Goldvein "Pummel (6): Gain 3 Gold next turn. (Once per combat)". The owner authored `pummel-trigger` for "when
 * cards like Goldvein and Han Gover trigger"; before the event the UI could only re-derive a crossing from
 * `dmg.source` amounts, Goldvein's payout was silent (`grantBonusGold` emits nothing) and an ENEMY meter was
 * invisible.
 *
 * THE ONE RULE (carry-over ruling 2026-09-21, later the same day as the keyword — "it is resetting to 0/X after
 * combat … it needs to carry over from turn to turn and combat to shop"): the tally is LIFETIME per instance
 * (seeded from the run card, carried back whole); a payout is owed each time the tally crosses a MULTIPLE of X;
 * but at most `maxPerCombat` payouts per combat (`pummelFires`, fresh every fight; default 1, Han Gover 5 since
 * owner 2026-09-24, "(Max 5 per combat.)"). The contract pinned here: ONE event per PAYOUT, emitted on the body that fired, right after the `dmg` that crossed and BEFORE the payout's
 * own events, stamped with the meter's own effect identity; a meter that pays nothing emits nothing; the
 * uncredited crossings are spent, not banked; determinism untouched.
 */
const foe = (attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId: 'sandbag', attack, health, keywords } as unknown as BoardMinion);
const gover = (over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX['dw3_hangover']!;
  return { cardId: 'dw3_hangover', attack: d.attack, health: d.health, keywords: [], sourceUid: 'hg', ...over } as unknown as BoardMinion;
};
const vein = (over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX['k3_goldvein']!;
  return { cardId: 'k3_goldvein', attack: d.attack, health: d.health, keywords: [], sourceUid: 'gv', ...over } as unknown as BoardMinion;
};
const SET3 = poolFor('set3').all.map((c) => c.id);
const fight = (board: BoardMinion[], foes: BoardMinion[], enemyPool = false) =>
  simulate(board, foes, makeRng(5), CARD_INDEX,
    combatSide({ tier: 6, poolIds: SET3 }), combatSide({ tier: 6, ...(enemyPool ? { poolIds: SET3 } : {}) }));
const triggers = (events: CombatEvent[]) => events.filter((e) => e.type === 'pummelTrigger') as Extract<CombatEvent, { type: 'pummelTrigger' }>[];
const types = (events: CombatEvent[]): string[] => events.map((e) => e.type);

describe('pummelTrigger — Han Gover (Pummel (40): Get a Dwarven Ale. (Max 5 per combat.))', () => {
  it('the meter is declared in core with its threshold only (every 40) — there is no per-combat reset flag any more', () => {
    expect(damageMeterOf(CARD_INDEX['dw3_hangover'])).toEqual({ do: 'dealtDamageAleMeter', every: 40 });
    expect(damageMeterOf(CARD_INDEX['k3_goldvein'])).toEqual({ do: 'dealtDamageGoldNextTurn', every: 6 });
  });

  it('40 damage → ONE trigger on Han Gover, player side, the Ale marker, stamped with the meter’s own key', () => {
    const r = fight([gover({ attack: 20 })], [foe(0, 20), foe(0, 20)]);
    const t = triggers(r.events);
    expect(t.length).toBe(1);
    expect(t[0]).toMatchObject({
      source: r.initial.player[0]!.uid, side: 'player', marker: 'dealtDamageAleMeter',
      key: 'factory:dealtDamageAleMeter:passive', srcCard: 'dw3_hangover',
    });
  });

  it('39 damage → no trigger (X not reached)', () => {
    const r = fight([gover({ attack: 13 })], [foe(0, 13), foe(0, 13), foe(0, 13)]);
    expect(triggers(r.events)).toEqual([]);
  });

  it('sits AFTER the dmg that reached X and BEFORE the Ale it pays (dmg → reactor buff → pummelTrigger → toHand), in the hit’s step', () => {
    const r = fight([gover({ attack: 20 })], [foe(0, 20), foe(0, 20)]);
    const i = r.events.findIndex((e) => e.type === 'pummelTrigger');
    expect(i).toBeGreaterThan(0);
    const before = r.events.slice(0, i).reverse().find((e) => e.type === 'dmg')!;
    expect(before).toMatchObject({ type: 'dmg', amount: 20, source: r.initial.player[0]!.uid });
    expect(r.events[i + 1]).toMatchObject({ type: 'toHand', side: 'player', source: r.initial.player[0]!.uid });
    expect(r.events[i]!.step).toBe(before.step); // the trigger shares the hit's resolution step
    // ONLY the trigger carries the meter's identity. The Ale's `toHand` is emitted outside the `withEffect` wrap —
    // unstamped on a plain swing, exactly as it was before the trigger existed — so its beat keeps the stock
    // `toHand` hold under the Beat Lab rather than folding through the meter's `foldedCue` policy (review
    // 2026-09-21). The order pinned above: `dmg → (the victim's onDamaged reactor) → pummelTrigger → toHand`.
    expect(r.events[i]!.key).toBe('factory:dealtDamageAleMeter:passive');
    expect(r.events[i + 1]!.key).toBeUndefined();
    expect(r.events[i + 1]!.srcCard).toBeUndefined();
  });

  it('MAX 5: one 80-damage hit crosses 40 and 80 → TWO triggers, TWO Ales (one per multiple crossed)', () => {
    const r = fight([gover({ attack: 80 })], [foe(0, 80)]);
    expect(triggers(r.events).length).toBe(2);
    expect(r.events.filter((e) => e.type === 'toHand').length).toBe(2);
    expect(types(r.events).filter((t) => t === 'pummelTrigger' || t === 'toHand'), 'each trigger leads its own Ale').toEqual(['pummelTrigger', 'toHand', 'pummelTrigger', 'toHand']);
  });

  it('MAX 5: 40 then 40 more in the same fight → two triggers, two Ales', () => {
    const r = fight([gover({ attack: 40 })], [foe(0, 40), foe(0, 40)]);
    expect(triggers(r.events).length).toBe(2);
    expect(r.events.filter((e) => e.type === 'toHand').length).toBe(2);
    expect(r.result).toBe('win');
  });

  it('MAX 5: a 240-damage hit crosses six multiples and pays FIVE (no 6th); the tally is 240 and a fresh combat re-arms', () => {
    const r = fight([gover({ attack: 240 })], [foe(0, 240)]);
    expect(triggers(r.events).length).toBe(5);
    expect(r.events.filter((e) => e.type === 'toHand').length).toBe(5);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 240 }]);
    expect(triggers(fight([gover({ attack: 40, damageDealt: 240 })], [foe(0, 40)]).events)).toHaveLength(1);
  });

  it('a 120-damage hit pays three ("(Max 2 per hit)" stays retired); the tally is 120 and the next payout waits for 160', () => {
    const r = fight([gover({ attack: 120 })], [foe(0, 120)]);
    expect(triggers(r.events).length).toBe(3);
    expect(r.events.filter((e) => e.type === 'toHand').length).toBe(3);
    expect(CARD_INDEX['dw3_hangover']!.text).not.toContain('Max 2 per hit');
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 120 }]);
    // … so next combat 39 more (159) crosses nothing and 40 more (160) pays.
    expect(triggers(fight([gover({ attack: 39, damageDealt: 120 })], [foe(0, 39)]).events)).toEqual([]);
    expect(triggers(fight([gover({ attack: 40, damageDealt: 120 })], [foe(0, 40)]).events)).toHaveLength(1);
  });

  it('GILDED: each Pummel pays TWO Ales — an 80 hit is two triggers, four toHands', () => {
    const r = fight([gover({ attack: 80, golden: true })], [foe(0, 80)]);
    expect(triggers(r.events).length).toBe(2);
    expect(r.events.filter((e) => e.type === 'toHand').length).toBe(4);
  });

  it('CARRY-OVER: a body seeded at 35 pays on a 5-damage hit — the tally continues from the run card', () => {
    const r = fight([gover({ attack: 5, damageDealt: 35 })], [foe(0, 5)]);
    expect(r.initial.player[0]!.damageDealt, 'the seed is on the combat body (and in the replay snapshot)').toBe(35);
    expect(triggers(r.events)).toHaveLength(1);
    expect(r.events.filter((e) => e.type === 'toHand')).toHaveLength(1);
    expect(r.playerDamageMeters, 'carries back the lifetime total, not 0').toEqual([{ sourceUid: 'hg', total: 40 }]);
  });

  it('CARRY-OVER: 47 reads 7/40 — the readout is progress toward the NEXT payout, no clamp at 40/40', () => {
    const meter = damageMeterOf(CARD_INDEX['dw3_hangover'])!;
    const r = fight([gover({ attack: 47 })], [foe(0, 47)]);
    expect(triggers(r.events)).toHaveLength(1);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 47 }]);
    expect(damageMeterReading(47, meter)).toEqual({ current: 7, total: 40 });
    expect(damageMeterReading(40, meter), 'a crossing lands on 0/40').toEqual({ current: 0, total: 40 });
    expect(damageMeterReading(85, meter), 'never clamped at 40/40').toEqual({ current: 5, total: 40 });
  });

  it('CARRY-OVER: two combats in a row each pay once — 30 (no pay), then 15 more crosses 40 (pays), then 40 more crosses 80 (pays again)', () => {
    const r1 = fight([gover({ attack: 30 })], [foe(0, 30)]);
    expect(triggers(r1.events)).toEqual([]);
    expect(r1.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 30 }]);
    const r2 = fight([gover({ attack: 15, damageDealt: 30 })], [foe(0, 15)]);
    expect(triggers(r2.events)).toHaveLength(1);
    expect(r2.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 45 }]);
    const r3 = fight([gover({ attack: 40, damageDealt: 45 })], [foe(0, 40)]);
    expect(triggers(r3.events), 'a fresh combat re-arms the latch: 45 → 85 crosses 80').toHaveLength(1);
    expect(r3.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 85 }]);
  });

  it('CARRY-OVER + CAP: a second crossing in the SAME combat pays too (37 → 52 pays, → 82 pays; carries back 82)', () => {
    const r = fight([gover({ attack: 15, damageDealt: 37 })], [foe(0, 15), foe(0, 15), foe(0, 15)]);
    expect(triggers(r.events)).toHaveLength(2);
    expect(r.events.filter((e) => e.type === 'toHand')).toHaveLength(2);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 82 }]);
    // Next combat: 82 → 120 needs 38 more; 37 crosses nothing.
    expect(triggers(fight([gover({ attack: 37, damageDealt: 82 })], [foe(0, 37)]).events)).toEqual([]);
    expect(triggers(fight([gover({ attack: 38, damageDealt: 82 })], [foe(0, 38)]).events)).toHaveLength(1);
  });

  it('CARRY-OVER: a seeded tally that sits between multiples does not pay on a hit that crosses nothing (47 + 5 = 52)', () => {
    const r = fight([gover({ attack: 5, damageDealt: 47 })], [foe(0, 5)]);
    expect(triggers(r.events)).toEqual([]);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'hg', total: 52 }]);
  });

  it('a Warded hit never reaches the meter: the first swing pops the Ward (no trigger), the second reaches 40 (one)', () => {
    const r = fight([gover({ attack: 40 })], [foe(0, 40, ['DS'])]);
    const t = triggers(r.events);
    expect(t).toHaveLength(1);
    // The trigger belongs to the SECOND swing — the one whose damage landed.
    const shieldAt = r.events.findIndex((e) => e.type === 'shield');
    expect(r.events.indexOf(t[0]!)).toBeGreaterThan(shieldAt);
  });

  it('a Pummel that pays NOTHING (a pool with no Ales) emits nothing and does not latch — no trigger without a payout', () => {
    const noAles = SET3.filter((id) => !id.startsWith('wo_'));
    const r = simulate([gover({ attack: 40 })], [foe(0, 40)], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, poolIds: noAles }), combatSide({ tier: 6 }));
    expect(r.events.filter((e) => e.type === 'toHand')).toEqual([]);
    expect(triggers(r.events)).toEqual([]);
    expect(r.playerDamageMeters, 'the tally still advanced and carries back whole').toEqual([{ sourceUid: 'hg', total: 40 }]);
  });

  it('an ENEMY Han Gover fires too — the trigger carries side: enemy', () => {
    const r = fight([foe(0, 40)], [gover({ attack: 40 })], true);
    const t = triggers(r.events);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ source: r.initial.enemy[0]!.uid, side: 'enemy', marker: 'dealtDamageAleMeter' });
  });

  it('THE LAST-ATTACK CASE: the Pummel on the killing blow is the last thing before the final death', () => {
    // 40 Attack into a lone 0/40: the one hit reaches 40 AND ends the fight.
    const r = fight([gover({ attack: 40 })], [foe(0, 40)]);
    const tail = types(r.events).slice(-3);
    expect(tail).toEqual(['pummelTrigger', 'toHand', 'death']);
    expect(r.result).toBe('win');
  });
});

describe('pummelTrigger — Goldvein (Pummel (6): Gain 3 Gold next turn. (Once per combat))', () => {
  it('6 damage → ONE trigger, the Gold marker, stamped with the meter’s own key; the Gold still banks', () => {
    const r = fight([vein({ attack: 6 })], [foe(0, 6)]);
    const t = triggers(r.events);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ source: r.initial.player[0]!.uid, side: 'player', marker: 'dealtDamageGoldNextTurn', key: 'factory:dealtDamageGoldNextTurn:passive', srcCard: 'k3_goldvein' });
    expect(r.playerBonusGold).toBe(3);
  });

  it('12 damage in one combat → still ONE trigger (the latch), whether one hit or two', () => {
    expect(triggers(fight([vein({ attack: 12 })], [foe(0, 12)]).events)).toHaveLength(1);
    expect(triggers(fight([vein({ attack: 6 })], [foe(0, 6), foe(0, 6)]).events)).toHaveLength(1);
  });

  it('an ENEMY Goldvein fires too — the trigger carries side: enemy (the player-side Ale grant is not the only signal)', () => {
    const r = fight([foe(0, 6)], [vein({ attack: 6 })]);
    const t = triggers(r.events);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ source: r.initial.enemy[0]!.uid, side: 'enemy', marker: 'dealtDamageGoldNextTurn' });
  });

  it('THE LAST-ATTACK CASE: 2 Attack into three 0/1 dummies reaches 6 on the third, fight-ending hit — the trigger precedes only the death', () => {
    const r = fight([vein({ attack: 2 })], [foe(0, 1), foe(0, 1), foe(0, 1)]);
    const t = triggers(r.events);
    expect(t).toHaveLength(1);
    const i = r.events.indexOf(t[0]!);
    expect(types(r.events).slice(i)).toEqual(['pummelTrigger', 'death']);
    expect(r.result).toBe('win');
  });

  it('emitting never touches the RNG: the same seed reproduces the same log byte for byte', () => {
    const a = fight([gover({ attack: 80 }), vein({ attack: 6 })], [foe(0, 80), foe(0, 6)]);
    const b = fight([gover({ attack: 80 }), vein({ attack: 6 })], [foe(0, 80), foe(0, 6)]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(triggers(a.events).length).toBeGreaterThan(0);
  });
});
