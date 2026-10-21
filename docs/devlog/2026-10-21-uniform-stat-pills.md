# 2026-10-21 - Uniform cards and stat pills on stored boards

Owner ask: "look at the card and dmg/health pills in career vs. recent games, also make those uniform size. the
discrepancy looks sloppy. make sure these look pristine and uniform".

## Why they differed

Both surfaces render the same `StoredTeam` inside the shared `GameCard` detail layout, but:

1. **Card size came from the panel.** `.gc.gc-detail .gc-board .cv2-team` derived `--tw` from its container
   (`min(170px, (100cqw - 280px) / 7)`). The Career's centre column is narrower than Recent Games' detail panel,
   so the same board drew 70px cards in the Career and 110px cards in Recent Games (at 1920 x 1080).
2. **The milestone pill is fixed px.** `.badge > .msframe` is `60px * --msf-scale` and the framed number is
   `--msnum-size` (26px) everywhere, tuned for the ~184px in-play card. On a 70px Career card the 60px pills
   collided with each other ("200148"); on a 110px card they looked fine.
3. **Per-number shrink.** `statFit` steps a 4+ glyph number down per badge, so 1160 printed smaller than 886 beside it.

## Fix (CSS + one StoredTeam attribute, no gameplay change)

- `styles.css`, detail board: one fixed card size, `--tw: min(100px, (100cqw - 28px) / 8.2)` with a gap of
  `0.2 * --tw`. The stage lays out at 1920 x 1080 and scales as a whole, so 100px is the same on every screen; it is
  the largest that fits the Career's centre column (860px). The min() only matters in a narrower host.
- `styles.css`, `.cv2-tile .card`: on every stored board the pill is sized from its card, `--pill = 0.62 * --ccw`,
  for every milestone tier (frame, glow, tint) and the flat plate, with the number at the in-play 26/60 of the disc.
- `StoredTeam.tsx`: `boardStatFit` stamps the strip with the fit bucket of its LONGEST printed number
  (`data-fit` on `.cv2-team`), and `.cv2-team[data-fit]` gives every badge on that board the same step.

Surfaces using `StoredTeam` get the proportional pills and the board-wide number size: Career, Recent Games, the
post-game Match details scoreboard, Career trends, and the Versus match stats (CSS only, no Versus file touched).
Only the two detail boards share the fixed 100px card size; the post-game and trends strips keep their own card sizes.

Measured with a mocked backend (headless Chrome, every Supabase request answered locally): 1920 x 1080 both
surfaces 85px arch, 53px pill, 18.3px number; 1366 x 768 both 60px arch, 37px pill (stage-scaled).
