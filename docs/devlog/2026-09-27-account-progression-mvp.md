# 2026-09-27 — Account progression MVP: Account Level, XP, and the Alpha Tester title

The first slice (phases 0 and 1) of the account progression handoff, scoped by the owner's decisions of
2026-09-27: a permanent, earn-only **Account Level** fed by every completed game, and ONE reward, the
**Alpha Tester** title at Level 2 for everyone. No crates, cosmetics or achievements yet; the ledger keeps their
columns so those phases can land without reshaping it. Rules: `docs/GAME-RULES.md` "Account Level"; oracle
R-PROG-XP-01, R-PROG-CURVE-01, R-PROG-TITLE-01.

**Nothing is live until the owner runs the runbook below.** The client ships dark: it probes
`progression_config.epoch` and shows nothing, queues nothing, while the table is missing or the epoch is null.

## What was built

- **`@game/progression`** (new package, dependency-free): the versioned curve (`levelOfXp`, `levelProgress`,
  250 / 400 / 500 bands), `xpForSettlement` / `matchXp` (Ranked 100 + 40 + 60 + 25; Practice 60% summed then
  rounded, remainder on the base; flat 60 with no placement; tutorial 250), `comebackAfterLosses`, the title
  table, `ProgressionRunFactsV1`, the server payload parsers, and the Edge Function handler as a pure function
  (`server.ts`). *Why a package and not a sim module:* the Edge Function (Deno, no npm) needs a dependency-free
  copy, and sim pulls content/core; a leaf package keeps the shared rules import-free and lets sim, ui and the
  server all read one source.
- **One hand-edited copy.** `npm run progression:shared` generates `supabase/functions/_shared/progressionRules.ts`
  and `progressionServer.ts` from the package; `sharedArtifact.test.ts` fails CI on drift. `sqlParity.test.ts`
  reads the plpgsql constants out of the migration and drives the SQL's integer arithmetic against the TS rules
  (every level to 60,000 XP, every placement). The Edge Function re-derives each settlement and returns
  `parity: false` on a mismatch (the submit-rating pattern).
- **Facts off the observer.** `progressionFactsOf` / `progressionPlacementOf` in `packages/sim/src/runDerive.ts`
  read the ordered combat results the run observer already records; nothing in card scripts knows about XP.
- **SQL** (`supabase/migrations/2026-09-27-account-progression.sql`, appended to `schema.sql`): profile columns
  (`account_xp` lifetime, `account_level` cache, `progression_revision`, `progression_enrolled_at`,
  `progression_curve_version`, `equipped_title_id`); a **guard trigger** refusing any client-role write to
  those columns (instead of re-stating the medal-rank "update own profile" policy); the immutable
  `progression_results` ledger (PK user + run + mode, facts stored for audit, update trigger refuses edits);
  `player_titles` (public read); `tutorial_progression_claims`; `progression_config` (the epoch switch, ships
  null); and `settle_progression` (SECURITY DEFINER, `search_path = public`, per-user advisory lock + profile
  row lock, idempotent return, epoch check, rate limit, placement read from the SOURCE row, levels, Alpha Tester
  grant with ON CONFLICT DO NOTHING + auto-equip). Service role only. A backfill statement grants the title to
  any account already at Level 2+ (a no-op today).
- **Edge Function** `supabase/functions/submit-progression/index.ts`: verifies the JWT (anonymous sessions
  included) and hands off to the generated handler. One function, three modes (ranked / practice / tutorial).
- **Client** (`packages/ui/src/progression/`): the remote seam + capability probe, the durable account-bound
  queue (`ascent.progressionqueue`, key userId + runId + mode, oldest-first, duplicate = success, backoff
  5 s doubling to 10 min, a ranked item waits while its rank settlement is still queued), and a small zustand
  slice of its own (mirror adopted by highest revision, the current run keyed by seed). `store.ts` only calls
  the entry points: ranked XP is queued after the rank request; practice waits for its row id
  (`uploadPracticeGame` now returns it); a finished Learn Ascent run claims its one-time XP; identity boot and
  change probe + flush; a rank answer kicks the flush.
- **Postgame panel** under the rank result (after the rank sequence settles), on the practice end screen and on
  the tutorial card: breakdown, bar sweep (scaleX transition), level-up, Alpha Tester reveal, the guest "Save
  your progress" prompt (the account panel may now open over a finished run's end screen), "Progress pending.
  It will sync automatically." on failure, reduced motion, once-per-run ceremony. Continue stays the screen's
  own button.
