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

**Follow-up (owner, same day).** Settings > Game > "Achievement pop-ups" (on by default, `achievementToastPrefs.ts`,
localStorage `ascent.achievementPopups`; in both the shell PhSettings and the classic EscMenu page) turns off both feeds
and empties the queue. A chime plays as each toast ducks in: `audio/achievement.mp3` (10.7 KB, 1.28 s, 44.1 kHz 64 kbps,
ElevenLabs sound effects, candidate 2 of 3: no clipping, a ~0.6 s rising body then a clean decay to silence), on the `ui`
bus as its own `achievement` fader (0.5), a core clip so it decodes with the bank; synth triad fallback.

**Judgement calls.** Duos and Versus get only the end-of-game toasts; a toast is a
forecast (the server can still refuse a run's facts, e.g. a metric over its cap is dropped on both sides).
