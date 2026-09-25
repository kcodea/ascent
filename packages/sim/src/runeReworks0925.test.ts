/**
 * THREE RUNE REWORKS (owner 2026-09-25).
 *
 *  - Rune of Action: *"End of Turn: Give 3 random minions +2/+2. Repeat for every card played this turn."* The
 *    REPEAT form (R-REPEAT-01): the base tick once, then one more per card played, each its own tick and beat.
 *    "Random minions" are FRIENDLY minions (the old rune buffed your own left-most three).
 *  - Rune of Bulk Order: *"When you spend 10 gold, give 4 friendly minions +4/+4."* A running Gold counter that banks
 *    the remainder across spends and turns; 4 random friendly minions per payout, or all of them when fewer.
 *  - Rune of the Bargain Bin: *"the refresh should only include SHOUT minions. edit the description to match"*.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, RUNE_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, hasBattlecry, projectEndOfTurnSteps, questEndOfTurnBeats, recurringTickCount, replayRecurringEndOfTurn } from './recruit';

const ally = (uid: string): BoardCard => ({ uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
const gainOf = (s: RunState, source: string): number => s.board.reduce((n, c) => n + (c.buffs?.find((b) => b.source === source)?.attack ?? 0), 0);
const buy = (rune: string, over: Partial<RunState> = {}): RunState =>
  reduce({ ...createRun(3, 'warden'), phase: 'recruit', embers: 40, tier: 3, runeforgeOffer: [rune], ...over } as RunState, { type: 'buyRune', index: 0 } as Action) as RunState;

describe('Rune of Action — "give 3 random friendly minions +2/+2. Repeat for every card played this turn"', () => {
  const armed = (played: number, board: BoardCard[]): RunState => ({
    ...createRun(1, 'warden'), wave: 3, phase: 'recruit', questRecurringEndOfTurn: ['runeAction'],
    playedThisTurn: Array.from({ length: played }, (_, i) => `x${i}`), board, recruitBuffFx: [],
  } as RunState);
  const five = (): BoardCard[] => ['a', 'b', 'c', 'd', 'e'].map(ally);

  it('the def: Basic, the new text, the recurring End-of-Turn reward', () => {
    const r = RUNE_INDEX['rune_action']!;
    expect(r.text).toBe('**End of Turn:** give **3 random friendly minions +2/+2**. Repeat for every card played this turn.');
    expect(r.reward).toEqual({ kind: 'recurringEndOfTurn', effect: 'runeAction' });
    expect(r.epic).toBeFalsy();
  });

  it('buying it arms the recurrence', () => {
    expect(buy('rune_action').questRecurringEndOfTurn).toContain('runeAction');
  });

  it.each([0, 1, 3])('with %i cards played it lands 1 + n ticks, each on 3 distinct friendly minions for +2/+2', (n) => {
    const s = armed(n, five());
    applyEndOfTurn(s);
    expect(gainOf(s, 'Rune of Action'), 'ticks × 3 picks × +2').toBe((1 + n) * 3 * 2);
    for (const c of s.board) {
      const b = c.buffs?.find((x) => x.source === 'Rune of Action');
      if (!b) continue;
      expect(b.attack).toBe(b.health);
      expect(b.count, 'at most one grant per tick per minion (the 3 picks are distinct)').toBeLessThanOrEqual(1 + n);
      expect(b.attack).toBe(2 * b.count);
    }
    expect(recurringTickCount(s, 'runeAction')).toBe(1 + n);
  });

  it('a nothing-played turn still pays the base tick once', () => {
    const s = armed(0, five());
    applyEndOfTurn(s);
    expect(gainOf(s, 'Rune of Action')).toBe(6);
  });

  it('fewer than 3 friendly minions: every one of them gets each tick', () => {
    const s = armed(2, [ally('a'), ally('b')]);
    applyEndOfTurn(s);
    expect(s.board.map((c) => [c.attack, c.health])).toEqual([[7, 7], [7, 7]]); // 1 + 3 ticks × +2
  });

  it('an empty board does nothing (and does not throw)', () => {
    const s = armed(4, []);
    expect(() => applyEndOfTurn(s)).not.toThrow();
  });

  it('targets are re-rolled per tick, deterministically off the run cursor', () => {
    const a = armed(5, five()), b = armed(5, five());
    applyEndOfTurn(a); applyEndOfTurn(b);
    expect(a.board.map((c) => c.attack)).toEqual(b.board.map((c) => c.attack));
    // 6 ticks × 3 of 5 picks: with a fixed-target rule the same 3 would get everything; the roll spreads it.
    expect(a.board.filter((c) => c.attack > 1).length).toBeGreaterThan(3);
  });

  it('the projection and the beat list play ONE step per tick, and the projection ends where the commit lands', () => {
    const s = armed(2, five());
    const { steps } = projectEndOfTurnSteps(s);
    expect(steps).toHaveLength(3);
    expect(questEndOfTurnBeats(s)).toHaveLength(3);
    const committed = structuredClone(s);
    applyEndOfTurn(committed);
    for (const c of committed.board) expect(steps[2]![c.uid]).toEqual({ attack: c.attack, health: c.health });
  });

  it('a replay of your recurring End-of-Turn effects (the "trigger your End of Turn effects" path) runs every tick', () => {
    const s = armed(2, five());
    expect(replayRecurringEndOfTurn(s)).toBe(true);
    expect(gainOf(s, 'Rune of Action')).toBe(18);
  });
});

describe('Rune of Bulk Order — "every 10 Gold you spend, give 4 random friendly minions +4/+4"', () => {
  it('the def: text + reward', () => {
    const r = RUNE_INDEX['rune_scale']!;
    expect(r.name).toBe('Rune of Bulk Order');
    expect(r.text).toBe('Every **10 Gold** you spend, give **4 random friendly minions +4/+4**.');
    expect(r.reward).toEqual({ kind: 'runeScale', count: 4, attack: 4, health: 4, per: 10 });
  });

  const armed = (board: BoardCard[]): RunState => {
    const s = buy('rune_scale', { board: [], freeRolls: 0 });
    expect(s.runeScale).toMatchObject({ count: 4, attack: 4, health: 4, per: 10 });
    s.runeScale!.tick = 0; // start the meter clean (the purchase itself spent Gold)
    s.board = board; // seated AFTER the purchase: a buy would triple three identical bodies away
    return s;
  };
  const roll = (s: RunState, times: number): RunState => { for (let i = 0; i < times; i++) s = reduce(s, { type: 'roll' }) as RunState; return s; };

  it('9 Gold pays nothing; the 10th pays 4 random friendly minions +4/+4 once', () => {
    let s = armed(['a', 'b', 'c', 'd', 'e', 'f'].map(ally));
    s = roll(s, 9);
    expect(s.runeScale!.tick).toBe(9);
    expect(gainOf(s, 'Rune of Bulk Order')).toBe(0);
    s = roll(s, 1);
    expect(s.runeScale!.tick).toBe(0);
    expect(gainOf(s, 'Rune of Bulk Order')).toBe(16);
    expect(s.board.filter((c) => c.attack === 5 && c.health === 5)).toHaveLength(4);
  });

  it('fewer than 4 friendly minions: all of them get the payout', () => {
    let s = armed([ally('a'), ally('b')]);
    s = roll(s, 10);
    expect(s.board.map((c) => [c.attack, c.health])).toEqual([[5, 5], [5, 5]]);
  });

  it('the counter carries over: the banked Gold survives the turn boundary', () => {
    let s = armed(['a', 'b', 'c', 'd'].map(ally));
    s = roll(s, 7);
    expect(s.runeScale!.tick).toBe(7);
    s = reduce(s, { type: 'faceOmen' }) as RunState;
    const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
    s = reduce({ ...s, lastCombat: win } as RunState, { type: 'resolveCombat' }) as RunState;
    expect(s.phase).toBe('recruit');
    expect(s.runeScale!.tick, 'the meter did not reset at the turn boundary').toBe(7);
  });
});

describe('Rune of the Bargain Bin — the binned refresh draws only SHOUT minions', () => {
  it('the def: the text says Shout', () => {
    expect(RUNE_INDEX['rune_bargain_bin']!.text).toBe('Your first **Refresh** each turn fills the Shop with **Shout** minions that cost **1 Gold**. They sell for **0 Gold**.');
  });

  it.each(['set2', 'set3'] as const)('%s: the first Refresh fills every minion slot with a 1-Gold, sell-for-0 Shout minion at your tier or below', (setId) => {
    for (const tier of [1, 3, 6]) {
      let s = { ...createRun(5, 'warden'), setId, phase: 'recruit', embers: 10, tier, runeBargainBin: true,
        pool: Object.fromEntries(poolFor(setId).buyable.map((c) => [c.id, 5])) } as RunState;
      s = reduce(s, { type: 'roll' }) as RunState;
      const minions = s.shop.filter((o) => { const d = CARD_INDEX[o.cardId]; return d && !d.spell && !d.ruby && !o.starform; });
      expect(minions.length, `${setId} tier ${tier}`).toBeGreaterThan(0);
      for (const o of minions) {
        const d = CARD_INDEX[o.cardId]!;
        expect(hasBattlecry(d), `${d.name} is a Shout minion`).toBe(true);
        expect(d.tier).toBeLessThanOrEqual(tier);
        expect(poolFor(setId).buyable.some((c) => c.id === d.id), `${d.id} is in the run's pool`).toBe(true);
        expect([o.cost, o.sellZero]).toEqual([1, true]);
      }
      expect(s.bargainBinUsedThisTurn).toBe(1);
    }
  });

  it('the second Refresh that turn is an ordinary one (the bin is once per turn per copy)', () => {
    let s = { ...createRun(5, 'warden'), setId: 'set3', phase: 'recruit', embers: 10, tier: 6, runeBargainBin: true } as RunState;
    s = reduce(s, { type: 'roll' }) as RunState;
    s = reduce(s, { type: 'roll' }) as RunState;
    expect(s.shop.some((o) => o.sellZero)).toBe(false);
  });

  it('FALLBACK: no Shout minion reachable → the refresh stays ordinary and the use is NOT spent', () => {
    // Every set fields a Shout minion from tier 1, so an empty draw needs an artificial state: tier 0 reaches none.
    let s = { ...createRun(5, 'warden'), setId: 'set3', phase: 'recruit', embers: 10, tier: 0, runeBargainBin: true } as RunState;
    s = reduce(s, { type: 'roll' }) as RunState;
    expect(s.shop.some((o) => o.sellZero), 'nothing binned').toBe(false);
    expect(s.bargainBinUsedThisTurn ?? 0, 'the use is still there for a later refresh').toBe(0);
  });
});
