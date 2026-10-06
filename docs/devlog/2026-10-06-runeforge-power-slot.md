# 2026-10-06: Runeforge heroes' forge rune sits in the hero-power slot (R-RUNESLOT-01, R-RUNESLOT-02)

Owner report: "the hero power runeforge selection should sit in the hero power slot. this is currently broken - there
is a floating copy of the rune that was selected on turn 9's runeforge … change the text to say copy the first epic
rune you select and remove the extra ui element floating without a rune slot."

## Root cause (two bugs that stacked)

1. **The power slot was re-stamped by the turn-9 forge.** `buyRune` stamped `heroGrantArt` for Guardian on ANY
   `runeforgeEpic` forge. The universal turn-9 forge is an Epic forge too, so the turn-9 pick replaced his turn-8
   rune in the power slot.
2. **The rack drew every owned rune.** `QuestBadges` rendered all of `ownedRunes`, but the rack only has three
   sockets (`.questbadges .questbadge:nth-child(1..3)` transforms). Guardian + Rune of Duplication owns four runes
   (Duplication, the turn-8 pick, its copy, the turn-9 pick), so the fourth badge got no socket transform and sat
   loose beside the third. Because of bug 1 it was the same rune the power slot showed, hence "a floating copy".
   Runesmith + Duplication overflowed the same way.

Reproduced in a real render first (dev server, run built through `window.useGame` + real `buyRune` dispatches):
four `.runebadge` nodes, the fourth with `transform: none`, and the power button showing the turn-9 rune.

## Fix

- `buyRune`: Guardian's slot is stamped by the FIRST Epic pick from turn 8 on (`GUARDIAN_FORGE_WAVE`), and never
  re-stamped. An earlier Epic forge (Rune of the Ornate Clock's "next turn") is not his.
- `packages/ui/src/heroSlotRune.ts`: `rackRunes` drops ONE copy of the power-slot rune from the rack (a Duplication
  copy keeps its socket); `runeNodeEl` resolves a rune's on-screen node as rack badge, else the power button.
- The power button carries `data-hero-rune` (+ `data-eot-effect` for a recurring End-of-Turn rune), and every
  "out of the rune's badge" FX lookup (castPreview, runeCastFlourish, spellCastFx, Start-of-Turn beats, Lasso
  origins, quest tendrils, End-of-Turn tendrils, rune-trigger bursts, the lock-in arrival) falls back to it.
  Without that, removing the badge would have silently dropped those FX for the hero's rune.
- The power slot shows the rune's live x/N meter (`runeTally`), which the rack badge used to carry.
- `badgeCenterOf` is now scoped to `.questbadges` (the opponent frame renders its own `.runebadge` nodes earlier in
  the document, which would otherwise win over the power-slot fallback).
- The chains on the 3rd rack socket no longer break for Runesmith/Guardian at run start: their pick no longer takes
  a rack socket, so only Rune of Duplication / Rune of the Epic Forge open the 3rd.
- Rune of Duplication text: "Copy the **first Epic Rune** you select." The mechanic already matched (GAME-RULES:
  "copies the FIRST Epic rune forged after it").

## Known gaps

- A Guardian who leaves his turn-8 forge without buying has the turn-9 pick land in the power slot.
- The opponent duel frame (`CombatOpponent`) still draws every rune of a snapshot; snapshots carry no power-slot grant.
- Runesmith holding BOTH Duplication and Rune of the Epic Forge can still own more than three rack runes.
