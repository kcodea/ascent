import { describe, it, expect } from 'vitest';
import { CARD_INDEX, QUEST_DEFS } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { RUBY_ID, mintRubies, rubyCastCount } from './recruit';

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
