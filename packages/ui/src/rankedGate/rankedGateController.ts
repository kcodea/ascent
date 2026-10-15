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

/**
 * VERSUS (owner 2026-10-14: "the normal lobby gate close with the crystal") — optional, entry gate only. Absent, the
 * gate is exactly the ranked one.
 *  - `onPress`: the crystal press. The doors stay shut, the crystal held, until it resolves: `true` shatters it and
 *    opens the doors on whatever it swapped in behind them; `false` opens them quietly (no shatter) on what is there.
 */
export interface RankedGateOptions {
  onPress?: () => Promise<boolean>;
}

/** Plays the gate. Must call `onShut` once the doors are shut, and resolve when the sequence has ended. */
export type RankedGateFn = (onShut: () => void, variant: RankedGateVariant, opts?: RankedGateOptions) => Promise<void>;

let controller: RankedGateFn | null = null;
/** Opens a playing entry gate quietly (no shatter), from outside: registered by the gate alongside `controller`. */
let canceller: (() => void) | null = null;
/** The sequence in flight, if any: a second press joins it instead of starting another gate. */
let inFlight: Promise<void> | null = null;

/** The gate registers itself on mount and unregisters (pass null) on unmount. */
export function registerRankedGate(fn: RankedGateFn | null, cancel: (() => void) | null = null): void {
  controller = fn;
  canceller = fn ? cancel : null;
}

/** VERSUS: the gate window closed (the room went back to Open) while the doors were shut: open them quietly on the
 *  screen behind, whether or not the crystal was pressed. A no-op with no gate playing. */
export function cancelRankedGate(): void {
  canceller?.();
}

/**
 * Play the gate, then run `onShut` behind the shut doors. Resolves when the doors have opened again. Never
 * rejects. A call made while a gate is already playing joins it and its `onShut` is dropped (the first one owns
 * the swap). `variant`: `entry` (the default) is the start of a ranked match, with the crystal; `end` is the fight
 * that ends a game.
 */
export function requestRankedGate(onShut: () => void, variant: RankedGateVariant = 'entry', opts?: RankedGateOptions): Promise<void> {
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
    run = opts ? controller(once, variant, opts) : controller(once, variant);
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
  canceller = null;
  inFlight = null;
}
