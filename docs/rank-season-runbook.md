# Medal rank — season 3 runbook (owner Supabase steps)

The owner runs every Supabase operation. This is the numbered order for turning on the medal ladder
(`feat/rank-rules-server`), with a verification probe after each step that changes production. **Nothing in
the PR executes against production**; every statement below is something you paste and run yourself.

Read first: `docs/GAME-RULES.md` → *Ranked ladder* (the rules), `supabase/migrations/2026-09-20-medal-rank.sql`
(what step 2 runs), `supabase/functions/submit-rating/index.ts` (what step 3 deploys).

Files you will use:

| File | Purpose |
| --- | --- |
| `supabase/migrations/2026-09-20-medal-rank.sql` | The schema + `settle_rank` block. Idempotent. The season reset at its bottom is commented out on purpose. |
| `schema.sql` | The cumulative paste file; it ends with the SAME block. Run one or the other, not both. |
| `supabase/functions/submit-rating/index.ts` + `_shared/lobbyRating.ts` | The Edge Function (replaces the numeric C3 writer in place — same name). |

The order matters: **schema first, then function, then clients.** A new client against an old function is
told `rejected · server_outdated` and keeps its result queued; a new function against an old schema fails
every settlement with `settle_failed` (retryable — nothing is lost, nothing is written).

---

## 1. Snapshot before touching anything

1. Supabase → **Database → Backups** → confirm today's backup exists (or take a manual one on a paid plan).
2. SQL Editor → run and keep the output somewhere (this is the season-2 ladder you are archiving):

   ```sql
   select user_id, author, discriminator, rating, games_played, updated_at
     from public.profiles order by rating desc;
   ```

## 2. Run the migration (schema + `settle_rank`)

1. SQL Editor → **New query** → paste the whole of `supabase/migrations/2026-09-20-medal-rank.sql` → **Run**.
   It is idempotent; a second run is harmless. The season reset at the bottom is commented out and does NOT
   run here.
2. Verify the columns and the function exist:

   ```sql
   select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name like 'rank_%';
   -- expect: rank_season, rank_rules_version, rank_division, rank_points, rank_demotion_ready,
   --         rank_highest_division, rank_highest_points, rank_revision
   select proname from pg_proc where proname in ('settle_rank', 'rank_result_json', 'rank_profile_json');
   -- expect all three
   select count(*) from public.rank_results;   -- expect 0
   ```

3. Verify a CLIENT cannot write a rank field (RLS). In the SQL editor these run as `postgres`, so test through
   the anon REST probe instead — see step 6.

## 3. Deploy the Edge Function

From the repo root (needs the Supabase CLI logged into the project):

```
supabase functions deploy submit-rating
```

The function reads `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` from the project's
function secrets — the same three the previous `submit-rating` used, so nothing new to set. Confirm in
**Edge Functions → submit-rating** that the deployed version's timestamp is now.

## 4. Smoke-test one settlement (a throwaway account)

1. In a browser with the NEW build, sign in to a throwaway account (or an anonymous session) and finish one
   ranked lobby. Practice does not count — it never submits.
2. SQL Editor:

   ```sql
   select run_id, placement, division_before, points_before, division_after, points_after,
          demotion_ready_after, applied_delta, promotion_unlocked, promoted, demoted, created_at
     from public.rank_results order by created_at desc limit 5;
   select author, rating, rank_season, rank_division, rank_points, rank_demotion_ready, rank_revision
     from public.profiles where rank_revision > 0 order by updated_at desc limit 5;
   ```

   Expect one `rank_results` row; the profile's `rank_season = 3`, `rank_revision = 1`, `rating` equal to
   `100 × rank_division + rank_points`, `rank_demotion_ready = false` (a first game from Bronze III can never
   arm the medal-boundary demotion gate — it is a STORED flag, set only by a loss that lands on 0 at Silver
   III or higher, and `settle_rank` writes it in the same transaction as the points).
