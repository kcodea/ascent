/**
 * HALL OF CHAMPIONS VISIBILITY (owner 2026-10-16: "can you hide the hall of champions for now? it's not a very
 * important view at the moment"). One switch: `false` takes the Hall off the side menu, sends any open request for it
 * (`goTo('hall')`, `openLeaderboard`) to the player Leaderboard instead, and skips its idle prefetch. The screen, its
 * data and its tests are untouched; flip this to `true` to bring it back.
 */
export const HALL_VISIBLE: boolean = false;
