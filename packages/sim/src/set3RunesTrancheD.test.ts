import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, REVELER_IDS } from '@game/content';
import { createRun, reduce, createStarform, starformOf, starformStats, collapseHits, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods } from './reducer';
import { consumeShopMinion, revelerValue, socRuneReplaysOf, summonCopyFromHandShop } from './recruit';

/**
 * SET 3 BATCH 2 (2026-09-16) — TRANCHE D, the sim half:
 *
 *   · Rune of the Open Hand (Epic 5) + Rune of the Waking Reserve (Epic 6) — the two combat-side runes tranche A
 *     deferred: roster + reward wiring here, the shop halves (a shop hand-summon pays the Open Hand; the Waking
 *     Reserve's Start-of-Combat replay), the combat behaviour in `core/src/combat/set3RunesTrancheD.test.ts`.
 *   · Rune of Soul Script (owner 2026-09-16): Undead may Consume the Starform (already the shared chokepoint's
 *     rule — pinned again through a NON-Demon random consume) AND are Collapse receivers beside the Celestials.
 *   · Rune of the Traveling Festival: the "+2/+2 more" is applied ONCE per Reveler trigger — never per copy held.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7), setId: 'set3', phase: 'recruit', embers: 40, tribes: ['spirit', 'celestial', 'undead', 'kobold', 'dwarf'], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
/** Buy `id` from a forge stocked with exactly it — the real reward path. */
const buyRune = (s: RunState, id: string): RunState => act({ ...s, runeforgeOffer: [id], embers: 40 }, { type: 'buyRune', index: 0 });
const play = (s: RunState, uid: string, toIndex = s.board.length): RunState => act(s, { type: 'play', uid, toIndex } as Action);
const sell = (s: RunState, uid: string): RunState => act(s, { type: 'sell', uid } as Action);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
const SRC = { cardId: 'dbg_starseed', name: 'Star Seed' };

describe('the two deferred runes ship: roster, cost, scope, wiring', () => {
  it.each([['rune_open_hand', 5], ['rune_waking_reserve', 6]] as const)('%s is EPIC, set 3 only, costs %i, and is NOT tribe-gated (its text names no tribe)', (id, cost) => {
    const r = RUNE_INDEX[id]!;
    expect(EPIC_RUNES.some((x) => x.id === id)).toBe(true);
    expect(RUNES.some((x) => x.id === id)).toBe(false);
    expect(r.epic).toBe(true);
    expect(r.cost).toBe(cost);
    expect(r.sets).toEqual(['set3']);
    expect(r.tribes).toBeUndefined();
  });

  it('buying either through the forge arms its combat flag, counts the copy, and the flag rides into the combat mods', () => {
    let s = buyRune(run(), 'rune_open_hand');
    expect(s.questFlags?.runeOpenHand).toBe(true);
    expect(s.flagCopies?.runeOpenHand).toBe(1);
    expect(questCombatMods(s).runeOpenHand).toBe(true);
    s = buyRune(s, 'rune_open_hand');
    expect(s.flagCopies?.runeOpenHand, 'a duplicate counts').toBe(2);
    s = buyRune(s, 'rune_waking_reserve');
    expect(s.questFlags?.runeWakingReserve).toBe(true);
    expect(questCombatMods(s).runeWakingReserve).toBe(true);
    expect(questCombatMods(run()).runeOpenHand, 'off by default').toBeUndefined();
  });
});

describe('Rune of the Open Hand — the shop half', () => {
  it('a shop hand-summon (the Spirit copy path) gives its stats to another friendly minion, permanently', () => {
    const s = buyRune(run({ board: [body('a', 'u3_poochy', { keywords: [] })], hand: [body('h', 'u3_noggin', { attack: 6, health: 4, keywords: [] })] }), 'rune_open_hand');
    const copy = summonCopyFromHandShop(s, 'h', undefined, false);
    expect(copy).toBeDefined();
    expect(stats(at(s, 'a')), 'the 2/1 took the copy\'s 6/4').toEqual([2 + 6, 1 + 4]);
    expect(s.hand.some((c) => c.uid === 'h'), 'the hand card stays').toBe(true);
    // Without the rune: nothing.
    const plain = run({ board: [body('a', 'u3_poochy', { keywords: [] })], hand: [body('h', 'u3_noggin', { attack: 6, health: 4, keywords: [] })] });
    summonCopyFromHandShop(plain, 'h', undefined, false);
    expect(stats(at(plain, 'a'))).toEqual([2, 1]);
    // The copy is never its own receiver: alone on the board, no gift.
    const alone = buyRune(run({ board: [], hand: [body('h', 'u3_noggin', { attack: 6, health: 4, keywords: [] })] }), 'rune_open_hand');
    const c2 = summonCopyFromHandShop(alone, 'h', undefined, false);
    expect(stats(c2!)).toEqual([6, 4]);
  });

  it('two copies held: two gifts per hand-summon', () => {
    const s = buyRune(buyRune(run({ board: [body('a', 'u3_poochy', { keywords: [] })], hand: [body('h', 'u3_noggin', { attack: 3, health: 3, keywords: [] })] }), 'rune_open_hand'), 'rune_open_hand');
    summonCopyFromHandShop(s, 'h', undefined, false);
    expect(stats(at(s, 'a'))).toEqual([2 + 6, 1 + 6]);
  });
});

