import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { compileMoments, DEFAULT_RULES } from './compile';
import { ownStrikeAt, strikeFollowsWindup } from './channels/rallyFired';
import { shoutsAheadOf } from './channels/shoutFired';

/**
 * ECHOHORN'S SWING: PARK ONLY WHEN THERE IS A BEAT TO SPAN (owner report 2026-09-16).
 *
 *   *"echohorn has attack bugs and its timing is off. it will hang in the pause state and then never actually
 *   complete the lunge attack because it misses its beat / happens immediately."*
 *
 * The park (`holdAfterWindup`) is a BEAT-SPANNING device: the swing freezes at the top of its wind-up, the
 * clock runs through the Echo's own beats, and the strike resumes on the attacker's damage beat. It was keyed
 * on "this swing force-triggered an Echo" — but most Echoes Echohorn forces (a Mammoth's three summons, a
 * T-Rex's baby, an Armadiyo's tribe buff) are ABSORBED into the attack moment, so the next beat is Echohorn's
 * own strike. Parking those advanced the clock straight into the damage beat while the body was still
 * frozen: numbers and health committed reared-back, and the strike replayed afterwards.
 *
 * Graded on SIMULATED fights so the ordering is the simulator's, not a hand-written log's.
 */

const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords } as unknown as BoardMinion);
const sandbag = (): BoardMinion => ({ cardId: 'sandbag', attack: 1, health: 9999 } as unknown as BoardMinion);

/** Echohorn on the right, the Echo it will force on the left; two tough enemies so it swings more than once. */
const fight = (echo: BoardMinion) => simulate([echo, bm('b2_echohorn', 'E', 4, 400, ['RL'])], [sandbag(), sandbag()], makeRng(3), CARD_INDEX,
  combatSide({ tier: 6 }), combatSide({ tier: 1 }));

/** Echohorn's first attack moment and its uid, from a fight's compiled moments. */
function echohornSwing(events: ReturnType<typeof fight>['events']) {
  const moments = compileMoments(events, DEFAULT_RULES);
  const atk = moments.find((m) => m.primary.type === 'attack' && events.slice(m.start, m.end).some((e) => e.type === 'rally'))!;
  expect(atk, 'Echohorn never rallied — re-check the fixture').toBeDefined();
  const uid = (atk.primary as { attacker: string }).attacker;
  return { moments, atk, uid };
}

describe('an absorbed forced Echo is NOT parked — its strike is the very next event', () => {
  it.each([
    ['Mammoth (summon three Beasts)', bm('b2_mammoth', 'M', 1, 400), 'summon'],
    ['T-Rex (summon one)', bm('b2_trex', 'T', 1, 400), 'summon'],
    ['Armadiyo (tribe buff)', bm('b2_armadiyo', 'A', 1, 400, ['T']), 'buff'],
  ])('%s', (_label, echo, consequence) => {
    const { events } = fight(echo);
    const { atk, uid } = echohornSwing(events);
    // The Echo really fired and really was absorbed into the attack moment (a fight where it fell out would
    // pass the park question vacuously).
    expect(events.slice(atk.start, atk.end).some((e) => e.type === consequence), `the ${consequence} left the wind-up`).toBe(true);
    expect(strikeFollowsWindup(atk, events, uid)).toBe(true);
    expect(shoutsAheadOf(atk, events, uid)).toBe(false);
  });
});

describe('a forced Echo with beats of its own still parks', () => {
  it('Fel Spikes: the spray is a wave beat between the wind-up and the strike', () => {
    const { events } = fight(bm('dm_felspikes', 'S', 1, 400));
    const { atk, uid } = echohornSwing(events);
    expect(events[atk.end]?.wave, 'the spray is not a wave beat any more — the park has nothing to span').toBeDefined();
    expect(strikeFollowsWindup(atk, events, uid)).toBe(false);
  });

  it('a swing whose target died in the wind-up (no strike at all) is left to the park’s targetGone release', () => {
    const events = [
      { type: 'attack', attacker: 'E', defender: 'x' },
      { type: 'rally', source: 'E', target: 'S' },
      { type: 'death', target: 'x' },
    ] as unknown as ReturnType<typeof fight>['events'];
    const atk = compileMoments(events, DEFAULT_RULES)[0]!;
    expect(strikeFollowsWindup(atk, events, 'E')).toBe(false);
  });
});

