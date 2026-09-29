# 2026-09-29: Hero titles (3 Ranked 1sts) and their golden master plate (10)

Owner ask 2026-09-29: "branch off and make the hero titles - the hero's title is granted at 3 wins with a hero, then the
mastery of that title is after 10 wins with that hero. the master title should be a golden plate and embroidered text".
Oracle R-ACH-04 (the grants) and R-PROG-TITLE-04 (the look); GAME-RULES "Hero titles".

**Nothing changes for players until the owner runs the runbook below.** Until then the server grants no hero title
(the achievement catalog it evaluates has no title ids), and the client simply shows the new titles as not owned.

## What shipped

- **33 hero titles, two items each (66 catalog rows).** `HERO_TITLE_NAMES` in `packages/progression/src/cosmetics.ts`
  (the dependency-free leaf, so the names live there; a test pins it to `ACHIEVEMENT_HEROES`):
  - `title_hero_<id>` (Epic, the normal title look), from the new achievement `hero.<id>.titled`.
  - `title_hero_<id>_master` (Legendary), the SAME name, from the existing `hero.<id>.mastery`.
  - Both are `acquisition: achievement`, so `progression_crate_pool` never offers them.
- **A fifth hero tier, "Titled".** `hero.<id>.titled`: 3 Ranked 1sts, 150 XP, grants the title. Mastery (10 Ranked
  1sts, 250 XP) now grants the master. Victory (1 Ranked 1st, 100 XP) is unchanged. Registry: 281 achievements
  (Heroes 165), 35,775 XP (Heroes 19,800).
- **The grant is part of the settlement** (`supabase/migrations/2026-09-29-hero-titles.sql`, replaces
  `settle_progression`):
  - step 7c: a completion whose catalog row names a `title_id` inserts it into `player_cosmetics` (keyed, source
    `achievement`) and lists it in `unlockedTitles`. Only a title the cosmetic catalog knows (the ownership FK), so an
    unsynced id is skipped instead of failing the settlement.
  - step 9a: a newly earned master replaces its own base title when that is the one worn; a new hero title is worn
    when nothing is worn (the Alpha Tester rule).
  - the file also seeds the 66 catalog rows (`on conflict do nothing`; the code sync owns them after) and nulls both
    catalog hashes so the next cold starts resync.
- **Backfill** (in the same file): for any account that already has Mastery progress, the Titled tier starts at that
  count (capped at 3). A Titled tier completed this way gets its completion row with **0 XP** (XP only ever moves inside
  a settlement) and its title; a completed Mastery gets the master; completions get their `title_id`; a worn base title
  whose master is owned is upgraded.
- **Runtime parity** (`settlementParity`, `server.ts`): an unlocked title may now also be the title of an achievement
  completed in that settlement.
