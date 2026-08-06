import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { RUBY_ID, applyEndOfTurn, mintRubies, rubyCastCount } from './recruit';

/**
 * SET 2 — the KOBOLD quest line. Every quest here pushes one of the tribe's two dials (Ruby STRENGTH or Ruby
 * CAST COUNT). The completions below run through the REAL objective path — a real buy, a real Ruby cast — rather
 * than reaching past `applyQuestReward`, which is module-private on purpose: a reward that only works when poked
 * directly would pass a shape check and still be unreachable in a game.
 */
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const questById = (id: string) => QUEST_DEFS.find((q) => q.id === id)!;
const armed = (s: RunState, id: string): RunState => ({
  ...s, embers: 30,
  activeQuests: [{ questId: id, progress: questById(id).objective.count - 1, completed: false }],
});

/** Finish a `buy`-objective quest by buying its last card — `cardId` seeds the offer so a tribe-scoped
 *  objective (Open the Vein wants a Kobold) actually counts. */
const completeByBuying = (s: RunState, id: string, cardId: string): RunState => {
  const a = armed(s, id);
  return reduce({ ...a, shop: [{ uid: 'offer', cardId }, ...a.shop.slice(1)] }, { type: 'buy', uid: 'offer' });
};
/** Finish a `castRuby` quest by casting a Ruby onto a board minion. */
const completeByCastingRuby = (s: RunState, id: string): RunState => {
  const a = armed(s, id);
  mintRubies(a, 1);
  const ruby = a.hand.find((c) => c.cardId === RUBY_ID)!;
  const target: BoardCard = { uid: 't', cardId: 'pack', tribe: 'beast', attack: 3, health: 3, keywords: [], golden: false };
  return reduce({ ...a, board: [target] }, { type: 'play', uid: ruby.uid, targetUid: 't' });
};

describe('Ruby strength rewards (Open the Vein / Faultline Coronation)', () => {
  it('raises the run-wide Ruby bonus, and Rubies already in hand grow with it', () => {
    // The dial has to reach BOTH: a reward that only bumped `rubyBonus` would leave held Rubies stale at their
    // minted stats, so a Ruby you were already holding would be weaker than one drawn a second later.
    let s = set2();
    mintRubies(s, 1);
    const before = s.hand.find((c) => c.cardId === RUBY_ID)!.attack;
    s = completeByBuying(s, 'q_open_the_vein', 'k_gemheart');
    expect(s.rubyBonus).toEqual({ attack: 2, health: 2 });
    expect(s.hand.find((c) => c.cardId === RUBY_ID)!.attack, 'a held Ruby stayed at its old strength').toBe(before + 2);
  });

  it('a Ruby minted AFTER the reward is born at the new strength', () => {
    const s = completeByBuying(set2(), 'q_faultline_coronation', 'k_gemheart');
    mintRubies(s, 1);
    expect(s.hand.find((c) => c.cardId === RUBY_ID)!.attack).toBe(CARD_INDEX[RUBY_ID]!.attack + 4);
  });
});

describe('Ruby cast-count rewards (Gem Circuit / Unstable Riches)', () => {
  it('Unstable Riches adds a cast to EVERY Ruby, all turn', () => {
    const s = completeByCastingRuby(set2(), 'q_unstable_riches');
    expect(s.rubyExtraCasts).toBe(1);
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 0 })).toBe(2);
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 5 }), 'the always-scope reward stopped applying later in the turn').toBe(2);
  });

  it('Gem Circuit applies to the turn-opening Ruby only', () => {
    const s = completeByCastingRuby(set2(), 'q_gem_circuit');
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 0 }), 'the first Ruby did not get its 2 extra casts').toBe(3);
    // The whole point of the scope: once a Ruby has been cast this turn, the bonus is spent.
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 1 })).toBe(1);
  });

  it('the two stack additively rather than one shadowing the other', () => {
    const s = { ...set2(), rubyExtraCasts: 1, rubyFirstExtraCasts: 2 };
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 0 })).toBe(4); // 1 base + 1 always + 2 first
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 1 })).toBe(2); // 1 base + 1 always
  });
});

