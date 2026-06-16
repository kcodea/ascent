import { create } from 'zustand';
import { createRun, reduce, type Action, type RunState } from '@game/sim';

interface GameStore {
  run: RunState;
  /** UI flag: Hero Power is armed and waiting for a target minion. */
  heroArmed: boolean;
  /** Increments on each sell — drives the gold "+1" flash on the Embers chip. */
  sellTick: number;
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
  sellTick: 0,
  dispatch: (action) =>
    set((s) => ({
      run: reduce(s.run, action),
      heroArmed: false, // any action clears targeting
      sellTick: action.type === 'sell' ? s.sellTick + 1 : s.sellTick,
    })),
  armHero: () => set((s) => ({ heroArmed: !s.heroArmed })),
  newRun: (seed) => set({ run: createRun(seed ?? randomSeed()), heroArmed: false, sellTick: 0 }),
}));
