import { describe, it, expect } from 'vitest';
import { spellDisplayText, createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * ALES SCALE WITH SPELL POWER (owner report 2026-08-02: with +1/+1 spell power, a Defensive Ale landed its
 * printed +0/+4). `spellBuffRandomFriendlies` (Defensive/Bloody Ale) and `spellBuffLeftmost` (Champion's Ale)
 * never read the run's spell bonus — the only stat-SPELL factories that didn't. Both now fold it exactly like
 * `spellBuffTarget`, and `spellDisplayText` prints the live pair (the hard live-text rule).
 */
// DISTINCT card ids — three identical minions would TRIPLE after the cast and eat the fixture's uids.
const minion = (uid: string, cardId = 'drummer'): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false });
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const powered = (hand: BoardCard[]): RunState => ({
  ...createRun(1), phase: 'recruit', embers: 0, shop: [],
  board: [minion('a', 'drummer'), minion('b', 'joker'), minion('c', 'sandbag')],
  hand, spellBonus: { attack: 1, health: 1 },
});

describe('Ales fold the run spell power into the cast', () => {
  it("Defensive Ale with +1/+1 power grants +1/+5 (the owner's board landed +0/+4)", () => {
    let s = powered([spell('sp', 'wo_health')]);
    s = reduce(s, { type: 'play', uid: 'sp' });
    const a = s.board.find((c) => c.uid === 'a')!;
    expect([a.attack, a.health], 'base +0/+4 plus the +1/+1 power').toEqual([2 + 1, 2 + 5]);
  });

  it("Champion's Ale with +1/+1 power grants the left-most +7/+7", () => {
    let s = powered([spell('sp', 'wo_champion')]);
    s = reduce(s, { type: 'play', uid: 'sp' });
    const a = s.board.find((c) => c.uid === 'a')!;
    expect([a.attack, a.health]).toEqual([2 + 7, 2 + 7]);
  });

  it('the printed text goes live on both surfaces (hard live-text rule)', () => {
    expect(spellDisplayText('wo_health', 1, 0, 1)).toContain('{{+1/+5}}');
    expect(spellDisplayText('wo_attack', 1, 0, 1)).toContain('{{+5/+1}}');
    expect(spellDisplayText('wo_champion', 1, 0, 1)).toContain('{{+7/+7}}');
    // No power → the printed base stands, un-greened.
    expect(spellDisplayText('wo_health', 0, 0, 0)).not.toContain('{{');
  });
});