describe('Rune of Resonance — rework 2026-08-06 (first 2 Rubies double; 2 Rubies/turn; immediate payout)', () => {
  const buyResonance = (over: Partial<RunState> = {}): RunState => {
    const s: RunState = { ...set2(), wave: 7, embers: 10, runeforgeOffer: ['rune_resonance'], ...over };
    return reduce(s, { type: 'buyRune', index: 0 });
  };

  it('buying it mints 2 Rubies IMMEDIATELY (owner: "it should give you a gem immediately")', () => {
    const s = buyResonance();
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length).toBe(2);
  });

  it('the first TWO Rubies each turn cast twice; the third casts once', () => {
    const s = buyResonance();
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 0 }), 'first Ruby').toBe(2);
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 1 }), 'second Ruby').toBe(2);
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 2 }), 'third Ruby').toBe(1);
  });

  it('a Ruby PLAY advances the window by 1 even though it resolved 2 casts', () => {
    // The gate counts plays, not resolved casts — a doubled first Ruby must not eat the second slot.
    let s = buyResonance({ board: [{ uid: 'm', cardId: 'pack', tribe: 'beast', attack: 3, health: 2, keywords: [], golden: false }] });
    const ruby = s.hand.find((c) => c.cardId === RUBY_ID)!;
    s = reduce(s, { type: 'play', uid: ruby.uid, targetUid: 'm' });
    expect(s.rubyCastsThisTurn, 'one play = one window slot').toBe(1);
    expect(rubyCastCount(s), 'the second Ruby still doubles').toBe(2);
  });

  it('the window RESETS each turn — the bug that broke the original rune (no per-turn reset)', () => {
    const fought: RunState = { ...buyResonance(), rubyCastsThisTurn: 2, phase: 'combat',
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } } } as RunState;
    const next = reduce(fought, { type: 'resolveCombat' });
    expect(next.rubyCastsThisTurn ?? 0, 'the per-turn gate reset').toBe(0);
    expect(rubyCastCount(next), 'a fresh turn doubles again').toBe(2);
  });

  it('End of Turn grants 2 Rubies (the recurring half)', () => {
    const s = buyResonance();
    const held = s.hand.filter((c) => c.cardId === RUBY_ID).length;
    applyEndOfTurn(s);
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length).toBe(held + 2);
  });

  it('Gem Circuit keeps its 1-Ruby window when both are owned (widest window wins, bonuses stack)', () => {
    const s: RunState = { ...set2(), rubyFirstExtraCasts: 3, rubyFirstCastWindow: 2 }; // Circuit(+2) + Resonance(+1), window max(1,2)
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 0 })).toBe(4);
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 1 }), 'the wider window covers the second Ruby').toBe(4);
    expect(rubyCastCount({ ...s, rubyCastsThisTurn: 2 })).toBe(1);
  });
});

describe('Rune of Gemscript — per-turn flag actually resets (same bug class)', () => {
  it('gemscriptRubyUsed clears at the turn boundary', () => {
    const fought: RunState = { ...set2(), runeGemscript: true, gemscriptRubyUsed: true, phase: 'combat',
      lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } } } as RunState;
    const next = reduce(fought, { type: 'resolveCombat' });
    expect(next.gemscriptRubyUsed, 'the first-Ruby spell-power bump re-arms each turn').toBe(false);
  });
});

describe('the quest data itself', () => {
  it('every Kobold quest is set-2 only', () => {
    // A `castRuby` objective is unfillable in set 1, so offering one there is a dead quest slot.
    for (const id of ['q_first_strike', 'q_open_the_vein', 'q_gem_circuit', 'q_unstable_riches', 'q_faultline_coronation']) {
      expect(questById(id).sets, `${id} is offerable outside set 2`).toEqual(['set2']);
    }
  });

  it('First Strike hands over real Rubies alongside its Kobold', () => {
    const s = completeByCastingRuby(set2(), 'q_first_strike');
    expect(s.hand.filter((c) => c.cardId === RUBY_ID).length, 'the 3 Rubies never arrived').toBe(3);
  });

  it('castRuby and castSpell stay separate meters', () => {
    // If Rubies advanced `castSpell`, a Dwarf spell quest would be fillable by a Kobold board and vice versa.
    const s = completeByCastingRuby(set2(), 'q_unstable_riches');
    expect(s.rubyCasts, 'the Ruby meter did not move').toBeGreaterThan(0);
    expect(s.spellsCast, 'a Ruby advanced the Shop-spell meter').toBe(0);
  });
});

describe('the Set-2 rune batch (owner sheet 2026-07-30)', () => {
  const byName = (n: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.name === n);

  it("ships the six new runes at the sheet's costs and tiers", () => {
    const want: [string, number, boolean][] = [
      ['Rune of Recollection', 3, false],
      ['Rune of the First Round', 4, false],
      ['Rune of the Motherlode', 5, true],
      ['Rune of Adventuring', 6, true],
      ['Rune of the Choir', 4, true],
      ['Rune of the High King', 4, true],
    ];
    for (const [name, cost, epic] of want) {
      const r = byName(name);
      expect(r, `${name} is missing`).toBeDefined();
      expect(r!.cost, `${name} cost`).toBe(cost);
      expect(!!r!.epic, `${name} epic`).toBe(epic);
    }
  });

  it('Rune of Mykel and Rune of the High King grant DIFFERENT Dwarf kings', () => {
    // The sheet lists both; the game had only one. Confusing them would silently make one rune a duplicate.
    const mykel = byName('Rune of Mykel')!.reward as { cards?: string[] };
    const high = byName('Rune of the High King')!.reward as { cards?: string[] };
    expect(mykel.cards).toEqual(['dw_brisbane']);
    expect(high.cards).toEqual(['dw_brill']);
    expect(CARD_INDEX['dw_brill']).toBeDefined();
  });

  it('the Motherlode RUNE is untribed where the QUEST is Kobold-scoped', () => {
    // One primitive, two scopes — the rune hits any friendly minion, the quest only Kobolds.
    const rune = byName('Rune of the Motherlode')!.reward as { tribe?: string; count: number };
    const quest = questById('q_motherlode').reward as { tribe?: string };
    expect(rune.tribe, 'the rune should not be tribe-filtered').toBeUndefined();
    expect(rune.count).toBe(2);
    expect(quest.tribe).toBe('kobold');
  });

  it('reuses existing primitives rather than inventing new reward kinds', () => {
    expect((byName('Rune of Recollection')!.reward as { effect?: string }).effect).toBe('copyFirstSpell');
    expect((byName('Rune of the First Round')!.reward as { effect?: string }).effect).toBe('grantAles');
    expect((byName('Rune of Adventuring')!.reward as { scope?: string }).scope).toBe('always');
  });
});
