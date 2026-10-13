/**
 * THE RANKED GATE — the seam between the Title (which asks for the gate) and the gate itself, mounted in Game.
 *
 * The gate has to outlive the Title: "Yes, let's go." closes the confirmation, the doors slam over the mode picker,
 * and ONLY THEN is the screen behind them swapped for hero select (`onShut`, which unmounts the Title). So the
 * sequence cannot live in the Title. Same shape as `hero-select/heroLaunchController.ts`: the mounted gate
 * registers one function; callers never learn whether a gate exists.
 *
 * THE END-GAME GATE (owner 2026-10-13) asks for the same doors from the combat screen, as the `end` variant: no
 * crystal, and the end screen is what is swapped in behind them (endGameGate.ts).
 *
 * THE CONTRACT: `onShut` is called EXACTLY ONCE, whatever happens. With no gate mounted (a test, a broken build),
 * with reduced motion, or if the gate throws, it runs at once: the animation may be lost, the player's "Yes" never.
 */

import type { RankedGateVariant } from './rankedGateTiming';

/** Plays the gate. Must call `onShut` once the doors are shut, and resolve when the sequence has ended. */
export type RankedGateFn = (onShut: () => void, variant: RankedGateVariant) => Promise<void>;

let controller: RankedGateFn | null = null;
/** The sequence in flight, if any: a second press joins it instead of starting another gate. */
let inFlight: Promise<void> | null = null;

/** The gate registers itself on mount and unregisters (pass null) on unmount. */
export function registerRankedGate(fn: RankedGateFn | null): void {
  controller = fn;
}

/**
 * Play the gate, then run `onShut` behind the shut doors. Resolves when the doors have opened again. Never
 * rejects. A call made while a gate is already playing joins it and its `onShut` is dropped (the first one owns
 * the swap). `variant`: `entry` (the default) is the start of a ranked match, with the crystal; `end` is the fight
 * that ends a game.
 */
export function requestRankedGate(onShut: () => void, variant: RankedGateVariant = 'entry'): Promise<void> {
  if (inFlight) return inFlight;
  let done = false;
  const once = (): void => {
    if (done) return;
    done = true;
    onShut();
  };
  if (!controller) {
    once();
    return Promise.resolve();
  }
  let run: Promise<void>;
  try {
    run = controller(once, variant);
  } catch (err) {
    run = Promise.reject(err);
  }
  inFlight = run
    .catch((err) => { console.warn('[rankedGate] the gate failed; continuing without it', err); })
    .finally(() => { inFlight = null; once(); });
  return inFlight;
}

/** Test-only: clear the module state between specs. */
export function resetRankedGateForTests(): void {
  controller = null;
  inFlight = null;
}
