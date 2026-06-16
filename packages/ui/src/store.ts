import { create } from 'zustand';
import { createRun, reduce, type Action, type RunState } from '@game/sim';

interface GameStore {
  run: RunState;
  /** UI flag: Hero Power is armed and waiting for a target minion. */
  heroArmed: boolean;
  /** Apply an engine action — the only way run state changes. Pure reducer under the hood. */
  dispatch: (action: Action) => void;
  /** Toggle Hero Power targeting mode. */
  armHero: () => void;
  /** Start a fresh run. */
  newRun: (seed?: number) => void;
}

const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

export const useGame = create<GameStore>((set, get) => ({
  run: createRun(randomSeed()),
  heroArmed: false,
  // Any action clears the armed state (so a stray buy/sell cancels targeting).
  dispatch: (action) => set({ run: reduce(get().run, action), heroArmed: false }),
  armHero: () => set((s) => ({ heroArmed: !s.heroArmed })),
  newRun: (seed) => set({ run: createRun(seed ?? randomSeed()), heroArmed: false }),
}));
