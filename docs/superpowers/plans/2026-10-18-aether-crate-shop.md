# Aether + Crate Shop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace level-up and Gauntlet crates with an earned currency (Aether) that players spend in a Crate Shop on rarity-floor crates, with an optional, server-priced category focus.

**Architecture:**
- **Economy rules.** Pure, dependency-free TS in `@game/progression` defines the economy and the tiered roll. One
  new idempotent migration mirrors it in plpgsql (wallet, ledger, config row, tiered pick, `buy_crate`, the focused
  `open_crate`, and the Aether branch of `settle_progression` / `record_gauntlet_clear`).
- **Server-owned numbers.** Every number lives in a public, single-row `aether_config` table seeded from
  `DEFAULT_AETHER_ECONOMY`, so the owner retunes with one SQL `update`. The client reads the same row to display
  prices, and the server re-prices every purchase itself.
- **Off by default.** Everything sits behind `progression_config.aether_enabled`. While it is false, today's
  behaviour is byte-for-byte unchanged.

**Tech Stack:** TypeScript, Vitest, PGlite (WASM Postgres) for SQL execution tests, Supabase (plpgsql + Deno Edge Functions), React + Zustand.

**Spec:** `docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md`. Read it first. Every number below is copied from it.

## Global Constraints

- **Ranked Aether:** base 50, win or lose, for an accepted, placed game. Placement bonus by place 1–8:
  `[140, 80, 45, 35, 25, 15, 10, 0]`. No valid placement means 0.
- **Other modes:**
  - Versus: 25 for a completed match, +45 for the winner. An abandoned match with no winner pays 25.
  - Practice: 0. Tutorial: 0. Comeback bonus: none.
  - Gauntlet: first clear of a stage pays 200, once per stage. Stages cleared before rollout pay nothing.
- **Crate prices:** standard 100 · rare 200 · epic 400 · legendary 600 · ancient 900.
- **Crate floors:** standard → common, rare → rare, epic → epic, legendary → legendary, ancient → ancient.
- **Odds inside a crate:** `CRATE_RARITY_ODDS` (35/31/22/9/3), restricted to rarities ≥ the floor and renormalized.
  The fall-back for an empty rarity never goes below the floor.
- **Focus fee:** a percent of the crate's price, by number of categories ticked, 1..7: `[100, 60, 40, 25, 15, 10, 5]`.
  - Ticking 8 or more (but fewer than all available) costs 5.
  - "Ticked" counts only categories still **available** to this player at this floor.
  - Ticking every available category means no focus and costs 0.
- **Milestone crates:** a free Legendary-floor, unfocused crate at Level 10, 20, 30, … (every 10th level).
  - At open, the player may focus it for the Legendary focus fee.
  - Backdated at rollout for every multiple of 10 at or below the current level.
- **Welcome Crate (Level 1):** kept, unchanged.
- **Accounts start at 0 Aether.** Aether is never bought with real money.
- **Guests:** anonymous accounts earn and see Aether but cannot spend it. Every spend path shows `CrateSignInGate`.
- **Trust:** rolls, balances and prices are decided in SQL only. The client names a tier, a focus, the price it
  showed, and a request id. Gauntlet Aether is paid on the client's clear, an accepted risk (spec, owner 2026-10-18).
- **Repo rules (CLAUDE.md):**
  - Branch + PR per piece, never push `main`. Green `verify` before merge, squash-merge.
  - Never hand-edit `supabase/functions/_shared/progression*`; run `npm run progression:shared`.
  - Every new migration block is also appended verbatim to `schema.sql`.
  - UI: no `title=` attributes, and no bare `cursor: pointer` (the gauntlet cursor rule).
  - Buttons use the shared Gem plate; portal into `stageHost()`; no raw `vw`/`vh`.
  - Animate only `transform`/`opacity` in loops.
- **Gates before "done":** `npm run typecheck && npm run lint && npm test && npm run build:web`.

## Review Focus

1. **Double-clicked or retried Buy** (the same `requestId` sent twice): charged once, one crate. The second call
   returns the first result. Test: Task 3 `buy_crate is idempotent per request id`.
2. **Balance exactly equal to the price:** the buy succeeds and the balance lands on 0. One Aether short: refused
   with `insufficient_aether`, nothing written. Test: Task 3 `exact balance buys, one short refuses`.
3. **A focus naming a sold-out, disabled, unknown or duplicated category:** the server refuses with `bad_focus`;
   the client disables the chip. Tests: Task 3 `bad focus is refused` and Task 9 `sold-out chip is disabled`.
4. **The owner retunes `aether_config` between the client's quote and the buy:** refused with `price_changed`, no
   charge; the client re-reads the economy and shows the new price. Tests: Task 3 `stale price is refused` and
   Task 7 `price_changed refreshes the economy`.
5. **Nothing left at or above the floor** (all Ancients owned; a milestone crate whose Legendary+ pool is empty):
   the tier can't be bought (`sold_out`), and the milestone crate stays sealed (`pool_exhausted`), never falling
   below its floor. Test: Task 3 `never falls below the floor`.

---

## File structure

**PR A: engine (`feat/aether-engine`), Tasks 1–6**

| File | Responsibility |
|---|---|
| `packages/progression/src/aether.ts` (new) | `AetherEconomy` type + `DEFAULT_AETHER_ECONOMY`, `parseAetherEconomy`, `aetherForSettlement`, `milestoneLevelsThrough` |
| `packages/progression/src/crateShop.ts` (new) | Tiers/floors, tier odds, eligibility by floor + focus, available categories, focus fee, `quoteCrate`, `pickTieredCrateReward`, `tieredCrateChances` |
| `packages/progression/src/cosmetics.ts` | `CRATE_ROLL_VERSION` 4 → 5; `CrateRow` gains `floor`/`focus`; `parseCrate` + `crateLabel` learn the `milestone:<L>` and `shop:<uuid>` sources |
| `packages/progression/src/rules.ts` | `ProgressionResult.aether`, `ProgressionProfile.aether`, their parsers |
| `packages/progression/src/server.ts` | `settlementParity` for Aether-era crates and Aether |
| `packages/progression/src/inventory.ts` | the `buy_crate` action; optional focus on `open_crate`; new error codes |
| `packages/progression/src/gauntlet.ts` | `GauntletClearResult.aether` |
| `packages/progression/src/sharedArtifact.ts`, `index.ts` | register and export the two new files |
| `supabase/migrations/2026-10-18-aether.sql` (new) + `schema.sql` | the whole SQL side |
| `packages/progression/src/aether.test.ts`, `crateShop.test.ts`, `aether.db.test.ts` (new); `sqlParity.test.ts`, `server.test.ts`, `inventory.test.ts` (extend) | tests |
| `packages/rules/src/registry/approved/foundation.ts` | new R-PROG-AETHER-01..04; R-PROG-CRATE-01 amended |

**PR B: client (`feat/aether-shop-ui`, stacked on A), Tasks 7–11**

