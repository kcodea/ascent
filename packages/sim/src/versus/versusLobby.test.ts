/**
 * VERSUS through the lobby screens (owner 2026-10-14: "reuse the existing lobby UI 1:1"). The two-seat display lobby
 * (`versusLobby`) and the reducer's `mode !== 'versus'` gates: a Versus run CARRYING that lobby still never moves
 * Resolve / Armor, never settles the table and never ends by it; every other lobby-family mode is unchanged.
 */
import { CARD_INDEX } from '@game/content';
import { makeRng } from '@game/core';
import { describe, expect, it } from 'vitest';
import { boardIntel, lastRoundDamage, playerOpponent, resetLobbyDrivers } from '../lobby/runLobby';
import { createLobbyRun } from '../lobby/runLobby';
import { reduce } from '../reducer';
import type { RunState } from '../state';
import { resolveVersusFight } from './combat';
import { VERSUS_HEARTS } from './constants';
import { versusLobby, versusLobbyKey, type VersusLobbyInput, type VersusLobbyRound } from './lobbyView';
import { createVersusRun, versusAutoResolve } from './run';

const BODY = Object.keys(CARD_INDEX).find((id) => !CARD_INDEX[id]!.spell && !CARD_INDEX[id]!.token)!;

/** Play `n` rounds of a seat that loses every fight to a fat board. Returns the run after each landed fight. */
function playLosing(n: number): { run: RunState; rounds: VersusLobbyRound[] } {
  let a = createVersusRun(1, 'warden', 'set2');
  let b = createVersusRun(2, 'warden', 'set2');
  const rounds: VersusLobbyRound[] = [];
  for (let round = 1; round <= n; round++) {
    a = reduce(versusAutoResolve(a, makeRng(round)), { type: 'faceOmen', deferFight: true });
    b = reduce(versusAutoResolve(b, makeRng(round)), { type: 'faceOmen', deferFight: true });
    const fat = structuredClone(b.pendingCombatSide!);
    fat.board = [{ cardId: BODY, attack: 50, health: 50 }];
    const fight = resolveVersusFight({ matchSeed: 9, round, p1: a.pendingCombatSide!, p2: fat });
    rounds.push({ round, heartLostBy: fight.heartLostBy, mine: fight.p1 });
    a = reduce(a, { type: 'landCombat', fight: { result: fight.p1, damageTaken: 0 } });
    if (round < n) {
      a = reduce(a, { type: 'settleCombat' });
      a = reduce(a, { type: 'resolveCombat' });
    }
  }
  return { run: a, rounds };
}

const input = (run: RunState, rounds: VersusLobbyRound[]): VersusLobbyInput => ({
  matchSeed: 9, setId: 'set2', seat: 'p1', wave: run.wave, inCombat: run.phase === 'combat', combatSettled: !!run.combatSettled,
  me: { label: 'Orangez', heroId: run.heroId }, foe: { label: 'LazerLemon', heroId: 'indy' }, rounds,
});

describe('versusLobby: the two-seat display lobby', () => {
  it('seats the player and the opponent, hearts as health, the opponent fielding the board they actually fought with', () => {
    const { run, rounds } = playLosing(3);
    const lobby = versusLobby(input(run, rounds));
    expect(lobby.seats.map((s) => s.id)).toEqual(['s0', 's1']);
    expect(lobby.rules.startingResolve).toBe(VERSUS_HEARTS);
    expect(lobby.rules.startingArmor).toBe(0);
    expect(lobby.round).toBe(3);
    // In combat round 3, not yet settled: my third heart is still shown (it drops when the fight settles).
    expect(lobby.seats[0]!.resolve).toBe(VERSUS_HEARTS - 2);
    expect(lobby.seats[1]!.resolve).toBe(VERSUS_HEARTS);
    expect(lobby.seats[1]!.invulnerable).toBe(true);
    // The pairing names the opponent and their round-3 board is the one in my round-3 fight.
    resetLobbyDrivers(lobby.seats);
    const foe = playerOpponent(lobby);
    expect(foe?.seat.id).toBe('s1');
    expect(foe?.board.minions.map((m) => [m.cardId, m.attack, m.health])).toEqual([[BODY, 50, 50]]);
    // Rounds 1-2 are on the table's log; the rail's float reads round 2's heart.
    expect(lobby.encounters.map((e) => e.round)).toEqual([1, 2]);
    expect(lastRoundDamage(lobby).s0).toEqual({ taken: 1, dealt: 0 });
    // Settled: the heart drops; the key moves so the client rebuilds.
    const settled = reduce(run, { type: 'settleCombat' });
    expect(versusLobby(input(settled, rounds)).seats[0]!.resolve).toBe(VERSUS_HEARTS - 3);
    expect(versusLobbyKey(input(settled, rounds))).not.toBe(versusLobbyKey(input(run, rounds)));
  });

  it('round 1 with nothing fought: no board, no pairing face, full hearts', () => {
    const run = createVersusRun(1, 'warden', 'set2');
    const lobby = versusLobby(input(run, []));
    resetLobbyDrivers(lobby.seats);
    expect(playerOpponent(lobby)).toBeNull();
    expect(lobby.seats.map((s) => s.resolve)).toEqual([VERSUS_HEARTS, VERSUS_HEARTS]);
  });
});

