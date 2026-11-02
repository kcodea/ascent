# 2026-11-01 · Gold Fuse threshold by medal + the fuse break

Owner ask 2026-11-01: *"Bronze = 10 gold, Silver = 10 gold, Gold = 7 gold, Platinum = 5 gold, Diamond = 5 gold,
Ascendant = 3 gold"* and *"add an animation for when the gold fuse breaks and the timer starts"*. Branch
`feat/gold-fuse-by-medal`. Rule **R-TIMER-FUSE-02** (approved/foundation.ts); R-TIMER-FUSE-01's statement amended
(its flat "10 Gold" and "rank never changes the clock" now defer to -02).

## What

- `goldClock.ts`: `FUSE_GOLD_BY_MEDAL` + `fuseGoldOf(run)`. `goldClockOf` returns `{ gold: fuseGoldOf(run), seconds }`;
  only a `lobby` reads `run.medalAtStart` (the existing pin, stamped once by `pinMedalAtStart` in `pickHero` /
  `newRun`), so a mid-game promotion, Save & Quit, cloud resume and replay keep the starting threshold. No pin
  (unrated table, Practice, pre-pin runs, unknown medal string) = `FUSE_GOLD` 10. Seconds unchanged; Gauntlet 30/60
  unchanged. Every reader already went through `goldClockOf` (Recruit's start effect + `ShopTimer` `goldGoal`, the
  store's Thymepiece stamp, StatusBar's sell-window readout), so the bar's `0/N` label follows with no other change.
  Nothing in `packages/sim`, `workers/` or Supabase assumes 10 (the clock is presentation-only). Ranked Duos / Versus
  use the live server clock (`goldClockOf` is null for `versus`), so they are untouched.
- The break (`goldFuseBreak.ts` + `goldFuseBreak.css`, new def `fx/defs/gold-fuse-break.json`): `useGoldFuseBreak`
  watches the run's Gold spent vs the threshold and fires only on a crossing seen while mounted (`fuseBroke`: same
  goal, prev under, next at/over). Baseline = the mount's own reading, so a restore of a lit turn never replays it,
  and a Practice timer change that relights a paid fuse doesn't either. Keyed on Gold, not the clock value, because
  the turnClock store can carry a stale parked value into a fresh mount for one render. Phases: `snap` 360 ms (the
  `ShopTimer` keeps the bar up: the full fill as two halves that kick apart and fade, a flash, one rect read for the
  Pixi spark at the bar's centre), then `punch` 440 ms (the digits scale in with a small overshoot, the clock icon
  nudges). Transform/opacity keyframes only, nothing loops (pinned by a CSS scan in the test). The plate, colours and
  fonts are not touched (a concurrent pill restyle owns them).
- DEV: `window.dispatchEvent(new Event('ascent:fusebreak'))` replays the break on the live plaque (no tuner owns the
  shop clock).

## Judgement calls

- Practice never reads a medal (stays 10) even though it has an Opponent Rank picker.
- The break plays in the Gauntlet too (same plaque).
