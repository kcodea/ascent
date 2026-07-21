import { describe, it, expect } from 'vitest';
import { isDeathrattleBufferCard } from './deathrattleBuffers';

describe('isDeathrattleBufferCard', () => {
  it('true — onDeath buff-others', () => {
    expect(isDeathrattleBufferCard('sergeant')).toBe(true);  // onDeath deathrattleBuffAllHealth
    expect(isDeathrattleBufferCard('spore')).toBe(true);     // onDeath deathrattleBuffAll
    expect(isDeathrattleBufferCard('impking')).toBe(true);   // onDeath deathrattleSummon + deathrattleBuffImps
    expect(isDeathrattleBufferCard('trickster')).toBe(true); // onDeath deathrattleGiveHealth
    expect(isDeathrattleBufferCard('nanon')).toBe(true);     // onDeath deathrattleSummonOverflowBuff
    expect(isDeathrattleBufferCard('chefraag')).toBe(true);  // onDeath deathrattleBuffAllByImpAura + deathrattleBuffImps
  });
  it('false — Spear Warden (deathrattleBuffCardTypeRunWide) is deliberately excluded (future echo-aura)', () => {
    expect(isDeathrattleBufferCard('knit')).toBe(false);     // onDeath deathrattleBuffCardTypeRunWide — NOT descend
  });
  it('false — a Start-of-Combat buffer (living-source tendril, not onDeath)', () => {
    expect(isDeathrattleBufferCard('kennel')).toBe(false);   // startOfCombat scBeastAura; no onDeath buff
  });
  it('false — an onDeath that only SUMMONS (no buff)', () => {
    expect(isDeathrattleBufferCard('broodmother')).toBe(false); // onDeath deathrattleSummon only
    expect(isDeathrattleBufferCard('burialimp')).toBe(false);   // Echo now only summons an Imp (no buff)
  });
  it('false — an unknown card id', () => {
    expect(isDeathrattleBufferCard('no-such-card')).toBe(false);
  });
});
