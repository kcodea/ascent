# 2026-11-22: Brood Matron summons at most 3 Imps per combat

**Owner ask.** "lets fix brood matron to be max of 3 summons per round".

**Why it needed one.** The 2026-11-20 rework ("Avenge (2): Summon an Imp and give your Imps +1/+1 this game") dropped
the old friend-death watcher and its "(max 3)". The Avenge had no limit, and every Imp that died fed the next Avenge,
so one Matron bred for as long as friends kept dying (gilded: two Imps per two deaths).

**The change (R-BROOD-01).** `avengeBuffImps` takes a `max` param: the Imps one body summons per combat (x2 gilded).
It rides `bredCount`, the per-body combat counter, so it is fresh each fight, separate per Matron, and restarts on a
Rise / Rebirth return through the shared `resetPerCombatLimits` (R-RETURN-RESET-01). The buff half is not capped.
Card text: "... (Max 3 Imps per combat.)", gilded "(Max 6 Imps per combat.)".

**Live text.** In combat the cap counts down, "(2 Imps left this combat)", like Whaloo and Immune Iggy. No new replay
field: the count is a pure function of the body's Avenge count, which the replay already tracks (`avengeSeen`), so
`avengeSummonCapText` reads that. `broodMatronCapText.test.ts` checks the text against the Imps the engine really
summoned at every event of a fight, plain, gilded and across a Rebirth. The text ticks on the death that completes
the Avenge, a few events before the Imp lands.

**Readings the owner has not ruled on** (flagged in the PR and in the rule's `currentBehaviour`):

- "per round" = per combat. A minion Avenge only fires in combat.
- Gilded = 6 Imps (3 Avenges of 2), the same doubling the old "(max 3)" used.
- The +1/+1 keeps paying after the Imps are spent.
- An Imp lost to a full board still spends one of the 3 (an overflowed summon is a summon; it also keeps the count a
  pure function of the Avenge count).

**Also touched.** The text parser's "(Max N per combat.)" limit sentence accepts a named thing ("Max 3 Imps"); the
curated `brood` contract states the cap; the 2026-11-20 gilded test no longer assumes Imps == buff total.