| File | Responsibility |
|---|---|
| `packages/ui/src/progression/progressionRemote.ts` | `fetchAetherEnabled`, `fetchAetherEconomy`, `buyCrateRemote`, `openCrateRemote(crateId, focus?)`; crate columns |
| `packages/ui/src/progression/progressionStore.ts` | `aetherCapability`, `economy`, `buyCrate`, `openCrate(crateId, focus?)`, `aetherVisible` |
| `packages/ui/src/progression/ProgressionPostgame.tsx` | the "+N Aether" block |
| `packages/ui/src/progression/CrateShop.tsx` (new) + `collection.css` | the two-step picker (shop mode + milestone mode) |
| `packages/ui/src/progression/CollectionScreen.tsx` | wallet chip, mounts `CrateShop`, bay wording, milestone Open → focus step |
| `packages/ui/src/gauntlet/GauntletEndScreen.tsx` | "+200 Aether" instead of a crate when Aether is on |
| `docs/GAME-RULES.md`, `docs/devlog/2026-10-18-aether-crate-shop.md`, `packages/ui/src/patchNotes.ts` | docs + player changelog |

---

## PR A: engine

### Task 1: Economy rules (`aether.ts`)

**Files:**
- Create: `packages/progression/src/aether.ts`
- Test: `packages/progression/src/aether.test.ts`

**Interfaces:**
- Consumes: `ProgressionMode`, `isValidPlacement` from `./rules`.
- Produces:
```ts
export type CrateTier = 'standard' | 'rare' | 'epic' | 'legendary' | 'ancient';
export const CRATE_TIERS: readonly CrateTier[]; // in that order
export interface AetherEconomy {
  version: number;                          // 1
  rankedBase: number;                       // 50
  rankedPlacementBonus: readonly number[];  // length 8, index 0 = 1st
  versusComplete: number;                   // 25
  versusWin: number;                        // 45
  gauntletFirstClear: number;               // 200
  cratePrice: Readonly<Record<CrateTier, number>>;
  focusFeePercent: readonly number[];       // length 7, index 0 = 1 ticked
  milestoneEvery: number;                   // 10
}
export const DEFAULT_AETHER_ECONOMY: AetherEconomy;     // frozen, values from Global Constraints
export function parseAetherEconomy(v: unknown): AetherEconomy | null;
export interface AetherBreakdown { base: number; placement: number; total: number }
export const ZERO_AETHER: AetherBreakdown;
export function aetherForSettlement(input: { mode: ProgressionMode; placement: number | null; terminal?: boolean }, eco?: AetherEconomy): AetherBreakdown;
export function milestoneLevelsThrough(level: number, every?: number): number[]; // [10, 20, …] ≤ level
```

- [ ] **Step 1: Write the failing tests** in `aether.test.ts`:
  - `ranked pays base + placement`:
    - `aetherForSettlement({mode:'ranked', placement:1})` → `{base:50, placement:140, total:190}`
    - placement 2 → total 130
    - placement 8 → `{50, 0, 50}`
    - placement null → `ZERO_AETHER`
  - `versus pays complete + win`:
    - placement 1 → `{25, 45, 70}`
    - placement 2 → `{25, 0, 25}`
    - placement null → `{25, 0, 25}`
  - `practice and tutorial pay nothing`: both return `ZERO_AETHER` for every placement.
  - `a non-terminal game pays nothing`: `terminal:false` returns `ZERO_AETHER` for ranked placement 1.
  - `default economy matches the spec`:
    - `cratePrice` deep-equals `{standard:100, rare:200, epic:400, legendary:600, ancient:900}`
    - `focusFeePercent` deep-equals `[100,60,40,25,15,10,5]`
    - `rankedPlacementBonus` deep-equals `[140,80,45,35,25,15,10,0]`
  - `parseAetherEconomy round-trips the default and rejects junk`: `parseAetherEconomy(JSON.parse(JSON.stringify(DEFAULT_AETHER_ECONOMY)))`
    deep-equals the default. It returns `null` for any of:
    - a negative price
    - a missing tier
    - `rankedPlacementBonus` of length 7
    - a non-integer value
  - `milestones every 10`:
    - `milestoneLevelsThrough(9)` → `[]`
    - `milestoneLevelsThrough(34)` → `[10,20,30]`
    - `milestoneLevelsThrough(40)` → `[10,20,30,40]`
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/progression/src/aether.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `aether.ts`.**
  - Dependency-free: imports only from `./rules`.
  - File header comment: why it exists, the spec path, and "the SQL copy is `aether_config` in `2026-10-18-aether.sql`".
  - `parseAetherEconomy` accepts only non-negative integers, the exact array lengths and all five tiers.
- [ ] **Step 4: Run the tests and confirm they pass.** Same command → PASS.
- [ ] **Step 5: Commit.** `git add packages/progression/src/aether.ts packages/progression/src/aether.test.ts && git commit -m "feat(progression): Aether economy rules"`

### Task 2: Tiered crates + focus pricing (`crateShop.ts`) and the crate shape

**Files:**
- Create: `packages/progression/src/crateShop.ts`
- Modify: `packages/progression/src/cosmetics.ts` (`CRATE_ROLL_VERSION`, `CrateRow`, `parseCrate`, `crateLabel`; around lines 96-103 and 812-893)
- Test: `packages/progression/src/crateShop.test.ts`; extend `packages/progression/src/cosmetics.test.ts`

**Interfaces:**
- Consumes: `COSMETICS`, `COSMETIC_RARITIES`, `COSMETIC_CATEGORIES`, `COSMETIC_CATEGORY_DEFS`, `CRATE_RARITY_ODDS`,
  `crateRarityFallback`, `eligibleCrateCosmetics` (cosmetics.ts); `CrateTier`, `AetherEconomy`,
  `DEFAULT_AETHER_ECONOMY` (Task 1).
- Produces (crateShop.ts):
```ts
export const CRATE_TIER_FLOOR: Readonly<Record<CrateTier, CosmeticRarity>>;
export const CRATE_TIER_LABELS: Readonly<Record<CrateTier, string>>; // 'Standard','Rare','Epic','Legendary','Ancient'
export const atOrAbove: (r: CosmeticRarity, floor: CosmeticRarity) => boolean;
export function tierOddsPercent(floor: CosmeticRarity): Record<CosmeticRarity, number>; // display, 1 decimal, 0 below floor
export function eligibleForCrate(owned: Iterable<string>, floor: CosmeticRarity, focus: readonly CosmeticCategory[] | null, catalog?: readonly CosmeticDef[]): CosmeticDef[]; // id-sorted
export function availableFocusCategories(owned: Iterable<string>, floor: CosmeticRarity, catalog?: readonly CosmeticDef[]): CosmeticCategory[]; // COSMETIC_CATEGORIES order
/** Sorted, de-duplicated focus; null when empty or when it covers every available category. 'bad' when it names a category not available. */
export function normalizeFocus(focus: readonly string[] | null, available: readonly CosmeticCategory[]): CosmeticCategory[] | null | 'bad';
export function focusFeePercent(ticked: number, available: number, eco?: AetherEconomy): number;
export interface CrateQuote { tier: CrateTier; floor: CosmeticRarity; focus: CosmeticCategory[] | null; crate: number; fee: number; total: number; remaining: number }
/** Null = sold out (nothing eligible) or a bad focus. `milestone` = the crate is free; only the fee is charged, at the Legendary tier. */
export function quoteCrate(input: { tier: CrateTier; focus: readonly string[] | null; owned: Iterable<string>; economy?: AetherEconomy; milestone?: boolean; catalog?: readonly CosmeticDef[] }): CrateQuote | null;
export function pickTieredCrateReward(eligible: readonly CosmeticDef[], floor: CosmeticRarity, u: number): CosmeticDef | null;
export function tieredCrateChances(eligible: readonly CosmeticDef[], floor: CosmeticRarity): Map<string, number>;
```
- Produces (cosmetics.ts):
  - `CRATE_ROLL_VERSION = 5`, with the doc comment line: "5 = rarity floor + optional category focus; floor common with no focus is version 4 draw for draw".
  - `CrateRow` gains `floor?: CosmeticRarity` (absent = common) and `focus?: CosmeticCategory[]`.
  - `export function milestoneLevelOfSource(source): number | null` for `/^milestone:([1-9][0-9]*0)$/`.
  - `export const isShopSource = (source: string | null | undefined): boolean`, which tests `/^shop:[0-9a-f-]{36}$/`.
  - `parseCrate` accepts a level-less crate whose source is a Gauntlet, milestone or shop source.
  - `crateLabel` returns:
    - milestone: `Level ${L} Legendary Crate`
    - shop crate: `${CRATE_TIER_LABELS[tier for floor]} Crate`
    - every other crate: unchanged.

