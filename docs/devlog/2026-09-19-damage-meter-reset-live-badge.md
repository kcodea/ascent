# 2026-09-19 — Damage meters: once-per-combat reset + the live combat badge (Goldvein, Han Gover)

Owner report with a screenshot of Goldvein in the shop reading **6/6** after the combat it fired in: *"it should
show 0/6 since the trigger should reset if it hits 6/6, after combat"* — and *"show these minions' counter update
in real time after damage is dealt, even when it's the last minion in combat."*

## The reset rule lives in the meter definition (core)

`DAMAGE_METER_DOS` (a bare id list) became `DAMAGE_METER_MARKERS` in `packages/core/src/types.ts`, one entry per
marker with a `resetEachCombat` flag — the card's rider made data:

| marker | card | rider | `resetEachCombat` |
| --- | --- | --- | --- |
| `dealtDamageAleMeter` | Han Gover | "(Max 2 per hit)" — a cap, not once-per-combat | **false** — lifetime tally, persists across combats as before |
| `dealtDamageGoldNextTurn` | Goldvein | "(Once per combat)" | **true** — starts EVERY fight at 0 (progress + latch), carries back 0 |

Two pure helpers sit beside it and are the only readers of the flag:

- `damageMeterOf(def)` → `{ do, every, resetEachCombat } | null`. Used by the sim's seed (`instantiate`: a
  reset meter ignores the board card's `damageDealt`), the damage site (`noteDamageDealt`), the carry-back
  (`playerDamageMeters` reports `total: 0` for a reset meter; the reducer's settle turns 0 into a CLEARED run
  card), the replay fold, `Unit.tsx` and `instView`.
- `damageMeterReading(total, meter)` → what the badge prints, ONE formula for shop and combat:
  - persistent meter: progress toward the NEXT crossing, `total mod every` — Han Gover at 47 reads **7/40**, a
    crossing lands on **0/40** (never a cumulative 47/40);
  - once-per-combat meter: counts up and **clamps at 6/6** for the rest of the fight (it fired; it cannot fire
    again, so lapping back to 1/6 would promise a second payout), then the reset takes it to **0/6** in the shop.

Goldvein's chosen semantics, pinned in `goldvein.test.ts`: 4 dealt → shop **0/6** (no partial banks toward the
next fight), next fight starts at 0; a seeded tally (a pre-reset snapshot) is ignored; a fresh combat re-arms
the latch. `Card`'s step-proc burst still fires on the crossing — its wrap rule (`cur < prev && prev !== total`)
catches 39 → 7 and 30 → 0 alike.

The shop's "hide a fresh 0/N" rule gets a second exception next to the Living Grimoire: a damage meter shows
**0/N** — the owner's sentence asks for 0/6 literally, and "0/40" after a payout is the "paid, counting again"
reading.

## The live badge in combat

The replay fold (`computeFrame`) summed `dmg` events by `source` **only for `dw3_hangover`** — an id gate — so
Goldvein's badge never moved in combat. It now keys off `damageMeterOf(CARD_INDEX[cardId])`. The fold runs to
the end of the beat being cued, and the result beat that carries the `dmg` opens at the lunge's contact, so the
badge ticks on the same moment the damage number pops. The `done` frame folds the whole log, so the blow that
ends the fight is on the badge too.

To keep that final reading visible: `Unit` takes `holdStep` (= `replay.done`), and a damage meter's counter drops
its `.ephemeral` fade once the replay is done, staying up through the tally / hero strike / curtain until the shop
takes over. Other step counters keep their ~3s fade.

## Verified

- `packages/ui/src/damageMeterBadge.test.ts` (new): per-beat badge readings from `computeFrame` over a real
  `simulate()` log — Goldvein 0/6 → 2/6 → 4/6 → 6/6 with the third hit ending the fight; clamp at 6/6; Han Gover
  30 → 0 → 10 → 20 (mod 40); a popped Ward ticks nothing. Fails on the old id gate.
- `goldvein.test.ts` rewritten for the reset semantics; `set3Dwarves.test.ts` gains the 47 → 7/40 → fires case;
  `stepProgress.test.ts` pins both readings.
- Live on a Scene Builder stage (Vite on a scratch port): Goldvein vs three 0/1 dummies ticked 2/6, 4/6, 6/6
  alongside each damage float, held 6/6 through the end-of-combat sequence, read 0/6 in the shop with +3 Gold
  banked; Han Gover seeded 30 read 30/40 → 0/40 (Ale to hand) → 10/40 → 20/40, held, run card 60.
