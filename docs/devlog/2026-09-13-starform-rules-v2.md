# 2026-09-13 — Starform rules v2: a price, a buy that consumes, the Star Destroyer, Collapse = 2 + extras

**What.** The owner's second pass on the Starform (every line a ruling; each is a test). Four rule changes to
the token itself and two card changes in the roster, plus the Celestials art batch:

- **A — a price.** The token spawns at **6 Gold**; **every refresh** (paid, banked, Window-Shopping-free —
  any `roll`) knocks 1 off, floor 0; the reduction **survives the turn boundary**; a new token (Zenith's
  rebirth included) starts at 6 again. Every regular discount applies exactly as to a minion — the
  `offerBuyPrice` special case is gone, and the `derivations` coin↔charge pair now fuzzes Starform offers.
- **B — buying it = your LEFT-MOST Celestial consumes it.** The Gold is spent; the token leaves through the
  consume path (`starformRemoved('consume')` — Zenith re-creates, Twin Star hears the receiver's gain); the
  left-most board Celestial gains its full stats under a `Starform` ledger line. **No Celestial → the Gold
  is still taken and the token is lost** (consumed into nothing; Zenith still re-creates). It still counts
  as a minion bought. The 0-Gold "dismiss" buy, `dismissStarform` and the `'dismiss'` reason are deleted.
- **C — Star Destroyer.** A standard Equipment (`star_destroyer`, 0 Gold, untargeted, no use cue) whose
  source is the **Starform offer**: held exactly while a token exists, its own once-per-turn charge, the
  shared pool, the rail and selector like any other. Activation is **the silent exit** — the offer leaves
  and nothing else fires (no watcher, no gain, no pull, not a buy, no Zenith).
- **D — Collapse = 2 unique random friendly Celestials** (was 3) **+ extras drawn with replacement**: the
  run-wide `collapseExtraTargets` counter (0, reserved for future cards) plus Nova Herald's passive.
- **E — Corona Devotee now Collapses** (`battlecryCollapseStarform`, the Herald's old factory; gilded = each
  hit gains the full stats). **Nova Herald is a passive**: "When you Collapse a Starform, it buffs 2
  additional random Celestials" (4 gilded; two Heralds → 4), static text by owner call.
- **G — art.** Nine Starform-roster masters + the Starform token + Accretion and Grave Robbery spell arts
  wired; Neptus / Cometius through pre-rename aliases (`cometconductor`, `orreyartificer`).

**How — the load-bearing decisions.**

- **The price rides `ShopCard.cost`**, the same field Moe's set price uses. That makes `offerBuyPrice` need
  no Starform branch at all (`offer.cost ?? …` already wins the precedence), the UI coin reads the charged
  price through the existing `opts.minionCost` path, and Layaway / Bargain Bin / Restocking never write it
  for a token. `starformRefreshTick` runs in the `roll` case after `refreshTavern`; the Start-of-Turn
  opening roll is NOT a `roll` action, which is exactly why the reduction survives the turn. A legacy save
  whose token predates the field heals to 6 in `deserialize`.
- **`GrantedEquipment.sourceKind: 'starform'`** with the offer uid in `sourceUids`; `equipmentSourceAlive`
  reads the shop for that kind. `syncStarDestroyer(run)` is idempotent and is called from every create /
  remove path (`createStarform`, `removeStarform`, the Demon consume in `consumeShopOffer`,
  `destroyStarform`), from `rebuildEquipment`, and as a tripwire at the action boundary in `reduce`. A
  revoke that was showing in the slot hands the selection to the left-most surviving entry.
- **`collapseHits(state, originals, extras)`** draws the unique originals first, then the extras with
  replacement, in one rng advance; `starformFx.toUids` lists every hit (duplicates allowed — the UI plays
  one `starform-pull` per hit). `collapseExtraTargetsOf` sums the counter and every Herald's `passive`
  `collapseExtraTargets` marker (the Constellation Prime id-read shape) — never dispatched; the recruit map
  carries a stub so the factory × phase lane sees it, and combat is excused `no-surface`.
- **`buyStarform`** picks `state.board.find(isTribe celestial)` and routes through `consumeStarform` (so the
  `consumed` pull record fires) or, with no receiver, straight through `removeStarform('consume')` with no
  record. The reducer's Starform buy branch now spends the discounts exactly as the minion path does
  (Cadence / Trade-In armed marks, the free first buy).
- **Assumptions stated:** hero-power refreshes that bypass the `roll` action do not tick the price (only
  `roll` does — "any `roll`" read literally); the grant of the Star Destroyer plays no equip cue (the
  activation has none either); the seven set-3 spell webps the wire pass re-encoded at net-0 content were
  reverted to keep the PR to the Celestials batch.

**Verification.** `starform.test.ts` (42), `set3CelestialRoster.test.ts` (48), `starformFx.test.ts` (7),
`equipment.test.ts` (63, +4 Star Destroyer), `derivations.test.ts` (the pair buys Starforms), the Doc Bot
lanes green after `docbot:sync`; typecheck + lint + test + build:web green.
