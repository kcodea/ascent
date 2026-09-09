import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * REFLECTOR — Spells and Rubies share ONE once-per-turn re-cast (Bug Board 224af0ee, 2026-09-09).
 *
 * The player put two Rubies on a Reflector, then Crest of the Climb, and reported "Crest did not reflect".
 * The engine was right: the first Ruby spread, and the shared allowance was spent. The card text was the
 * defect and PR #1326 fixed it ("Spells and **Rubies** cast on this also cast on a random friendly minion.
 * (Once per turn)") — but that PR shipped a TEXT lane only. This pins the behaviour the text now promises,
 * through the real reducer, in both orders.
 */
const mk = (uid: string, cardId: string): BoardCard => ({
  uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health,
  keywords: [], golden: false,
});
const base = (): RunState => ({
  ...createRun(2114408705, 'quillen'), setId: 'set2', embers: 20,
  board: [mk('b4', 'k_chipwick'), mk('b27', 'n2_reflector'), mk('b28', 'k_chipwick')],
  hand: [mk('r1', 'ruby'), mk('r2', 'ruby'), mk('cc', 'crestclimb')],
} as RunState);
const castCrest = (s: RunState): RunState =>
  reduce(reduce(reduce(s, { type: 'play', uid: 'cc' }), { type: 'chooseOne', index: 1 }), { type: 'battlecryTarget', targetUid: 'b27' });
const find = (s: RunState, uid: string) => s.board.find((c) => c.uid === uid)!;

describe('Reflector shares one re-cast per turn between Spells and Rubies', () => {
  it('the captured order — Ruby, Ruby, then Crest on the Reflector — spreads only the FIRST Ruby', () => {
    let s = base();
    s = reduce(s, { type: 'play', uid: 'r1', targetUid: 'b27' });
    const afterFirstRuby = { b4: find(s, 'b4').health, b28: find(s, 'b28').health };
    expect((find(s, 'b4').rubiesOnThisTurn ?? 0) + (find(s, 'b28').rubiesOnThisTurn ?? 0), 'the first Ruby reflected onto a friendly').toBe(1);
    s = reduce(s, { type: 'play', uid: 'r2', targetUid: 'b27' });
    s = castCrest(s);
    const reflector = find(s, 'b27');
    expect([reflector.spellsOnThisTurn, reflector.rubiesOnThisTurn]).toEqual([1, 2]);
    // Crest's +4 Health landed on the Reflector only — no friendly grew again after the first Ruby's spread.
    expect(reflector.health).toBe(CARD_INDEX.n2_reflector!.health + 2 + 4); // two Rubies' Health + Crest
    expect(find(s, 'b4').health).toBe(afterFirstRuby.b4);
    expect(find(s, 'b28').health).toBe(afterFirstRuby.b28);
  });

  it('Crest first on a fresh Reflector DOES reflect — exactly one other friendly gains +4 Health', () => {
    const s = castCrest(base());
    const grew = ['b4', 'b28'].filter((u) => find(s, u).health === CARD_INDEX.k_chipwick!.health + 4);
    expect(grew.length, 'one random friendly took the re-cast').toBe(1);
    expect(find(s, 'b27').health).toBe(CARD_INDEX.n2_reflector!.health + 4);
    expect(find(s, 'b27').spellsOnThisTurn).toBe(1);
  });
});