describe('the opponent scout is the server-recorded state of each round, never carried forward', () => {
  it('tier, triples, runes and quests per round, on a loss, a draw and a win alike', () => {
    const { run, rounds } = playLosing(3);
    const scouted: VersusLobbyRound[] = rounds.map((r, i) => ({
      ...r,
      heartLostBy: i === 0 ? 'p1' : i === 1 ? null : 'p2', // they win, draw, lose: none of it gates their scout
      foeScout: { tier: 2 + i, triples: i, runes: i ? ['rune' + i] : undefined, quests: i === 2 ? ['q'] : undefined },
    }));
    for (let wave = 2; wave <= 3; wave++) {
      // In the shop of round `wave`, the scout shows their round `wave - 1` lock; in its fight, their round `wave` one.
      const lobby = versusLobby({ ...input({ ...run, wave, phase: 'recruit' } as RunState, scouted) });
      resetLobbyDrivers(lobby.seats);
      const foe = playerOpponent(lobby)!;
      const intel = boardIntel(foe.board, lobby.round);
      const want = scouted[Math.min(wave, scouted.length) - 1]!.foeScout!;
      expect(foe.board.tier).toBe(want.tier);
      expect([intel.tier, intel.triples, intel.runes, intel.quests]).toEqual([want.tier, want.triples, want.runes, want.quests]);
    }
  });
});

describe('the reducer never settles a Versus run by its display lobby', () => {
  it('Resolve, Armor and the lobby stay put through settle + resolve; the run keeps going at 0 hearts shown', () => {
    const { run, rounds } = playLosing(VERSUS_HEARTS + 1);
    const withLobby: RunState = { ...run, lobby: versusLobby(input(run, rounds)) };
    const before = [withLobby.resolve, withLobby.armor];
    const settled = reduce(withLobby, { type: 'settleCombat' });
    expect([settled.resolve, settled.armor]).toEqual(before);
    const next = reduce(settled, { type: 'resolveCombat' });
    expect(next.phase).toBe('recruit');
    expect(next.wave).toBe(run.wave + 1);
    expect([next.resolve, next.armor]).toEqual(before);
    expect(next.lobby).toEqual(withLobby.lobby); // untouched: the client rebuilds it, the reducer never settles it
    expect(next.lobbySettledRound).toBe(withLobby.lobbySettledRound);
  });

  it('an ordinary lobby run still settles its table and takes its hit (unchanged)', () => {
    let run = createLobbyRun(4, 'warden', {}, 'lobby', undefined, 'set2');
    run = reduce(run, { type: 'faceOmen' });
    const lost = run.lastCombat?.result === 'lose';
    const hp = run.resolve + run.armor;
    run = reduce(run, { type: 'settleCombat' });
    if (lost) expect(run.resolve + run.armor).toBeLessThan(hp);
    run = reduce(run, { type: 'resolveCombat' });
    expect(run.lobby!.round).toBe(2);
    expect(run.lobbySettledRound).toBe(1);
  });
});
