/**
 * FIGHT RECAP helpers (owner ask 2026-09-24). Pins: the Stars of the fight come off the event log (damage to
 * enemies, kills credited to the last player hitter, triggers folded per step), one portrait per minion with
 * every category it led, nothing when there is no data; the Upset / Heartbreaker tags reuse the announcer's
 * thresholds exactly; the odds bar drops at 100/0; What you keep is [] when nothing lasting happened.
 */
import { describe, expect, it } from 'vitest';
import type { CombatEvent, CombatResult, MinionSnapshot } from '@game/core';
import { ANNOUNCER_HIGH_ODDS, ANNOUNCER_LOW_ODDS } from './announcer';
import { lossDamageRangeOf } from '@game/sim';
import { articleFor, combatGainItems, fightStars, oddsRecap, splitDamage, starStatLabel, wholePercents } from './fightRecapData';

const snap = (uid: string, name: string, golden = false): MinionSnapshot =>
  ({ uid, cardId: `card_${uid}`, name, tribe: 'neutral', attack: 1, health: 1, keywords: [], ...(golden ? { golden } : {}) } as MinionSnapshot);

const fight = (events: CombatEvent[], extra: Partial<CombatResult> = {}): CombatResult => ({
  events, result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
  initial: { player: [snap('p1', 'Brute'), snap('p2', 'Sniper', true), snap('p3', 'Chanter')], enemy: [snap('e1', 'Foe A'), snap('e2', 'Foe B')] },
  ...extra,
});

describe('fightStars', () => {
  it('returns [] with no fight and with an empty log (the row hides)', () => {
    expect(fightStars(null)).toEqual([]);
    expect(fightStars(fight([]))).toEqual([]);
  });

  it('credits damage, kills (last player hitter) and triggers to their leaders', () => {
    const r = fight([
      { type: 'dmg', target: 'e1', amount: 5, remainingHp: 3, source: 'p1' },
      { type: 'dmg', target: 'e1', amount: 3, remainingHp: 0, source: 'p2' },
      { type: 'death', target: 'e1', side: 'enemy' },
      { type: 'dmg', target: 'e2', amount: 4, remainingHp: 0, source: 'p1' },
      { type: 'death', target: 'e2', side: 'enemy' },
      // p3: one buff wave onto two targets on the same step = ONE trigger, then a Start of Combat = a second.
      { type: 'buff', target: 'p1', attack: 1, health: 1, source: 'p3', step: 4 },
      { type: 'buff', target: 'p2', attack: 1, health: 1, source: 'p3', step: 4 },
      { type: 'sc', source: 'p3', text: 'Chanter sings' },
      // Damage to the player's own side never counts; an enemy's triggers never count.
      { type: 'dmg', target: 'p1', amount: 9, remainingHp: 1, source: 'e1' },
      { type: 'sc', source: 'e2', text: 'enemy' },
    ]);
    const stars = fightStars(r);
    expect(stars.map((s) => s.uid)).toEqual(['p1', 'p3']);
    // p1 led damage (9) AND kills (1 each for p1 and p2, tie goes to the earlier board slot) — one portrait, two chips.
    expect(stars[0]!.stats).toEqual([{ stat: 'damage', value: 9 }, { stat: 'kills', value: 1 }]);
    expect(stars[1]!.stats).toEqual([{ stat: 'procs', value: 2 }]);
    expect(stars[0]!.name).toBe('Brute');
  });

  it('does not credit a Rise death, nor a kill whose last blow came from elsewhere', () => {
    const r = fight([
      { type: 'dmg', target: 'e1', amount: 5, remainingHp: 0, source: 'p1' },
      { type: 'death', target: 'e1', side: 'enemy', rise: true },
      { type: 'dmg', target: 'e2', amount: 2, remainingHp: 1, source: 'p2' },
      { type: 'dmg', target: 'e2', amount: 1, remainingHp: 0 }, // sourceless finisher
      { type: 'death', target: 'e2', side: 'enemy' },
    ]);
    const stars = fightStars(r);
    expect(stars.flatMap((s) => s.stats.map((x) => x.stat))).not.toContain('kills');
  });

  it('includes minions summoned mid-fight, carries golden, and caps at three portraits', () => {
    const token = snap('p9', 'Token');
    const r = fight([
      { type: 'summon', minion: token, side: 'player', index: 3, source: 'p3' },
      { type: 'dmg', target: 'e1', amount: 20, remainingHp: 0, source: 'p9' },
      { type: 'death', target: 'e1', side: 'enemy' },
      { type: 'dmg', target: 'e2', amount: 2, remainingHp: 0, source: 'p2' },
      { type: 'death', target: 'e2', side: 'enemy' },
      { type: 'sc', source: 'p2', text: 'x' },
      { type: 'sc', source: 'p2', text: 'y' },
    ]);
    const stars = fightStars(r);
    expect(stars.length).toBeLessThanOrEqual(3);
    expect(stars[0]).toMatchObject({ uid: 'p9', name: 'Token' });
    const sniper = stars.find((s) => s.uid === 'p2');
    expect(sniper?.golden).toBe(true);
    // p2 ties p9 on kills (1 each) and wins the tie on board order; it also out-triggers p3 (2 vs 1).
    expect(sniper?.stats.map((s) => s.stat)).toEqual(['kills', 'procs']);
  });

  it('labels chips in plain words', () => {
    expect(starStatLabel({ stat: 'damage', value: 12 })).toBe('12 damage');
    expect(starStatLabel({ stat: 'kills', value: 1 })).toBe('1 kill');
    expect(starStatLabel({ stat: 'procs', value: 3 })).toBe('3 triggers');
  });
});

