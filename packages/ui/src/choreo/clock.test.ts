import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { holdMs } from './clock';
import { getLungeConfig } from '../lungeConfig';
import { getChoreoConfig, beatDelay } from './choreoConfig';

/** A minimal Moment whose primary is an event of the given type. The clock reads `primary.type` and, for the
 *  repeated-narration rule, `kind` — so the kind is overridable rather than always `damage`. */
const M = (type: CombatEvent['type'], kind: Moment['kind'] = 'damage'): Moment => ({
  start: 0,
  end: 1,
  primary: { type } as CombatEvent,
  stepGroups: [[0]],
  kind,
});

describe('holdMs — reproduces the legacy scheduler numbers for non-attack transitions', () => {
  it('a plain result moment: beatDelay(type) × speed ÷ combatSpeed', () => {
    const cfg = getChoreoConfig();
    const next = M('dmg');
    expect(holdMs(next, undefined, 1)).toBeCloseTo(beatDelay('dmg') * cfg.speed, 5);
    expect(holdMs(next, undefined, 2)).toBeCloseTo((beatDelay('dmg') * cfg.speed) / 2, 5);
  });

  it('a NEW attack following an on-screen impact adds the attackGap breather', () => {
    const cfg = getChoreoConfig();
    const c = getLungeConfig();
    const expected = beatDelay('attack') * cfg.speed + c.attackGap * 1000;
    expect(holdMs(M('attack'), M('dmg'), 1)).toBeCloseTo(expected, 5);
  });

  it('combatSpeed of 0 or negative is treated as 1 (no divide-by-zero)', () => {
    const cfg = getChoreoConfig();
    expect(holdMs(M('dmg'), undefined, 0)).toBeCloseTo(beatDelay('dmg') * cfg.speed, 5);
  });

  it('the attack-wind-up transition is no longer special-cased here (the engine\'s GSAP timeline owns it — see useCombatReplay\'s scheduler guard)', () => {
    const cfg = getChoreoConfig();
    // Were the old weld still present, this would equal the lunge connection time, not beatDelay('dmg').
    expect(holdMs(M('dmg'), M('attack'), 1)).toBeCloseTo(beatDelay('dmg') * cfg.speed, 5);
  });

  it('a CONSEQUENCE beat (summon/reborn) rides on the preceding beat — overlapMs ÷ combatSpeed, not the full linger', () => {
    const cfg = getChoreoConfig();
    // With a beat on screen, a summon/reborn overlaps: a short overlapMs (÷ combatSpeed), NOT beatDelay×speed.
    expect(holdMs(M('summon'), M('dmg'), 1)).toBeCloseTo(cfg.overlapMs, 5);
    expect(holdMs(M('reborn'), M('summon'), 1)).toBeCloseTo(cfg.overlapMs, 5);
    expect(holdMs(M('reborn'), M('summon'), 2)).toBeCloseTo(cfg.overlapMs / 2, 5);
    expect(holdMs(M('improve'), M('death'), 1)).toBeCloseTo(cfg.overlapMs, 5); // Kennelmaster's Avenge aura bump
    // No beat on screen (the very first beat) → no overlap; the normal linger applies.
    expect(holdMs(M('summon'), undefined, 1)).toBeCloseTo(beatDelay('summon') * cfg.speed, 5);
  });
});

/**
 * REPEATED NARRATION RIDES (owner report 2026-08-07: proccing Dawnclaw through Echohorn resolved slowly).
 *
 * Every repeated-trigger card logs one `sc` line per fire, and each was a full-weight beat — 1080ms at the
 * default tempo. A gilded Echohorn beside a Sylus procs Dawnclaw four times into two Shout neighbours: eight
 * of them, 8.6 seconds of pauses saying the same thing.
 */
describe('holdMs — a run of narration compresses', () => {
  const narr = () => M('sc', 'scNarrate');

  it('the FIRST narration keeps its full weight, so the cascade still announces itself', () => {
    const cfg = getChoreoConfig();
    expect(holdMs(narr(), M('dmg'), 1)).toBeCloseTo(beatDelay('sc') * cfg.speed, 5);
    expect(holdMs(narr(), undefined, 1)).toBeCloseTo(beatDelay('sc') * cfg.speed, 5);
  });

  it('a narration FOLLOWING another rides at overlapMs instead', () => {
    const cfg = getChoreoConfig();
    expect(holdMs(narr(), narr(), 1)).toBeCloseTo(cfg.overlapMs, 5);
  });

  it('still divides by the combat-speed multiplier', () => {
    const cfg = getChoreoConfig();
    expect(holdMs(narr(), narr(), 4)).toBeCloseTo(cfg.overlapMs / 4, 5);
  });

  /** `sc` is TWO beats behind one event type. A real Start-of-Combat damage cast is a different thing
   *  happening each time, so a run of those must keep full pacing — only narration compresses. */
  it('does NOT compress a run of real Start-of-Combat casts', () => {
    const cfg = getChoreoConfig();
    const cast = () => M('sc', 'scCast');
    expect(holdMs(cast(), cast(), 1)).toBeCloseTo(beatDelay('sc') * cfg.speed, 5);
    expect(holdMs(narr(), cast(), 1)).toBeCloseTo(beatDelay('sc') * cfg.speed, 5);   // cast → narration: full
    expect(holdMs(cast(), narr(), 1)).toBeCloseTo(beatDelay('sc') * cfg.speed, 5);   // narration → cast: full
  });

  /** THE case, end to end: eight chained Shout narrations. First at full weight, seven riding. */
  it('cuts an eight-Shout Dawnclaw cascade by roughly two thirds', () => {
    const cfg = getChoreoConfig();
    const full = beatDelay('sc') * cfg.speed;
    const before = 8 * full;
    const after = full + 7 * cfg.overlapMs;
    expect(after).toBeLessThan(before / 2);
    expect(before).toBeGreaterThan(8000);   // the ~8.6s that prompted this
    expect(after).toBeLessThan(3000);
  });
});
