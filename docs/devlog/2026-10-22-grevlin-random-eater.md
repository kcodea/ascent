# 2026-10-22 - Grevlin & Co.: a random friendly Demon consumes (R-TARGET-GREVLIN-01)

Owner bug fix: "grevlin & co shouldnt be him consuming 100% of the time, it should be a random friendly demon.
(himself included)".

- `minionSoldConsumeRightmost` (`packages/sim/src/recruit.ts`) passed `self` as the eater, so Grevlin always ate.
  It now calls `grevlinEater`, which picks from every friendly Demon (`isTribe`, so All-types count) plus Grevlin,
  in board order, with one `rng.int` off `state.rngCursor` per bite. A pool of one spends no draw, so a lone
  Grevlin plays and replays identically to before.
- The pick goes through `consumeShopMinion`, so the gains, `onConsume` and `shopEaten.eaterUid` (the consume
  ghost/float in the Shop) all land on the chosen Demon.
- Gilded (two bites) re-picks per bite. Selling is shop-only, so there is no combat path.
- Card text unchanged: it already read "a **Demon** consumes", not naming Grevlin.
- Tests: `packages/sim/src/grevlinRandomEater.test.ts` (distribution over seeds, Grevlin in the pool, All-types,
  lone Grevlin with no draw, determinism, gilded per-bite picks). Oracle: R-TARGET-GREVLIN-01 (exemption from
  R-TARGET-03).
