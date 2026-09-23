# 2026-09-23 — Balance 9/23, tranche 4: rune reworks, group A (spell / Shout / Dragon / economy)

Owner batch "9/23", tranche 4, group A. Twenty-one runes reworked to the owner's items (verbatim below), three
audits (Spellstone, Thrift, Combat Prowess), and one engine contract that is new: **the cross-phase Shout tally**.
Costs are tranche 3's job and were not moved here (Investment, Quick Study, Collector, Enchantment keep their
current cost; the def comments say so).

"Spell Market" in the owner's list matched exactly one rune, `rune_spellmarket` (Rune of the Spellmarket) — treated
as the same rune. No other name matched none or several.

## The cross-phase Shout tally (Chorus, Hoardcalling — and every other Shout tracker)

Owner, on Hoardcalling: *"make sure this (and all trackers like this) work in combat too and carries count through
both."*

One counter per "when you trigger N Shouts" rune, in the run's `runeThresholds` as before. Two feeds:

- **Shop**: the reducer boundary advances the `shout` meter by `lastShoutFires` (every fire, Drakko repeats
  included), as it always did.
- **Combat**: `questCombatMods` threads the meters INTO the fight with their shop ticks
  (`QuestCombatMods.shoutMeters` — only meters whose payout a fight can deliver as a hand grant; the Merchant's
  Chorus' this-turn Shop buff stays shop-only). `simulate()` subscribes to `battlecryTriggered` (registered before
  the Start-of-Combat pass, so a Herald / Sovereign / Twilight Shout counts) — every fire on a side increments
  `shoutFires[side]` and advances that side's meters. A trip pays at once: `grantSpell` draws a random Shop spell
  from the side's own pool at or below its tier, never an Ale (the same filter the shop pays); `grantOneOf` draws
  one of the named ids. The grant rides `handGrants` (→ `playerHandGrants`) and emits `toHand`, so it flies to hand
  in the replay like every other in-combat grant. The final ticks come home as `playerShoutMeters`; `settleCombat`
  writes them back so the next shop continues from the same number. No double count: the fight advanced the meter
  itself, settle only copies the tick.
- **Every other Shout tracker** gets the combat count at settle from `playerShoutFires`: the Shout quest objectives
  (`event: 'shout'` — Echoing Roar, Twin Sun Oath, …), Bane's Presence (`applyShoutsForShopBuff`) and the Author's
  Hand Shout half. These already counted combat Echoes and Rallies; Shouts now match.
- Enemy seats accumulate symmetrically (no `toHand` event), like every other carry-back.
- The docbot's combat-mod scan stages a combat Shout for `shoutMeters` (`SHOUT_STAGE_KEYS`), so the mod is
  verified-active, not inert.

In combat the trip pays through the hand-grant channel without a `questTrigger` badge burst: a threshold rune's
`sourceId` is not a `combatFlag`, so `combatFlagOwner` could not resolve it to a policy key. The `toHand` event
is the visible moment. (Flagged: if a badge pulse is wanted, the surface needs a threshold-rune combat key.)

## Per rune (before → after)

