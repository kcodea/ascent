import { describe, it, expect } from 'vitest';
import { CONFIG, createRun, reduce, questOfferPlan, type RunState } from './index';

// The three global "systems" (quests, runeforge, rifts) share a contract: a master on/off switch that, when
// OFF, still leaves the heroes NATIVE to that system able to access it. Rifts are covered in rifts.test.ts;
// these cover the quest master switch preserving quest-native heroes, and the runeforge system toggle.

/**
 * THE LIVE DEFAULTS (set 2 go-live, 2026-07-31): set 2 active, quests OFF, the Runeforge ON. These tests run
 * against the shipped config untouched — they are the owner's go-live checklist, not toggle exercises.
 */
describe('set 2 go-live defaults', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

  it('a new run pins SET 2', () => {
    expect(createRun(1).setId).toBe('set2');
  });

  it('quests are OFF: no universal offer on turns 5 or 11', () => {
    expect(questOfferPlan({ ...createRun(1, 'warden'), wave: 5 })).toBeNull();
    expect(questOfferPlan({ ...createRun(1, 'warden'), wave: 11 })).toBeNull();
  });

  it('Fi still gets her turn-4 Lesser quest, and Coran his turn-10 quest (owner double-check 2026-07-31)', () => {
    expect(questOfferPlan({ ...createRun(1, 'fi'), wave: 4 })).toEqual({ bucket: 5, lesserOnly: true });
    expect(questOfferPlan({ ...createRun(1, 'coran'), wave: 10 })).toEqual({ bucket: 11 });
    // …and through the real turn advance, the offers actually open.
    const fiT4 = reduce({ ...createRun(1, 'fi'), wave: 3, phase: 'combat', hand: [], lastCombat: win }, { type: 'resolveCombat' });
    expect(fiT4.wave).toBe(4);
    expect(fiT4.questOffer?.length ?? 0).toBeGreaterThan(0);
    const coranT10 = reduce({ ...createRun(1, 'coran'), wave: 9, phase: 'combat', hand: [], lastCombat: win }, { type: 'resolveCombat' });
    expect(coranT10.wave).toBe(10);
    expect(coranT10.questOffer?.length ?? 0).toBeGreaterThan(0);
  });

  it('the Runeforge is ON: basic on turn 6, epic on turn 9, for a non-native hero', () => {
    const t6 = reduce({ ...createRun(1, 'warden'), wave: 5, phase: 'combat', hand: [], lastCombat: win }, { type: 'resolveCombat' });
    expect(t6.runeforgeOffer?.length ?? 0).toBeGreaterThan(0);
    expect(t6.runeforgeEpic).toBeFalsy();
    const t9 = reduce({ ...createRun(1, 'warden'), wave: 8, phase: 'combat', hand: [], lastCombat: win }, { type: 'resolveCombat' });
    expect(t9.runeforgeOffer?.length ?? 0).toBeGreaterThan(0);
    expect(t9.runeforgeEpic).toBe(true);
  });
});

describe('quest system master switch preserves quest-native heroes', () => {
  it('questsEnabled = false: Fi keeps turn-4, Coran keeps turn-10, universal 5/11 go dark', () => {
    const prev = CONFIG.questsEnabled;
    CONFIG.questsEnabled = false;
    try {
      // Fi's Errand (lesserQuest) — the turn-4 bonus offer still plans.
      expect(questOfferPlan({ ...createRun(1, 'fi'), wave: 4 })).toEqual({ bucket: 5, lesserOnly: true });
      // Coran's Pathfinder — the turn-10 bonus Capstone quest still plans.
      expect(questOfferPlan({ ...createRun(1, 'coran'), wave: 10 })).toEqual({ bucket: 11 });
      // …but the UNIVERSAL turns (5 & 11) are off for everyone, including Fi and Coran.
      expect(questOfferPlan({ ...createRun(1, 'warden'), wave: 5 })).toBeNull();
      expect(questOfferPlan({ ...createRun(1, 'warden'), wave: 11 })).toBeNull();
      expect(questOfferPlan({ ...createRun(1, 'fi'), wave: 5 })).toBeNull();
      expect(questOfferPlan({ ...createRun(1, 'coran'), wave: 5 })).toBeNull();
      expect(questOfferPlan({ ...createRun(1, 'coran'), wave: 11 })).toBeNull();
    } finally {
      CONFIG.questsEnabled = prev;
    }
  });

  it('questsEnabled = true: the universal turns are back for everyone (incl. Coran) + Coran keeps turn-10', () => {
    // Set explicitly — since 2026-07-31 the DEFAULT is false (set 2 runs quests off), so this test arms it.
    const prev = CONFIG.questsEnabled;
    CONFIG.questsEnabled = true;
    try {
    expect(questOfferPlan({ ...createRun(1, 'warden'), wave: 5 })).toEqual({ bucket: 5 });
    expect(questOfferPlan({ ...createRun(1, 'warden'), wave: 11 })).toEqual({ bucket: 11 });
    // Coran runs the universal 5 & 11 AND his bonus turn-10.
    expect(questOfferPlan({ ...createRun(1, 'coran'), wave: 5 })).toEqual({ bucket: 5 });
    expect(questOfferPlan({ ...createRun(1, 'coran'), wave: 10 })).toEqual({ bucket: 11 });
    expect(questOfferPlan({ ...createRun(1, 'coran'), wave: 11 })).toEqual({ bucket: 11 });
    } finally {
      CONFIG.questsEnabled = prev;
    }
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

  it('OFF: a non-native hero gets no forge on turn 6 or 9 (the default is ON since set 2 went live)', () => {
    const prev = CONFIG.runeforgeEnabled;
    CONFIG.runeforgeEnabled = false;
    try {
    expect(advanceTo('warden', 5).runeforgeOffer).toBeFalsy();
    expect(advanceTo('warden', 8).runeforgeOffer).toBeFalsy();
    } finally {
      CONFIG.runeforgeEnabled = prev;
    }
  });

  it('native heroes keep their own forge with the system OFF (Runesmith turn 5, Runeguard turn 8)', () => {
    // The HERO forges sit one turn AHEAD of the universal system's 6 / 9 (owner 2026-07-31), so a runeforge
    // hero is early to the forge rather than redundant with a system that would have opened one anyway.
    const rs = advanceTo('runesmith', 4); // → turn 5
    expect(rs.runeforgeOffer?.length).toBeGreaterThan(0);
    expect(rs.runeforgeEpic).toBeFalsy(); // basic
    const rg = advanceTo('runeguard', 7); // → turn 8
    expect(rg.runeforgeOffer?.length).toBeGreaterThan(0);
    expect(rg.runeforgeEpic).toBe(true); // epic
  });
});