**The pick algorithm** (the signature doesn't determine it, so it's spelled out here; the SQL mirrors it exactly):
```
S      = sum of CRATE_RARITY_ODDS[r] for r ≥ floor
x      = clamp(u, 0, 1) * S
walk r ≥ floor in rarity order with running lo; rolled = first r with x < lo + odds[r]; frac = (x - lo) / odds[r]
         (u = 1 → last rarity, frac = 1)
order  = crateRarityFallback(rolled).filter(r ≥ floor)
first non-empty bucket (eligible ∩ rarity r) → bucket[min(n-1, floor(frac * n))]; none → null
```

- [ ] **Step 1: Write the failing tests** in `crateShop.test.ts`:
  - `standard + no focus equals the version-4 pick draw for draw`: for 2,000 evenly spaced `u` in [0,1) and an owned set
    of the first 40 crate items, `pickTieredCrateReward(eligibleForCrate(owned,'common',null),'common',u)?.id` ===
    `pickCrateReward(eligibleCrateCosmetics(owned),u)?.id`.
  - `tier odds renormalize`: `tierOddsPercent('epic')` → `{common:0, rare:0, epic:64.7, legendary:26.5, ancient:8.8}`;
    `tierOddsPercent('rare')` → `{0, 47.7, 33.8, 13.8, 4.6}`; `tierOddsPercent('legendary')` → `{…, legendary:75, ancient:25}`.
  - `never falls below the floor`: with every crate item of rarity ≥ legendary owned,
    `pickTieredCrateReward(eligibleForCrate(owned,'legendary',null),'legendary',0.1)` is `null`.
  - `focus restricts categories`: every item from `eligibleForCrate([], 'epic', ['card_plate'])` has `category === 'card_plate'`
    and `rarity` in epic/legendary/ancient.
  - `available categories`: `availableFocusCategories([], 'ancient')` deep-equals the enabled categories that have an
    Ancient crate item, computed from `COSMETICS` in the test, so a catalog change doesn't break it. It contains no `title`,
    `emote` or `announcer`.
  - `focus fee`:
    - `focusFeePercent(1,8)` → 100
    - `focusFeePercent(2,8)` → 60
    - `focusFeePercent(7,8)` → 5
    - `focusFeePercent(8,8)` → 0
    - `focusFeePercent(0,8)` → 0
    - `focusFeePercent(5,5)` → 0
    - `focusFeePercent(4,5)` → 25
    - `focusFeePercent(8,10)` → 5
  - `quotes`:
    - `quoteCrate({tier:'epic', focus:['card_plate'], owned:[]})` → `crate 400, fee 400, total 800`
    - `quoteCrate({tier:'legendary', focus:['card_plate'], owned:[], milestone:true})` → `crate 0, fee 600, total 600`
    - `quoteCrate({tier:'standard', focus:null, owned:[]})` → `total 100`, `remaining === eligibleCrateCosmetics([]).length`
    - ticking every available category returns `focus: null, fee: 0`
  - `bad focus is refused`: `normalizeFocus(['title'], availableFocusCategories([], 'ancient'))` → `'bad'`;
    `quoteCrate({tier:'ancient', focus:['title'], owned:[]})` → `null`; `normalizeFocus(['emote','emote'], all)` → `['emote']`.
  - `sold out`: with every crate item owned, `quoteCrate({tier:'standard', focus:null, owned: allIds})` → `null`.
- [ ] **Step 2: Extend `cosmetics.test.ts`:** `parseCrate` accepts:
  - `{crateId, earnedLevel:null, state:'sealed', source:'milestone:20', floor:'legendary'}`, where `crateLabel` gives `'Level 20 Legendary Crate'`
  - `source:'shop:<uuid>'` with `floor:'epic'`, labelled `'Epic Crate'`
  - and it still rejects `source:'milestone:15'`.
- [ ] **Step 3: Run them and confirm they fail.** `npx vitest run packages/progression/src/crateShop.test.ts packages/progression/src/cosmetics.test.ts` → FAIL.
- [ ] **Step 4: Implement `crateShop.ts` and the `cosmetics.ts` changes.** `parseCrate` reads `floor` from
  `o.floor ?? o.floor_rarity` and `focus` from `o.focus ?? o.focus_categories`. It drops unknown values and omits
  both keys when they're absent, so old crates keep their exact shape.
- [ ] **Step 5: Run them and confirm they pass.** Same command → PASS. Then run `npx vitest run packages/progression` → PASS (no regressions).
- [ ] **Step 6: Commit.** `git commit -m "feat(progression): tiered crates, focus pricing and the version-5 roll"`

### Task 3: The SQL: wallet, config, tiered pick, `buy_crate`, focused `open_crate`

**Files:**
- Create: `supabase/migrations/2026-10-18-aether.sql` (sections 0–10 below; Task 4 adds 11–14)
- Test: `packages/progression/src/aether.db.test.ts`

