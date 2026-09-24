# 2026-09-24 — Beast / Dragon batch: Execute grants, Grim's per-game tally, Wolvie's Rise, five new Set 2 minions, four archives

Owner card batch of 2026-09-24, built on `feat/beast-dragon-batch`.

## Execute

Owner: *"Execute is what we renamed Venom. it's the same mechanic as that but reworded. to this effect, make sure the
minion Venom has the keyword Execute."*

- Found: the keyword is `V`. Its player-facing name was ALREADY "Execute" everywhere a player reads it (`terms.ts`
  maps Venomous → Execute, the glossary entry `execute`, combat floats, quest text, the Unit editor). The minion
  **Venom** (`venom`, set 1 neutral, shared into sets 2 and 3) already had `keywords: ['V']`. No change was needed
  for either.
- Changed: the Doc Bot text lexicon still named `V` "Venomous", so "give another Beast **Execute**" did not parse.
  `KEYWORD_LEXICON.V` is now canonical "Execute" (Venomous kept as the alternate).
- Oracle: R-EXECUTE-01 (the rename) and R-EXECUTE-02 (Raven / Tort grants), `approved/keywords.ts`.

## Beasts

- **Grim** (set 1 Beast, shared into set 2): T6 → **T5**, stats kept (7/1). "Echo: give your Beast Aura +3/+2 for every
  Echo triggered this game" (gilded +6/+4). Reuses the existing run tally `deathrattlesTriggered` (bumped BEFORE a rattle
  fires in both phases, carried back from combat as `playerDeathrattles`) and the dormant `deathrattleBuffTribeByTally`
  factory, now with an asymmetric rate (`attack` / `health`) and the living-self membership rule that
  `deathrattleBuffTribe` adopted on 2026-08-20. So N includes Grim's own Echo (owner ruling). An extra re-fire of the
  same death reads the tally at death (existing rule in both phases). Oracle: R-ECHOTALLY-01 (`approved/triggers.ts`).
  - **Static text by owner ruling** (a sanctioned exception to the live-value default): *"grim text doesnt need
    flavor. just Echo: Give your Beast Aura +3/+2 for every Echo triggered this game."* Grim prints exactly that on
    every surface. The dormant `tallyBuffText` helper (its only user) was removed from `cardText.ts` / `instView.ts`.
