import { describe, it, expect } from 'vitest';
import { LEARN_ANCIENTS, WARDEN_TIME_COMBAT_LABEL, ancientCombatMods, createCourseRun, getTutorialCourse, reduce, type RunState } from './index';

/**
 * LEARN ANCIENTS (owner ask 2026-11-16) — the ENGINE assumptions the short Ancients course is authored against,
 * driven through the real reducer: the mid-game start, the two Refreshes that awaken the meter, the pinned offer,
 * each branch's payoff on the scripted turn, and a won fight to end on. The UI walk (gate + predicates + branch
 * skips) lives in `ui/src/tutorial/learnAncientsWalkthrough.test.ts`.
 */

const uidOf = (s: RunState, cardId: string): string => s.board.find((c) => c.cardId === cardId)!.uid;
const card = (s: RunState, cardId: string) => s.board.find((c) => c.cardId === cardId)!;

/** Start the course and do the two coached Refreshes. */
function awakened(): RunState {
  let s = createCourseRun(LEARN_ANCIENTS);
  s = reduce(s, { type: 'roll' });
  s = reduce(s, { type: 'roll' });
  return s;
}

/** End Turn → the fight → back out. Returns the settled run. */
function fight(s: RunState): RunState {
  s = reduce(s, { type: 'faceOmen' });
  expect(s.phase, 'End Turn opens combat').toBe('combat');
  s = reduce(s, { type: 'settleCombat' });
  return s;
}

describe('Learn Ancients — the mid-game start', () => {
  it('is registered and starts on turn 8 at Tier 4 with Warden, six Dragons and the meter at 14 of 16', () => {
    expect(getTutorialCourse('learn-ancients')).toBe(LEARN_ANCIENTS);
    const s = createCourseRun(LEARN_ANCIENTS);
    expect([s.mode, s.heroId, s.wave, s.tier, s.embers, s.tutorialCourseId]).toEqual(['tutorial', 'warden', 8, 4, 10, 'learn-ancients']);
    expect(s.board.length).toBe(6);
    expect(s.board.every((c) => c.tribe === 'dragon'), 'a board of Dragons').toBe(true);
    expect(s.board.filter((c) => c.keywords.includes('DS')).map((c) => c.cardId), 'two Dragons start with Ward, so Bonds can fire').toEqual(['d2_scalechanter', 'd2_transcendence']);
    expect(s.ancientsEnabled).toBe(true);
    expect([s.ancients?.points, s.ancients?.cost, s.ancients?.refresh]).toEqual([14, 16, 1]);
    expect(s.ancients?.offer, 'not awakened yet').toBeUndefined();
    expect(s.shop.map((o) => o.cardId), 'the scripted turn-start Shop').toEqual(LEARN_ANCIENTS.turns[0]!.shopRolls[0]!.minions);
    expect(s.lobby?.round, 'the table is on round 8 too').toBe(8);
    expect(s.lobby?.seats.filter((x) => !x.alive).length, 'two seats already out').toBe(2);
    expect(s.heroReady).toBe(true);
  });

  it('two Refreshes fill the meter 15, 16 and awaken War, Bonds, Time (the pinned seed)', () => {
    let s = createCourseRun(LEARN_ANCIENTS);
    s = reduce(s, { type: 'roll' });
    expect(s.ancients?.points).toBe(15);
    expect(s.ancients?.offer).toBeUndefined();
    s = reduce(s, { type: 'roll' });
    expect(s.ancients?.points).toBe(16);
    expect(s.ancients?.offer, 'the coach names these three').toEqual(['war', 'bonds', 'time']);
    expect(s.spell?.cardId, "the second Refresh stocks Champion's Ale for the Time branch").toBe('wo_champion');
    expect(s.embers, 'two 1 Gold Refreshes').toBe(8);
  });
});

describe('Learn Ancients — each pick pays off on the scripted turn, then wins the fight', () => {
  it('BONDS (the steered pick): one Aegis on Earthbreaker gives both Ward Dragons +10 Attack, with hero-power tendrils', () => {
    let s = reduce(awakened(), { type: 'pickAncient', id: 'bonds' });
    expect(s.ancients?.picked).toBe('bonds');
    const eb = card(s, 'd2_scalechanter').attack, tr = card(s, 'd2_transcendence').attack;
    s = reduce(s, { type: 'heroPower', uid: uidOf(s, 'd2_scalechanter') });
    expect(card(s, 'd2_scalechanter').keywords).toContain('DS');
    expect(card(s, 'd2_scalechanter').attack - eb, 'Aegis +5, then Bonds +5 from Transcendant').toBe(10);
    // THE TENDRILS (owner 2026-11-16): the Bonds grants leave the hero-power button, like every Ancient buff.
    const bondsFx = s.recruitBuffFx.filter((e) => e.attack === 5 && e.fromHeroPower);
    expect(bondsFx.map((e) => e.targetUid).sort(), 'one hero-power tendril per Bonds grant').toEqual([uidOf(s, 'd2_scalechanter'), uidOf(s, 'd2_transcendence')].sort());
    expect(card(s, 'd2_transcendence').attack - tr, 'Aegis +5, then Bonds +5 from Earthbreaker').toBe(10);
    s = fight(s);
    expect(s.lastCombat?.result).toBe('win');
  });

  it('WAR: Aegis on Transcendant (already Ward) gives it Resilient Ward', () => {
    let s = reduce(awakened(), { type: 'pickAncient', id: 'war' });
    s = reduce(s, { type: 'heroPower', uid: uidOf(s, 'd2_transcendence') });
    expect(card(s, 'd2_transcendence').keywords).toContain('RW');
    s = fight(s);
    expect(s.lastCombat?.result).toBe('win');
  });

  it("TIME: Aegis, then Champion's Ale gives every Ward minion +3 Attack", () => {
    let s = reduce(awakened(), { type: 'pickAncient', id: 'time' });
    s = reduce(s, { type: 'heroPower', uid: uidOf(s, 'd2_scalechanter') });
    const before = s.board.filter((c) => c.keywords.includes('DS')).map((c) => [c.uid, c.attack] as const);
    expect(before.length).toBe(2);
    s = reduce(s, { type: 'buy', uid: s.spell!.uid });
    const ale = s.hand.find((c) => c.cardId === 'wo_champion')!;
    s = reduce(s, { type: 'play', uid: ale.uid });
    for (const [uid, atk] of before) {
      const now = s.board.find((c) => c.uid === uid)!.attack;
      // +3 from Time (Earthbreaker's own Shop-spell trigger adds +2 on top; the Ale itself buffs the left-most, Humphry).
      expect(now - atk, `${uid} gained at least the Time +3`).toBeGreaterThanOrEqual(3);
    }
    s = fight(s);
    expect(s.lastCombat?.result).toBe('win');
  });

  it('End combat returns to a Shop (the lobby does not end, so the course outro owns the finish)', () => {
    let s = reduce(awakened(), { type: 'pickAncient', id: 'bonds' });
    s = fight(s);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.lobby?.finished).toBe(false);
  });
});

describe('Warden × Bonds in combat: labelled with the power so its tendril leaves the hero-power button', () => {
  it('the combat mod carries the Aegis label (the route `heroPowerBuffLabelFor` maps to Warden)', () => {
    const s = reduce(awakened(), { type: 'pickAncient', id: 'bonds' });
    expect(ancientCombatMods(s).ancientBonds).toEqual({ attack: 5, label: WARDEN_TIME_COMBAT_LABEL });
  });
});
