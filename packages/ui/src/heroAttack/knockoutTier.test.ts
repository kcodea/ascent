// @vitest-environment jsdom
/**
 * A KNOCKOUT ALWAYS PLAYS THE HUGE ATTACK (owner ask 2026-09-29: "add logic so that if a player knocks someone out, it
 * always plays the "huge" animation"). Oracle R-PROG-ATTACK-20.
 *
 * The rule lives in ONE place (`attackTier` in `tiers.ts`); every style's plan takes its tier from it, and the
 * knockout itself is read off the state the engine settles from (`heroStrikeKnockout`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { DEFAULT_PRACTICE_CONFIG, createLobbyRun, playerOpponent, type RunState } from '@game/sim';
import { HERO_ATTACK_TIER_THRESHOLDS, KNOCKOUT_TIER, attackTier, tierOf } from './tiers';
import { formationOf } from './formationFixtures';
import type { HeroAttackHandle, HeroAttackOptions } from './options';
import { playHeroClassic } from './heroClassic';
import { playHeroBlast } from '../heroBlast/heroBlast';
import { playHeroQuake } from '../heroQuake/heroQuake';
import { playHeroArcana } from '../heroArcana/heroArcana';
import { playHeroBlades } from '../heroBlades/heroBlades';
import { playHeroEnraged } from '../heroEnraged/heroEnraged';
import { playHeroPoison } from '../heroPoison/heroPoison';
import { playHeroFrost } from '../heroFrost/heroFrost';
import { playHeroHoly } from '../heroHoly/heroHoly';
import { playHeroFire } from '../heroFire/heroFire';
import { playHeroUndead } from '../heroUndead/heroUndead';
import { heroStrikeDamage, heroStrikeKnockout } from '../heroBlast/heroStrikeDamage';

describe('attackTier: the one shared tier rule', () => {
  it('a knockout is always Tier IV, whatever the number', () => {
    expect(KNOCKOUT_TIER).toBe(4);
    for (const total of [0, 1, 3, 5, 6, 11, 12, 19, 20, 40]) expect(attackTier(total, { knockout: true })).toBe(4);
  });

  it('without a knockout it is exactly the damage tier (I 1-5, II 6-11, III 12-19, IV 20+)', () => {
    for (const total of [0, 1, 3, 5, 6, 11, 12, 19, 20, 40]) {
      expect(attackTier(total, { knockout: false })).toBe(tierOf(total));
      expect(attackTier(total, {})).toBe(tierOf(total));
      expect(attackTier(total, undefined)).toBe(tierOf(total));
    }
    expect(attackTier(3, {})).toBe(1);
    expect(attackTier(20, {})).toBe(4);
  });

  it('honours tuned thresholds when not a knockout, and ignores them on one', () => {
    const t = { ...HERO_ATTACK_TIER_THRESHOLDS, tier2At: 2 };
    expect(attackTier(3, {}, t)).toBe(2);
    expect(attackTier(3, { knockout: true }, t)).toBe(4);
  });
});

describe('every style plays its Tier IV on a knockout blow of 3, and Tier I on a non-lethal 3', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  const opts = (knockout: boolean): HeroAttackOptions => ({
    formation: formationOf([1, 2], 3), total: 3, knockout, side: 'player', attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 },
    reduced: false, onImpact: vi.fn(), frames: () => () => {}, sound: false, safety: false, host: document.body, camera: null,
    mount: () => () => {},
  });
  const tiered: [string, (o: HeroAttackOptions) => HeroAttackHandle & { plan: { tier: number } }][] = [
    ['blast', (o) => playHeroBlast({ ...o, textures: null })],
    ['quake', (o) => playHeroQuake({ ...o, textures: null })],
    ['arcana', (o) => playHeroArcana({ ...o, textures: null })],
    ['blades', (o) => playHeroBlades({ ...o, textures: null })],
    ['enraged', (o) => playHeroEnraged({ ...o, textures: null, impactFx: false })],
    ['poison', (o) => playHeroPoison({ ...o, textures: null })],
    ['frost', (o) => playHeroFrost({ ...o, textures: null })],
    ['holy', (o) => playHeroHoly({ ...o, textures: null })],
    ['fire', (o) => playHeroFire({ ...o, textures: null })],
    ['undead', (o) => playHeroUndead({ ...o, textures: null })],
  ];

  it('the cosmetic styles', () => {
    for (const [name, play] of tiered) {
      const ko = play(opts(true));
      expect(ko.plan.tier, `${name} knockout`).toBe(4);
      ko.cancel();
      const plain = play(opts(false));
      expect(plain.plan.tier, `${name} non-lethal`).toBe(1);
      plain.cancel();
    }
  });

  it('Classic (its plan carries the tier as k: I = 0, IV = 1)', () => {
    const ko = playHeroClassic({ ...opts(true), impactFx: false });
    expect(ko.plan.k).toBe(1);
    ko.cancel();
    const plain = playHeroClassic({ ...opts(false), impactFx: false });
    expect(plain.plan.k).toBe(0);
    plain.cancel();
  });
});

describe('heroStrikeKnockout: read off the pools the engine settles from', () => {
  const fight = (r: Partial<CombatResult>): CombatResult => ({ events: [], result: 'win', playerDamage: 0, enemyDamage: 0, ...r } as unknown as CombatResult);
  const lobbyRun = (): RunState => createLobbyRun(11, 'aster', {}, 'lobby');

  it('YOUR blow knocks the foe seat out when its Resolve + Armor going in is at or under it', () => {
    const run = { ...lobbyRun(), lastCombat: fight({ result: 'win', enemyDamage: 3 }) };
    const foe = playerOpponent(run.lobby!);
    expect(foe && !foe.ghost).toBe(true);
    expect(heroStrikeDamage(run, true)).toBe(3);
    foe!.seat.resolve = 2; foe!.seat.armor = 1;
    expect(heroStrikeKnockout(run, true)).toBe(true);
    foe!.seat.resolve = 3; foe!.seat.armor = 1;
    expect(heroStrikeKnockout(run, true)).toBe(false);
  });

  it("the FOE's blow knocks YOU out when your Resolve + Armor going in is at or under it (Armor absorbs first)", () => {
    const base = lobbyRun();
    const run = { ...base, resolve: 2, armor: 1, lastCombat: fight({ result: 'lose', playerDamage: 3 }) };
    expect(heroStrikeDamage(run, false)).toBe(3);
    expect(heroStrikeKnockout(run, false)).toBe(true);
    expect(heroStrikeKnockout({ ...run, armor: 2 }, false)).toBe(false);
  });

  it('invulnerable Practice never knocks you out; a zero blow never knocks anyone out', () => {
    const base = lobbyRun();
    const run = { ...base, mode: 'practice' as const, resolve: 1, armor: 0, lastCombat: fight({ result: 'lose', playerDamage: 3 }) };
    expect(heroStrikeKnockout(run, false)).toBe(false);
    expect(heroStrikeKnockout({ ...run, practiceConfig: { ...DEFAULT_PRACTICE_CONFIG, health: 'normal' } }, false)).toBe(true);
    expect(heroStrikeKnockout({ ...base, resolve: 0, armor: 0, lastCombat: fight({ result: 'lose', playerDamage: 0 }) }, false)).toBe(false);
  });
});
