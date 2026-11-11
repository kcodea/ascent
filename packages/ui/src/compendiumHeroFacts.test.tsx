// @vitest-environment jsdom
/**
 * THE HERO SHOWCASE'S POWER FACTS (owner ask 2026-11-11: the Compendium's hero inspect shows "their full art and
 * everything"). The small pills under a power's name are read from the power's own fields, so they can never drift
 * from the rules: how it is used, its Gold cost, and any limit.
 */
import { describe, expect, it } from 'vitest';
import { HEROES } from '@game/sim';
import { heroPowerFacts } from './MinionBook';

describe('heroPowerFacts', () => {
  it('leads with Passive or Active for every hero', () => {
    for (const h of HEROES) {
      expect(heroPowerFacts(h.power)[0]).toBe(h.power.passive ? 'Passive' : 'Active');
    }
  });

  it('prints the cost and the limits the power carries', () => {
    expect(heroPowerFacts({ name: 'x', text: 'x', kind: 'gildcrafter', cost: 3, maxUses: 3 })).toEqual(['Active', '3 Gold', '3 uses per game']);
    expect(heroPowerFacts({ name: 'x', text: 'x', kind: 'copyMachine', oncePerGame: true })).toEqual(['Active', 'Once per game']);
    expect(heroPowerFacts({ name: 'x', text: 'x', kind: 'pocketMagic', cost: 1, usesPerTurn: 2, unlockWave: 4 })).toEqual(['Active', '1 Gold', '2 uses per turn', 'Unlocks turn 4']);
  });

  it('adds nothing a power does not have', () => {
    expect(heroPowerFacts({ name: 'x', text: 'x', kind: 'sellGold', passive: true, cost: 0, unlockWave: 1 })).toEqual(['Passive']);
  });

  it('uses no dash a player would read as a break', () => {
    for (const h of HEROES) for (const t of heroPowerFacts(h.power)) expect(t).not.toMatch(/—|--/);
  });
});
