/**
 * SCENE BUILDER as a LOBBY GAME AGAINST BOTS (owner ask 2026-09-09).
 *
 * The sandbox rides the practice-bots lobby with an invulnerable seat. Two engine facts make the rig's tools
 * keep working inside a lobby, and both are pinned here:
 *  1. A lobby fight serves the PAIRED SEAT's board — but a board the rig authored for this wave (marked by
 *     `sandboxFoeWave`, not by the pin's mere presence, which the turn boundary also stamps) is served instead.
 *  2. The practice round-15 / course-length curtains do NOT end a sandbox — a dev rig has no run length.
 */
import { describe, expect, it } from 'vitest';
import { createLobbyRun, reduce, CONFIG, type RunState, type Action, type BoardSnapshot, type PracticeConfig } from './index';

const BOTS: PracticeConfig = { opponents: 'bots', botDifficulty: 5, health: 'unlimited', timeMult: 1, tribeSurge: null };

const sandbox = (seed = 7): RunState => ({ ...createLobbyRun(seed, 'warden', {}, 'practice', BOTS), sandbox: true });

/** The rig's "Next enemy" dummies: N sandbags at hp/atk, pinned for THIS wave. */
const dummies = (wave: number, n: number, hp: number, atk: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'warden', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: hp * n,
  minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack: atk, health: hp, keywords: [] })),
  seed: 1, origin: 'self',
});

describe('Scene Builder sandbox — a lobby game against bots', () => {
  it('a rig-authored pin (sandboxFoeWave === wave) is what the lobby fight serves', () => {
    let s = sandbox();
    const pin = dummies(s.wave, 7, 1, 0);
    s = { ...s, servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: pin }, sandboxFoeWave: s.wave };
    s = reduce(s, { type: 'faceOmen' } as Action);
    const enemy = s.lastCombat!.initial.enemy;
    expect(enemy.map((m) => m.cardId)).toEqual(Array(7).fill('sandbag'));
    expect(enemy.every((m) => m.health === 1 && m.attack === 0)).toBe(true);
  });

  it('a pin WITHOUT the marker (the turn boundary\'s pool pick) is ignored — the paired seat is served', () => {
    let s = sandbox();
    const pin = dummies(s.wave, 7, 1, 0);
    s = { ...s, servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: pin } }; // no sandboxFoeWave
    s = reduce(s, { type: 'faceOmen' } as Action);
    expect(s.lastCombat!.initial.enemy.some((m) => m.cardId === 'sandbag')).toBe(false);
  });

  it('a STALE marker (an earlier wave) does not hijack a later fight', () => {
    let s = sandbox();
    const pin = dummies(s.wave, 7, 1, 0);
    s = { ...s, wave: 3, lobby: { ...s.lobby!, round: 3 }, servedBoards: { 3: pin }, sandboxFoeWave: 1 };
    s = reduce(s, { type: 'faceOmen' } as Action);
    expect(s.lastCombat!.initial.enemy.some((m) => m.cardId === 'sandbag')).toBe(false);
  });

  it('the seat is invulnerable: a lost round leaves Resolve and Armor exactly where they were', () => {
    let s = sandbox();
    s = { ...s, wave: 6, board: [] as never, lobby: { ...s.lobby!, round: 6 } };
    const before = s.resolve + s.armor;
    for (const a of [{ type: 'faceOmen' }, { type: 'settleCombat' }, { type: 'resolveCombat' }] as Action[]) s = reduce(s, a);
    expect(s.phase).toBe('recruit');
    expect(s.resolve + s.armor).toBe(before);
    expect(s.lobby!.seats[0]!.alive).toBe(true);
  });

  it('no curtain: the sandbox plays past round 15 and past the course length', () => {
    for (const wave of [15, CONFIG.courseRounds]) {
      let s = sandbox();
      s = { ...s, wave, board: [] as never, lobby: { ...s.lobby!, round: wave } };
      for (const a of [{ type: 'faceOmen' }, { type: 'settleCombat' }, { type: 'resolveCombat' }] as Action[]) s = reduce(s, a);
      expect(s.phase, `wave ${wave}`).toBe('recruit');
      expect(s.wave).toBe(wave + 1);
    }
  });

  it('a plain (non-sandbox) invulnerable practice lobby still drops its curtain at round 15', () => {
    let s: RunState = createLobbyRun(7, 'warden', {}, 'practice', BOTS);
    s = { ...s, wave: 15, board: [] as never, lobby: { ...s.lobby!, round: 15 } };
    for (const a of [{ type: 'faceOmen' }, { type: 'settleCombat' }, { type: 'resolveCombat' }] as Action[]) s = reduce(s, a);
    expect(s.phase).toBe('gameover');
  });

  it('createLobbyRun pins an explicit set on the run', () => {
    const s = createLobbyRun(7, 'warden', {}, 'practice', BOTS, 'set1');
    expect(s.setId).toBe('set1');
    expect(s.lobby?.seats).toHaveLength(8);
  });
});
