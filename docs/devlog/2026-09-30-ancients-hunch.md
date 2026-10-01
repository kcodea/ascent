# 2026-09-30: Ancients × Hunch

Hunch's six Ancient pairings (hero id `hunch`, power **Rounded Spellbook**: "Get a copy of the last spell you cast.
Costs 3 Gold, reduced by 1 each turn.", untargeted, once per turn, the shrinking price charged in the reducer), in the
owner's words, built on the Ancients proof of concept and mirroring the Warden, Auctioneer, Lord of the Risen and Albus
pairings. Still dev-only (the Scene Builder's Set 3 Ancients flag), so there is no patch note, like the hero PRs before
it. Hunch already had an awakening style (the Echo copy) and a gate palette, so no UI theme work was needed.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Avenge (4) Improve your spells by +1/+1." | Every 4th friendly death in a fight improves your spells +1/+1 through `grantSpellPower`, the Rune of Appraisal shape (Rune of Mastery's improve reps, Rune of Fury's extra fire). Narrated as "+1/+1 Spell Power" at the hero power on the death that completed the count, so every live spell number ticks there. |
| Fortune | "Rounded Spellbook also increases max gold by 1." | Each use that hands over its copy adds 1 to `maxGoldBonus` (the Gold Font channel: above the natural curve, no Gold this turn). |
| War | "Shop Spells cast an additional time in combat" | Runebloom Matriarch's rule from the hero: `QuestCombatMods.ancientSpellCastExtra` seeds `spellCastExtra`, the `castInCombat` repetition channel, for the whole fight. |
| Genesis | "Casting 5 spells resets rounded spellbook at 1g" | A running spell count since the pick (every phase). Every 5th recharges Rounded Spellbook (usable again if used this turn) and sets its price to 1 Gold, never raising a lower price; it keeps shrinking 1 per turn from there. |
| Time | "Spells from rounded spellbook cast twice." | Each copy is stamped `castMult: 2`, a new per-card multiplier read by `spellCasts` beside the other "casts twice" multipliers, so the play resolves two genuine casts and the hand badge shows x2. |
| Bonds | "Casting spells grants your left and right-most minion +2/+3." | Shop: every spell cast buffs the two board ends +2/+3, permanently (once for a lone minion; the Rune of Kindling shape). Combat: every cast buffs the left-most and right-most living minions for the fight. |

## How it is wired

- **Registry** (`packages/sim/src/ancients.ts`): a `hunch` block and six new `AncientEffect` variants.
  - `ancientOnSpellCast` (Genesis' count, Bonds' Shop half) is called from `noteSpellForCountRunes`, the Shop's
    every-spell chokepoint (Shop spells and Gifts through `noteSpellCast`, Rubies from the reducer's Ruby branch; a
    reward token never reaches it).
  - `ancientOnSpellbook` (Fortune, Time) is called from the reducer's `roundedSpellbook` branch with the copies that
    just landed.
  - Genesis' combat half: `ancientAfterCombat` counts `CombatResult.playerSpellsCast`; a recharge crossed there prices
    the NEXT Shop at 1 Gold (the power recharges at the new turn anyway).
  - The price override rides Hunch's own clock: `hunchResetWave` is re-based `3 - 1` turns back, so
    `roundedSpellbookCostOf` (the reducer's charge and the coin) reads 1 with no new state.
- **Combat** (`@game/core`): three player-only mods, `ancientAvengeSpells` (an `avenge` bus listener beside the rune
  Avenges), `ancientSpellCastExtra` (the seed of `spellCastExtra`) and `ancientSpellEdges` (in `ctx.castSpell`, right
  after the `spellcast` counter beat). One new carry-back, `ancientSpellImproved` → `CombatResult.playerAncientSpellImproved`,
  present only when Death is on, so every other result is byte-identical.
- **`BoardCard.castMult`**: a hand spell's cast multiplier. Registered `shop-only` in the snapshot registry (a spell
  never reaches a fighting board), like `extraCasts`.
- **Live text**: `{avengeNow}` / `{deathA}` / `{deathH}` (Death's progress and total, folding `fxFriendlyDeathPreview`
  during a fight), `{bookGold}` (Fortune), `{genesisLeft}` (Genesis' countdown, folding `fxSpellsCastPreview`).
- **Oracle**: R-ANCHUNCH-01..06 in `packages/rules/src/registry/approved/heroes.ts`.
- **Tests**: `packages/sim/src/ancientsHunch.test.ts`.

## Presentation (owner ask the same day: "add tendrils/general effects where necessary")

Every visible consequence has its beat, on existing defs and channels (no new art, nothing looping):

- **Bonds, Shop**: each grant is its own `recruitBuffFx` record stamped `fromHeroPower`, so the generic buff tendril
  leaves the hero-power button for each end (`Recruit.tsx` `replayBuffFxEvents`). **Combat**: the grant is labelled
  `Rounded Spellbook` (`HUNCH_BONDS_COMBAT_LABEL`), a `HERO_POWER_BUFF_LABELS` key, so the replay plays the same
  tendril from the button (Emissary's United Front route), one per cast.
- **Bonds had no tendrils in the real game** (owner on 5173, the same day) while every sim test passed. Three causes, all
  in the presentation layer:
  - Shop: `coalesceBuffFxByTarget` keeps one record per target, so a stat spell's own record (Growth) swallowed the
    Bonds record for the same minion. Hero-power records now keep their own key.
  - Shop: the replay scheduled its lands by target uid, so two records on one target played the later one twice. It
    now keys each land by its record.
  - Combat: the Bonds buff was emitted inside the cast, so it inherited the cast's `spellId`, and Growth's cast effect
    replaces every tendril its buffs carry. The buff is now emitted with the cast mark cleared.
  `packages/ui/src/ancientsHunchFx.test.ts` drives these real presentation decisions from the sim's events and records.
- **Death** (owner on 5173: "have the avenge tally in the center of the hero power in combat, and make the +1/+1 show
  there as well, not in board"): the Avenge (4) countdown sits in the centre of the power on Frank × War's disc
  (`.hpb-avenge`, the same rule as the Frank branch), live through the fight (`fxFriendlyDeathPreview`) and back to 4
  after each trigger; it reads 4 in the Shop, since the count is per combat. The "+1/+1 Spell Power" narration is
  stamped `heroPower`, so the flourish and the float play over the power button (`spellPowerNarrationAnchor`) and no
  body pulses.
- **Fortune**: the authored `coin` burst out of the Gold pill on each use (`bookGoldFxSeq`).
- **Genesis**: the authored `hero-power-spark` plus the pulse cue on the button at each recharge (`rechargeFxSeq`),
  and the live countdown in the power text.
- **Time**: the cast point's burst now reads the HAND instance's cast count (the card is captured before the play
  dispatch), so the copy's second cast gets its own burst 200 ms later, like any other multicast; each cast is a
  genuine cast in the sim.
- **War**: its extra casts are genuine combat casts, each with the spell's own cast beat already.

## Judgement calls (open for the owner)

- **Genesis "resets"** is read as a RECHARGE (the power is once per turn, and a price-only reset would often do
  nothing or even raise a 0 price to 1): usable again this turn, at 1 Gold. The price is never raised. If the owner
  meant only the price, drop the `heroReady = true` line in `hunchGenesisTick`.
- **What counts as "a spell"** for Genesis and Bonds: every spell cast, Rubies and Gifts included (the owner's "all
  spells count" rule for spell-count runes), never a reward token. In combat it is every combat cast (`ctx.castSpell`);
  a combat Ruby play does not go through that channel, so it does not count there.
- **Genesis' count** runs from the pick, across turns and phases, with no reset besides the payout.
- **Death is combat-only**: Avenge is a combat keyword in this game (the Shop has no Avenge counter).
- **Fortune is once per use**, not per copy (Wishbone's second copy does not add a second max Gold), and it is not
  paid on a refused use (no spell yet or a full hand).
- **Time** is a multiplier ("cast twice"), not an added cast, so it stacks multiplicatively with other "twice"
  effects, like Hoardflame. It applies to every copy the use hands over (both under Wishbone).
- **Bonds with one minion** buffs it once. In combat its buff lasts the fight (the standing combat buff rule), the
  Auctioneer's Bonds precedent.
