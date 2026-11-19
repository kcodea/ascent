# 2026-11-18: an Avenge (N) is per combat

**Owner report (Kevin, on the Gambler x Ancient of Death power text):** "bug - avenge (x): do not carry over combat to
combat. if it were 'when x minions die' that carries over, but avenge means it needs to happen in combat. we also need
to make sure that we show real time values for this kind of metric as well, so the locked number should drop in combat
from the avenge triggers etc."

## What was wrong

Every hero-level Avenge an Ancient of Death pairing adds kept ONE running count across the Shop and every fight (the
2026-10-09 convention: a `xDeaths` field on `AncientsState`, carried into `simulate` as the mod's `tick`, advanced at
settle by the fight's deaths). So 3 deaths in one fight and 1 in the next fired an Avenge (4). Minion Avenges, rune
Avenges and Cindara's Hoard were already per combat (they read the fight's own avenge-bus count).

## Audit (what carried before)

| Avenge | Counter lives | Carried between fights? | Counts Shop deaths? |
| --- | --- | --- | --- |
| Every minion Avenge (Kennelmaster, Tort, Imp King, ...) | the combat `Minion` instance (`avengeBaseline` against the fight count), new every fight | no | no |
| Rune Avenges (`runeAvenge`: Broodpit, Spearline, Soul Toll, Goleming, ...) and Cindara's Hoard | the fight's avenge-bus `count` | no | no |
| Frank x War (Avenge 3, Clearance stack) | the fight's avenge-bus `count` | no | no |
| Hunch x Death (4) `hunchDeaths` | run state | YES | yes |
| Xerox x Death (5) `xeroxDeaths` | run state | YES | yes |
| Tradesman / Pete x Death (3) `tradesDeaths` | run state | YES | yes |
| Gorr x Death (6) `gorrDeaths` | run state | YES | yes |
| Nadja x Death (6) `nadjaDeaths` | run state | YES | yes |
| Brackus x Death (3) `brackusDeaths` | run state | YES | yes |
| Rayse x Death (4) `rayseDeaths` | run state | YES | yes |
| Cassen x Death (7) `cassenDeaths` | run state | YES | yes |
| Gildmaster (17) / Robin (3) / Juggler (4) x Death `gildDeaths` | run state | YES | yes |
| Keshi x Death (4) `keshiDeaths` | run state | YES | yes |
| Merrin (3) / Emissary (4) / Emerald Warden (6) x Death `batchBDeaths` | run state | YES | yes |
| Rascal (4) / Gambler (4) / Flint (4) x Death | run state | YES | yes |
| Cindy x Death (15, Duos) `cindyDeaths` | run state | YES | yes |
| NOT Avenges, unchanged: Rune of Body Counting ("When 6 friendly minions die"), Braum x Death ("When 16 friendly minions die") | run state | yes, by design | yes |

## The fix (one mechanism, two halves)

- **Engine** (`simulate.ts`): every hero Avenge listener tests `avengeDue(every, count)`, the fight's own death count.
  The mods' `tick` is ignored, so a stored snapshot that still carries one, and the enemy side, follow the same rule.
- **Run** (`ancients.ts`): `AVENGE_COUNT_FIELDS` + `ancientAvengeReset`, called as the fight starts
  (`preparePlayerCombatSide`) and as it settles (`ancientAfterCombat`). The per-pairing "settle adds the fight's deaths"
  lines are gone.

## The Shop-phase reading (needs an owner ruling)

The 2026-11-16 ruling says the Ancient Avenges count Shop deaths; the keyword wiki said "Minions dying in the shop don't
count". Kept: a Shop death still ticks an Ancient hero Avenge and the Nth Shop death of that Shop phase fires right
then, but the count is discarded at the phase boundary. Nothing crosses from the Shop into a fight, from a fight into
the Shop, or from one fight to the next. The wiki answer now says exactly that.

## Live values

The countdown and the live lock already rode `combatQuestDelta.friendlyDeaths` into `ancientPowerText`; the hero-power
pill ("3t") and the "locked 3t" line read the settled `heroDiceLockUntil`. Both now read `ancientDiceLockTurns(run,
deaths)`, the same number the text prints, so they drop on the beat the Avenge fires and settle lands on it. No new
preview plumbing: the existing friendly-death fold is the carrier, so this does not touch what #2781 rewrites.

## Left for the owner

- Avenge (17) Gildmaster and Avenge (15) Cindy now need that many deaths in ONE fight (reachable only with summon-heavy
  boards). Lower the number, or reword them "When N friendly minions die" (the carry-over kind)?
- Whether Shop deaths should count toward an Avenge at all.
- A recorded seat's hero power text is not shown anywhere today, so there is no enemy-side text to update; the engine
  rule itself is symmetric.
