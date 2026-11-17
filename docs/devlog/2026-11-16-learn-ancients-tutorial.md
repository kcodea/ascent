# 2026-11-16 — Learn Ancients: the two minute Ancients lesson + its first-login prompt

Owner ask: a very short Ancients tutorial in Learn, prompted once when a player first reaches the menu after Ancients
are switched on. Mid game (turn 8), Warden, a board of Dragons, the meter at 14 of 16, "roll twice", the full
awakening, pick one that pays off this turn, then End combat fades to "Good luck!" and back to the menu.

How it is built (no fake screens, the real reducer throughout):
- **Course data** `packages/sim/src/tutorial/learnAncients.ts` (one authored turn). New, generic tutorial pieces:
  `TutorialCourse.midGame` (start state), `TutorialCourse.outro` (the closing card), `TutorialStep.onlyIf` (a branch
  step skipped when it does not apply), predicates `ancientAwakened` / `ancientPicked`, UI anchor `ancient-meter`.
- **`createCourseRun`** (`tutorial/courseRun.ts`) turns `midGame` into an ordinary `tutorial` RunState: wave 8, Tier 4,
  the board, the scripted Shop lined up by wave, Ancients on for this run only (`enableAncients`, points 14), and an
  authored lobby on round 8 with two seats out. `maxRounds` sits past the round, so End combat never ends the lobby.
- **The offer is not scripted in code.** The pinned seed `20261139` is one whose turn-8 awakening draws War, Bonds,
  Time; `learnAncientsCourse.test.ts` pins it, so a change to the draw fails loudly.
- **Steered pick: Bonds.** Two Ward Dragons from the start (Earthbreaker, Transcendant; owner 2026-11-16). One Aegis on Earthbreaker: both gain stats from Aegis,
  so Bonds fires twice and each ends +10 Attack (8 to 18), in the Shop, at once. War and Time get their own branch
  ("That works too..."), never a dead end.
- **Controller** (`TutorialController.tsx`): skips `onlyIf` steps, hides the coach while the awakening plays (its
  stage store), counts only the steps this player will see, and on a course with an outro arms a hook so End combat
  (Recruit's `endCombat`, one guarded line) goes straight to `CourseOutro` instead of the curtain back to a Shop.
  `CourseOutro` reuses the Good Luck intro's words, flourishes and glow; it then opens the title and drops the run.
- **Prompt** (`tutorial/AncientsPrompt.tsx`): the title's own "Try the Tutorial" card. Once per player (device key
  plus per-account key, local only), only while the switch is on, never for a new player, over another dialog, off
  the main menu, or with a saved game (a lesson replaces the save slot).

Release switch: `feat/ancients-release-switch` was not on origin when this was built, so the menu reads it through
`ancientsLiveForPrompt()` (`packages/ui/src/tutorial/ancientsLive.ts`, reads OFF) with a TODO to return
`ancientsLive()` from `@game/sim` once that lands. Oracle R-LEARN-ANCIENTS-01/02.
