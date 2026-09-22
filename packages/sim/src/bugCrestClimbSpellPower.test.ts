import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { chooseOneBranchText, createRun, reduce, spellDisplayText, type BoardCard, type RunState } from './index';

/**
 * BUG 23c340fb (priority 2, text_mismatch, wave 2, Gambler, Set 2) — "crest of the climb not getting spell power
 * buffs" (the player's claim; the capsule is the evidence).
 *
 * What the capsule showed: `spellBonus { attack: 0, health: 1 }` (a Coppercoat Spellsword resolved on its Health
 * option), then Crest of the Climb cast on that Spellsword through `play → chooseOne 1 → battlecryTarget`, and
 * the landed buff record read `{ attack: 0, health: 4, source: 'Crest of the Climb' }` — the authored +4, no fold.
 *
 * Expected behaviour (implementation + precedent, not the description): every stat-granting Shop spell folds the
 * run's spell power (`spellBuffTarget`; the Hoardflame / Veinstorm / Ales / Apples rulings). Crest's `flat: true`
 * was a flagged judgement call on 2026-07-23 ("say if you'd rather they scale"), made only because Choose One
 * option text had no live-value path then. It has one since 2026-09-12. This file rebuilds the capsule's shape
 * through the real reducer and pins the fold on both the cast and every text surface.
 */

const hand = (uid: string, cardId: string): BoardCard => ({
  uid, cardId, tribe: CARD_INDEX[cardId]!.tribe,
  attack: CARD_INDEX[cardId]!.attack, health: CARD_INDEX[cardId]!.health,
  keywords: [], golden: false,
});

/** The capsule's run, rebuilt: Set 2, Gambler, a Spellsword and a Crest in hand, nothing else in play. */
const capsuleRun = (): RunState => ({
  ...createRun(1135206171, 'gambler'), setId: 'set2', phase: 'recruit', shop: [], board: [],
  hand: [hand('b9', 'n2_spellsword'), hand('b10', 'crestclimb')],
} as RunState);

describe('bug 23c340fb — Crest of the Climb folds spell power', () => {
  it('the capsule sequence: Spellsword (+1 Health power), then Crest +4 Health on it, lands +5 Health', () => {
    let s = capsuleRun();
    s = reduce(s, { type: 'play', uid: 'b9', toIndex: 0 });
    s = reduce(s, { type: 'chooseOne', index: 1 }); // "Give your Shop spells +1 Health"
    expect(s.spellBonus, 'the capsule\'s spell power').toEqual({ attack: 0, health: 1 });
    const sw = s.board.find((c) => c.uid === 'b9')!;
    expect([sw.attack, sw.health], 'the Spellsword as the capsule fielded it').toEqual([3, 4]);

    s = reduce(s, { type: 'play', uid: 'b10' });
    expect(s.chooseOne?.cardId).toBe('crestclimb');
    s = reduce(s, { type: 'chooseOne', index: 1 }); // "+4 Health"
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'b9' });

    const after = s.board.find((c) => c.uid === 'b9')!;
    // The capsule recorded 3/8 and a { health: 4 } buff — the defect. The fold makes it 3/9 and { health: 5 }.
    expect([after.attack, after.health]).toEqual([3, 9]);
    expect(after.buffs).toEqual([{ source: 'Crest of the Climb', attack: 0, health: 5, count: 1 }]);
    expect(s.hand, 'the spell resolved out of hand').toHaveLength(0);
  });

  it('the other branch under the same power: "+4 Attack" lands +4/+1 (the factory adds both bonuses)', () => {
    let s = capsuleRun();
    s = reduce(s, { type: 'play', uid: 'b9', toIndex: 0 });
    s = reduce(s, { type: 'chooseOne', index: 1 });
    s = reduce(s, { type: 'play', uid: 'b10' });
    s = reduce(s, { type: 'chooseOne', index: 0 }); // "+4 Attack"
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'b9' });
    const after = s.board.find((c) => c.uid === 'b9')!;
    expect([after.attack, after.health]).toEqual([7, 5]);
  });

  it('every text surface prints the live number under the capsule\'s +0/+1 power', () => {
    // The Choose One window (Recruit's prompt reads `chooseOneBranchText`).
    expect(chooseOneBranchText('crestclimb', 0, false, 0, 1)).toBe('Give **{{+4/+1}}**.');
    expect(chooseOneBranchText('crestclimb', 1, false, 0, 1)).toBe('Give **{{+5 Health}}**.');
    // The card itself: shop / hand / Discover / hover all read `spellDisplayText` through `liveCardText`.
    expect(spellDisplayText('crestclimb', 0, 0, 1)).toBe('**Choose One:** give a minion **{{+4/+1}}**, or **{{+5 Health}}**.');
    // And at zero power the authored text stands on both, un-greened.
    expect(spellDisplayText('crestclimb', 0, 0, 0)).toBe(CARD_INDEX['crestclimb']!.text);
    expect(chooseOneBranchText('crestclimb', 1, false, 0, 0)).toBe(CARD_INDEX['crestclimb']!.chooseOne![1]!.text);
  });
});
