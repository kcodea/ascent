/**
 * THE ANCIENTS RELEASE SWITCH, as the menu reads it (Learn Ancients, 2026-11-16).
 *
 * The one place the UI asks "are Ancients live?" for the first-login prompt and the tutorial's closing line.
 *
 * TODO(ancients-release-switch): the real switch (`ancientsLive()` in `@game/sim`, branch
 * `feat/ancients-release-switch`) had not landed on `origin/main` when this was written. Once it does, replace the
 * body below with `return ancientsLive();` and delete the test override. Until then this reads OFF, which is also
 * what the switch ships as (owner 2026-11-16: "Ship the ancient switch off").
 */
let testOverride: boolean | null = null;

export function ancientsLiveForPrompt(): boolean {
  if (testOverride !== null) return testOverride;
  return false;
}

/** Tests only: force the switch (null restores the real reading). */
export function setAncientsLiveForTests(live: boolean | null): void {
  testOverride = live;
}