**Interfaces:**
- Consumes: the tables and functions of every earlier progression migration.
- Produces (SQL; all functions are service-role only unless marked public-read):
  0. Header block in the house style: paste order (after `2026-10-17-versus-open-rooms.sql`, because it replaces
     `settle_progression` from `2026-10-14-versus-progression.sql`), what it replaces, the deploy order, and
     idempotence.
  1. `progression_config.aether_enabled boolean not null default false`.
  2. `aether_config (id int primary key check (id = 1), economy jsonb not null, updated_at timestamptz)`.
     - Public read (`select` to anon + authenticated).
     - Seeded `on conflict do nothing` with the exact JSON of `DEFAULT_AETHER_ECONOMY`, keys camelCase as in TS.
  3. `aether_wallets (user_id uuid primary key references auth.users on delete cascade, balance int not null default 0 check (balance >= 0), updated_at timestamptz)`.
     Owner-only read (RLS `auth.uid() = user_id`).
  4. `aether_ledger (id bigserial primary key, user_id uuid not null, delta int not null, balance_after int not null check (balance_after >= 0), reason text not null check (reason in ('ranked','versus','gauntlet','crate_purchase','crate_focus','grant')), source_id text not null, created_at timestamptz default now(), unique (user_id, reason, source_id))`.
     Owner-only read.
  5. `aether_apply(p_user uuid, p_delta int, p_reason text, p_source text) returns int`, internal.
     - Inserts the ledger row `on conflict do nothing`. A replay changes nothing and returns the current balance.
     - Otherwise it upserts the wallet.
     - It raises `insufficient_aether` when the result would go below 0. The caller already holds the per-user lock.
  6. `loot_crates` gains:
     - `floor_rarity text not null default 'common' check (floor_rarity in (…5 rarities…))`
     - `focus_categories text[]` (null = unfocused)
     - `price_paid int`

     Also:
     - Re-create `loot_crates_transition_guard`: `floor_rarity` is identity (immutable). `focus_categories` may
       change only in the sealed → opened update.
     - Re-create `progression_crate_json`, adding `'floor', c.floor_rarity, 'focus', to_jsonb(c.focus_categories)`.
  7. `progression_tiered_crate_pool(p_user uuid, p_floor text, p_focus text[]) returns table (pool_cosmetic_id text, pool_rarity text)`:
     today's pool filter, plus rarity ≥ floor, plus `(p_focus is null or c.category = any(p_focus))`, id order `collate "C"`.
  8. `progression_tiered_crate_pick(p_user uuid, p_draw double precision, p_floor text, p_focus text[]) returns text`:
     the Task 2 algorithm, with the odds constants named `c_odds_common` … `c_odds_ancient` exactly as in
     `progression_crate_pick`.
  9. `aether_quote(p_user uuid, p_tier text, p_focus text[], p_milestone boolean) returns jsonb` =
     `{tier, floor, focus, crate, fee, total, remaining}`, read from `aether_config`.
     - It raises `bad_tier`, `bad_focus` or `sold_out`.
     - Mirror of `quoteCrate`, including `normalizeFocus` (sort `collate "C"`, distinct, null when it covers
       every available category).
  10. `buy_crate(p_user uuid, p_tier text, p_focus text[], p_expected_total int, p_request_id uuid) returns jsonb`, in this order:
      1. Validate.
      2. Take the advisory lock `hashtextextended('progression:' || p_user::text, 0)`.
      3. If a crate with `source = 'shop:' || p_request_id` exists, return its open result with
         `status 'already_opened'` and no charge.
      4. Raise `crates_disabled` / `aether_disabled` when a switch is off.
      5. Call `aether_quote`. When `total <> p_expected_total`, raise `price_changed`.
      6. `aether_apply(-total, 'crate_purchase', p_request_id::text)`.
      7. Insert the crate (`earned_level null`, `source 'shop:'||id`, floor, focus, `price_paid`).
      8. Roll with `progression_tiered_crate_pick(..., random(), floor, focus)`, insert ownership, mark it opened
         with `roll_version = 5`.
      9. Return `open_crate`'s JSON keys plus `'aether', <balance>` and `'quote', <quote>`.

  And `open_crate(p_user uuid, p_crate_id uuid, p_focus text[] default null, p_expected_fee int default null)`:
  - Run `drop function if exists public.open_crate(uuid, uuid)` first, so the 2-argument named call from an
    older deployed Edge Function resolves to this one.
  - Behaves exactly as today, plus:
    - The roll uses the crate's floor and focus through the tiered pick. `roll_version = 5`.
    - A non-null `p_focus` is allowed only on a `milestone:%` crate (else `focus_not_allowed`). It charges
      `aether_quote(…, 'legendary', p_focus, true).total` as `crate_focus` with `source_id = crate_id`, after a
      `price_changed` check against `p_expected_fee`. It stores the normalized focus on the row.
    - The pool check uses the tiered pool, so a floored crate with nothing left answers `pool_exhausted`, sealed
      and uncharged.
  - The result JSON gains `'aether', <balance>`.

- [ ] **Step 1: Write the failing PGlite tests** in `aether.db.test.ts`.
  - **Setup:**
    - Copy the `STUB` from `versusProgression.db.test.ts`.
    - `FILES` = `['2026-09-27-account-progression.sql', '2026-09-28-progression-crates.sql', '2026-09-28-progression-skins.sql', '2026-09-28-achievements.sql', '2026-09-29-crate-fixed-rarity-odds.sql', '2026-09-29-crate-uniform-within-rarity.sql', '2026-09-29-gauntlet-progress.sql', '2026-10-02-ancient-rarity.sql', '2026-10-03-placement-xp.sql', '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql', '2026-10-14-versus-progression.sql', '2026-10-18-aether.sql']`.
    - Seed the catalog with `sync_cosmetic_catalog(catalogSyncPayload(), catalogHash(...))`.
    - Set `crates_enabled = true, aether_enabled = true`.
    - Helper `grant(user, n)` = `select aether_apply($1, $2, 'grant', gen_random_uuid()::text)`.
  - **Tests:**
    - `the seeded config is the TS default`: `select economy from aether_config` deep-equals `DEFAULT_AETHER_ECONOMY`.
    - `tiered pick equals the TS pick draw for draw`: for floors `common`, `epic`, `legendary`, focus null and
      `['card_plate']`, and 200 draws each, the SQL pick equals `pickTieredCrateReward(eligibleForCrate(owned,floor,focus),floor,u)`.
    - `buy charges, opens and records`: grant 400 → `buy_crate(u,'epic',null,400,rid)`. Then:
      - status is `opened`
      - `aether` is 0
      - the reward rarity is ≥ epic
      - the ledger has one `crate_purchase` row with delta -400
      - `loot_crates.price_paid` is 400
    - `buy_crate is idempotent per request id`: the same call again → `already_opened`, same `rewardId`,
      balance unchanged, still one ledger row.
    - `exact balance buys, one short refuses`: grant 799 → buying epic `['card_plate']` at 800 raises
      `insufficient_aether`; there are 0 new crates and the balance is 799. Grant 1 → it succeeds and the balance is 0.
    - `stale price is refused`: `update aether_config set economy = jsonb_set(economy,'{cratePrice,epic}','500')`.
      Buying epic with expected 400 raises `price_changed`, with no ledger row. Restore the config afterwards.
    - `bad focus is refused`: `buy_crate(u,'ancient',array['title'],…)` raises `bad_focus`.
    - `never falls below the floor`: own every legendary+ crate item (insert into `player_cosmetics`). Then:
      - `buy_crate(u,'legendary',null,600,rid)` raises `sold_out`
      - a sealed `milestone:10` crate (`floor_rarity 'legendary'`) opens as `pool_exhausted`
      - the balance is unchanged
    - `milestone focus charges the Legendary fee`: grant 600, then `open_crate(u, milestoneCrate, array['card_plate'], 600)`.
      The reward category is `card_plate`; the balance is 0; there is one `crate_focus` row. A non-milestone crate with
      a focus raises `focus_not_allowed`.
    - `old crates open as before`: a sealed level crate (floor common, focus null) opens with a reward from the full
      pool. The 2-argument call `open_crate(u, id)` works.
    - `switch off`: with `aether_enabled = false`, `buy_crate` raises `aether_disabled`.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/progression/src/aether.db.test.ts` → FAIL (file or function missing).
- [ ] **Step 3: Write sections 0–10 of `2026-10-18-aether.sql`** as specified, with grants (revoke from public/anon/authenticated, grant to service_role) for every function, and `select` grants on `aether_config`.
- [ ] **Step 4: Run the tests and confirm they pass.** Same command → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(sql): Aether wallet, config, tiered pick, buy_crate and focused open_crate"`

