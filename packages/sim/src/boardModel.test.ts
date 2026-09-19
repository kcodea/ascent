import { describe, it, expect } from 'vitest';
import type { BoardMinion } from '@game/core';
import { predictBoardElo, boardStrength } from './boardModel';
import { BOARD_MODEL } from './boardModel.data';
import { FEATURE_NAMES } from './boardFeatures';
import { boardPowerOf, type ShopView } from './replayV2';

/**
 * THE PER-WAVE YARDSTICK (owner directive 2026-09-19). The board model once standardised features against wave
 * BANDS, and crossing a band edge swapped the yardstick: the replay viewer's Power column showed a board going
 * 99 → 11 from round 12 to 13 with no change to the board. Now every wave is judged against the boards recorded
 * at exactly that wave (thin waves blend their neighbours by distance). These tests pin the properties that
 * make that a yardstick rather than a staircase.
 *
 * Bounds come from the corpus (664 recorded boards, waves 1–17): scoring EVERY recorded board one wave past its
 * own, a fixed board's Elo never moved more than 880 and never ROSE more than 135 (the field only grows, so a
 * board that stands still only loses ground; the small rises are the blended waves 14–17). The band model's
 * edge cliffs were 2,000–125,000 Elo, and it RAISED a fixed board by ~140 every wave inside a band.
 */

const m = (cardId: string, attack: number, health: number, golden = false): BoardMinion => ({ cardId, attack, health, keywords: [], golden });

/** A mid-game board recorded at wave 12 — median Elo for its wave in the corpus. */
const MEDIAN_WAVE_12: BoardMinion[] = [
  m('impala', 197, 197), m('acid', 190, 190), m('ritualist', 307, 309, true), m('heraldapoc', 89, 89),
  m('ritualist', 131, 132), m('ritualist', 118, 119), m('drummer', 24, 26),
];
/** A strong wave-12 board (top quartile) — the kind the owner watched fall off the cliff. */
const STRONG_WAVE_12: BoardMinion[] = [
  m('selfless', 8, 7), m('bountybot', 222, 264), m('beatboxer', 686, 694, true), m('beatboxer', 172, 178),
  m('banksly', 160, 170, true), m('beatboxer', 114, 118), m('moneybot', 82, 84),
];

const MAX_ADJACENT_SHIFT = 1000; // corpus worst 880; the band cliffs were 2,000+
const MAX_ADJACENT_RISE = 150; // corpus worst 135; blended late waves may wobble a little

