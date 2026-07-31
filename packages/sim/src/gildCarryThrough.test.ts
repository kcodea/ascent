import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { spellCasts } from './recruit';

/**
 * GILDING KEEPS THE ACCRUAL (owner report + ruling 2026-07-31).
 *
 * `checkTriples` preserves a card's grown magnitude through a gild, but it did so via three per-card
 * whitelists — and any accruing effect on NONE of those lists fell through to `undefined`, so the golden
 * started from base. A Soul Defiler grown to +4/+4 gilded into +2/+2.
 *
 * The lists are opt-in, which is the actual defect: every new accruing effect inherited the bug, and it only
 * ever hurt the cards a player had invested in growing.
 */
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const mk = (cardId: string, uid: string, summonBonus?: number): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [], golden: false, summonBonus };
};
/** Put three copies in hand and play them — the real triple path, not a hand-rolled merge. */
const tripleOf = (cardId: string, bonuses: (number | undefined)[]): BoardCard | undefined => {
  let s: RunState = { ...set2(), phase: 'recruit', embers: 60, board: [], tier: 6,
    hand: bonuses.map((b, i) => mk(cardId, `c${i}`, b)) };
  for (let i = 0; i < bonuses.length; i++) s = reduce(s, { type: 'play', uid: `c${i}` });
  return [...s.hand, ...s.board].find((c) => c.cardId === cardId && c.golden);
};

describe('gilding a grown minion', () => {
  it('Soul Defiler keeps its accrual instead of resetting to base', () => {
    // The reported case: one copy grown by +3 (its shop grant sitting at +4/+4), two fresh.
    const golden = tripleOf('dm_curator', [3, undefined, undefined]);
    expect(golden, 'the triple never produced a golden').toBeDefined();
    expect(golden!.summonBonus ?? 0, 'the accrual was thrown away — this is the reported bug').toBeGreaterThan(0);
  });

  it('combines the two highest copies, matching the rule already used elsewhere', () => {
    const golden = tripleOf('dm_curator', [3, 2, 1]);
    expect(golden!.summonBonus).toBe(5); // 3 + 2, the top two — same as Karthus / Crypt Drake
  });

  it('three fresh copies still gild to a plain golden', () => {
    // No accrual to carry: the golden's own doubling comes from `gold(self)` in the factory, not from here.
    const golden = tripleOf('dm_curator', [undefined, undefined, undefined]);
    expect(golden!.summonBonus ?? 0).toBe(0);
  });
});

describe('Orivax (Spellweave) counts from when it is PLAYED', () => {
  /**
   * Owner ruling 2026-07-31. It gated on `spellsThisTurn === 0` — the TURN's first spell — so playing Orivax
   * after you had already cast one gave you nothing until next turn. The card silently did less the later in
   * the turn you played it, which is the opposite of how a tempo card should read.
   */
  const growth = CARD_INDEX['growth']!;
  const spell = (uid: string): BoardCard =>
    ({ uid, cardId: growth.id, tribe: growth.tribe, attack: 0, health: 0, keywords: [], golden: false });

  const castsFor = (spellsAlreadyCast: number): number => {
    // `spellCasts` is the read-only preview the UI uses — the same number the cast site resolves.
    const s: RunState = { ...set2(), spellFirstMultEachTurn: 3, spellsThisTurn: spellsAlreadyCast,
      spellMultMark: spellsAlreadyCast, board: [], hand: [spell('s')] };
    return spellCasts(s, growth);
  };

  it('multiplies the next spell even when played mid-turn', () => {
    // Two spells already cast this turn, then Orivax lands: the NEXT spell should still be multiplied.
    expect(castsFor(2)).toBe(3);
  });

  it('still multiplies when played before any spell', () => {
    expect(castsFor(0)).toBe(3);
  });

  it('is spent once a spell has been cast since it landed', () => {
    const s: RunState = { ...set2(), spellFirstMultEachTurn: 3, spellsThisTurn: 3, spellMultMark: 2,
      board: [], hand: [spell('s')] };
    expect(spellCasts(s, growth), 'the multiplier outlived its one spell').toBe(1);
  });
});
