/**
 * BOTS MODE — a full last-man-standing lobby of effectless, scaling-omen opponents, unrated (owner ask
 * 2026-08-24). These pin the three things that make it a SANDBOX rather than a rated lobby or a course:
 *   1. it seats seven authored omen bots (all the same board each round) + the player, and the boards scale;
 *   2. it runs on the LOBBY clock (elimination), never the 17-round course victory that non-lobby modes hit;
 *   3. `mode === 'bots'`, which every rating/upload gate excludes exactly like practice.
 */
import { describe, expect, it } from 'vitest';
import { createBotsRun, botsOmenBoard, botsOmenBoards } from './botsSeats';
import { DEFAULT_LOBBY_RULES } from './lobby';
import { CONFIG } from '../config';
import { reduce, type RunState, type Action } from '../index';

describe('botsOmenBoard — the scaling threat', () => {
  it('grows on both axes: more bodies AND bigger ones as the round climbs', () => {
    const r1 = botsOmenBoard(1);
    const r8 = botsOmenBoard(8);
    const r20 = botsOmenBoard(20);
    expect(r1.length).toBe(1);           // one body round 1
    expect(r8.length).toBe(7);           // a full board by ~round 8
    expect(r20.length).toBe(7);          // capped at the 7-slot board
    const total = (b: { attack: number; health: number }[]) => b.reduce((n, m) => n + m.attack + m.health, 0);
    expect(total(r8)).toBeGreaterThan(total(r1));
    expect(total(r20)).toBeGreaterThan(total(r8));
  });

  it('the front slot is the biggest, descending left-to-right', () => {
    const b = botsOmenBoard(12);
    for (let i = 1; i < b.length; i++) {
      expect(b[i]!.attack).toBeLessThanOrEqual(b[i - 1]!.attack);
      expect(b[i]!.health).toBeLessThanOrEqual(b[i - 1]!.health);
    }
  });

  it('never emits a zero-stat body, even at round 1', () => {
    for (const round of [1, 2, 5, 30, 60]) {
      for (const m of botsOmenBoard(round)) {
        expect(m.attack).toBeGreaterThanOrEqual(1);
        expect(m.health).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('boards are authored out to the round cap, so a long game never falls back to a bye', () => {
    expect(botsOmenBoards().length).toBe(DEFAULT_LOBBY_RULES.maxRounds);
  });
});

describe('createBotsRun — the lobby shape', () => {
  const run = createBotsRun(7, 'aster');

  it('is a bots-mode run carrying a full 8-seat lobby', () => {
    expect(run.mode).toBe('bots');
    expect(run.lobby).toBeTruthy();
    expect(run.lobby!.seats.length).toBe(DEFAULT_LOBBY_RULES.seatCount);
  });

  it('seats the live player at s0 and seven authored omen bots after', () => {
    const seats = run.lobby!.seats;
    expect(seats[0]!.kind).toBe('player');
    for (const seat of seats.slice(1)) {
      expect(seat.kind).toBe('authored');
      expect(seat.authoredBoards, 'a bot seat carries the scaling board table').toBeTruthy();
    }
  });

  it("the player's seat health mirrors the run (one number for the HUD), like every lobby run", () => {
    const me = run.lobby!.seats[0]!;
    expect(me.resolve).toBe(run.resolve);
    expect(me.armor).toBe(run.armor);
  });
});

describe('bots runs on the lobby clock, not the course clock', () => {
  it('a whole game plays to a real END by elimination — never a course victory', () => {
    // Drive a bots run start-to-finish with a do-nothing player (never buys): the scaling omens overrun them and
    // the run must terminate at phase `gameover` with a placement, NOT the phase `victory` a non-lobby mode
    // reaches at `courseRounds`. This also proves the run hits the REAL game — a live Runeforge opens at wave 6,
    // dismissed here like a player would. Fast (no shopping), so it lives as a permanent smoke test.
    let s: RunState = createBotsRun(123, 'aster');
    let guard = 0;
    while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < 200) {
      if (s.runeforgeOffer) s = reduce(s, { type: 'skipRuneforge' } as Action);
      if (s.questOffer?.length) s = reduce(s, { type: 'buyQuest', index: 0 } as Action); // no skip exists — take the offer
      if (s.discover) s = reduce(s, { type: 'discover', index: 0 } as Action);
      s = reduce(s, { type: 'faceOmen' } as Action);
      s = reduce(s, { type: 'resolveCombat' } as Action);
      s = reduce(s, { type: 'settleCombat' } as Action);
    }
    expect(guard, 'the game terminates well within the round cap').toBeLessThan(200);
    expect(s.phase, 'ends by lobby elimination, not a course victory').toBe('gameover');
    expect(s.lobby!.seats[0]!.alive, 'the do-nothing player was eliminated').toBe(false);
    expect(s.lobby!.seats[0]!.placement, 'and was stamped a placement').toBeGreaterThan(1);
    // Never overran the course clock while still in `recruit`/`combat` — the course-victory branch never fired.
    expect(s.wave).toBeLessThanOrEqual(CONFIG.courseRounds + 5);
  });
});
