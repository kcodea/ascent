import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { holdMs } from './clock';
import { getLungeConfig } from '../lungeConfig';
import { getChoreoConfig, beatDelay } from './choreoConfig';
import { momentKind } from './kinds';

/** A minimal Moment whose primary is an event of the given type. The clock keys holds by the moment's KIND
 *  (2026-07-18 audit), so the fixture derives it exactly like the real compiler does. */
const M = (type: CombatEvent['type']): Moment => ({
  start: 0,
  end: 1,
  primary: { type } as CombatEvent,
  stepGroups: [[0]],
  kind: momentKind({ type } as CombatEvent),
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
