/**
 * FIGHT RECAP helpers (owner asks 2026-09-24, condensed 2026-09-25). Pins: the Upset / Heartbreaker tags reuse
 * the announcer's thresholds exactly; the odds give all three whole percents plus the rounded average damage a
 * win deals / a loss costs (null when that outcome never happened); What you keep is [] when nothing lasting
 * happened.
 */
import { describe, expect, it } from 'vitest';
import type { CombatEvent, CombatResult, MinionSnapshot } from '@game/core';
import { ANNOUNCER_HIGH_ODDS, ANNOUNCER_LOW_ODDS } from './announcer';
import { lossDamageRangeOf } from '@game/sim';
import { combatGainItems, oddsRecap, splitDamage, wholePercents } from './fightRecapData';

const snap = (uid: string, name: string, golden = false): MinionSnapshot =>
  ({ uid, cardId: `card_${uid}`, name, tribe: 'neutral', attack: 1, health: 1, keywords: [], ...(golden ? { golden } : {}) } as MinionSnapshot);

const fight = (events: CombatEvent[], extra: Partial<CombatResult> = {}): CombatResult => ({
  events, result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
  initial: { player: [snap('p1', 'Brute'), snap('p2', 'Sniper', true), snap('p3', 'Chanter')], enemy: [snap('e1', 'Foe A'), snap('e2', 'Foe B')] },
  ...extra,
});

describe('oddsRecap', () => {
  const o = (win: number, draw = 0, avgLossDamage = 0) => ({ win, draw, lose: Math.max(0, 1 - win - draw), avgLossDamage });

  it('is null with no odds', () => {
    expect(oddsRecap(null, 'win')).toBeNull();
  });

  it('tags an Upset at the announcer low-odds threshold, a Heartbreaker at the high one', () => {
    expect(oddsRecap(o(ANNOUNCER_LOW_ODDS), 'win')!.tag).toBe('upset');
    expect(oddsRecap(o(ANNOUNCER_LOW_ODDS + 0.01), 'win')!.tag).toBeNull();
    expect(oddsRecap(o(ANNOUNCER_HIGH_ODDS), 'lose')!.tag).toBe('heartbreaker');
    expect(oddsRecap(o(ANNOUNCER_HIGH_ODDS - 0.01), 'lose')!.tag).toBeNull();
    // A low-odds LOSS or a high-odds WIN is just the expected result.
    expect(oddsRecap(o(0.1), 'lose')!.tag).toBeNull();
    expect(oddsRecap(o(0.9), 'win')!.tag).toBeNull();
    expect(oddsRecap(o(0.1), 'draw')!.tag).toBeNull();
  });

  it('always gives all three percentages, summing to 100, 0% and 100% included', () => {
    expect(oddsRecap(o(1), 'win')!.pcts).toEqual({ win: 100, draw: 0, lose: 0 });
    expect(oddsRecap(o(0), 'lose')!.pcts).toEqual({ win: 0, draw: 0, lose: 100 });
    expect(wholePercents(1 / 3, 1 / 3, 1 / 3)).toEqual({ win: 34, draw: 33, lose: 33 });
    const p = wholePercents(0.084, 0.005, 0.911);
    expect(p.win + p.draw + p.lose).toBe(100);
  });
});

describe('average damage beside the odds', () => {
  const o = (win: number, avgLossDamage: number, avgWinDamage?: number) => ({ win, draw: 0, lose: 1 - win, avgLossDamage, ...(avgWinDamage !== undefined ? { avgWinDamage } : {}) });
  it('rounds the win and loss averages, and is null for an outcome that never happened', () => {
    const r = oddsRecap(o(0.4, 5.6, 3.4), 'lose')!;
    expect(r.winDmg).toBe(3);
    expect(r.lossDmg).toBe(6);
    expect(oddsRecap(o(1, 0, 7), 'win')!.lossDmg).toBeNull();
    expect(oddsRecap(o(0, 9, 0), 'lose')!.winDmg).toBeNull();
    expect(oddsRecap(o(0.5, 4), 'win')!.winDmg).toBeNull(); // legacy odds recorded before avgWinDamage
  });

  it('the probe range is the 25th-75th percentile, or min-max for a small sample', () => {
    expect(lossDamageRangeOf([])).toBeNull();
    expect(lossDamageRangeOf([5, 2, 9])).toEqual([2, 9]);
    expect(lossDamageRangeOf([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([2, 6]);
  });
});

describe('splitDamage', () => {
  it('takes Armor first, then Resolve', () => {
    expect(splitDamage(8, 5)).toEqual({ total: 8, armor: 5, resolve: 3 });
    expect(splitDamage(3, 10)).toEqual({ total: 3, armor: 3, resolve: 0 });
    expect(splitDamage(4, undefined)).toEqual({ total: 4, armor: 0, resolve: 4 });
  });
});

describe('combatGainItems', () => {
  it('is [] when nothing lasting happened (the section hides)', () => {
    expect(combatGainItems(null)).toEqual([]);
    expect(combatGainItems(fight([]))).toEqual([]);
    expect(combatGainItems(fight([], { playerImpBuffGain: { attack: 0, health: 0 }, playerMaxGoldGain: 0 }))).toEqual([]);
  });

  it('gives each lasting gain its own mini card, kept stats per minion', () => {
    const items = combatGainItems(fight([], {
      playerSpellPower: { attack: 2, health: 0 },
      playerPermaBuffs: [
        { sourceUid: 'p1', attack: 3, health: 2, engraved: true },
        { sourceUid: 'p1', attack: 1, health: 0, engraved: true },
        { sourceUid: 'p2', attack: 1, health: 1, engraved: true },
      ],
      playerFreeRolls: 1,
    }));
    expect(items.map((i) => [i.label, i.chip])).toEqual([
      ['Your spells', '+2/+0'],
      ['card_p1', '+4/+2'],
      ['card_p2', '+1/+1'],
      ['Free reroll', '+1'],
    ]);
    expect(items[1]!.cardId).toBe('card_p1');
  });
});
