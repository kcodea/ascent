# 2026-10-10: Owner balance batch (Demons, Dwarves, Beasts, Gift runes, archives, Drunk Daniel, Hydraskus)

The owner's 2026-10-10 batch, applied exactly. Shared cards change in every set they are in (owner confirmed).
Parallel sessions own the Kobold/Ruby half and the Dragon/neutral half; this PR touches none of their files.

## Minions

- **Doubletap Brewer** (`dw_brewer`): T4 4/2, "End of Turn: Get a Dwarven Ale. Get another if you are Shop Tier 5+."
  (owner's wording). Shout and Echo removed. New optional `bonusAtTier` / `bonusCount` params on `grantRandomAle`,
  counted by ONE shared function, `aleGrantCount` (core `types.ts`), read by the shop (`state.tier`), combat
  (`tierFor(side)`) and the live text (`aleTierText`: a green "(N Ales now)" once the tier is met). R-ALE-TIER-01.
- **Brunni**: "Taunt. Echo: Get a Dwarven Ale." (`combatGrantAle`, the Echo body Brewer used). Keeps Taunt (owner
  ruling); the gilded text now prints Taunt too.
- **Chef Gary Toast** +6/+5 (gilded +12/+10): `onTribeSummonedBuffTribe` reads a separate `health` param (absent =
  mirrors `attack`, the old shape). **Billings** +6/+5.
- **Impossible Todd**: "When a friendly Demon deals damage, give your Imps +2/+1. Pummel (20): Summon an Imp. (Once
  per combat.)" Self-buff and Ward removed (owner ruling). New Pummel marker `dealtDamageSummonToken` in
  `DAMAGE_METER_MARKERS`; `noteDamageDealt` summons `count` (x2 gilded) `tokenId` beside the body through
  `ctx.summon`. R-PUMMEL-SUMMON-01; R-DEALT-01 notes Todd no longer self-buffs.
- **Market Tormentor** +8/+8, **Enigma** +4/+5, **Contract Butcher** +2/+2, **Right Hand Hank** +4/+3, **Grobbus**
  Avenge (3) gets 2 Demons (gilded 4).
- **Big Huggies**: "Echo: Get 2 Picnics." (gilded 4). `deathrattleGrantSpell` now reads `count`. Keeps Taunt (owner ruling on PR #2018).
- **Soul Defiler**: "End of Turn: Cast Staff of Guel and Picnic." Two `castSpell` effects (each its own root
  trigger and beat); gilded casts both twice.
- **Dawnclaw**: `one: true` removed, so both neighbours' Shouts fire; gilded twice (the shared Ryme shape).
- **Kennelmaster**: +2 Attack, `stepAttack: 2`, Avenge (3). Gilded +4 improving +4. The live text helper
  (`summonBuffText`) already reads the params.

## New Set 2 minions (appended at the very end of set 2's `own`)

- **Drunk Daniel** (`dw_drunkdaniel`, T6 6/6 Dwarf): End of Turn `battlecryGrantSpellPowerRun` +2/+2 (gilded +4/+4).
  New policy row `factory:battlecryGrantSpellPowerRun:endOfTurn`. Art: `Dwarves/DrunkDaniel.png`.
- **Hydraskus** (`dm_hydraskus`, T6 6/8 Demon): new `endOfTurnDemonsConsumeShop`. EVERY friendly Demon eats one Shop
  minion. Judgement calls: order is LEFT TO RIGHT along the board (Hydraskus included), and the meal is a RANDOM
  edible Shop minion (the house default for "a minion in the Shop": Appetite Agent, Chipper, Baal). When the Shop runs
  dry, later Demons eat nothing. `eotTickCount` returns one tick per Demon, so each bite is its own root trigger and
  beat (projection and legacy beat list agree through `endOfTurnTicksOf`). Gilded: every eater gains double
  (`times`). R-CONSUME-ALL-01. Art: `Demons/Hydraskus.png`.
- **Striker** (`dw3_striker`) joins set 2 (shared definition, still in set 3).

## Runes

- **Happy Birthday** every 3 turns (`every: 3` on the reward, armed as `giftBirthdayEvery`; old runs keep 2).
- **Merry Christmas**: "Discover a Gift. Repeat every 2 turns." (`every: 2`, `giftChristmasEvery` /
  `giftChristmasTick`, Birthday's pattern; old runs keep every turn).
- Both print an `x/N turns` Runeforge countdown (`runeTally.ts`); Birthday left `NOT_A_METER` in
  `tallyCoverage.test.ts`. R-GIFT-CADENCE-01.

## Archived everywhere (`ARCHIVED_CARDS`, still resolve by id)

Hellrider, Arnold, Chicken Brawl; Common Ground, Might of Aeon, Dissipate, Rival's Reflection, Ironclad Requisition.
Dissipate and Rival's Reflection left `SET3_SHARED_SPELL_IDS`. **Rune of Might still casts Might of Aeon** (it resolves
through `CARD_INDEX`; proved in `balanceBatch1010.test.ts`). **Arnold was the last source of Beefy**, so Beefy (archived
2026-10-07) is now unreachable in new runs.

## Tests

New `packages/sim/src/balanceBatch1010.test.ts`. Re-pins are listed in the PR body.
