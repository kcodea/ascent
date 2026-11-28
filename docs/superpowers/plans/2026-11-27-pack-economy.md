# Pack Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The server side of moving from chests to 5-card packs: config, roll, shop window, buy/open/claim, grants,
retiring and freezing chests, the launch, and wiring the pack shop and opener on PR kcodea/ascent#2865 to it.

**Architecture:** Pure TypeScript rules in `@game/progression` (dependency-free, copied to Deno), mirrored by one new
Supabase migration that does every write in security-definer functions under the per-user progression lock. PGlite
tests prove the SQL equals the TS. Everything is dormant behind `progression_config.packs_enabled` until the owner runs
`pack_rollout()`.

**Tech Stack:** TypeScript, Vitest, PGlite, Postgres/plpgsql (Supabase), Deno Edge Functions, React (UI).

**Spec:** `docs/superpowers/specs/2026-11-27-pack-economy-design.md` (approved 2026-11-27). Read it first; section
numbers below (§n) point into it.

## Global Constraints

- **Starts after PR kcodea/ascent#2865 is merged into `main`.** It owns `packs.ts`, `packShop.ts`, `PackShop`,
  `PackOpener`; branch every PR below off `origin/main` after that merge.
- One branch and PR per group below (PR A to PR D), squash-merged after `verify` is green. Never push to `main`.
- `npm install` in a new worktree before trusting `typecheck` / `test` (CLAUDE.md).
- Every progression file is dependency-free: sibling relative imports only. New ones join `SHARED_ARTIFACTS` and
  `npm run progression:shared` regenerates `supabase/functions/_shared/` (never hand-edit those).
- Integer maths for money; frozen constants; strict parsers that return null on anything malformed.
- Owner values, verbatim: Rarity pack prices Common 100, Rare 175, Epic 300, Legendary 500, Ancient 850; every Category
  and style pack 200; duplicate payout Common 20, Rare 35, Epic 60, Legendary 100, Ancient 170; Standard odds
  35/31/22/9/3; purchase reward every 15 paid packs = 1 Epic pack; Legendary pack every 5 levels reached after launch;
  Welcome = 5 Common, 2 Rare, 1 Epic, 1 Legendary; launch gift 3,000 Aether to launch-day accounts only; counter 5
  types x 8 each; refresh every 6 hours at 12am/6am/12pm/6pm `America/New_York`; free Rare once per window; Featured
  = 4 deals, 20-60% off in 5% steps, 2-5 stock PER PLAYER, price rounded to nearest 5 and at least 5.
- "Ancient" is the rarity; never "Ascendant" for it. Internal identifiers (`loot_crates`, `CrateRarity`) are not renamed.
- No `Math.random` in progression code; the server's only randomness is SQL `random()`.
- UI rules from CLAUDE.md apply to Task 10 and 11 (no `title=`, no bare `cursor: pointer`, portal into `stageHost()`).

## Review Focus

1. **Last counter slot, two buys at once** (two tabs, different request ids): exactly one succeeds, the other is
   `no_room` and uncharged. Test in Task 7.
2. **A buy that crosses a window boundary** (offer read at 5:59:59, bought at 6:00:01 Eastern): `expired`, uncharged,
   the answer carries the new window's offers. Test in Task 7.
3. **A daylight-saving day**: the 5- and 7-hour windows get the same ids in TS and SQL. Test in Tasks 1 and 7.
4. **A category pack whose cards 1-4 grant the last unowned items of its category**: card 5 takes the fully-owned path
   (a duplicate from the category) instead of failing. Test in Task 4 and its SQL twin in Task 6.
5. **An existing Level 12 account's first settlement after launch, crossing to 16**: one Legendary pack (`level:15`),
   none for 5 or 10, and a retry makes nothing new. Test in Task 8.

---

## PR A: the rules in TypeScript (`feat/pack-economy-rules`)

### Task 1: The pack economy document and the shop window

**Files:**
- Create: `packages/progression/src/packEconomy.ts`, `packages/progression/src/packEconomy.test.ts`
- Modify: `packages/progression/src/packShop.ts` (move the window maths in), `packages/progression/src/index.ts`,
  `packages/progression/src/sharedArtifact.ts`,
  `packages/ui/src/progression/packShop/shopLabData.ts` (import the moved helpers instead of its own)

