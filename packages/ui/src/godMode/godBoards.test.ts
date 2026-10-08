// packages/ui/src/godMode/godBoards.test.ts
import { describe, expect, it } from 'vitest';
import type { BoardSnapshot, RunState } from '@game/sim';
import { findGodBoard, pinGodFoe, type GodBoardDeps } from './godBoards';

const board = (p: Partial<BoardSnapshot>): BoardSnapshot => ({
  v: 1, wave: 5, heroId: 'warden', resolve: 30, tier: 3, triples: 0, tribes: [], threat: 'glass', power: 1,
  minions: [{ cardId: 'sandbag', attack: 1, health: 1, keywords: [] }], seed: 1, origin: 'self', setId: 'set3', ...p,
} as BoardSnapshot);
const deps = (p: Partial<GodBoardDeps>): GodBoardDeps => ({ rpc: null, pool: () => [], rand: () => 0, timeoutMs: 50, patchPrefix: '1.0+', ...p });

describe('findGodBoard', () => {
  it('uses the Supabase board when it is valid', async () => {
    const remote = board({ seed: 99 });
    expect(await findGodBoard(5, 'set3', deps({ rpc: async () => remote }))).toBe(remote);
  });
  it('rejects a wrong-set or empty remote board and falls back to the boot pool (Review Focus 5)', async () => {
    const local = board({ seed: 7 });
    const pool = () => [board({ wave: 4 }), local, board({ origin: 'synthetic' }), board({ setId: 'set2' })];
    expect(await findGodBoard(5, 'set3', deps({ rpc: async () => board({ setId: 'set2' }), pool }))).toBe(local);
    expect(await findGodBoard(5, 'set3', deps({ rpc: async () => board({ minions: [] }), pool }))).toBe(local);
  });
  it('falls back when the fetch times out or throws', async () => {
    const local = board({ seed: 7 });
    const never = () => new Promise<BoardSnapshot | null>(() => { /* hangs */ });
    expect(await findGodBoard(5, 'set3', deps({ rpc: never, pool: () => [local] }))).toBe(local);
    expect(await findGodBoard(5, 'set3', deps({ rpc: async () => { throw new Error('x'); }, pool: () => [local] }))).toBe(local);
  });
  it('returns null when nothing is found', async () => {
    expect(await findGodBoard(5, 'set3', deps({ rpc: async () => null }))).toBeNull();
  });
});

describe('pinGodFoe', () => {
  it('pins the board as this round\'s sandbox foe', () => {
    const run = { wave: 9, servedBoards: { 8: null } } as unknown as RunState;
    const b = board({});
    const out = pinGodFoe(run, b);
    expect(out.servedBoards![9]).toBe(b);
    expect(out.servedBoards![8]).toBeNull();
    expect(out.sandboxFoeWave).toBe(9);
  });
});
