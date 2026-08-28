import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from './index';
import type { BoardCard } from './state';

/**
 * FUNERAL ON LOAN — the owner's live-testing bug reports (2026-08-04).
 *
 * A borrowed minion now OCCUPIES ITS DROP SLOT while its Echo fires (then leaves, never staying). Positional
 * Echoes need the body to actually be somewhere: Dawnclaw's "adjacent Shouts" has no meaning for a card that
 * was never on the board, and Legion Shepherd's overflow must count against the real board.
 */
const body = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack: 3, health: 3, keywords: [], golden: false } as BoardCard);

const borrowed = (uid: string, cardId: string): BoardCard => ({ ...body(uid, cardId), borrowed: true } as BoardCard);

/**
 * Play a borrowed card AND settle it. Since 2026-08-28 a borrowed play is TWO steps (owner design): the body
 * literally lands and takes its slot, and the death — its Echo, its departure, its Rise — is the next action,
 * so the UI can show a minion landing and then dying. These tests are about what the ECHO does, so they take
 * both steps at once; the two-step behaviour itself is pinned in `shopDestroy.test.ts`.
 */
const playBorrowed = (s: RunState, uid: string, toIndex: number): RunState =>
  reduce(reduce(s, { type: 'play', uid, toIndex }), { type: 'resolveShopDeath' });

describe('a borrowed minion occupies its drop slot while the Echo fires', () => {
  it('Legion Shepherd (rework 2026-08-18): its shop Echo buffs Imps +5/+5 and summons an Imp', () => {
    // The old "summon 4 Imps, overflow → aura" shape is gone. Now the Echo is a flat +5/+5 Imp aura plus one Imp
    // summoned. On a full board (6 + the ghost Shepherd) the Imp can't land, but the +5/+5 aura is unconditional.
    const s: RunState = {
      ...createRun(11), embers: 30, shop: [],
      board: [body('b1', 'sandbag'), body('b2', 'sandbag'), body('b3', 'sandbag'), body('b4', 'sandbag'), body('b5', 'sandbag'), body('b6', 'sandbag')],
      hand: [borrowed('sh', 'dm_shepherd')],
    };
    const after = playBorrowed(s, 'sh', 3);
    expect(after.board.some((c) => c.uid === 'sh'), 'the borrowed body must not STAY').toBe(false);
    expect(after.impBuff, 'the flat +5/+5 Imp aura landed').toEqual({ attack: 5, health: 5 });

    // …and on an EMPTIER board the Imp it summons actually lands (room in the line).
    const roomy: RunState = { ...s, board: s.board.slice(0, 3), hand: [borrowed('sh', 'dm_shepherd')] };
    const a2 = playBorrowed(roomy, 'sh', 0);
    expect(a2.board.filter((c) => c.cardId === 'impscrap').length, 'the summoned Imp lands with room to spare').toBe(1);
    expect(a2.impBuff, 'the +5/+5 aura is unconditional').toEqual({ attack: 5, health: 5 });
  });

  it("Menagerie Mammoth's Echo summons Beasts (was a silent no-op — no shop body)", () => {
    const s: RunState = {
      ...createRun(11), embers: 30, shop: [],
      board: [body('f1', 'sandbag')], hand: [borrowed('m', 'b2_mammoth')],
    };
    const after = playBorrowed(s, 'm', 1);
    expect(after.board.some((c) => c.uid === 'm'), 'the loan expires').toBe(false);
    expect(after.board.length, 'the Echo summoned Beasts onto the board').toBeGreaterThan(1);
  });

  it('Bullseye summons a Beast and sets it to 7/7', () => {
    const s: RunState = {
      ...createRun(11), embers: 30, shop: [],
      board: [body('f1', 'sandbag')], hand: [borrowed('b', 'b2_bullseye')],
    };
    const after = playBorrowed(s, 'b', 1);
    const summoned = after.board.filter((c) => c.uid !== 'f1' && c.uid !== 'b');
    expect(summoned.length, 'one Beast summoned').toBe(1);
    expect([summoned[0]!.attack, summoned[0]!.health], 'stats set to 7/7').toEqual([7, 7]);
  });

  it('Kobebes plays Rubies on each of your Kobolds', () => {
    const kob = body('k1', 'k_deepvein'); // a Kobold
    const s: RunState = {
      ...createRun(11), embers: 30, shop: [],
      board: [kob], hand: [borrowed('kb', 'k_kobabyboldies')],
    };
    const before = kob.attack + kob.health;
    const after = playBorrowed(s, 'kb', 1);
    const k = after.board.find((c) => c.uid === 'k1')!;
    expect(k.attack + k.health, 'the Kobold gained Ruby stats').toBeGreaterThan(before);
  });

  it('Right Hand Hank buffs the right-most Shop slot', () => {
    const s: RunState = {
      ...createRun(11), embers: 30, shop: [{ uid: 's0', cardId: 'sandbag' }],
      board: [], hand: [borrowed('h', 'dm_hank')],
    };
    const after = playBorrowed(s, 'h', 0);
    expect(after.rightmostSlotBuff?.attack ?? 0, 'the right-most slot accrued a permanent buff').toBeGreaterThan(0);
  });

  it('Wolvie sets a one-shot buff for the next Beast summoned', () => {
    const s: RunState = {
      ...createRun(11), embers: 30, shop: [], board: [], hand: [borrowed('w', 'b2_wolvie')],
    };
    const after = playBorrowed(s, 'w', 0);
    expect(after.pendingSummonBuff, 'the Echo armed the next-summon buff').toMatchObject({ tribe: 'beast', attack: 2, health: 4 });
  });

  it("a borrowed Dawnclaw dropped beside a Shout re-fires that neighbour's Shout", () => {
    // Warhorn Captain's Shout: your other Dwarves +3 Attack. Dawnclaw dropped adjacent must trigger it.
    const s: RunState = {
      ...createRun(12), embers: 30, shop: [],
      board: [body('cap', 'dw_ironlung'), body('dw2', 'dw_brunni')],
      hand: [borrowed('dc', 'b2_dawnclaw')],
    };
    const before = s.board[1]!.attack;
    const after = playBorrowed(s, 'dc', 1); // between the Captain and the Dwarf
    expect(after.board.some((c) => c.uid === 'dc'), 'the loan expires — Dawnclaw must not stay').toBe(false);
    const dw2 = after.board.find((c) => c.uid === 'dw2')!;
    expect(dw2.attack, "the Captain's re-fired Shout must buff its fellow Dwarf").toBeGreaterThan(before);
  });
});
