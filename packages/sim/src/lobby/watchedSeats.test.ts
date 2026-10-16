import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { Tribe } from '@game/core';
import { QUEST_INDEX, RUNE_INDEX, activeSet, poolFor } from '@game/content';
import { reduce } from '../reducer';
import { DEFAULT_BOT } from '../bots/index';
import { OPPONENT_POOL, registerOpponents } from '../opponents';
import { playableHeroes } from '../heroes';
import type { BoardSnapshot } from '../snapshot';
import type { RunState } from '../state';
import {
  boardIntel, createLobbyRun, driverFor, playerOpponent, resetLobbyDrivers, seatResults, seatScoutIntel, setWatchedSeatRuns,
  type RunLobby,
} from './runLobby';

/**
 * A LIVE-GAME WATCHER SEES THE PLAYER'S RAIL, 1:1 (owner 2026-10-16: "spectators should get as close to 1:1
 * experience as a player", R-SPECTATE-SEATS-01).
 *
 * The watcher receives the player's lobby (the spectator view), but drives its seats on its OWN client, against its own
 * opponent pool, which was sampled for the watcher's rank and rarely holds the watched game's recordings. Each round
 * this plays a real lobby and computes everything the rail shows twice: on the PLAYER's client (the runs in the pool)
 * and on a WATCHER's client (the same lobby, cloned as it arrives, with the runs absent from the pool and handed over
 * through `setWatchedSeatRuns`, the path `live/liveWatch.ts` takes). The two must be identical. A control round
 * without the hand-over proves the watcher really was blind before.
 */
const SET = activeSet().id;
const minionsOf = (tribe: Tribe): string[] => poolFor(SET).all
  .filter((c) => !c.spell && !c.token && c.tribe === tribe && !c.tribe2 && c.tier <= 2).map((c) => c.id);
const TRIBES = (['beast', 'undead', 'mech', 'dragon', 'demon', 'kobold', 'dwarf'] as Tribe[]).filter((t) => minionsOf(t).length > 0);
const GROWTH = [0.2, 0.7, 0.3, 0.9, 0.2, 0.8, 0.4];
const LENGTHS = [16, 6, 12, 9, 16, 5, 14];

const RECORDINGS: BoardSnapshot[] = (() => {
  const heroes = playableHeroes().filter((h) => h.id !== 'drakko' && !h.tribes);
  const quests = Object.keys(QUEST_INDEX);
  const runes = Object.keys(RUNE_INDEX);
  const out: BoardSnapshot[] = [];
  for (let r = 0; r < 7; r++) {
    for (let wave = 1; wave <= LENGTHS[r]!; wave++) {
      const main = TRIBES[(r + (wave > 4 ? 1 : 0)) % TRIBES.length]!;
      const count = Math.min(7, 1 + Math.floor(wave / 2));
      const ids = Array.from({ length: count }, (_, i) => { const p = minionsOf(main); return p[(wave + i) % p.length]!; });
      const g = Math.floor(wave * GROWTH[r]!);
      out.push({
        v: 1, wave, heroId: heroes[r]!.id, resolve: 30, armor: 15, tier: Math.min(6, 1 + Math.floor((wave - 1) / 2)),
        triples: Math.floor(wave / (3 + r)), tribes: TRIBES.slice(0, 5), threat: 'venom', power: count * 6,
        minions: ids.map((cardId, i) => ({ cardId, attack: 1 + g + (i % 2), health: 1 + g, keywords: [] })),
        seed: 7700 + r, origin: 'self', author: `Rec${r}`, setId: SET,
        ...(wave >= 3 ? { quests: [quests[(r * 3) % quests.length]!] } : {}),
        ...(wave >= 5 ? { runes: runes.slice(r, r + 1) } : {}),
      } as BoardSnapshot);
    }
  }
  return out;
})();

beforeAll(() => { registerOpponents(RECORDINGS); });
afterEach(() => { setWatchedSeatRuns(null); });

