# 2026-11-14: Ancients × Cindy (the third Duos hero)

Six Ancient pairings for Cindy (Golden Gratitude: "The next minion your teammate buys gives you a Gilded copy of it.",
0 Gold, once per game; PR #2707). Owner design and rulings 2026-11-14. Rules R-ANCCINDY-01..06. Like Priestess and
Magician (`2026-11-10-ancients-duos-heroes.md`), **Ancients stay off in every Duos game a player can reach**
(R-ANCDUOS-01): these are reachable only through `createVersusRun`'s dev seam. "Gildcrafter" in the owner's words is
the existing Goldcrafter spell.

| Ancient | What it does | Where |
| --- | --- | --- |
| Death | Avenge (15): the teammate gets a Goldcrafter. Repeats. Every friendly death in every phase (combat deaths, Shop destroys, devours), never a consume or a sale. One running count. | `cindyShopDeath` (Shop, a `gift` team effect right then), `QuestCombatMods.ancientMateGiftAvenge` (combat, `sendTeam` real time), `cindyAfterCombat` (settle adds the fight's deaths) |
| Fortune | Every 40 Gold spent gives Golden Gratitude its once-per-game use back. Repeats. | `cindyOnGoldSpent` in `ancientOnGoldSpent`; `refreshGratitude`; `ancientOnGratitudePaid` |
| War | Start of Combat: the left-most minion is Gilded for the fight. An Engraved one keeps the Gilded status. | `QuestCombatMods.ancientSocGildLeftmost` (simulate), `CombatCarryBacks.ancientGildKept`, `cindyAfterCombat` |
| Genesis | The minion the teammate bought is Gilded too. | the arm's `gild` rider, `gratitudeBuy` |
| Time | Once, next turn: a Goldcrafter for Cindy and one for her teammate. | `cindyOnPick`, `cindyStartOfTurn` (its own Start-of-Turn beat) |
| Bonds | The two Golden Gratitude copies are Linked: a stat gain on one is gained by the other. | the arm's `link` rider, `duosLinks.ts`, `QuestCombatMods.duosLinks` |

## Bonds: how mirroring works across two players

The twins are on TWO runs, so the link is data on each card (`BoardCard.duosLink`: one id on both runs, the copy's uid
on the teammate's run, plus the stats last mirrored) and every mirrored gain travels between the runs on the pass
channel.

- **Shop (either run).** `duosLinkSync` runs at the reducer's action boundary (`settleAction`, every action). It
  measures each linked card's gain against its baseline (board, hand, or a card waiting for hand room) and queues ONE
  `linkGain` team effect per link per action. The receiver's twin gains it permanently (`receiveLinkGain`, buff FX on
  the card, label "Linked") and its baseline moves by exactly that much, so the gain is never sent back. Gains only: a
  stat that went down is re-based silently.
- **Gilding is not a gain and never breaks the link.** When a card turned Gilded since its baseline, its printed stats
  (the Gild's doubled base) are taken off the measured change. A triple that consumes a linked card hands the link to
  the Golden (`carryDuosLinkIntoTriple`, beside Sable's bond carry).
- **Combat keeps the original's permanence** (owner ruling). Inside one `simulate` the twin is reachable only when it is
  the side's waiting tag-team RESERVE (its board has not stepped in yet): a gain on the linked fighting body is added to
  the reserve's per-fight locked copy, combat-only (Pep Talk's rule), one hop. When the twin's board already fought (it
  went first and fell), or the twin is in a hand, it is not in that fight, and a combat-only gain expires as every
  combat-only gain does. A gain the fighting body KEEPS (Engraved, a permanent combat gain) lands on the run card at
  settle, which is an action like any other, so `duosLinkSync` sends it to the twin's run then. That is the earliest
  correct boundary for the permanent half: the other run's card is not in this run's fight at all, and a reserve
  body's run settles from its own carry-backs (`duosMemberView`), so a permanent change to it cannot come out of this
  fight's result.
- **The link ends** when either card leaves its run (sold, destroyed, consumed, passed, swapped into the Shop): that
  run sends `linkEnd`, both cards drop the "Linked" line, and the id is remembered (`duosLinkEnded`) so a card that
  comes back (a refunded pass) never re-links. `duosWireOf` strips `duosLink` from every card but the Gratitude copy, so
  a passed twin never arrives Linked.
- **Versus Duos and Ranked Duos are the same.** Both teammates are live runs in either mode; the enemy team in Ranked
  Duos is recorded and is never linked to anything live. A recorded Cindy team served as an opponent fights with the
  stats its runs had; its locked sides carry their `questMods.duosLinks`, so its reserve mirror runs in the fight too
  (the rule is symmetric). Nothing is sent from a served side.
- "Linked" prints in the gold `((…))` status tag (the Card's `desctemp`, the next-combat grant's look) on the shop /
  board / hand card (`instView`) and the combat card (`Unit.tsx`, from `MinionSnapshot.linked`, stamped by the
  simulator from the side's `duosLinks`).

## Decisions a future session would otherwise re-derive

- **What reaches the teammate rides the pass channel**, as for Priestess and Magician: Death and Time send a `gift` team
  effect; Genesis and Bonds ride the ARM (`gratitude` with `gild` / `link`). An Ancient picked after the press, while
  the power waits, follows the arm as an `update` (riders only; it never arms a spent or unheard power). If the copy
  was already on its way, the rider arrives too late and does nothing (the buy happened before the pick reached the
  teammate's run).
- **Fortune while the power waits** is banked and pays when the copy lands. Fortune while the power is unused is
  wasted (nothing to refresh). Owner call if either should be different.
- **War's Engraved keep** only needs the flag: the doubled stats already come home through the Engraved rule as the
  War-labelled gain, so settle sets `golden` and does not Gild again.
- **No Worker or protocol change.** New team-effect kinds are opaque to the room (as `gratitude` already was).
  Turning Ancients on in Duos for players still needs the protocol bump R-ANCDUOS-01 lists.
- **Known gap:** a reload mid-turn drops that turn's actions on the reloading run (as for every Duos pass), while a
  `linkGain` it already sent stays on the twin. The restore replay does not re-send or take back team effects.

## Verification

`packages/sim/src/ancientsCindy.test.ts` (every pairing through the real reducer on two runs, with the wire form),
`packages/core/src/combat/cindyAncients.test.ts` (War's gild, Death's live gift, Bonds' reserve mirror and the
`linked` snapshot), `packages/ui/src/cindyLinkedText.test.ts` (the gold tag). Each was checked to fail with its hook
disabled. Not live-tested in a browser match (Ancients are dev-only in Duos).