### Task 4: The SQL: earning (settlement + Gauntlet), profile/result JSON, rollout

**Files:**
- Modify: `supabase/migrations/2026-10-18-aether.sql` (append sections 11–14)
- Modify: `packages/progression/src/rules.ts` (`ProgressionResult.aether`, `ProgressionProfile.aether`, parsers)
- Modify: `packages/progression/src/gauntlet.ts` (`GauntletClearResult.aether: number`, parser)
- Test: extend `packages/progression/src/aether.db.test.ts`; extend `packages/progression/src/rules.test.ts`, `gauntlet.test.ts`

**Interfaces:**
- Consumes: Task 3's `aether_apply`, `aether_config`; Task 1's `aetherForSettlement`, `milestoneLevelsThrough`.
- Produces:
  - **TS:**
    - `ProgressionResult.aether: AetherBreakdown | null` (null = Aether is off, or a pre-Aether server)
    - `ProgressionResult.aetherBalance: number | null`
    - `ProgressionProfile.aether?: number`
    - `GauntletClearResult.aether: number` (0 when none)
  - **SQL section 11:** `progression_results` gains `aether_base int not null default 0, aether_placement int not
    null default 0, aether_total int not null default 0, aether_on boolean not null default false`.
    `progression_result_json` is re-created with keys `'aether', case when r.aether_on then jsonb_build_object('base',…,'placement',…,'total',…) end`
    and `'aetherBalance'`. Read the latest body in `2026-09-28-achievements.sql` and add only these keys.
  - **SQL section 12:** `settle_progression` is re-created as the full `2026-10-14-versus-progression.sql` body plus:
    - **New constants:** none. The numbers come from `select economy from aether_config where id = 1`, read once
      into `v_eco jsonb`.
    - **Step 7a (after XP):** when `aether_enabled`, set `v_ae_base` / `v_ae_place` per `aetherForSettlement`:
      - ranked with a valid placement: `rankedBase` + `rankedPlacementBonus[placement-1]`
      - versus: `versusComplete` + (`versusWin` if placement 1)
      - else 0

      Then when the total > 0, call `aether_apply(p_user, total, p_mode, p_run_id)`.
    - **Step 9b:** when `aether_enabled`, insert:
      - the Welcome Crate (`earned_level 1`) only when enrolling, and
      - one crate per `milestoneLevelsThrough(v_l1, milestoneEvery)` as `(earned_level null, source 'milestone:'||L,
        floor_rarity 'legendary', source_id p_mode||':'||p_run_id) on conflict (user_id, source) where source is
        not null do nothing`.

      Otherwise use today's per-level insert, unchanged. `v_crate_ids` collects both kinds.
    - **Step 10:** the result row writes the four Aether columns.
    - The header comment says every other line is byte-for-byte the 2026-10-14 writer.
  - **SQL section 13:** `record_gauntlet_clear` is re-created. When `aether_enabled`:
    - a first clear calls `aether_apply(p_user, gauntletFirstClear, 'gauntlet', 'gauntlet:'||p_stage)`
    - it inserts **no** crate (`crate_granted` stays false)
    - it returns `{status:'first_clear', crate:null, aether: <amount>}`

    Otherwise it behaves as today, plus `aether: 0`. `parseGauntletClearResult` must now accept a first clear with
    `crate: null` when `aether > 0`.
  - **SQL section 13b:** `progression_profile_json` is re-created as the skins-file body plus
    `'aether', coalesce((select w.balance from aether_wallets w where w.user_id = p.user_id), 0)`.
  - **SQL section 14:** `aether_rollout() returns jsonb` (service role). It inserts every `milestone:<L>` crate for
    every profile with `account_level >= 10`, `on conflict do nothing`, sets `aether_enabled = true`, and returns
    `{accounts, crates}`. It's idempotent. The owner runbook line at the bottom of the file is commented out:
    `-- select public.aether_rollout();`.