- **Career:** an Account Level card at the top of the right column (level, bar, XP, equipped title; public for
  viewed players), the title under the player name, and a small guest reminder on your own page.

## Judgement calls (flag if wrong)

1. **Comeback is a client fact.** No server row records combat order, so the comeback flag comes from the run's
   fact document (ordinary-gameplay trust tier in the handoff). The SQL sanity-checks it: it needs 4+ losses and
   1+ win on the run's recorded record (the ranked `run_history` row, or the practice row); if no ranked history
   row is found, the claim stands.
2. **Practice rows are client-written**, so a determined player could insert fake practice rows for XP. The
   settlement is rate-limited (30 per 10 minutes, retried later, never reduced), the row must be the caller's
   own and post-epoch, and every settlement is audited with its facts. Replay verification is a later phase.
3. **No placement = Unlimited Health, or a practice row with no options recorded** (flat 60). Normal Health with a
   placement 1 to 8 scores like Ranked at 60%.
4. **Tutorial has no epoch check** (the claim itself is created at settle time). Replaying the course returns the
   original claim; the panel then says "Tutorial XP already earned."
5. **Titles show on the Career only.** Lobby name plates would need the title in the snapshot/seat data; left for
   the cosmetics phase.
6. **Pausing** by setting the epoch back to null hides the feature, and any request still queued then comes back
   `progression_disabled` and is dropped (a 409 is permanent). Pause only if you mean it.
7. **Returning player on a fresh device.** Signing into an EXISTING account from a new device switches to that
   account; XP earned by the throwaway guest session on that device stays with the guest id (unchanged account
   behaviour, same as rank and history).

## RUNBOOK (owner; the client is already safe to ship before any of this)

Replace `<project-ref>` and `<anon-key>` with the project's values (Supabase → Project Settings → API).

1. **Merge the PR and ship the client.** Nothing changes for players yet (the probe reads "off").
2. **Run the migration.** Supabase → SQL Editor → New query → paste the whole of
   `supabase/migrations/2026-09-27-account-progression.sql` → **Run**. It is idempotent (safe to re-run) and does
   not set the epoch.
3. **Check it landed** (same editor):
   ```sql
   select id, epoch from public.progression_config;          -- one row: 1 | NULL
   select account_xp, account_level, equipped_title_id from public.profiles limit 1;  -- 0 | 1 | NULL
   ```
4. **Deploy the Edge Function** from the repo root (Supabase CLI logged in and linked, the same way as
   submit-rating). The CLI bundles the generated `_shared/progressionRules.ts` and `_shared/progressionServer.ts`:
   ```bash
   supabase functions deploy submit-progression
   ```
5. **Check the function answers** (no write: the anon key is not a user, so this must return 401
   `unauthenticated`, which proves it is deployed):
   ```bash
   curl -i -X POST "https://<project-ref>.supabase.co/functions/v1/submit-progression" -H "Authorization: Bearer <anon-key>" -H "Content-Type: application/json" -d "{}"
   ```
6. **Turn it on: set the epoch** (SQL Editor). Games finished before this moment never earn XP:
   ```sql
   update public.progression_config set epoch = now(), updated_at = now() where id = 1 and epoch is null;
   ```
7. **Verify with an anon REST probe** (read-only):
   ```bash
   curl "https://<project-ref>.supabase.co/rest/v1/progression_config?select=epoch" -H "apikey: <anon-key>"
   curl "https://<project-ref>.supabase.co/rest/v1/profiles?select=account_level,equipped_title_id&limit=1" -H "apikey: <anon-key>"
   curl "https://<project-ref>.supabase.co/rest/v1/player_titles?select=title_id&limit=1" -H "apikey: <anon-key>"
   ```
   Expect a timestamp, the two columns, and `[]` (or rows once someone reaches Level 2).
8. **Play-test.** Reload the game (the probe runs at sign-in), finish a Practice game: the end screen shows the
   Account XP panel, and the Career shows Account Level. 250 XP reaches Level 2 (one tutorial completion, or a
   couple of Ranked / a few Practice games) and shows "Title unlocked: Alpha Tester".
9. **If anything looks wrong:** set `epoch = null` again (step 6 with `null`) to hide the feature; see judgement
   call 6 about queued requests.

## Verification

`npm run typecheck && npm run lint && npm test && npm run build:web` and `npm run docbot:report -- --check`
(results in the PR). Browser check on a local offline server (backend disabled, state injected): the practice
end screen panel (breakdown, level-up, title reveal, guest prompt) and the account panel opening over it.
