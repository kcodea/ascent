# 2026-09-28 — Level crates and the cosmetic catalog (15 titles)

The second account progression slice (handoff Phase 1 crates + Phase 2), on top of the MVP
(`2026-09-27-account-progression-mvp.md`). Owner 2026-09-27: "let's just do 15 titles to start. we'll start
creating assets for the catalog as well." Rules: `docs/GAME-RULES.md` "Account Level"; oracle R-PROG-CRATE-01,
R-PROG-CRATE-02, R-PROG-CATALOG-01 (R-PROG-TITLE-01 reworded: Alpha Tester is the Level 2 milestone).

**Nothing changes for players until the owner runs the runbook below.** The client ships dark: a second probe reads
`progression_config.crates_enabled`, which does not exist until the migration runs, so no crate UI shows.

## What was built

- **Catalog as data** (`packages/progression/src/cosmetics.ts`): every handoff §5.3 category with its §5.4 weight
  and a feature flag (only `title` on), rarity weights 55 / 30 / 12 / 3, the 15 crate titles + Alpha Tester (a
  `level_milestone`, never in a crate), and the roll: `eligibleCrateCosmetics` (active, crate-sourced, enabled,
  not owned, sorted by id) and `pickCrateReward` (one integer draw over the cumulative weights of what remains,
  never a rarity first). `rules.ts` now derives `TITLES` from the catalog and gains `cratesForSettlement`.
- **SQL** (`supabase/migrations/2026-09-28-progression-crates.sql`, appended to `schema.sql`):
  `cosmetic_categories` + `cosmetic_catalog` (seeded from the TS, public read), `player_cosmetics` (ownership of
  every category, unique per user + item, public read; every owned title mirrored into the MVP's `player_titles`
  for older clients), `loot_crates` (unique per user + level, owner-only read, a trigger makes an opened crate
  immutable, a partial unique index forbids the same reward twice), `cosmetic_loadouts` (schema-ready, empty),
  `progression_results.crate_ids`, `progression_config.crates_enabled`. `settle_progression` is replaced with the
  same XP rules (CI checks every constant is unchanged) plus step 9b: one crate per newly reached level, plus the
  Welcome Crate when the settlement enrolls the account. `open_crate` and `equip_title` are new, SECURITY DEFINER,
  service role only, each under the same per-user advisory lock as the settlement. Backfill: owned titles copied
  into `player_cosmetics`; enrolled accounts get crates for Levels 1 to their level. Every statement is keyed, so
  a re-run changes nothing.
- **Edge Function** `progression-inventory` (new): `{ action: 'open_crate', crateId }` and
  `{ action: 'equip_title', titleId }`. Logic in `packages/progression/src/inventory.ts`, generated into
  `_shared/progressionInventory.ts` (+ `_shared/progressionCosmetics.ts`). Returns `parity: false` when the SQL
  hands out an item the TS catalog says no crate may give.
- **Client**: `progressionRemote` reads owned titles from `player_cosmetics` (falls back to `player_titles`
  before the migration), probes `crates_enabled`, reads own crates, calls the new function. The store gains
  `cratesCapability`, `crateList`, `openCrate`, `equipTitle`. `CrateOpener` (the reveal), a "Crate earned" row
  with an optional Open button under the post-game XP panel, and a **Collection** overlay behind a button on your
  own Career's Account Level card (sealed crates, owned titles with rarity, Equip / Equipped). Guests who earn a
  crate get the same save prompt; the Collection repeats it.
- **Tests**: `crates.db.test.ts` runs the REAL MVP + crates migrations in an embedded Postgres (PGlite, a new
  dev dependency of `@game/progression` only), so a plpgsql error fails CI instead of the owner's paste.

## The 15 titles (placeholders; rename freely, ids stay)

| Rarity | Titles |
|---|---|
| Common (7) | Wanderer, Rune Reader, Coin Counter, Lantern Bearer, Hearthkeeper, Warband Captain, Board Builder |
| Rare (5) | Stormcaller, Star Chaser, Grave Whisperer, Ironbeard, Spiritbound |
| Epic (2) | Kingbreaker, Voice of the Deep |
| Legendary (1) | The Unbroken |

First-crate odds with every title unowned: Common 68.5%, Rare 26.7%, Epic 4.3%, Legendary 0.5%. A player has 16
crates by Level 16 (Welcome + 15 levels, about 4,500 XP), so the 15 run out around then; later crates stay sealed
until new items land. **Renaming a title** is a one-line edit of `name` in `cosmetics.ts` (no SQL). **Adding one**
is a row in `COSMETICS` AND in the migration's `cosmetic_catalog` seed (CI checks they match), then re-running the
migration file. **Switching on a category** (when its art is ready) flips `enabled` in both places.

## Judgement calls (flag if wrong)

1. **One new Edge Function, not an extension of `submit-progression`.** Settlement is a queued, retried request
   whose contract is already live; opening and equipping are interactive and fail differently
   (`pool_exhausted` is a normal answer). Separate means an inventory bug can never touch the XP writer; one
   function for both inventory actions keeps it to one extra deploy.
