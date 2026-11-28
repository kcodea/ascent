# The Pack Economy: design

Date: 2026-11-27 · Owner: Mike · Status: draft for owner review

**Builds on:** the pack opening (`2026-11-23-pack-opening-design.md`) and the pack shop
(`2026-11-25-pack-shop-design.md`), both on PR kcodea/ascent#2865. Those two are presentation only and run on dev
sample data. This doc is the server side they were waiting for: where the packs come from, what they cost, what is
inside them, and how today's Chest Shop goes away.

**Replaces:** the Chest Shop economy (`2026-10-18-aether-crate-shop-design.md`, `crateShop.ts`, `buy_crate`, the
category focus, the milestone and Welcome chests).

## 1. Intent

Cosmetic rewards move from single-item chests to 5-card packs. A chest gave one item and could never give a duplicate,
so a near-complete collector ran out of things to buy. A pack gives five, may give duplicates, and turns each duplicate
into Aether, so there is always something to open and the collection keeps paying back.

The server has to own all of it: every price, every roll, every grant, the duplicate payouts and the hand limit. The
client only names what it wants and plays what the server answers, as with chests today (R-PROG-AETHER-02: the price
shown is the price charged, a repeated request is charged once).

## 2. Goals, non-goals, anti-goals

**Goals**
- One authoritative, versioned server roll for every pack, mirrored in TypeScript and proven equal draw for draw.
- Buying, holding and opening packs on the server, each in one transaction under the per-user progression lock,
  idempotent per request.
- The counter limit (5 pack types, 8 of each) enforced on the server, not only drawn by the shop.
- Level and Welcome grants become packs. Match Aether payouts stay exactly as they are.
- A one-time launch gift of 3,000 Aether for every account, paid once per account however often the launch is run.
- The Chest Shop and the category focus are retired. Chests a player already holds are left alone.
- An old client during the Ship Ascent rollout never loses a pack, never double-charges and never shows a wrong price.
- Every player-facing "chest" becomes "pack" where it now means a pack, and the oracle knows the new rules.

**Non-goals (this project)**
- The look of anything: shelf, counter, opening, faces. PR kcodea/ascent#2865 owns presentation; this project only
  wires it to the server.
- The lump sum of Aether for unopened chests (owner 2026-11-27: Mike handles it later). It is separate from the 3,000
  Aether launch gift (section 12.1), which is in scope.
- Launch, Season and Secret packs, booster boxes and anything else in section 13.
- Real-money purchases. Aether stays earned-only (R-PROG-AETHER-01).

**Anti-goals (a failure even if it works)**
- A charge without a pack, a pack without a charge, or one request charged twice.
- A category or style pack's fifth card that the player already owned while the pool still had something new.
- A price, payout or odds number that lives only in client code, so a retune needs a release.
- An old client that can still spend Aether on a chest after the switch is flipped.
- Renaming the Ancient rarity. "Ancient" is the rarity and "Ascendant" is the rank (memory: never relabel).

## 3. The owner's rulings this design is built on (all 2026-11-27)

