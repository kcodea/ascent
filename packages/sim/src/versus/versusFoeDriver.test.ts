/**
 * THE VERSUS OPPONENT SEAT'S DRIVER is never served stale (owner report 2026-10-18: spectating a Versus match where both
 * players picked the same hero, "opponent info isnt showing in combat"; R-SPECTATE-SAMEHERO-01).
 *
 * The two-seat display lobby's opponent is an `authored` seat whose boards GROW one per committed round. Seat drivers are
 * cached by a key; an authored key used to be only kind + seed + hero, so a driver built from an EARLIER lobby (round 1,
 * no boards yet) answered every later round with no board, and `playerOpponent` returned nothing: no portrait, no Health.
 * The player's own client evicts on every rebuild; a spectator renders the lobby the player sends and never did, so only
 * a change of the key (the opponent's hero being revealed) ever rebuilt it, which two players on the same hero never get.
 */
import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';
import { describe, expect, it } from 'vitest';
import { playerOpponent, resetLobbyDrivers } from '../lobby/runLobby';
import { versusLobby, type VersusLobbyInput } from './lobbyView';

const BODY = Object.keys(CARD_INDEX).find((id) => !CARD_INDEX[id]!.spell && !CARD_INDEX[id]!.token)!;
const fight = (enemyAttack: number): CombatResult => ({
  events: [], result: 'win', playerDamage: 0,
  initial: { player: [], enemy: [{ uid: 'e1', cardId: BODY, attack: enemyAttack, health: 9, keywords: [], golden: false }] },
} as unknown as CombatResult);

const input = (seat: 'p1' | 'p2', wave: number, rounds: number, foeAttack: number): VersusLobbyInput => ({
  matchSeed: 77, setId: 'set2', seat, wave, inCombat: true, combatSettled: false,
  me: { label: seat === 'p1' ? 'Rooks' : 'LEMON', heroId: 'warden' },
  foe: { label: seat === 'p1' ? 'LEMON' : 'Rooks', heroId: 'warden' },
  rounds: Array.from({ length: rounds }, (_, i) => ({ round: i + 1, heartLostBy: null, mine: fight(foeAttack) })),
});

describe('R-SPECTATE-SAMEHERO-01: the opponent seat is read from the lobby on screen', () => {
  it('a lobby that grows a round never reuses the driver built before it had a board', () => {
    const empty = versusLobby({ ...input('p1', 1, 0, 3), inCombat: false });
    resetLobbyDrivers(empty.seats);
    expect(playerOpponent(empty)).toBeNull(); // round 1 shop: nothing fought yet (and a driver is cached)
    const later = versusLobby(input('p1', 2, 2, 3)); // a spectator's next lobby: NO reset in between
    const foe = playerOpponent(later);
    expect(foe?.seat.id).toBe('s1');
    expect(foe?.board.minions.map((m) => m.attack)).toEqual([3]);
  });

  it('the same hero on both seats: each side faces its own opponent, read in turn without a reset', () => {
    const p1 = versusLobby(input('p1', 2, 2, 4)); // p1 faces LEMON's board (Attack 4)
    const p2 = versusLobby(input('p2', 2, 2, 6)); // p2 faces Rooks's board (Attack 6)
    resetLobbyDrivers(p1.seats);
    expect(playerOpponent(p1)?.board.minions.map((m) => m.attack)).toEqual([4]);
    expect(playerOpponent(p2)?.board.minions.map((m) => m.attack)).toEqual([6]);
    expect(playerOpponent(p2)?.seat.label).toBe('Rooks');
  });
});