2. **Ownership moved to `player_cosmetics`** (one table for every category), with `player_titles` kept as a
   mirror by trigger so the MVP client still reads true data. The equipped title stays in
   `profiles.equipped_title_id` (public, MVP); `cosmetic_loadouts` is for the categories still switched off.
3. **Weight = rarity x category**, per handoff §5.4. With titles alone the category factor is the same for every
   item, so the odds are exactly the 55 / 30 / 12 / 3 rarity weights, normalized.
4. **A new crate title is worn only when nothing is worn** (same rule as Alpha Tester). Everyone at Level 2+
   already wears Alpha Tester, so in practice new titles wait for the player to equip them.
5. **`crates_enabled`** (defaults on) is a UI switch plus an open switch; crates are always earned and banked.
6. **Rules version unchanged (1).** Crates are additive; bumping it would have 409'd every queued request from an
   older client.
7. **No real concurrency test.** PGlite is one connection. The race safety is asserted structurally (the shared
   advisory lock is taken first by all three writers, the crate row is locked FOR UPDATE, the flip is guarded on
   `sealed`, unique keys + the immutability trigger refuse a second grant) and every sequential double-open case is
   run for real.
8. **Old ledger rows keep `crates_awarded = 0`** (they are immutable); the backfilled crates carry `source_id =
   'backfill'`.

## RUNBOOK (owner; run in order)

Replace `<project-ref>` and `<anon-key>` (Supabase → Project Settings → API). Everything below is idempotent.

1. **Merge the PR and ship the client.** Nothing changes for players yet: the crates probe reads "off" until
   step 2.
2. **Run the migration.** Supabase → SQL Editor → New query → paste the whole of
   `supabase/migrations/2026-09-28-progression-crates.sql` → **Run**. It needs the 2026-09-27 file already applied
   (it is). Never re-run the 2026-09-27 file after this one: it would put back the old `settle_progression`
   (re-run THIS file to repair if that happens).
3. **Verify** (same editor). Each line states the expected answer:
   ```sql
   select crates_enabled from public.progression_config;                                              -- true
   select count(*) filter (where acquisition_source = 'crate') as crate_items, count(*) as all_items
     from public.cosmetic_catalog;                                                                     -- 15 | 16
   select category from public.cosmetic_categories where enabled;                                      -- title
   select (select count(*) from public.loot_crates) as crates,
          (select coalesce(sum(account_level), 0) from public.profiles where progression_enrolled_at is not null) as expected;
                                                                                                        -- the two numbers are equal
   select count(*) as alpha_owners from public.player_cosmetics where cosmetic_id = 'alpha_tester';   -- same as player_titles' count
   ```
4. **Deploy the two Edge Functions** from the worktree (Supabase CLI logged in; add `--project-ref <project-ref>`
   if it asks):
   ```bash
   cd "C:\Users\kevin\the ascent\.claude\worktrees\progression-crates"
   npx supabase functions deploy progression-inventory
   npx supabase functions deploy submit-progression
   ```
   `submit-progression` is redeployed only to pick up the regenerated shared rules (its runtime parity check now
   covers crates). Between steps 2 and 4 a player could see a crate whose Open fails with "Could not open the
   crate. Try again."; do the steps back to back.
5. **Read-only anon probes** (no writes; the anon key is not a user):
   ```bash
   curl "https://<project-ref>.supabase.co/rest/v1/progression_config?select=epoch,crates_enabled" -H "apikey: <anon-key>"
   #   [{"epoch":"2026-09-28T02:03:...","crates_enabled":true}]
   curl "https://<project-ref>.supabase.co/rest/v1/cosmetic_catalog?select=cosmetic_id&acquisition_source=eq.crate" -H "apikey: <anon-key>"
   #   15 rows, title_board_builder ... title_wanderer
   curl "https://<project-ref>.supabase.co/rest/v1/cosmetic_categories?select=category&enabled=eq.true" -H "apikey: <anon-key>"
   #   [{"category":"title"}]
   curl "https://<project-ref>.supabase.co/rest/v1/player_cosmetics?select=cosmetic_id&limit=3" -H "apikey: <anon-key>"
   #   public read: [] or rows like {"cosmetic_id":"alpha_tester"}
   curl "https://<project-ref>.supabase.co/rest/v1/loot_crates?select=crate_id&limit=3" -H "apikey: <anon-key>"
   #   [] (crates are private: anon never sees any, even though they exist)
   curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/progression-inventory" -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" -d "{}"
   #   HTTP 401 {"error":"unauthenticated"} (proves it is deployed)
   ```
6. **Play-test.** Reload the game (the probes run at sign-in). Your Career's Account Level card shows
   **Collection** with a count (your backfilled crates). Open one: a title reveal. Equip it: the title under your
   name changes. Finish a game that levels you up: the XP panel shows "Crate earned" with Open.
7. **If anything looks wrong:** `update public.progression_config set crates_enabled = false where id = 1;` hides
   all crate UI and refuses opening; crates keep being earned (banked). Set it back to `true` to resume.

## Verification

`npm run typecheck && npm run lint && npm test && npm run build:web` and `npm run docbot:report -- --check`
(results in the PR). Browser check on a local offline server (port 5202, backend disabled, state injected): the
post-game "Crate earned" row, the reveal, the Collection with equip.
