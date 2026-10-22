# 2026-10-22 - Set 3 Kobold runes: Refreshing Rubies, Ruby Sales, Goleming, Red Start, Rosey's Garden

Owner content ask 2026-10-22. All five are NEW: no name or id clash in any set, the archive, cards or tokens
("Rosey's Garden" vs the Rosey minion is fine, per the ask). Bare names (R-RUNE-NAME-01), Kobold-gated, `sets: ['set3']`.
No rune art wired (not asked).

| Rune | Pool, cost | Text | Built from |
| --- | --- | --- | --- |
| Refreshing Rubies (`rune_refreshing_rubies`) | Basic, 2 | When you **Refresh 4 times**, get a random **Ruby**. | `runeThreshold` + new `refresh` meter (ticked in the reducer's `roll` only) + `grantRandomRuby` |
| Ruby Sales (`rune_ruby_sales`) | Basic, 1 | When you **Sell 3 minions**, get a random **Ruby**. | `runeThreshold` + new `sell` meter (ticked in `settleMinionSale`) + `grantRandomRuby` |
| Goleming (`rune_goleming`) | Basic, 3 | **Avenge (5):** summon a **Gemheart Golem** and cast **6 Rubies** on it. | combat flag `runeGoleming` on `runeAvenge`; new `rubiesOnLanding` for a deferred Golem |
| Red Start (`rune_red_start`) | Epic, 3 | **Start of Combat:** cast a **permanent Ruby** on your **Kobolds**. | combat flag `runeRedStart` in `runRuneStartOfCombat`; existing `playRubyOn(..., permanent)` |
| Rosey's Garden (`rune_roseys_garden`) | Epic, 4 | When you cast a **Ruby**, give a random minion **+4/+5** permanently. | combat flag `runeRoseysGarden`; Shop beside `roseyHearsRubies`, combat in `runeRubyCastCombat` |

Oracle: R-KOBOLD-RUNES-1022-01..04 (`packages/rules/src/registry/approved/runes.ts`). Tests:
`packages/sim/src/set3KoboldRunes1022.test.ts`.

## Interpretations (flag to the owner)

- **"Random Ruby" = any of the six types.** The ask said a random SPECIAL type, but the approved oracle rule R-RAND-02
  (and every live "get a random Ruby": Minted Gems, Investment, Dealski) draws from all six, plain included. Followed the
  game; a one-line switch to `SPECIAL_RUBY_IDS` if the owner wants specials only.
- **Text casing.** Printed "random **Ruby**" and "**permanent Ruby**" in lower case, matching Minted Gems and Combatative
  Rubies, instead of the sheet's "Random Ruby" / "Permanent Ruby". "summon" lower case after the Avenge colon, like the
  other Avenge runes.
- **Permanent Ruby already existed** (Combatative Rubies, Korn, Gemheart): `playRubyOn(..., permanent)` records the Ruby
  as a permanent gain that settle carries back. Red Start reuses it; no new primitive.
- **Goleming is a plain summon.** A full board loses the Golem and its 6 Rubies (no "when you have space" queue). A Golem
  whose landing is deferred (an attacks-immediately Golem, Heart of the Mountain) gets its Rubies as it lands.
- **Red Start is combat only.** Combat Prowess does not replay it in the Shop (same as War Council). Twilight repeats it.
- **Rosey's Garden** picks a random friendly minion per Ruby (board in the Shop, living side in combat), seeded. It is
  heard at Rosey's two chokepoints, so bounces and Double Trouble's self-Rubies pay nothing and the +4/+5 (a plain buff)
  can never re-trigger a Ruby watcher: no loop.
- **Duplicates** stack by convention: each threshold copy is its own meter (two Rubies per trip), each flag copy fires
  again (another Golem, another Ruby per Kobold, another +4/+5).
- **Hand cap:** the meters never pay at the acquire moment, so a full hand gets nothing (R-HAND-RUNE-TURN-01).

## Pins moved

Rune counts (runes, set3RuneList, set3RuneRoster, set3RuneCuts), the combat-mod lane INERT pin 116 -> 118 (Red Start
needs a Kobold, the Garden a combat Ruby cast), the tally sweep (the Garden's +4/+5 is not a meter), Doc Bot contracts
1131 -> 1136.
