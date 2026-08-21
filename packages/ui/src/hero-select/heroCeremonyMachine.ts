/**
 * HERO SELECT CEREMONY — the phase machine (hero-select-ceremony-blueprint.md §5).
 *
 * A pure reducer over an explicit phase enum, NOT a collection of booleans. The component layer owns the
 * timers and animations; this module owns which transitions are legal, so "can the player launch twice" is a
 * unit-testable question rather than an emergent property of setTimeout ordering.
 *
 * Contract (§5):
 *  - Phases only advance forward along `CEREMONY_ORDER`; nothing returns to `idle` except a full `reset`
 *    (unmount / dev reset).
 *  - Only `idle` accepts a hero click. Only `ready` accepts Start Game. Everything else ignores input.
 *  - `launching` is terminal and can be entered exactly once — the guard that makes double-run-creation
 *    structurally impossible rather than merely debounced.
 */

export type HeroCeremonyPhase =
  | 'idle'
  | 'committed'
  | 'dismissing'
  | 'focusing'
  | 'voicing'
  | 'materializing'
  | 'ready'
  | 'launching';

/** The only legal forward path. `advance` may only step to the NEXT phase in this list. */
export const CEREMONY_ORDER: readonly HeroCeremonyPhase[] = [
  'idle', 'committed', 'dismissing', 'focusing', 'voicing', 'materializing', 'ready', 'launching',
];

/** Plain numeric geometry — never store a live DOMRect (§8): the values are snapshotted once at click time
 *  and must survive serialization into state without aliasing layout. */
export interface RectSnapshot {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface HeroCeremonyState {
  phase: HeroCeremonyPhase;
  heroId: string | null;
  sourceRect: RectSnapshot | null;
  /** Index of the clicked card in the choice row — drives exit stagger for the others. */
  sourceIndex: number;
  /** performance.now() at commit; null while idle. */
  startedAt: number | null;
}

export const CEREMONY_IDLE: HeroCeremonyState = {
  phase: 'idle', heroId: null, sourceRect: null, sourceIndex: -1, startedAt: null,
};

export type HeroCeremonyEvent =
  /** A hero card was clicked. Accepted ONLY in `idle`. */
  | { type: 'select'; heroId: string; rect: RectSnapshot; index: number; now: number }
  /** The sequence runner reached the next timed beat. Accepted only as the single legal forward step. */
  | { type: 'advance'; to: HeroCeremonyPhase }
  /** Start Game pressed. Accepted ONLY in `ready`. */
  | { type: 'startGame' }
  /** Full cancellation: unmount or dev reset. The only road back to `idle`. */
  | { type: 'reset' };

/** True when `to` is exactly one step after `from` on the ceremony path. */
export function isLegalAdvance(from: HeroCeremonyPhase, to: HeroCeremonyPhase): boolean {
  const i = CEREMONY_ORDER.indexOf(from);
  return i >= 0 && CEREMONY_ORDER[i + 1] === to;
}

/**
 * The reducer. Illegal events return the SAME state object (referential no-op), so callers can cheaply
 * detect "nothing happened" — and so a stray timer firing after a reset can never resurrect the ceremony.
 */
export function ceremonyReduce(s: HeroCeremonyState, ev: HeroCeremonyEvent): HeroCeremonyState {
  switch (ev.type) {
    case 'select': {
      if (s.phase !== 'idle') return s; // a second click during the ceremony is ignored, not queued
      return { phase: 'committed', heroId: ev.heroId, sourceRect: ev.rect, sourceIndex: ev.index, startedAt: ev.now };
    }
    case 'advance': {
      // `startGame` is the only way into `launching`; `advance` may not skip past `ready`.
      if (ev.to === 'launching') return s;
      if (!isLegalAdvance(s.phase, ev.to)) return s;
      return { ...s, phase: ev.to };
    }
    case 'startGame': {
      if (s.phase !== 'ready') return s; // early/late presses (and repeats after launch) are ignored
      return { ...s, phase: 'launching' };
    }
    case 'reset':
      return CEREMONY_IDLE;
  }
}

/** Convenience guards the components read instead of comparing phase strings inline. */
export const ceremonyActive = (s: HeroCeremonyState): boolean => s.phase !== 'idle';
export const ceremonyAcceptsClicks = (s: HeroCeremonyState): boolean => s.phase === 'idle';
export const ceremonyCanLaunch = (s: HeroCeremonyState): boolean => s.phase === 'ready';