**Interfaces:**
- Produces: `interface PackEconomy` exactly as spec §7 plus `featuredDeals: number; dealOff: {min,max,step};
  dealStock: {min,max}`; `DEFAULT_PACK_ECONOMY` (version 1, owner values); `parsePackEconomy(v: unknown):
  PackEconomy | null`; `PACK_LAUNCH_GRANT = 3000`; `PACK_ROLL_VERSION = 1`;
  `rarityPackOdds(floor: CrateRarity, eco?: PackEconomy): { cards: Record<CrateRarity, number>; last:
  Record<CrateRarity, number> }` (percent, one decimal, the `tierOddsPercent` rounding);
  in `packShop.ts`: `shopWindowId(now: Date, eco?): string` (`YYYY-MM-DDTHH`), `nextShopRefresh(now: Date, eco?):
  number` (ms), moved from `labShopDay` / `labNextRefresh` unchanged in behaviour.

- [ ] **Step 1: Write the failing tests** in `packEconomy.test.ts`:
  `DEFAULT_PACK_ECONOMY` has the Global Constraints numbers; `parsePackEconomy(JSON.parse(JSON.stringify(DEFAULT_PACK_ECONOMY)))`
  deep-equals it; it returns null for a missing price, a negative payout, odds not summing to 100, `stackMax` 0, an
  unknown rarity key; `rarityPackOdds('rare').last` equals `{common:0, rare:47.7, epic:33.8, legendary:13.8, ancient:4.6}`
  and `.cards` equals the Standard odds; `rarityPackOdds('ancient').last.ancient === 100`;
  `shopWindowId(new Date('2026-03-08T06:59:00Z')) === '2026-03-08T00'` and `...('2026-03-08T10:00:00Z')` is
  `'2026-03-08T06'` (the spring-forward day), and `nextShopRefresh` of the first is `Date.parse('2026-03-08T10:00:00Z')`.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/packEconomy.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the file and the move; `shopLabData.ts` re-exports `labShopDay = shopWindowId` and
  `labNextRefresh = nextShopRefresh` so the lab's tests stay green. Add `packEconomy.ts`, `packs.ts`, `packShop.ts`
  to `SHARED_ARTIFACTS` (targets `progressionPackEconomy.ts`, `progressionPacks.ts`, `progressionPackShop.ts`).
- [ ] **Step 4: Run** the new test and `npx vitest run packages/ui/src/progression/packShop packages/progression`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(progression): the pack economy document and the shop window`.

### Task 2: The counter rules on the shared side

**Files:**
- Modify: `packages/progression/src/packShop.ts`, `packages/ui/src/progression/packShop/shopModel.ts`,
  `packages/ui/src/progression/packShop/counterSplit.test.ts` (move to `packages/progression/src/packCounter.test.ts`)

**Interfaces:**
- Produces in `packShop.ts`: `lookKey(look: PackLook): string`; `counterSplit(hand: readonly OwnedPack[], eco?):
  { counter: OwnedPack[]; waiting: WaitingPacks[] }`; `counterHasRoom(hand, look, eco?): boolean` (the shopModel
  behaviour, limits read from `eco.counterTypes` / `eco.stackMax`); `BuyPackError` gains `'no_room' | 'expired'`.
  `shopModel.ts` re-exports them (its importers are unchanged).
- Consumes: `PackEconomy` (Task 1).

- [ ] **Step 1: Move the existing tests** and add: a hand of 5 types with the Rare stack at 8 has no room for a Rare
  and no room for a sixth type, and has room for a seventh Common if Common holds 6; a hand given oldest-first places
  the first 5 types on the counter.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/packCounter.test.ts`. Expected: FAIL (not exported).
