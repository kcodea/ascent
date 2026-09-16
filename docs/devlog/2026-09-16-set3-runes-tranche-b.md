# 2026-09-16 — Set 3 rune batch 2, tranche B: the Starform / Equipment / Undead runes

**Shipped:** 8 Basic + 11 Epic runes from the owner's 2026-09-16 sheet (tranche B of three parallel tranches),
all `sets: ['set3']`, plus the **Skeleton** token (`u3_skeleton`, a 1/1 Undead, `token: true`). Content lives
in one contiguous block at the end of `RUNES` / `EPIC_RUNES` under `// ── Set 3 batch 2 (2026-09-16) — tranche B ──`.

| Rune | Pool | Where it fires |
| --- | --- | --- |
| First Light | Basic | `createStarform` (+8/+8 on EVERY creation while held) + the turn advance (create if none) |
| Accretion | Basic | `starformConsumeTimes` — the one Starform-consume multiplier (Black Hole, the Attractor, Roundabout, the creation meal) |
| Eventide | Basic | `fireStarformRemoved` — the single exit every consume/collapse rides; once per turn |
| Efficient Tooling / Quick Release / Overcharge / Empty Hands / Last Tool | Basic/Epic | `equipmentCostOf` (the same helper the rail prints) + the `activateEquipment` case |
| Resonant Arms | Basic | `fireEquipmentTriggers` — one tick per TRIGGER (repeats, Dismantling and Counterrotation re-fires count) |
| Last Rites | Basic | `afterShopDestroy`, called from BOTH shop-destroy paths (`destroyMinionInShop` + the deferred `pendingDeath` settle) |
| Crowded Crypt | Basic | combat: the existing `runeOverflow` flag at `amount: 1`; shop: `fireSummonOverflow` pays twice |
| Open Constellation | Epic | `fireStarformRemoved('consume')`, once per turn — re-creates and tops up to the consumed stats |
| Supernova | Epic | `collapseHits` — every friendly Celestial is an original, extras still land on top |
| Stolen Constellations | Epic | `afterStarformAte` (starform.ts) — a plain copy per Starform Shop consume |
| Spellweaving | Epic | `castSpell` — the DELTA a stat spell actually granted (targeted: its target; untargeted: the biggest per-minion delta) |
| Dismantling / Counterrotation | Epic | `fireEquipmentFree` — an activation outside the slot (no Gold, no charge; targeted → random OTHER friendly; Choose One → random branch; Star Destroyer never counts) |
| Last Tool / Endless March | Epic | GRAFTS on `grantedEffects` (`applyRuneGrafts`): stamped on purchase, at every arrival (buy / summon / Rise return) and swept at the action boundary |
| Grave Orbit | Epic | `settleCombat` — counts `reborn` events of player-side Undead (starting board + mid-fight summons) |

## Engine facts worth knowing

- **Grafted Echoes now fire on a SHOP death.** `fireRecruitDeathrattles` folded only the printed effects and a
  Gravetwin's `copiedEcho`; `grantedEffects` (Contract Rewrite, Rune of Rebirth, now the Last Tool) fired in combat
  but not on a shop destroy. The `instanceEffects` contract ("a grafted trigger is as real in the shop as a printed
  one") now holds for Echoes too. Full suite green; noted in the patch notes.
- **A combat Echo that must reach RUN state** (the Last Tool's "costs 0 next turn") logs a `questTrigger` with
  `flag: 'runeLastTool'`; the simulator stamps `srcCard` on every factory emit, and `settleCombat` resolves the
  dying card's own `equip` effect from it. `key` is NOT free for content — the presentation wrapper overwrites it.
- **Own-death guard on shop Echo factories is mandatory**: `fireOnFriendDeath` offers every shop death to every
  board watcher (whitelisted by `FRIEND_DEATH_WATCHERS`), and the deferred settle also broadcasts. Guard on
  `payload.minion === self`.
- **The Echo-family convention question keys off trigger uniformity.** Classifying the Endless March graft under
  family `echo` on trigger `onRise` made the extractor drop `q-conv-family-echo`, orphaning an owner decision. It is
  family `react` (a Rise reaction, like Revenant's), and the question is back.
- **The tribe-gate test's vocabulary now reads "Starform" as Celestial** (`tribeGate.test.ts`), the same way it
  reads Imp/Fodder as Demon — a Starform rune in a run without Celestials is dead, so `tribes: ['celestial']` is
  the mechanically right gate even where the text never says "Celestial". `tribes` is any-of: Grave Orbit
  (`['undead', 'celestial']`) is offered when EITHER rolled.
- Rune-badge tallies added (`runeTally.ts`): Resonant Arms `x/3` (run-wide), Spellweaving `x/3` (per turn),
  Counterrotation `x/3` (distinct Equipment this turn).
- Duplicate classification: Supernova, the Last Tool and Quick Release pay the sweetener; everything else stacks
  per family (Accretion ×(1+copies), Efficient Tooling −2 per copy, Overcharge one free activation per copy, …).

## Judgement calls (flagged for the owner)

- Resonant Arms counts the Star Destroyer's trigger (it is "a standard Equipment in every respect"); Dismantling
  and Counterrotation exclude it per the sheet's note.
- Counterrotation's "3 different Equipment" is per TURN (Equipment is rebuilt every turn anyway); the set resets
  after paying, so a fourth/fifth/sixth distinct activation can pay again.
- Dismantling with no other friendly minion to aim a targeted Equipment at does nothing (the reducer's own
  "no legal target → no activation" rule); board sales only.
- Open Constellation + a Zenith rebirth in the same moment: the Zenith token is topped up to the consumed stats,
  never doubled.
- Endless March's graft lands on every friendly Undead (Rise or not), so a Rune of Rebirth Rise counts; an Undead
  token summoned mid-COMBAT without the graft does not (the graft is stamped in the shop).
- Crowded Crypt shares the `runeOverflow` combat flag with Rune of Overflow, so an in-combat badge pulse credits
  whichever of the two was bought last (`runeIdByKind` keys combat flags by flag name).
