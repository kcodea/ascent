# 2026-11-13: Traveling Salesman counts a lone Golden as one copy

**Report (owner):** Salesman sold beside a lone Golden Soul Defiler and a lone Golden Chipper offered only
Lastlight and Legion Commander.

**Cause:** `onSellDiscoverSingleton` weighed a Golden body as three copies ("it already IS a triple"), so a
lone Golden was never "exactly one".

**Fix:** every minion on the board counts once, Golden or not. A Golden beside a plain copy is two and stays
out. Rule `R-SALESMAN-01`; pinned in `packages/sim/src/runeMinionsAug20.test.ts`.

The Discover hands over a plain copy, as it does for any other pick.
