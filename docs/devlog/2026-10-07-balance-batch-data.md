# 2026-10-07: Owner balance batch (data half): archives, rune numbers, minion reworks, Big Brain Billy

The owner's 2026-10-07 batch, applied exactly (the game is the source of truth). Two parallel sessions own the rest
of the batch: new runes / Firebird / rune-granted equipment, and the Elderhorn + Orivax rework. This PR touches
none of those.

## Archived everywhere

- **14 runes** moved into `ARCHIVED_RUNES` with `sets: []` (old tag kept in a comment): Ruby Resonance, Contraband,
  Gemcutting, Shifting Facets, Gem Dividend, Gemscript, Gemstorm, Redirection, Ruby Shrapnel, Last Call, Profit
  Sharing (was set 2 + 3), the Chef, Blasting Voices and the Last Word (both were set 1 + 2). `rune_resonance` (a
  different rune) is untouched. Their presentation-policy rows were removed (the ghost tripwire walks
  `RUNES`/`EPIC_RUNES` only).
- **13 Shop spells** moved into `ARCHIVED_CARDS` (`cards/archive.ts`, new 2026-10-07 block): Hourglass Reserve,
  Fleeting Vigor, Deep Delve Writ, Layaway, Solid Ground, Open the Gates, Parting Cry, Closed Casket, Containment
  Rune, Farseer's Report, Marked Target, Beefy, Stolen Initiative. Hourglass Reserve left `SET3_SHARED_SPELL_IDS`.
- **Owner ruling:** Arnold (End of Turn: cast Beefy) and Dwarven Sharpshooter (Shout: get a Deep Delve Writ) keep
  working. Both factories resolve the spell through `CARD_INDEX`, which includes the archive, so nothing changed in
  the engine. Proved in `balanceBatch1007.test.ts` and recorded as **R-ARCHIVE-GRANT-01**.
- The banked next-combat machinery from #1969 (`bankedOpeners.ts`, `system:startOfCombat:bankedCast`) is left in
  place for replays and any remaining source.

## Runes

- Ascension: neutral (tribe gate removed; added to the owner-ruled `BODY_GRANT_ONLY` list in `tribeGate.test.ts`,
  alongside Rune of Lazarus).
- Stormcalling 4 -> 3, Foundry 4 -> 3, Summit 3 -> 5.
- **The Deep:** cost 6 -> 5, "Get a random Tier 7 minion. Repeat every 2 turns." New optional `every` on the
  `runeDeep` reward; `RunState.runeDeepEvery` / `runeDeepTick`. Pays on purchase as before, skips the next turn
  setup, pays the one after. A run armed before the cadence has no `runeDeepEvery` and keeps paying every turn.
  Forge badge: `x/2 turns` (`runeTally.ts`). Rule **R-DEEP-EVERY-01**; R-RUNE-08's prose updated.
- **Runic Hoard:** +3/+4 (was +2/+3). The numbers are now `attack`/`health` params on the reward, read by
  `fireRunicHoard` off `RUNE_INDEX` (no new state).
- **Summoning:** cost 2 -> 1; `RUNE_SUMMONING_STEP` 2 -> 3 (Imp Aura improve +3/+3).

## Minions

- **Set 3.** Lullaby Lou -> `onSpellCastBuffRandomTribe { tribe: 'spirit', count: 1, 4/6 }`: a random friendly
  Spirit on board, never itself (R-TARGET-03). Lens Grinder's Stellar Lens +5/+5 (gilded +10/+10). The Great
  Attractor's shop buff +3/+2. Roundabout -> `{ on: 'endOfTurn', do: 'buffShopPermanent', 6/7 }` with a new
  `factory:buffShopPermanent:endOfTurn` policy row (gilded +12/+14).
- **Set 2.** Flo Rida -> the Beardsley escalator (`onSummonTribeBuffFlat`, 5/5, `improve: 5, every: 1`): 5, 10,
  15... Beardsley -> 1/1 improving +1/+1 every Beast, **Ward dropped** (owner text has none). Wolvie -> Echo gives a
  friendly Beast Rise with 0/0 stats; `deathrattleBuffRandomTribe` now skips a 0/0 buff so the log has no empty
  +0/+0; gilded uses the house 2-body keyword gild. Chef Gary Toast +5/+5. Brunni T3 (both sets).
- **Set membership.** Jewel (set-3 Kobold) and Brood Matron (set-1 Demon) join set 2, appended at the very end of
  set 2's `own` so no existing seeded position moves.
- **New: Big Brain Billy** (`dw_bigbrainbilly`), T2 Dwarf 2/2, set 2: `spellCast` + `spellCastBuffSelf` 1/1. No
  `includeRubies`, so a Ruby is not a Shop spell for it (the house default); Rune of the Spellstone still makes it
  one. Appended last in `SET2_DWARF_RUNE_MINIONS` (set 2's final `own` slot) for seed stability. No art.
- `summonEscalatingText` drops the "N to next step" countdown when the improve steps on every summon (`every: 1`),
  since the live value is the whole story.

Removed ghost policy rows for factories whose only user moved: `spellCastBuffRandomHand:spellCast` (Lou),
`endOfTurnCreateStarformThenBuff:endOfTurn` (Roundabout), `onSummonBuffTribeAll:onSummon` (Flo Rida).

## Tests re-pinned (each to the new contract, nothing loosened)

Card/rune numbers and texts: beastBatchAug12 (Wolvie, Beardsley x Zoo/Oona/Rise), beastDragonBatch0924 (Wolvie shop,
Flo Rida in shop / token / End of Turn / combat), borrowedEcho, contentBatchAug12, ownerBatchAug18b, runeBatchAug19
(Beardsley's Ward), docbot/orderGoldens G4 (+1,+2,+3,+4), set2Dwarves (Chef +5, roster 31), set3Spirits (Lou),
set3CelestialRoster (Lens, Attractor, Roundabout, Twinning), koboldDwarfBatch (Brunni T3), epicRuneBatchAug07 (Deep 5,
Foundry 3), runeReworks0923A (Runic Hoard), runeReworksB0923 (Deep cadence + text), runes.test (RUNES 180, Summoning
+3/+3), cardText.test (Zoo text), echoTendrils (Wolvie), textParse (Summoning magnitude; the improve/every sabotage
now runs on Beardsley's historical text, since no live card prints that shape).
Archive bookkeeping: runeAvengeBatch, runeBatch4T1/T3/T4, runeBatch6, runeChef, runeProfitSharing, runeBatchAug20
(def checks read `ARCHIVED_RUNES`; `sets: []`), set3RuneCuts / set3RuneList / set3RuneRoster / set3RuneDesignT4 (pool
counts), statSpellCategory (Beefy out), set3Scaffold (63 set-3 spells, 23 set-2 Kobolds), sets.test (Brood opted in),
runeGrantImmediacy (Gemcutting exemption dropped), rulesWiki (R-RUNE-08 fp), allTypesPill (Billy art pending),
tallyCoverage (Deep armed).
Seed/heuristic-sensitive: strategy packages census, operators (Coinfire roll count; the Blart test moved to wave 6, the
pre-pivot wave its title names), runeforgeClockEpicBoardfit (sample 80 -> 400 seeds), tools aggregate snapshot.
