/**
 * R-VERSUS-LIVE-ARMOR-01 (owner 2026-10-27: "i casted mend to get armor but it didn't show to the other players";
 * "people seemed to die when they still had hp on my screen"), the client half:
 *  - `noteVersusEntering` keeps a match row's stored pools while they are the pools going into the round (shop /
 *    resolving), and keeps them through the commit so a view still on that fight shows them, not the result.
 *  - The group spectator's plates show what the watched screen shows (its rail, its Health box), never the seat rows that
 *    move the moment a round commits: no damage or knockout before the fight plays.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { versusGroupLobby, versusGroupPairings, type RunState, type VersusGroupSeat } from '@game/sim';
import { duosTeamArmorRaise, noteVersusEntering, resetVersusEntering, versusEnteringFor } from './versusEntering';
import { groupPlateVitals } from './spectatorPlates';
import type { VersusGroupMatchRaw } from './versusRemote';

afterEach(() => resetVersusEntering());

describe('the pools going into the round (R-VERSUS-LIVE-ARMOR-01)', () => {
  it('kept from shop / resolving rows only; a seat with no stored pool is left out; another match reads none', () => {
    noteVersusEntering('m1', 'hero_select', 0, { p1: { health: 30, armor: 5 } });
    expect(versusEnteringFor('m1')).toBeNull();
    noteVersusEntering('m1', 'shop', 2, { p1: { health: 22, armor: 5 }, p2: { health: null, armor: null } });
    expect(versusEnteringFor('m1')).toEqual({ round: 2, vitals: { p1: { health: 22, armor: 5 } } });
    // The commit's row (combat) already carries round 2's damage: the snapshot is kept, not replaced.
    noteVersusEntering('m1', 'combat', 2, { p1: { health: 14, armor: 0 } });
    expect(versusEnteringFor('m1')?.vitals.p1).toEqual({ health: 22, armor: 5 });
    expect(versusEnteringFor('m2')).toBeNull();
  });
});

describe('Duos: my teammate Mend is my Armor too (R-VERSUS-LIVE-ARMOR-01)', () => {
  const entering = { round: 3, vitals: { p1: { health: 22, armor: 5 }, p2: { health: 22, armor: 5 } } };
  const run = { mode: 'versus', phase: 'recruit', wave: 3, resolve: 22, armor: 0 };
  it('my run takes the team pool raise in this round shop, and only then', () => {
    expect(duosTeamArmorRaise(entering, 'p1', run)).toBe(5);
    expect(duosTeamArmorRaise(entering, 'p1', { ...run, armor: 5 })).toBeNull(); // already there
    expect(duosTeamArmorRaise(entering, 'p1', { ...run, phase: 'combat' })).toBeNull(); // the fight lands the resolver's pools
    expect(duosTeamArmorRaise(entering, 'p1', { ...run, wave: 4 })).toBeNull(); // a snapshot from another round
    expect(duosTeamArmorRaise(entering, 'p1', { ...run, resolve: 20 })).toBeNull(); // pools disagree: never guess
    expect(duosTeamArmorRaise({ round: 3, vitals: { p1: { health: 22, armor: 0 } } }, 'p1', { ...run, armor: 3 })).toBeNull(); // never lowers
  });
});

describe('the group spectator plates read the screen (R-VERSUS-LIVE-ARMOR-01)', () => {
  const seat = (s: VersusGroupSeat, health: number | null, armor: number | null, eliminatedRound: number | null = null) => ({
    seat: s, userId: `u-${s}`, name: s.toUpperCase(), health, armor, hero: 'warden', locked: false, ready: false, intro: true, auto: false,
    missed: 0, eliminatedRound, outReason: eliminatedRound != null ? 'hearts' as const : null, placement: eliminatedRound != null ? 4 : null,
  });
  // Round 2 just COMMITTED: p4 is out at 0, p2 took 8. The watched player (p1) is still watching that fight.
  const raw = { id: 'm', seats: [seat('p1', 30, 0), seat('p2', 14, 0), seat('p3', 30, 4), seat('p4', 0, 0, 2)], options: null } as unknown as VersusGroupMatchRaw;
  const seats = raw.seats.map((s) => ({ seat: s.seat, label: s.name, heroId: 'warden', eliminatedRound: s.eliminatedRound, placement: s.placement }));
  const r1 = { round: 1, vitals: { p1: { health: 30, armor: 0 }, p2: { health: 22, armor: 0 }, p3: { health: 30, armor: 4 }, p4: { health: 6, armor: 0 } }, fights: [] };
  const r2 = { round: 2, vitals: { p1: { health: 30, armor: 0 }, p2: { health: 14, armor: 0 }, p3: { health: 30, armor: 4 }, p4: { health: 0, armor: 0 } }, fights: [] };
  const lobby = versusGroupLobby({
    matchSeed: 1, me: 'p1', wave: 2, inCombat: true, combatSettled: false, seats, rounds: [r1, r2],
    pairing: versusGroupPairings(['p1', 'p2', 'p3', 'p4'], { p4: 2 }, 2),
  });
  const run = { mode: 'versus', wave: 2, phase: 'combat', combatSettled: false, resolve: 30, armor: 0, lobby } as unknown as RunState;
  const start = { health: 30, armor: 0 };

  it('mid-fight: the old Health, nobody out yet', () => {
    expect(groupPlateVitals(raw, 'p1', 'p2', run, start)).toEqual({ health: 22, armor: 0, out: false });
    expect(groupPlateVitals(raw, 'p1', 'p4', run, start)).toEqual({ health: 6, armor: 0, out: false });
  });

  it('the watched player out: only once their own fight has settled on screen', () => {
    const r = { ...raw, seats: raw.seats.map((s) => (s.seat === 'p1' ? { ...s, health: 0, eliminatedRound: 2 } : s)) } as VersusGroupMatchRaw;
    expect(groupPlateVitals(r, 'p1', 'p1', run, start).out).toBe(false);
    expect(groupPlateVitals(r, 'p1', 'p1', { ...run, combatSettled: true, resolve: 0 } as RunState, start)).toEqual({ health: 0, armor: 0, out: true });
  });

  it('no screen yet: the stored pools (the only source)', () => {
    expect(groupPlateVitals(raw, 'p1', 'p2', null, start)).toEqual({ health: 14, armor: 0, out: false });
    expect(groupPlateVitals(raw, 'p1', 'p4', null, start).out).toBe(true);
  });
});
