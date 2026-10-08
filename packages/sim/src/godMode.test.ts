// packages/sim/src/godMode.test.ts
import { describe, expect, it } from 'vitest';
import { createLobbyRun, reduce, makeGodModeRun, godPracticeConfig, GOD_MODE_MAX_ROUNDS, type Action, type BoardSnapshot, type PracticeConfig, type RunState } from './index';

const CFG: PracticeConfig = { opponents: 'players', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribes: [], godMode: true };
const god = (cfg: PracticeConfig = CFG): RunState =>
  makeGodModeRun(createLobbyRun(7, 'warden', { maxRounds: GOD_MODE_MAX_ROUNDS }, 'practice', cfg));
const dummies = (wave: number, n: number, hp: number, atk: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'warden', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: hp * n,
  minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack: atk, health: hp, keywords: [] })),
  seed: 1, origin: 'self',
});
const fight = (s: RunState): RunState => {
  // The Runeforge opens on its round and blocks every other action until it closes — leave it, or the run stalls in
  // the shop and the loops below would pass without ever fighting again.
  if (s.runeforgeOffer) s = reduce(s, { type: 'skipRuneforge' });
  for (const a of [{ type: 'faceOmen' }, { type: 'settleCombat' }, { type: 'resolveCombat' }] as Action[]) s = reduce(s, a);
  return s;
};

describe('God Mode run', () => {
  it('ignores the Sandbox Mode options: every hero, Unlimited health, every tribe, no timer', () => {
    const sandboxDraft: PracticeConfig = { opponents: 'players', botDifficulty: 3, health: 'normal', timeMult: 2, tribes: ['demon'], heroes: 'beginner', godMode: true };
    expect(godPracticeConfig(sandboxDraft)).toEqual({ ...sandboxDraft, heroes: 'all', health: 'unlimited', tribes: [], timeMult: 0, godMode: true });
  });

  it('is a sandbox God Mode run with 999 Gold and an invulnerable background table', () => {
    const s = god();
    expect(s.sandbox).toBe(true);
    expect(s.godMode).toBe(true);
    expect(s.embers).toBe(999);
    expect(s.lobby!.rules.maxRounds).toBe(GOD_MODE_MAX_ROUNDS);
    expect(s.lobby!.seats.slice(1).every((seat) => seat.invulnerable === true)).toBe(true);
    expect(s.lobby!.seats[0]!.invulnerable).toBeUndefined();
  });

  it('never ends on its own: 70 rounds in, still in the shop', () => {
    let s = god();
    for (let i = 0; i < 70; i++) {
      s = { ...s, board: [] as never };
      s = fight(s);
      expect(s.phase, `round ${i + 1}`).toBe('recruit');
      expect(s.wave, `round ${i + 1} actually fought`).toBe(i + 2);
    }
    expect(s.lobby!.finished).toBeFalsy();
  });

  it('Health = Normal: the player can still be knocked out', () => {
    let s = god({ ...CFG, health: 'normal' });
    for (let i = 0; i < 80 && s.phase !== 'gameover'; i++) {
      s = { ...s, board: [] as never, servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: dummies(s.wave, 7, 50, 50) }, sandboxFoeWave: s.wave };
      s = fight(s);
    }
    expect(s.phase).toBe('gameover');
  });

  it('the pinned board is the board fought', () => {
    let s = god();
    s = { ...s, servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: dummies(s.wave, 7, 1, 0) }, sandboxFoeWave: s.wave };
    s = reduce(s, { type: 'faceOmen' } as Action);
    expect(s.lastCombat!.initial.enemy.map((m) => m.cardId)).toEqual(Array(7).fill('sandbag'));
  });
});
