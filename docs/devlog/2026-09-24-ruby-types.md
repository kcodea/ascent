# 2026-09-24 — Ruby types (owner Ruby batch + follow-up)

The owner's Ruby batch, on `feat/ruby-types`. Content, engine, presentation and tests in one PR.

## What shipped

**Four new Ruby tokens** (set 2 tokens, `ruby: true`), each a 1/1 Ruby that mints at its base plus the run's Ruby
strength, with a KOBOLD rider (`CardDef.rubyRider`, new `RubyRider` type in core):

| Ruby | Rider on a Kobold | Target |
| --- | --- | --- |
| Golden | gain 2 Gold (`gainGold`) | any (a Kobold Shop offer pays too) |
| Splintered | bounces once: Resonance Idol's hop (`rubyPlayedBounce`, 1 random other friendly, never doubled by a Gilded target) | friendly |
| Ripple | casts again on the same minion: a real second landing that counts for every Ruby / spell tally, never a third | any |
| Dark | consumes the Shop minion with the highest Health (ties leftmost) via `consumeShopOffer`, the stats land as `Ruby` buffs | friendly |

- Riders resolve in the reducer's play-Ruby branch, once per cast, on the DIRECT target (`applyRubyRiderAction` in
  recruit.ts). Hops (Splintered's own, Resonance Idol, Candle Conduit, Redirection, Distillation) carry the stats and
  the Ward rider only. Oracle: **R-RUBY-02**.
- **Warding Ruby** is now +1/+2 (def health 2) with the owner's wording. The R-RUBY-01 bounce payload still holds
  (wardingRubyBounce.test.ts updated to the 1/2 line).
- **"A random Ruby"** = `RUBY_TYPE_IDS` (all six, equal odds, seeded): `mintRandomRubies` in the Shop, the new combat
  `ctx.grantRandomRubies` (drawn on the fight RNG, carried back as `CombatResult.playerRubyGrantIds`, minted at
  settle). Oracle: **R-RAND-02**.
- **Ruby Shipment**: cost 2, "Get 2 random Rubies" (`getRandomRubies`, also a combat-castable spell family).
- **Kobe**: keeps Taunt 5/6; new Pummel marker `dealtDamageGetRandomRuby` (every 15, `maxPerCombat: 2`, Gilded 2 per payout).
- **Shardluck**: T6 8/5; Choose One between `battlecryPlayRubiesRandomTribe` (3 plain Rubies, each on a random OTHER
  friendly Kobold, per R-TARGET-03) and Veinstorm x3 (Gilded 6 / 6).
- **Gemheart Carver / Geode Guardian**: `deathrattleSummonRubyStats` gained `golems` (Carver: 2) and `keyword` (Geode:
  Taunt) params. NOT `count`: Kurse rides the same body with `count` = its Avenge threshold, which briefly made Kurse
  summon three Golems per Avenge before the rename.
- **Blast Pump** casts the new token Shop spell `rubyblast` ("Cast a Ruby on all of your minions"); Gilded casts it twice.
- **Prismatic Pick** branch 1 is `discoverRuby` (3 of the 5 special Rubies). A discovered Ruby is MINTED
  (`takeDiscoverPick`'s new Ruby branch) so it carries the Ruby strength.
- **Gemheart Legionnaire** (Set 3 Kobold T4 4/8): `onSummonCardPlayRubiesSelf`, 5 permanent Rubies per friendly
  Golem summon, Shop and combat (Gilded 10). Oracle: **R-GOLEM-01**.
- Follow-up: **Rune of Investment** moved to `EPIC_RUNES` (random Rubies); **Rune of Resonance** is now
  `rubyExtraCasts: always` + the new `runeRubyDrip` reward (a random Ruby now and every Start of Turn); **Gem Sage**
  is `onGetRubyRandomRuby` (a module latch stops a Sage's own Rubies re-triggering any Sage; Oracle **R-RUBY-03**);
  **Dealski** (Set 3 Kobold T4 6/6) mints 2 Rubies per Choose One played.

Resonance with the new Rubies (each cast resolves its own rider): Ripple lands 4 times (+4/+4, 4 Ruby casts),
Golden pays 4 Gold, Splintered lands twice on the target and bounces twice, Dark eats the two highest-Health minions.

## Presentation

- `RunState.rubyRiderFx` / `rubyRiderFxSeq` (per-action, bounceFx contract) tells the shop which rider fired.
- Golden Ruby plays Paymaster Pimm's own `shout` binding (`coin-shout` + `maxGold`) on the target 180 ms after the gem.
- Ripple and Dark space their target's gems (`spaceLands` in `channels/rubyLanded.ts`): Ripple 320 ms apart; Dark's
  second gem lands at `DARK_RUBY_CONSUME_DELAY_MS` (250) + the consume duration, and the consume ghost is placed at
  once but its shake + pull wait 250 ms (`playFodderEat`'s new `startDelayMs`). A Dark target's eaten stats are
  withheld by the consume hold only (never both holds on one badge).
- Ruby text: `rubyLiveText` swaps the printed +A/+H for the live grant on every Ruby type (hand + Discover).

## Verification

- `packages/sim/src/rubyTypes.test.ts` (51 cases, every item through `reduce` / `simulate`), `packages/ui/src/rubyTypesUi.test.ts`.
- Live on a throwaway sandbox run (own dev port 5219): Golden (gem, then coins), Splintered (gem + bounce ribbon),
  Ripple (two separate gems), Dark (gem, the Gemstorm ghost shakes in its slot, purple pull, second gem).

## Follow-ups / open

- No combat source casts a special Ruby today, so the riders exist on the Shop cast path only.
- Gem Sage in combat: combat-won Rubies mint at settle, where the Sage pays; the replay does not fly the Sage's extra Ruby.
- `rubyblast` has no art (never shown as a card); excused in allTypesPill's ART_PENDING.
