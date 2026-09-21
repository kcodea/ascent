import { describe, it, expect } from 'vitest';
import { combatSide, damageMeterOf, damageMeterReading, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { snapshotBoard } from './snapshot';

/**
 * GOLDVEIN (owner handoff 2026-09-19; Pummel keyword 2026-09-21) — T1 Kobold 2/3: "**Pummel (6):** Gain **3 Gold**
 * next turn. (Once per combat)". Han Gover's damage-dealt meter (`noteDamageDealt`) with a Gold-next-turn body: the
 * meter is the same per-instance `damageDealt` tally (carried back through `playerDamageMeters`), the payout is
 * `grantBonusGold` → `playerBonusGold` → `bonusEmbersNextTurn` (Tromboneer's channel), latched ONCE per combat on
 * the instance (`pummelFired` — Yeti's convention: a Risen body does not re-arm). Gilded 6 Gold.
 * Chipwick Prospector left set 3 the same day (still a set-2 card) — pinned at the bottom.
 *
 * RESET SEMANTICS (owner report 2026-09-19 — the shop badge read "6/6" after the combat Goldvein fired in: *"it
 * should show 0/6 since the trigger should reset if it hits 6/6, after combat"*): the "(Once per combat)" rider
 * is data on the marker (`DAMAGE_METER_MARKERS.dealtDamageGoldNextTurn.resetEachCombat`), and it means the meter
 * starts EVERY fight at 0 — progress and latch — and carries back 0, so the run card is cleared at settle and the
 * shop reads 0/6 after ANY combat (4 dealt → 0/6 too; it does not bank a partial toward the next fight). Since the
 * Pummel ruling (2026-09-21) Han Gover is once per combat too — the same flag (set3Dwarves.test.ts).
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;

const foe = (attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId: 'sandbag', attack, health, keywords } as unknown as BoardMinion);
const vein = (over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX['k3_goldvein']!;
  return { cardId: 'k3_goldvein', attack: d.attack, health: d.health, keywords: [], sourceUid: 'gv', ...over } as unknown as BoardMinion;
};
const fight = (board: BoardMinion[], foes: BoardMinion[]) =>
  simulate(board, foes, makeRng(5), CARD_INDEX,
    combatSide({ tier: 6, poolIds: poolFor('set3').all.map((c) => c.id) }), combatSide({ tier: 6 }));

describe('Goldvein — "Pummel (6): Gain 3 Gold next turn. (Once per combat)"', () => {
  it('the card: T1 2/3 Kobold, a passive damage-meter marker, both texts, in set 3', () => {
    const d = CARD_INDEX['k3_goldvein']!;
    expect([d.tier, d.attack, d.health, d.tribe]).toEqual([1, 2, 3, 'kobold']);
    expect(d.effects).toEqual([{ on: 'passive', do: 'dealtDamageGoldNextTurn', params: { every: 6, gold: 3 } }]);
    expect(d.text).toBe('**Pummel (6):** Gain **3 Gold** next turn. (Once per combat)');
    expect(d.goldenText).toBe('**Pummel (6):** Gain **6 Gold** next turn. (Once per combat)');
    expect(poolFor('set3').buyable.some((c) => c.id === 'k3_goldvein')).toBe(true);
  });

  it('the meter is declared once-per-combat in core: resetEachCombat, every 6; Han Gover is too (Pummel 2026-09-21)', () => {
    expect(damageMeterOf(CARD_INDEX['k3_goldvein'])).toEqual({ do: 'dealtDamageGoldNextTurn', every: 6, resetEachCombat: true });
    expect(damageMeterOf(CARD_INDEX['dw3_hangover'])).toEqual({ do: 'dealtDamageAleMeter', every: 40, resetEachCombat: true });
    expect(damageMeterOf(CARD_INDEX['k_chipwick'])).toBeNull();
  });

  it('5 damage → nothing; a once-per-combat meter carries back 0 (the shop reads 0/6, nothing banks toward next fight)', () => {
    const r = fight([vein({ attack: 5 })], [foe(0, 5)]);
    expect(r.playerBonusGold ?? 0).toBe(0);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'gv', total: 0 }]);
    // The live combat meter itself moved (the badge ticks per hit); only the carry-back is the reset.
    expect(r.initial.player[0]!.damageDealt).toBeUndefined();
    let s = run({ phase: 'combat', board: [body('gv', 'k3_goldvein', { damageDealt: 4 })], hand: [], lastCombat: r });
    s = act(s, { type: 'settleCombat' });
    expect(at(s, 'gv').damageDealt, 'a stale tally on the run card is wiped too').toBeUndefined();
  });

  it('6 damage → +3 Gold next turn, banked on top of the cap at settle; the shop badge reads 0/6, not 6/6', () => {
    const r = fight([vein({ attack: 6 })], [foe(0, 6)]);
    expect(r.playerBonusGold).toBe(3);
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'gv', total: 0 }]);
    let s = run({ phase: 'combat', board: [body('gv', 'k3_goldvein')], hand: [], lastCombat: r });
    s = act(s, { type: 'settleCombat' });
    expect(s.bonusEmbersNextTurn).toBe(3);
    expect(at(s, 'gv').damageDealt).toBeUndefined();
    expect(damageMeterReading(at(s, 'gv').damageDealt ?? 0, damageMeterOf(CARD_INDEX['k3_goldvein'])!)).toEqual({ current: 0, total: 6 });
  });

  it('12 damage in one combat → still +3 (once per combat), whether one hit or two', () => {
    expect(fight([vein({ attack: 12 })], [foe(0, 1)]).playerBonusGold).toBe(3);   // one 12-damage hit: two crossings, one payout
    expect(fight([vein({ attack: 6 })], [foe(0, 1), foe(0, 1)]).playerBonusGold).toBe(3); // 6 then 12: the second crossing pays nothing
  });

  it('GILDED: +6 Gold, still once', () => {
    expect(fight([vein({ attack: 12, golden: true })], [foe(0, 1)]).playerBonusGold).toBe(6);
  });

  it('the meter does NOT carry across combats: 4 then 4 → the second fight starts at 0 and does not pay', () => {
    const r1 = fight([vein({ attack: 4 })], [foe(0, 4)]);
    expect(r1.playerBonusGold ?? 0).toBe(0);
    let s = run({ phase: 'combat', board: [body('gv', 'k3_goldvein')], hand: [], lastCombat: r1 });
    s = act(s, { type: 'settleCombat' });
    expect(at(s, 'gv').damageDealt).toBeUndefined();
    const r2 = fight([vein({ attack: 4, damageDealt: at(s, 'gv').damageDealt })], [foe(0, 4)]);
    expect(r2.playerBonusGold ?? 0).toBe(0);
    expect(r2.playerDamageMeters).toEqual([{ sourceUid: 'gv', total: 0 }]);
    // A seeded tally is IGNORED for a once-per-combat body (a pre-reset snapshot / served copy): the fight
    // still starts at 0, so 4 more does not cross 6 …
    const r3 = fight([vein({ attack: 4, damageDealt: 8 })], [foe(0, 4)]);
    expect(r3.initial.player[0]!.damageDealt).toBeUndefined();
    expect(r3.playerBonusGold ?? 0).toBe(0);
    // … and a fresh combat re-arms the once-per-combat latch: 6 in the next fight pays again.
    expect(fight([vein({ attack: 6 })], [foe(0, 6)]).playerBonusGold).toBe(3);
  });

  it('once per COMBAT survives a Rise: the risen body does not re-arm', () => {
    // Seeded at 4 with 6 Attack, 1 Health and Rise: the first clash lands 6 (meter 10 — crosses 6, pays 3) and
    // kills it; it rises at its printed 2 Attack and lands 2 more (meter 12 — a second crossing) before the
    // second foe finishes it. The 12-crossing pays nothing: the latch rode through the Rise.
    const r = fight([vein({ attack: 6, health: 1, keywords: ['R'] })], [foe(1, 6), foe(1, 100)]);
    expect(r.playerBonusGold).toBe(3);
    expect(r.events.some((e) => e.type === 'death' && e.target === r.initial.player[0]!.uid && (e as { rise?: boolean }).rise)).toBe(true);
    // The body died in the end (no survivor to carry back) — the fight's `dmg` events, which the combat badge
    // sums, total 8 dealt by it (6, then 2 after the Rise).
    expect(r.events.filter((e) => e.type === 'dmg' && e.source === r.initial.player[0]!.uid).reduce((n, e) => n + (e as { amount: number }).amount, 0)).toBe(8);
  });

  it('a hit that never lands (a Ward) adds nothing', () => {
    const r = fight([vein({ attack: 6 })], [foe(0, 6, ['DS'])]);
    expect(r.playerBonusGold).toBe(3); // the Ward pops on the first swing (0 dealt); the second lands 6
    expect(r.playerDamageMeters).toEqual([{ sourceUid: 'gv', total: 0 }]);
  });

  it('a snapshot carries the meter; a triple keeps the highest', () => {
    expect(snapshotBoard(run({ board: [body('gv', 'k3_goldvein', { damageDealt: 5 })] })).minions[0]!.damageDealt).toBe(5);
    let s = run({ board: [body('a', 'k3_goldvein', { damageDealt: 2 }), body('b', 'k3_goldvein', { damageDealt: 5 })], hand: [body('c', 'k3_goldvein')] });
    s = act(s, { type: 'play', uid: 'c' });
    expect([...s.board, ...s.hand].find((c) => c.cardId === 'k3_goldvein' && c.golden)!.damageDealt).toBe(5);
  });
});

describe('Chipwick Prospector left set 3 (owner handoff 2026-09-19)', () => {
  it('is not drawable in set 3, still is in set 2, and still resolves globally', () => {
    expect(poolFor('set3').buyable.some((c) => c.id === 'k_chipwick')).toBe(false);
    expect(poolFor('set2').buyable.some((c) => c.id === 'k_chipwick')).toBe(true);
    expect(CARD_INDEX['k_chipwick']).toBeDefined();
  });
});