- [ ] **Step 1: Write the failing tests.**
  - **PGlite**, in `aether.db.test.ts`:
    - `ranked settlement pays Aether`: insert a `rank_results` row at placement 1, then settle. Then:
      - `result.aether` = `{base:50, placement:140, total:190}`
      - the wallet holds 190
      - a replayed settlement (`deduped`) leaves the wallet at 190
    - `practice pays nothing`: a practice game at placement 1 → `result.aether.total === 0` and no ledger row.
    - `versus pays 25 + 45`: winner 70, loser 25.
    - `milestones replace level crates`: take an account from 0 XP to Level 21 in one settlement. The crates are
      the Welcome Crate plus `milestone:10` and `milestone:20`, both `floor 'legendary'`. There are no other level
      crates, and `cratesAwarded` is 3.
    - `aether off keeps today's crates`: with `aether_enabled = false`, the same jump gives 21 level crates, a
      `null` `result.aether`, and an empty wallet.
    - `gauntlet first clear pays 200 once`: the first clear returns `aether 200, crate null`; the replay returns
      `already_cleared`. The wallet holds 200.
    - `rollout backdates milestone crates idempotently`: a Level 34 profile, created with `aether_enabled = false`,
      gets exactly `milestone:10/20/30` from `aether_rollout()`. Running it twice still leaves 3.
    - `profile JSON carries the balance`: `progression_profile_json(u)->>'aether'` equals the wallet balance.
  - **TS:**
    - `rules.test.ts`: `parseProgressionResult` keeps `aether` when it's present and gives `null` when it's absent.
      `parseProgressionProfile` keeps `aether`.
    - `gauntlet.test.ts`: `parseGauntletClearResult({status:'first_clear', crate:null, aether:200})` →
      `{status:'first_clear', crate:null, aether:200}`. A first clear with neither a crate nor Aether → `null`.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/progression/src/aether.db.test.ts packages/progression/src/rules.test.ts packages/progression/src/gauntlet.test.ts` → FAIL.
- [ ] **Step 3: Implement sections 11–14 and the TS parser changes.**
- [ ] **Step 4: Run them and confirm they pass.** Same command → PASS. Then run `npx vitest run packages/progression` → PASS. The older db tests load older migrations, so they must be unaffected.
- [ ] **Step 5: Commit.** `git commit -m "feat(sql): Aether from Ranked, Versus and Gauntlet; milestone Legendary crates; rollout backfill"`

### Task 5: Edge Function handlers + parity

**Files:**
- Modify: `packages/progression/src/inventory.ts`, `packages/progression/src/server.ts`, `packages/progression/src/gauntlet.ts` (handler body passes `aether` through)
- Modify: `packages/progression/src/sharedArtifact.ts` (add `{ source: 'aether.ts', target: 'progressionAether.ts' }`, `{ source: 'crateShop.ts', target: 'progressionCrateShop.ts' }`), `packages/progression/src/index.ts` (`export * from './aether'; export * from './crateShop';`)
- Generated: `supabase/functions/_shared/progression*.ts` via `npm run progression:shared`
- Test: extend `inventory.test.ts`, `server.test.ts`

**Interfaces:**
- Produces:
  - `InventoryRequest` gains:
    - `{ action: 'buy_crate'; tier: CrateTier; focus: CosmeticCategory[] | null; expectedTotal: number; requestId: string }`
    - `open_crate` gains optional `focus?: CosmeticCategory[] | null; expectedFee?: number`
  - `handleInventory` maps `buy_crate` → rpc `buy_crate` `{p_user, p_tier, p_focus, p_expected_total, p_request_id}`, and
    passes `p_focus` / `p_expected_fee` on `open_crate` only when focus is non-null.
  - `INVENTORY_ERROR_STATUS` adds:
    - `bad_tier: 400`, `bad_focus: 400`
    - `price_changed: 409`, `insufficient_aether: 409`, `sold_out: 409`, `focus_not_allowed: 409`, `aether_disabled: 409`
  - `export interface BuyCrateResult extends OpenCrateResult { aether: number; quote: CrateQuote }` and
    `parseBuyCrateResult(v): BuyCrateResult | null`, both in `crateShop.ts`.
  - `OpenCrateResult` gains `aether?: number` (cosmetics.ts parser keeps it when it's an integer ≥ 0).
  - `settlementParity`: when `result.aether !== null`:
    - (a) `aether.total === aether.base + aether.placement`, and Practice/Tutorial have total 0
    - (b) `cratesAwarded ≤ milestoneLevelsThrough(after.level).length + 1`

    The level-crate rule (`gained ≤ cratesAwarded ≤ gained + 1`) applies only when `result.aether === null`. It
    doesn't compare amounts with `DEFAULT_AETHER_ECONOMY`: the live config may be retuned.

- [ ] **Step 1: Write the failing tests.**
  - **`inventory.test.ts`:**
    - `validateInventoryBody` accepts `{action:'buy_crate', tier:'epic', focus:['card_plate'], expectedTotal:800, requestId:<uuid>}`.
    - It rejects these with the error shown:
      - `tier:'mythic'` → `bad_tier`
      - `focus:['nope']` → `bad_focus`
      - `expectedTotal:-1` → `bad_price`
      - `requestId:'x'` → `bad_request_id`
    - `handleInventory` maps a `sold_out` SQL error to `409 {error:'sold_out'}`.
  - **`server.test.ts`:**
    - `settlementParity` is true for an Aether result with 3 crates at Level 21.
    - It is false for an Aether result reporting 5 crates at Level 21.
    - It is false when `aether.total !== base + placement`.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/progression/src/inventory.test.ts packages/progression/src/server.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Add `bad_price: 400` and `bad_request_id: 400` to the status map. `buy_crate` has the same 401 guard as the other actions. Guests are refused by the client gate, not here: the server still sells to anonymous accounts. That matches `open_crate` today.
- [ ] **Step 4: Run `npm run progression:shared`**, then `npx vitest run packages/progression` → PASS (including `sharedArtifact.test.ts`).
- [ ] **Step 5: Commit**, including the generated `_shared` files. `git commit -m "feat(progression): buy_crate + focused open in the inventory function; Aether-aware parity"`

### Task 6: schema.sql, SQL parity, the oracle

**Files:**
- Modify: `schema.sql` (append the full `2026-10-18-aether.sql` verbatim)
- Modify: `packages/progression/src/sqlParity.test.ts`
- Modify: `packages/rules/src/registry/approved/foundation.ts` (append rules at the end of the array; amend `R-PROG-CRATE-01`)
- Modify: `docs/GAME-RULES.md` (the "Account Level" section, around line 469)

- [ ] **Step 1: Extend `sqlParity.test.ts`.**
  - Read `const aether = readFileSync(.../2026-10-18-aether.sql)`. Put `defines(aether) ? aether :` first in `fnBody`'s chain.
  - Add these tests:
    - `aether_config seed equals DEFAULT_AETHER_ECONOMY`: parse the JSON literal in the seed insert.
    - `tiered pick odds constants equal CRATE_RARITY_ODDS`, via `constOf(fnBody('progression_tiered_crate_pick'), 'c_odds_epic')` etc.
    - `open_crate and buy_crate record roll version CRATE_ROLL_VERSION`.
    - `schema.sql carries the Aether migration verbatim and ends with the same settle_progression, open_crate, buy_crate and record_gauntlet_clear`.
  - Update the existing "schema.sql ends with the same pick and open_crate" test, which now finds the Aether `open_crate`.
- [ ] **Step 2: Run it and confirm it fails.** `npx vitest run packages/progression/src/sqlParity.test.ts` → FAIL (schema.sql lacks the block).
- [ ] **Step 3: Append the migration to `schema.sql`.** Then run the same command → PASS.
- [ ] **Step 4: Update the oracle.**
  - **Add four rules** at the end of `foundation.ts`. Each rule's evidence includes:
    - an `owner-chat` quote from 2026-10-18 (e.g. "make a currency instead that you are awarded from playing the game"; "focusing shouldnt be added cost per extra category"; "levels 10, 20, and every 10th level from there you receive a legendary crate"; "yeah they can earn aether")
    - a `code` ref to `2026-10-18-aether.sql` + `aether.ts` / `crateShop.ts`

    Each rule uses `enforcement: { kind: 'scenario', refs: ['packages/progression/src/aether.db.test.ts', 'packages/progression/src/crateShop.test.ts'], lastVerifiedAt: '2026-10-18' }`.
  - **The four rules:**
    - `R-PROG-AETHER-01`: earning (Ranked base + placement, Versus, Practice/Tutorial 0, Gauntlet 200 on trust).
    - `R-PROG-AETHER-02`: the five tiers, their floors and prices, odds renormalized at/above the floor, never below it.
    - `R-PROG-AETHER-03`: the focus fee (fewer categories costs more; only available categories count; all
      available = free; sold out can't be bought).
    - `R-PROG-AETHER-04`: milestone Legendary crates every 10th level replace per-level crates; backdated at
      rollout; focusable at open for the Legendary fee.
  - **Amend `R-PROG-CRATE-01`'s `currentBehaviour`:** "Superseded by R-PROG-AETHER-04 once `aether_enabled` is on
    (2026-10-18); the Welcome Crate is kept."
- [ ] **Step 5: Update `docs/GAME-RULES.md`.** Add an "Aether and the Crate Shop" subsection under Account Level with the rules above in player terms, and mark the per-level crate rule as replaced.
- [ ] **Step 6: Run the oracle checks.** `npx vitest run packages/rules && npm run docbot:report -- --check` → PASS.
- [ ] **Step 7: Run the full gates.** `npm run typecheck && npm run lint && npm test && npm run build:web` → all green.
- [ ] **Step 8: Commit, push, open PR A.** `git commit -m "chore(progression): schema.sql + parity + oracle rules for Aether"`, then `git push -u origin feat/aether-engine` and `gh pr create`. The body includes the owner runbook:
  1. Paste `2026-10-18-aether.sql`.
  2. Deploy `submit-progression`, `progression-inventory` and `gauntlet-clear`.
  3. Leave `aether_enabled` off until PR B ships.
  4. Then run `select public.aether_rollout();`.

---

## PR B: client (branch `feat/aether-shop-ui`, based on PR A)

### Task 7: Remote + store

**Files:**
- Modify: `packages/ui/src/progression/progressionRemote.ts`, `packages/ui/src/progression/progressionStore.ts`
- Test: extend `packages/ui/src/progression/progressionStore.test.ts`

**Interfaces:**
- Produces:
  - **Remote:**
    - `fetchAetherEnabled(): Promise<boolean | undefined>`: same shape as `fetchCratesEnabled`, reading `aether_enabled`.
    - `fetchAetherEconomy(): Promise<AetherEconomy | undefined>`: reads `aether_config` row 1, through `parseAetherEconomy`.
    - `buyCrateRemote(req: { tier: CrateTier; focus: CosmeticCategory[] | null; expectedTotal: number; requestId: string }): Promise<InventoryOutcome<BuyCrateResult>>`.
    - `openCrateRemote(crateId: string, focus?: CosmeticCategory[] | null, expectedFee?: number)`.
    - `CRATE_COLUMNS` adds `source, floor_rarity, focus_categories`, keeping the existing retry-without-column
      fallback for an older server.
  - **Store:**
    - State: `aetherCapability: 'unknown' | 'on' | 'off'`, `economy: AetherEconomy` (initially `DEFAULT_AETHER_ECONOMY`).
    - `export const aetherVisible = (s) => cratesVisible(s) && s.aetherCapability === 'on'`.
    - `ProgressionMirror` (the store's persisted copy of the own profile, `mirror`) gains `aether?: number`.
      `adoptProgressionProfile` copies `profile.aether` into it.
    - `export const aetherBalance = (s: Pick<ProgressionStore, 'mirror'>): number => mirrorFor(currentUserId(), s.mirror)?.aether ?? 0`.
    - `export type BuyCrateOutcome = { status: 'ok'; result: BuyCrateResult } | { status: 'error'; reason: string }`.
    - `export async function buyCrate(tier, focus, expectedTotal): Promise<BuyCrateOutcome>`: it generates
      `requestId` with `crypto.randomUUID()` once per call, adopts the profile, and merges the crate.
    - `openCrate(crateId, focus?, expectedFee?)`.
    - `export async function refreshEconomy(): Promise<void>`, called with the capability probes.

- [ ] **Step 1: Write the failing tests** in `progressionStore.test.ts`, with the remote mocked as the existing tests do:
  - `buyCrate adopts the new balance`: a mocked `{status:'ok', value:{…aether: 0}, profile:{…aether: 0}}` → `aetherBalance` is 0 and `crateList` holds the opened crate.
  - `price_changed refreshes the economy`: a mocked `{status:'error', reason:'price_changed'}` → `fetchAetherEconomy` is called once, and the outcome is returned unchanged.
  - `one request id per buy`: two `buyCrate` calls send two different `requestId`s.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/ui/src/progression/progressionStore.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Probe `aetherCapability` wherever `cratesCapability` is probed.
- [ ] **Step 4: Run them and confirm they pass.** Same command → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(ui): Aether capability, economy and buyCrate in the progression store"`