describe('board model — the per-wave yardstick (2026-09-19)', () => {
  it('ships one yardstick per wave, contiguous from minWave to maxWave, with the wave feature pinned to 0', () => {
    expect(BOARD_MODEL.minWave).toBe(1);
    expect(BOARD_MODEL.maxWave).toBeGreaterThanOrEqual(15);
    const waveIdx = FEATURE_NAMES.indexOf('wave');
    for (let w = BOARD_MODEL.minWave; w <= BOARD_MODEL.maxWave; w++) {
      const st = BOARD_MODEL.waves[w];
      expect(st, `wave ${w} has a yardstick`).toBeDefined();
      expect(st!.mean).toHaveLength(FEATURE_NAMES.length);
      expect(st!.scale).toHaveLength(FEATURE_NAMES.length);
      expect(st!.scale.every((s) => s > 0)).toBe(true);
      expect(st!.mean[waveIdx]).toBe(w);
      expect(st!.scale[waveIdx]).toBe(1);
    }
    expect(BOARD_MODEL.w).toHaveLength(FEATURE_NAMES.length);
    expect(BOARD_MODEL.zClip).toBeGreaterThan(0);
    // the corpus is thin late: the blend rule must have had something to blend
    expect(BOARD_MODEL.nMin).toBeGreaterThan(0);
    expect(Object.values(BOARD_MODEL.waves).filter((s) => s.n >= BOARD_MODEL.nMin).length).toBeGreaterThanOrEqual(10);
  });

  it('never refuses a board with a fitted neighbour: waves past either end clamp to the nearest yardstick', () => {
    expect(predictBoardElo(MEDIAN_WAVE_12, 0)).toBe(predictBoardElo(MEDIAN_WAVE_12, BOARD_MODEL.minWave));
    expect(predictBoardElo(MEDIAN_WAVE_12, 40)).toBe(predictBoardElo(MEDIAN_WAVE_12, BOARD_MODEL.maxWave));
    expect(predictBoardElo(MEDIAN_WAVE_12, 12.4)).toBe(predictBoardElo(MEDIAN_WAVE_12, 12));
    expect(predictBoardElo([], 12)).toBeNull();
    expect(boardStrength([], 12)).toBe(0);
  });

  it.each([['median', MEDIAN_WAVE_12], ['strong', STRONG_WAVE_12]] as const)(
    'no cliff: a fixed %s wave-12 board scored at every wave 8..16 moves smoothly and never gets stronger by waiting',
    (_label, board) => {
      const elo = Array.from({ length: 9 }, (_, i) => predictBoardElo(board, 8 + i)!);
      expect(elo.every((e) => Number.isFinite(e))).toBe(true);
      for (let i = 1; i < elo.length; i++) {
        const delta = elo[i]! - elo[i - 1]!;
        expect(Math.abs(delta), `wave ${7 + i} → ${8 + i}: ${elo[i - 1]!.toFixed(0)} → ${elo[i]!.toFixed(0)}`).toBeLessThanOrEqual(MAX_ADJACENT_SHIFT);
        expect(delta, `a board that did not change must not RISE from wave ${7 + i} to ${8 + i}`).toBeLessThanOrEqual(MAX_ADJACENT_RISE);
      }
      // The band model's signature: identical to the wave-13 problem, the wave-9 → 10 edge was a 2,000+ Elo drop.
      expect(elo[0]! - elo[2]!, 'waves 8 → 10 (the old 7–9 / 10–12 edge)').toBeLessThanOrEqual(2 * MAX_ADJACENT_SHIFT);
    },
  );

  it("the replay viewer's Power column: the same board at round 12 vs 13 no longer collapses", () => {
    // Before (band model): the owner's board read 99 → 11; these two read 98 → 21 and 99 → 21 (≤ 0.22× of
    // their wave-12 score). Now the only thing that changes is the field the board is measured against.
    for (const board of [MEDIAN_WAVE_12, STRONG_WAVE_12]) {
      const at12 = boardStrength(board, 12), at13 = boardStrength(board, 13);
      expect(at12).toBeGreaterThan(0.5); // a median-or-better wave-12 board reads above average at wave 12
      expect(at13, 'no cliff at the old 10–12 / 13–15 edge').toBeGreaterThanOrEqual(0.3 * at12);
      expect(predictBoardElo(board, 12)! - predictBoardElo(board, 13)!).toBeLessThanOrEqual(MAX_ADJACENT_SHIFT);
      // `boardPowerOf` reads only cardId / attack / health / keywords / golden off the recorded board entries
      const view = { board } as unknown as Pick<ShopView, 'board'>;
      const p12 = boardPowerOf(view, 12)!, p13 = boardPowerOf(view, 13)!;
      expect(p12).toBe(Math.round(at12 * 100));
      expect(p13).toBe(Math.round(at13 * 100));
    }
  });

  it('~1500 means average for the wave: the intercept sits at the wave centre and the squash is unchanged', () => {
    expect(Math.abs(BOARD_MODEL.b - 1500)).toBeLessThan(150);
    // an all-zero feature vector cannot be built from minions (count ≥ 1), so pin the squash on the Elo scale
    expect(1 / (1 + Math.exp(-(1500 - 1500) / 300))).toBe(0.5);
    const e = predictBoardElo(MEDIAN_WAVE_12, 12)!;
    expect(boardStrength(MEDIAN_WAVE_12, 12)).toBeCloseTo(1 / (1 + Math.exp(-(e - 1500) / 300)), 12);
  });
});