/**
 * A WARDED STRIKE STILL LANDS (the freeze half of the report). Echohorn parked for its Echo, its blow absorbed
 * by the defender's Ward: the simulator logs a `shield` on the defender and NO `dmg` from Echohorn, and the
 * release used to wait for that `dmg` alone — so the park was never released and the card stood reared-back
 * for the rest of the fight.
 */
describe('ownStrikeAt — the blow a parked swing waits for', () => {
  const ev = (o: Record<string, unknown>) => o as unknown as CombatEvent;
  it('its own non-wave damage', () => {
    const events = [ev({ type: 'attack', attacker: 'E', defender: 'x' }), ev({ type: 'dmg', source: 'E', target: 'x' })];
    expect(ownStrikeAt(events, 1, 'E', 'x')).toBe(true);
    expect(ownStrikeAt([events[0]!, ev({ type: 'dmg', source: 'E', target: 'x', wave: 1 })], 1, 'E', 'x'), 'a wave volley is not a strike').toBe(false);
  });

  it('a Ward on ITS defender absorbing the blow — with no dmg logged at all (the real Orin fight)', () => {
    const events = [
      ev({ type: 'attack', attacker: 'E', defender: 'x' }), ev({ type: 'rally', source: 'E', target: 'M' }),
      ev({ type: 'summon', minion: { uid: 't1' } }), ev({ type: 'shield', target: 'x' }), ev({ type: 'dmg', source: 'x', target: 'E' }),
    ];
    expect(ownStrikeAt(events, 3, 'E', 'x')).toBe(true);
    expect(ownStrikeAt(events, 4, 'E', 'x'), 'the retaliation is not its strike').toBe(false);
    expect(ownStrikeAt(events, 3, 'E', 'y'), 'a Ward on someone else is not its strike').toBe(false);
  });

  it('a summoned charger’s absorbed blow on the SAME defender is the charger’s, not the parked attacker’s', () => {
    const events = [
      ev({ type: 'attack', attacker: 'E', defender: 'x' }), ev({ type: 'rally', source: 'E', target: 'M' }),
      ev({ type: 'attack', attacker: 'C', defender: 'x' }), ev({ type: 'shield', target: 'x' }),
      ev({ type: 'dmg', source: 'E', target: 'x' }),
    ];
    expect(ownStrikeAt(events, 3, 'E', 'x')).toBe(false);
    expect(ownStrikeAt(events, 4, 'E', 'x')).toBe(true);
  });

  it('a charger aimed ELSEWHERE does not steal the parked attacker’s Ward absorb', () => {
    const events = [
      ev({ type: 'attack', attacker: 'E', defender: 'x' }), ev({ type: 'attack', attacker: 'C', defender: 'y' }),
      ev({ type: 'dmg', source: 'C', target: 'y' }), ev({ type: 'shield', target: 'x' }),
    ];
    expect(ownStrikeAt(events, 3, 'E', 'x')).toBe(true);
  });
});

/** The link between this file and the hook: the replay must consult the switch, and not park when it says so. */
describe('useCombatReplay wires the switch', () => {
  const REPLAY = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'useCombatReplay.ts'), 'utf8');
  it('turns the park off for an absorbed forced Echo and gives the wind-up the parked swing’s stillness instead', () => {
    expect(REPLAY.includes('if (heldWindup && strikeFollowsWindup(cur, events, atkUid)) { heldWindup = false; absorbedEcho = true; }')).toBe(true);
    expect(REPLAY.includes('windupSettleMs: absorbedEcho ? PARKED_COMMIT_LEAD_MS : 0')).toBe(true);
  });
});
