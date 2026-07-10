import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { holdMs } from './clock';
import { getLungeConfig } from '../lungeConfig';
import { getChoreoConfig, beatDelay } from './choreoConfig';

/** A minimal Moment whose primary is an event of the given type (only `primary.type` is read by the clock). */
const M = (type: CombatEvent['type']): Moment => ({
  start: 0,
  end: 1,
  primary: { type } as CombatEvent,
  stepGroups: [[0]],
  kind: 'damage',
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

  it('a swing aftermath: the FIRST consequence after an impact waits aftermathHold (the settle)', () => {
    const cfg = getChoreoConfig();
    expect(holdMs(M('summon'), M('dmg'), 1)).toBeCloseTo(cfg.aftermathHold, 5);   // deathrattle token
    expect(holdMs(M('reborn'), M('death'), 1)).toBeCloseTo(cfg.aftermathHold, 5); // a reborn right after a death
    expect(holdMs(M('improve'), M('death'), 1)).toBeCloseTo(cfg.aftermathHold, 5);// Kennelmaster's Avenge aura bump
    expect(holdMs(M('summon'), M('dmg'), 2)).toBeCloseTo(cfg.aftermathHold / 2, 5); // ÷ combatSpeed
  });

  it('within the aftermath: consecutive consequences stagger by aftermathStagger', () => {
    const cfg = getChoreoConfig();
    expect(holdMs(M('reborn'), M('summon'), 1)).toBeCloseTo(cfg.aftermathStagger, 5);
    expect(holdMs(M('buff'), M('summon'), 1)).toBeCloseTo(cfg.aftermathStagger, 5);
    expect(holdMs(M('reborn'), M('summon'), 2)).toBeCloseTo(cfg.aftermathStagger / 2, 5);
  });

  it('a consequence after a NON-impact action keeps the legacy overlap (not the aftermath cadence)', () => {
    const cfg = getChoreoConfig();
    // shown is a start-of-combat cast (not an impact, not an aftermath beat) → summon/reborn ride via overlapMs.
    expect(holdMs(M('summon'), M('sc'), 1)).toBeCloseTo(cfg.overlapMs, 5);
    // No beat on screen (the very first beat) → no overlap/aftermath; the normal linger applies.
    expect(holdMs(M('summon'), undefined, 1)).toBeCloseTo(beatDelay('summon') * cfg.speed, 5);
  });
});
