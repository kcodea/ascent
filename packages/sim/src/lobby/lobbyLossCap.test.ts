import { describe, it, expect } from 'vitest';
import type { CombatResult } from '@game/core';
import { roundLossCap } from '../reducer';
import { createRunLobby, settleRunLobbyRound, type RunLobby } from './runLobby';
import { createPracticeBotLobby } from './practiceBots';

/**
 * THE LOSS CAP HOLDS FOR EVERY SEAT, EVERY ROUND (owner report 2026-10-02, from a Scene Builder game: "im seeing
 * someone that took -30 on turn 7 ... can you confirm nothing is busted about our lobby rules and they follow
 * the same dmg taken system").
 *
 * Investigated: a real lobby caps every path (the player's fight, seat-vs-seat, the ghost stand-in, the bye
 * ghost) with `roundLossCap(rules, round)`, Armor first, and the rail / scout DMG readouts show what was charged.
 * The -30 was a bot-vs-bot fight in a PRACTICE-BOTS table (Scene Builder runs one): those fights are x5 and
 * uncapped on purpose (#1199, owner ask 2026-08-25, so bot games don't drag). This file pins both halves.
 */

/** The player LOSES every round, by a rout far above any cap, and deals the same back: both sides must clip. */
const rout = { result: 'lose', playerDamage: 99, enemyDamage: 99, events: [], initial: undefined } as unknown as CombatResult;

const total = (l: RunLobby) => new Map(l.seats.map((s) => [s.id, s.resolve + s.armor]));

/** Settle up to `rounds` rounds; per round, hand back each seat's HP drop and its recorded `taken`. */
function play(lobby: RunLobby, rounds: number, check: (round: number, id: string, drop: number, recorded: number, cap: number) => void): number {
  let fought = 0;
  for (let i = 0; i < rounds && !lobby.finished; i++) {
    const round = lobby.round;
    const cap = roundLossCap(lobby.rules, round);
    const before = total(lobby);
    settleRunLobbyRound(lobby, rout);
    const after = total(lobby);
    const recorded = new Map<string, number>();
    for (const e of lobby.encounters) {
      if (e.round !== round || !e.fought) continue;
      fought++;
      recorded.set(e.a, (recorded.get(e.a) ?? 0) + e.damageToA);
      if (e.b !== e.a) recorded.set(e.b, (recorded.get(e.b) ?? 0) + e.damageToB);
    }
    for (const [id, hp] of before) check(round, id, hp - after.get(id)!, recorded.get(id) ?? 0, cap);
  }
  return fought;
}

describe('lobby loss cap: every seat, every round', () => {
  it('a real 8-seat lobby never charges any seat more than roundLossCap in a round, and the readout is the charge', () => {
    for (const seed of [11, 4242, 90210]) {
      const lobby = createRunLobby(seed, 'warden', {}, 'set1');
      expect(lobby.seats).toHaveLength(8);
      const fought = play(lobby, 16, (round, id, drop, recorded, cap) => {
        expect(drop, `seed ${seed} round ${round} ${id}: lost ${drop}, cap ${cap}`).toBeLessThanOrEqual(cap);
        expect(drop, `seed ${seed} round ${round} ${id}: HP drop and recorded DMG disagree`).toBe(recorded);
      });
      expect(fought, 'no seat fights resolved, so the cap was never exercised').toBeGreaterThan(0);
    }
  });

  it("a lobby's own lossCaps table (the Gauntlet's mechanism) is the cap every seat is held to", () => {
    const caps = [1, 2, 3, 4, 5, 6, 7, 8];
    const lobby = createRunLobby(777, 'warden', { lossCaps: caps }, 'set1');
    play(lobby, 8, (round, id, drop, recorded) => {
      expect(drop, `round ${round} ${id}`).toBeLessThanOrEqual(caps[round - 1]!);
      expect(drop).toBe(recorded);
    });
  });

  it('a practice-BOTS table (what Scene Builder runs) still caps the PLAYER; bot-vs-bot is the documented exemption', () => {
    const lobby = createPracticeBotLobby(4242, 'warden', 3);
    // The exemption is keyed on this stamp. If it ever goes, bot fights fall back under the cap: update this test.
    expect(lobby.seats.filter((s) => s.id !== 's0').every((s) => (s.botSeatDamageMult ?? 0) > 1)).toBe(true);
    play(lobby, 12, (round, id, drop, recorded, cap) => {
      // Every seat's readout (rail "-N", scout DMG) is exactly what it lost, even when uncapped.
      expect(drop, `round ${round} ${id}: HP drop and recorded DMG disagree`).toBe(recorded);
      if (id === 's0') expect(drop, `round ${round}: the player lost ${drop}, cap ${cap}`).toBeLessThanOrEqual(cap);
    });
  });
});
