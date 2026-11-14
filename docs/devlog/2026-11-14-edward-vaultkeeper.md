# 2026-11-14 — Edward Keg-hands doubles Ale numbers; Vaultkeeper reverted

Owner balance pass, two cards.

## Edward Keg-hands (`dw_edward`, R-EDWARD-01)

Was a cast multiplier inside `spellCasts` (a hand Ale cast x2 / x3). Extra casts tripped every "spell cast"
payoff two or three times (Drunk Shopkeeper, Sequencing, Spell Appetite, Champion Inu, the spell counters), so the
owner reworked him: **"Your Dwarven Ales cast from hand have double effect"** (Gilded: triple).

- One cast. The numbers multiply, never the targets: Golden Ale 4 Gold (6), Champion's +12/+12, Defensive / Bloody
  3 random minions +8, Reinforcing 2 minions (3). Spell power is part of the number and multiplies with it.
- Highest Edward only (any = x2, any Gilded = x3).
- From hand only. `aleCastMagnitude` = `aleHandMagnitude` while `isHandCast(spellId)`, else 1.
- ONE boundary: `applyCastEffects` passes it to the Ale factories as the private `_mag` param, and `castSpell`'s Gold
  half multiplies the Gold. Cast multipliers (Ancient Runes, Bottomless Cask, Shared Pour, Last Call, ...) still add
  casts and each is multiplied.
- Live text: the hand row passes `aleMag` into `spellDisplayText` (`aleMagnitudeText`). Shop / Discover print base.
- Removed: the Edward branch in `spellCastsWithout` and the Recruit.tsx Edward echo volley (it re-fired the cast fan-out
  per extra cast). His On Watcher pulse (R-FX-KEGHANDS-WATCH-01) is kept.

## Vaultkeeper (`d2_herzog`, R-VAULT-02)

Reverted exactly to the 2026-08-15..2026-10-10 card: Dragon, T6 6/10, `onSummon` /
`onTribePlayedBuffSelfPerSpell { tribe: 'dragon', base: 2, per: 4 }`, "Gain +2/+2 whenever you play a Dragon. Improves
+2/+2 for every 4 spells cast this game." Restored: its presentation policy, its Doc Bot phase-registry ruling
(owner 2026-08-26: no gain from combat summons) and `herzogText` (current grant + "N spells to next step") in the
shared `liveCardText` chain, which Unit.tsx already feeds `spellsCast + rubyCasts`.

Rune of the Vaultkeeper needs no change: the old factory already gives each grant to an adjacent Dragon, and the
rune's text ("also give their stats to an adjacent Dragon") reads the same.

Dormant now (no card uses them; cleanup candidate): `tribePlayedGainSelfImproving`, `RunState.tribeUnionPlays` and
`runTally.ts`, `vaultkeeperText`, plus the older dormant 10-10 pulse (R-VAULT-01). `vaultkeeperRunTally1020.test.ts`
was deleted with the card it described.
