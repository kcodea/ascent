/**
 * R-SKIP-TURBO-01 (owner ask 2026-10-22): Skip fast-forwards the fight at up to 20× and eases back to the
 * player's own speed for the hit that DECIDES it: a smooth climb, then an even brake that lands exactly on it,
 * with the game sounds crossfading back in against the fast-forward whir.
 * Pins: which beat decides a fight, the authored time-left to it, and the speed curve's shape.
 */
import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { buildAuthoredTimeline, COMBAT_RAMP_DEFAULTS } from './combatRampConfig';
import { decisiveBeatIndex, remainingNow, remainingToAnchor, skipTurboSpeed, turboAmount } from './skipTurbo';
import { TURBO_SFX_BLOCK, turboSfxGain } from './sfx';

type Ev = CombatEvent;
const attack = (attacker: string, defender: string): Ev => ({ type: 'attack', attacker, defender, swing: 1 } as Ev);
const dmg = (target: string, source?: string): Ev => ({ type: 'dmg', target, amount: 3, remainingHp: 0, source } as Ev);
const death = (target: string, rise?: true): Ev => ({ type: 'death', target, side: 'enemy', ...(rise ? { rise } : {}) } as Ev);
const summon = (): Ev => ({ type: 'summon', minion: {} as never, side: 'player', index: 0 } as Ev);
const sc = (source: string): Ev => ({ type: 'sc', source, text: 'x' } as Ev);

/** Beats as [start, end) ranges over `events`, each primary = its first event. */
const beatsOf = (events: Ev[], cuts: number[]) => cuts.slice(0, -1).map((start, k) => ({ start, end: cuts[k + 1]!, primary: events[start]! }));

describe('decisiveBeatIndex', () => {
  // Two swings: A kills B, then C kills D (the last body to die), then a trailing summon beat.
  const events = [attack('A', 'B'), dmg('B', 'A'), dmg('A', 'B'), death('B'), attack('C', 'D'), dmg('D', 'C'), dmg('C', 'D'), death('D'), summon()];
  const beats = beatsOf(events, [0, 1, 4, 5, 8, 9]);

  it('is the deciding swing\'s wind-up, so the whole lunge plays at normal speed', () => {
    expect(decisiveBeatIndex(beats, events)).toBe(2);
  });

  it('ignores a Rise\'s first death (the body comes back)', () => {
    const ev = [...events, death('Z', true)];
    expect(decisiveBeatIndex(beatsOf(ev, [0, 1, 4, 5, 8, 10]), ev)).toBe(2);
  });

  it('a kill outside a swing (a Start-of-Combat blast) decides on its own beat', () => {
    const ev = [sc('S'), dmg('D', 'S'), death('D')];
    expect(decisiveBeatIndex(beatsOf(ev, [0, 3]), ev)).toBe(0);
  });

  it('a fight with no death decides on its last beat; no beats → 0', () => {
    const ev = [attack('A', 'B'), dmg('B', 'A')];
    expect(decisiveBeatIndex(beatsOf(ev, [0, 1, 2]), ev)).toBe(1);
    expect(decisiveBeatIndex([], [])).toBe(0);
  });
});

describe('remainingToAnchor', () => {
  // Four beats, 1000ms authored hold before each after the first, 900ms final hold.
  const tl = buildAuthoredTimeline([0, 1, 2, 3], () => 1000, 900);

  it('counts the authored time from the beat about to play to the anchor', () => {
    expect(remainingToAnchor(tl, 0, 3, 4)).toBe(3000);
    expect(remainingToAnchor(tl, 1, 3, 4)).toBe(2000);
  });

  it('is zero once the anchor is reached or passed', () => {
    expect(remainingToAnchor(tl, 3, 3, 4)).toBe(0);
    expect(remainingToAnchor(tl, 4, 3, 4)).toBe(0);
  });

  it('an anchor at the end of the fight includes the final hold', () => {
    expect(remainingToAnchor(tl, 3, 4, 4)).toBe(900);
  });
});


describe('remainingNow', () => {
  const tl = buildAuthoredTimeline([0, 1, 2, 3], () => 1000, 900);

  it('moves through the current hold instead of stepping once per beat', () => {
    expect(remainingNow(tl, 1, 0, 3, 4)).toBe(3000);    // the hold into beat 1 has just begun
    expect(remainingNow(tl, 1, 400, 3, 4)).toBe(2600);
    expect(remainingNow(tl, 1, 5000, 3, 4)).toBe(2000); // a long beat waits at the next beat's value
  });

  it('is zero once the anchor is reached', () => {
    expect(remainingNow(tl, 3, 0, 3, 4)).toBe(0);
  });
});

