/**
 * Owner hero batch 2026-08-22 — Rayse, Mimic, Void + the Auctioneer unlock removal.
 *
 * Mimic and Void are the first heroes whose WIELDED power differs from `getHero(heroId).power`, resolved
 * through `activePowers`/`hasPower` (heroes.ts). These tests pin the three layers: the Discover scheduling,
 * the adoption mechanics (incl. Void's two independent slots), and that behaviour sites actually follow the
 * adopted power (the reason the accessor exists at all).
 */
import { describe, expect, it } from 'vitest';
import { activePowers, hasPower, powerDiscoverPool, createRun, getHero, gildCopiesNeeded, reduce, questCombatMods, type RunState } from './index';

const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
/** Advance a run one turn through the real combat path (the tests' standard idiom). */
const advance = (s: RunState): RunState =>
  reduce({ ...s, phase: 'combat', hand: [], lastCombat: win, questOffer: undefined, powerOffer: undefined, pendingPowerOffer: undefined }, { type: 'resolveCombat' });

describe('Auctioneer', () => {
  it('the turn-3 unlock is gone — the Pulse is live from turn 1', () => {
    expect(getHero('myra').power.unlockWave).toBeUndefined();
  });
});

describe('Rayse — Empowering Vines', () => {
  it('threads +2/+3 Taunt through the Hatchery combat channel', () => {
    const s = createRun(1, 'rayse');
    expect(questCombatMods(s).runeHatchery).toEqual({ attack: 2, health: 3 });
  });

  it('SUMS with a real Rune of the Hatchery instead of one masking the other', () => {
    const s: RunState = { ...createRun(1, 'rayse'), questFlags: { runeHatchery: true } };
    expect(questCombatMods(s).runeHatchery).toEqual({ attack: 5, health: 6 });
  });

  it('every other hero is untouched', () => {
    expect(questCombatMods(createRun(1, 'warden')).runeHatchery).toBeUndefined();
  });
});

describe('Mimic — Mimicry', () => {
  it('the run OPENS on a two-option power Discover (turn 1 never passes a turn advance)', () => {
    const s = createRun(5, 'mimic');
    expect(s.powerOffer?.slot).toBe('mimic');
    expect(s.powerOffer?.heroIds).toHaveLength(2);
  });

  it('Brackus is out of the Mimic + Power Shifter pool but still reachable by Void (owner 2026-08-24)', () => {
    // Power Shifter draws from the SAME `powerDiscoverPool('mimic')`, so one assertion covers both.
    expect(powerDiscoverPool('mimic')).not.toContain('brackus');
    expect(powerDiscoverPool('void'), 'the owner only asked to remove it from Mimic + Shifter').toContain('brackus');
  });

  it("never offers the owner's excluded heroes, itself, Void, or a retired power", () => {
    const banned = new Set(['rohan', 'drakko', 'discodan', 'cassen', 'fi', 'runesmith', 'runeguard', 'coran', 'repete', 'vale', 'quillen', 'bram', 'keshi', 'brackus', 'mimic', 'voidhero', 'aster']);
    for (const id of powerDiscoverPool('mimic')) expect(banned.has(id), `${id} must not be offerable`).toBe(false);
    for (let seed = 1; seed <= 60; seed++) {
      for (const id of createRun(seed, 'mimic').powerOffer?.heroIds ?? []) {
        expect(banned.has(id), `seed ${seed} offered ${id}`).toBe(false);
      }
    }
  });

  it('picking ADOPTS the power — behaviour sites follow it, and the charge re-arms', () => {
    const s = { ...createRun(5, 'mimic'), powerOffer: { heroIds: ['cia', 'nadja'], slot: 'mimic' as const }, heroReady: false };
    const after = reduce(s as RunState, { type: 'pickPower', index: 0 });
    expect(after.adoptedPowerId).toBe('cia');
    expect(hasPower(after, 'luckySeat'), 'hasPower reads the disguise').toBe(true);
    expect(hasPower(after, 'mimic'), 'the placeholder is REPLACED, not stacked').toBe(false);
    expect(after.heroReady, 'a fresh disguise is a fresh charge').toBe(true);
    expect(after.ciaSuit, 'an adopted Lucky Seat is seeded a suit').toBeTruthy();
  });

  it('a NEW offer opens at the start of every following turn', () => {
    let s = { ...createRun(5, 'mimic'), powerOffer: undefined, adoptedPowerId: 'nadja', wave: 2 } as RunState;
    s = advance(s);
    expect(s.powerOffer?.slot).toBe('mimic');
    // …and the previous disguise stays wielded until the new pick lands.
    expect(s.adoptedPowerId).toBe('nadja');
  });
});

