# 2026-09-28: Achievements, batch 1 (XP rewards only)

Owner direction 2026-09-28: "okay how are achivements coming? we'll need an achievements tab in career next to
practice. most should show, with their reward, but the hidden ones will be blurred or say "Hidden" and we'll come up
with fun rewards for them. let's just get the normal xp related achievements in for now though." Earlier: "we need set
2 achievements because that is the active set right now."

Built from the read-only design pass (the audit, 49 Set 2 achievements, tranche plan), trimmed to XP only. Three
stacked PRs:

1. **Registry + facts V2** (#1788): `packages/progression/src/achievements.ts` and `packages/sim/src/achievementMetrics.ts`.
2. **Settle SQL** (#1789): `supabase/migrations/2026-09-28-achievements.sql`.
3. **UI + docs** (this entry): the Career Achievements tab, the post-game rows, patch note, GAME-RULES, oracle
   R-ACH-01..03.

## What shipped

- **248 achievements, 30,825 XP**, all XP only. Title rewards and hidden entries are out for now.
  - By category:
    - Career 17 (1,550 XP)
    - Ranked 28 (4,300)
    - Heroes 132 (14,850; Debut / Contender / Victory / Mastery for each of the 33 playable heroes)
    - Economy and Build 15 (1,925)
    - Mechanics 7 (1,125)
    - Runes 5 (675)
    - Set 2 44 (6,400)
  - Set 2 splits into Kobolds 8, Dwarves 6, Dragons 7, Beasts 6, Demons 7, Cross-tribe 5 and Runes 5.
  - Every def has `rewards: { xp, titleId: null }`, so a title can be attached later with no migration.
  - `hidden: true` works end to end (the evaluator, the blurred "Hidden" tile), but no hidden entry ships.
- **66 run metrics**, counted by the existing run observer (`observeAction`) and carried in facts V2
  (`metrics`). They are counted at three hooks:
  - **Per action:** the RunState per-turn tallies, read as running maxima: Gold spent, Rubies, Ales, Shop spells,
    Shouts and End of Turn fires. Also refreshes, plays, buys from the Shop frozen last turn, consumes, Ruby facets
    on Kobolds and Ale kinds.
  - **Per combat:** pure `lastCombat.events` reads:
    - summons, including Beasts, Imps, the Golem and King Oona's biggest Beast;
    - Echoes, including Beast Echoes;
    - Ward blocks, Rubies landed, Dragonflame magnitude and Execute kills;
    - clean late wins, underdog wins and balanced wins.
  - **Final state:** the final board by tribe, owned runes and rune payouts.
- **Server metrics**, computed by `settle_progression` from its own rows:
  - the game, placement and accepted comeback;
  - the rank result: promotion, demotion escape, lobby strength, division before;
  - the Career-best division and streaks;
  - distinct heroes (`achievement_hero_stats`) and completions so far.
  A client key with a server metric's name is overwritten.
- **Evaluation happens inside `settle_progression`**, under the same lock and transaction as the match XP.
  - A completion is written once per account (PK).
  - Its XP lands on the same ledger row (`achievement_xp`, `achievement_ids`) and the account, so it levels up and
    earns crates.
  - A duplicate settlement returns the original result.
  - `evaluateAchievements` (TS) mirrors the SQL. The PGlite test runs both and compares them game after game.
- **The Career "Achievements" tab**, right after Practice:
  - It appears only once the switch is on.
  - It has category tabs with done / total counts, the Set 2 tribe sub-groups and heroes grouped by hero.
  - Filters are All / Completed / In progress.
  - Each tile shows the name, requirement, reward, the date once done, and a progress bar (owner's page only).
  - "Legacy" appears on a set that is no longer active.
  - It is visible on anyone's Career.
- **Post-game**: "Achievement unlocked: <name> +N XP" rows under the XP bar.
  - They use one-shot entrances in the panel's style.
  - There are 6 rows at most, then "+N more achievements. See your Career."
  - The headline total includes the achievement XP.

## Assumed defaults (owner can flip)

1. Practice counts for ANY_GAME feats only with Normal Health and a turn timer. Practice uploads now record
   `timeMult`.
2. Rank achievements pay out from the Career best on the first settle after launch.
3. Rank achievements use the ascending 1/2/3 numerals the UI shows ("Silver 1" is the first Silver).
4. Set 2 feats are earnable only in Set 2 runs and read "Legacy" after rotation.
5. Hero Victory and Mastery count Ranked only. Debut and Top 4 count Practice per rule 1.

Judgement calls:

- "Hold That Thought" (freeze, then buy from it next turn) and "Worth Three" (gild a minion) were the doc's two
  reworded tutorial rows. They ship as real-game firsts in Economy and Build. The only tutorial achievement is the
  graduation, "Ready to Ascend", at 100 XP.
- Post-game rows cap at 6.
- Final-board stats are the board's own Attack and Health, without run-wide auras.

## Cut or deferred

- **Titles**: rank medal titles, hero Victory and Mastery titles, and the Initiate title.
- **Hidden**: Time to Feast, Exact Change, Loud Enough, and their fun rewards.
- **Prestige** (replay verify): `ranked.ascendant_win`, `one_resolve`, `flawless`.
- **Batch 2 instrumentation**:
  - overflow and No Vacancy;
  - spend-meter payouts (Clocked In);
  - extra casts (Mirrored Wings);
  - Shop-buff totals (Fattening Up, Premium Stock);
  - a true Rally count;
  - Choose One both effects;
  - Shouts and Rise in combat;
  - empty recovery;
  - the counters (taunt break, ward break, punch up).
- **Avenge in one combat** (`mechanic.avenge_combat_6`) moved to batch 2. An Avenge bus emission tags every event it
  causes but not each handler that fired, so there is no honest per-fire count yet.
- **Batch 2 tune**: `s2.dwarf.industry_40`, `s2.beast.pack_alpha_10`, `economy.spend_turn_35`,
  `economy.play_turn_25`, `build.stat_100/500`, and the larger career tiers.
- **Follow-ups**:
  - the 3 Career showcase slots;
  - titles on lobby seat plates;
  - an audit of `runeProcs` coverage. `rune.triggers_20/50` read it as the badge does.

## Owner runbook

Order matters: SQL, then deploy, then probe, and only THEN the switch. The client shows nothing and keeps sending V1
facts until step 5.

1. **Paste the SQL.** In the Supabase SQL Editor, paste all of `supabase/migrations/2026-09-28-achievements.sql` and
   Run.
   - It is idempotent. It runs after the skins file.
   - If the crates file is ever re-run, run the skins file and then this file again.
   - Expected result: "Success. No rows returned".
2. **Deploy the Edge Function.** Run this from the worktree (`C:\Users\kevin\the ascent\.claude\worktrees\achievements`),
   Supabase CLI logged in:
   ```
   npx supabase functions deploy submit-progression --project-ref zcwhbejpqcdcfdpfxeza
   ```
3. **Trigger the catalog sync.** The first POST syncs before the auth check, even unauthenticated:
   ```
   curl -i -X POST "https://zcwhbejpqcdcfdpfxeza.supabase.co/functions/v1/submit-progression" -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" -d "{}"
   #   HTTP 401 {"error":"unauthenticated"}   (deployed; the sync ran first)
   ```
4. **Verify probes** (read-only):
   ```
   curl "https://zcwhbejpqcdcfdpfxeza.supabase.co/rest/v1/achievement_catalog?select=achievement_id&active=eq.true" -H "apikey: <anon-key>" -H "Prefer: count=exact" -I
   #   Content-Range: */248
   curl "https://zcwhbejpqcdcfdpfxeza.supabase.co/rest/v1/progression_config?select=achievements_epoch,achievements_hash" -H "apikey: <anon-key>"
   #   [{"achievements_epoch":null,"achievements_hash":"a1-..."}]   (synced, still OFF)
   curl "https://zcwhbejpqcdcfdpfxeza.supabase.co/rest/v1/achievement_completions?select=achievement_id&limit=1" -H "apikey: <anon-key>"
   #   []   (public read works, nothing earned yet)
   curl "https://zcwhbejpqcdcfdpfxeza.supabase.co/rest/v1/achievement_progress?select=achievement_id&limit=1" -H "apikey: <anon-key>"
   #   []   (owner-only: the anon key sees nothing, by design)
   ```
5. **THE SWITCH.** Run it once, in the SQL Editor, after step 4 looks right:
   ```sql
   update public.progression_config set achievements_epoch = now(), updated_at = now() where id = 1 and achievements_epoch is null;
   ```
   After a reload:
   - clients show the Achievements tab;
   - clients send V2 facts;
   - the next settled game evaluates.
   Games recorded before this moment never count, but still earn their match XP.
6. **Check a real game.** After one Ranked game, the post-game panel lists "Achievement unlocked" rows and
   `achievement_completions` has your rows.

**Emergency switch** (one line; no deploy; survives every sync):

```sql
update public.achievement_catalog set admin_off = true  where achievement_id = 's2.kobold.golem_40';  -- retire
update public.achievement_catalog set admin_off = false where achievement_id = 's2.kobold.golem_40';  -- restore
```

**Turn achievements off entirely**: `update public.progression_config set achievements_epoch = null where id = 1;`.
Settlements then skip evaluation, and clients drop the tab on their next probe. Setting it again later starts a new
counting window.

**Adding or retuning an achievement later**:

1. Edit `packages/progression/src/achievements.ts`.
2. Run `npm run progression:shared`.
3. Merge.
4. Redeploy `submit-progression`.

No SQL is needed.

## Verification

Run on each PR:

- `npm run typecheck && npm run lint && npm test && npm run build:web`
- `npm run docbot:report -- --check`

Browser check on port 5195 against a local fake Supabase (never the real project):

- Career showed Match History / Heroes / Practice / Achievements.
- The Career category showed 1 / 17 with a dated completed tile and progress bars.
- Set 2 grouped by tribe.
- The gauntlet cursor showed on the category buttons, and there were no `title=` attributes.
- `apps/web/.env.local` was deleted afterwards.
