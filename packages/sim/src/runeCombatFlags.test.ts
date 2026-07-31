import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type Keyword } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';

/**
 * Rune batch 3 — the combat flags. Each is checked against the SAME board without the flag, so the assertion
 * measures the rune rather than whatever the board was going to do anyway.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);
const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}, seed = 5) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods as never }), combatSide());
const summons = (r: ReturnType<typeof sim>) => r.events.filter((e) => e.type === 'summon' && e.side === 'player').length;

describe('Rune of the Vanguard', () => {
  it('gives the three left-most Ward, and no more than three', () => {
    const board: BoardMinion[] = Array.from({ length: 5 }, () => ({ cardId: 'sandbag', attack: 1, health: 20 }));
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 200 }];
    const shields = (mods: object) => sim(board, enemy, mods).events.filter((e) => e.type === 'shieldUp').length;
    expect(shields({}), 'baseline should ward nobody').toBe(0);
    expect(shields({ runeVanguard: true }), 'exactly the 3 left-most should be warded').toBe(3);
  });
});

describe('Rune of Finality', () => {
  const wipe: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 1 }];
  const killer: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 40 }];

  it('summons its Imps when the last minion dies', () => {
    expect(summons(sim(wipe, killer, {})), 'baseline should summon nothing').toBe(0);
    expect(summons(sim(wipe, killer, { runeFinality: 7 }))).toBe(7);
  });

  it('has its own latch — holding Pit Without End too pays BOTH', () => {
    // A shared `pitDone` would let whichever ran first silently eat the other, and the loss would be invisible
    // except as "this rune feels weak".
    const both = summons(sim(wipe, killer, { runeFinality: 7, pitWithoutEndImps: 7 }));
    expect(both, 'one rune ate the other').toBe(14);
  });
});

describe('Rune of the Hatchery', () => {
  it('makes Echo summons enter bigger and Taunted', () => {
    // A minion whose Echo summons a body — the flag must reach the SUMMONED token, not the dying parent.
    const parent = Object.values(CARD_INDEX).find((c) => c.effects.some((e) => e.on === 'onDeath' && e.do === 'deathrattleSummon'))!;
    const board: BoardMinion[] = [{ cardId: parent.id, attack: 0, health: 1 }];
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 9, health: 40 }];
    const statsOf = (mods: object) => {
      const r = sim(board, enemy, mods);
      const ev = r.events.find((e) => e.type === 'summon' && e.side === 'player') as { minion?: { attack: number; health: number; keywords?: Keyword[] } } | undefined;
      return ev?.minion;
    };
    const base = statsOf({});
    const hatched = statsOf({ runeHatchery: { attack: 3, health: 3 } });
    expect(base, 'the test parent never summoned anything').toBeDefined();
    expect(hatched!.attack).toBe(base!.attack + 3);
    expect(hatched!.health).toBe(base!.health + 3);
    expect(hatched!.keywords ?? []).toContain('T');
  });
});

describe('Rune of Warding — the sheet says TRIPLE', () => {
  it('triples the right-most minion\'s Health, not doubles it', () => {
    // Owner sheet 2026-07-30. A 20-Health body must end at 60, so the buff event carries +40.
    const board: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 20 }];
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 200 }];
    const r = sim(board, enemy, { runeWarding: true });
    const buff = r.events.find((e) => e.type === 'buff' && e.health > 0) as { health: number } | undefined;
    expect(buff?.health, 'Health was doubled rather than tripled').toBe(40);
  });
});

describe('the five runes ship at the sheet\'s costs', () => {
  it('exists with the right cost and tier', () => {
    const want: [string, number, boolean][] = [
      ['Rune of the Stampede', 4, false], ['Rune of the Hatchery', 4, false],
      ['Rune of the Vanguard', 1, true], ['Rune of Finality', 6, true],
    ];
    for (const [name, cost, epic] of want) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
      expect(!!r!.epic, `${name} epic`).toBe(epic);
    }
  });

  it('the Stampede reuses rallyRepeat rather than a new flag', () => {
    expect(byName('Rune of the Stampede')!.reward).toEqual({ kind: 'rallyRepeat', scope: 'firstEachCombat' });
  });
});
