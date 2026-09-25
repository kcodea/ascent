# 2026-09-25 — Grim prints its live Echo total in place

**Owner ask:** "fix grim so that it updates in real time with the current value of the echo." Format picked by
the owner: the TOTAL IN PLACE, "**Echo:** Give your **Beast Aura** **+X/+Y**." (4 Echoes so far reads +15/+10).

This REPLACES the 2026-09-24 exception (PR #1690), where the owner asked for static text and the old
`tallyBuffText` helper was deleted. The comment on `grim` in `cards/set1/beasts.ts` and oracle rule
R-ECHOTALLY-01 (`packages/rules/src/registry/approved/triggers.ts`) now carry the new ruling.

## What reads what

- `echoTallyText` (`packages/ui/src/cardText.ts`) computes N x (+3/+2), gilded x2, where
  N = the Echo tally + 1 for Grim's own Echo (the tally is bumped BEFORE an Echo fires, so the payout's N
  already includes Grim). It keys off the `deathrattleBuffTribeByTally` effect's params, not the card id.
- Shop / board / hand / Discover / end screen: `liveCardText` passes `run.deathrattlesTriggered`, the same run
  tally `recruit.ts` hands the arena.
- Combat (`Unit.tsx`): the run tally is frozen until settle, so a PLAYER Grim adds
  `combatQuestDelta.deathrattle`, the replay's count of this fight's Echoes up to the current step (built from
  the engine's step-tagged `playerQuestEvents`, the same `bumpDeathrattles` timeline the payout reads). Only a
  tally card subscribes to that selector, so an Echo beat re-renders Grim and nothing else.
- An ENEMY Grim reads its snapshot's frozen tally, which the simulator never bumps mid-fight (known asymmetry in
  R-ECHOTALLY-01), so its text passes `echoIncludesSelf: false` and prints exactly that tally x rate.

One cosmetic edge: the self bump lands on Grim's death step, a beat before its Echo pays, so a dying Grim's
body would read one Echo higher for that beat. The body is gone by then, so nothing visible changes.

## Per-Echo rule text

The game has no per-card hover or rule-tooltip field, so the "+3/+2 for every Echo triggered this game"
wording is no longer printed on any live surface. It stays as the card's printed `text` (what a context-free
surface such as the Compendium and Doc Bot read), and in the patch note.

## Tests

`packages/ui/src/grimLiveText.test.ts`: text format + gilded + enemy + non-tally null, then text == payout at
tallies 0/2/4/9 (plain and gilded) in the SHOP (Ossuary Rite procs a living Grim through the real reducer) and
in COMBAT (the real simulator, with an earlier Echo this fight ticking the text before Grim fires).
