# 2026-10-21 — Set 3 Dwarf rework: Hank Pepe, Shift Broker, four Dwarves out, Brill in

Owner content changes for Set 3, plus a same-PR add ("add dwarf king brill to set 3's dwarf pool, archive the rune
from set 3").

| Card | Before | After |
| --- | --- | --- |
| Hank Pepe (`dw3_hankpepe`) | T3 2/7. When you play a Dwarf, give 3 other Dwarves +1/+1 (Gilded +2/+2) | T3 2/7. When you **Sell** a minion, give 3 other Dwarves +1/+1 (Gilded +2/+2) |
| Shift Broker (`dw3_shiftbroker`) | T1 1/4. When you sell a minion, gain +1 Attack (Gilded +2) | T1 1/4. When you **Sell** a minion, gain +2 Attack (Gilded +4) |
| Coinfire (`dw_coinfire`) | T3 3/5, Set 2 + Set 3 | Set 2 only |
| Striker (`dw3_striker`) | T2 3/3, Set 3 + Set 2 | Set 2 only |
| Billings (`dw_billings`) | T5 5/6, Set 2 + Set 3 | Set 2 only |
| Lieutenant Thane (`dw_thane`) | T6 9/5, Set 2 + Set 3 | Set 2 only |
| Dwarf King, Brill (`dw_brill`) | T6 5/8 token, granted by Rune of the High King | T6 5/8, buyable in Set 3; still forge-only in Set 2 |
| Rune of the High King (`rune_high_king`) | Epic, Set 2 + Set 3 | Set 2 only |

## How

- **Hank Pepe** moved to a new recruit factory, `minionSoldBuffRandomTribeOthers` (registered in the
  `EffectFactoryId` union, the schema whitelist and the presentation policies), with the same body the old one had: seeded draw-without-replacement over board Dwarves through the shared
  `isTribe` predicate (All-types and Unity count), never the source. Gilded doubles the stat, never the count, the
  convention Billings and the old Hank used. `minionSold` only fires in the Shop (a sale cannot happen in combat),
  so there is no combat half. The old `onTribeSummonedBuffRandomOthers` had no other card, so it was removed with
  its registrations (the presentation registry and Doc Bot's declaration lanes reject a factory nothing uses).
- **Shift Broker** is a param change (`attack: 1 -> 2`).
- **"Archive"** here means leaving Set 3, the 2026-10-13 Set 3 batch pattern, not moving to `cards/archive.ts`. All
  four are live Set 2 cards and Set 2 is the live set, so archiving them everywhere would have changed the live game
  and its seeds. Coinfire, Billings and Thane drop out of `SET2_DWARVES_IN_SET3`; Striker's definition stays in
  `SET3_DWARVES` (Set 2 still draws it through `SET3_DWARVES_IN_SET2`) and Set 3 reads `SET3_DWARVES_IN_SET3`, which
  filters it out. Every id still resolves through `CARD_INDEX`, so old Set 3 saves, snapshots and replays load.
- **Brill**: `token: true` is gone, so it is drawable. To keep Set 2's Shop from offering it, Set 2's manifest uses
  `SET2_DWARF_RUNE_MINIONS_IN_SET2` (the list less Brill). Set 2's buyable and spell pools are unchanged, so Set 2
  shop seeds are unchanged; only its `all` list loses one token entry. Set 2's Rune of the High King still grants
  Brill by id. Brill's own effect (`goldSpentGrantTribeMinion`) reads the run-pinned pool, so in Set 3 it grants a
  Set 3 Dwarf. It needed no other change.
- **Rune of the High King** `sets: ['set2', 'set3'] -> ['set2']`. Old Set 3 runs that own it resolve it through
  `RUNE_INDEX`.

## Side effects worth knowing

- Set 3's pool order moved (four cards out, Brill in), so Set 3 seeds change. Set 3 is not the live set.
- Brill's art is now owned by Set 3 in `preloadPlan.splitCardArt`. On a phone in a Set 2 session it is no longer
  prefetched; it still loads on demand when the Set 2 rune grants it.
- References left as is (they are Set 2 or set-agnostic and the cards still resolve): Practice bots' utility roster
  (`dw_thane`), the Set 2 guides (`dw_billings`, `dw_coinfire`, `dw_thane`), the Set 2 balance-bot operators and
  combos, the Gauntlet Dwarves stage portrait (`dw_brill`), and today's Set 3 Dwarf batch test, which plays a
  Striker from hand.

Tests: `packages/sim/src/set3DwarfRework1021.test.ts`. Rule: R-DWARF-1021-04.