### Task 8: Post-game "+N Aether"

**Files:**
- Modify: `packages/ui/src/progression/ProgressionPostgame.tsx`, `packages/ui/src/progression/progressionFormat.ts`, `packages/ui/src/styles.css`
- Test: extend `packages/ui/src/progression/ProgressionPostgame.test.tsx`

**Interfaces:**
- Consumes: `ProgressionResult.aether` (Task 4).
- Produces:
  - When `result.aether && result.aether.total > 0`, a `<div className="acctxp-aether" aria-label="Aether earned">`
    appears below the XP lines. It contains:
    - a headline `+{total} Aether`
    - a line `Played +{base}`
    - when placement > 0, a line `{ordinal(placement)} place +{placement}`
  - When `result.aether` is null, nothing renders.

- [ ] **Step 1: Write the failing tests:**
  - `shows Aether earned`: a result with `aether {50,140,190}` and placement 1 renders `+190 Aether`, `Played +50` and `1st place +140`.
  - `no Aether block when off`: `aether: null` renders no `Aether earned` region.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/ui/src/progression/ProgressionPostgame.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
  - Reuse the `acctxp-line` markup (styles live in `packages/ui/src/styles.css` near line 12789). Add
    `.acctxp-aether` there, not in collection.css.
  - Add `export const aetherText = (n: number): string` (returns e.g. "+190 Aether") and
    `export const placeOrdinal = (p: number): string` ('1st', '2nd', '3rd', '4th'…'8th') to `progressionFormat.ts`.
  - The block appears with the panel's `done` phase, an opacity fade only.
- [ ] **Step 4: Run them and confirm they pass.** Same command → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(ui): post-game Aether earned"`

### Task 9: `CrateShop` (the two-step picker)

**Files:**
- Create: `packages/ui/src/progression/CrateShop.tsx`
- Modify: `packages/ui/src/progression/collection.css` (a `colls-shop-*` block)
- Test: `packages/ui/src/progression/CrateShop.test.tsx`

**Interfaces:**
- Consumes:
  - `quoteCrate`, `availableFocusCategories`, `tierOddsPercent`, `CRATE_TIERS`, `CRATE_TIER_FLOOR`,
    `CRATE_TIER_LABELS`, `COSMETIC_CATEGORY_DEFS`, `RARITY_LABELS` (`@game/progression`)
  - the store's `economy`, `aetherBalance`, owned cosmetics (the same owned-id source `CollectionScreen` uses),
    `buyCrate`, `openCrate`