describe('the WHOLE pool survives adoption — no power errors when worn by Mimic or Void', () => {
  it('every Mimic-offerable power adopts cleanly and (if active+untargeted) fires without throwing', () => {
    for (const heroId of powerDiscoverPool('mimic')) {
      let s = { ...createRun(7, 'mimic'), embers: 20, powerOffer: { heroIds: [heroId, 'warden'], slot: 'mimic' as const } } as RunState;
      s = reduce(s, { type: 'pickPower', index: 0 });
      expect(s.adoptedPowerId, `${heroId} adopted`).toBe(heroId);
      const p = activePowers(s)[0]!;
      expect(p.kind).toBe(getHero(heroId).power.kind);
      // Fire the plain untargeted actives; choice-powers (commission/firstOrLast) and targeted ones need
      // their pickers/targets and are covered by their own hero tests.
      if (!p.passive && p.untargeted && p.kind !== 'commission' && p.kind !== 'firstOrLast') {
        // Clear any modal the ADOPTION itself opened (Brackus's seeded Discover) — the fire is what's under test.
        const armed = { ...s, discover: undefined, discoverQueue: undefined, heroReady: true } as RunState;
        expect(() => reduce(armed, { type: 'heroPower' }), `${heroId}'s power must not throw`).not.toThrow();
      }
    }
  });

  it('every Void-offerable power survives SLOT 1 the same way', () => {
    for (const heroId of powerDiscoverPool('void')) {
      const p = getHero(heroId).power;
      const s = { ...createRun(7, 'voidhero'), embers: 20, voidPowerIds: ['warden', heroId], heroReady2: true } as RunState;
      if (!p.passive && p.untargeted && p.kind !== 'commission' && p.kind !== 'firstOrLast') {
        expect(() => reduce(s, { type: 'heroPower', slot: 1 }), `${heroId} in slot 1 must not throw`).not.toThrow();
      }
      // hasPower sees the slot-1 power for every hero either way.
      expect(hasPower(s, p.kind), `${heroId}'s kind visible from slot 1`).toBe(true);
    }
  });
});

describe('adopted powers pay their start-of-game reward (hardening pass 2026-08-22)', () => {
  const adopt = (heroId: string, over: Partial<RunState> = {}): RunState =>
    reduce({ ...createRun(3, 'voidhero'), wave: 4, powerOffer: { heroIds: [heroId, 'warden'], slot: 'void1' }, ...over } as RunState, { type: 'pickPower', index: 0 });

  it("Yirin's Reflector lands in hand on adoption (the owner's named case)", () => {
    const s = adopt('rohan');
    expect(s.hand.some((c) => c.cardId === 'n2_reflector')).toBe(true);
  });

  it("Chaos's starting token lands on adoption", () => {
    expect(adopt('chaos').hand.some((c) => c.cardId === 'symbioticattachment')).toBe(true);
  });

  it("Brackus's Tier-7 pick opens on adoption, still behind the 70-Gold lock", () => {
    const s = adopt('brackus');
    expect(s.discover?.length ?? 0).toBeGreaterThan(0);
    expect(s.discoverLockGold).toBe(70);
  });

  it("Guardian's Epic Runeforge is scheduled for a FUTURE turn, never the past", () => {
    expect(adopt('runeguard').epicForgeWave).toBe(8);       // adopted turn 4 → the authored turn 8
    const late = reduce({ ...createRun(3, 'voidhero'), wave: 9, powerOffer: { heroIds: ['runeguard', 'warden'], slot: 'void1' } } as RunState, { type: 'pickPower', index: 0 });
    expect(late.epicForgeWave).toBe(10);                    // past turn 8 → next turn, not a visit that never opens
  });

  it('the seed pays ONCE per hero per run — Mimic cannot farm Brackus for a Tier-7 every turn', () => {
    let s = { ...createRun(5, 'mimic'), powerOffer: { heroIds: ['brackus', 'warden'], slot: 'mimic' as const } } as RunState;
    s = reduce(s, { type: 'pickPower', index: 0 });
    const discovers = s.discover ? 1 : 0;
    // Re-adopt next turn: no second Tier-7.
    s = { ...s, discover: undefined, discoverQueue: undefined, powerOffer: { heroIds: ['brackus', 'warden'], slot: 'mimic' } } as RunState;
    s = reduce(s, { type: 'pickPower', index: 0 });
    expect(discovers).toBe(1);
    expect(s.discover, 'no second seeded Discover').toBeUndefined();
  });

  it("a wielded Midas' Touch Gilds at 2 — gildCopiesNeeded follows the power, not the portrait", () => {
    const s = { ...createRun(3, 'voidhero'), voidPowerIds: ['midas', 'warden'] } as RunState;
    expect(gildCopiesNeeded(s)).toBe(2);
    expect(gildCopiesNeeded(createRun(3, 'voidhero'))).toBe(3);
  });

  it("a slot-1 Dynamite Dig escalates ITS OWN cost, not slot 0's", () => {
    const s = { ...createRun(3, 'voidhero'), voidPowerIds: ['warden', 'jenkins'], embers: 10, heroReady: true, heroReady2: true } as RunState;
    const after = reduce(s, { type: 'heroPower', slot: 1 });
    expect(after.heroPowerUses2, 'slot 1 escalated').toBe(1);
    expect(after.heroPowerUses ?? 0, 'slot 0 untouched').toBe(0);
    expect(after.discover?.length ?? 0, 'the dig opened its Discover').toBeGreaterThan(0);
  });
});

