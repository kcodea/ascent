# 2026-10-11 — Play asks before a ranked lobby; backing out is an 8th (R-RANK-06, R-RANK-05 on again)

**Owner ask (with a screenshot of the Play card):** "when clicking on the play section there should be a
confirmation that says: This is a ranked lobby, abandoning the match after this point will lose you MMR. Would you
like to proceed? Then have two button options: 1. Yes, let's go. 2. No, go back. from there, even at the hero select
screen, if they go back, they should place as if they came in eighth place and lose the associated mmr".

## Two rulings taken before building

The abandon penalty was switched off on 2026-10-02 because nothing warned the player
(`2026-10-02-abandon-penalty-off.md`). This ask is that warning, so two forks were put to the owner:

1. *Should leaving a ranked game mid-match cost MMR again too?* **"Yes, turn it back on."** The 2026-09-29 rule
   returns unchanged: the lowest place still open (8th with nobody out, 7th with one seat out).
2. *A player closes the game on hero select instead of pressing Back. What should happen?* **"Reopen on the same
   heroes."** Closing is neither a penalty (a crash costs nothing) nor a free hero reroll.

## What changed

- **The confirmation** (`Title.tsx`, `rankedConfirm`). The Play card, and the tutorial nudge's "Skip and just play",
  open it. Only "Yes, let's go." calls `startLobby`. "No, go back." closes it over the mode picker. The copy lives
  in `rank/rankedEntry.ts` so the test pins the owner's exact words. With an unfinished rated game in the save slot
  the card adds one line: picking a hero also gives that game up, and at which place.
- **The ranked entry** (`rank/rankedEntry.ts`, store `rankedEntry`). "Yes" mints the ranked run id THEN, with the
  seed and the hero offer, and persists the three to `ascent.rankedentry`. `pickHero` gives the run that id and
  clears the record. Minting at the confirmation is what lets hero select be settled at all (no run exists there),
  and one id from confirm to finish means the server, which settles a run id once, cannot count an entry twice.
- **Back from the ranked hero select** (`HeroSelect.tsx`, `store.abandonRankedEntry`, `settleAbandonedEntry`):
  the entry's id is queued as an 8th, tagged `kind: 'abandon'`, through the existing rank queue and
  `submit-rating`. No server change: it already settles any placement 1-8, and no seat keys means no strength bonus.
- **Closing on hero select**: `BOOT_ENTRY` reads the record at boot and the store opens straight on hero select with
  the same heroes. A live entry is also resumed (not re-rolled) by the next `startLobby`. An entry whose heroes this
  build can no longer offer for that seed is dropped at no cost.
- **Settings on the ranked hero select** (`EscMenu.tsx`): it used to offer "Save & Quit" there, which saved
  nothing and would have been a free way out. It now reads "Abandon match" and names the cost.
- **`ABANDON_PENALTY_ENABLED = true`** (`rank/ratedRun.ts`). The title's Clear and Play tips name the placement
  again. `abandonPenaltyOff.test.ts` is gone; `quitCostsRating.test.ts` now pins the real switch with no mock and
  took over the doors that file covered (`newRun`, the tutorial, a cloud copy adopted over the save).

## Judgement calls to confirm with the owner

- **A second press before an abandon.** The owner asked for one confirmation, at Play. Hero select's Back fires on
  pointer-down, so a single stray click would have cost a full 8th. Back now arms first ("Abandon? Counts as 8th
  place") and leaves on the second press; Settings' Abandon match does the same. Not an owner ruling.
- **Offline costs nothing.** If the opponent pool is unreachable the lobby could only have been all-generated and
  unrated ("offline = unrated", 2026-09-28), so backing out of that hero select queues nothing.
- **Cancelling "Finding opponents..."** after picking a hero returns to the title with the entry KEPT (same heroes
  next time), not settled: the player did pick, and the wait failing is not their abandon.

## Known gap (unchanged in kind)

Both settlements are made by the client from local storage, so wiping it dodges the 8th and re-rolls the offer. The
roadmap item "saved and quit games on the server" is the fix: record the entry server-side when it is committed.

## Verified

`packages/ui/src/rank/rankedEntry.test.tsx` (new, 10 tests against the real Title, HeroSelect and store),
`quitCostsRating.test.ts`, `rankSubmission.test.ts`, `packages/rules`, then the full gates.
