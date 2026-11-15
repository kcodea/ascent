# 2026-11-15: "players remain" says the right number

Rule R-TEXT-ANNOUNCER-01 (amended); test `packages/ui/src/announcer.test.ts`.

## The bug

`playersRemain` fires when someone else is knocked out and 5 or 3 players are left, but its only take was "Only three
remain." So it said "three" at five, and (once per take per game) said nothing at three. Found while reading the code
for the deck; the owner ruled "lets do one line per count. 5/4/3".

## The fix

- `PLAYERS_REMAIN_TAKES` keys the takes by the players left, the same way hero and tribe lines are keyed, and the
  moment may only play its own count's takes: five = `players-remain-five-1` / `-2`, three = `players-remain-1`
  (the old clip) / `players-remain-three-2`. New clips in all four voices (12 clips, 200 characters).
- FOUR is the TopFour moment, which already has four lines that say "four". It fired at four OR FEWER, so a round that
  knocked two players out (5 to 3) said "Only four left" at three. It now fires at exactly four.

## Not done here

The "fun ones for the final 2" are drafted in the tracker for the owner to pick from (TopTwo on the return to the Shop,
FinalShowdown as the last fight starts); none are recorded.
