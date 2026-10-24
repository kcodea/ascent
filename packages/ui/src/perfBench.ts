import { useGame } from './store';
import { useProgression } from './progression/progressionStore';
import { pixiFx } from './pixiFx';
import { ensureDefsReady, playDef } from './fx/playDef';
import { livePlaysSnapshot } from './fx/fxBudget';
import { combatSide, makeRng, simulate } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { FAN_PARTICLE_BUDGETS } from './fx/fanBudget';
import { useSpectatorEnd } from './live/spectatorEnd';

/**
 * PROD-BUILD BENCH HANDLES (perf report 2026-09-30). `docs/performance.md`'s rule is that a slowness number only
 * counts against the PRODUCTION build, but every FX/store console handle is DEV-only, so a prod bundle could not
 * be driven into a measured scene. Built with `VITE_PERF_BENCH=1` (`npm run build:web` with the variable set),
 * this puts `window.__bench` on the page: the store, the FX overlay and `playDef`. Player builds never set the
 * variable, and the static check lets Rollup drop the whole block (the same shape as `VITE_CRATE_PREVIEW`).
 */
export function installPerfBench(): void {
  if (import.meta.env.VITE_PERF_BENCH !== '1' || typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>).__bench = {
    store: useGame,
    // The progression store (UI refinement 2026-10-16): a bench capture can show the signed-in menus (Collection plaque).
    progression: useProgression,
    // The spectator's end notice (phone menus pass 2026-10-24): a bench capture can show it without watching a game.
    spectatorEnd: useSpectatorEnd,
    pixiFx,
    playDef,
    ready: ensureDefsReady,
    livePlays: livePlaysSnapshot,
    // A hand-built fight for a combat measurement (Gasket's 7v7, 2026-10-11): `simulate` a chosen pair of boards and
    // drop the result into a throwaway run's `lastCombat`, so a prod bundle can replay exactly the scene under test.
    combat: { simulate, makeRng, combatSide, cards: CARD_INDEX },
    // The per-def fan budgets (`fx/fanBudget.ts`), writable on a bench build only, so one bundle can A/B a budget.
    fanBudgets: FAN_PARTICLE_BUDGETS as Record<string, number>,
    // VERSUS end-to-end (2026-10-24, Versus Group phase 3): the session store and its actions, the spectate store, and the
    // sim (its public entrypoint), so a bench build can be driven through a whole live match by CDP. Loaded on demand.
    versus: () => import('./versus/versusStore'),
    spectate: () => import('./versus/spectate'),
    sim: () => import('@game/sim'),
    db: () => import('./remoteBoards').then((m) => m.supabaseClient()),
  };
}
