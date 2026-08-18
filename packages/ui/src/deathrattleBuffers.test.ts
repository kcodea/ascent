import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { DEATHRATTLE_BUFF_FACTORIES, isDeathrattleBufferCard } from './deathrattleBuffers';

describe('isDeathrattleBufferCard', () => {
  it('true — onDeath buff-others', () => {
    expect(isDeathrattleBufferCard('sergeant')).toBe(true);  // onDeath deathrattleBuffAllHealth
    expect(isDeathrattleBufferCard('spore')).toBe(true);     // onDeath deathrattleBuffAll
    expect(isDeathrattleBufferCard('impking')).toBe(true);   // onDeath deathrattleSummon + deathrattleBuffImps
    expect(isDeathrattleBufferCard('trickster')).toBe(true); // onDeath deathrattleGiveHealth
    expect(isDeathrattleBufferCard('nanon')).toBe(true);     // onDeath deathrattleSummonOverflowBuff
    expect(isDeathrattleBufferCard('chefraag')).toBe(true);  // onDeath deathrattleBuffAllByImpAura + deathrattleBuffImps
  });
  it('true — set 2 Ruby / Ward Echoes (owner report 2026-07-26: no combat cue at all)', () => {
    // These buff OTHERS as they die, so by strike time their source element is gone. A living-source cast whose
    // element can't be found is DROPPED, not downgraded — so being absent from the descend list meant no
    // animation whatsoever, which is exactly what the owner saw.
    expect(isDeathrattleBufferCard('k_geode')).toBe(true);       // onDeath deathrattleSummonGolemsWithRuby (2026-07-31 rework)
    expect(isDeathrattleBufferCard('n2_lastlight')).toBe(true);  // onDeath deathrattleGrantWardRandom
  });

  it('every onDeath factory that GRANTS STATS to others is on the list (the "KEEP IN SYNC" note, enforced)', () => {
    // Targeted at the real failure class rather than every onDeath factory: names that hand out stats. An
    // onDeath that damages, destroys, grants a keyword, summons or pays Gold emits no buff-other event and
    // needs no descend. Set 2 added two stat-granting Echoes and nobody updated the list — this is what
    // would have caught that on the day.
    const GRANTS_STATS = /Buff|PlayRubies|GiveHealth/;
    const EXCLUDED: Record<string, string> = {
      // Spear Warden — the owner wants it reframed as an "echo-aura", kept out until that design lands.
      deathrattleBuffCardTypeRunWide: 'run-wide enchant, emits no combat buff-other',
      // Right Hand Hank — buffs the next SHOP (a carry-back), not a live board minion, so no combat cue.
      deathrattleBuffRightmostSlot: 'carry-back shop-slot buff, emits no combat buff-other',
      // Malphas (Echo half) — buffs the next SHOP (a tavern-buy carry-back), not a live board minion.
      deathrattleBuffShopPermanent: 'carry-back shop buff, emits no combat buff-other',
      // Wolvie — queues a buff for a FUTURE summon; nothing on the board gains stats at death time.
      deathrattleBuffNextSummon: 'buffs the next summon (deferred), not a live board minion at death',
    };
    const onDeath = new Set<string>();
    for (const def of Object.values(CARD_INDEX)) {
      for (const e of def.effects ?? []) if (e.on === 'onDeath') onDeath.add(e.do);
    }
    const missing = [...onDeath].filter(
      (f) => GRANTS_STATS.test(f) && !EXCLUDED[f] && !DEATHRATTLE_BUFF_FACTORIES.has(f),
    );
    expect(missing, 'stat-granting onDeath factories missing from the descend list').toEqual([]);
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