describe('Void — Twin Voids', () => {
  it('opens NOTHING before turn 4, then chains two picks into two kept powers', () => {
    expect(createRun(3, 'voidhero').powerOffer).toBeUndefined();
    let s = { ...createRun(3, 'voidhero'), wave: 3 } as RunState;
    s = advance(s);
    expect(s.wave).toBe(4);
    expect(s.powerOffer?.slot).toBe('void1');
    const first = s.powerOffer!.heroIds[0]!;
    s = reduce(s, { type: 'pickPower', index: 0 });
    // The second pick opens IMMEDIATELY, with the first pick off the table.
    expect(s.powerOffer?.slot).toBe('void2');
    expect(s.powerOffer!.heroIds).not.toContain(first);
    s = reduce(s, { type: 'pickPower', index: 1 });
    expect(s.voidPowerIds).toHaveLength(2);
    expect(activePowers(s)).toHaveLength(2);
    expect(s.powerOffer).toBeUndefined();
  });

  it("respects Void's own exclusion list", () => {
    const banned = new Set(['discodan', 'runesmith', 'coran', 'fi', 'vale', 'voidhero', 'mimic', 'aster']);
    for (const id of powerDiscoverPool('void')) expect(banned.has(id), `${id} must not be offerable`).toBe(false);
    // …and Yirin/Drakko/Cassen etc. ARE offerable for Void (only Mimic bans them).
    const pool = new Set(powerDiscoverPool('void'));
    for (const allowed of ['rohan', 'drakko', 'cassen', 'quillen', 'keshi']) {
      expect(pool.has(allowed), `${allowed} is legal for Void`).toBe(true);
    }
  });

  it('the two slots charge and fire independently', () => {
    // Slot 1 = Nadja's Goldspring (untargeted, costs 2): firing it must not consume slot 0's charge.
    const s = { ...createRun(3, 'voidhero'), voidPowerIds: ['warden', 'nadja'], embers: 10, heroReady: true, heroReady2: true } as RunState;
    const after = reduce(s, { type: 'heroPower', slot: 1 });
    // Nadja routes through `maxGoldBonus`, not maxEmbers (her 2026-07-22 persistence fix).
    expect(after.maxGoldBonus ?? 0, "Nadja's power fired from slot 1").toBeGreaterThan(s.maxGoldBonus ?? 0);
    expect(after.heroReady2, 'slot 1 spent').toBe(false);
    expect(after.heroReady, 'slot 0 untouched').toBe(true);
    // …and slot 1 refuses a second use while spent.
    expect(reduce(after, { type: 'heroPower', slot: 1 })).toBe(after);
  });

  it('the wave advance re-arms BOTH slots', () => {
    let s = { ...createRun(3, 'voidhero'), wave: 5, voidPowerIds: ['warden', 'nadja'], heroReady: false, heroReady2: false } as RunState;
    s = advance(s);
    expect(s.heroReady).toBe(true);
    expect(s.heroReady2).toBe(true);
  });
});
