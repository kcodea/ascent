# 2026-10-11 — Announcer variety, wave 1 (67 new takes on 30 moments)

Owner ask: *"i want to add more variety to the announcer voice lines. whats the best way to do this fast?"*

- **What shipped:** 67 new takes across the 30 moments heard most games and that had 1 to 4 takes (BackToShop, Triple,
  Knockout, TierUp, TierSix, both Runeforges, Equipment, Pair, the spell / Beast / Dwarf random buys, GameWon,
  GameLoss, TopFour, TopTwo, SecondPlace, FirstBlood, ThreeWinStreak, LosingStreak, TimeUp, DiscoverOpen, both quest
  moments, RunePick, FullBoard, EnteringCombatAfterLoss, both under-10-Resolve moments, FirstOut). GameStart (25),
  TimeRunningOut (21), EnteringCombat (7) and RandomCardBuy (8) were skipped: they already vary.
- **No game logic changed.** A take is added by appending its file name to the event's `ANNOUNCER_LINES` row and
  dropping the mp3 in `apps/web/public/announcer/`; the no-repeat bag already picks a random unheard take. More takes do
  NOT make an event speak more often (once per event per run still holds); they change WHICH line you hear, and let the
  twice-per-game events (BackToShop, Triple, Knockout) and the reusable random-buy bags go longer without a repeat.
- **Process (fast path):** Claude drafted alternates into the tracker (Announcer Script Desk, `lines`, noted "Variety
  wave 1"), the owner rewrote them in his own voice and approved, `vo:generate` made one take each in the cloned
  announcer voice (2,260 characters), the owner said ship all.
- **Loudness:** the 230 shipped announcer clips measure a mean of −19.9 LUFS, so the new takes went through the card
  chain (`normalizeFile`) at −20. They sit at −21.8 to −20.4.
- **`top-two-2` is a NEW line** ("We won't go down without a fight!"). The clip of that name removed on 2026-09-24 (a
  wrong take) is unrelated; the test that pinned "TopTwo has one variant" now pins the wave-1 lists.
- **Tests that pinned take counts** (`toHaveLength(1)` per catalog batch, the Triple exhaustion and random-buy reshuffle
  setups) now derive from `ANNOUNCER_LINES`, so the next wave does not have to touch them.
- **Every line is true wherever its moment fires** (R-TEXT-ANNOUNCER-01): no tier number on TierUp, nothing that assumes
  a win on BackToShop. Two the owner accepted knowingly: "open that reward" on Triple (Midas gets a Gold Pouch instead),
  and "another enemy down" on Knockout (also said on the first knockout).
- **Next:** wave 2 (streaks, big hits, common combat moments), then the rare specialty lines.