3. Optional dedupe check — Edge Functions → **submit-rating → Logs**: re-trigger the same submission from the
   client (DevTools → `useGame.getState().retryRankSubmission()` won't resend a confirmed one, so use the
   Network tab's *Replay XHR* on the `submit-rating` call). The response carries `"deduped": true` and the
   profile's `rank_revision` stays 1. The log line `rank parity mismatch` must NOT appear — if it does, stop
   and report it (the SQL and TS rules copies disagree).

## 5. The season reset — run ONCE, deliberately

This is the owner decision (2026-09-20): everyone starts season 3 at Bronze III 0/100. Old ratings are
archived into `season2_rating`; nothing is deleted. Do this only after step 4 proved a settlement works.

```sql
update public.profiles set season2_rating = coalesce(season2_rating, rating);
update public.profiles set
  rank_season = 3, rank_rules_version = 1,
  rank_division = 0, rank_points = 0, rank_demotion_ready = false,
  rank_highest_division = 0, rank_highest_points = 0,
  rank_revision = rank_revision + 1,
  rating = 0, updated_at = now();
```

`rank_revision + 1` (never `= 0`) is what makes every already-updated client adopt the reset on its next boot:
a client ignores a server profile whose revision is OLDER than its mirror. The same rule applies to any
hand-edit later — **if you ever change a rank by hand, bump `rank_revision` in the same statement.**

Verify:

```sql
select count(*) filter (where rank_season = 3) as reset, count(*) as total,
       max(rank_division), max(rank_points), max(rating)
  from public.profiles;
-- expect reset = total, all maxes 0
select count(*) filter (where season2_rating is not null) from public.profiles;  -- the archive is populated
```

## 6. Verify from the outside — the anon REST probe

Replace `<url>` with the project URL and `<anon>` with the anon key (Project Settings → API). These are the
same two values the game ships with, so nothing here is secret.

1. **Reads work and carry the rank columns** (200 + a JSON array):

   ```
   curl -s "<url>/rest/v1/profiles?select=author,rating,rank_division,rank_points,rank_revision&order=rank_division.desc,rank_points.desc&limit=5" \
     -H "apikey: <anon>" -H "Authorization: Bearer <anon>"
   ```

2. **A client cannot move a rank** (expect an empty `[]` or a 401/403 — never a row with the new value).
   Use a real user JWT for a fuller test (copy `access_token` from DevTools → Application → Local Storage →
   the `sb-…-auth-token` entry) as the Bearer:

   ```
   curl -s -X PATCH "<url>/rest/v1/profiles?user_id=eq.<that user's id>" \
     -H "apikey: <anon>" -H "Authorization: Bearer <user jwt>" -H "Content-Type: application/json" \
     -H "Prefer: return=representation" -d '{"rank_division": 17, "rank_points": 100}'
   ```

   Expected: a `42501` "new row violates row-level security policy" error (or `[]`). Re-read with the probe in
   (1) and confirm the row is unchanged.

3. **The legacy RPC is gone** (expect 404 `PGRST202` — function not found):

   ```
   curl -s -X POST "<url>/rest/v1/rpc/submit_own_rating" -H "apikey: <anon>" -H "Authorization: Bearer <anon>" \
     -H "Content-Type: application/json" -d '{"new_rating": 9999}'
   ```

4. **`settle_rank` is not callable by clients** (expect 401/403/404, never a settlement):

   ```
   curl -s -X POST "<url>/rest/v1/rpc/settle_rank" -H "apikey: <anon>" -H "Authorization: Bearer <anon>" \
     -H "Content-Type: application/json" \
     -d '{"p_user":"00000000-0000-0000-0000-000000000000","p_run_id":"x","p_placement":1,"p_season":3,"p_rules_version":1}'
   ```

## 7. Ship the client

Merge the client PR(s) only after steps 2–3. An OLD client (the numeric build) hitting the NEW function gets
`409 unsupported_season` and simply shows no rating change — it never writes the medal ladder. A NEW client
hitting the OLD function shows `Rank update pending` / rejected `server_outdated` and keeps its result queued
until the function is deployed, at which point the next boot resubmits it.

## Rollback

Do NOT drop tables or delete ledgers. To stop ranked settlement without losing anything:

```sql
revoke execute on function public.settle_rank(uuid, text, int, int, int, bigint) from service_role;
```

Every submission then fails as `settle_failed` (retryable): clients keep their results queued and resubmit
when you `grant execute … to service_role` again. To restore the numeric ladder for display,
`update public.profiles set rating = season2_rating where season2_rating is not null;` — the medal columns
and `rank_results` stay intact for the return.

## Things that were NOT verified locally (honest list)

- The Deno function was not type-checked or run here (no `deno` / `supabase` CLI on the build machine). It
  reuses the previous function's structure line-for-line; the new logic is one `rpc` call plus the parity
  compare. First deploy = first execution: watch the Logs tab on the step-4 settlement.
- The plpgsql `settle_rank` body was not executed against a Postgres here. Its CONSTANTS are CI-checked
  against the client (`lobbyRatingParity.test.ts` reads the migration text) and its full outcome is checked
  at runtime by the function's parity compare; the transaction semantics (lock, dedupe under lock, rollback
  on `raise`) are standard plpgsql. Step 4 is the real test.
