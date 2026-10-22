# 2026-10-22 - Set 3 Kobolds: Boy Scout, Gramps, Zapdash, Frack Attack, Rosey

Owner content ask 2026-10-22. All five are NEW (no name or id clash in any set, the archive, runes or tokens). Appended
to `SET3_KOBOLDS` in sheet order, so they join Set 3's pool only. No art wired (not asked).

| Card | Tier, body | Text | Built from |
| --- | --- | --- | --- |
| Boy Scout (`k3_boyscout`) | T2 3/3 | **Shout:** Gain 2 free Refreshes | new `battlecryGrantFreeRolls` (shop: `freeRolls`; combat Shout replay: `grantFreeRolls`, the Gryphon carry-back) |
| Gramps (`k3_gramps`) | T3 4/2 | **Sell:** Cast a Ruby on all of your minions | `battlecryPlayRubiesAll` on `onSell` |
| Zapdash (`k3_zapdash`) | T3 4/4 | **Pummel (10):** Cast a Ruby on your Kobolds. (Twice per combat) | new Pummel marker `dealtDamageCastRubiesTribe` (`maxPerCombat: 2`) |
| Frack Attack (`k3_frackattack`) | T4 6/5 | **Start of Combat:** Cast 3 Rubies on this. Repeat after 3 friendly attacks | `scPlayRubiesSelfAndAdjacentTribe` with new `adjacent: false` + new `friendlyAttacksPlayRubiesSelf` |
| Rosey (`k3_rosey`) | T6 2/2 | When you cast a Ruby, this gains +2/+1 permanently. Improves every 3 Refreshes | new marker `rubyCastGainSelfImproving` + new `shopRefreshTallySelf`; shared grant `rubyCastGainOf` (core) |

## Rulings and interpretations

- **Play vs cast.** The engine has one Ruby-landing action; the 2026-08-30 owner ruling made "play" and "cast" the same
  verb, printed as "cast". Gramps' sheet text says "Play"; it prints "Cast", like Blast Pump's identical line.
- **"A Ruby" is the plain Ruby** (owner confirmed 2026-10-22, R-KOBOLD-1022-03). A Ruby Discover is the different
  case (special types only); none of these cards Discovers.
- **Gramps** is removed from the board before its Sell fires, so it never Rubies itself. Gilded casts 2 on each, each
  its own landing (every on-Ruby watcher hears each one).
- **Zapdash** casts on every living friendly Kobold, itself, dual tribes and All-types included. The twice-per-combat cap
  rides `pummelFires`, which a Rise / Rebirth return already resets (R-RETURN-RESET-01). Gilded: 2 Rubies per Kobold
  per payout (owner). Combat Rubies, so combat-only.
- **Frack Attack**: "Repeat after 3 friendly attacks" is read as REPEATING (every 3rd friendly attack, not once). The
  meter (`attackSeen`) counts every friendly attack, itself included, each Flurry swing separately (owner confirmed
  2026-10-22, R-KOBOLD-1022-05), only while Frack lives. `resetPerCombatLimits` clears it for Frack only (Crypt Drake
  shares the field as a cadence and keeps running). Combat-only Rubies; Gilded 6. Attacks only happen in combat, so
  the repeat has no Shop half; a Combat Prowess Start-of-Combat replay in the Shop lands the 3 Rubies as usual.
- **Rosey** counts per RUBY (the Trouble ruling), from any source, on any minion, Rosey and Shop minions included, in
  both phases. The two chokepoints are `fireOnRubyPlayed` (which now takes a Ruby count, passed by the multi-Ruby
  shop bodies) plus the hand-Ruby-on-an-offer branch, and `playRubyOn` in combat. Not counted: bounce hops (Candle
  Conduit, Resonance, Rupture, the Conduit), Trouble's self-Rubies (stats only), and a Gemheart Golem born with Ruby
  stats. Combat gains carry back (`buffPermanent`, owner confirmed 2026-10-22, R-KOBOLD-1022-04). "Refreshes" are the
  ones the player presses (Indy's 2026-10-13 meter, `playerRoll`), stored on `eotTick` (already carried into combat and
  snapshots). Improves adds the base again each step (+2/+1, +4/+2, ...).
- **Boy Scout** Gilded: 4.

Live text: Rosey prints its current grant in place (`rubyCastGainText`, both chains via `liveCardText`). Every
countdown is the integer counter under the card: Rosey's Refreshes (`stepProgress` refresh branch), Zapdash's Pummel
badge (from the marker registry), Frack Attack's N/3 (new `stepProgress` branch).

## Oracle

R-KOBOLD-1022-02 (the batch), -03 (plain Ruby), -04 (Rosey carries back), -05 (Frack counts every swing) in
`registry/approved/triggers.ts`. Pinned by `packages/sim/src/set3Kobolds1022.test.ts` and
`packages/ui/src/set3Kobolds1022Text.test.ts`. `npm run docbot:sync` regenerated the contracts and wording queues; the
final report's contract count moved 1126 -> 1131.