describe('Rune of the Waking Reserve — the Start-of-Combat replay (the shop twin)', () => {
  // Three different cards: three copies of one would TRIPLE into a gilded body the moment the reducer runs.
  const hand = () => [body('h1', 'u3_noggin', { attack: 4, health: 4, keywords: [] }), body('h2', 'sandbag', { attack: 3, health: 6, keywords: ['T'], golden: true }), body('h3', 'u3_poochy', { attack: 2, health: 2, keywords: [] })];

  it('summons a copy of the highest-stat (Attack + Health) hand minion, right-most; the card stays in hand', () => {
    const s = buyRune(run({ board: [body('a', 'u3_poochy', { keywords: [] })], hand: hand() }), 'rune_waking_reserve');
    const replay = socRuneReplaysOf(s).find((x) => x.id === 'rune_waking_reserve');
    expect(replay).toBeDefined();
    replay!.fire(s);
    expect(s.board).toHaveLength(2);
    const copy = s.board[1]!;
    expect([copy.cardId, copy.attack, copy.health, copy.golden]).toEqual(['sandbag', 3, 6, true]);
    expect(copy.keywords).toContain('T');
    expect(s.hand.map((c) => c.uid), 'nothing left the hand').toEqual(['h1', 'h2', 'h3']);
  });

  it('only with room; nothing from an empty hand; and it is a hand-summon the Open Hand pays on', () => {
    const full = buyRune(run({ board: Array.from({ length: 7 }, (_, i) => body(`b${i}`, 'u3_poochy', { keywords: [], golden: true })) /* gilded: never triples */, hand: hand() }), 'rune_waking_reserve');
    socRuneReplaysOf(full).find((x) => x.id === 'rune_waking_reserve')!.fire(full);
    expect(full.board).toHaveLength(7);
    const empty = buyRune(run({ board: [body('a', 'u3_poochy', { keywords: [] })], hand: [] }), 'rune_waking_reserve');
    socRuneReplaysOf(empty).find((x) => x.id === 'rune_waking_reserve')!.fire(empty);
    expect(empty.board).toHaveLength(1);
    const both = buyRune(buyRune(run({ board: [body('a', 'u3_poochy', { keywords: [] })], hand: hand() }), 'rune_waking_reserve'), 'rune_open_hand');
    socRuneReplaysOf(both).find((x) => x.id === 'rune_waking_reserve')!.fire(both);
    expect(stats(at(both, 'a')), 'the Open Hand gave the copy\'s 3/6 to the 2/1').toEqual([2 + 3, 1 + 6]);
  });

  it('is absent from the replay list without the rune', () => {
    expect(socRuneReplaysOf(run()).some((x) => x.id === 'rune_waking_reserve')).toBe(false);
  });
});

