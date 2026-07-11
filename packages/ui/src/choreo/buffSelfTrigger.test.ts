import { describe, it, expect } from 'vitest';
import { simulate, makeRng, type BoardMinion, type CombatEvent } from '@game/core';
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
    const r = simulate(p, e, makeRng(7), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, ['beast']);

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
});
