import { describe, it, expect } from 'vitest';
import { createLobbyRun, resetLobbyDrivers } from './lobby/runLobby';
import { reduce } from './reducer';
import { BOTS } from './bots';
import type { Action, RunState } from './state';

/**
 * REPLAY VIEWER foundation: a COLD replay of a lobby run's action log must reproduce the PLAYER's own board,
 * round by round. This is the guarantee the replay viewer rests on — reducer-replay of the recorded actions
 * (Option A). "Cold" = the lobby seat drivers are reset before replaying, simulating a fresh session / another
 * device (the case the "a lobby replay isn't faithful" comments warn about, which is really only about
 * re-deriving the OPPONENTS — the player's own board is deterministic from the seed + action log).
 *
 * If this ever fails, the reducer picked up non-determinism (a wall-clock read, Math.random, or state leaking
 * across the seat-driver cache) and the replay feature would silently diverge — so it's a load-bearing guard,
 * not a nice-to-have.
 */
const boardFp = (s: RunState): string => JSON.stringify(s.board);

function play(seed: number, heroId = 'warden', maxActions = 12000) {
  let s = createLobbyRun(seed, heroId);
  const actions: Action[] = [];
  const boards: Record<number, string> = {};
  const bot = BOTS[0]!;
  for (let i = 0; i < maxActions && s.phase !== 'gameover' && s.phase !== 'victory'; i++) {
    if (s.phase === 'recruit') boards[s.wave] = boardFp(s); // last recruit board per wave = the built board
    const a = bot.act(s);
    const next = reduce(s, a);
    if (next !== s) actions.push(a);
    else if (a.type === 'faceOmen') break; // wedged — stop rather than spin
    s = next;
  }
  return { seed, heroId, actions, boards, seats: s.lobby?.seats ?? [], final: s };
}

function replay(seed: number, heroId: string, actions: Action[]) {
  let s = createLobbyRun(seed, heroId);
  const boards: Record<number, string> = {};
  for (const a of actions) {
    if (s.phase === 'recruit') boards[s.wave] = boardFp(s);
    s = reduce(s, a);
  }
  return { boards, final: s };
}

describe('replay fidelity — the player board reproduces on a cold replay', () => {
  it('matches every recruit round across several seeds', () => {
    for (const seed of [1, 7, 42, 100, 777]) {
      const run = play(seed);
      resetLobbyDrivers(run.seats); // COLD: forget the warmed bot seats, like a fresh session / other device
      const rep = replay(seed, run.heroId, run.actions);
      const waves = Object.keys(run.boards).map(Number);
      expect(waves.length, `seed ${seed} produced no rounds`).toBeGreaterThan(3);
      for (const w of waves) {
        expect(rep.boards[w], `seed ${seed}, wave ${w}: replayed player board diverged`).toBe(run.boards[w]);
      }
      expect(rep.final.phase, `seed ${seed}: run outcome diverged`).toBe(run.final.phase);
    }
  });
});
