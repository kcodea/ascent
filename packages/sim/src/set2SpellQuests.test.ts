import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type Keyword } from '@game/core';

/** Local, like the core combat tests — the tribe list is test scaffolding, not a public constant. */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon'];
import { CARD_INDEX, QUEST_DEFS, poolFor } from '@game/content';
import { createRun, type RunState } from './index';
import { applyEndOfTurn, applyShoutsForEndlessVerse, spellCasts, spellCostReduction } from './recruit';

/**
 * SET 2 — the DRAGON spell quests + the Dwarf capstone. Each rides machinery that already exists
 * (`firstSpellThisTurnId`, Spell Thesis's per-turn doubler, `spellCostMod`, the Avenge re-fire), so these tests
 * target the SEAM: that the reward reaches the shared dial rather than sitting inertly in RunState.
 */
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const questById = (id: string) => QUEST_DEFS.find((q) => q.id === id)!;
const aSpell = () => poolFor('set2').spells.find((c) => !c.target)!;

describe('Runic Refrain — End of Turn, copy the turn\'s first spell', () => {
  it('puts a COPY in hand rather than casting it again', () => {
    // The distinction from Rune of Recurrence's `recastFirstSpell`, which resolves the spell immediately.
    const spell = aSpell();
    const s: RunState = { ...set2(), questRecurringEndOfTurn: ['copyFirstSpell'], firstSpellThisTurnId: spell.id, hand: [] };
    const castsBefore = s.spellsCast;
    applyEndOfTurn(s);
    expect(s.hand.filter((c) => c.cardId === spell.id).length, 'no copy arrived in hand').toBe(1);
    expect(s.spellsCast, 'the spell was cast instead of copied').toBe(castsBefore);
  });

  it('does nothing when no spell was cast this turn', () => {
    const s: RunState = { ...set2(), questRecurringEndOfTurn: ['copyFirstSpell'], firstSpellThisTurnId: undefined, hand: [] };
    applyEndOfTurn(s);
    expect(s.hand.length).toBe(0);
  });
});

describe('The Endless Verse — Shouts re-arm the turn doubler', () => {
  it('hands the spent doubler back after 3 Shouts, within the same turn', () => {
    // The reward is worthless if it only sets the doubler: Spell Thesis already does that. The whole quest is
    // the RE-ARM, so the test spends the freebie first and checks it comes back.
    const s: RunState = { ...set2(), spellFirstDoubleEachTurn: true, spellFirstUsedThisTurn: true, endlessVerse: { per: 3, tick: 0 } };
    const spell = aSpell();
    expect(spellCasts(s, spell), 'the doubler should be spent at this point').toBe(1);
    applyShoutsForEndlessVerse(s, 2);
    expect(spellCasts(s, spell), 're-armed below the threshold').toBe(1);
    applyShoutsForEndlessVerse(s, 1);
    expect(spellCasts(s, spell), 'the doubler never came back after 3 Shouts').toBe(2);
  });

  it('banks the remainder across turns', () => {
    const s: RunState = { ...set2(), spellFirstDoubleEachTurn: true, spellFirstUsedThisTurn: true, endlessVerse: { per: 3, tick: 2 } };
    applyShoutsForEndlessVerse(s, 1);
    expect(s.spellFirstUsedThisTurn).toBe(false);
  });
});

describe('The Sealed Vault — the first Avenge each combat triggers twice', () => {
  // Mirrors the Rune of Fury test's board: Weaver's Avenge(2) grants a Spirit Fire, and two Taunt sandbags die
  // to feed it. `questMods` rides on the player's CombatSideState, not a trailing argument.
  const sim = (p: BoardMinion[], e: BoardMinion[], mods = {}) =>
    simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: mods }), combatSide());
  const weaver = (fodder: number): BoardMinion[] => [
    { cardId: 'weaver', attack: 0, health: 30 },
    ...Array.from({ length: fodder }, () => ({ cardId: 'sandbag', attack: 0, health: 1, keywords: ['T'] as Keyword[] })),
  ];
  const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 5 }];

  /**
   * The `avenge` bus event fires on EVERY friendly death; each avenge factory then decides whether that death
   * meets its own threshold. So "the first Avenge triggers twice" has to mean the first death that actually PAYS
   * — latching on the first broadcast burns the doubler on a no-op, and an earlier cut of this did exactly that:
   * the reward measured identical to baseline at every board size. Weaver is Avenge(2), so N fodder pays
   * floor(N/2) times; the Vault adds exactly one, and Fury doubles the lot.
   */
  it('adds exactly one payout — the first Avenge, doubled', () => {
    expect(sim(weaver(2), enemy, {}).playerHandGrants!.length).toBe(1);
    expect(sim(weaver(2), enemy, { avengeFirstDouble: true }).playerHandGrants!.length).toBe(2);
    expect(sim(weaver(6), enemy, {}).playerHandGrants!.length).toBe(3);
    expect(sim(weaver(6), enemy, { avengeFirstDouble: true }).playerHandGrants!.length).toBe(4);
  });

  it('doubles only the FIRST — Fury doubles every one', () => {
    // If the flag were a plain Fury alias, this is the assertion that catches it: at 6 fodder Fury pays 6, the
    // Vault 4. A no-op implementation would read 3, which is why baseline is pinned above.
    expect(sim(weaver(6), enemy, { runeFury: true }).playerHandGrants!.length).toBe(6);
    expect(sim(weaver(6), enemy, { avengeFirstDouble: true }).playerHandGrants!.length).toBe(4);
  });
});

describe('The Company Store — Shop spells cost 1 less', () => {
  it('feeds the same cost dial Lazarus writes to, so the two stack', () => {
    const s = set2();
    const before = spellCostReduction(s);
    const armed: RunState = { ...s, spellCostMod: s.spellCostMod + 1 };
    expect(spellCostReduction(armed)).toBe(before + 1);
    const withLazarus: RunState = { ...armed, board: [{ uid: 'l', cardId: 'lazarus', tribe: CARD_INDEX['lazarus']!.tribe, attack: 1, health: 1, keywords: [], golden: false }] };
    expect(spellCostReduction(withLazarus), 'the quest and Lazarus did not stack').toBe(before + 2);
  });
});

describe('the quest data', () => {
  it('all four are set-2 only', () => {
    for (const id of ['q_runic_refrain', 'q_endless_verse', 'q_sealed_vault', 'q_company_store']) {
      expect(questById(id).sets, `${id} leaks outside set 2`).toEqual(['set2']);
    }
  });

  it('the gilded grants name real cards', () => {
    for (const [id, card] of [['q_sealed_vault', 'd2_curator'], ['q_company_store', 'dw_dorrin']] as const) {
      const rewards = (questById(id).reward as { rewards: { grantGolden?: string[] }[] }).rewards;
      expect(rewards.some((x) => x.grantGolden?.includes(card)), `${id} does not grant a gilded ${card}`).toBe(true);
      expect(CARD_INDEX[card], `${card} does not exist`).toBeDefined();
    }
  });
});