- [ ] **Step 3: Implement** the move.
- [ ] **Step 4: Run** it plus `npx vitest run packages/ui/src/progression/packShop`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(progression): the counter limit lives with the server rules`.

### Task 3: Style pack membership in the catalog

**Files:**
- Modify: `packages/progression/src/cosmetics.ts` (`CosmeticDef.packStyles?: readonly string[]`, `CatalogSyncItem`,
  `catalogSyncPayload`), `packages/progression/src/cosmetics.test.ts`

**Interfaces:**
- Produces: `CatalogSyncItem.packStyles: string[]` (empty when absent); `packStyleIds(c: CosmeticDef): readonly string[]`.

- [ ] **Step 1: Failing test:** every `packStyles` entry is one of the style look ids in `STYLE_PACK_IDS` (a new
  exported list in `packShop.ts`: `themed-scribble` plus the ten `themed-*` ids of the shop spec), and
  `catalogSyncPayload()` carries `packStyles` for every item.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/cosmetics.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Assign no items yet: membership is the owner's content (spec §5). `catalogHash` changes,
  which is expected.
- [ ] **Step 4: Run** `npx vitest run packages/progression`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(progression): cosmetics can belong to style packs`.

### Task 4: The pack roll

**Files:**
- Create: `packages/progression/src/packRoll.ts`, `packages/progression/src/packRoll.test.ts`
- Modify: `packages/progression/src/index.ts`, `sharedArtifact.ts` (target `progressionPackRoll.ts`)

**Interfaces:**
- Produces: `rollPack(input: { look: PackLook; owned: Iterable<string>; draws: readonly number[]; catalog?: readonly
  CosmeticDef[]; eco?: PackEconomy }): PackCard[]` (exactly 5, guaranteed last, `duplicate: {aether}` or null);
  `packPool(catalog, kind: 'all' | {category} | {style})`. `draws.length` must be 15 (3 per card: rarity, category,
  item); throws otherwise.
- Consumes: `crateRarityFallback`, `COSMETIC_RARITIES` (cosmetics.ts), `PackEconomy` (Task 1).

The algorithm is spec §6.2-6.3. The non-obvious part, so it is fixed here:
```
rarity draw u: walk the rarities in COSMETIC_RARITIES order over the odds table (Standard, or the floor-restricted
  renormalized table for a rarity pack's card 5); then crateRarityFallback(rolled) filtered to rarities with something
  in the pool (and >= floor for that card 5).
category draw u: cats = COSMETIC_CATEGORIES (order) that have >= 1 pool item of that rarity; pick cats[floor(u*len)].
item draw u: items of that rarity+category sorted by id; pick items[floor(u*len)].
duplicate = owned-before-pack OR given by an earlier card of this pack.
category/style card 5: pool = own pool minus owned (after cards 1-4); empty -> own pool with owned items, Standard odds.
```

- [ ] **Step 1: Failing tests:** draws all 0 on a Common pack give five Common cards; a Rare pack's card 5 is never
  Common for 200 random draw sets; an Ancient pack's card 5 is Ancient; a category pack's card 5 is in its category
  and unowned while one remains; **Review Focus 4**: a catalog where the emote category has two unowned items and
  draws make cards 1-2 grant both, card 5 is an owned emote with `duplicate.aether === DUPLICATE[rarity]`; two cards
  rolling the same item make the second a duplicate; a duplicate of an Epic pays 60 whatever the pack; no Secret item
  is ever rolled; `rollPack` throws on 14 draws.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/packRoll.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `rollPack` and `packPool`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(progression): the 5-card pack roll`.

### Task 5: The shop window's offers and the Featured deals

**Files:**
- Modify: `packages/progression/src/packShop.ts`; Create: `packages/progression/src/packWindow.test.ts`
- Modify: `packages/ui/src/progression/packShop/shopLabData.ts` (its `featuredOffers` calls the shared one)

**Interfaces:**
- Produces: `shelfOffers(windowId: string, catalog?, eco?): PackOffer[]` (every Rarity, Category and style pack whose
  pool is non-empty, at its price, offerId `<windowId>:<look id>`); `windowOffers(windowId, draws: readonly
  number[], catalog?, eco?): PackOffer[]` = the free Rare (offerId `<windowId>:free`, price 0, badge 'free'),
  then 4 deals (offerId `<windowId>:deal:<n>`), then `shelfOffers`. Deals consume 3 draws each (pick, discount, stock),
  12 in all. `rarityPackOdds` is attached as `odds` on Rarity offers only.

- [ ] **Step 1: Failing tests:** `windowOffers('2026-11-27T12', Array(12).fill(0))` has the free Rare first; four
  deals, none `rarity-rare`, all distinct; with draws at 0.999 a deal is 60% off; a 175 pack at 35% off is 115; no deal
  price is below 5; every deal's `stock` is in 2..5 and `fullPrice` is the shelf price; Category offers have no `odds`.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/packWindow.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, with `PackOffer` gaining `odds?` (exported type `PackOdds`).
- [ ] **Step 4: Run** it plus the lab tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(progression): the shop window's offers and Featured deals`. Then `npm run typecheck &&
  npm run lint && npm test && npm run build:web`, push, open PR A.

