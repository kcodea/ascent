import { afterEach, describe, expect, it } from 'vitest';
import { hasMilestoneReached, markMilestoneReached, resetMilestoneLatches } from './milestoneBadgeFx';

describe('milestone latch', () => {
  afterEach(() => resetMilestoneLatches());

  it('latches per uid + stat', () => {
    expect(hasMilestoneReached('u1', 'attack')).toBe(false);
    markMilestoneReached('u1', 'attack');
    expect(hasMilestoneReached('u1', 'attack')).toBe(true);
    expect(hasMilestoneReached('u1', 'health')).toBe(false); // the other stat is independent
    expect(hasMilestoneReached('u2', 'attack')).toBe(false);  // another uid is independent
  });

  it('resetMilestoneLatches clears everything (called on each new run)', () => {
    markMilestoneReached('u1', 'attack');
    markMilestoneReached('u2', 'health');
    resetMilestoneLatches();
    expect(hasMilestoneReached('u1', 'attack')).toBe(false);
    expect(hasMilestoneReached('u2', 'health')).toBe(false);
  });
});
