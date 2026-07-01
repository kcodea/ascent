import { describe, expect, it } from 'vitest';
import type { CombatResult } from '@game/core';
import { combatGains } from './combatGains';

const base: CombatResult = {
  events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
  initial: { player: [], enemy: [] },
};

describe('combatGains (A4 post-combat summary)', () => {
  it('returns [] when nothing lasting happened', () => {
    expect(combatGains(base)).toEqual([]);
    expect(combatGains(null)).toEqual([]);
  });

  it('summarizes the permanent carry-backs, most-impactful first', () => {
    const r: CombatResult = {
      ...base,
      playerSpellPower: { attack: 2, health: 0 },
      playerMaxGoldGain: 1,
      playerUndeadBuyAtkGain: 3,
      playerImpBuffGain: { attack: 2, health: 3 },
      playerFodderGrants: 2,
      playerFreeRolls: 1,
      playerHandGrants: ['spiritfire', 'emberpouch'],
      playerPermaBuffs: [
        { sourceUid: 'a', attack: 3, health: 2, engraved: true },
        { sourceUid: 'b', attack: 1, health: 1, engraved: true },
      ],
    };
    const g = combatGains(r);
    expect(g[0]).toBe('Your spells gain +2/+0 — permanent'); // spell power leads
    expect(g).toContain('Maximum Gold +1');
    expect(g).toContain('Your Undead gain +3 Attack — permanent');
    expect(g).toContain('Your Imps gain +2/+3 — permanent');
    expect(g).toContain('Kept combat stats +4/+3 across 2 minions'); // engraved aggregated
    expect(g).toContain('2 Fodders added to your next tavern');
    expect(g).toContain('1 free reroll banked'); // singular
    expect(g.some((l) => l.startsWith('Added to your hand:'))).toBe(true);
  });

  it('skips zero-magnitude buffs', () => {
    expect(combatGains({ ...base, playerImpBuffGain: { attack: 0, health: 0 }, playerMaxGoldGain: 0 })).toEqual([]);
  });
});
