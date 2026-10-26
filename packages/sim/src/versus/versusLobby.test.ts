/**
 * VERSUS through the lobby screens (owner 2026-10-14: "reuse the existing lobby UI 1:1"). The two-seat display lobby
 * (`versusLobby`) and the reducer's `mode !== 'versus'` gates. Since 2026-10-26 (R-VERSUS-HEALTH-01) the seats carry
 * each player's Health and Armor off the server's record, with the lobby's rules and cap; the run lands its own pools
 * on the resolver's stamped result, never settles the display table and never ends by it (the server match does).
 */
import { CARD_INDEX } from '@game/content';
import { makeRng } from '@game/core';
import { describe, expect, it } from 'vitest';
import { boardIntel, lastRoundDamage, playerOpponent, resetLobbyDrivers } from '../lobby/runLobby';
import { createLobbyRun } from '../lobby/runLobby';
import { lobbyRailView } from '../lobby/railView';
import { lossDamageCap, reduce } from '../reducer';
import { getHero } from '../heroes';
import type { RunState } from '../state';
import { resolveVersusFight } from './combat';
import { versusLobby, versusLobbyKey, type VersusLobbyInput, type VersusLobbyRound } from './lobbyView';
import { createVersusRun, versusAutoResolve } from './run';
import { versusStartingVitals, type VersusVitals } from './vitals';

const BODY = Object.keys(CARD_INDEX).find((id) => !CARD_INDEX[id]!.spell && !CARD_INDEX[id]!.token)!;
const WARDEN = versusStartingVitals('warden', null);

/** Play `n` rounds of a seat that loses every fight to a fat board, on the server's pools. Returns the run after each
 *  landed fight and the rounds as the server records them. */
function playLosing(n: number, start: VersusVitals = WARDEN): { run: RunState; rounds: VersusLobbyRound[] } {
  let a = createVersusRun(1, 'warden', 'set2');
  let b = createVersusRun(2, 'warden', 'set2');
  const rounds: VersusLobbyRound[] = [];
  let pools = { p1: { ...start }, p2: { ...WARDEN } };
  for (let round = 1; round <= n; round++) {
    a = reduce(versusAutoResolve(a, makeRng(round)), { type: 'faceOmen', deferFight: true });
    b = reduce(versusAutoResolve(b, makeRng(round)), { type: 'faceOmen', deferFight: true });
    const fat = structuredClone(b.pendingCombatSide!);
    fat.board = [{ cardId: BODY, attack: 50, health: 50 }];
    const fight = resolveVersusFight({ matchSeed: 9, round, p1: a.pendingCombatSide!, p2: fat, vitals: pools });
    pools = { p1: fight.vitals!.p1!, p2: fight.vitals!.p2! };
    rounds.push({ round, loser: fight.loser, mine: fight.p1, vitals: { ...pools } });
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
  it('seats the player and the opponent on Health + Armor, the opponent fielding the board they actually fought with', () => {
    const { run, rounds } = playLosing(3);
    const lobby = versusLobby(input(run, rounds));
    expect(lobby.seats.map((s) => s.id)).toEqual(['s0', 's1']);
    expect(lobby.rules.startingResolve).toBe(getHero('warden').resolve);
    // The lobby's own cap (no Versus override): the rail prints the same MAX DMG as a ranked game.
    expect(lobby.rules.lossCaps).toBeUndefined();
    expect(lobbyRailView(lobby).lossCap).toBe(lossDamageCap(3));
    expect(lobby.round).toBe(3);
    // In combat round 3, not yet settled: my pools after round 2 are still shown (they drop when the fight settles).
    expect([lobby.seats[0]!.resolve, lobby.seats[0]!.armor]).toEqual([rounds[1]!.vitals!.p1!.health, rounds[1]!.vitals!.p1!.armor]);
    expect([lobby.seats[1]!.resolve, lobby.seats[1]!.armor]).toEqual([WARDEN.health, WARDEN.armor]);
    expect(lobby.seats[1]!.invulnerable).toBe(true);
    // The pairing names the opponent and their round-3 board is the one in my round-3 fight.
    resetLobbyDrivers(lobby.seats);
    const foe = playerOpponent(lobby);
    expect(foe?.seat.id).toBe('s1');
    expect(foe?.board.minions.map((m) => [m.cardId, m.attack, m.health])).toEqual([[BODY, 50, 50]]);
    // Rounds 1-2 are on the table's log; the rail's float reads round 2's capped damage.
    expect(lobby.encounters.map((e) => e.round)).toEqual([1, 2]);
    expect(lastRoundDamage(lobby).s0).toEqual({ taken: rounds[1]!.mine.playerDamage, dealt: 0 });
    expect(rounds[1]!.mine.playerDamage).toBeLessThanOrEqual(lossDamageCap(2));
    // Settled: my pools drop; the key moves so the client rebuilds.
    const settled = reduce(run, { type: 'settleCombat' });
    expect(versusLobby(input(settled, rounds)).seats[0]!.resolve + versusLobby(input(settled, rounds)).seats[0]!.armor)
      .toBe(rounds[2]!.vitals!.p1!.health + rounds[2]!.vitals!.p1!.armor);
    expect(versusLobbyKey(input(settled, rounds))).not.toBe(versusLobbyKey(input(run, rounds)));
    // ...and the run itself landed on the same pools (the Health box reads the run).
    expect([settled.resolve, settled.armor]).toEqual([rounds[2]!.vitals!.p1!.health, rounds[2]!.vitals!.p1!.armor]);
  });

  it('round 1 with nothing fought: no board, no pairing face, each hero on its own start', () => {
    const run = createVersusRun(1, 'warden', 'set2');
    const lobby = versusLobby(input(run, []));
    resetLobbyDrivers(lobby.seats);
    expect(playerOpponent(lobby)).toBeNull();
    const indy = versusStartingVitals('indy', null);
    expect(lobby.seats.map((s) => [s.resolve, s.armor])).toEqual([[WARDEN.health, WARDEN.armor], [indy.health, indy.armor]]);
    // Summit: +10 Armor on both.
    const summit = versusLobby({ ...input(run, []), options: { v: 1, mode: 'duel', modifiers: ['summit'] } });
    expect(summit.seats.map((s) => s.armor)).toEqual([WARDEN.armor + 10, indy.armor + 10]);
  });
});

describe('the opponent scout is the server-recorded state of each round, never carried forward', () => {
  it('tier, triples, runes and quests per round, on a loss, a draw and a win alike', () => {
    const { run, rounds } = playLosing(3);
    const scouted: VersusLobbyRound[] = rounds.map((r, i) => ({
      ...r,
      loser: i === 0 ? 'p1' : i === 1 ? null : 'p2', // they win, draw, lose: none of it gates their scout
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
  it('the run lands the resolver pools, never the display table; at 0 Health it keeps going (the server ends the match)', () => {
    const { run, rounds } = playLosing(4, { health: 4, armor: 0 });
    expect(rounds[rounds.length - 1]!.vitals!.p1!.health).toBe(0);
    const withLobby: RunState = { ...run, lobby: versusLobby(input(run, rounds)) };
    const settled = reduce(withLobby, { type: 'settleCombat' });
    expect([settled.resolve, settled.armor]).toEqual([0, 0]);
    const next = reduce(settled, { type: 'resolveCombat' });
    expect(next.phase).toBe('recruit');
    expect(next.wave).toBe(run.wave + 1);
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