| Rune | Before | After |
| --- | --- | --- |
| Rune of Distillation | Shop-minion casts also cast on your left-most | also cast on your **left AND right-most** (one body when the board has one) — spells and Rubies, `distillationEdges` |
| Rune of Draconic Curiosity | a Dragon **Discover** pick → a Shop spell | **buying** a Dragon → a random spell (the reducer's buy branch; All-types count) |
| Rune of Investment | sell 2 → 2 Rubies | sell **4** → 2 Rubies **and improve your Rubies +1/+1** (improve first, so the Rubies arrive at the new strength); badge `sold/4` |
| Rune of Lorekeeping | Shop spell on a minion → +4/+4 | **any** spell cast on a friendly minion → **+3/+3**: Shop spells, Gifts/Clues (the Gift play branch), Rubies (every landing via `fireOnRubyPlayed`; bounces excluded). One site: `applyLorekeeping` |
| Rune of Overtime | 15 Gold → an Ale | **12** Gold → an Ale |
| Rune of Quick Study | EoT: Gold Font + 2 random spells, 2 turns | **Get a Quick Study and a Gold Font now; repeat next turn** (`grant` + `repeatInTurns: 1`) |
| Rune of Rare Goods | a Salesman every 2 turns (first one 2 turns in) | **a Salesman now**, then every 2 turns (`multi`: grant + cadenced recurringGrant) |
| Rune of Gemspam | 10 Gold → a Ruby on every minion | **15** Gold → **improve your Rubies +1/+2 and get a Ruby** (`improveRuby` + `grantRuby`) |
| Rune of the Gem Dividend | 5 Rubies in a turn → 3 Gold next turn | **the first Ruby cast each turn → 3 Gold now** (`grantGold`, `oncePerTurn`, per 1) |
| Rune of the Chorus | 4 Shouts → a Shop spell (shop only) | **3** Shouts → a random spell, **cross-phase** |
| Rune of Hoardcalling | first Dragon Shout each turn → a Shop spell | **3 Shouts → a Hoardflame or a Dragonflame** (`grantOneOf`), cross-phase; the `runeHoardcalling` flag + per-turn latch retired |
| Rune of the Drake Skull | every Shout: board's ends +5/+5 | every Shout: **left and right-most Dragon +6/+6** (`shoutEdgeBuff` with `tribe`, stored on `shoutEdgeTribeBuff` so Twin Sun Oath's untribed channel never merges with it); tribe-gated `dragon` |
| Rune of Ancestral Roar | Dragons with a Shout gain "Echo: trigger this Shout" (combat flag) | **End of Turn: Dragons +6/+6 for every Shout triggered this turn** — a `recurringEndOfTurn` LUMP (R-REPEAT-01: one instance sized by `shoutFiresThisTurn`); badge `N Shouts · +X/+X`. The combat `runeAncestralRoar` engine branch stays for replays; no content sets it |
| Rune of the Runic Hoard | a copied Shop spell → all Dragons +1/+1 | **every spell cast → 3 random Dragons +2/+3** (`fireRunicHoard`: Shop spells + Gifts from `noteSpellCast`, Rubies from the reducer's Ruby path) |
| Rune of the Glider | +4/+4 | **+6/+5** |
| Rune of the Dragon's Pantry | 5 Dragons → 2 Shop spells | 5 Dragons → **a random Dragon + a Shop spell** (`grantRandomTribe`) |
| Rune of the Empty Plate | 3 Consumes → a Shop spell | **2** Consumes → a Shop spell |
| Rune of the Collector | 3 types in a turn → Discover (once/turn) | **every 3rd minion bought in a turn → a random copy of one of those three** (`collectorBoughtThisTurn`; a 6-buy turn pays twice; spells do not count) |
| Rune of the Golden Splinter | "Once per run." | "Once per game." (text only) |
| Rune of Enchantment | +2/+3 per shop cast, +4/+6 in combat | **combat only, +6/+8** (`ENCHANTMENT_COMBAT`); the shop half deleted |
| Rune of the Spellmarket | first stat spell each turn feeds the right-most offer | **every 4 Shop Spells, cast Staff of Guel** (`castCards` → `castSpell`, the Gilded Ledger's rune-cast path — the cast beat `factory:spellBuffShop:cast` with the spell as source is what the presentation can hook; the flag + latch retired) |

New `runeThreshold` payloads (types + schema + state + `payRuneThreshold` + `questText`): `grantGold`,
`improveRuby`, `grantOneOf`, `grantRandomTribe`, `castCards`. New EoT effect `runeAncestralRoar`. Retired reward
kinds `runeHoardcalling`, `runeSpellmarket` (their state flags, per-turn latches, reset lines and carry-over
excuses went with them); `typesBoughtThisTurn` / `collectorUsedThisTurn` → `collectorBoughtThisTurn`.

## Audits

**Spellstone** ("make sure that this works across all shop spell based triggers. this is important") — a
Spellstone Ruby reached the counters, the `spellCast` thresholds, the board's `spellCast` watchers, spell power
and the combat cast trigger, but **not the per-cast Shop-spell runes** (Summoning, Might, Kindling, Flagship,
Scales): those lived only in `castSpell`'s tail. Fix: the tail is now `fireShopSpellCastRunes`, called from the
Shop-spell cast AND from `countRubyAsShopSpell` per cast. Enchantment's combat half fires on a combat Spellstone
Ruby (pinned through Attacking Gems).

**Thrift** ("every shop spell that grants stats in any way") — an empirical sweep (cast every buyable Shop spell
on a mixed board, diff the stats) found five granters outside the `spellBuff` prefix that `isStatSpell` missed:
Great Pot (`buffOnePerTribe`), Perfect Vision (`spellSetStats`), Ruby Excavation (`spellPlayRubiesAll`), Ruby
Transfer (`spellStealAdjacentRubies`), Cupcakes (`spellTargetConsumesShop`). Added to `STAT_SPELL_EXTRAS` (this
also admits the untargeted ones to the Gilded Ledger's random pool, which is the same definition on purpose).
Judgement calls, flagged: Eyes of Aresmar (gilding doubles stats — left out, it is a transform) and Quick Study
(spell power for future spells — left out, per the existing note). The sweep is kept live in the test file.

**Combat Prowess** ("make sure this works with all runes/minions") — compared every `rmods.*` Start-of-Combat
block in `simulate.ts` against `socRuneReplaysOf`: one gap, **Rune of Held Strength**, reworked into a
Start-of-Combat grant on 2026-08-27 (a week after the replay list) and never added. Now replays at End of Turn
(the ends gain the left-most held minion's live stats, permanent, × copies). The other absences are the documented
combat-only ones (Weaken, Food Chain, Crucible, Empty Graves). The minion pass was already complete
(`socDispatch.test.ts`). The comparison is now a test.

## Rails moved (legitimately)

- Text-parse grammar grew for four owner phrasings: "an additional +X/+Y", "Repeat next turn", "(Once per
  turn.)" with the stop inside the parenthesis, "Targeted spells cast on Shop minions also cast on …". Distillation's
  frame keeps "also cast on" (the parser's known shape) with the owner's "targeted" and "left and right-most".
- `tallyCoverage`: Lorekeeping / Runic Hoard / Drake Skull are per-event grants (NOT_A_METER); Investment,
  Collector and Ancestral Roar gained `runeTally` branches.
- Presentation policies: `rune:rune_quick_study:onAcquire` (was `:endOfTurn`), `rune:rune_ancestral_roar:endOfTurn`
  (the `:combat` key left with the flag).
- Docbot: `shoutMeters` is object-armed + Shout-staged in the combat-mod scan; `shoutFiresThisTurn` /
  `collectorBoughtThisTurn` excused in the carry-over scan; `rune_ancestral_roar` classified under R-TURN-01;
  `shoutFiresThisTurn` normalized in the play differential; the grant-immediacy exemptions for Investment and
  Quick Study dropped (Quick Study now genuinely grants on purchase).
- Oracle: R-RUNE-10 (cross-phase Shout tally), R-RUNE-11 (Lorekeeping every targeted cast), R-RUNE-12
  (Distillation both edges), R-RUNE-13 (Spellstone reaches the per-cast runes), R-RUNE-14 (Combat Prowess +
  Held Strength; the Thrift extras).

## Tests

`packages/sim/src/runeReworks0923A.test.ts` (45): the tally in both directions through the real reducer bridge
(shop → combat pays mid-fight and writes the tick back; combat → shop carries the count), the other trackers at
settle, determinism with a meter armed, and one block per rune. Existing tests updated where they pinned the old
contracts (Distillation left-only, Investment 2 sells, Quick Study's EoT recurrence, Hoardcalling / Spellmarket
flags, Gemspam's 10, the Pantry's 2 spells, Draconic Curiosity's Discover trigger).

Judgement calls to confirm: Collector pays every 3rd buy within the turn (not once per turn); "random spell" on
Chorus / Curiosity means the same run-pool Shop spell (never an Ale) the old texts granted; Runic Hoard counts
Rubies as spells (the Forsaken Mage "a spell" ruling); Drake Skull is now tribe-gated `dragon`.
