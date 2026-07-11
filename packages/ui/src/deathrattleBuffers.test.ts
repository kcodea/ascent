import { describe, it, expect } from 'vitest';
import { isDeathrattleBufferCard } from './deathrattleBuffers';

describe('isDeathrattleBufferCard', () => {
  it('true — onDeath buff-others', () => {
    expect(isDeathrattleBufferCard('sergeant')).toBe(true);  // onDeath deathrattleBuffAllHealth
    expect(isDeathrattleBufferCard('spore')).toBe(true);     // onDeath deathrattleBuffAll
    expect(isDeathrattleBufferCard('impking')).toBe(true);   // onDeath deathrattleSummon + deathrattleBuffImps
  });
  it('false — a Start-of-Combat buffer (living-source tendril, not onDeath)', () => {
    expect(isDeathrattleBufferCard('kennel')).toBe(false);   // startOfCombat scBeastAura; no onDeath buff
  });
  it('false — an onDeath that only SUMMONS (no buff)', () => {
    expect(isDeathrattleBufferCard('broodmother')).toBe(false); // onDeath deathrattleSummon only
  });
  it('false — an unknown card id', () => {
    expect(isDeathrattleBufferCard('no-such-card')).toBe(false);
  });
});
