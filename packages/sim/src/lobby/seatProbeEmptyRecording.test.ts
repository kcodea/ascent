import { describe, it, expect, vi } from 'vitest';
import type { CombatResult } from '@game/core';
import { createRunLobby, driverFor, lastPlayerEncounter, pairRunLobby, playerOpponent, resetLobbyDrivers, settleRunLobbyRound, type RunLobby } from './runLobby';
import { hybridSeat } from './seats';

// An EMPTY recording for one hero: the Mimic failure shape (bug 2026-09-28), pinned to a hero the live bot CAN
// play, so these tests prove seat selection checks the RECORDING rather than trusting the live bot. Every other
// hero autoplays normally.
const EMPTY_HERO = 'warden';
vi.mock('../snapshot', async (importOriginal) => {
  const real = await importOriginal<typeof import('../snapshot')>();
  return {
    ...real,
    autoplayRun: (...args: Parameters<typeof real.autoplayRun>) => (args[1] === 'warden' ? [] : real.autoplayRun(...args)),
  };
});

const lost = (playerDamage: number): CombatResult =>
  ({ result: 'lose', playerDamage, enemyDamage: 0, events: [], initial: undefined } as unknown as CombatResult);

describe('seat selection rejects a hero whose recording is empty', () => {
  it('the hybrid probe says no even though the live bot can play the hero', () => {
    expect(hybridSeat(5, EMPTY_HERO).canFieldBoard?.()).toBe(false);
    expect(hybridSeat(5, 'indy').canFieldBoard?.()).toBe(true);
  });

  it('createRunLobby never seats it, and every seat it does seat fields a board', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const lobby = createRunLobby(seed, 'indy', {}, 'set1');
      expect(lobby.seats.some((s) => s.heroId === EMPTY_HERO), `seed ${seed} seated the empty hero`).toBe(false);
      expect(lobby.seats).toHaveLength(8);
      for (const s of lobby.seats.slice(1)) expect(driverFor(s, lobby.setId)?.prepare(1), `seed ${seed} ${s.heroId}`).not.toBeNull();
    }
  });
});

/**
 * The FALLBACK: a seat that still ends up boardless (a restored lobby, an older save) is paired with the player.
 * The player must fight a real lobby board, and the log must name THAT board, never the empty seat.
 */
describe('the player paired with a boardless seat', () => {
  /** A lobby at round 4 where the player's paired foe has been swapped onto the empty-recording hero. */
  const scenario = (withGhost: boolean, playerHp = 45): { lobby: RunLobby; foeId: string; ghostId?: string } => {
    for (let seed = 1; seed < 200; seed++) {
      const base = createRunLobby(seed, 'indy', {}, 'set1');
      const lobby: RunLobby = { ...base, round: 4, seats: base.seats.map((s) => ({ ...s })), encounters: [] };
      // Health BEFORE pairing: standings decide who may hold the bye, so setting it later reshuffles the round.
      // Everyone else sits lower still, so the player is never in the bottom three that may hold the bye.
      lobby.seats.forEach((x, i) => { x.armor = 0; x.resolve = i === 0 ? playerHp : 2; });
      let ghostId: string | undefined;
      if (withGhost) {
        const g = lobby.seats[7]!;
        g.alive = false; g.resolve = 0; g.armor = 0; g.eliminatedRound = 2; g.placement = 8;
        ghostId = g.id;
      }
      const { pairs } = pairRunLobby(lobby);
      const pair = pairs.find(([a, b]) => a.id === 's0' || b.id === 's0');
      if (!pair) continue; // the player holds the bye this seed
      const foe = pair[0].id === 's0' ? pair[1] : pair[0];
      resetLobbyDrivers([foe]);
      foe.heroId = EMPTY_HERO; // the driver is keyed by hero, so this rebuilds it on the empty recording
      foe.kind = 'hybrid';
      expect(driverFor(foe, lobby.setId)?.prepare(4)).toBeNull();
      return { lobby, foeId: foe.id, ghostId };
    }
    throw new Error('no seed paired the player');
  };

  it('with a ghost available: the player fights the ghost, and the log names the ghost, not the empty seat', () => {
    const { lobby, foeId, ghostId } = scenario(true, 3); // 3 HP: this loss (capped at round 4, still >= 3) knocks the player out
    const next = playerOpponent(lobby);
    expect(next?.seat.id, 'the fight is served from the ghost').toBe(ghostId);
    expect(next?.ghost).toBe(true);

    const foeBefore = lobby.seats.find((s) => s.id === foeId)!;
    const foeHp = foeBefore.resolve + foeBefore.armor;
    const settled = settleRunLobbyRound(lobby, lost(9));
    const mine = settled.encounters.filter((e) => e.round === 4 && (e.a === 's0' || e.b === 's0'));
    const fought = mine.filter((e) => e.fought);
    expect(fought).toHaveLength(1);
    expect(fought[0]).toMatchObject({ a: 's0', b: ghostId, bye: 's0', standInFor: foeId, damageToB: 0 });
    // The empty seat sat the round out: not charged, not credited.
    expect(mine.find((e) => !e.fought)).toMatchObject({ damageToA: 0, damageToB: 0, outcome: 'draw' });
    const foeAfter = settled.seats.find((s) => s.id === foeId)!;
    expect(foeAfter.resolve + foeAfter.armor).toBe(foeHp);
    // The player is out, and "who knocked you out" (the fought encounter's other seat) is the ghost.
    expect(settled.seats[0]!.alive).toBe(false);
    expect(lastPlayerEncounter({ ...settled, round: 5 })?.foe.id).toBe(ghostId);
    expect(settled.encounters.some((e) => e.fought && [e.a, e.b].includes('s0') && [e.a, e.b].includes(foeId))).toBe(false);
  });

  it('before anyone has fallen: a sit-out for both, and nobody is charged or credited for it', () => {
    const { lobby, foeId } = scenario(false);
    expect(playerOpponent(lobby)).toBeNull();
    const before = lobby.seats[0]!.resolve + lobby.seats[0]!.armor;
    const settled = settleRunLobbyRound(lobby, lost(9));
    const mine = settled.encounters.filter((e) => e.round === 4 && (e.a === 's0' || e.b === 's0'));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ fought: false, damageToA: 0, damageToB: 0 });
    expect([mine[0]!.a, mine[0]!.b]).toContain(foeId);
    expect(settled.seats[0]!.resolve + settled.seats[0]!.armor).toBe(before);
  });
});
