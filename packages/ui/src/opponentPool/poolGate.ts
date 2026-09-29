/**
 * THE LOBBY POOL GATE (fix 2026-09-28). A lobby that seats recorded player runs must not be built before the
 * opponent pool has loaded, or every seat silently falls back to a generated one (the seed-309102059 lobby).
 *
 * The launch curtain calls `run()` under full cover, before `pickHero()` builds the run:
 *  - the pool is already loaded (the usual case: it loads at startup)  -> 'go' at once, nothing shown;
 *  - still loading, or the last load failed                              -> phase 'waiting' ("Finding
 *    opponents..."), with Cancel, while the loader retries on a longer budget;
 *  - that retry genuinely fails (offline)                                -> phase 'failed', with Retry,
 *    Play anyway and Back to menu. Nothing falls back silently.
 *
 * "Play anyway" builds the lobby with generated seats, and such a lobby is UNRATED (owner 2026-09-28:
 * "offline = unrated"): `lobbyIsUnrated` marks it at creation from the seat kinds, the client submits no rank,
 * and `submit-rating` refuses an all-generated set of seat keys.
 */
import type { PracticeConfig, RunMode } from '@game/sim';
import type { PoolLoader } from './poolLoader';

export type GatePhase = 'idle' | 'waiting' | 'failed';
export type GateOutcome = 'go' | 'cancel';

/** Does a launch in this mode seat recorded player runs (and so need the pool)? Bots-only Practice, the
 *  tutorial and the non-lobby modes do not. */
export function poolNeededFor(mode: RunMode | undefined, practice?: Pick<PracticeConfig, 'opponents'>): boolean {
  if (mode === 'lobby') return true;
  if (mode === 'practice') return (practice?.opponents ?? 'players') === 'players';
  return false;
}

export interface PoolGate {
  phase(): GatePhase;
  subscribe(fn: (p: GatePhase) => void): () => void;
  run(): Promise<GateOutcome>;
  retry(): void;
  playAnyway(): void;
  cancel(): void;
}

export function createPoolGate(getLoader: () => PoolLoader | null): PoolGate {
  let phase: GatePhase = 'idle';
  let settle: ((o: GateOutcome) => void) | null = null;
  let token = 0;
  const listeners = new Set<(p: GatePhase) => void>();
  const setPhase = (p: GatePhase): void => { phase = p; for (const fn of listeners) fn(p); };
  const finish = (o: GateOutcome): void => {
    token++; // any ensure() still in flight is now stale
    const s = settle;
    settle = null;
    setPhase('idle');
    s?.(o);
  };
  const attempt = (): void => {
    const loader = getLoader();
    if (!loader) { finish('go'); return; }
    const mine = ++token;
    setPhase('waiting');
    void loader.ensure().then((s) => {
      if (mine !== token) return; // cancelled or superseded
      if (s.status === 'ready') finish('go');
      else setPhase('failed');
    });
  };
  return {
    phase: () => phase,
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    run() {
      const loader = getLoader();
      if (!loader || loader.state().status === 'ready') return Promise.resolve('go');
      if (settle) finish('cancel'); // a stale gate (should not happen: launches are serialized)
      const p = new Promise<GateOutcome>((resolve) => { settle = resolve; });
      attempt();
      return p;
    },
    retry() { if (settle && phase === 'failed') attempt(); },
    playAnyway() { if (settle && phase === 'failed') finish('go'); },
    cancel() { if (settle) finish('cancel'); },
  };
}
