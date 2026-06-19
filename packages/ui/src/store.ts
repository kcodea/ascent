import { create } from 'zustand';
import { HEROES, createRun, reduce, type Action, type RunState } from '@game/sim';
import type { CardView } from './Card';
import { sfx } from './sfx';

/** How many heroes the pre-run picker offers (or all of them, if fewer exist). */
const HERO_SELECT_COUNT = 3;

/** A fresh shuffle of hero ids for the picker. UI-level randomness — the hero *choice* is a
 *  meta decision, not part of the seeded run, so Math.random is fine here (and not in the sim). */
function rollHeroChoices(): string[] {
  const ids = HEROES.map((h) => h.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids.slice(0, Math.min(HERO_SELECT_COUNT, ids.length));
}

const countGolden = (s: RunState): number =>
  [...s.board, ...s.hand].filter((c) => c.golden).length;

/** Fire the sound for a dispatched action (+ a sparkle when a triple just formed). */
function actionSfx(action: Action, prev: RunState, next: RunState): void {
  // The reducer returns the *same* reference for a rejected action (can't afford, board/hand
  // full, timer up). For the actions a player actively triggers expecting something to happen,
  // play a clear "wrong" buzz instead of the success blip — and skip the success sound.
  if (next === prev) {
    if (action.type === 'buy' || action.type === 'play' || action.type === 'roll' || action.type === 'upgrade') {
      sfx.deny();
    }
    return;
  }
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
  /** The card being inspected (right-click) in a centred, enlarged overlay, or null. */
  inspect: CardView | null;
  /** Hero ids offered by the pre-run picker; non-null = the hero-select overlay is showing. */
  heroChoices: string[] | null;
  /** Apply an engine action — the only way run state changes. Pure reducer under the hood. */
  dispatch: (action: Action) => void;
  /** Toggle Hero Power targeting mode. */
  armHero: () => void;
  /** Open / close the inspect overlay for a card. */
  inspectCard: (view: CardView) => void;
  clearInspect: () => void;
  /** Open the hero picker (a fresh roll of choices) — the gate before a run starts. */
  startHeroSelect: () => void;
  /** Commit a chosen hero: start a fresh run as that hero and close the picker. */
  pickHero: (heroId: string) => void;
  /** Start a fresh run directly (optionally with a seed / hero), bypassing the picker. */
  newRun: (seed?: number, heroId?: string) => void;
}

const randomSeed = (): number => Math.floor(Math.random() * 0x7fffffff);

export const useGame = create<GameStore>((set) => ({
  run: createRun(randomSeed()),
  heroArmed: false,
  sellTick: 0,
  inspect: null,
  // Open on a fresh hero pick — the player chooses before the first wave loads.
  heroChoices: rollHeroChoices(),
  dispatch: (action) =>
    set((s) => {
      const next = reduce(s.run, action);
      actionSfx(action, s.run, next);
      return {
        run: next,
        heroArmed: false, // any action clears targeting
        inspect: null, // …and closes the inspect overlay
        sellTick: action.type === 'sell' ? s.sellTick + 1 : s.sellTick,
      };
    }),
  armHero: () => set((s) => ({ heroArmed: !s.heroArmed })),
  inspectCard: (view) => set({ inspect: view }),
  clearInspect: () => set({ inspect: null }),
  startHeroSelect: () => set({ heroChoices: rollHeroChoices() }),
  pickHero: (heroId) =>
    set({ run: createRun(randomSeed(), heroId), heroArmed: false, sellTick: 0, inspect: null, heroChoices: null }),
  newRun: (seed, heroId) =>
    set({ run: createRun(seed ?? randomSeed(), heroId), heroArmed: false, sellTick: 0, inspect: null, heroChoices: null }),
}));

// DEV-only debug handle: stage arbitrary state from the console (e.g. useGame.setState to preview the
// Discover / game-over / End-of-Turn UI). Stripped from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { useGame?: typeof useGame }).useGame = useGame;
}
