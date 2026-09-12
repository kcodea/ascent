# 2026-09-12 — The Starform: a shop token that lives in the row

**What.** Set 3 Celestials get a new mechanic seam: the **Starform**, a 1/1 Celestial token
(`ce3_starform`, `token: true`, no rules text) that exists as a **shop offer** — created into the right-most
slot, pinned there through every refresh, grown by every shop buff and consume, and finally cashed in by a
Celestial (Consume = 100% to one body, Collapse = 50% rounded up to three). This PR is the ENGINE only; the
cards that create / grow / spend it (Star Seed, Corona Devotee, Nova Herald, Twin Star, Accretion, Stardust
Peddler…) are the content PR's. Rules 1–8 are in `docs/GAME-RULES.md` (owner design 2026-09-12, every line
a ruling); the module is `packages/sim/src/starform.ts`; the pins are `packages/sim/src/starform.test.ts`
(30 tests, through the real `reduce` wherever an action exists).

**How — the load-bearing decisions.**

- **The token is a `ShopCard` with `starform: true`**, not a board body. Its whole total is **baked onto the
  offer** (`atk`/`hp` + the `buffs` ledger): `offerBuyStats` has a Starform branch that reads
  `base + atk/hp` and **never** the live shop channels. Every writer of those channels (`applyRunShopBuff`,
  the arena's `gainShopBuff`, the combat carry-back, `addTurnShopBuff`) calls `starformFollowShopBuff`, so
  the this-turn layer that the rollover clears for everyone else stays on the Starform (rule 6). The UI's
  `shopView` mirrors that branch (no live-channel fold for a Starform, cost 0 on the changed-price coin,
  `starform` class on the card for Mike to style).
- **Row rebuilds are pinned.** `withStarformPinned(state, rebuild)` lifts the token, hands the rebuild one
  slot fewer, and re-inserts it at its previous index (clamped). `rollShop`, the tutorial roll, Spell Cart,
  the filtered refill, Muster, Membrance and Harlan's buyout all go through it; `elevateShop`, the Bargain
  Bin, Open Enrollment and Pete's contraband skip the token in place.
- **One consume body.** `consumeShopMinion` is now a thin binding of `consumeShopOffer(state, eater, idx,
  times, gain, skipUid)` — the eater is whatever body the watchers should see, `gain` is where the stats
  land. The Starform eats with a `BoardCard` stand-in (same uid as the offer) and `gain → buffStarform`, so
  Open Market, Bottomless Banquet, `shopMinionsEaten`, `shopEaten`, the pool return and `onConsume` are
  the SAME code a Demon runs — nothing duplicated. A Demon eating the Starform fires
  `starformRemoved('consume')` from the same body.
- **Refresh-time buffs land once (rule 4)** via `starformRefreshLand(offer, key)` — a per-source latch
  (`refreshLanded: ['tormentor' | 'embers' | 'displayCase' | 'veinstorm']`) on the offer. Gated, not
  redirected: a latched Starform in the right-most slot means Market Tormentor's refresh enchant lands on
  nobody that roll. Judgement call — flagged in the PR.
- **Two recruit-only triggers**, `starformGained` (payload `starformAttack` / `starformHealth` = the delta)
  and `starformRemoved` (payload `starformReason` + full stats), registered in the core union, the content
  schema, `TRIGGER_PHASES`, `CHANNEL_OF_TRIGGER` and the convention groups. `starformGained` has a
  **boundary diff in `reduce`** (the `onGainCard` hand-diff shape): `buffStarform` and the token's own
  consume fire as they land and book the delta on `state.starformGainFired`; the diff fires only the
  remainder, so a Fortify aimed at the offer, Apples, a Veinstorm stamp or a slot enchant each reach Twin
  Star exactly once.
- **The 0-Gold dismiss buy** is its own branch in `case 'buy'`: `offerBuyPrice` returns 0 with no discount
  consulted (so the coin and the charge agree — the derivations pair stays green), the token leaves with
  `starformRemoved('dismiss')`, the board's `onBuy` watchers hear a Celestial stand-in
  (`fireOnBuyWatchers`, deliberately not `applyOnBuy` — Banquet Hall / Second Life act on an arriving body
  and nothing arrives), and the buy tallies / Juggler / Gorr / Keshi / Ayse / Cadence / Fried Circuits tick
  as for a paid buy. Dupes, Transcription and Restocking are skipped (no body, nothing left the pool).

**Verification.** `npm run typecheck && npm run lint && npm test && npm run build:web` green (616 files /
8719 tests). Doc Bot: all 73 lanes green after `npm run docbot:sync` (the registry gained the token; the
final report's headline totals were updated); the tribe-predicate ratchet caught a raw `.tribe ===` in the
first draft of the dismiss branch and it now uses `defIsTribe`.

**Follow-ups.** The content PR: the cards, their factories (the triggers have no consumer yet — the tests
prove dispatch with synthetic watchers), a patch note (none here: nothing creates the token yet), token art
(`ART_PENDING`), and the create / consume cues for the Choreographer (the engine already emits
`shopChanged: buffed` / `consumed` for it through the existing shop diff, and `fodderEaten` with the
token's uid as the eater — Mike may want a dedicated eat-into-the-shop choreography).
