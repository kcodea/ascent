import { describe, it, expect } from 'vitest';
import { combatSide, damageMeterOf, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';
import { CARD_INDEX, poolFor } from '@game/content';

/**
 * `pummelTrigger` (2026-09-21) — PUMMEL (X) as an observable combat event. The owner's keyword for the
 * damage-dealt meter: "Pummel (X): Triggers once this minion has dealt X damage in a combat." Han Gover reads
 * "Pummel (40): Get a Dwarven Ale. (Once per combat)" and Goldvein "Pummel (6): Gain 3 Gold next turn. (Once per
 * combat)". The owner authored `pummel-trigger` for "when cards like Goldvein and Han Gover trigger"; before the
 * event the UI could only re-derive a crossing from `dmg.source` amounts, Goldvein's payout was silent
 * (`grantBonusGold` emits nothing) and an ENEMY meter was invisible.
 *
 * The contract pinned here: ONE event per body per combat (every Pummel is once per combat — the meter starts
 * at 0 every fight and latches when it fires), emitted on the body that fired, right after the `dmg` that
 * reached X and BEFORE the payout's own events, stamped with the meter's own effect identity; a meter that pays
 * nothing emits nothing; determinism untouched.
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

describe('pummelTrigger — Han Gover (Pummel (40): Get a Dwarven Ale. (Once per combat))', () => {
  it('the meter is declared once per combat in core (resetEachCombat, every 40) — the lifetime tally is gone', () => {
    expect(damageMeterOf(CARD_INDEX['dw3_hangover'])).toEqual({ do: 'dealtDamageAleMeter', every: 40, resetEachCombat: true });
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

  it('ONCE PER COMBAT: one 80-damage hit reaches 40 once → ONE trigger, ONE Ale (no second crossing pays)', () => {
    const r = fight([gover({ attack: 80 })], [foe(0, 80)]);
    expect(triggers(r.events).length).toBe(1);
    expect(r.events.filter((e) => e.type === 'toHand').length).toBe(1);
  });

  it('ONCE PER COMBAT: 40 then 40 more in the same fight → still one trigger, one Ale (the latch holds)', () => {
    const r = fight([gover({ attack: 40 })], [foe(0, 40), foe(0, 40)]);
    expect(triggers(r.events).length).toBe(1);
    expect(r.events.filter((e) => e.type === 'toHand').length).toBe(1);
    expect(r.result).toBe('win');
  });

  it('NO CAP: a 120-damage hit is one Pummel, one trigger, one Ale — "(Max 2 per hit)" is retired', () => {
    const r = fight([gover({ attack: 120 })], [foe(0, 120)]);
    expect(triggers(r.events).length).toBe(1);
    expect(r.events.filter((e) => e.type === 'toHand').length).toBe(1);
    expect(CARD_INDEX['dw3_hangover']!.text).not.toContain('Max 2 per hit');
  });

  it('GILDED: the one Pummel pays TWO Ales — one trigger, two toHands', () => {
    const r = fight([gover({ attack: 80, golden: true })], [foe(0, 80)]);
    expect(triggers(r.events).length).toBe(1);
    expect(r.events.filter((e) => e.type === 'toHand').length).toBe(2);
  });

  it('RESET EACH COMBAT: a seeded lifetime tally is ignored — the fight starts at 0 and 13 more does not reach 40; a fresh fight re-arms', () => {
    const r = fight([gover({ attack: 13, damageDealt: 30 })], [foe(0, 13)]);
    expect(r.initial.player[0]!.damageDealt).toBeUndefined();
    expect(triggers(r.events)).toEqual([]);
    expect(r.events.filter((e) => e.type === 'toHand')).toEqual([]);
    expect(r.playerDamageMeters, 'carries back 0 → the shop reads 0/40').toEqual([{ sourceUid: 'hg', total: 0 }]);
    // …and the next combat is a fresh meter: 40 in one fight pays again.
    expect(triggers(fight([gover({ attack: 40 })], [foe(0, 40)]).events)).toHaveLength(1);
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
    expect(r.playerDamageMeters, 'the tally still advanced, and a once-per-combat meter carries back 0').toEqual([{ sourceUid: 'hg', total: 0 }]);
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
