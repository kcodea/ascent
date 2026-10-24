import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState, type ShopCard } from './index';

/**
 * MIRRORWING IN THE SHOP (player report 2026-10-23, Lemon on Discord: "when in shop mirrorwing doesnt procc").
 *
 * "The first Shop spell you cast on this each turn casts again." A Spirit Fire cast on a Mirrorwing OFFER used to
 * land once (+6/+6): `castSpellOnOffer` ran the spell on a throwaway body that was never on the board, and
 * `castSpell` only tells a BOARD target that a spell landed on it. Cross-phase by default, the offer now hears the
 * cast through the same `fireOnSpellCastOnThis` dispatcher, keeps its own per-turn count, and carries it onto the
 * body when bought (one "first Shop spell" per instance per turn, wherever it sits).
 */
const spell = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const offerOf = (s: RunState, uid: string): ShopCard => s.shop.find((o) => o.uid === uid)!;
const ledger = (o: ShopCard | BoardCard, source: string) => (o.buffs ?? []).find((b) => b.source === source);
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), phase: 'recruit', embers: 40, board: [], shop: [{ uid: 'mw', cardId: 'd2_mirrorwing' }], ...over } as RunState);

describe('Mirrorwing — the first Shop spell cast on it IN THE SHOP casts again (report 2026-10-23)', () => {
  it('a Spirit Fire on a Mirrorwing offer resolves twice, and the ledger shows both casts', () => {
    let s = run({ hand: [spell('sf', 'spiritfire')] });
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'mw' });
    const o = offerOf(s, 'mw');
    expect([o.atk, o.hp], 'the cast + the re-cast').toEqual([12, 12]);
    expect(ledger(o, 'Spirit Fire'), 'Inspect BUFFS: Spirit Fire x2').toMatchObject({ attack: 12, health: 12, count: 2 });
    expect(o.spellsOnThisTurn).toBe(2);
  });

  it('only the FIRST Shop spell each turn is doubled on the offer', () => {
    let s = run({ hand: [spell('s1', 'spiritfire'), spell('s2', 'spiritfire')] });
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'mw' });
    s = reduce(s, { type: 'play', uid: 's2', targetUid: 'mw' });
    expect([offerOf(s, 'mw').atk, offerOf(s, 'mw').hp], '12 + 6').toEqual([18, 18]);
  });

  it('a GILDED Mirrorwing offer casts 2 additional times, as it does on the board', () => {
    let s = run({ hand: [spell('sf', 'spiritfire')], shop: [{ uid: 'mw', cardId: 'd2_mirrorwing', golden: true }] });
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'mw' });
    expect(offerOf(s, 'mw').atk).toBe(18);
  });

  it('buying it after its shop re-cast does NOT grant a second free re-cast that turn (one first-spell per instance)', () => {
    let s = run({ hand: [spell('s1', 'spiritfire'), spell('s2', 'spiritfire')] });
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'mw' });
    s = reduce(s, { type: 'buy', uid: 'mw' });
    const bought = s.hand.find((c) => c.cardId === 'd2_mirrorwing')!;
    expect(bought.spellsOnThisTurn, 'the count rides onto the body').toBe(2);
    s = reduce(s, { type: 'play', uid: bought.uid });
    const mw = s.board.find((c) => c.cardId === 'd2_mirrorwing')!;
    const before = [mw.attack, mw.health];
    s = reduce(s, { type: 'play', uid: 's2', targetUid: mw.uid });
    const after = s.board.find((c) => c.cardId === 'd2_mirrorwing')!;
    expect([after.attack - before[0]!, after.health - before[1]!], 'the second spell lands once').toEqual([6, 6]);
  });

  it('an untouched offer bought and played still gets its own first re-cast on the board', () => {
    let s = run({ hand: [spell('sf', 'spiritfire')] });
    s = reduce(s, { type: 'buy', uid: 'mw' });
    const bought = s.hand.find((c) => c.cardId === 'd2_mirrorwing')!;
    s = reduce(s, { type: 'play', uid: bought.uid });
    const mw = s.board.find((c) => c.cardId === 'd2_mirrorwing')!;
    const base = CARD_INDEX['d2_mirrorwing']!;
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: mw.uid });
    const after = s.board.find((c) => c.cardId === 'd2_mirrorwing')!;
    expect([after.attack - base.attack, after.health - base.health]).toEqual([12, 12]);
  });

  it('the board Mirrorwing is unchanged (cast + one re-cast)', () => {
    let s = run({
      shop: [],
      board: [{ uid: 'b', cardId: 'd2_mirrorwing', tribe: 'dragon', attack: 3, health: 4, keywords: [], golden: false }],
      hand: [spell('sf', 'spiritfire')],
    });
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'b' });
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([15, 16]);
    expect(ledger(s.board[0]!, 'Spirit Fire')).toMatchObject({ count: 2 });
  });

  it('the offer count re-arms at the next Start of Turn (a frozen Mirrorwing re-casts again)', () => {
    let s = run({
      hand: [spell('s1', 'spiritfire')],
      board: [{ uid: 'w', cardId: 'd2_mirrorwing', tribe: 'dragon', attack: 50, health: 50, keywords: [], golden: false }],
    });
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'mw' });
    s = reduce(s, { type: 'freeze' });
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase, 'back in the next Shop').toBe('recruit');
    const o = offerOf(s, 'mw');
    expect(o, 'the frozen offer survived the turn').toBeTruthy();
    expect(o.spellsOnThisTurn ?? 0).toBe(0);
    s = { ...s, hand: [...s.hand, spell('s2', 'spiritfire')], embers: 40 };
    const before = [o.atk ?? 0, o.hp ?? 0];
    s = reduce(s, { type: 'play', uid: 's2', targetUid: 'mw' });
    const after = offerOf(s, 'mw');
    expect([(after.atk ?? 0) - before[0]!, (after.hp ?? 0) - before[1]!]).toEqual([12, 12]);
  });

  it('Rune of Shared Reflection stays board-only: a Mirrorwing in the Shop has no adjacent Dragons to spread to', () => {
    let s = run({
      runeSharedReflection: true,
      board: [{ uid: 'd', cardId: 'd2_mirrorwing', tribe: 'dragon', attack: 3, health: 4, keywords: [], golden: false }],
      hand: [spell('sf', 'spiritfire')],
    } as Partial<RunState>);
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'mw' });
    expect([s.board[0]!.attack, s.board[0]!.health], 'the board Dragon is untouched').toEqual([3, 4]);
  });
});