| Topic | Ruling |
|---|---|
| Packs vs chests | Packs REPLACE the Chest Shop. |
| Size | Every pack has 5 cards. |
| Rarity packs | Cards 1-4 roll like any card at the Standard odds (Common 35, Rare 31, Epic 22, Legendary 9, Ancient 3). Only card 5 is guaranteed, at the pack's rarity or higher ("they are just guaranteeing that the final pull is of that tier or higher"). |
| Category and style packs | Cards 1-4 at the Standard odds from the whole catalog. Card 5 comes from the pack's category or style and is never a duplicate. When that pool is fully owned the pack greys out but stays buyable. |
| Within a rarity | "When that rarity is determined or drawn, then from there, any category has equal odds of showing up." |
| Prices | Common 100, Rare 175, Epic 300, Legendary 500, Ancient 850. Every category and style pack is a flat 200. |
| Duplicates | A duplicate pays 20% of its OWN rarity's Rarity-pack price: Common 20, Rare 35, Epic 60, Legendary 100, Ancient 170. |
| Shop refresh | Every 6 hours: 12am, 6am, 12pm and 6pm Eastern (daylight saving included). |
| Free pack | A free Rare pack in the Featured window. The shop spec records "Every 6 hours" when asked whether it stays daily (section 13, item 3). |
| Featured deals | "in featured should also have 4 other discounted, randomly discounted between 20 and 60% off card packs of any other type, whether it is rarity or category" (2026-11-27), each with "2 to 5" in stock, turning over every window. Asked whether they launch with the shop and whether stock is per player: "Yes, per player" (2026-11-27). |
| Purchase reward | Every 15 packs purchased earns a free Epic pack. |
| Counter | 5 pack types on the counter, up to 8 of each. "The player cannot purchase any more packs until a slot opens up." Packs given while it is full wait beside it. |
| Match payouts | Unchanged. |
| Level packs | A free Legendary pack every 5 levels (5, 10, 15, ...), replacing the Epic milestone chest every 10 levels. Not backdated: asked whether accounts get packs for levels already passed at launch, Mike chose "Only after launch" (2026-11-27). |
| New accounts | "give new accounts 5 common packs, 2 rare packs, 1 epic and 1 legendary pack". Nine packs in place of the Welcome Chest. (This replaces the earlier ruling of one free Legendary pack.) |
| Launch gift | "give all accounts 3k Aether when we release the new shop announcement". A one-time 3,000 Aether for every account, delivered with the new-shop announcement. Accounts made after launch do NOT get it: Mike first answered "yes, new accounts get the 3k too", then, asked to confirm, chose "Launch-day accounts only" (2026-11-27). New players get the nine Welcome packs instead. |
| Focus | Removed. |
| Old chests | Not converted into packs. The lump sum is out of scope. Until then they are FROZEN: asked whether players can still open the chests they hold, Mike chose "Freeze them" (2026-11-27). |

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | **Stretch `loot_crates`** into packs: a `kind` column, five reward columns, the chest roll widened. | Fewest new tables. But every chest constraint, trigger and parser (one reward, never a duplicate, `pool_exhausted`, the milestone floor check) would have to learn two shapes, and the chests still in players' hands share a table with the thing replacing them. One mistake breaks both. |
| B | **New pack tables beside the chests** (chosen). `packs`, `pack_shop_windows`, `pack_meters`, a `pack_config` row; new functions `buy_pack`, `open_pack`, `claim_pack_reward`; `loot_crates` is left as it is and `open_crate` only gains the freeze (section 11). | More new SQL, but nothing about a chest changes, the new rules are written once in their own shape, and the chest side can be deleted later in one piece when the lump-sum project is done. |
| C | **Roll at purchase**, store the five cards sealed, reveal at open. | Simpler opening, and the result is fixed the moment Aether is spent. But a category pack's "never a duplicate" fifth card would be judged against what the player owned at purchase; two packs of one category bought together could promise the same item. Rejected: the roll happens at open (B). |

**B, rolling at open, is my call** for the owner to overrule. It is the same split today's chests use (bought and
created in one step, rolled when opened), and it keeps "never a duplicate" true at the moment the card is seen.

## 5. The pack lineup

| Kind | Look id | Count | Price | Card 5 |
|---|---|---|---|---|
| Rarity | `rarity-common` ... `rarity-ancient` | 5 | 100 / 175 / 300 / 500 / 850 | At the pack's rarity or higher. |
| Category | `category-<category>`, one per enabled cosmetic category | up to 10 | 200 | From that category, never owned. |
| Style | `themed-<style>` (Scribble, Plushie, 8 Bit, Voxel, Low Poly, Sketchbook, Encore, Crayon, Sports, Stained Glass, Sci-Fi) | 11 | 200 | From that style, never owned. |

A **style pack's pool** needs data the catalog does not have yet. `CosmeticDef` gains an optional `packStyles: string[]`
(the style look ids the item belongs to), synced to the server through `catalogSyncPayload` into a new
`cosmetic_catalog.pack_styles text[]` column. A style pack whose pool is empty is not offered. Which items belong to
which style is the owner's content, filled in over time; until a style has members its pack stays off the shelf.
A category pack for a disabled or `admin_off` category is not offered either.

