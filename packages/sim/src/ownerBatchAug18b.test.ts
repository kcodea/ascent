import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import { applyEndOfTurn } from './recruit';

/**
 * Owner batch 2026-08-18 (part B) — new coverage for the three reworked cards in this PR:
 *   • Vaultkeeper (d2_herzog): per-Dragon-play self-buff = base × (1 + ⌊spells/4⌋) × golden.
 *   • Beardsley  (b2_beardsley): escalating summon buff, +3/+3 improving +3/+3 every 3 Beasts.
 *   • Rope Wrangler (ropewrangler): End-of-Turn Lasso multicast, +1 cast per 6 Gold spent (5 max).
 */

const card = (uid: string, cardId: string, attack?: number, health?: number, extra?: Partial<BoardCard>): BoardCard => ({
  uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral',
  attack: attack ?? CARD_INDEX[cardId]?.attack ?? 0,
  health: health ?? CARD_INDEX[cardId]?.health ?? 0,
  keywords: [], golden: false, ...extra,
});

describe('Vaultkeeper — gains base×(1+⌊spells/4⌋) whenever you play a Dragon', () => {
  // On board when another Dragon is played (its own onSummon skips self). base 2, per 4 spells.
  const playDragonInto = (vault: BoardCard, spellsCast: number): [number, number] => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20, tier: 6,
      board: [vault], hand: [card('drg', 'd2_embermouth')], spellsCast,
    };
    s = reduce(s, { type: 'play', uid: 'drg' });
    const v = s.board.find((c) => c.uid === vault.uid)!;
    return [v.attack, v.health];
  };

  it('plain Vaultkeeper gains +2/+2 with no spells cast', () => {
    // 6/10 base → +2/+2 → 8/12.
    expect(playDragonInto(card('v', 'd2_herzog'), 0)).toEqual([8, 12]);
  });

  it('golden Vaultkeeper gains +4/+4 with no spells cast', () => {
    expect(playDragonInto({ ...card('v', 'd2_herzog'), golden: true }, 0)).toEqual([10, 14]);
  });

  it('at 4 spells cast this game the grant improves to +4/+4 (plain)', () => {
    // step = ⌊4/4⌋ = 1 → grant = 2 × (1 + 1) = +4/+4 → 6/10 → 10/14.
    expect(playDragonInto(card('v', 'd2_herzog'), 4)).toEqual([10, 14]);
  });
});

describe('Beardsley — escalating summon buff (+3/+3, improves +3/+3 every 3 Beasts)', () => {
  it('the first three Beasts played get +3/+3 and the fourth gets +6/+6', () => {
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
    expect(grants, 'Beasts 1-3 land +3/+3, the 4th escalates to +6/+6')
      .toEqual([[3, 3], [3, 3], [3, 3], [6, 6]]);
  });
});

describe('Rope Wrangler — End-of-Turn Lasso multicast (+1 cast per 6 Gold spent, 5 max)', () => {
  const wrangler = (gold: number, golden = false): RunState => ({
    ...createRun(1), phase: 'recruit', embers: 10, shop: [],
    board: [{ ...card('rw', 'ropewrangler', 5, 4), golden }],
    goldSpentThisTurn: gold, spellsCast: 0, spellsThisTurn: 0,
  });

  it('casts once with no Gold spent (min 1)', () => {
    const s = wrangler(0);
    applyEndOfTurn(s);
    expect(s.spellsCast).toBe(1);
  });

  it('12 Gold spent → 3 casts (1 + ⌊12/6⌋)', () => {
    const s = wrangler(12);
    applyEndOfTurn(s);
    expect(s.spellsCast).toBe(3);
  });

  it('a huge Gold spend is capped at 5 casts', () => {
    const s = wrangler(600);
    applyEndOfTurn(s);
    expect(s.spellsCast).toBe(5);
  });

  it('golden multiplies then caps (12 Gold → 6 → 5)', () => {
    const s = wrangler(12, true);
    applyEndOfTurn(s);
    expect(s.spellsCast).toBe(5);
  });
});