---

## PR B: the server (`feat/pack-economy-sql`)

One migration, `supabase/migrations/2026-12-xx-packs.sql` (date = the day it is written), also appended to
`supabase/schema.sql`, built up over Tasks 6-8. Idempotent: `if not exists`, `on conflict do nothing`, every function
replaced and re-granted, revoked from `anon`/`authenticated` except where a policy allows owner reads. Header comment
in the house style (what it replaces, run order, the TS copy).

### Task 6: Tables, config, switch and the SQL roll

**Files:**
- Create: the migration (sections 1-5), `packages/progression/src/packRoll.db.test.ts`

**Interfaces:**
- Produces (SQL): `progression_config.packs_enabled boolean default false`; `pack_config(id=1, economy jsonb)` seeded
  with `JSON.stringify(DEFAULT_PACK_ECONOMY)`; `profiles.pack_level_baseline int`; `cosmetic_catalog.pack_styles
  text[] not null default '{}'` and `sync_cosmetic_catalog` writing it; `packs` (spec §9.1 plus `offer_id`), its
  transition guard; `pack_meters`; `progression_pack_roll(p_user uuid, p_look_kind text, p_look_id text, p_floor text,
  p_draws float8[]) returns jsonb` (the five `PackCard`s, reading owned rows but writing nothing).
- Consumes: `rollPack`, `DEFAULT_PACK_ECONOMY`, `catalogSyncPayload`.

- [ ] **Step 1: Failing test** (pattern: `aether.db.test.ts`): run the migrations on PGlite, sync the catalog, and for
  2,000 seeded draw sets across every look kind, with random owned sets including the fully-owned category,
  `progression_pack_roll` equals `rollPack` card for card.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/packRoll.db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write** sections 1-5 of the migration.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(sql): pack tables, config and the server roll`.

### Task 7: The shop window, buy, open and claim

**Files:**
- Modify: the migration (sections 6-9); Create: `packages/progression/src/packs.db.test.ts`

**Interfaces:**
- Produces (SQL, all `security definer`, service role only): `pack_window_id(p_at timestamptz) returns text`;
  `pack_shop_window(p_window text) returns jsonb` (creates the row with 12 `random()` draws through the SQL twin of
  `windowOffers`, once); `progression_counter_has_room(p_user, p_look_kind, p_look_id) returns boolean`;
  `buy_pack(p_user uuid, p_offer_id text, p_expected_price int, p_request_id uuid) returns jsonb`;
  `open_pack(p_user uuid, p_pack_id uuid) returns jsonb`; `claim_pack_reward(p_user uuid, p_request_id uuid) returns
  jsonb`; `pack_shop_json(p_user uuid) returns jsonb` (spec §9.6, `newToYou` and per-player stock left). Answers use
  the `BuyPackOutcome`, `PackOpenResult` and `ClaimRewardOutcome` shapes; refusals in spec §9.3 order.
- Consumes: Tasks 2, 4, 5, 6.

- [ ] **Step 1: Failing tests:** `pack_window_id` equals `shopWindowId` across a DST week, hourly; every refusal of
  §9.3 (`guest`, `expired`, `price_changed`, `sold_out`, `no_room`, `insufficient`) leaves the balance and the packs
  unchanged; a repeated request id answers the first result, charged once; the free pack twice in one window gives one
  pack; a deal bought up to its stock is `sold_out` for that player and not for another; 15 paid packs make one reward
  ready, free packs and deals at price 0 do not count, deals do; a claim with a full counter still creates the pack;
  `open_pack` twice pays duplicates once and returns the same cards; a guest cannot open; **Review Focus 1** (two
  concurrent `buy_pack` calls on the last slot, via two PGlite connections or sequenced under the lock); **Review Focus
  2** (an offer id of the previous window: `expired`, uncharged, current offers in the answer); `pack_shop_json` gives
  `odds` on Rarity offers only and equals `rarityPackOdds`.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/packs.db.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write** sections 6-9.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(sql): buy, open and claim packs under the progression lock`.

