# 2026-09-18 — Rune batch B: eleven Set 3 runes reworked / repriced (owner handoff)

**What shipped.** Eleven Set 3 runes changed in `packages/content/src/runes.ts` (ids kept), with the engine
following where the mechanic moved. No new reward kinds — every change rides an existing kind and either a
new `RunState` field or a widened read.

| Rune | Change |
|---|---|
| Charted Skies | cost 4 → 2. "After you cast **3** spells, get a copy of one of them. (Once per turn)" — EVERY spell counts (Shop spells, Rubies, Clues, Gifts), the copy is a seeded-random pick among the three's copyable ones. Was: 3rd SHOP spell → Discover a spell. |
| Astral Refrain | "After you cast **3** spells, get **2 copies** of the **second** one." Same counting basis. Was: copies of the 1st and 3rd Shop spells. |
| Astral Draft | cost 6 → 4. |
| Eventide | "After you **Consume** or **Collapse** a **Starform**, give your **Shop spells +1/+1**. (Once per turn)" — the 2 random spells are gone. |
| Festival Wages | "After you sell **3 Revelers**, your next card costs **0**." Every 3rd Reveler sold in a turn. Was: the first each turn. |
| Festival Circuit | cost 5 → 4. "After you sell **3 Revelers**, get a random **Celestial**. Your **Revelers** buff **Celestials**." Every 3rd sale pays ONE Celestial; while held, `revelerSell`'s Spirit audience widens to Celestials. |
| Dismantling | the per-turn cap is gone: every Equip minion sold fires; every fire stamps its own `use` cue WITH the rolled target. |
| Quick Release | "(Doesn't discount its own Equipment)" — the arm carries the sold minion's Equipment id; activating that one neither uses nor spends it. |
| Empty Hands | "…costs **0** and is **Amplified** permanently." `equipmentAmplifiedCards` (by card, like the free list) — every activation ×2, nothing spent, a Calibration never wasted on it. |
| Dream Mirror | "When a minion in your hand **gains stats**, also give those stats to a random friendly minion." Every hand gain, one roll per gainer; the per-turn latch is gone. |
| Endless March | "After a friendly **Undead** **rises**, summon a **Spear Warden**." The graft's `tokenId` is `knit` (the set-1 card, current base stats + its death-count aura); both phases follow (the combat graft reads the same params, after the Echo — the Echo-then-Rise order). |

**Engine notes.**
- `noteSpellForCountRunes` (recruit.ts) is the ONE meter for the two spell-count runes: `noteSpellCast` calls it
  for Shop spells + Gifts (Clues included; a reward TOKEN still returns before it — the standing "counts as
  nothing" rule), and the reducer's Ruby branch calls it once per resolution. Both runes pay at exactly `at`
  entries, so once-per-turn is by construction; the list keeps growing so the `x/3` badge stays honest.
  `shopSpellIdsThisTurn` → `spellIdsThisTurn`.
- A Gift is never copy food (the standing rule): Charted Skies draws from the copyable ones (a Ruby copy is
  minted through `mintRubies` at the run's current line); a Refrain whose second cast is a Gift pays nothing.
- `revelersSoldThisTurn` replaces `festivalWagesUsedThisTurn` + `circuitSoldThisTurn`; both Reveler runes read
  it modulo 3 (`REVELER_METER` / the Circuit's `count`). Scope = per turn, the Circuit's original window.
- `quickReleaseArmed` is now `{ excludeEquipmentId }`; `quickReleaseApplies` (equipment.ts) is what
  `equipmentCostOf` and the activation read. `equipmentPermanentlyAmplified` sits beside the per-id stack in
  `equipmentWillAmplify` (so the slot paints blue) and in the activation's trigger count.
- `fireEquipmentFree` returns `{ targetUid? } | false` so Dismantling / Counterrotation cues carry the target.
- `dismantlingUsedThisTurn` / `dreamMirrorUsedThisTurn` deleted; carry-over scan registry updated.

**Judgement calls (flag to the owner).**
- Reward TOKENS (Goldcrafter, Implosion, the Triple Reward…) still count as no spell for the count runes — the
  owner listed "Shop spells, Rubies, Clues, Gifts", and the token rule is standing.
- Quick Release: a later Equip sale re-arms with ITS OWN exclusion (one arm, last sale wins).
- Festival Wages / Circuit: "after you sell 3" = every third sale within the turn (3, 6, 9…), meter reset at the
  flip — matching the Circuit's old per-turn scope as the handoff asked.
- Dismantling's text (none given) now reads "When you sell an **Equip** minion, activate its Equipment for
  free before selling it."

**Docbot.** `UNRESOLVED_CAP` 90 → 91 (four new owner-verbatim riders the grammar has no rule for, net of four
texts that now parse); `final-report.md` headline numbers updated. Contracts re-extracted (three cost lines).
