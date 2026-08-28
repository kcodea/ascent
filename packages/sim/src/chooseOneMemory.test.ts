import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * A Choose One card REMEMBERS which branch it became (`BoardCard.chosenOption`), so its printed text can narrow
 * to that one option instead of listing the road not taken (owner report 2026-07-24). The pick is recorded in
 * the reducer; the UI's `liveCardText` reads it (covered in `instView.test.ts`), and it rides the board→combat
 * and snapshot paths so a served/restored board and the combat card all read the same single branch.
 */
describe('Choose One — the board remembers which branch it became', () => {
  const hand = (uid: string, cardId: string): BoardCard => ({
    uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: 1, health: 1, keywords: [], golden: false,
  });

  it('records the picked index on the instance (untargeted Choose One)', () => {
    // Godfodder: a plain Choose One with no target step, so the pick resolves in one dispatch.
    let s: RunState = { ...createRun(1), hand: [hand('gf', 'godfodder')] };
    s = reduce(s, { type: 'play', uid: 'gf' });
    expect(s.chooseOne?.cardId).toBe('godfodder');
    // Nothing is recorded until a branch is actually picked.
    expect(s.board.find((c) => c.uid === 'gf')?.chosenOption).toBeUndefined();
    s = reduce(s, { type: 'chooseOne', index: 1 });
    expect(s.chooseOne).toBeUndefined();
    expect(s.board.find((c) => c.uid === 'gf')?.chosenOption).toBe(1);
  });

  it('records index 0 (not just truthy indices) — a falsy 0 must still narrow the text', () => {
    // Guards the obvious bug: storing the pick with a truthiness test would drop option 0 entirely, and every
    // Choose One's FIRST branch is the common pick.
    let s: RunState = { ...createRun(1), hand: [hand('gf', 'godfodder')] };
    s = reduce(s, { type: 'play', uid: 'gf' });
    s = reduce(s, { type: 'chooseOne', index: 0 });
    expect(s.board.find((c) => c.uid === 'gf')?.chosenOption).toBe(0);
  });

  it('records the branch on a TARGETED Choose One when the summon lands, at the end of choose → target', () => {
    // Runic Beetle: choose FIRST, then aim (owner ruling 2026-08-28). The body stays in HAND through both
    // steps — that is what makes a click-away cancel clean — so `chosenOption` is stamped on the instance the
    // moment it is actually summoned, which is also the first moment there is a board card to print text on.
    let s: RunState = {
      ...createRun(1),
      board: [{ uid: 'ally', cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false }],
      hand: [{ uid: 'rb', cardId: 'beetle', tribe: 'beast', attack: 3, health: 1, keywords: [], golden: false }],
    };
    s = reduce(s, { type: 'play', uid: 'rb' });
    expect(s.chooseOne?.cardId).toBe('beetle');
    expect(s.board.some((c) => c.uid === 'rb'), 'the summon is deferred until the choice resolves').toBe(false);
    s = reduce(s, { type: 'chooseOne', index: 0 });
    expect(s.pendingTarget?.deferredPlay, 'now aiming, still unplayed').toBe(true);
    expect(s.hand.some((c) => c.uid === 'rb')).toBe(true);
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'ally' });
    expect(s.board.find((c) => c.uid === 'rb')?.chosenOption).toBe(0);
  });

  it('every Choose One option carries its own text, so a narrowed card always has something to print', () => {
    // The narrowing reads `chooseOne[i].text`. A card with a Choose One but a blank option text would render an
    // empty rule box — cheap to assert across the whole pool rather than discover it per card.
    const withChoose = Object.values(CARD_INDEX).filter((c) => c.chooseOne?.length);
    expect(withChoose.length).toBeGreaterThan(0);
    for (const c of withChoose) {
      for (const opt of c.chooseOne!) {
        expect(opt.text.trim(), `${c.id} option text`).not.toBe('');
      }
    }
  });
});
