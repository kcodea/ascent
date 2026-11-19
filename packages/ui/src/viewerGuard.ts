/**
 * A VIEWER'S PRESS DOES NOTHING (R-SPECTATE-INERT-01, owner report 2026-11-18: "when spectating, spectators shouldnt be
 * able to hit the end turn gem etc ... the combat ended and the player died and i could hit the gem which took me to
 * their shop with them at 0 hp").
 *
 * The screen is a viewer's while the store's run is not this player's to act on: a recorded replay, a live watch screen,
 * the Duos teammate view. Recruit marks that ONE way, the `viewing` class on `.app` (see `viewing` in Recruit.tsx), and
 * the stylesheet takes the pointer off every control under it (styles.css, hitShapes.css). The store already swallows
 * every `dispatch` there, but a board control does more than dispatch: its strike / relight / press sound, and End
 * Combat's exit curtain, are all local presentation. This is the same gate for every way a press can still arrive
 * (keyboard focus + Enter / Space, a synthetic click, a hit layer a later stylesheet turns back on): the board buttons
 * ask it first and do nothing at all.
 *
 * It reads the class (one ancestor walk on a press, no layout, no store import), so the pointer rule and this one can
 * never disagree about which screen is a viewer's.
 *
 * The watched player's own presses still play on the watch screen: they arrive as press cues (`pressCue.ts`), never
 * through a click.
 */
export function viewerPress(el: Element | null | undefined): boolean {
  return !!el?.closest('.app.viewing');
}
