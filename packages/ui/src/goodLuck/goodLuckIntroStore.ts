import { useSyncExternalStore } from 'react';

/**
 * THE "GOOD LUCK" INTRO — whether it is playing (owner ask 2026-09-24: *"after the player hits start game in
 * the hero ceremony ... go from the ceremony to a dimmed board and text should fade in with some sparks and a
 * shine from left to right, then fade to the game screen and the clock begins."*).
 *
 * A tiny external store, like `turnClock`, and for the same reason: this is presentation state, not game
 * state. Nothing in the sim knows the intro exists, nothing is saved, and the reducer is never told. The one
 * thing it gates is the recruit turn clock, which is itself UI-only (the engine is untimed): Recruit folds
 * `useGoodLuckIntroActive()` into the countdown's pause gate, so the turn does not tick while the words are up
 * and starts at full time the moment they go (see `turnClockMayTick`).
 *
 * `begin` is called by the launch curtain right after `pickHero` builds the run, and only when
 * `shouldPlayGoodLuckIntro` says this start qualifies. `end` is called by the overlay when it finishes or is
 * skipped (Esc / click), and on its unmount, so the clock can never be left held.
 */
let active = false;
/** Bumped on every `begin`, so the overlay restarts its timeline even when a replay lands mid-play. */
let seq = 0;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());

export const goodLuckIntro = {
  isActive: (): boolean => active,
  seq: (): number => seq,
  begin: (): void => {
    active = true;
    seq += 1;
    emit();
  },
  end: (): void => {
    if (!active) return;
    active = false;
    emit();
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Whether the intro is up. Re-renders the caller only when it flips (twice per game start). */
export function useGoodLuckIntroActive(): boolean {
  return useSyncExternalStore(goodLuckIntro.subscribe, goodLuckIntro.isActive, goodLuckIntro.isActive);
}

/** The play counter, for the overlay to key its timeline on. */
export function useGoodLuckIntroSeq(): number {
  return useSyncExternalStore(goodLuckIntro.subscribe, goodLuckIntro.seq, goodLuckIntro.seq);
}

/** The run fields the decision reads — a structural slice, so tests need no full RunState. */
export interface GoodLuckRunSlice {
  mode?: string;
  sandbox?: boolean;
  wave: number;
}

/**
 * Does THIS game start get the intro? Only a real new game from the hero ceremony: a rated lobby or Practice,
 * on its opening turn. Never the tutorial (it has its own coaching and an untimed clock), never the Scene
 * Builder sandbox, never a replay. Save & Continue never reaches here at all: it does not pass through the
 * ceremony or the launch curtain, which is the only caller.
 *
 * Legacy `ascent` / `rift` runs are left out on purpose: the owner's ask is the lobby game start, and those
 * modes are not the front door any more.
 */
export function shouldPlayGoodLuckIntro(run: GoodLuckRunSlice | null | undefined, opts: { replaying?: boolean } = {}): boolean {
  if (!run || opts.replaying) return false;
  if (run.sandbox) return false;
  if (run.mode !== 'lobby' && run.mode !== 'practice') return false;
  return run.wave === 1;
}

/** Test-only: reset the module state between specs. */
export function resetGoodLuckIntroForTests(): void {
  active = false;
  seq = 0;
  listeners.clear();
}