"Themed pack" in the shop's tabs means category and style packs together (the "Themed Packs" shelf); in this doc
"themed" means both, and the pricing and roll rules for the two are identical.

## 6. The roll (one authoritative roll, versioned)

### 6.1 The pools
- **The whole catalog** (cards 1-4 of every pack, card 5 of a rarity pack): every active, crate-sourced item in an
  enabled category, not `admin_off` (the chest pool's filter, `eligibleCrateCosmetics`, **without** the "not owned"
  clause). Owned items stay in: duplicates are allowed.
- **The pack's own pool** (card 5 of a category or style pack): the same filter narrowed to the category or style, and
  **with** the "not owned" clause, judged after cards 1-4 of the same pack are granted.
- Secret items are never in any pool (R-PROG-SECRET-01: achievement only). Announcers are in every pool; the focus rule
  that kept them out of focused chests (R-PROG-AETHER-06) goes with the focus.

### 6.2 One card
Three draws in [0, 1) per card, from the server's `random()`:
1. **Rarity.** Cards 1-4: the Standard odds, 35/31/22/9/3. Card 5 of a rarity pack: the same odds restricted to the
   pack's rarity and above, renormalized (an Ancient pack's card 5 is always Ancient; a Common pack is five Standard
   cards). Card 5 of a category or style pack: the Standard odds.
2. **Category.** Equal odds among the categories that have at least one item of that rarity in the pool (owner: "any
   category has equal odds"). For a category pack's card 5 this step is a single choice.
3. **Item.** Equal odds among that rarity-and-category's items, in id order (the chest roll's uniform pick).

If the drawn rarity has nothing in the pool, it falls to the nearest rarity that has something, ties toward the more
common one (`crateRarityFallback`), never below the pack's floor on a rarity pack's card 5. *(My call: today's chest
fall-back, kept.)*

**A category or style pack whose own pool is empty** (the player owns it all): card 5 is drawn from the pack's
category or style as a duplicate, at the Standard odds, and pays its duplicate Aether. This is the greyed-but-buyable
case.

### 6.3 Order and duplicates inside one pack
- The five cards are granted in order. A card is a duplicate if the player owned it before the pack or an earlier card
  of the same pack gave it. *(My call.)*
- The guaranteed card is always card 5, the last flip (the opening contract, `parsePackOpenResult`).
- A duplicate pays `duplicateAether[its own rarity]` (20 / 35 / 60 / 100 / 170). All the pack's duplicates are one
  ledger entry, `reason 'pack_duplicate'`, `source = pack id`, so a replayed open pays once.

### 6.4 The mirror and the version
- TS: `packages/progression/src/packRoll.ts`, a pure `rollPack(look, owned, catalog, draws: number[], config)` that
  returns the five cards. The SQL copy is `progression_pack_roll(p_user, p_look_kind, p_look_id, p_floor, p_draws
  float8[])`, so a test can hand both the same 15 draws. `open_pack` calls it with 15 fresh `random()` values.
- `PACK_ROLL_VERSION = 1`, stored on every opened pack. Any change to how a pack rolls bumps it; an opened pack is never
  re-rolled.
- `packRoll.db.test.ts` runs the migration on PGlite and checks SQL equals TS for a few thousand random draw sets
  across every pack kind, including the fall-back and fully-owned cases (the `aether.db.test.ts` pattern).

## 7. The pack config (server-owned numbers)

A new one-row table `pack_config` (public read), its JSON exactly `DEFAULT_PACK_ECONOMY` in a new
`packages/progression/src/packEconomy.ts`, parsed strictly by `parsePackEconomy` (null on anything malformed, never a
partly-trusted document), and versioned like `aether_config`. A retune is an UPDATE, no release.

