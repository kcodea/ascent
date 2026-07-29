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
  // Every kind SPLIT (kinds.ts) must be pacing-neutral: the new kind's hold has to equal the hold the events
  // that moved to it had under their old classification. (The replay clock keys by primary event TYPE, so a
  // split can't move a beat regardless — this locks the kind-facing view, which the score takes over later.)
  it('every kind split preserves the old kind’s hold exactly', () => {
    expect(holdMsForKind('shieldGain')).toBe(holdMsForKind('shieldPop'));   // Ward gained ← Ward consumed
    expect(holdMsForKind('venomSpent')).toBe(holdMsForKind('poisonTick'));  // Venom spent ← Execute proc
    expect(holdMsForKind('scNarrate')).toBe(holdMsForKind('scCast'));       // narration ← Start-of-Combat cast
    expect(holdMsForKind('questTrigger')).toBe(holdMsForKind('damage'));    // quest beats ← the `damage` default
    expect(holdMsForKind('questComplete')).toBe(holdMsForKind('damage'));
  });

  it('CHOREO_KEYS still enumerates every pacing field', () => {
    expect(CHOREO_KEYS).toContain('speed');
    expect(CHOREO_KEYS).toContain('finalHold');
  });
});