### Task 8: Grants, retiring and freezing chests, and the rollout

**Files:**
- Modify: the migration (sections 10-13: `settle_progression`, `buy_crate`, `open_crate`, `aether_quote`,
  `progression_profile_json`, `progression_result_json`, `pack_launch_grant`, `pack_rollout`),
  `packages/progression/src/server.ts` (`isPlausibleProgressionResult`), `packages/progression/src/rules.ts`
  (`ProgressionProfile.packs`, `.packMeter`, `ProgressionResult.packsAwarded`, `.packIds`, their parsers),
  `packages/progression/src/packEconomy.ts` (`levelPacksBetween(baseline: number, level: number, eco?): number[]`)
- Create: `packages/progression/src/packGrants.db.test.ts`; extend `server.test.ts`, `rules.test.ts`

**Interfaces:**
- Produces: `levelPacksBetween(37, 41) -> [40]`, `levelPacksBetween(0, 10) -> [5, 10]`; the settlement's step 9b with
  packs on: the nine `welcome:<rarity>:<n>` packs on enrollment, `level:<L>` for each `levelPacksBetween(coalesce(
  pack_level_baseline, 0), new level)`, no crates; `buy_crate` raising `shop_retired` and `aether_quote` returning
  null with packs on; `open_crate` raising `chests_frozen` on a sealed chest with packs on (an opened chest still
  answers `already_opened`); `pack_rollout()` writing `pack_level_baseline` only where null, paying
  `pack_launch_grant` (ledger `grant` / `pack_launch`) to every profile, then setting `packs_enabled`, all in one
  transaction, granting no level packs. No trigger on new profiles.
- Consumes: Tasks 6-7.

- [ ] **Step 1: Failing tests:** enrollment after the flip makes exactly the nine Welcome packs, and a retried
  settlement none; enrollment before the flip still makes the Welcome Chest; **Review Focus 5**; a new account crossing
  Level 10 gets `level:5` and `level:10`; no milestone chest with packs on; `buy_crate` and a sealed `open_crate` are
  refused and change nothing; `pack_rollout()` twice pays 3,000 once per profile and never moves a written baseline; a
  profile created after the rollout has no `pack_launch` ledger row; `isPlausibleProgressionResult` rejects a result
  with more packs than `levelPacksBetween(...) + 9`.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/packGrants.db.test.ts packages/progression/src/server.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write** sections 10-13 and the TS changes.
- [ ] **Step 4: Run** `npx vitest run packages/progression`. Expected: PASS (including `sqlParity.test.ts` and the
  existing chest tests, which run with packs off).
- [ ] **Step 5: Commit** `feat(sql): pack grants, the chest freeze and the pack rollout`. Gates, push, open PR B.

---

## PR C: the Edge Functions (`feat/pack-economy-functions`)

### Task 9: The inventory actions

**Files:**
- Modify: `packages/progression/src/inventory.ts` (`InventoryRequest`, `validateInventoryBody`,
  `INVENTORY_ERROR_STATUS`, the handler), `packages/progression/src/inventory.test.ts`,
  `supabase/functions/progression-inventory/index.ts`; regenerate `_shared` with `npm run progression:shared`

**Interfaces:**
- Produces: actions `{action:'pack_shop'}`, `{action:'buy_pack', offerId, expectedPrice, requestId}`,
  `{action:'open_pack', packId}`, `{action:'claim_pack_reward', requestId}`, each calling the Task 7 function and
  answering its JSON. Status: `no_room`, `expired`, `price_changed`, `sold_out`, `insufficient`, `shop_retired`,
  `chests_frozen`, `packs_disabled` = 409; `guest` = 403; `pack_not_found` = 404. Old actions unchanged.