```ts
interface PackEconomy {
  version: number;
  rarityPackPrice: Record<CrateRarity, number>;     // 100 / 175 / 300 / 500 / 850
  themedPackPrice: number;                          // 200
  duplicateAether: Record<CrateRarity, number>;     // 20 / 35 / 60 / 100 / 170
  standardOdds: Record<CrateRarity, number>;        // 35 / 31 / 22 / 9 / 3, sums to 100
  rewardEvery: number;                              // 15
  rewardRarity: CrateRarity;                        // 'epic'
  levelPackEvery: number;                           // 5
  levelPackRarity: CrateRarity;                     // 'legendary'
  welcomePacks: Record<CrateRarity, number>;        // common 5, rare 2, epic 1, legendary 1, ancient 0
  freePackRarity: CrateRarity;                      // 'rare'
  counterTypes: number;                             // 5
  stackMax: number;                                 // 8
  refreshHours: number;                             // 6
  refreshZone: string;                              // 'America/New_York'
  featuredDeals: number;                            // 4
  dealOff: { min: number; max: number; step: number };   // 20 / 60 / 5 (percent)
  dealStock: { min: number; max: number };          // 2 / 5, per player
}
```

- `duplicateAether` is stored, not computed from the prices, so a price retune never silently changes a payout. A
  retune that keeps the owner's 20% rule updates both. *(My call.)*
- `aether_config` is untouched: match payouts are unchanged, and old clients keep parsing it.
- The roll's odds live here, not in the code. `CRATE_RARITY_ODDS` stays for the chests.
- `packEconomy.ts`, `packRoll.ts`, `packs.ts` and `packShop.ts` join `SHARED_ARTIFACTS` so the Edge Functions get
  generated Deno copies (`npm run progression:shared`).

## 8. The shop window

