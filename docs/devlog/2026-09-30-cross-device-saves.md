# 2026-09-30 — Cross-device saves: Continue a signed-in game on any device

Owner feature request (plan approved the same day):

> *"if a player is playing on one device and they save/quit, can we allow that to be picked up from another device
> they are signed in on?"*

Rules: R-PERSIST-CLOUD-01..03 (`packages/rules/src/registry/approved/persistence.ts`); player rules in
`docs/GAME-RULES.md` ("Continue on any device"). Stacked on the Continue fix (`fix/continue-no-legacy-course`,
R-PERSIST-01).

## Design

- **The local save stays the source of truth on a device.** `writeSave` writes `ascent.save` exactly as before and
  only then bookkeeps a small LEASE (`ascent.cloudsave`: run key, the cloud revision this device last saw, dirty,
  saved-at). Offline play is unchanged.
- **Upload** (`packages/ui/src/cloudSave.ts`, one serialized chain, fire-and-forget): at the start of every shop
  phase (a recruit-phase save; a new run opens on one) and on `flushSave` (Save & Quit / tab hide). The payload
  is the raw local save string VERBATIM plus the recordings behind the lobby's snapshot seats (a seat stores only
  a `runKey` resolved against the session's random pool sample, so another device would otherwise fall back to
  bots). A failure keeps the lease dirty and retries (2 s → 60 s backoff, the `online` event, a new session).
  Guests (anonymous accounts) never upload.
- **Server** (`supabase/migrations/2026-09-30-saved-runs.sql`): `saved_runs`, one row per account, readable only
  by its owner (RLS), no direct write grants. `put_saved_run(run_key, expected, device, payload)` accepts a write
  only at the expected revision (or `0` for a new run taking the slot) and otherwise returns the current row's meta;
  `payload = null` is a CLAIM. `clear_saved_run(run_key, expected)` deletes at the expected revision. Both refuse
  anonymous users; only `authenticated` may execute.
- **Title reconcile** (`syncCloudAtTitle`, on the signed-in session landing, on returning to the title, on tab
  return): `decideAtTitle(localKey, lease, cloudMeta)` (pure) → `adopt` (cloud newer / no local), `push` (local
  newer or never synced), `discard-local` (a synced local run whose row is gone: it ended elsewhere), or `none`.
  `adoptCloudRun` writes the string into `ascent.save` byte-for-byte, registers the seat recordings, evicts cached
  seat drivers and re-seats the store as a boot would; Continue then resumes through the normal path.
- **One device at a time**: `continueRun` claims the run. The other device's next write is refused →
  `onCloudMoved` locks saving (`cloudMovedLock`) and shows the blocking **CloudMovedModal** ("Your game moved":
  Load the newer game / Main menu; "This game has ended" when the row is gone). A tab returning to the foreground
  mid-run checks the meta and shows the same prompt before the player acts on a stale copy.
- **Run end** (and title Clear) calls `cloudSave.endRun()` before `clearSave`, so Continue disappears everywhere.
- **Rank safety**: a rated game is settled once per `run_id` by the server (`rank_results` primary key), so even a
  race cannot rank one game twice. Adopting a DIFFERENT run over a local one settles the replaced rated game as an
  abandonment (R-RANK-05), which is a no-op if it was already settled.
- **Feature-detected**: until the SQL runs, the first call answers "missing table/function" and the service turns
  itself off for the session. Nothing else changes.

## Known limits

- Replay V2 frames stay in the recording device's IndexedDB. A game continued on another device records from the
  resume point (`partial`, "resumed without frames"); its local draft is dropped if another device wrote the copy.
- A tab closed mid-shop may not finish its upload; the other device then resumes from the start of that shop phase
  (the last uploaded save). The first device, reopened later, adopts the newer copy instead of overwriting it.
- Verified with unit + store-level integration tests against an in-memory server with the SQL's rules
  (`cloudSave.test.ts`, `crossDeviceSaves.test.ts`). No real two-browser test: the project has no test account in
  its seed/test config, and the SQL is not live yet.

## OWNER RUNBOOK

1. Supabase dashboard → **SQL Editor** → New query.
2. Paste the whole of `supabase/migrations/2026-09-30-saved-runs.sql` (also appended to `schema.sql`) and **Run**.
   It is idempotent; running it twice is harmless.
3. Verify (should return 1 row, `rls = true`, and the two functions):
   ```sql
   select c.relname, c.relrowsecurity as rls,
          (select count(*) from pg_policies p where p.tablename = 'saved_runs') as policies,
          (select string_agg(proname, ', ') from pg_proc where proname in ('put_saved_run', 'clear_saved_run')) as fns
   from pg_class c where c.relname = 'saved_runs';
   ```
4. Verify the anon key cannot read it (expect an empty list or a permission error, never rows):
   `curl "$SUPABASE_URL/rest/v1/saved_runs?select=user_id" -H "apikey: $ANON_KEY"`.
5. Try it: sign in on two browsers, start a game on one, Save & Quit, open the title on the other and press
   Continue. Back on the first browser, the game shows "Your game moved".
6. Watch it: `select user_id, run_key, revision, device_id, updated_at, pg_column_size(payload) from saved_runs order by updated_at desc limit 20;`
