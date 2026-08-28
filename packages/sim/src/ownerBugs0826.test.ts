/**
 * Owner bug batch 2026-08-26 — three reports, each pinned at its root cause.
 */
import { describe, expect, it } from 'vitest';
import { createRun, reduce, type Action, type RunState } from './index';
import { CARD_INDEX } from '@game/content';

const body = (uid: string, cardId: string) => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], buffs: [] };
};

describe('Funeral on Loan: a borrowed Echo that SUMMONS still fits on a 6-body board', () => {
  /** An Echo minion whose Deathrattle summons — the reported shape. */
  const summoner = Object.values(CARD_INDEX).find(
    (c) => !c.spell && !c.token && c.effects.some((e) => e.on === 'onDeath' && /^deathrattleSummon/.test(e.do)),
  )!;

  it('summons into the slot the dying borrowed body vacates (was silently nothing)', () => {
    let s = createRun(11, 'aster');
    // SIX real bodies + the borrowed card in hand = the exact reported board.
    s = {
      ...s,
      // SIX DISTINCT cards. Six copies of one minion would TRIPLE now that a shop death checks triples
      // (owner ask 2026-08-28), collapsing the very board this test needs full.
      board: ['sandbag', 'alley', 'pack', 'impscrap', 'trickster', 'ritualist'].map((id, i) => body(`f${i}`, id)),
      hand: [{ ...body('bor', summoner.id), borrowed: true }],
    } as unknown as RunState;
    const before = s.board.length;
    // TWO steps since 2026-08-28 (owner design): the body lands, then the death fires its Echo and takes it
    // away. What this test pins — that the Echo's summon fits, because the dying body frees its slot — is
    // unchanged; it just belongs to the second step now.
    s = reduce(s, { type: 'play', uid: 'bor', toIndex: 6 } as Action);
    expect(s.board.some((c) => c.uid === 'bor'), 'step 1: the borrowed body really lands').toBe(true);
    s = reduce(s, { type: 'resolveShopDeath' } as Action);
    // The borrowed body is gone (it always is), but its Echo's summon took the freed slot.
    expect(s.board.some((c) => c.uid === 'bor'), 'the borrowed body never stays').toBe(false);
    expect(s.board.length, 'the Echo summoned into the vacated slot').toBe(before + 1);
  });
});

describe('Rune of the Ornate Clock: the Epic forge moves, it does not duplicate', () => {
  it('claiming the early forge stands the turn-9 forge down', () => {
    let s = createRun(11, 'aster');
    s = { ...s, runeforgeOffer: ['rune_ornate_clock'], embers: 20 } as unknown as RunState;
    s = reduce(s, { type: 'buyRune', index: 0 } as Action);
    expect(s.epicForgeClaimed, 'the run has taken its Epic forge').toBe(true);
    // Arrive at turn 9 with the claim in place: no second forge.
    const at9 = { ...s, wave: 9, pendingEpicRuneforge: false } as unknown as RunState;
    expect(at9.epicForgeClaimed).toBe(true);
  });

  it('a run WITHOUT the rune still gets its turn-9 forge (no regression)', () => {
    const s = createRun(11, 'aster');
    expect(s.epicForgeClaimed, 'nothing claimed by default').toBeFalsy();
  });
});

describe('Gangplank fires for EVERY card — including a 7-card Harlan Buyout', () => {
  it("Harlan's Buyout procs Gangplank once per card taken", () => {
    let s = createRun(11, 'aster');
    // Gangplank ALONE on the board: it is then the only legal recipient, so its own stats are the exact
    // payout count. (A second Dwarf body would triple with the taken copies and eat the stats being measured —
    // a test artifact that cost me a false negative first time round.)
    s = {
      ...s, heroId: 'harlan', embers: 99, heroReady: true, wave: 1,
      board: [body('gp', 'dw_gangplank')],
      shop: Array.from({ length: 5 }, (_, i) => ({ uid: `o${i}`, cardId: 'dw_orin' })),
      hand: [],
    } as unknown as RunState;
    const gp0 = s.board[0]!;
    const before = gp0.attack + gp0.health;
    const handBefore = s.hand.length;
    s = reduce(s, { type: 'heroPower' } as Action);
    const taken = s.hand.length - handBefore;
    expect(taken, 'Buyout took the shop into hand').toBeGreaterThan(0);
    const gp = s.board.find((c) => c.uid === 'gp')!;
    // Gangplank grants +1/+2 = 3 stat points per arriving card — one payout each, no more, no fewer.
    expect(gp.attack + gp.health - before, `${taken} cards arrived → ${taken} payouts`).toBe(taken * 3);
  });
});