- The **window id** is the Eastern wall-clock date and block: `YYYY-MM-DDTHH`, HH in 00 / 06 / 12 / 18, computed in SQL
  from `now() at time zone 'America/New_York'` (the lab's `labShopDay`, moved into `packShop.ts` as the one copy).
- `pack_shop_windows (window_id primary key, offers jsonb, created_at)`: the window's offers, made by the first request
  in that window and the same for every player. The Category and Rarity shelves are the same every window; the
  Featured shelf holds the free pack and the Featured deals. *(My call: one shared window, not one per player: everyone
  sees the same four deals at the same prices.)*
- **Featured deals** (owner 2026-11-27, at launch, "Yes, per player"). When the window row is made, the server draws
  `featuredDeals` (4) different packs from the Category and Rarity shelves (never the Rare Rarity pack, which is the
  free one, and never a pack that is not offered), each with its own discount of `dealOff` (20% to 60% in 5% steps)
  and its own stock of `dealStock` (2 to 5). The deal price is the shelf price less the discount, rounded to the
  nearest 5 Aether and never below 5 (the lab's `featuredOffers` rule, moved to the server); `fullPrice` is the shelf
  price. The draws use `random()` once, when the window row is created, and are stored in it, so every player and
  every read see the same deals.
- **Deal stock is per player.** `stock` is how many of that deal ONE player may buy in the window. Stock left =
  `stock` minus the packs that player already bought of that offer (`packs.offer_id`), so each player can buy up to
  their own 2-5 and one player's buying never sells out anyone else. It is counted under the per-user lock, so no
  shared counter is needed. A deal is a paid purchase: it needs counter room and counts toward the purchase reward.
- Each offer carries its `offerId` (window id + look, so an offer from a past window is recognisably stale), `look`,
  `price`, `contains`, optional `fullPrice` and `stock`. Per-player numbers (`newToYou`, stock left) are added when the
  shop is read, never stored in the window.
- **Free pack:** one per player per window, a `buy_pack` of the free offer at price 0, `source = 'free:<window id>'`
  (unique), so a second claim in the same window answers with the first. It needs counter room like any purchase
  (the player drags it to the counter), does not count toward the purchase reward, and a guest cannot claim it (it is a
  shop action). *(My calls.)*

## 9. Buying, holding and opening

### 9.1 Tables
- `packs (pack_id uuid, user_id, look_kind, look_id, floor_rarity, source text, state 'sealed'|'opened',
  price_paid int, offer_id text, created_at, opened_at, roll_version int, cards jsonb)`, unique `(user_id, source)`. A transition
  guard (like `loot_crates_transition_guard`) lets a pack move only sealed to opened, once, and freezes its identity.
- `pack_meters (user_id, purchased int, claimed int)`. Rewards ready = `floor(purchased / rewardEvery) - claimed`.
- Owner-only reads; only security-definer functions write.

**Sources:** `shop:<request id>` (one per pack in a purchase: `shop:<request id>:<n>`), `free:<window id>`,
`reward:<n>` (the nth claimed reward), `level:<L>`, `welcome:<rarity>:<n>` (`welcome:common:1` ... `welcome:common:5`,
`welcome:rare:1`, `welcome:rare:2`, `welcome:epic:1`, `welcome:legendary:1`).

### 9.2 The counter limit on the server
The counter is a **view of the sealed packs in one fixed order**: oldest first (`created_at`, then `pack_id`). The
first 5 types in that order are on the counter, up to 8 of each; every other sealed pack is waiting. `counterSplit`
and `counterHasRoom` move from `packages/ui/.../shopModel.ts` into `packages/progression/src/packShop.ts`, the SQL
mirrors them (`progression_counter_has_room(p_user, p_look_kind, p_look_id)`), and a parity test pins the two.
- A **purchase** (paid or free) is refused with `no_room` when a pack of that type would not fit on the counter. Nothing
  is charged.
- A **grant** (level, Welcome, purchase reward, any later gift) is never refused: the pack is created and waits if
  there is no room (owner: "if it cant fit, send to their backpack").
- The profile and the shop read return the sealed packs in that same order, so the client draws exactly what the
  server will enforce.

### 9.3 `buy_pack(p_user, p_offer_id, p_expected_price, p_request_id)`
One transaction under the per-user progression lock, in this order:
1. A repeated `p_request_id` returns the first answer, charged once.
2. `packs_enabled` off: `failed`. A guest: `guest` (R-PROG-AETHER-02: guests earn but cannot spend).
3. The offer is looked up in the **current** window. Not there (a past window, an unknown id): `expired` with the
   current offers. Price differs from `p_expected_price`: `price_changed`. No stock left: `sold_out`.
4. No counter room: `no_room`. Balance short: `insufficient` with the balance.
5. Charge through `aether_apply(-price, 'pack_purchase', request id)` (skipped at price 0), create the pack(s), add
   `contains` to `pack_meters.purchased` when the price is above 0, and answer
   `{status 'ok', packs, aether, meter}`.

`BuyPackError` gains `no_room` and `expired` (the PR's type has neither). *(My call.)*

### 9.4 `open_pack(p_user, p_pack_id)`
One transaction under the lock. Not the player's pack: `pack_not_found`. A guest: `guest` (as crates,
R-PROG-CRATE-04). Already opened: the stored result (`already_opened`), nothing paid again. Otherwise: roll (section 6),
insert every new card into `player_cosmetics`, pay the duplicates once, mark the pack opened with its `cards` and
`roll_version`, and answer the `PackOpenResult` shape `parsePackOpenResult` already accepts, with `aether` set to the
balance after payouts. A pack never fails to open for lack of items: duplicates are always possible.

### 9.5 `claim_pack_reward(p_user, p_request_id)`
Under the lock: a guest `guest`; no reward ready `none`; otherwise create one `rewardRarity` Rarity pack
(`source = 'reward:<claimed + 1>'`), add 1 to `claimed`, answer `{status 'ok', packs}`. It is a grant, so it is never
refused for room. Guests: a guest buys nothing, so they never have a reward ready.

### 9.6 Reads
- The profile JSON gains `packs` (sealed, in counter order) and `packMeter {progress, ready}`. `crates` stays.
- A new Edge Function action `pack_shop` answers `{windowId, nextRefreshAt, shelves, offers (with per-player
  newToYou and stock), packs, packMeter, aether}`.
- `progression-inventory` gains actions `pack_shop`, `buy_pack`, `open_pack`, `claim_pack_reward`. The old actions stay.

## 10. Level and Welcome grants

Inside `settle_progression`, behind the switch:
- **Welcome:** the settlement that enrolls an account creates the nine Welcome packs of `welcomePacks` (5 Common,
  2 Rare, 1 Epic, 1 Legendary Rarity packs), sources `welcome:<rarity>:<n>`, instead of the Welcome Chest. Each is
  made once, so a retried settlement never makes a tenth. Nine packs of four types fit an empty counter (5 types, 8 of
  each), and grants wait anyway if they do not. Accounts enrolled before the switch keep the Welcome Chest they got and
  get no Welcome packs.
- **Level packs, only for levels reached after launch** (owner 2026-11-27, "Only after launch"). One `levelPackRarity`
  (Legendary) Rarity pack per multiple of `levelPackEvery` (5) that is ABOVE the account's launch level and at or below
  its new level, `source = 'level:<L>'`, so each is made once and a missing one self-heals above that line.
  - The **launch level** is a new column `profiles.pack_level_baseline int`. `pack_rollout()` writes every existing
    profile's current level into it before flipping the switch (and never overwrites one already written, so a re-run
    changes nothing). A profile created after the rollout has it null, read as 0: a new player's packs start at Level 5.
  - Example: an account at Level 37 on launch day gets nothing for 5 through 35; its first pack is at Level 40. An
    account at exactly Level 35 gets its first at 40 too (35 was reached before launch).
  - A settlement that lands after the flip counts as after launch, even for a game started before it. *(My call.)*
  - Settlements before the flip still grant the Epic milestone chest at a multiple of 10, as today.
- No more milestone chests. Milestone chests already granted stay, sealed or opened.
- The result JSON gains `packsAwarded` and `packIds`; `cratesAwarded` stays (0). `isPlausibleProgressionResult`
  (server.ts) gets the matching cap for packs: at most the level packs between the launch level and the reached level, plus the nine Welcome packs.
- Gauntlet is unchanged (a first clear already pays 200 Aether and no chest).

## 11. Retiring the Chest Shop

One switch, `progression_config.packs_enabled` (off by default), read in the same single config read as the other
switches (R-EGRESS-02). Flipped by an owner-run `pack_rollout()` (service role, idempotent), like `aether_rollout()`.

With the switch ON:
- `buy_crate` refuses with `shop_retired` before charging. `aether_quote` answers null. Focus is gone with it.
- The settlement grants packs, not chests (section 10).
- **Sealed chests are frozen** (owner 2026-11-27, "Freeze them"). `open_crate` refuses with `chests_frozen` as its
  first check after the lock, before anything is rolled, charged or written, so the chest stays sealed and counted for
  the lump sum. Opened chests and the items they gave are untouched. A re-open of an already-opened chest still returns
  its committed reward (nothing changes, so it is not refused). With the switch off `open_crate` works as today.
- The new client hides the Chest Shop and its focus picker and shows the Pack Shop; the Collection's chest bay shows
  only while the player still holds a sealed chest, with no Open or Open all, and one line saying the chests will be
  exchanged later (wording left to the builder, without promising an amount). The New rewards pop-up offers no chest
  Open either.

The chest code (`crateShop.ts`, `CrateShop.tsx`, `buy_crate`, the tiered pick) is deleted in a later cleanup PR, once
the lump-sum project has dealt with the remaining chests. Nothing in this project removes a table or a column.

## 12. Rollout and old clients (Ship Ascent)

**Order:**
1. Migration `2026-11-xx-packs.sql`, run in the SQL Editor (dormant: the switch is off; every new function refuses
   while it is off). Also appended to `schema.sql`.
2. Deploy `progression-inventory` and `submit-progression` with the new actions (additive; old actions unchanged).
3. **Ship Ascent** with the new client. With the switch still off it shows the Chest Shop as today, so shipping first
   changes nothing for anyone.
4. Owner runs `select public.pack_rollout();`. It writes every existing account's launch level
   (`pack_level_baseline`, section 10), pays the 3,000 Aether launch gift to every existing account (12.1), then flips
   the switch. It grants no level packs. From this moment packs are live.
5. Patch notes entry (`patchNotes.ts`) in the client PR of step 3, worded for the day the switch flips.

### 12.1 The 3,000 Aether launch gift

The same shape as the 1,000 Aether launch gift (`2026-10-19-aether-launch-grant.sql`, R-PROG-AETHER-05):
- `PACK_LAUNCH_GRANT = 3000` in `packEconomy.ts`; the SQL copy is a constant in the migration, pinned by a parity test.
- `pack_launch_grant(p_user)` pays it through `aether_apply(3000, 'grant', 'pack_launch')`. The ledger's unique
  (user, reason, source) key makes it **once per account**: a second rollout, a re-run migration or a retry pays nothing.
- `pack_rollout()` pays every existing profile, then flips `packs_enabled`. Paying before the flip means no player
  ever sees the new shop without the gift. A guest account is paid too (guests earn and see Aether,
  R-PROG-AETHER-01), and can spend it once it signs up.
- **The announcement:** the new client shows a one-time "the new Pack Shop" announcement the first time it opens with
  packs on, naming the 3,000 Aether gift (the "Introducing Aether" announcement is the pattern). The Aether is paid
  by the rollout, not by seeing the announcement, so a player who dismisses it, or plays on an old client, still has it.
  *(My call.)* Whether the announcement wording also mentions the nine Welcome packs is copy, left to the builder.
- **Launch-day accounts only** (owner 2026-11-27, "Launch-day accounts only", which replaces his earlier "yes, new
  accounts get the 3k too"). Only profiles that exist when `pack_rollout()` runs are paid. There is NO trigger on new
  profiles (unlike the 1,000 gift's `profiles_aether_launch_grant`): an account made after the rollout starts with its
  nine Welcome packs and no 3,000 Aether. The rollout pays every profile in the table at the moment it runs, under the
  one ledger key (`grant` / `pack_launch`), so a second run pays only profiles it missed, never one twice. A profile
  created while the rollout runs is paid if the rollout's read sees it, and is not otherwise. *(My call: no cut-off
  timestamp beyond the rollout itself.)*
- Separate from the unopened-chest lump sum, which this project does not build.

**An old client after the flip** (a friend who has not restarted to take the update):
- Its Chest Shop buy answers `shop_retired`. It does not know that reason and shows its generic failure; nothing is
  charged. It cannot buy anything until it updates.
- Its settlements still go to the server, which grants packs. The old client ignores `packsAwarded` and shows no new
  chest; the packs wait on the server and appear when it updates. Nothing is lost.
- Its chest bay's Open answers `chests_frozen`, which it does not know: it shows its generic open failure and the
  chest stays sealed. Nothing is lost.
- No minimum-version gate is added: the desktop app updates itself on restart, an old client can lose nothing, and the
  window is short. *(My call.)*

**A new client before the flip** behaves exactly as today. The client never decides which shop to show from its own
version, only from `packs_enabled`.

## 13. Open items (listed, not decided)

For the owner, in order of how much they change the build:

1. **Odds shown to players.** Chests print their odds (R-PROG-CRATE-03). Packs: show them, and where?
2. **Free-pack cadence.** The brief calls the free Rare once per Eastern day, but the shop spec quotes the owner,
   asked whether it stays daily, answering "Every 6 hours", and the lab gives one per window. This doc builds one per
   window (`free:<window id>`); a daily pack is a one-line change to the source key.
3. **Launch, Season and Secret packs**, and Secret as a sixth rarity in packs with its odds (today Secret exists as an
   achievement-only rarity above Ancient, R-PROG-SECRET-01).
4. **Booster box pricing.** The shop supports `contains` > 1; how a box fits the counter limit is decided with it.

## 14. The "chest" to "pack" copy sweep

Player-facing text only. Internal names (`loot_crates`, `CrateRarity`, `crateShop.ts`, the chest SQL) are not renamed.
- Where the word now means a pack: the Collection, the New rewards pop-up and the end screen's rewards line, the guest
  gate ("Create an account to open packs"), the level-up reward text, the Rules wiki answers about chests, menu labels
  and tooltips (`.gtip`), `aria-label`s.
- Where it still means a chest the player holds (the old-chest bay), it stays "chest".
- Never "Ascendant" for the rarity.
- Method: grep `\b[Cc]hests?\b|\b[Cc]rates?\b` in `packages/ui/src` string literals (about 570 matches today, most of
  them identifiers), list the player-visible ones in the PR description, and change them in one commit so the review is
  one read. *(My call on the method.)*

## 15. Oracle rules that must change

Amend or retire (in `packages/rules/src/registry/approved/foundation.ts`), each with the owner's 2026-11-27 words as
evidence and a regression test as enforcement:

| Rule | Change |
|---|---|
| R-PROG-AETHER-02 (the five crates and prices) | Retired with packs on; replaced by R-PROG-PACK-01. |
| R-PROG-AETHER-03 (focus fee) | Retired. |
| R-PROG-AETHER-04 (Epic chest every 10 levels, Welcome Chest) | Amended: Legendary pack every 5 levels reached after launch (not backdated), nine Welcome packs (5 Common, 2 Rare, 1 Epic, 1 Legendary); old milestone chests kept. |
| R-PROG-AETHER-06 (Announcers not focusable) | Retired (no focus). |
| R-PROG-AETHER-01 (payouts) | Unchanged numbers; "spent in the Pack Shop"; names the 3,000 launch gift beside R-PROG-AETHER-05's 1,000. |
| R-PROG-CRATE-02 (opening is optional, now or later; never an owned item; never converted to currency) | Scoped to chests, and amended: with packs on, a sealed chest cannot be opened (frozen until the lump-sum project). Packs may duplicate and pay Aether. |
| R-PROG-CRATE-04 / R-PROG-COLLECTION-01 (the chest bay's Open and Open all) | No Open while frozen. |
| R-PROG-CRATE-03 (one draw, odds shown) | Scoped to chests; pack roll in R-PROG-PACK-02. |
| R-PROG-CRATE-04 (guests cannot open crates) | Extended to packs, or a twin R-PROG-PACK rule. |
| R-PROG-SECRET-01 ("No chest ever rolls it") | "No chest or pack". |
| R-PROG-COLLECTION-01, R-PH-COLLECTION-01, R-PROG-NEWREWARDS-01, R-GODMODE-01 | Their chest wording, where it now means packs. |
| R-EGRESS-02 (one config read) | Adds the packs switch. |

New rules, `R-PROG-PACK-01` onward: the lineup and prices; the roll (sections 6.1 to 6.3); duplicate payouts; the
counter limit and that grants wait; the 6-hour window and free pack; the four Featured deals and their per-player stock; the purchase reward; level and Welcome packs;
the 3,000 Aether launch gift, once per account;
guests; idempotency (a request charged once, an open paid once). Each is added in the PR that makes it true.

## 16. What a builder decides

Exact SQL names and file split; the Edge Function action payload field names beyond those above; the JSON of the
window's offers; error text; how the profile JSON grows; the PGlite test matrix; the order of PRs (a sensible one:
progression TS + SQL + tests, then Edge Functions, then the client wiring on top of #2865, then the copy sweep and
oracle rules).

## 17. Testing

- `packRoll.test.ts`: every pack kind, the floor, the renormalized card-5 odds, the equal-category step, the fall-back,
  fully-owned category, a duplicate inside one pack, Secret never rolled.
- `packRoll.db.test.ts`: SQL equals TS draw for draw.
- `packs.db.test.ts`: buy (each refusal, including `no_room` and `expired`), a repeated request charged once, open paid
  once, claim, the counter order, grants waiting, guests refused, the switch off refusing everything, `buy_crate`
  answering `shop_retired` with the switch on, `open_crate` answering `chests_frozen` on a sealed chest with the
  switch on (the chest still sealed, nothing written) and opening as today with it off.
- Settlement: the nine Welcome packs on enrollment (and not again on a retry), level packs at 5/10/15 for a
  new account, none at or below the launch level for an existing one (Level 37 at launch: first pack at 40), a re-run
  rollout never moving the launch level, self-healing above it, no milestone chest with packs on.
- Featured deals: a window's four deals are the same for every player and every read, never the Rare pack, prices
  rounded to 5 and at least 5, and a player buying their whole stock leaves every other player's stock untouched.
- Launch gift: `pack_rollout()` pays 3,000 once per account, a second run pays nothing, and it pays before the switch flips;
  a profile created after the flip is not paid.
- `sqlParity.test.ts` extended for the new config document.