- [ ] **Step 1: Failing tests:** each new action validates (bad uuid, price over the bound, unknown offer id shape:
  400) and maps every SQL code above to its status.
- [ ] **Step 2: Run** `npx vitest run packages/progression/src/inventory.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, regenerate `_shared`.
- [ ] **Step 4: Run** `npx vitest run packages/progression` (includes `sharedArtifact.test.ts`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(functions): pack shop, buy, open and claim actions`. Gates, push, open PR C. Deploy
  happens in rollout order (spec §12), not on merge.

---

## PR D: the client, the copy and the rules (`feat/pack-economy-client`)

### Task 10: Wire the shop and opener to the server

**Files:**
- Modify: `packages/ui/src/progression/progressionRemote.ts` (`packs_enabled` in the one config read,
  `fetchPackShop`, `buyPackRemote`, `openPackRemote`, `claimPackRewardRemote`), `progressionStore.ts`, the
  `PackShopEntry.tsx` mount (real data when packs are on; the lab stays dev-only), the Collection's chest bay (no Open
  or Open all while packs are on, one exchanged-later line), the New rewards pop-up (no chest Open with packs on; packs
  link to the Pack Shop), the menu entry (Chest Shop hidden, Pack Shop shown, from `packs_enabled` only), a one-time
  new-shop announcement naming the 3,000 Aether (pattern: `AetherIntroPopup.tsx`)
- Test: their existing test files plus `progressionRemote.test.ts`

**Interfaces:**
- Consumes: Task 9 actions; `PackShopProps` (`buy`, `open`, `hand`, `offers`, `aether`) and `PackOpener`'s `open` from PR #2865.

- [ ] **Step 1: Failing tests:** with `packs_enabled` false the Chest Shop shows and the Pack Shop does not; with it
  true the reverse; `progression_config` is still read once per session (R-EGRESS-02); a `no_room` buy returns the pack
  to the shelf with the counter note; a guest buy shows the sign-in gate; the chest bay has no Open with packs on; the
  announcement shows once and names 3,000.
- [ ] **Step 2: Run** the touched test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run packages/ui/src/progression`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui): the Pack Shop and opener on the real server`.

### Task 11: The chest-to-pack copy sweep and patch notes

**Files:**
- Modify: player-facing strings in `packages/ui/src` (spec §14), the Rules wiki answers about chests,
  `packages/ui/src/patchNotes.ts` (prepend one entry: packs replace chests, prices, nine starting packs, Legendary pack
  every 5 levels, chests frozen until an exchange, odds on Rarity packs)

- [ ] **Step 1:** `grep -rnE "\b[Cc]hests?\b|\b[Cc]rates?\b" packages/ui/src --include=*.tsx --include=*.ts` and list
  every player-visible hit in the PR description, each marked "now a pack" or "still a held chest".
- [ ] **Step 2:** Change the "now a pack" ones in one commit; no identifier renames; no "Ascendant" for the rarity.
- [ ] **Step 3: Run** `npx vitest run packages/ui` (string-snapshot tests update only where the copy changed). Expected: PASS.
- [ ] **Step 4: Commit** `feat(ui): chests become packs in the game's words`.

### Task 12: The oracle rules

**Files:**
- Modify: `packages/rules/src/registry/approved/foundation.ts` (amend or retire the rules in spec §15; append the new
  `R-PROG-PACK-01` onward at the end of the array)

- [ ] **Step 1:** For each new rule: `statement` (the rule in plain words), `evidence` (an `owner-chat` entry quoting
  the 2026-11-27 ruling from spec §3, plus `fix-pr`/`code` naming PRs A-D and the file), `currentBehaviour`,
  `enforcement: {kind:'scenario', refs:[the Task 4-10 test that pins it], lastVerifiedAt: today}`. Retired rules keep
  their ids; amended ones say what changed and when.
- [ ] **Step 2: Run** `npx vitest run packages/rules` and `npm run docbot:report -- --check`. Expected: PASS.
- [ ] **Step 3: Commit** `docs(rules): the pack economy rules`. Gates, push, open PR D. Merge order A, B, C, D;
  then the owner follows spec §12 (SQL, functions, Ship Ascent, `pack_rollout()`).
