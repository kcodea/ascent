import { create } from 'zustand';
import { createRun, reduce, type Action, type RunState } from '@game/sim';
import { sfx } from './sfx';

const countGolden = (s: RunState): number =>
  [...s.board, ...s.hand].filter((c) => c.golden).length;

/** Fire the sound for a dispatched action (+ a sparkle when a triple just formed). */
function actionSfx(action: Action, prev: RunState, next: RunState): void {
  switch (action.type) {
    case 'buy': sfx.buy(); break;
    case 'play': sfx.play(); break;
    case 'sell': sfx.sell(); break;
    case 'roll': case 'freeze': sfx.roll(); break;
    case 'upgrade': sfx.upgrade(); break;
    case 'heroPower': sfx.temper(); break;
    case 'discover': sfx.buy(); break;
    case 'faceOmen': sfx.combatStart(); break;
    default: break;
  }
  if (countGolden(next) > countGolden(prev)) sfx.triple();
}

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

export const useGame = create<GameStore>((set) => ({
  run: createRun(randomSeed()),
  heroArmed: false,
  sellTick: 0,
  dispatch: (action) =>
    set((s) => {
      const next = reduce(s.run, action);
      actionSfx(action, s.run, next);
      return {
        run: next,
        heroArmed: false, // any action clears targeting
        sellTick: action.type === 'sell' ? s.sellTick + 1 : s.sellTick,
      };
    }),
  armHero: () => set((s) => ({ heroArmed: !s.heroArmed })),
  newRun: (seed) => set({ run: createRun(seed ?? randomSeed()), heroArmed: false, sellTick: 0 }),
}));
