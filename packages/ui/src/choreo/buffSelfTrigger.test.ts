import { describe, it, expect } from 'vitest';
import { simulate, combatSide, makeRng, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { groupSelfBuffs } from './channels/buffSelf';

/**
 * Evidence test (buff-pulse): a REAL combat self-buff must reach the pulse path — i.e. land in a `buffWave`
 * moment that `groupSelfBuffs` picks up. Target Dummy (`sandbag`) gains +1 Attack every time it takes damage
 * (`onDamaged` → `onDamagedGainAttack` → `ctx.buff(self, +1, 0, self.uid)`), a proper self-buff (source === target).
 */
describe('buff-pulse trigger path (real combat)', () => {
  it('a Target Dummy on-damaged self-buff lands in a buffWave moment groupSelfBuffs picks up', () => {
    const p: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 30 }]; // tanky dummy: survives + gets hit
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 30 }]; // an attacker that trades blows
    const r = simulate(p, e, makeRng(7), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'] }));

    // There is at least one self-buff (source === target) in the log — the dummy pumping its own Attack.
    const selfBuffEvents = r.events.filter((ev: CombatEvent) => ev.type === 'buff' && ev.source === ev.target);
    expect(selfBuffEvents.length).toBeGreaterThan(0);

    // Compile to moments and collect every self-buff the pulse channel would fire on, across all moments.
    const moments = compileMoments(r.events);
    const firedUids = moments.flatMap((m) => groupSelfBuffs(m, r.events)).map((s) => s.uid);

    // EVERY self-buff event's target is surfaced by groupSelfBuffs on SOME moment (none silently absorbed).
    for (const ev of selfBuffEvents) {
      if (ev.type !== 'buff') continue;
      expect(firedUids).toContain(ev.target);
    }

    // And at least one of those moments is actually kind 'buffWave' (the only kind carrying the buffSelf cue).
    const buffWaveWithSelf = moments.some((m) => m.kind === 'buffWave' && groupSelfBuffs(m, r.events).length > 0);
    expect(buffWaveWithSelf).toBe(true);
  });

  it('an on-attack self-buffer (Trophy Stalker) surfaces its self-buff on the attackExchange moment', () => {
    // Trophy Stalker's Rally buffs Beasts INCLUDING itself on its own attack → a self-buff (source === target)
    // emitted mid-swing, which `absorbIntoWindup` folds into the attackExchange (NOT a standalone buffWave). The
    // wind-up FX path calls `groupSelfBuffs` on that attack moment to fire the in-place pulse — this guards that
    // data path. (Was Solaris Fang until its Rally half was cut in the 2026-07-21 balance pass.)
    const p: BoardMinion[] = [{ cardId: 'trophystalker', attack: 5, health: 20 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 20 }]; // 0-atk bag: Trophy Stalker keeps swinging
    const r = simulate(p, e, makeRng(3), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'] }));

    const selfBuffs = r.events.filter((ev: CombatEvent) => ev.type === 'buff' && ev.source === ev.target);
    expect(selfBuffs.length).toBeGreaterThan(0);
    const selfTargets = new Set(selfBuffs.map((ev) => (ev.type === 'buff' ? ev.target : '')));

    const moments = compileMoments(r.events);
    const inAttackMoment = moments.some(
      (m) => m.kind === 'attackExchange' && groupSelfBuffs(m, r.events).some((s) => selfTargets.has(s.uid)),
    );
    expect(inAttackMoment).toBe(true);
  });
});
