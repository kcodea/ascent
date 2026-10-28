# Versus on Cloudflare: the signed-in live check (one 1v1, two tabs, ~5 minutes)

Goal: prove that a real, signed-in 1v1 on the production Worker writes its record to Supabase (`versus_matches` with
`backend = 'cloudflare'` and its `versus_rounds`), so XP and the room-card records keep working after cutover.
Players are not affected: only a tab opened with the flag below talks to Cloudflare.

## 0. Before you start (the lead)

- Main must carry the engine the Worker was deployed with. Check both say the same content revision:
  - `npx tsx -e "import('@game/content').then(m=>console.log(m.contentRevision()))"` (in an up-to-date main checkout)
  - <https://ascent-versus-v1-bef2d3c2.team-ascent.workers.dev/health> → `"contentRevision":"bef2d3c2"`
  If they differ, redeploy first: `npm run versus:cf:deploy -- --persist` (it names the new Worker after the new revision).
- The flag only exists in a DEV build (or a build with the Versus test tools switched on), so run the game locally from
  main on any free port that is NOT 5173:

  ```
  cd apps/web
  npx vite --port 5299 --strictPort
  ```

## 1. Open two tabs as two different accounts

A Supabase session lives in the browser profile, so the two players need two separate profiles (for example a normal
window and a private / InPrivate window, or two browser profiles).

- **Tab A** (your normal profile, signed in to your account):
  <http://localhost:5299/?versusHost=cf-live>
- **Tab B** (a private window, a second account: sign in, or let the game create a fresh guest):
  <http://localhost:5299/?versusHost=cf-live>

The flag is remembered for that tab only. To go back to Supabase in a tab: `?versusHost=supabase`.

## 2. Play one short match

1. Tab A: Play → Versus → **Create room**.
2. Tab B: Play → Versus → join the room from the list (it shows within a second), then take seat 2.
3. Tab A: take seat 1, press **Start**; both tabs press the crystal.
4. Both: pick a hero, buy anything, press **End Turn**. The fight should appear on both screens at once (well under a
   second after the second End Turn).
5. Play 2-3 rounds, then end it from the Esc menu: **Concede** (either tab). Both tabs close the gate and return to the room.
6. Leave the room in both tabs and close the private window.

## 3. Check the record (the lead, Supabase SQL editor)

```sql
-- the match (newest first): phase 'complete', end_reason 'forfeit', both user ids, backend 'cloudflare'
select id, phase, round, end_reason, winner_seat, p1_user, p2_user, backend, completed_at
  from public.versus_matches where backend = 'cloudflare' order by created_at desc limit 3;

-- its rounds: one row per round played, scouts present, Health/Armor/damage filled
select match_id, round, outcome, heart_lost_by, p1_health, p2_health, p1_damage, p2_damage, p1_scout, p2_scout
  from public.versus_rounds where match_id = '<id from above>' order by round;
```

The writes land within a second or two of each round (the room's outbox drains on its next alarm).

**Idempotency (no new rows, nothing changes):** call the writer again with one of the round rows. The Worker's retry
path does exactly this; to check it by hand, re-run the round insert through the function as the service role with the
same row (`select public.versus_cf_persist('<writer secret>', 'round', <row json>)`), or simply note that
`versus_rounds` has a primary key on (match_id, round) and the function inserts with `on conflict do nothing`, and a
finished match answers `frozen`. Re-running the two selects above must show the same rows.

If nothing landed: the Worker logs `versus_cf_persist_retry` with the HTTP status (Cloudflare dashboard → Workers →
ascent-versus-v1-bef2d3c2 → Logs). `not_authorized` = the writer secret's hash row is missing; `not_cloudflare` = an
id clash with a Supabase match (should never happen).
