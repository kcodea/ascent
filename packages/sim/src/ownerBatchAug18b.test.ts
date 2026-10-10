import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { applyEndOfTurn } from './recruit';

/**
 * Owner batch 2026-08-18 (part B) — new coverage for the three reworked cards in this PR:
 *   • Vaultkeeper (d2_herzog): RETIRED 2026-10-10 (the effect was replaced; see dragonBatch1010.test.ts).
 *   • Beardsley  (b2_beardsley): escalating summon buff, +3/+3 improving +3/+3 every 3 Beasts.
 *   • Rope Wrangler (ropewrangler): End-of-Turn Lasso, repeated per 10 Gold spent (owner rework 2026-09-23; was
 *     +1 cast per 6 Gold, 5 max).
 */

const card = (uid: string, cardId: string, attack?: number, health?: number, extra?: Partial<BoardCard>): BoardCard => ({
  uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral',
  attack: attack ?? CARD_INDEX[cardId]?.attack ?? 0,
  health: health ?? CARD_INDEX[cardId]?.health ?? 0,
  keywords: [], golden: false, ...extra,
});

// RETIRED 2026-10-10: Vaultkeeper's "gain +2/+2 whenever you play a Dragon, improving per 4 spells" was replaced by the
// owner ("When this gains Attack, give adjacent Dragons +3/+4"); the new card is pinned in dragonBatch1010.test.ts.

// RE-PINNED 2026-10-07 (owner batch): Beardsley is +1/+1 and improves +1/+1 on EVERY Beast (was +3/+3 every 3).
describe('Beardsley — escalating summon buff (+1/+1, improves +1/+1 every Beast)', () => {
  it('four Beasts played in a row get +1/+1, +2/+2, +3/+3, +4/+4', () => {
    // Recruit-phase: Beardsley on board, four DISTINCT Beasts with no play-time trigger (so nothing else
    // summons and no triple forms) played one at a time. Each arriver takes the grant; Beasts 1-3 are at step 0
    // (+3), the 4th crosses `every:3` to step 1 (+6). The grant is the delta over each card's printed stats.
    const beasts: [string, string][] = [['s1', 'trailforager'], ['s2', 'babycub'], ['s3', 'raptor'], ['s4', 'gryphon']];
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40, tier: 6,
      board: [card('B', 'b2_beardsley')],
      hand: beasts.map(([uid, id]) => card(uid, id)),
    };
    const grants: [number, number][] = [];
    for (const [uid, id] of beasts) {
      s = reduce(s, { type: 'play', uid });
      const m = s.board.find((c) => c.uid === uid)!;
      const base = CARD_INDEX[id]!;
      grants.push([m.attack - base.attack, m.health - base.health]);
    }
    expect(grants, 'each Beast one step bigger than the last')
      .toEqual([[1, 1], [2, 2], [3, 3], [4, 4]]);
  });
});

describe('Rope Wrangler — End-of-Turn Lasso, repeated per 10 Gold spent (owner rework 2026-09-23, no cap)', () => {
  const wrangler = (gold: number, golden = false): RunState => ({
    ...createRun(1), phase: 'recruit', embers: 10, shop: [],
    board: [{ ...card('rw', 'ropewrangler', 5, 4), golden }],
    goldSpentThisTurn: gold, spellsCast: 0, spellsThisTurn: 0,
  });

  it('casts once with no Gold spent (the base cast)', () => {
    const s = wrangler(0);
    applyEndOfTurn(s);
    expect(s.spellsCast).toBe(1);
  });

  it('20 Gold spent → 3 casts (1 + ⌊20/10⌋)', () => {
    const s = wrangler(20);
    applyEndOfTurn(s);
    expect(s.spellsCast).toBe(3);
  });

  it('a huge Gold spend is NOT capped (600 Gold → 61 casts)', () => {
    const s = wrangler(600);
    applyEndOfTurn(s);
    expect(s.spellsCast).toBe(61);
  });

  it('golden casts twice per tick (20 Gold → 3 ticks → 6 casts)', () => {
    const s = wrangler(20, true);
    applyEndOfTurn(s);
    expect(s.spellsCast).toBe(6);
  });
});
