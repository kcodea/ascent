import { describe, expect, it } from 'vitest';
import { getChoreoConfig, beatDelay, holdMsForKind, CHOREO_KEYS } from './choreoConfig';

describe('choreoConfig', () => {
  it('preserves the shipped pacing defaults (migration is value-identical)', () => {
    const c = getChoreoConfig();
    expect(c.speed).toBe(1.5);
    expect(c.dmg).toBe(460);
    expect(c.death).toBe(400);
    expect(c.sc).toBe(720);
    expect(c.floatMs).toBe(1500);
    expect(c.deathFloatMs).toBe(1000);
    expect(c.finalHold).toBe(900);
    expect(c.overlapMs).toBe(240);
  });
  it('beatDelay falls back to 300 for an unlisted type (matches the former pacing behavior)', () => {
    expect(beatDelay('dmg')).toBe(460);
    expect(beatDelay('nonsense')).toBe(300);
  });
  it('holdMsForKind maps a moment kind to the pre-scale hold it should reproduce', () => {
    expect(holdMsForKind('damage')).toBe(beatDelay('dmg'));
    expect(holdMsForKind('shieldPop')).toBe(beatDelay('shield'));
    expect(holdMsForKind('poisonTick')).toBe(beatDelay('poison')); // the fixed carry-in — was wrongly 'dmg' (460) before this split
    expect(holdMsForKind('death')).toBe(beatDelay('death'));
    expect(holdMsForKind('scCast')).toBe(beatDelay('sc'));
  });
  it('CHOREO_KEYS still enumerates every tunable field (Pacing tuner contract)', () => {
    expect(CHOREO_KEYS).toContain('speed');
    expect(CHOREO_KEYS).toContain('finalHold');
  });
});
