# Duos combat: the fighter view (2026-11-12)

Owner: "only show the player's portrait that is fighting in the left side area. keep the teammate/player not fighting
in the teammate pass area. this will make it cleaner when cards get passed mid combat so the animation can play and hit
them. the player that is fighting should show their full view, so their runes, cards in hand etc. when the teammates
swap, have them slide/drop into their places. if a teammate is dead, grey out their portrait".

This REPLACES the 2026-10-26 ruling (R-DUOS-SLOTS-02: "my slot is always mine", with the teammate's copy laid over my
hero). The overlay copy (`DuosTagIn`, `.duostagin`) is deleted.

**What it does**
- The bottom-left hero slot shows whoever's board is fighting on my side: face, name, frame.
- The teammate dock (the pass target, bottom right) shows the OTHER player. It stays on screen through the fight and
  keeps `data-duos-mate`, so a mid-fight pass still flies to it.
- While my teammate's board fights, the whole left cluster is drawn from THEIR run (owner follow-up: "it should show
  the current hero's hero power etc as well. just keep it 1:1 as if it were their view in a fight"): hero, name,
  frame, hero power, buffs, the rune row, and the hand row. `StatusBar` has one `run` source, so it is one swap.
- On a hand-off the two portraits trade places: each starts where the other stood and slides home (460 ms, one-shot,
  transform only; offsets measured once per swap and passed as `--duos-swap-*`).
- A player whose board has fallen is greyed wherever they stand.

**How**
- `versus/duosCombat.tsx`: `duosLiveAt` reads who is live from the result alone (`duosMember`, `tagIn`, `boardFallen`),
  so it works with no match (the Scene Builder) as well as in Versus and for spectators. `useDuosCombat` carries
  `mateLive`, `meFallen`, `mateFallen`, `swaps`, `slideSeq`, `fighter`.
- `versus/duosMateRun.ts`: the teammate's run for the HUD. A match rebuilds it from their spectate frames; the Scene
  Builder hands over the run it held as the fight began (`sbDuos.ts` `fightMate`).
- `StatusBar.tsx`, `QuestBadges.tsx` (optional `run`), `Recruit.tsx` (the hand row's source), `DuosMateDock.tsx`,
  `versus.css`.

**Known gaps**
- The teammate's hand is as it stood when they stepped in: cards their board gains mid-fight do not appear in the row
  until the fight ends.
- Not yet seen in a real Versus Duos match (two humans): verified in a Scene Builder Duos fight and by tests.

**Follow-up, same day: the opponents too.** Owner: "the opponents should swap their portrait to the active player as
well w/ their runes etc". `CombatOpponent` already swapped the foe's FACE in a match, but kept the first player's board,
so the runes, buffs and tier under it were the wrong player's. It now takes the second player's board as well
(`seatBoardThisRound`, exported from the lobby module), and it swaps with no match too: `duosLiveAt` reports
`foeTagged` from the enemy `tagIn`, and the Scene Builder's local team supplies that player (`localMate().foeMate`).
