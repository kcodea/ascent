import { describe, it, expect } from 'vitest';
import { ALL_CARDS, CARD_INDEX } from '@game/content';
import { CONFIG } from './config';
import { createRun, handCap, reservedHandSlots, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { conjureToHand, fireRecruitDeathrattlesForTest, triggerBorrowedEcho } from './recruit';

const body = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 3, health: 3, keywords: [], golden: false });
const filler = (n: number): BoardCard[] =>
  Array.from({ length: n }, (_, i) => ({ uid: `h${i}`, cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }));

describe('rune-turn hand grace', () => {
  it('the cap is 10 normally and 20 while the Runeforge is open', () => {
    const s: RunState = { ...createRun(1) };
    expect(handCap(s)).toBe(CONFIG.handMax);
    expect(handCap({ ...s, runeforgeOffer: ['rune_gemspam'] })).toBe(CONFIG.handMaxRuneTurn);
  });

  it('a rune grant lands on a FULL hand', () => {
    // 10 cards in hand — normally nothing more can arrive.
    const s: RunState = { ...createRun(1), hand: filler(10), runeforgeOffer: ['rune_gemspam'] };
    const spell = ALL_CARDS.find((c) => c.spell && !c.token && !c.ruby)!;
    conjureToHand(s, [spell], 3);
    expect(s.hand.length, 'the rune-turn grace should let these land').toBe(13);
  });

  it('…and the grace is GONE once the forge closes', () => {
    const s: RunState = { ...createRun(1), hand: filler(10) }; // no runeforgeOffer
    const spell = ALL_CARDS.find((c) => c.spell && !c.token && !c.ruby)!;
    conjureToHand(s, [spell], 3);
    expect(s.hand.length, 'an ordinary turn keeps the 10-card cap').toBe(10);
  });
});

describe('a pending Discover outranks a passive grant', () => {
  it('reservedHandSlots counts the open prompt and the queue', () => {
    expect(reservedHandSlots({})).toBe(0);
    expect(reservedHandSlots({ discover: ['a', 'b', 'c'] })).toBe(1);
    expect(reservedHandSlots({ discover: ['a'], discoverQueue: [{}, {}] as never })).toBe(3);
  });

  it('a grant will NOT take the last slot while a Discover is open', () => {
    // The owner's case: a golden Spell Warden's copies must yield to the card being discovered.
    const s: RunState = { ...createRun(1), hand: filler(9), discover: ['sandbag', 'venom', 'tara'] };
    const spell = ALL_CARDS.find((c) => c.spell && !c.token && !c.ruby)!;
    conjureToHand(s, [spell], 2);
    expect(s.hand.length, 'the 10th slot is reserved for the Discover pick').toBe(9);
  });

  it('but a grant still lands when there is room beyond the reservation', () => {
    const s: RunState = { ...createRun(1), hand: filler(5), discover: ['sandbag', 'venom', 'tara'] };
    const spell = ALL_CARDS.find((c) => c.spell && !c.token && !c.ruby)!;
    conjureToHand(s, [spell], 2);
    expect(s.hand.length).toBe(7);
  });
});

describe('Echoes triggered in the SHOP', () => {
  const borrowedEcho = (cardId: string, board: BoardCard[] = []): RunState => {
    const s: RunState = { ...createRun(6), board, hand: [], embers: 30 };
    triggerBorrowedEcho(s, body('e', cardId));
    return s;
  };

  it('Brewer grants an Ale', () => {
    const s = borrowedEcho('dw_brewer');
    expect(s.hand.length, 'the Echo granted nothing').toBeGreaterThan(0);
  });

  it('Bone Taxer raises max Gold', () => {
    const before = createRun(6).maxEmbers;
    expect(borrowedEcho('bonetaxer').maxEmbers).toBeGreaterThan(before);
  });

  it('Errand Fiend summons Imps', () => {
    const s = borrowedEcho('dm_errand');
    expect(s.board.filter((c) => c.cardId === 'impscrap').length).toBeGreaterThan(0);
  });

  it("Dawnclaw re-fires a neighbour's Shout when its Echo fires ON THE BOARD", () => {
    // Adjacency needs a board POSITION, so this uses the on-board Echo path (Ossuary Rite / Deathsayer /
    // Reliquary) rather than the borrowed one. A card borrowed by Funeral on Loan never reaches the board, so
    // a positional Echo correctly has no neighbours to trigger — that is a property of the card, not a gap.
    const shout = ALL_CARDS.find((c) => !c.spell && !c.token && c.effects.some((e) => e.on === 'onPlay' && e.do === 'battlecryGrantSpell'))!;
    const dawn = body('e', 'b2_dawnclaw');
    const s: RunState = { ...createRun(6), board: [body('n', shout.id), dawn], hand: [], embers: 30 };
    fireRecruitDeathrattlesForTest(s, dawn);
    expect(s.hand.length, "the neighbour's Shout never fired in the shop").toBeGreaterThan(0);
  });
});

describe('Baby Gastrid targets Dwarves only', () => {
  it('is declared and worded as Dwarves-only', () => {
    const def = CARD_INDEX['dw_dorrin']!;
    expect(def.targetTribe).toBe('dwarf');
    expect(def.text).toContain('Dwarf');
  });

  it('will not even PROMPT when the only other body is off-tribe', () => {
    // The reducer-level refusal is covered for EVERY tribe-restricted card by the sweep in
    // `targetTribeGuard.test.ts`, which Gastrid now joins — no need to duplicate it per card.
    const s: RunState = {
      ...createRun(4), embers: 20,
      board: [body('b', 'venom')], // a Beast — no legal Dwarf target
      hand: [{ uid: 'g', cardId: 'dw_dorrin', tribe: 'dwarf', attack: 2, health: 4, keywords: [], golden: false }],
    };
    expect(reduce(s, { type: 'play', uid: 'g' }).pendingTarget).toBeUndefined();
  });
});
