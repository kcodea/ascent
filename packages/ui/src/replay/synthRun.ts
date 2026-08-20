/**
 * REPLAY V2 (Phase B — playback): rebuild the run-shaped object the recruit render tree reads from a
 * recorded `ShopView`. Playback is a PURE RENDERER (docs/replay-v2-handoff.md §3): the result is never
 * reduced and never simulated — dispatch is guarded off while a replay runs — so the engine-only fields
 * the capture stripped just need harmless, non-crashy defaults, not valid engine state.
 */
import type { RunState, ShopView } from '@game/sim';

/**
 * Re-attach what `SHOP_VIEW_EXCLUDED_KEYS` stripped at capture (see packages/sim/src/replayV2.ts):
 * - `phase` is stamped `'recruit'` (a ShopFrame is by definition a recruit-phase moment).
 * - `servedBoards` is re-seated from the recorded `nextFoe`, so `nextOpponent(run)`'s pin path always wins
 *   during playback and never falls through to TODAY'S pool (the §2 content-drift hole).
 * - The engine-only fields (`pool`, `rngCursor`, `pendingTavern`, `runDamage`, `runProcs`) get empty
 *   defaults — nothing in the recruit render tree reads them (that is why they were excluded), but they are
 *   REQUIRED RunState keys, so they must exist for the object to be RunState-shaped at all.
 * - `lastCombat` / `discoverQueue` / `fodderSchedule` / the tutorial scripts are optional keys and stay
 *   absent — exactly the shape of a fresh non-tutorial run.
 */
export function synthRunFromShopView(view: ShopView): RunState {
  const { nextFoe, ...rest } = view;
  return {
    ...rest,
    phase: 'recruit',
    // Only [wave] ever renders during recruit (OpponentFrame via nextOpponent's pin path) — and only for
    // non-lobby runs (lobby pairs from seats; `nextFoe` is captured null there).
    ...(nextFoe !== undefined ? { servedBoards: { [view.wave]: nextFoe } } : {}),
    pool: {},
    pendingTavern: [],
    rngCursor: 0,
    runDamage: {},
    runProcs: {},
    // The synthetic run is a render target only — nothing reduces it (the store's dispatch is guarded), so
    // it does not need to be a VALID engine state, just complete enough for every recruit-tree read. This
    // cast is the one sanctioned boundary where that difference is papered over.
  } as RunState;
}