- **Wolvie**: Taunt kept. Owner correction the same day: *"Taunt. Echo: Give a Beast +2/+4 and Rise."* (it briefly
  read "give the next Beast you summon Execute" in this branch; that version never shipped). It now rides
  `deathrattleBuffRandomTribe` with a new optional `keyword` rider: a random other friendly Beast takes +2/+4 AND Rise
  (the existing `R` keyword, granted through the arena's `grantReborn`; combat arms `rebornAvailable`). A Beast that
  lacks Rise is preferred; the stats land either way. Gilded: +4/+8, and the grant goes to 2 different Beasts. One
  arena body serves combat, the Shop, End of Turn and borrowed plays. The next-summon channel is back to exactly
  main's shape (no keyword), and its `deathrattleBuffNextSummon` factory is dormant (no live user; policy row removed).
  Oracle: R-ECHOKW-01 (`approved/keywords.ts`).
- **Archived** (moved verbatim to `cards/archive.ts`): **Dunkey** (`b2_dunkey`), **Moira** (`b2_moira`), **Moonhowl
  Mentor** (`b2_moonhowl`).
- **Moonhowl Mentor's runes** (set 2): **Rune of the White Wolf** (`rune_white_wolf`, Epic, "teach a Shop spell to a
  Mage-Pup") moved to `ARCHIVED_RUNES`. **Rune of Moonhowl** (`rune_moonhowl`) was already archived on 2026-09-23. No other
  live rune names the Mentor, the Mage-Pup or `grantMagePupTaught`, so nothing was ambiguous.

## Dragons

- **Karwind**: T5 → **T4**, +3/+3 → **+2/+2** per Shout (gilded twice).
- **Mushy** (`d2_scalefeather`): T5 → **T4**. **Flutterdrake**: T5 → **T4**.
- **Earthbreaker** (`d2_scalechanter`): T4 → **T3**, per-spell Dragon buff +2/+3 → **+2/+1** (gilded +4/+2).
- **Embercrest** (`d2_embercrest`) archived.

## New Set 2 minions (art wired from `Set 2 Minions/…`)

| Card | Tribe / stats | Text | Mechanism |
| --- | --- | --- | --- |
| Raven `b2_raven` | Beast T4 4/6, Rally | Rally: give another Beast Execute. | new arena body `rallyGrantKeywordRandomTribe` (both phases) |
| Tort `b2_tort` | Beast T5 2/9 | Avenge (4): give another Beast Execute. | `avengeGrantKeywordRandomTribe` → the same arena body (combat, like every Avenge) |
| Flo Rida `b2_florida` | Beast T6 7/5 | When you summon a Beast, give your Beasts +4/+4. | new arena body `onSummonBuffTribeAll`: fires on playing a Beast from hand, every Shop / End-of-Turn summon, and every combat summon (owner: "summon is also just playing a card on board") |
| Beev `b2_beev` | Beast T3 4/4 | When a Beast attacks, give it and this +2/+2. | new arena body `onTribeAttackBuffAttackerAndSelf` |
| Humphry `d2_humphry` | Dragon T3 3/5 | Shout: give a friendly Dragon +3/+4. | `battlecryBuffTarget`, `target: 'friendly'` + `targetTribe: 'dragon'` (Emissary / Brood Whelp convention) |

"Another Beast" is a random other friendly Beast that does NOT already have Execute (the Toxin Tender / Gravewarden
lacks-check, from the R-TARGET-03 `others()` pool); none → no-op. Gilded grants it to 2 different Beasts. The four new
factories are registered in the `EffectFactoryId` union, the schema whitelist and the presentation policy registry.

## Tests / tooling

- New `packages/sim/src/beastDragonBatch0924.test.ts` (33 cases, real reducer + simulate paths), including Flo Rida's
  three paths (Shop play, Shop token summon, End-of-Turn summon under Rune of Combat Prowess) plus its combat summons.
  Wolvie's combat pins in `beastBatchAug12.test.ts` rewritten for "+2/+4 and Rise" (including a live Rise).
- Updated number pins: Grim (simulate, run, prowess, beastBatchAug12, LG-SCOPE magnitudes), Karwind (run, simulate,
  recruitBuffFx, set2Dragons), Earthbreaker (set2Dragons), Wolvie (borrowedEcho, echoTendrils), census / rune-pool counts.
- `gildingKinds.test.ts`: Dunkey was the gilded-token Avenge exemplar; Steadfast Champion ("summon a Golden Spear
  Warden", same Avenge trigger) carries it now.
- `curriculum.test.ts` economy Runeforge fixture: the off-package rune is Rune of Fury (was Strange Caravan, whose
  random-minion grant reads the pool and started out-valuing Vault once the pool changed).
- `replayOdds.test.ts`: the Midas R4 and R6 recorded losses are excused. Both boards carry Wolvie; the probe resims
  under today's rules, where the reworked Wolvie makes them favourites (R4 ~62% with the same-day Ruby batch, R6 ~97%).
- `artNoRedundantMasters.test.ts`: the art-file cap moves 1262 → 1268 for the five new minion arts.
- Doc Bot: `contracts:extract`, `docbot:text`, `rules:seed` regenerated; unresolved-parse pin 94 → 95 after the Ruby batch (Beev's "give it
  and this"). `noSelfTarget` / `anotherMinionExcludesSelf` declare the new picker. Operator role tables drop the
  archived cards.

## Judgement calls (flag to the owner)

- **Beev attacking itself** gains +2/+2 ONCE ("it" and "this" are the same body), not twice.
- **Flo Rida** buffs itself and the arriving Beast too ("your Beasts"), and its own arrival does not trigger it.
- **Gilded Wolvie** gives 2 different Beasts +4/+8 and Rise each (the stats doubled AND the keyword-grant gild, as
  instructed). That is 4x the plain stat total; say if you meant 2 Beasts at +2/+4, or 1 Beast at +4/+8.
- **Wolvie** prefers a Beast without Rise, and still gives the stats when every Beast already has it.
- **Humphry's text** follows the house wording "give a friendly **Dragon** +3/+4" (owner wrote "give a Dragon").
- **Grim's text** uses the owner's capital "Give" after "Echo:" (house style elsewhere is lowercase).
- New cards have no strategy-operator roles yet (the bot treats them generically).