describe('oddsRecap', () => {
  const o = (win: number, draw = 0, avgLossDamage = 0) => ({ win, draw, lose: Math.max(0, 1 - win - draw), avgLossDamage });

  it('is one line of copy', () => {
    expect(oddsRecap(o(0.32, 0.1), 'win')!.line).toBe('You had a 32% chance to win');
    expect(oddsRecap(o(1), 'win')!.line).toBe('You were always going to win this one');
    expect(oddsRecap(o(0), 'lose')!.line).toBe('This one was never winnable');
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

  it('uses "an" before 8, 11, 18 and the 80s', () => {
    expect(oddsRecap(o(0.08), 'lose')!.line).toBe('You had an 8% chance to win');
    expect(oddsRecap(o(0.11), 'lose')!.line).toBe('You had an 11% chance to win');
    expect(oddsRecap(o(0.18), 'lose')!.line).toBe('You had an 18% chance to win');
    expect(oddsRecap(o(0.83), 'win')!.line).toBe('You had an 83% chance to win');
    expect(oddsRecap(o(0.7), 'win')!.line).toBe('You had a 70% chance to win');
    expect(articleFor(1)).toBe('a');
  });

  it('always gives all three percentages, summing to 100, 0% and 100% included', () => {
    expect(oddsRecap(o(1), 'win')!.pcts).toEqual({ win: 100, draw: 0, lose: 0 });
    expect(oddsRecap(o(0), 'lose')!.pcts).toEqual({ win: 0, draw: 0, lose: 100 });
    expect(wholePercents(1 / 3, 1 / 3, 1 / 3)).toEqual({ win: 34, draw: 33, lose: 33 });
    const p = wholePercents(0.084, 0.005, 0.911);
    expect(p.win + p.draw + p.lose).toBe(100);
  });
});

describe('typical loss damage', () => {
  const o = (win: number, avg: number, range?: [number, number]) => ({ win, draw: 0, lose: 1 - win, avgLossDamage: avg, ...(range ? { lossDamageRange: range } : {}) });
  it('prints the probe range, a single number when it collapses, and nothing when no loss was possible', () => {
    expect(oddsRecap(o(0.08, 8.1, [7, 9]), 'lose')!.lossLine).toBe('A loss here usually costs 7-9 damage');
    expect(oddsRecap(o(0, 9, [9, 9]), 'lose')!.lossLine).toBe('A loss here usually costs 9 damage');
    expect(oddsRecap(o(0.4, 5.6), 'lose')!.lossLine).toBe('A loss here usually costs 6 damage'); // legacy odds: average only
    expect(oddsRecap(o(1, 0), 'win')!.lossLine).toBeNull();
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