/** Everything the rail and its cards read off the seats' drivers, for one client. */
function railRead(lobby: RunLobby): unknown {
  const next = playerOpponent(lobby);
  return {
    next: next ? { seat: next.seat.id, ghost: !!next.ghost, intel: boardIntel(next.board, lobby.round), board: next.board.minions.map((m) => [m.cardId, m.attack, m.health]) } : null,
    seats: lobby.seats.map((s) => ({
      id: s.id, label: s.label, heroId: s.heroId, alive: s.alive, resolve: s.resolve, armor: s.armor, placement: s.placement,
      intel: s.kind === 'player' ? null : seatScoutIntel(lobby, s),
      history: seatResults(lobby, s.id, 3),
    })),
  };
}

/** The same lobby on a watcher's client: the recordings are NOT in its pool. `handOver`: the fetch has landed. */
function watcherRead(lobby: RunLobby, handOver: boolean): unknown {
  const received = structuredClone(lobby);
  const saved = OPPONENT_POOL.splice(0);
  try {
    resetLobbyDrivers(received.seats);
    setWatchedSeatRuns(handOver ? RECORDINGS : null);
    return railRead(received);
  } finally {
    OPPONENT_POOL.push(...saved);
    setWatchedSeatRuns(null);
    resetLobbyDrivers(received.seats);
  }
}

describe("a live-game watcher's rail equals the player's, every round (R-SPECTATE-SEATS-01)", () => {
  it('plays a real lobby and compares both clients each round', () => {
    let run: RunState = createLobbyRun(21, 'drakko', { startingResolve: 12, startingArmor: 3 });
    expect(run.lobby!.seats.filter((s) => s.kind === 'snapshot')).toHaveLength(7);
    let rounds = 0;
    let blindRounds = 0;
    let guard = 0;
    while (run.phase !== 'gameover' && rounds < 12 && guard++ < 50_000) {
      const act = DEFAULT_BOT.act(run);
      if (act.type !== 'faceOmen') { run = reduce(run, act); continue; }
      const lobby = run.lobby!;
      const player = railRead(lobby);
      expect(watcherRead(lobby, true), `round ${lobby.round}: the watcher's rail`).toEqual(player);
      // The control: before the recordings land, the watcher's seats are stand-ins and the read differs.
      if (JSON.stringify(watcherRead(lobby, false)) !== JSON.stringify(player)) blindRounds++;
      resetLobbyDrivers(lobby.seats);
      run = reduce(reduce(run, act), { type: 'resolveCombat' });
      rounds++;
    }
    expect(rounds, 'at least six rounds compared').toBeGreaterThanOrEqual(6);
    expect(blindRounds, 'without the recordings the watcher read differently').toBeGreaterThan(0);
  }, 120_000);

  it('the hand-over never touches the opponent pool (the runs are not candidates for the watcher\'s own table)', () => {
    const before = OPPONENT_POOL.length;
    const saved = OPPONENT_POOL.splice(0);
    try {
      const keys = setWatchedSeatRuns(RECORDINGS);
      expect(keys).toHaveLength(7);
      expect(OPPONENT_POOL).toHaveLength(0);
      const lobby = createLobbyRun(5, 'drakko').lobby!;
      expect(lobby.seats.filter((s) => s.kind === 'snapshot'), 'no watched run is seated').toHaveLength(0);
    } finally {
      OPPONENT_POOL.push(...saved);
    }
    expect(OPPONENT_POOL.length).toBe(before);
  });

  it('a cut-down recording is refused, exactly as the pool refuses it', () => {
    const run0 = RECORDINGS.filter((b) => b.author === 'Rec0');
    expect(setWatchedSeatRuns(run0.filter((b) => b.wave > 6))).toEqual([]); // its early waves cut off
  });

  it('serves a seat from the hand-over first', () => {
    const lobby = createLobbyRun(21, 'drakko').lobby!;
    const seat = lobby.seats.find((s) => s.kind === 'snapshot')!;
    const saved = OPPONENT_POOL.splice(0);
    try {
      resetLobbyDrivers([seat]);
      expect(driverFor(seat, lobby.setId)!.realPlayer).toBeUndefined(); // a stand-in
      setWatchedSeatRuns(RECORDINGS);
      resetLobbyDrivers([seat]);
      expect(driverFor(seat, lobby.setId)!.realPlayer).toBe(true);
    } finally {
      OPPONENT_POOL.push(...saved);
      setWatchedSeatRuns(null);
      resetLobbyDrivers([seat]);
    }
  });
});
