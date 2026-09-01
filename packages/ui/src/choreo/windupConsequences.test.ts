import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { compileMoments, DEFAULT_RULES } from './compile';

/**
 * A SWING'S CONSEQUENCES BELONG TO ITS WIND-UP (owner ask 2026-09-01).
 *
 *   *"the flame beat winds up and attacks, and completes the lunge, no damage is dealt or taken, and all the
 *   animations trigger. once they finish, damage is dealt and stats reconcile. this is half correct, but we
 *   need all of the animations and stats to reconcile while the flamebeat is paused in his pre-attack
 *   animation, like echohorn does. we need this to be the case for all cases where buffs are applying or
 *   animations are firing from an attack."*
 *
 * Two halves make that true, and this file pins the one that can be executed here.
 *
 *  1. GROUPING (`compileMoments`): everything the swing caused must land in the attack's OWN moment. The
 *     absorb loop used to stop at a mid-combat `sc`, which orphaned a cast AND every buff behind it into
 *     post-lunge beats — that is the symptom above, and it is measurable on a real fight's event log.
 *  2. THE PARK (`useCombatReplay`): a wind-up moment wider than the `attack` event itself holds the lunge at
 *     the top of its pose until those consequences resolve. That lives in a React hook driving GSAP and
 *     cannot run here; what CAN be checked is that its signal is still derived from the moment's width, which
 *     is the link between the two halves.
 *
 * Grading on a SIMULATED fight rather than a hand-written log on purpose: the ordering this depends on
 * (attack → rally → cast → buffs → damage) is the simulator's, and a hand-written log would keep passing if
 * the sim ever emitted them in a different order.
 */

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);

/** Flamebeat Drake's Rally casts Dragonflame; it swings with `RL`, so its own attack is the Rally. */
const flamebeatFight = () => simulate(
  [bm('d2_flamebeat', 'F', 4, 400, ['RL']), bm('d2_ashscribe', 'D', 0, 400)],
  [{ cardId: 'sandbag', attack: 0, health: 9999 } as unknown as BoardMinion], makeRng(5), CARD_INDEX,
  combatSide({ tier: 6 }), combatSide({ tier: 1 }));

describe('an on-attack cast resolves inside the wind-up, not after the lunge', () => {
  it('the fixture actually casts (a fight that never cast would pass vacuously)', () => {
    const casts = flamebeatFight().events.filter((e) => e.type === 'sc' && e.spellId === 'sp_dragonflame');
    expect(casts.length, 'Flamebeat Drake never cast Dragonflame — re-check the fixture').toBeGreaterThan(0);
  });

  it('the cast and its buffs land in the attacker’s OWN moment', () => {
    const { events } = flamebeatFight();
    const moments = compileMoments(events, DEFAULT_RULES);
    const castIdx = events.findIndex((e) => e.type === 'sc' && e.spellId === 'sp_dragonflame');
    const owner = moments.find((m) => castIdx >= m.start && castIdx < m.end)!;
    expect(owner.primary.type, 'the cast is its own beat again — it fell out of the wind-up').toBe('attack');

    // …and so does EVERY buff that cast produced. This is the half that actually broke: the sim emits the
    // cast's counter, then its buffs, then its narration, and any one of those falling out of the absorb loop
    // strands the rest behind it. The buffs are identified by the spell that caused them, not by position, so
    // the assertion survives the sim reordering them.
    // The Drake swings more than once in this fight, so this is asserted as an INVARIANT over the whole log
    // rather than against one moment: no buff Dragonflame caused may live anywhere but inside an attack's
    // wind-up. Any one of them landing in its own beat is the bug.
    const caused = events
      .map((e, i) => [e, i] as const)
      .filter(([e]) => e.type === 'buff' && (e as { spellId?: string }).spellId === 'sp_dragonflame');
    expect(caused.length, 'the cast granted nothing to group').toBeGreaterThan(0);
    for (const [, i] of caused) {
      const home = moments.find((m) => i >= m.start && i < m.end)!;
      expect(home.primary.type, `a buff the swing caused landed in a ${home.primary.type} beat of its own`).toBe('attack');
    }
  });

  it('the damage still lands AFTER the wind-up — the swing is not collapsed into one beat', () => {
    // The fix must not go the other way: the attacker's own hit is the resume, so it has to stay a later beat.
    const { events } = flamebeatFight();
    const moments = compileMoments(events, DEFAULT_RULES);
    const attackMoment = moments.find((m) => m.primary.type === 'attack')!;
    for (let i = attackMoment.start; i < attackMoment.end; i++) {
      expect(events[i]!.type, 'damage was absorbed into the wind-up').not.toBe('dmg');
    }
  });
});

describe('the park signal stays tied to the moment’s width', () => {
  /** The hook cannot run here; its decision line can still be read. */
  const REPLAY = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../useCombatReplay.ts'), 'utf8');

  it('any swing that absorbed something holds its pose', () => {
    // `cur.end > cur.start + 1` IS the rule: a plain swing absorbs nothing and is one event wide, so it is
    // untouched; a swing with consequences of any kind parks. Narrowing this back to a rally-only test is the
    // regression — it is what left Flamebeat Drake lunging before its own cast had played.
    expect(
      /let heldWindup = cur\.end > cur\.start \+ 1;/.test(REPLAY),
      'the park is no longer derived from the wind-up moment carrying consequences',
    ).toBe(true);
  });

  it('and the forced-Echo scan survives as a SEPARATE reason', () => {
    // A forced Echo can resolve into events that are NOT absorbed (a Fel Spikes spray's `dmg`, a Dawnclaw
    // Battlecry replay), so its moment can be one event wide and still need the park. Folding the two together
    // would silently drop that case.
    expect(/if \(!heldWindup && rallies\)/.test(REPLAY), 'the rally scan must remain as a second reason').toBe(true);
  });
});
