# 2026-11-20: achievements duck in from the left mid-game

**Owner ask:** "can we add something mid-game when it unlocks? so it shows when you get achievements done mid game
etc? this should prob span all achievements where possible. it should just like duck in from the left side and say
the achievement you got."

**What.** A navy/gold toast slides in from the left edge ("Achievement unlocked", name, XP, title/cosmetic reward),
holds ~3 s, slides out; a queue plays several in turn. Oracle: R-ACH-TOAST-01 (foundation.ts).

**How.**
- `packages/progression/src/midRunAchievements.ts` (`midRunUnlockedAchievements`): feeds the run observer's metrics so
  far through the real `evaluateAchievements` (so the gates cannot drift from the settlement), over only the defs a
  game in progress can know: a RUN metric that only grows, no placement gate, not `account`/`tutorial` mode, and not
  one of `END_STATE_RUN_METRICS` (final board counts, last combat Echoes, Menagerie, tribal rune pair, undefeated).
  `sum` defs add the stored progress, and are skipped when it is unknown. Hero gates apply to Ranked only (the SQL
  reads the hero only for Ranked). Today: 124 of 483 defs can fire mid-game (33 of them lifetime totals).
- `packages/ui/src/progression/achievementToasts.ts`: listens for `replayActions` changing (one per player action,
  never set by spectating), checks on idle time, skips when the metrics did not move. Gate: rated lobby or standard
  Practice (Normal Health + timer); never sandbox / God Mode / Duos / tutorial / Gauntlet / Versus / replay / watched
  game. Baseline = completions + own progress read once per game (retired list once per session); no read without a
  signed-in account with achievements on. Shown ids persist per game seed in localStorage so a reload never repeats.
- End of game: the confirmed (non-duplicate) settlement's `result.achievements`, minus the ids already shown for that
  game's `localKey`, go into the same queue. That covers placements, server metrics and the final board.
- `AchievementToast.tsx` + `achievementToast.css`: one one-shot transform/opacity keyframe, `pointer-events: none`,
  z-index 488 (over the Friends dock, under the Settings veil).

**Judgement calls.** No sound; no Settings toggle; Duos and Versus get only the end-of-game toasts; a toast is a
forecast (the server can still refuse a run's facts, e.g. a metric over its cap is dropped on both sides).
