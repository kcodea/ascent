import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { prefersReducedMotion, runEntrance, type EntranceHandle } from './entrance';

/**
 * THE DISCOVER ENTRANCE, as a hook for an offer overlay (the Discover, the Choose One, the tuner's sandbox).
 *
 * ── When it plays ─────────────────────────────────────────────────────────────────────────────────────────────
 *  · An offer OPENS (a new `occasion`): the full entrance. Each Discover of a chain (Disco Dan's T6 → T4 → T2, a
 *    golden's queued pair, Prismatic Pick's follow-up) is its own occasion, so each plays its own entrance.
 *  · RESTORED from Minimize ("Return to Discover"): the overlay remounts with an occasion it has already shown, so
 *    nothing flies, puffs or sounds; the overlay's own 200 ms scrim fade (`.discover-ov`'s `fadein`) is all.
 *  · Any other remount or re-render: nothing. The occasion is remembered below, not in the component.
 * The overlays only ever mount once the combat wipe (and a pending shop death) has let go (`discoverHeld`), so the
 * entrance, and its open cue, never play behind a curtain.
 */

/** A remount this soon after a mid-play teardown is React StrictMode's dev re-run, which must replay the opening. */
const REMOUNT_REPLAY_MS = 50;
const openings = new Map<string, { done: boolean; tornAt: number }>();
function remember(key: string, entry: { done: boolean; tornAt: number }): void {
  openings.delete(key);
  openings.set(key, entry);
  if (openings.size > 24) openings.delete(openings.keys().next().value as string);
}
function shouldPlay(key: string | null): boolean {
  if (key === null) return true;
  const e = openings.get(key);
  if (!e) return true;
  if (e.done) return false;
  return Date.now() - e.tornAt < REMOUNT_REPLAY_MS;
}
/** Test-only. */
export function resetOfferEntranceMemoForTests(): void {
  openings.clear();
}

export interface OfferEntrance {
  /** Attach to the overlay root's `onPointerDownCapture`: a press while the entrance plays settles it. Returns
   *  true when the press arrived while it was playing on something other than an ARRIVED card (a caller with its
   *  own backdrop press, the Choose One's click-away cancel, must then ignore that press). */
  onPressCapture: (e: ReactPointerEvent<HTMLElement>) => boolean;
  /** A pick may register on option `i` (it is not in flight). A blocked pick settles the entrance instead. */
  canPick: (i: number) => boolean;
}

/**
 * Run the entrance on `rootRef`'s element whenever `occasion` changes (null = play on every mount, the sandbox).
 * `openCue` plays the Discover open sound as part of it. `speed` compresses it (a replay).
 */
export function useOfferEntrance(
  rootRef: RefObject<HTMLElement>, occasion: string | null, opts: { openCue?: boolean; speed?: number } = {},
): OfferEntrance {
  const handleRef = useRef<EntranceHandle | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Layout effect: every animation is scheduled before the overlay's first paint (a card must never flash at rest
  // for one frame and then jump away to fly in).
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !shouldPlay(occasion)) return;
    const key = occasion;
    const h = runEntrance(root, {
      speed: optsRef.current.speed, openCue: optsRef.current.openCue, reduced: prefersReducedMotion(),
      onDone: () => { if (key !== null) remember(key, { done: true, tornAt: 0 }); },
    });
    if (key !== null) remember(key, { done: false, tornAt: Number.POSITIVE_INFINITY });
    handleRef.current = h;
    return () => {
      const unfinished = h.isRunning();
      h.cancel();
      // `cancel` settles, which marks it done. A teardown MID-play stamps its time instead, so only an immediate
      // StrictMode re-run replays it; anything later (Minimize during the flight, then Return) shows it settled.
      if (unfinished && key !== null) remember(key, { done: false, tornAt: Date.now() });
      if (handleRef.current === h) handleRef.current = null;
    };
  }, [occasion, rootRef]);

  const api = useRef<OfferEntrance | null>(null);
  if (!api.current) {
    api.current = {
      onPressCapture: (e) => {
        const h = handleRef.current;
        if (!h || !h.isRunning()) return false;
        const slot = (e.target as Element | null)?.closest?.('.disc-slot') ?? null;
        const onArrived = !!slot && (slot as HTMLElement).dataset.dce !== 'flying';
        h.skip();
        return !onArrived;
      },
      canPick: (i) => {
        const h = handleRef.current;
        if (!h || !h.isRunning() || !h.isFlying(i)) return true;
        h.skip();
        return false;
      },
    };
  }
  return api.current;
}

/**
 * Which Discover this is, as the entrance's occasion key. The run has no Discover counter, so it is derived: the
 * run (seed), the turn (wave), the hand and board sizes, the queue behind it and the offer itself. Each step of a
 * chain changes it (a pick lands in the hand and the queue shrinks), while Minimize / Return, a re-render or a
 * remount leave it alone. The reducer blocks every other board action while a Discover is open, so nothing else
 * can move these under an open offer.
 */
export function discoverOccasion(run: {
  seed: number | string; wave: number; hand: readonly unknown[]; board: readonly unknown[];
  discover?: readonly string[] | undefined; discoverQueue?: readonly unknown[] | undefined;
}): string {
  return `${run.seed}:${run.wave}:${run.hand.length}:${run.board.length}:${run.discoverQueue?.length ?? 0}:${(run.discover ?? []).join(',')}`;
}
