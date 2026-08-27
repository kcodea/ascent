import { describe, it, expect } from 'vitest';
import { simulate, makeRng, combatSide, type BoardMinion } from '@game/core';
import { CARD_INDEX, RUNE_INDEX, runeStacks } from '@game/content';
import { createRun, type RunState } from './state';
import { reduce, questCombatMods } from './reducer';
import { teachMagePup } from './recruit';

/**
 * RUNE OF DUPLICATION — a duplicated rune must actually DO something (owner report 2026-08-06: "i got rune
 * of duplication, and then rune of the procession, so i had 2 of them, but only 1 of them was triggering").
 *
 * Duplication always DID re-apply the copied rune's reward — the bug was that 41 of 72 Epic rune rewards
 * ASSIGN rather than accumulate, so the second application wrote the same value over itself. Two shapes now
 * carry a second copy, per the owner's rulings:
 *   · AMOUNT-carrying combat flags ACCUMULATE ("my gut says yes")
 *   · BOOLEAN combat flags record a copy count the dispatchers honour (Procession — the reported case)
 *   · Rune of the White Wolf became a count ("should give a second pup as if you had 2 mentors")
 * Runes that still genuinely cannot stack are surfaced honestly instead, via `runeStacks` → the forge pill.
 */
const buyRune = (runeId: string, over: Partial<RunState> = {}): RunState => {
  const s: RunState = { ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers: 30, setId: 'set2', runeforgeOffer: [runeId], ...over } as RunState;
  return reduce(s, { type: 'buyRune', index: 0 });
};
/** Buy the rune WITH Rune of Duplication armed at an Epic forge — the state the owner was in. */
const buyDuplicated = (runeId: string): RunState =>
  buyRune(runeId, { runeDuplication: true, runeforgeEpic: true } as Partial<RunState>);

describe("the owner's case: two Rune of the Procession trigger twice", () => {
  const fires = (s: RunState): number => {
    // Procession is Avenge (4): double the right-most minion's stats. 8 dying bodies = two crossings.
    const player: BoardMinion[] = [
      ...Array.from({ length: 8 }, (): BoardMinion => ({ cardId: 'sandbag', attack: 0, health: 1 })),
      { cardId: 'pack', attack: 2, health: 400 },
    ];
    const r = simulate(player, [{ cardId: 'sandbag', attack: 40, health: 4000 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, questMods: questCombatMods(s) }), combatSide({ tier: 6 }));
    return r.events.filter((e) => e.type === 'buff' && e.source === 'Rune of the Procession').length;
  };

  it('one copy fires once per Avenge crossing; TWO copies fire twice', () => {
    const one = fires(buyRune('rune_procession'));
    const two = fires(buyDuplicated('rune_procession'));
    expect(one, 'the rune fires at all').toBeGreaterThan(0);
    expect(two, 'the duplicate is not a no-op — this is the reported bug').toBe(one * 2);
  });

  it('the copy count rides the combat mods, and a single copy is unchanged', () => {
    expect(questCombatMods(buyRune('rune_procession')).flagCopies?.runeProcession).toBe(1);
    expect(questCombatMods(buyDuplicated('rune_procession')).flagCopies?.runeProcession).toBe(2);
  });
});

describe('amount-carrying flags ACCUMULATE when duplicated (owner ruling)', () => {
  it.each([
    ['rune_finality', 'runeFinality', 7],
    ['rune_living_echoes', 'runeLivingEchoes', 3],
    ['rune_overflow', 'runeOverflow', 4],
    ['rune_gemstorm', 'runeGemstorm', 2],
    ['rune_attacking_gems', 'runeAttackingGems', 1],
  ])('%s doubles its amount', (runeId, flag, single) => {
    expect(buyRune(runeId).questFlags?.[flag as 'runeFinality'], 'single copy unchanged').toBe(single);
    expect(buyDuplicated(runeId).questFlags?.[flag as 'runeFinality'], 'duplicated accumulates').toBe(single * 2);
  });

  it('a THRESHOLD amount does NOT grow — it is a cadence, not a magnitude', () => {
    // Assembly Line's amount is "Avenge N", so accumulating it would make the rune fire LESS often.
    const one = buyRune('rune_assembly').questFlags?.assemblyLine;
    expect(buyDuplicated('rune_assembly').questFlags?.assemblyLine).toBe(one);
  });
});

describe('Rune of the White Wolf gives a second pup when duplicated (owner ruling)', () => {
  const teachesAllowed = (s: RunState): number => {
    const st: RunState = { ...s, hand: [], moonhowlTeachesThisTurn: 0 };
    let n = 0;
    for (let i = 0; i < 6; i++) {
      const before = st.moonhowlTeachesThisTurn ?? 0;
      teachMagePup(st, 'growth');
      if ((st.moonhowlTeachesThisTurn ?? 0) === before) break;
      n += 1;
    }
    return n;
  };
  it('one copy teaches once a turn; two copies teach twice', () => {
    expect(teachesAllowed(buyRune('rune_white_wolf'))).toBe(1);
    expect(teachesAllowed(buyDuplicated('rune_white_wolf'))).toBe(2);
  });
});

describe('runeStacks — the honesty signal behind the forge pill', () => {
  it('classifies per the 2026-08-27 duplicate rulings: everything stacks except the ruled exceptions', () => {
    // Since the duplicate-stacking pass, the old "whole-value assignment" shapes stack too — Mastery adds a
    // repetition per copy, the Shared Table's grant accumulates, etc.
    expect(runeStacks(RUNE_INDEX['rune_procession']!), 'combat flags stack').toBe(true);
    expect(runeStacks(RUNE_INDEX['rune_taurus']!), 'a granted card stacks').toBe(true);
    expect(runeStacks(RUNE_INDEX['rune_reliquary']!), 'a recurring effect stacks').toBe(true);
    expect(runeStacks(RUNE_INDEX['rune_mastery']!), '+1 Improve repetition per copy').toBe(true);
    expect(runeStacks(RUNE_INDEX['rune_shared_table']!), 'the Ale grant accumulates').toBe(true);
    // …the ruled exceptions pay the sweetener (or, for the Ornate Clock, nothing).
    expect(runeStacks(RUNE_INDEX['rune_twin_gilding']!), 'already at 2 — cannot lower again').toBe(false);
    expect(runeStacks(RUNE_INDEX['rune_ornate_clock']!), 'owner-ruled unique').toBe(false);
  });

  it('every rune classifies without throwing (a new rune is covered the moment it is authored)', () => {
    for (const rune of Object.values(RUNE_INDEX)) expect(typeof runeStacks(rune)).toBe('boolean');
  });
});
