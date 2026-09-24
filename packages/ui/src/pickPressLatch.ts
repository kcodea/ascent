/**
 * THE PICK-PRESS LATCH — the pure half of `sfx.pickPress` / `sfx.discoverSelect`.
 *
 * Pressing an offer's option (a Discover card, a Choose One option, a Rune in the forge) plays the pick cue on the
 * PRESS, in place of the click thock (owner 2026-09-24: "i want the click sound replaced by this new sound"). The
 * pick that press leads to must then stay silent, or the cue plays twice. The press ARMS this latch; the next
 * committed pick CONSUMES it. Only that one pick is silenced, and only within the window: past it, the release was a
 * cancel, and a later pick (a tap, a key, a replay, none of which press first) plays its cue as it always did.
 */

/** How long a press speaks for the pick that follows it. */
export const PICK_PRESS_WINDOW_MS = 1500;

export interface PickPressLatch {
  /** An option was pressed (its cue just played). */
  arm(): void;
  /** A pick was committed: true (and disarmed) if a press already played its cue, so this pick stays silent. */
  consume(): boolean;
}

export function createPickPressLatch(now: () => number = () => performance.now()): PickPressLatch {
  let armedAt = -Infinity;
  return {
    arm(): void {
      armedAt = now();
    },
    consume(): boolean {
      const armed = now() - armedAt < PICK_PRESS_WINDOW_MS;
      armedAt = -Infinity;
      return armed;
    },
  };
}
