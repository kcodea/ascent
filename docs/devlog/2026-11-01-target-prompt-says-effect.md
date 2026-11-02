# 2026-11-01 · The targeting pill says what the pick will do

Owner ask 2026-11-01 (screenshot of the orange "Choose a minion for Crest of the Climb's Shout" pill): "make this show what
the buff is going to do ... it should say "Select a minion to grant +4 Health" or "Select a Dwarf to grant +45 Health" for a
baby gastrid". Branch `feat/target-prompt-says-effect`. Rule R-TARGET-PROMPT-01 (approved/text.ts).

## What

- `packages/ui/src/targetPrompt.ts`: `targetPromptFor(run, shownText, spellBonus, spellBonusH)` builds
  "Select a <noun> to <verb phrase>" for the run's `pendingTarget` (a played aimed Shout, a Choose One branch in its deferred
  target step, Common Ground's second pick, a Mage-Pup's taught aimed spell).
  - **Noun** from the target filter: `effectiveTargetTribe` (so Rune of Open Appetite widens it back), Cage Breaker's
    effect tribe, `target: 'any'` = "minion", `friendly` = "friendly minion", Roomworks = "with End of Turn",
    Common Ground = "second friendly minion". Article a/an.
  - **Verb** from `TARGET_VERBS`, a table keyed by effect factory id (not card id). Clauses with the same verb merge
    ("grant Rise and +1/+1").
  - **Live numbers.** Minion Shouts compute as their factory pays: golden x2, Humphry's per-other-Dragon steps (the aimed
    play has already recorded itself, the arena factory's `- 1`), Baby Gastrid's Gold spent this turn, Rune of Full Measure.
    Spells read the LAST `{{…}}` live stat token the card already prints (`spellDisplayText` / `chooseOneBranchText`: spell
    power and every spell scaler), else their params.
  - **Fallback** for a factory the table does not cover: "Select a <noun> for <Card>'s Shout" (or "for <Card>" on a spell).
    A tripwire test fails if any aimed Shout or targeted Choose One in the card index reaches the fallback.
- Look: `.targetprompt` moved from orange (`--acc-dk`) to the rail language (`.lrv-rank` / `.lrv-name`): the navy plate
  gradient, a thin `--ui-edge-main` gold edge, `--font-title` white text with the layered dark shadow. Numbers wear
  `--atk` / `--hpc`, keywords `--ui-title` gold. Inline values (no `--pill-plate` token on main yet). Wraps centred on a
  phone (max-width 92vw). Static paint; the existing one-shot opacity fade is the only motion.
- `@game/sim` now exports `taughtAimSpell`.

## Not covered

- The hero power's armed line ("Pick a minion…" under the hero name) and Equipment aims show no pill; unchanged.
- Spell factories the table leaves to the fallback (only reachable through a Mage-Pup's taught spell): `spellDevour`,
  `spellDisplace`, `passTargetMinion`, `spellLayaway`, `spellMarkClosedCasket`, `spellMarkPartingCry`,
  `spellRefreshToTribe`, `spellGainOfTargetTribe`, `spellStealAdjacentRubies`, `spellAddAllTribes`, the `gift*` spells,
  `spellBloodlust`, `spellSellToBeast` / `spellSellToDemon` / `spellSellToShopRightmost`, `spellDemonConsumeFodder`,
  `spellBuffHealthGrantFlurryDragon`, `whisperGrantSeedEcho`.

## Verified

`packages/ui/src/targetPrompt.test.ts` (Gastrid live + golden + Full Measure, Humphry, Crest with spell power, Runic Beetle
plain + golden, a taught Spirit Fire, Common Ground, the non-stat Shouts, the fallback, the coverage tripwire). Screenshots
from an isolated headless bench build.
