# 2026-09-28 — Match details: the lobby scoreboard on the end screen and in Career history

Asks:

- A player on Discord: "it would be cool if the end of game screen showed the match leaderboard. maybe a scoreboard
  showing the score order and each person's warboard. i placed 6th but wanted to see what everyone else looked like
  at the time of my loss".
- The owner (2026-09-28): "at the end game screen add a "match details" button to see the players in the lobby and
  the ability to click and see what their boards were when you died or won. also, i think a drop down in the match
  history to show the players in the lobby might be nice too ... let me know what looks best here".

## What shipped

- **`buildMatchDetails` (sim, `lobby/matchDetails.ts`)**: a compact record of all eight seats at the moment YOUR
  game ended (your knockout round, or the last round played). Each seat: id, name, hero, placement or none (still
  standing), knockout round, health/Armor at that moment, recorded skins, and its board: the lobby's own
  `driver.prepare(round) ?? driver.finalBoard()` for `min(its knockout round, your end round)`. Your own seat uses
  the end-state board the Career already records, your handle and your equipped title. `knockedOutBy` = the seat
  you fought in your knockout round. Minions are trimmed to what a card renders (the inspect `buffs` breakdown is
  dropped, text capped at 280 chars); a whole table measured 4.1 to 5.1 KB over five real games (hard cap 16 KB:
  text is dropped first, then trailing boards). `parseMatchDetails` reads it back tolerantly (null for absent,
  junk or a future version).
- **Recorded once, never recomputed**: `matchDetailsOf` in the store runs inside the deferred run-end blocks (ranked
  and practice), before `fightRowsOf`'s play-out, and sets `lastMatch` (keyed by seed). Recorded seats and
  Practice bot seats are pure per-round lookups; nothing re-simulates.
- **Persistence without a migration**: Ranked puts it in `run_history.entry.match` (the Career's detailed read
  already fetches the whole entry for the newest 25 rows, so it arrives with no new query); Practice puts it in the
  row's `replay` jsonb (`replay.match`) and the Practice list selects the small `match:replay->match` projection
  (the richest rung of the existing select ladder, so a backend without the `replay` column just has no details).
  No SQL steps.
- **End screen**: a "Match details" pill in the rank screen's secondary row once the sequence settles (and beside
  Rewatch on the legacy lobby end screen). It opens `MatchDetailsDialog` (portalled into the stage, Esc / close
  button / backdrop close it, focus moves in and back). On a wide-short layout (phone landscape) the dialog zooms
  1.3x into the spare width.
- **Career**: every Match History and Practice banner gets a **Lobby** chevron button (`aria-expanded`); expanding
  mounts the SAME `MatchScoreboard` inline under the banner; an older match reads "Details weren't recorded for this
  match."
- **One renderer for stored boards**: `StoredTeam.tsx` (extracted from Career's `FinalTeam`), used by the banner's
  final team and the scoreboard's board.

## The Career layout call (owner asked "let me know what looks best")

Both were built and screenshotted: inline expand under the banner vs. the end screen's modal opened over the
Career. **Inline won**: it is literally the "make a match larger" the owner described, keeps the banner's context
(hero, result, final team, runes) on screen while you browse the lobby, needs no second overlay over a page that
is already a full-screen panel, and scrolls naturally with the list. The modal stays where there is no room: the
end screen. One component serves both.

## Judgement calls

- Generated `hybrid` seats are NOT tagged "Bot": they sit at the table under player-style handles like recorded
  runs, and tagging them here would contradict every other surface. Practice's authored bot table is tagged.
- Titles are only known for your own seat (the lobby has no title data for recorded seats).
- Seats still standing when you went out show "Top N" instead of an invented final placement; the lobby is not
  played out for them.
- Opens on the seat that knocked you out, else the best other seat (your own board is already on screen).

## Verification

Tests: `packages/sim/src/lobby/matchDetails.test.ts` (board selection for win / loss / earlier knockouts against
the lobby's own driver, ordering, size, old records), `packages/ui/src/matchDetails/matchDetails.test.tsx` (texts,
opponent-skins toggle, dialog Esc, Career expand/collapse, old-record fallback, stored-record parsing),
`packages/ui/src/matchDetails/runEndMatch.test.ts` (the real store's run end writes `entry.match` and
`replay.match`). Live: real Practice games (players and bots, to losses and a win) on a blanked backend, screenshots
at 1920x1080, 1366x768 and 844x390.

## Owner review round 1 (2026-09-28)

Owner, on 5173: "this screen is jittering all over the place"; "the match details looks solid once the jittering is
fixed and runes are added to the view so you can see their rune choices"; "the end game screen here is full of
stuff. can you have the unlocks, achievements, and crates be a pop up when the player gets back to the collection?
and just highlight the collection's text in orange or have a "new" pill or something on it so players go there?";
then "can we also add a little crown emblem on the match details screen if any of these boards is currently a hall
of champions board?".

- **Jitter, root cause.** It did not reproduce with compact cards, which are the default. It reproduced with the
  card-text setting on (full cards): each board card's text drawer hung below its fixed-height tile. That unreserved
  overflow gave the scrolling dialog a scrollbar, and the tiles are sized off the panel width (container units), so
  the scrollbar shrank the tiles, which changed the overflow, which toggled the scrollbar. Scroll anchoring also
  nudged the scroll position whenever the height moved (the panel was seen scrolling 0 to 53 px on its own). Fixed by
  pinning stored-board cards compact in the scoreboard (new `Card` prop `forceCompact`; the hover reveal still
  shows the full card and now floats above the dialog, where before it opened hidden behind the scrim), reserving
  the panel's scrollbar gutter, turning scroll anchoring off, fixing the board strip's height, and memoising
  `StoredTeam`'s card views. Verified: panel size and scroll position identical across every seat, in both card
  modes, at 1920x1080 and in the Browser pane; regression test in `matchDetails.test.tsx`.
- **Runes.** `MatchBoard.runes` = the seat's owned rune ids at that moment (off `BoardSnapshot.runes`, capped at 12),
  shown under the board as the Career banner's emblem + name pills (`RuneEmblem.tsx`, extracted from Career).
- **Hall crown.** `MatchSeat.runKey` (snapshot seats; your own ranked seat = the ledger reporter key). `hallKeys.ts`
  reads `fetchHallRecords(HALL_ROWS, HALL_MIN_FIGHTS)` (the Hall screen's own query) once per panel open, caches a
  non-empty answer for the session, never blocks the panel; offline or failed = no crown.
- **End screen declutter.** `ProgressionPostgame` keeps the XP headline, breakdown, bar and level-up, plus one line
  "New rewards are waiting in your Collection." Achievements, titles and crates are queued per account in
  localStorage (`progression/newRewards.ts`, filled in `applyProgressionOutcome`, never twice) and shown once as the
  Collection's **New rewards** pop-up (`NewRewardsPopup.tsx`; Open / Open all use the Collection's crate theatre;
  "See all in Career" opens the Achievements tab). The title plaque, the side menu and the Career's Account Level card
  wear an orange NEW pill while anything waits. The guest save prompt stays on the end screen.
- **Found in passing:** Mimic-hero hybrid seats have an empty recording and never field a board (the panel says
  "No board was recorded for this player"); spun off as its own task.
