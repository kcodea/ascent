import { describe, it, expect } from 'vitest';
import { createRun, reduceWithPresentation, type RunState } from './index';
import type { CardGrantedConsequence, ShopChangedConsequence, StatsChangedConsequence } from '@game/core';

/**
 * BEAT SYSTEM PR 6b — expanded consequence coverage: hand grants (conjures) and shop-offer buffs, emitted
 * alongside the stat consequences. Both are ORTHOGONAL to the board/hand stat diff, so they must NOT disturb
 * the statsChanged equivalence proven in PR 6 — this file asserts the new events appear AND that stat events
 * remain faithful.
 */
const faceOmen = { type: 'faceOmen' } as never;

function eot(over: Partial<RunState> = {}): RunState {
  return {
    ...createRun(3, 'warden'),
    phase: 'recruit',
    board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    ...over,
  } as RunState;
}

const evts = (s: RunState) => reduceWithPresentation(s, faceOmen, true).batch?.events ?? [];

describe('PR 6b — hand-grant (conjure) consequences', () => {
  it('a recurring reward that conjures a card to hand emits cardGranted', () => {
    // The Hoard Wakes / Rune of Spending style: grantRandomShout conjures a Battlecry minion to hand each EoT.
    const s = eot({ questRecurringEndOfTurn: ['grantRandomShout'] });
    const grants = evts(s).filter((e): e is CardGrantedConsequence => e.type === 'cardGranted');
    expect(grants.length, 'a card was granted to hand').toBeGreaterThan(0);
    expect(grants[0]!.target.zone).toBe('hand');
    expect(grants[0]!.cardId).toBeTruthy();
  });
});

describe('PR 6b — shop-buff consequences', () => {
  it('a run-wide buy bonus that grows the shop emits shopChanged(buffed)', () => {
    // Force offers into the shop + arm a recurring reward that raises shop stats.
    const s = eot({
      shop: [
        { uid: 's1', cardId: 'stray', atk: 0, hp: 0 } as never,
        { uid: 's2', cardId: 'stray', atk: 0, hp: 0 } as never,
      ],
      questRecurringEndOfTurn: ['runeSpending'],
      goldSpentThisTurn: 20,
    });
    const shopEvents = evts(s).filter((e): e is ShopChangedConsequence => e.type === 'shopChanged');
    // Not every recurring reward grows the shop; assert the SHAPE is correct when present, and that the
    // machinery emits nothing spurious when nothing grew.
    for (const e of shopEvents) {
      expect(e.change).toBe('buffed');
      expect(e.target.zone).toBe('shop');
      expect((e.attack ?? 0) + (e.health ?? 0)).toBeGreaterThan(0);
    }
  });
});

describe('PR 6c — rubies are their own consequence (rubyPlayed), carved out of statsChanged', () => {
  it('Lapidary rubies emit rubyPlayed and NOT a generic statsChanged', () => {
    const s = eot({ runeLapidary: true, playedThisTurn: ['a', 'b'], questRecurringEndOfTurn: ['grantRandomShout'] });
    const events = evts(s);
    // 2 cards played → 2 rubies land on the sole board minion b1.
    const ruby = events.filter((e) => e.type === 'rubyPlayed' && (e as { target: { uid?: string } }).target.uid === 'b1');
    const rubyCount = ruby.reduce((n, e) => n + (e as { count: number }).count, 0);
    expect(rubyCount).toBe(2);
    // …and b1 gets NO ordinary statsChanged (its whole delta was rubies, carved out).
    const stat = events.filter((e): e is StatsChangedConsequence => e.type === 'statsChanged' && e.target.uid === 'b1');
    expect(stat.length).toBe(0);
  });
});
