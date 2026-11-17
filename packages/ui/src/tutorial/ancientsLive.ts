/**
 * THE ANCIENTS RELEASE SWITCH, as the menu reads it (Learn Ancients, 2026-11-16): the first-login prompt and the
 * lesson's closing line ask here. It is the real switch, `ancientsLive()` from `@game/sim` (ships OFF); the override
 * exists only so tests (and a dev preview) can see the prompt without flipping the shipped constant.
 */
import { ancientsLive } from '@game/sim';

let testOverride: boolean | null = null;

export function ancientsLiveForPrompt(): boolean {
  return testOverride ?? ancientsLive();
}

/** Tests only: force the switch (null restores the real reading). */
export function setAncientsLiveForTests(live: boolean | null): void {
  testOverride = live;
}
