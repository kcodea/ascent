/**
 * VERSUS GROUP's display lobby (owner 2026-10-24, R-VERSUS-GROUP-03): the ranked rail's seats for a 3-4 player match,
 * Health and Armor on the seats (R-VERSUS-HEALTH-01), the Copy row with who is copied this round, and the player's opponent pinned to the server's
 * round-robin pairing (`forcedOpponent` -> `playerOpponent`).
 */
import { describe, expect, it } from 'vitest';
import type { CombatResult } from '@game/core';
import { lobbyRailView } from '../lobby/railView';
import { playerOpponent, resetLobbyDrivers } from '../lobby/runLobby';
import { getHero } from '../heroes';
import { roundLossCap } from '../reducer';
import { versusGroupPairings, type VersusGroupSeat } from './group';
import { versusGroupLobby, VERSUS_COPY_SEAT_ID, type VersusGroupLobbyInput, type VersusGroupLobbyRound } from './groupLobbyView';

const minion = (cardId: string, attack: number, health: number) => ({ uid: `${cardId}${attack}`, cardId, attack, health, keywords: [] }) as unknown as CombatResult['initial']['player'][number];
const fightResult = (mine: string, theirs: string, result: 'win' | 'lose' | 'draw'): CombatResult =>
  ({ initial: { player: [minion(mine, 2, 2)], enemy: [minion(theirs, 3, 3)] }, result, events: [], playerDamage: 0 }) as unknown as CombatResult;

const SEATS = (n: 3 | 4) => (['p1', 'p2', 'p3', 'p4'] as VersusGroupSeat[]).slice(0, n).map((seat) => ({ seat, label: seat.toUpperCase(), heroId: 'warden', eliminatedRound: null, placement: null }));

function input(n: 3 | 4, me: VersusGroupSeat, wave: number, rounds: VersusGroupLobbyRound[], elim: Partial<Record<VersusGroupSeat, number>> = {}): VersusGroupLobbyInput {
  const seats = SEATS(n).map((s) => ({ ...s, eliminatedRound: elim[s.seat] ?? null, placement: elim[s.seat] != null ? n : null }));
  return {
    matchSeed: 9, me, wave, inCombat: false, combatSettled: false, seats, rounds,
    pairing: versusGroupPairings(seats.map((s) => s.seat), elim, wave),
  };
}

describe('Versus Group display lobby (R-VERSUS-GROUP-03)', () => {
  it('4 players: four rail rows on their hero Health + Armor, me first, my opponent is the server pairing; the lobby cap', () => {
    const lobby = versusGroupLobby(input(4, 'p3', 1, []));
    resetLobbyDrivers(lobby.seats);
    expect(lobby.seats.map((s) => s.label)).toEqual(['P3', 'P1', 'P2', 'P4']);
    const w = getHero('warden');
    expect(lobby.seats.every((s) => s.resolve === w.resolve && s.armor === w.armor && s.startArmor === w.armor)).toBe(true);
    // The rail's MAX DMG is the lobby's own table (no Versus override).
    expect(lobby.rules.lossCaps).toBeUndefined();
    expect(lobbyRailView(lobby).lossCap).toBe(roundLossCap(undefined, 1));
    // Summit: +10 Armor on every seat (R-VERSUS-SUMMIT-01).
    const summit = versusGroupLobby({ ...input(4, 'p3', 1, []), options: { v: 1, mode: 'group', modifiers: ['summit'] } });
    expect(summit.seats.every((s) => s.armor === w.armor + 10)).toBe(true);
    // Round 1: p1-p2, p3-p4: I (p3) face p4.
    expect(playerOpponent(lobby)?.seat.label).toBe('P4');
    const rail = lobbyRailView(lobby);
    expect(rail.rows.find((r) => r.next)?.id).toBe(lobby.seats.find((s) => s.label === 'P4')!.id);
  });

  it('3 players: a Copy row names who is copied this round, and is my opponent when I face it', () => {
    // Round 1 of three: p1-p2, p3 vs a Copy of p1.
    const lobby = versusGroupLobby(input(3, 'p3', 1, []));
    resetLobbyDrivers(lobby.seats);
    const copy = lobby.seats.find((s) => s.id === VERSUS_COPY_SEAT_ID)!;
    expect(copy.label).toBe('Copy of P1');
    expect(lobby.seats).toHaveLength(4);
    expect(playerOpponent(lobby)?.seat.id).toBe(VERSUS_COPY_SEAT_ID);
    // p1's view of the same round: they fight p2; the Copy row is still there (it changes with the round).
    const theirs = versusGroupLobby(input(3, 'p1', 1, []));
    resetLobbyDrivers(theirs.seats);
    expect(playerOpponent(theirs)?.seat.label).toBe('P2');
    // Round 2: the copy is of p3 (A-C, B vs copy of C).
    expect(versusGroupLobby(input(3, 'p1', 2, [])).seats.find((s) => s.id === VERSUS_COPY_SEAT_ID)!.label).toBe('Copy of P3');
  });

  it('pools and boards come from the committed rounds; a seat out shows dead with its placement from the next round', () => {
    const r1: VersusGroupLobbyRound = {
      round: 1, vitals: { p1: { health: 30, armor: 10 }, p2: { health: 30, armor: 5 }, p3: { health: 30, armor: 10 }, p4: { health: 0, armor: 0 } },
      fights: [
        { a: 'p1', b: 'p2', copy: false, loser: 'p2', damage: 5, aResult: fightResult('a1', 'b1', 'win') },
        { a: 'p3', b: 'p4', copy: false, loser: 'p4', damage: 5, aResult: fightResult('c1', 'd1', 'win') },
      ],
    };
    const lobby = versusGroupLobby(input(4, 'p1', 2, [r1], { p4: 1 }));
    resetLobbyDrivers(lobby.seats);
    const p2 = lobby.seats.find((s) => s.label === 'P2')!;
    const p4 = lobby.seats.find((s) => s.label === 'P4')!;
    expect([p2.resolve, p2.armor]).toEqual([30, 5]);
    expect(lobby.encounters.find((e) => e.b === p2.id)?.damageToB).toBe(5);
    expect(p2.authoredBoards?.[0]?.map((m) => m.cardId)).toEqual(['b1']);
    expect([p4.alive, p4.placement]).toEqual([false, 4]);
    // Three left: a Copy row for round 2, and nobody is paired with the seat that is out.
    expect(lobby.seats.some((s) => s.id === VERSUS_COPY_SEAT_ID)).toBe(true);
    expect(playerOpponent(lobby)?.seat.label).not.toBe('P4');
    expect(lobby.encounters).toHaveLength(2);
  });
});
