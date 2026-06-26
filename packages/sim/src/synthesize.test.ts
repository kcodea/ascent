import { describe, it, expect } from 'vitest';
import { makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mutateBoard, synthesizeForWave, synthesizeWaveFromCurve, buildWaveLadders, ratingBand, type BoardSnapshot } from './index';

const vanilla = (n: number, atk: number, hp: number, kw?: BoardMinion['keywords']): BoardMinion[] =>
  Array.from({ length: n }, () => (kw ? { cardId: 'alley', attack: atk, health: hp, keywords: kw } : { cardId: 'alley', attack: atk, health: hp }));

const realAt = (wave: number, minions: BoardMinion[]): BoardSnapshot => ({
  v: 1, wave, heroId: 'warden', resolve: 30, tier: 4, triples: 0,
  tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], threat: 'horde',
  power: minions.reduce((s, m) => s + m.attack + m.health, 0), minions, seed: 1, origin: 'self',
});

describe('board synthesis', () => {
  // Small ladder (running the bot is the slow part); a low wave where the ladder is weak so a strong real
  // board clears the floor. The synthesis mechanism is what's under test, not the calibration quality.
  const ladders = buildWaveLadders([1, 42], [0.5, 1.0]);
  const wave = [...ladders.keys()].sort((a, b) => a - b)[1] ?? 2;

  it('mutateBoard returns a fresh variant without touching the input, deterministically', () => {
    const input = vanilla(4, 5, 5);
    const snapshot = JSON.stringify(input);
    const a = mutateBoard(input, vanilla(3, 6, 6), makeRng(7));
    const b = mutateBoard(input, vanilla(3, 6, 6), makeRng(7));
    expect(JSON.stringify(input)).toBe(snapshot); // input untouched
    expect(a).toEqual(b); // deterministic for the same rng seed
    expect(a.every((m) => m.attack >= 1 && m.health >= 1)).toBe(true); // valid stats
  });

  it('synthesizeForWave yields servable, competitive, synthetic boards (deterministic); [] for no reals', () => {
    expect(synthesizeForWave([], wave, ladders, 5, 1, { floorBand: 1 })).toEqual([]);
    const reals = [realAt(wave, vanilla(6, 10, 12)), realAt(wave, vanilla(6, 9, 14, ['DS']))];
    const opts = { floorBand: 1, patch: 'test', capturedAt: '2026-06-25' };
    const made = synthesizeForWave(reals, wave, ladders, 6, 1, opts);
    expect(made.length).toBeGreaterThan(0);
    expect(made.length).toBeLessThanOrEqual(6);
    for (const s of made) {
      expect(s.origin).toBe('synthetic');
      expect(s.patch).toBe('test');
      expect(s.minions.every((m) => !!CARD_INDEX[m.cardId])).toBe(true); // servable — every cardId exists
      expect(ratingBand(s.rating ?? 0)).toBeGreaterThanOrEqual(1); // validated competitive (≥ floor)
    }
    const again = synthesizeForWave(reals, wave, ladders, 6, 1, opts);
    expect(again.map((s) => s.power)).toEqual(made.map((s) => s.power)); // deterministic for the same seed
  });

  it('synthesizeWaveFromCurve bands a from-scratch pool at a HIGH wave with no real seed (deterministic)', () => {
    // The bot can't reach wave 15 — the whole point of curve-synthesis. Ladder is the procedural enemy curve.
    const curveLadders = buildWaveLadders([], [], [], { proceduralWaves: 15, proceduralSeeds: 2 });
    const opts = { perWave: 8, proceduralSeeds: 3, patch: 'test', capturedAt: '2026-06-26' };
    const made = synthesizeWaveFromCurve(15, curveLadders, 1234, opts);
    expect(made.length).toBeGreaterThan(0);
    expect(made.length).toBeLessThanOrEqual(8);
    for (const s of made) {
      expect(s.wave).toBe(15);
      expect(s.origin).toBe('synthetic');
      expect(s.patch).toBe('test');
      expect(s.minions.length).toBeGreaterThan(0);
      expect(s.minions.every((m) => !!CARD_INDEX[m.cardId] && m.attack >= 1 && m.health >= 1)).toBe(true);
      expect(s.power).toBe(s.minions.reduce((sum, m) => sum + m.attack + m.health, 0)); // power is Σ(atk+hp)
    }
    // Spans more than one band (a real weak→strong spread, not all-clustered).
    expect(new Set(made.map((s) => ratingBand(s.rating ?? 0))).size).toBeGreaterThan(1);
    const again = synthesizeWaveFromCurve(15, curveLadders, 1234, opts);
    expect(JSON.stringify(again)).toBe(JSON.stringify(made)); // deterministic for the same seed
  });
});
