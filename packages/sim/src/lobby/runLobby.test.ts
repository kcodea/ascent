import { describe, it, expect } from 'vitest';
import { CONFIG } from '../config';
import { reduce } from '../reducer';
import { DEFAULT_BOT } from '../bots/index';
import type { RunState } from '../state';
import { createLobbyRun, lastPlayerEncounter, lastRoundDamage, playerLobbySeat, playerOpponent, playerEliminated } from './runLobby';

/**
 * THE PLAYABLE LOBBY — a run that is a seat in an 8-seat elimination lobby.
 *
 * These drive the REAL reducer end to end rather than the standalone lobby loop, because the integration is
 * where the mistakes live: the first version hooked the `settleCombat` case and missed `resolveCombat`, which
 * calls the settle function directly — so the lobby never advanced on the path the game actually takes.
 */
const playOut = (s: RunState, maxSteps = 6000): RunState => {
  let guard = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < maxSteps) {
    const next = reduce(s, DEFAULT_BOT.act(s));
    if (next === s) break;
    s = next;
  }
  return s;
};

describe('lobby run — setup', () => {
  it('starts with 8 seats, the player first, everyone alive', () => {
    const s = createLobbyRun(4, 'drakko');
    expect(s.mode).toBe('lobby');
    expect(s.lobby!.seats).toHaveLength(8);
    expect(s.lobby!.seats[0]!.kind).toBe('player');
    expect(s.lobby!.seats.every((x) => x.alive)).toBe(true);
  });

  it('the seat pools ARE the run’s health, so the HUD reads one number', () => {
    const s = createLobbyRun(4, 'drakko');
    expect(playerLobbySeat(s.lobby!).resolve).toBe(s.resolve);
    expect(playerLobbySeat(s.lobby!).armor).toBe(s.armor);
  });

  it('the player is paired with a real opponent that fields a board', () => {
    const s = createLobbyRun(4, 'drakko');
    const foe = playerOpponent(s.lobby!);
    expect(foe, 'the player has no opponent in round 1').toBeTruthy();
    expect(foe!.seat.id).not.toBe('s0');
    expect(foe!.board.minions.length).toBeGreaterThan(0);
  });

  it('is structured-cloneable — it has to survive save/reload and every dispatch', () => {
    // The reason drivers are rebuilt from seeds rather than stored: closures can't be cloned, and `reduce`
    // deep-clones the whole RunState on every action.
    const s = createLobbyRun(4, 'drakko');
    expect(() => structuredClone({ ...s, lastCombat: undefined })).not.toThrow();
  });
});

describe('lobby run — playing it', () => {
  it('one round of play settles the WHOLE table, not just the player’s fight', () => {
    let s = createLobbyRun(4, 'drakko');
    const before = s.lobby!.seats.map((x) => x.resolve + x.armor);
    let guard = 0;
    while (s.lobby!.round === 1 && s.phase !== 'gameover' && guard++ < 500) {
      const next = reduce(s, DEFAULT_BOT.act(s));
      if (next === s) break;
      s = next;
    }
    expect(s.lobby!.round, 'the lobby round never advanced').toBe(2);
    // Assert on the ENCOUNTERS, not on who happened to take damage: round-1 boards are tiny and several fights
    // legitimately draw for 0, so a damage count can't tell "the other tables never fought" from "they drew".
    const round1 = s.lobby!.encounters.filter((e) => e.round === 1 && e.fought);
    expect(round1.length, 'not every pairing resolved — 8 seats is 4 fights').toBe(4);
    expect(round1.some((e) => e.a === 's0' || e.b === 's0'), 'the player’s own fight is missing').toBe(true);
    expect(round1.filter((e) => e.a !== 's0' && e.b !== 's0').length, 'the other tables never fought').toBe(3);
    // …and the table really did move: at least one seat is worse off than it started.
    const after = s.lobby!.seats.map((x) => x.resolve + x.armor);
    expect(after.some((hp, i) => hp < before[i]!), 'nobody took any damage at all').toBe(true);
  });

  it('the player’s Resolve tracks the SEAT, not the ordinary run damage', () => {
    let s = createLobbyRun(4, 'drakko');
    s = playOut(s, 900);
    expect(s.resolve).toBe(Math.max(0, playerLobbySeat(s.lobby!).resolve));
  });

  it('a full lobby run ends by ELIMINATION and hands out placements', () => {
    const s = playOut(createLobbyRun(4, 'drakko'));
    expect(s.phase).toBe('gameover');
    // It ended because the player's seat died (or the lobby resolved) — never because a 17-round course ran out.
    expect(playerEliminated(s.lobby!) || s.lobby!.finished).toBe(true);
    expect(playerLobbySeat(s.lobby!).placement, 'the player got no placement').toBeDefined();
  });

  it('…and it is NOT ending at the course length', () => {
    // The control for the test above: a lobby seat must be able to play past round 17, which is the whole
    // reason `lobby` mode exists.
    let ranLong = false;
    for (const seed of [4, 5, 6, 7]) {
      const s = playOut(createLobbyRun(seed, 'drakko'));
      if (s.lobby!.round > CONFIG.courseRounds) { ranLong = true; break; }
    }
    expect(ranLong, 'no lobby ever passed the course length — the clock is still capping it').toBe(true);
  });

  it('the same seed reproduces the same lobby', () => {
    const a = playOut(createLobbyRun(9, 'drakko'));
    const b = playOut(createLobbyRun(9, 'drakko'));
    expect(b.lobby!.seats.map((x) => [x.id, x.alive, x.placement]))
      .toEqual(a.lobby!.seats.map((x) => [x.id, x.alive, x.placement]));
  });
});