describe('Rune of Soul Script — Undead consume the Starform and are Collapse receivers (owner 2026-09-16)', () => {
  it('a NON-Demon consumer picks the token through the generic random-Shop-minion draw (any eater the text allows)', () => {
    // Cinder Clerk's `battlecryConsumeShopRandom` draws from EVERY minion offer, the token included — drive it
    // with a probe Undead so the tribe is the point.
    CARD_INDEX['dbg_undead_eater'] = { id: 'dbg_undead_eater', name: 'Undead eater (probe)', tribe: 'undead', tier: 1, attack: 1, health: 1, keywords: [],
      effects: [{ on: 'onPlay', do: 'battlecryConsumeShopRandom' }], text: '' };
    let s = buyRune(run(), 'rune_soul_script');
    createStarform(s, SRC);
    s.shop = s.shop.filter((o) => o.starform); // the token is the only edible offer
    const [sa, sh] = [starformStats(s)!.attack, starformStats(s)!.health];
    s = { ...s, hand: [body('e', 'dbg_undead_eater')] };
    s = play(s, 'e');
    expect(starformOf(s), 'the Undead ate it').toBeUndefined();
    expect(stats(at(s, 'e'))).toEqual([1 + sa, 1 + sh]);
  });

  it('an Undead eats it through the one Shop-consume chokepoint (the tranche-C pin, kept)', () => {
    const s = buyRune(run(), 'rune_soul_script');
    createStarform(s, SRC);
    const idx = s.shop.findIndex((o) => o.starform);
    const eater = body('e', 'u3_poochy', { keywords: [] });
    s.board.push(eater);
    expect(consumeShopMinion(s, eater, idx)).toBe(true);
    expect(starformOf(s)).toBeUndefined();
  });

  it('collapseHits: with the rune, your Undead are receivers beside your Celestials; without it, Celestials only', () => {
    const board = [body('c1', 'ce3_coronadevotee'), body('u1', 'u3_poochy', { keywords: [] }), body('u2', 'u3_noggin', { keywords: [] }), body('n', 'sandbag')];
    const plain = run({ board: board.map((b) => ({ ...b })) });
    for (let i = 0; i < 6; i++) {
      plain.rngCursor = i * 7919;
      for (const h of collapseHits(plain, 2, 3)) expect(h.uid, 'no rune: never an Undead').toBe('c1');
    }
    const scripted = buyRune(run({ board: board.map((b) => ({ ...b })) }), 'rune_soul_script');
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      scripted.rngCursor = i * 7919;
      const hits = collapseHits(scripted, 2, 3);
      expect(hits, '2 unique originals + 3 extras').toHaveLength(5);
      expect(new Set(hits.slice(0, 2).map((h) => h.uid)).size, 'the originals are unique').toBe(2);
      for (const h of hits) { expect(['c1', 'u1', 'u2']).toContain(h.uid); seen.add(h.uid); }
    }
    expect([...seen].sort(), 'both Undead were drawn across the seeds; the neutral never').toEqual(['c1', 'u1', 'u2']);
  });

  it('Rune of the Supernova + Soul Script: "all your Celestials" includes your Undead', () => {
    const s = buyRune(buyRune(run({ board: [body('c1', 'ce3_coronadevotee'), body('u1', 'u3_poochy', { keywords: [] }), body('n', 'sandbag')] }), 'rune_soul_script'), 'rune_supernova');
    const hits = collapseHits(s, 2, 0);
    expect(hits.map((h) => h.uid)).toEqual(['c1', 'u1']);
  });

  it('end to end: Solburn\'s Collapse hands an Undead the rounded-up half', () => {
    let s = buyRune(run({ board: [body('u1', 'u3_poochy', { keywords: [] })] }), 'rune_soul_script');
    createStarform(s, SRC);
    starformOf(s)!.atk = 8; starformOf(s)!.hp = 6; // a 9/7 token → halves 5/4
    s = { ...s, hand: [body('d', 'ce3_coronadevotee')] };
    s = play(s, 'd');
    expect(starformOf(s), 'collapsed').toBeUndefined();
    // Two receivers on board (the Devotee + the Pup): both are originals — the Undead took its half.
    expect(stats(at(s, 'u1'))).toEqual([2 + 5, 1 + 4]);
  });
});

describe('Rune of the Traveling Festival — the "+2/+2 more" is ONE TIME per Reveler trigger (owner 2026-09-16)', () => {
  it('a second copy does not raise the extra; a sale pays it exactly once', () => {
    // A GILDED Flame on the board: a plain one would triple with the two Revelers the purchases drip into hand.
    let s = buyRune(run({ board: [body('k', 'sp3_kindled'), body('f', 'sp3_flamereveler', { golden: true })], hand: [] }), 'rune_traveling_festival');
    expect(s.revelerExtra).toEqual({ attack: 2, health: 2 });
    s = buyRune(s, 'rune_traveling_festival');
    expect(s.revelerExtra, 'still +2/+2 with two copies held').toEqual({ attack: 2, health: 2 });
    expect(s.runeRevelerDrip, 'the drip half still stacks per copy').toBe(2);
    expect(s.hand.some((c) => REVELER_IDS.includes(c.cardId)), 'each purchase paid its Reveler (two may have tripled with the board Flame)').toBe(true);
    const x = revelerValue(s);
    s = sell(s, 'f');
    expect(stats(at(s, 'k')), 'gilded Flame: twice the value, but the +2 exactly once').toEqual([3 + 2 * x + 2, 1]);
  });
});
