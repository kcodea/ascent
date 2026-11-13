# 2026-11-13 — Shop Madness refills and End-of-Turn eats play in real time

Owner report (screenshot: Hydraskus + seven Demons, Shop Madness): "minions should replace each other in real time.
it seems to have worked here, but it didn't LOOK like it worked, especially because the consumed stats didnt go up in
real time, but at the end of turn resolve." Rule `R-SHOPMADNESS-REALTIME-01`.

## Root cause (two, both presentation)

1. **The bites were paced as a repeat chain.** Hydraskus emits one root trigger per Demon with `repeatIndex/Count`
   (R-REPEAT-01), so the compiler laid the seven bites on the Kringle acceleration schedule (R-REPEAT-04/05): about
   2 s for seven 530 ms consume pulls. The first two or three read fine, the rest overlapped and their stat climbs all
   landed in the last half second before the combat flip. Without the rune the Shop usually runs dry after three or
   four bites, which is why it looked fine there.
2. **No refill was announced.** `refillShopMadness` splices a fresh offer into the eaten slot inside the same trigger,
   but the End-of-Turn diff only emitted `shopChanged: consumed` + `fodderEaten`. The scene renders the pre-turn row
   plus delivered consequences, so the row emptied on screen, later Demons ate cards nobody had seen (their ghosts
   flew from the row centre), and the whole new row popped in at the commit.

## Fix

- **sim** (`withRecruitTrigger` diff): offers that entered the row in a trigger emit `shopChanged: refilled` with the
  slot (`index`) and the offer whose slot it took (`replaces`, paired by `shopArrivals`, a survivor-gap row diff), on
  a new `consume.refill` delivery marker. `fodderEaten` now carries `offerUid` so the ghost leaves the right slot.
  Read-only: the resolved state is byte-identical (tested against plain `reduce`).
- **core**: the two optional fields on `ShopChangedConsequence` (`index`, `replaces`) and `FodderEatenConsequence`
  (`offerUid`). Shared boundary, additive only.
- **choreographer**: a root tick that carries a `fodderEaten` is never repeat-paced (it keeps its full own beat);
  `consume.refill` = 560 ms into a full beat (after the eater's climb at ~545, before the next bite at ~830); the
  projection collects `shopRefills` (not a stat climb); `shopRefillRow.ts` folds them into the row in the replaced
  offer's slot and names the slots still waiting (held open, no reflow).
- **Recruit**: End of Turn shows each refill on its delivery; mid-Shop eats (a Shout) with the rune no longer show the
  held slot and the refill side by side (the refill waits under the held slot, then appears there).

## Verification

- `set2ShopMadnessBeats.test.ts` (sim) + `shopMadnessBeats.test.ts` (ui): one bite beat per Demon with the gain, the
  meal (`offerUid`) and the refill (`replaces`) in order; every Demon eats a minion on screen; the replayed row equals
  the resolved Shop; the compiled bites are unpaced, >= 700 ms apart, refill after the meal and before the next bite;
  End of Turn grows with the number of eaters. The beat, row and pacing assertions fail on main (checked by reverting the sim emission and the compiler change); the row-diff helper and the state-equivalence check pass on both, as they should.
- Live (dev server, Scene Builder, Set 2, Shop Madness + Hydraskus + six Demons): End of Turn went from 2.08 s with
  the row emptying and the last four Demons rising together, to 4.97 s with each Demon eating, climbing, and the slot
  refilling before the next bite. A buy refills its slot in the same commit; a mid-Shop Appetite Agent eat holds the
  slot, then the refill fades in there.