- Produces:
```ts
export type CrateShopMode = { kind: 'shop' } | { kind: 'milestone'; crate: CrateRow };
export interface CrateShopProps {
  mode: CrateShopMode;
  guest: boolean;
  /** A guest's spend: the caller shows CrateSignInGate. */
  onGuest: () => void;
  /** Hand the theatre a one-crate queue whose `open` resolves to the server's answer. */
  onOpen: (item: CrateQueueItem, open: (crateId: string) => Promise<CrateOpenOutcome>) => void;
}
export function CrateShop(props: CrateShopProps): JSX.Element;
```
- **Behaviour:**
  - **Step 1, tier:** five Gem-plate buttons with `aria-pressed`, each showing its label and price. Milestone mode
    hides this row, because the tier is fixed at Legendary.
  - **Step 2, focus:** a chip per enabled category in `COSMETIC_CATEGORIES` order.
    - Chips not in `availableFocusCategories` are `disabled` with `aria-description="Nothing left to find here"`.
    - Toggling a chip only changes local state.
  - **Quote line:**
    - the crate name (milestone: `crateLabel(crate)`; shop: `${tier label} Crate`, with ` · ${categories}` when focused)
    - the odds (`tierOddsPercent`, rarities above 0 only, e.g. "Epic 64.7% · Legendary 26.5% · Ancient 8.8%")
    - `{remaining} left to find`
  - **Buy button** (`◆ {total}`):
    - Disabled with "Need {total - balance} more Aether" when the balance is short.
    - Disabled with "Sold out" when the quote is null.
    - In milestone mode with no focus, the button reads "Open" and charges nothing.
  - **On click:**
    - A guest → `onGuest()`.
    - Shop mode → `await buyCrate(tier, focus, quote.total)`. On `ok` → `onOpen({crateId, earnedLevel:null, source}, () => Promise.resolve({status:'ok', result}))`.
      The purchase completes before the theatre opens, so price errors stay in the shop. The button shows a
      pressed "Buying…" state while the request runs.
    - Milestone mode → `onOpen(item, (id) => openCrate(id, focus, quote.fee))`.
  - **Error copy:**
    - `price_changed` → "Prices just changed. Check the new price."
    - `insufficient_aether` → "Not enough Aether."
    - `sold_out` → "Nothing left to find in this crate."
    - anything else → "Couldn't buy that crate. Try again."
  - **Performance:** the quote and chances are `useMemo`'d on `(tier, focus, owned, economy)`; there are no layout
    reads; the component owns its state, so toggling a chip never re-renders the Collection grid.

- [ ] **Step 1: Write the failing tests** in `CrateShop.test.tsx` (RTL, store seeded as `Crates.test.tsx` does):
  - `prices follow the picks`: with balance 2000, Epic shows `◆ 400`. Ticking Card Plates shows `◆ 800`, and also
    ticking Heroes shows `◆ 640`.
  - `sold-out chip is disabled`: on the Ancient tier, the Titles chip is `disabled`.
  - `short balance disables Buy`: with balance 300, Epic reads "Need 100 more Aether".
  - `guest is gated`: with `guest` set, clicking Buy calls `onGuest`, and `buyCrate` is not called.
  - `buy then open`: a mocked `buyCrate` → ok calls `onOpen` once, with the bought crate's id.
  - `milestone mode`: there's no tier row. With no focus the button reads "Open"; ticking Card Plates reads `◆ 600`.
  - `price_changed shows the message`: the mocked error renders "Prices just changed. Check the new price."
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/ui/src/progression/CrateShop.test.tsx` → FAIL.
- [ ] **Step 3: Implement.** Styling follows the existing `colls-panel` look and the Gem plate. There are no `title=` attributes and no bare `cursor: pointer`.
- [ ] **Step 4: Run them and confirm they pass.** Same command → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(ui): the Crate Shop picker"`

### Task 10: Wire it into Collection and the Gauntlet end screen

**Files:**
- Modify: `packages/ui/src/progression/CollectionScreen.tsx` (`CrateBay` at lines 658-700, `begin` at ~234, theatre mount at ~402)
- Modify: `packages/ui/src/gauntlet/GauntletEndScreen.tsx` (crate block at lines 49-60) and wherever `gauntletReward` is set (grep `gauntletReward`)
- Test: extend `packages/ui/src/progression/CollectionScreen.test.tsx`, `packages/ui/src/gauntlet/GauntletEndScreen.test.tsx`

**Interfaces:**
- Consumes: `CrateShop` (Task 9), `aetherVisible`/`aetherBalance` (Task 7), `milestoneLevelOfSource` (Task 2), `GauntletClearResult.aether` (Task 4).
- **Behaviour when `aetherVisible`:**
  - The Collection header shows a wallet chip, `◆ {balance} Aether` (`aria-label="Aether balance"`).
  - `CrateShop mode={{kind:'shop'}}` mounts as its own panel beside the crate bay. Its `onOpen` sets
    `theatre = { queue:[item], openAll:false }` and passes `open` to `CrateOpener`'s existing `open` prop.
  - In the bay, Open on a sealed `milestone:` crate swaps the bay panel to `CrateShop mode={{kind:'milestone', crate}}`
    with a Back button, instead of starting the theatre. Open all opens every sealed crate unfocused, as today.
  - The bay's "Your next crate comes at Level N" uses the next multiple of `economy.milestoneEvery` above the current level.
  - The odds line under the bay becomes the bay's first sealed crate's tier odds.
  - The New rewards pop-up's Open is unchanged: milestone crates open unfocused there.
- **When Aether is off:** everything renders exactly as today.
- **Gauntlet end screen:** when the clear result's `aether > 0`, show `+{aether} Aether` in the reward slot instead of
  the crate. The sign-in note for guests becomes "Sign in to earn Aether from Gauntlet clears." only when Aether is on.

- [ ] **Step 1: Write the failing tests:**
  - `CollectionScreen.test.tsx`:
    - `wallet chip shows the balance`
    - `the shop mounts when Aether is on`
    - `a milestone crate's Open shows the focus step`: clicking Open on a `milestone:10` crate renders the milestone-mode shop, not the theatre
    - `Aether off renders today's bay`: the snapshot of the bay text is unchanged
  - `GauntletEndScreen.test.tsx`: `first clear with Aether shows +200 Aether`.
- [ ] **Step 2: Run them and confirm they fail.** `npx vitest run packages/ui/src/progression/CollectionScreen.test.tsx packages/ui/src/gauntlet/GauntletEndScreen.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and confirm they pass.** Same command → PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(ui): Crate Shop and Aether wallet in Collection; Gauntlet pays Aether"`

### Task 11: Docs, patch notes, gates, PR

**Files:**
- Create: `docs/devlog/2026-10-18-aether-crate-shop.md`
- Modify: `packages/ui/src/patchNotes.ts` (prepend to the newest block's date, or open a new dated block, per its no-duplicates rule)

- [ ] **Step 1: Write the devlog entry.** Cover:
  - what shipped
  - the owner decisions, quoted
  - the runbook: paste SQL → deploy 3 functions → ship client → `select public.aether_rollout();`
  - the one-line SQL to retune the economy: `update aether_config set economy = jsonb_set(economy, '{cratePrice,epic}', '450') where id = 1;`
  - the accepted Gauntlet trust risk
- [ ] **Step 2: Add the patch-notes entry**, tagged `Systems`, with summary text "Crates are now bought with Aether, a new currency you earn from Ranked and Versus games." Its `details` list:
  - the earning amounts
  - the five crate prices
  - how focusing works and its fee
  - milestone Legendary crates every 10 levels, backdated for existing players
  - sealed crates you already have still open as before
- [ ] **Step 3: Run the full gates.** `npm run typecheck && npm run lint && npm test && npm run build:web` → all green.
- [ ] **Step 4: Check the performance budget.** On the prod build (`npm run build:web` then preview), open Collection and toggle focus chips quickly. Confirm no long tasks over 50 ms in the DevTools Performance panel, per `docs/performance.md`.
- [ ] **Step 5: Commit, push, open PR B** with base `feat/aether-engine` (retarget to `main` once PR A merges). `git commit -m "docs: Aether + Crate Shop devlog and patch notes"`, then `git push -u origin feat/aether-shop-ui` and `gh pr create --base feat/aether-engine`.