describe('skipTurboSpeed (the brake)', () => {
  const cfg = COMBAT_RAMP_DEFAULTS;
  const FAR = 1_000_000;

  it('defaults to 20x, a short climb, and a 1.5 s brake', () => {
    expect(cfg.turboCeiling).toBe(20);
    expect(cfg.turboRampUpMs).toBeLessThan(cfg.rampUpMs);
    expect(cfg.turboBrakeMs).toBe(1500);
  });

  it('starts at the player\'s speed with no grace hold and climbs to the ceiling', () => {
    expect(skipTurboSpeed(1, 0, FAR, cfg)).toBeCloseTo(1);
    expect(skipTurboSpeed(1, cfg.turboRampUpMs / 2, FAR, cfg)).toBeGreaterThan(1);
    expect(skipTurboSpeed(1, cfg.turboRampUpMs, FAR, cfg)).toBeCloseTo(20);
  });

  it('is exactly the player\'s speed at the deciding hit, and never below it', () => {
    expect(skipTurboSpeed(1.5, 10_000, 0, cfg)).toBeCloseTo(1.5);
    expect(skipTurboSpeed(3, 0, 0, cfg)).toBe(3);
    expect(skipTurboSpeed(25, 10_000, FAR, cfg)).toBe(25); // slider above the Skip speed: nothing to do
  });

  /** Play the brake out frame by frame from full speed, the way the replay consumes authored time. */
  function brakeOut(base: number, startRem: number): { ms: number; maxStep: number; end: number } {
    let rem = startRem;
    let v = skipTurboSpeed(base, 10_000, rem, cfg);
    let ms = 0;
    let maxStep = 0;
    while (rem > 0 && ms < 60_000) {
      rem = Math.max(0, rem - v * 16);
      const nv = skipTurboSpeed(base, 10_000, rem, cfg);
      maxStep = Math.max(maxStep, Math.abs(nv - v));
      v = nv;
      ms += 16;
    }
    return { ms, maxStep, end: v };
  }

  it('slows evenly over about the brake time and lands on the player\'s speed', () => {
    const { ms, maxStep, end } = brakeOut(1, 60_000);
    // Cruises at 20x until the brake bites, then the brake itself takes ~turboBrakeMs of real time.
    const brakeStart = (20 * 20 - 1) / (2 * (19 / cfg.turboBrakeMs));
    const cruise = (60_000 - brakeStart) / 20;
    expect(ms - cruise).toBeGreaterThan(cfg.turboBrakeMs * 0.85);
    expect(ms - cruise).toBeLessThan(cfg.turboBrakeMs * 1.15);
    expect(end).toBeCloseTo(1, 5);
    // Even deceleration: no frame drops the speed by more than ~2 frames' worth of the brake (no sudden steps).
    expect(maxStep).toBeLessThan((19 / cfg.turboBrakeMs) * 16 * 2);
  });

  it('a Skip pressed with little fight left still lands smoothly', () => {
    const { end, maxStep } = brakeOut(1, 2000);
    expect(end).toBeCloseTo(1, 5);
    expect(maxStep).toBeLessThan((19 / cfg.turboBrakeMs) * 16 * 2);
  });

  it('degenerate tuner values cannot stall it', () => {
    const zero = { ...cfg, turboRampUpMs: 0, turboBrakeMs: 0 };
    expect(Number.isFinite(skipTurboSpeed(1, 0, FAR, zero))).toBe(true);
    expect(skipTurboSpeed(1, 0, 0, zero)).toBeCloseTo(1);
  });
});

describe('turboAmount + the game-sound crossfade', () => {
  const cfg = COMBAT_RAMP_DEFAULTS;

  it('reads 0 at the player\'s speed and 1 at the Skip speed', () => {
    expect(turboAmount(1, 1, cfg)).toBe(0);
    expect(turboAmount(20, 1, cfg)).toBe(1);
    expect(turboAmount(10.5, 1, cfg)).toBeCloseTo(0.5);
  });

  it('game sounds are silent while it races and fade back in through the brake, never a snap', () => {
    expect(turboSfxGain(1)).toBe(0);
    expect(turboSfxGain(TURBO_SFX_BLOCK)).toBe(0);
    expect(turboSfxGain(0)).toBe(1);
    // Monotone, and small steps all the way down: the level comes back gradually as the speed falls.
    let prev = 0;
    for (let a = TURBO_SFX_BLOCK; a >= 0; a -= 0.01) {
      const g = turboSfxGain(a);
      expect(g).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(g - prev).toBeLessThan(0.06);
      prev = g;
    }
  });
});