- **The master upgrades in place.** `titleShelf` (cosmetics.ts): the master supersedes the base; an unowned master is
  never listed. The Collection's Titles album therefore shows each hero title ONCE (49 titles in the album, 76 items in
  the "collected" total), and the picker (the Collection's Equip) can only pick the master once it is owned.
- **THE LOOK: a golden plate with embroidered text.** `TitleBadge` renders any master title as `.tb-master`:
  - a bevelled metallic gold plate (layered gradients, a static diagonal sheen, inset bevel light and shadow, a soft
    outer glow);
  - a dashed crimson thread stitched just inside the plate's edge (`.tb-stitch`, an empty decorative span);
  - the name embroidered in crimson satin stitch: fine diagonal thread strands clipped to the letters, a soft top
    highlight, over a raised, outlined underside drawn by the text's own `::before` (`data-text`), so the badge's
    text content stays the name.
  - ALL STATIC: no animation, transition or `will-change` on any `.tb-master` rule (a test greps the stylesheet).
  - Surfaces: the Career name header, the Collection (tile, nameplate, preview under your name), the New rewards
    popup, the Achievements tab (a new "Title" reward line on the Titled / Mastery tiles), and every existing
    TitleBadge surface (Leaderboard, Hall of Champions, Match details on the end screen and in the Career).
- **DEV preview.** The Crate opening tuner (DEV menu) has "Preview: hero titles", "Preview: master titles" and
  "Preview: clear titles": they fake ownership on this client in memory (never saved or sent).

## Judgement calls (flag if wrong)

1. **"Wins" = Ranked 1st-place finishes**, the same thing Victory and Mastery count. Practice 1sts never count.
2. **Victory stays** (1 Ranked 1st, 100 XP, no title) and a **new Titled tier** (3, 150 XP) grants the title. The
   150 XP sits between Victory (100) and Mastery (250).
3. **The master is a separate catalog item** (`_master`) that supersedes the base, rather than a flag on the owned
   title: it rides the existing catalog, ownership, equip, snapshot and kill-switch paths with no schema change, and a
   recorded run snapshot shows the master exactly as worn.
4. **Rarity:** the base title is Epic (normal title styling, purple); the master is Legendary (only its plate shows).
5. **The backfill pays no XP** for a Titled tier it completes. Before the owner sets `achievements_epoch` there is no
   progress to backfill at all.
6. **Auto-wear:** a new hero title is worn only when nothing is worn; since everyone at Level 2 wears Alpha Tester, in
   practice you equip it from the Titles tab. The master DOES swap in automatically when you wear its base title.
7. **Titles:** all 33 names come from the 2026-09-28 design pass (no playable hero was missing one).

## OWNER RUNBOOK (run in order)

Replace `<anon-key>` with the project's anon key (Supabase, Project Settings, API). Everything is idempotent.

1. **Merge the PR and ship the client.** Nothing changes yet: the titles show as not owned.
2. **Paste the SQL.** Supabase, SQL Editor, New query: paste ALL of `supabase/migrations/2026-09-29-hero-titles.sql`
   and Run. Expected: "Success. No rows returned". It must run AFTER `2026-09-28-achievements.sql` (it replaces
   `settle_progression`); if the achievements file is ever re-run, run this one again after it.
3. **Verify in the same editor** (each line states the expected answer):
   ```sql
   select count(*) from public.cosmetic_catalog where cosmetic_id like 'title_hero_%' and acquisition_source = 'achievement';  -- 66
   select count(*) from public.progression_crate_pool('00000000-0000-0000-0000-000000000000') where pool_cosmetic_id like 'title_hero_%';  -- 0
   select prosrc like '%c_hero_title_prefix%' from pg_proc where proname = 'settle_progression';  -- true
   ```
4. **Deploy the two Edge Functions** from the worktree (Supabase CLI logged in):
   ```
   cd "C:\Users\kevin\the ascent\.claude\worktrees\hero-titles"
   npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza
   npx supabase functions deploy submit-progression --project-ref zcwhbejpqcdcfdpfxeza
   ```
   `submit-progression` carries the new achievement catalog (the Titled tier and the title ids) and the parity rule;
   `progression-inventory` carries the cosmetic catalog (the 66 titles).
5. **Trigger both catalog syncs** (the first POST of a cold start syncs before the auth check, even unauthenticated):
   ```
   curl -i -X POST "https://zcwhbejpqcdcfdpfxeza.supabase.co/functions/v1/progression-inventory" -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" -d "{}"
   #   HTTP 401 {"error":"unauthenticated"}
   curl -i -X POST "https://zcwhbejpqcdcfdpfxeza.supabase.co/functions/v1/submit-progression" -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" -d "{}"
   #   HTTP 401 {"error":"unauthenticated"}
   ```
6. **Read-only probes** (no writes; the anon key is not a user):
   ```
   curl -I "https://zcwhbejpqcdcfdpfxeza.supabase.co/rest/v1/cosmetic_catalog?select=cosmetic_id&cosmetic_id=like.title_hero_*&acquisition_source=eq.achievement" -H "apikey: <anon-key>" -H "Prefer: count=exact"
   #   Content-Range: */66
   curl "https://zcwhbejpqcdcfdpfxeza.supabase.co/rest/v1/achievement_catalog?select=achievement_id,target,xp,title_id&achievement_id=in.(hero.warden.titled,hero.warden.mastery)" -H "apikey: <anon-key>"
   #   [{"achievement_id":"hero.warden.mastery","target":10,"xp":250,"title_id":"title_hero_warden_master"},
   #    {"achievement_id":"hero.warden.titled","target":3,"xp":150,"title_id":"title_hero_warden"}]   (order may differ)
   curl -I "https://zcwhbejpqcdcfdpfxeza.supabase.co/rest/v1/achievement_catalog?select=achievement_id&title_id=not.is.null&active=eq.true" -H "apikey: <anon-key>" -H "Prefer: count=exact"
   #   Content-Range: */66
   ```
   If the `achievement_catalog` probe still shows `title_id: null`, step 5's `submit-progression` POST hit a warm
   instance: wait a few minutes (or redeploy) and POST again.
7. **Play-test.** Your 3rd Ranked 1st with one hero shows the title under "Titles unlocked" in the New rewards popup;
   wear it from the Collection's Titles tab. The 10th turns it into the golden plate (and swaps it in if you wear it).

**Emergency switch** (one line each, no deploy):

```sql
update public.cosmetic_catalog set admin_off = true where cosmetic_id like 'title_hero_%';       -- hide every hero title
update public.achievement_catalog set admin_off = true where achievement_id like 'hero.%.titled'; -- stop the Titled tier
```

(Set `admin_off = false` to restore; ownership is never deleted.)

## Verification

- `npm run typecheck && npm run lint && npm test && npm run build:web` (results in the PR).
- `heroTitles.db.test.ts` runs every progression migration in PGlite, then this file, and settles real games: 3
  Ranked 1sts grant the title, 10 the master (swapped in when the base is worn), Practice and non-1sts never count, a
  duplicate settlement grants nothing, an unsynced title id is skipped, the crate pool never offers them, and the
  backfill (including a re-run) behaves as described.
- Browser check on port 5190 (backend disabled with a temporary `apps/web/.env.local`, deleted after; state injected
  through the DEV preview): the Career header plate, the Collection album (one Warded tile as the plate, equipped), the
  detail nameplate and preview, and the base titles in the normal Epic look.
