import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type CombatEvent } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyGoldSpent } from './recruit'; // not re-exported from the package index — internal on purpose

/** The four runes added 2026-08-02 (owner batch). Each is pinned through its REAL path, not its flag. */
const minion = (uid: string, cardId: string, attack = 2, health = 2, over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [], golden: false, ...over });

describe('Rune of Distillation — a shop-minion cast also hits your left-most', () => {
  it('the left-most board minion gets the spell too', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [minion('lead', 'drummer', 2, 2), minion('other', 'joker', 3, 3)],
      hand: [minion('sp', 'spiritfire', 0, 1)],
      shop: [{ uid: 'o1', cardId: 'sandbag' }],
      runeDistillation: true,
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o1' });
    const lead = s.board.find((c) => c.uid === 'lead')!;
    const other = s.board.find((c) => c.uid === 'other')!;
    expect(lead.attack + lead.health, 'the left-most never got the spill cast').toBeGreaterThan(4);
    expect([other.attack, other.health], 'only the LEFT-most spills').toEqual([3, 3]);
    expect(s.shop[0]!.atk ?? 0, 'the offer still got its own cast').toBeGreaterThan(0);
  });

  it('does nothing without the rune', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [minion('lead', 'drummer', 2, 2)],
      hand: [minion('sp', 'spiritfire', 0, 1)],
      shop: [{ uid: 'o1', cardId: 'sandbag' }],
    };
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'o1' });
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([2, 2]);
  });
});

describe('Rune of Liquidation — a sold minion hands its FULL live stats to the right-most offer', () => {
  it('transfers the whole live stat line, not just the bonus above base (owner rework 2026-08-11)', () => {
    const base = CARD_INDEX['drummer']!;
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('sell', 'drummer', base.attack + 5, base.health + 3)],
      shop: [{ uid: 'o1', cardId: 'sandbag' }, { uid: 'o2', cardId: 'alley' }],
      runeLiquidation: true,
    };
    s = reduce(s, { type: 'sell', uid: 'sell' });
    const right = s.shop.find((o) => o.uid === 'o2')!;
    // The sold body is 7/7 live (2/4 base + 5/3) — the whole line transfers now.
    expect([right.atk ?? 0, right.hp ?? 0], 'the full live stat line').toEqual([base.attack + 5, base.health + 3]);
    expect(s.shop.find((o) => o.uid === 'o1')!.atk ?? 0, 'only the RIGHT-most').toBe(0);
  });

  it('a base-stat minion transfers its full base stats (owner rework 2026-08-11)', () => {
    const base = CARD_INDEX['drummer']!;
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('sell', 'drummer', base.attack, base.health)],
      shop: [{ uid: 'o1', cardId: 'sandbag' }],
      runeLiquidation: true,
    };
    s = reduce(s, { type: 'sell', uid: 'sell' });
    // No more "a base body transfers nothing" — a plain 2/4 hands over its full 2/4 now.
    expect([s.shop[0]!.atk ?? 0, s.shop[0]!.hp ?? 0]).toEqual([base.attack, base.health]);
  });
});

describe('Rune of the Warpath — the left-most attack chains into the right-most', () => {
  it('the right-most swings out of turn order after the left-most attacks', () => {
    const r = simulate(
      [{ cardId: 'drummer', attack: 3, health: 40, sourceUid: 'L' }, { cardId: 'sandbag', attack: 0, health: 40 },
       { cardId: 'alley', attack: 4, health: 40, sourceUid: 'R' }],
      [{ cardId: 'sandbag', attack: 0, health: 900 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, questMods: { runeWarpath: true } }), combatSide({ tier: 1 }));
    const attacks = r.events.filter((e): e is Extract<CombatEvent, { type: 'attack' }> => e.type === 'attack');
    // The very first attack is the left-most (m0); the chained one must be the right-most (m2), BEFORE m1.
    expect(attacks[0]!.attacker).toBe('m0');
    expect(attacks[1]!.attacker, 'the right-most never chained').toBe('m2');
  });

  it('a ONE-minion board never chains into itself (the infinite-loop guard)', () => {
    const r = simulate(
      [{ cardId: 'drummer', attack: 3, health: 40 }],
      [{ cardId: 'sandbag', attack: 0, health: 900 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, questMods: { runeWarpath: true } }), combatSide({ tier: 1 }));
    expect(r.events.length, 'it resolved rather than hanging').toBeGreaterThan(0);
  });
});

describe('Rune of Gemspam — 10 Gold spent plays a Ruby on every minion', () => {
  it('every friendly minion gains the live Ruby value', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('a', 'drummer', 2, 2), minion('b', 'joker', 3, 3)],
      rubyBonus: { attack: 2, health: 2 },
      runeThresholds: [{ meter: 'gold', per: 10, tick: 0, rubyAll: true }],
    };
    applyGoldSpent(s, 10);
    // A Ruby is 1/1 + the run's Ruby strength → +3/+3 here.
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([5, 5]);
    expect([s.board[1]!.attack, s.board[1]!.health]).toEqual([6, 6]);
  });

  it('banks the remainder — 9 Gold pays nothing, the 10th trips it', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('a', 'drummer', 2, 2)],
      runeThresholds: [{ meter: 'gold', per: 10, tick: 0, rubyAll: true }],
    };
    applyGoldSpent(s, 9);
    expect([s.board[0]!.attack, s.board[0]!.health], 'nothing at 9').toEqual([2, 2]);
    applyGoldSpent(s, 1);
    expect([s.board[0]!.attack, s.board[0]!.health], 'the 10th Gold trips it').toEqual([3, 3]);
  });
});

describe('the four defs are wired', () => {
  it('exist at the owner costs, with the right tier of forge', () => {
    expect(RUNE_INDEX['rune_distillation']!.cost).toBe(2);
    expect(RUNE_INDEX['rune_distillation']!.epic).toBeUndefined(); // basic
    expect(RUNE_INDEX['rune_liquidation']!.cost).toBe(4);
    expect(RUNE_INDEX['rune_liquidation']!.epic).toBe(true);
    expect(RUNE_INDEX['rune_warpath']!.cost).toBe(5);
    expect(RUNE_INDEX['rune_warpath']!.epic).toBe(true);
    expect(RUNE_INDEX['rune_gemspam']!.cost).toBe(4); // owner balance 2026-08-11 (5 → 4)
    expect(RUNE_INDEX['rune_gemspam']!.epic).toBe(true);
  });
});
