import { describe, it, expect } from 'vitest';
import { CONFIG, createRun, reduce, questOfferPlan, type RunState } from './index';

// The three global "systems" (quests, runeforge, rifts) share a contract: a master on/off switch that, when
// OFF, still leaves the heroes NATIVE to that system able to access it. Rifts are covered in rifts.test.ts;
// these cover the quest master switch preserving quest-native heroes, and the runeforge system toggle.

describe('quest system master switch preserves quest-native heroes', () => {
  it('questsEnabled = false: Fi keeps turn-3, Coran keeps turn-7, universal 5/11 go dark', () => {
    const prev = CONFIG.questsEnabled;
    CONFIG.questsEnabled = false;
    try {
      // Fi's Errand (lesserQuest) — the turn-3 bonus offer still plans.
      expect(questOfferPlan({ ...createRun(1, 'fi'), wave: 3 })).toEqual({ bucket: 5, lesserOnly: true });
      // Coran's Pathfinder — the turn-7 early quest still plans.
      expect(questOfferPlan({ ...createRun(1, 'coran'), wave: 7 })).toEqual({ bucket: 11 });
      // …but the UNIVERSAL turns (5 & 11) are off for everyone, including Fi.
      expect(questOfferPlan({ ...createRun(1, 'warden'), wave: 5 })).toBeNull();
      expect(questOfferPlan({ ...createRun(1, 'warden'), wave: 11 })).toBeNull();
      expect(questOfferPlan({ ...createRun(1, 'fi'), wave: 5 })).toBeNull();
    } finally {
      CONFIG.questsEnabled = prev;
    }
  });

  it('questsEnabled = true: the universal turns are back for everyone', () => {
    expect(questOfferPlan({ ...createRun(1, 'warden'), wave: 5 })).toEqual({ bucket: 5 });
    expect(questOfferPlan({ ...createRun(1, 'warden'), wave: 11 })).toEqual({ bucket: 11 });
  });
});

describe('runeforge system (CONFIG.runeforgeEnabled)', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
  const advanceTo = (heroId: string, fromWave: number): RunState =>
    reduce({ ...createRun(1, heroId), wave: fromWave, phase: 'combat', hand: [], lastCombat: win }, { type: 'resolveCombat' });

  it('ON: every hero gets the basic forge on turn 6 and the epic forge on turn 9 (both free)', () => {
    const prev = CONFIG.runeforgeEnabled;
    CONFIG.runeforgeEnabled = true;
    try {
      const t6 = advanceTo('warden', 5); // → turn 6
      expect(t6.wave).toBe(6);
      expect(t6.runeforgeOffer?.length).toBeGreaterThan(0);
      expect(t6.runeforgeEpic).toBeFalsy(); // basic
      expect(t6.runeforgeNoCharge).toBe(true); // free

      const t9 = advanceTo('warden', 8); // → turn 9
      expect(t9.wave).toBe(9);
      expect(t9.runeforgeOffer?.length).toBeGreaterThan(0);
      expect(t9.runeforgeEpic).toBe(true); // epic
      expect(t9.runeforgeNoCharge).toBe(true); // free
    } finally {
      CONFIG.runeforgeEnabled = prev;
    }
  });

  it('OFF (default): a non-native hero gets no forge on turn 6 or 9', () => {
    expect(advanceTo('warden', 5).runeforgeOffer).toBeFalsy();
    expect(advanceTo('warden', 8).runeforgeOffer).toBeFalsy();
  });

  it('native heroes keep their own forge with the system OFF (Runesmith turn 7, Runeguard turn 12)', () => {
    const rs = advanceTo('runesmith', 6); // → turn 7
    expect(rs.runeforgeOffer?.length).toBeGreaterThan(0);
    expect(rs.runeforgeEpic).toBeFalsy(); // basic
    const rg = advanceTo('runeguard', 11); // → turn 12
    expect(rg.runeforgeOffer?.length).toBeGreaterThan(0);
    expect(rg.runeforgeEpic).toBe(true); // epic
  });
});
