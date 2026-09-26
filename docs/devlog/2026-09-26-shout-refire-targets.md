# 2026-09-26 — Re-fired targeted Shouts pick a random target; Squirl Scout's combat text is live

Follow-up to #1755 (every combat Shout in real time). The owner answered its four open questions:

1. **Squirl Scout / Limelight / Baby Gastrid combat buffs are combat-only.** *"this is correct now, good catch"*.
   No behaviour change. Written into the oracle as **R-REALTIME-04** (a Shout re-fired in combat gives combat-only
   board stats, like every other combat buff, unless its text says permanent).
2. **Gravetwin, Auric Runemaster and Graverobber re-fired with no target.** *"yes they should pick a random
   target."* Implemented in both phases, oracle **R-TARGET-06**.
3. **Herald of the Apocalypse stays Shop-only.** *"yes, consume does nothing in combat"*. No behaviour change.
   Oracle **R-REALTIME-05** (Consume is a Shop action; a Consume Shout fired in combat feeds when the Shop opens).
4. **Squirl Scout's printed number in combat lagged** the mid-fight growth. Fixed, oracle **R-TEXT-11**.

## Random re-fire targets (R-TARGET-06)

Played from hand the player still aims. A re-fire (no `payload.target`) picks from the card's legal pool, never
itself (R-TARGET-03); an empty pool does nothing and takes no draw. The draw mirrors Baby Gastrid / Appetite
Agent: the Shop uses the run cursor (new shared helper `refireTarget` in `recruit.ts`), combat uses `ctx.rng.pick`.

| Card | Legal pool | Shop | Combat |
|---|---|---|---|
| Gravetwin | other friendlies whose card has an Echo (`onDeath`) | sets `copiedEcho` | grafts the Echo live (`ctx.grantDeathrattle`, fires if Gravetwin dies this fight) and carries the copy back once (`ShoutCarry.copiedEchoes` → settle sets the run card's `copiedEcho`), so the next-Shop trigger still works |
| Auric Runemaster | other friendlies not already Gilded | `gildMinion` (permanent) | the Ancient of Time combat gild: golden flag + an `ascend` (gild) event + its printed stats as a buff; the run card is untouched (R-REALTIME-04) |
| Graverobber | any other friendly (not one already marked dying) | spell of its tier to hand, then `destroyMinionInShop` **immediately** | spell of its tier via `grantToHand` (live `toHand`, wakes hand watchers), then a destroy (`ctx.damage`, bypasses Ward); its Echo fires as the death resolves |

Judgement calls (flag if wrong):
- Gravetwin's pool is Echo minions only, and Runemaster's is non-Gilded only: the aim UI allows any friendly, but
  picking a body the effect cannot act on would make the "random target" a silent whiff.
- A re-fired Graverobber destroys immediately rather than through the two-step `pendingDeath`: a re-fire can land
  twice in one action (Drakko, the Auctioneer's two edges) or at End of Turn right before the fight, where a second
  mark would overwrite the first or reach combat unsettled. The aimed play keeps the two-step death.
- The combat Gravetwin copy carries back to the run card (the card's own text is about the NEXT Shop).
- The combat Graverobber spell pool is the side's pool spells of the victim's tier, neutral or the run's tribes
  (the Shop's `runSpells` filter), non-token.

## Squirl Scout live text (R-TEXT-11)

The same display-only preview pattern Front to Back / spell power use:
`battlecryScoutSpread` logs an `improve` event (amount 0, `display` = step, `scout` = step on the player side) →
`combatPreviewFold(...).scout` → Recruit publishes `combatScoutPreview` → `RunState.fxScoutPreview` →
`squirlScoutBuffLive(run)`, read by Unit.tsx (combat) and every Recruit `liveCardText` caller. Settle and
`deserialize` clear the preview; the real growth still lands through `playerShoutCarry.squirlScoutBuff`. The
`improve` event also narrates "Squirl Scout's effect improves" and pulses the watcher medallion on the beat.

## Verification

- `packages/sim/src/shoutRefireTargets.test.ts`: each card in the Shop (random pick off the cursor, deterministic,
  reachable across seeds, no-legal-target no-op with no draw, aimed Graverobber unchanged) and in combat (live on
  the Shout beat, deterministic by seed, no-op), plus end to end through the reducer (Gravetwin's combat copy on
  its run card after settle; the combat Gild gone after settle). 11 of its 20 cases fail on `main`.
- `packages/sim/src/combatShoutsRealtime.test.ts`: R-REALTIME-04 (Baby Gastrid, Limelight: combat gain, no
  permanent stats after settle) and R-REALTIME-05 (Herald: live line, no mid-fight feed, one settle replay).
- `packages/ui/src/squirlScoutLiveText.test.ts`: the printed grant ticks on the improve, equals settle, is a fold
  (re-publish / save-resume safe), ignores an enemy Scout, and both text chains read the live value.