describe('lobby run — the readouts the player actually reads', () => {
  it('the player is charged for a loss ONCE, not twice', () => {
    // The lobby applies the hit (with its own cap and stall pressure) and the run syncs to the seat. The
    // ordinary settle path then applied `playerDamage` again on top, which showed up as the HUD reading lower
    // than the table for the same fight.
    // Play until the player has ACTUALLY TAKEN a hit — the divergence can only appear on a loss, so a fixed
    // round count made this vacuous: it passed with the fix reverted because the player hadn't lost yet.
    let s = createLobbyRun(4, 'drakko');
    const startHp = playerLobbySeat(s.lobby!).resolve + playerLobbySeat(s.lobby!).armor;
    let guard = 0;
    while (s.phase !== 'gameover' && guard++ < 4000) {
      const next = reduce(s, DEFAULT_BOT.act(s));
      if (next === s) break;
      s = next;
      const me = playerLobbySeat(s.lobby!);
      if (me.resolve + me.armor < startHp) break; // took a hit — now the two numbers must agree
    }
    const seat = playerLobbySeat(s.lobby!);
    expect(seat.resolve + seat.armor, 'the player never took a hit — the check would be vacuous').toBeLessThan(startHp);
    expect(s.resolve, 'the run and the seat disagree — damage is being applied twice').toBe(Math.max(0, seat.resolve));
    expect(s.armor).toBe(Math.max(0, seat.armor));
  });

  it('last round’s damage is reported per seat, for both sides of every fight', () => {
    let s = createLobbyRun(4, 'drakko');
    let guard = 0;
    while (s.lobby!.round === 1 && s.phase !== 'gameover' && guard++ < 500) {
      const next = reduce(s, DEFAULT_BOT.act(s));
      if (next === s) break;
      s = next;
    }
    const dmg = lastRoundDamage(s.lobby!);
    // 4 fights, both sides recorded → every seat that fought has an entry.
    expect(Object.keys(dmg).length, 'not every seat has a damage readout').toBe(8);
    // One side's damage taken is the other's damage dealt — the numbers come from one result, so they must agree.
    for (const e of s.lobby!.encounters.filter((x) => x.round === 1 && x.fought)) {
      expect(dmg[e.a]!.taken).toBe(dmg[e.b]!.dealt);
      expect(dmg[e.b]!.taken).toBe(dmg[e.a]!.dealt);
    }
  });

  it('the player’s own encounter is reportable, with the foe named', () => {
    let s = createLobbyRun(4, 'drakko');
    let guard = 0;
    while (s.lobby!.round === 1 && s.phase !== 'gameover' && guard++ < 500) {
      const next = reduce(s, DEFAULT_BOT.act(s));
      if (next === s) break;
      s = next;
    }
    const last = lastPlayerEncounter(s.lobby!);
    expect(last, 'the player’s fight was not recorded').toBeTruthy();
    expect(last!.foe.id).not.toBe('s0');
    expect(last!.taken).toBeGreaterThanOrEqual(0);
    expect(last!.dealt).toBeGreaterThanOrEqual(0);
  });
});
