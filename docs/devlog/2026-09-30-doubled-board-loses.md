# 2026-09-30 — Why the doubled Indy board loses to itself (investigation, no code change)

Follow-up to the board-strength work (PR #1871, `feat/board-strength`): the wave-13 Indy board from the reference
set (`strengthReference.v1.json`, `waves['13'][15]`) with every minion's Attack and Health DOUBLED lost to its own
un-doubled copy. Verdict: **not an engine bug.** It is emergent card behaviour, driven by Sunmane Herald's
compounding Rally spread together with the board's Echo-proc summon engine. No content was changed; the owner
decides whether it wants a ruling (see the end).

## The board

Hero Indy, tier 6, set2, runes Backbeat + Undertow (4):

| Slot | Card | Stats |
|---|---|---|
| 0 | Sunmane Herald (`b2_sunmane`) | 3/3 |
| 1 | Echohorn (`b2_echohorn`), Gilded | 8/6 |
| 2 | Void Panther (`manasaber`) | 4/1 |
| 3 | Void Panther (`manasaber`) | 4/1 |
| 4 | T-Rex (`b2_trex`) | 2/3 |
| 5 | Hawkus (`b2_hawkus`) | 6/9 |
| 6 | Solaris (`b2_solaris`), Gilded | 12/12 |

## Reproduction

Real `simulate()`, both sides through `sideFromSnapshot` + `opponentBoard` (the board-strength path), seeds
1000..1299, each seed played twice (doubled as player, doubled as enemy). Doubled board's record:

| Variant | Doubled W / D / L (of 600) |
|---|---|
| Double all stats | **218 / 19 / 363** |
| Double Attack only | 271 / 6 / 323 |
| Double Health only | 247 / 13 / 340 |
| Mirror control (no doubling) | 298 / 4 / 298 |
| Double all, runes stripped | 195 / 9 / 396 |

Side split (all doubled): as player 100/12/188, as enemy 118/7/175. It loses from **both** seats, so this is not a
first-attacker or side-assignment artefact. A 3,000-seed mirror of the original board is 1523/46/1431 for the
player seat: no meaningful seat bias.

## Bisect

Doubling one minion at a time never flips the result on its own (every single-minion step stays within noise of
the mirror; doubling a Void Panther changes nothing at all, since a 4/1 and an 8/2 both die to the first hit and
the Panthers mostly swing at 0/2 Cubs). Leaving one minion un-doubled does not fix it either (212 to 260 wins).
The answer came from swapping one card for a vanilla body of the same stats, on BOTH copies:

| Card made vanilla (both copies) | Doubled W / D / L |
|---|---|
| none (as-is) | 218 / 19 / 363 |
| **Sunmane Herald** | **580 / 10 / 10** |
| Hawkus + Echohorn | 368 / 74 / 158 |
| Hawkus | 276 / 75 / 249 |
| Void Panthers | 289 / 22 / 289 |
| Solaris | 246 / 71 / 283 |
| T-Rex | 237 / 23 / 340 |
| Echohorn | 216 / 15 / 369 |
| (drop both Panthers: 5 minions, free slots) | 362 / 60 / 178 |

Without Sunmane the doubled board wins 580 of 600, as it should. Without the Echo-proc summoners it also wins.
The inversion needs both.

## What happens in a losing fight (seed 1003, runes stripped, doubled as player)

- Sunmane's Rally gives every other Beast its accumulated Attack and grafts the Rally onto it
  (`rallySpreadTribeBuff`, owner spec 2026-07-25: the growth is emergent and compounds). Within a handful of
  swings Attack is in the tens (a 0/2 Void Cub hits for 48 by step 61, Solaris for 72 by step 68) while Health
  never grows. From then on **every minion dies to any hit**, so the starting Health and Attack stop mattering.
- Every Beast now has Rally, so every swing triggers Hawkus ("when a Rally is triggered, trigger your left-most
  Echo") and Echohorn procs: Void Panther summons two Cubs, T-Rex a Baby. Those summons need board space.
- Step 1: the doubled Sunmane (6/6) trades with the enemy's Gilded Echohorn (8/6) and KILLS it. The same swing's
  Hawkus proc on the doubled side fizzles: its board is still full (7 minions). The enemy, now at 6, gets its
  proc summon on its very next swing (step 7), and two more at step 15.
- The pattern repeats: the stronger side kills more early, which opens the WEAKER side's slots for its Echo-proc
  summons, while its own full board swallows its own procs. Over the 600 fights the doubled side fired 7,383
  Echo procs for 4,172 summons (57%); the original fired 7,701 for 5,256 (68%). More bodies means more Rally
  carriers, more compounding Attack, and the tempo race tips to the weaker copy.

## Verdict

(b) intended card behaviour, not a bug. Every piece works as written: full boards drop summons, Hawkus/Echohorn
proc the left-most Echo, Sunmane's spread compounds (owner spec). The combination makes base stats nearly
irrelevant after the opening trades and rewards the side whose minions die first. Nothing in the engine reads
stats in a way that backfires.

Consequences worth knowing:

- Board strength (R-LOBBY-09) is a win rate, so it scores this correctly as a matter of fact: for boards built on
  Sunmane + Echo procs, "more stats" is not "stronger". The #1871 monotonicity test already uses flat +N/+N and
  notes this board; nothing to change there.
- **Owner question (no action taken):** is it acceptable that a Sunmane + Hawkus/Echohorn board plays better when
  its minions are WEAKER, i.e. that doubling every stat loses about 60/40 to the original? If not, the lever is
  Sunmane's compounding (for example a cap on the per-carrier grant, or not compounding through summoned bodies),
  which is a content/balance ruling, not a bug fix.

The scratch bisect scripts are not committed; they are a ~40-line loop over the variants above and can be rebuilt
from this note.
