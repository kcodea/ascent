# 2026-09-29: Gauntlet progress on the account, and a crate for each stage's first clear

Gauntlet PR 4 (branch `feat/gauntlet-progress`, on top of the Gauntlet screens PR). Oracle **R-GAUNTLET-05**;
GAME-RULES "Gauntlet". Spec: `docs/superpowers/specs/2026-09-29-gauntlet-design.md`.

Owner rulings (2026-09-29): *"clearing each stage grants a crate"*; *"players can replay stages they've already
cleared, but will not get any more rewards for clearing it more than once"*; *"progress should be stored on account
level"*; *"lets not require sign-in, but let the player know with a warning that they will not get rewards for any
progress made"*; *"signing in later would not grant them rewards"*; and, asked whether the server should re-check a
clear, *"yes, trust the client for now"*.

**No player gets a Gauntlet crate until the owner runs the runbook below.** Until then signed-in clears wait in a
retrying queue (see "Before the runbook").

## What the player sees

- **Signed in** (a real, non-anonymous account): cleared stages belong to the account and follow it to any device.
  The first clear of a stage shows "Saving your clear…" on the win screen until the server answers, then the crate
  ("You earned a Crate!", Open in Collection). The crate is named "Gauntlet Crate · Stage N" and opens like any other.
- **Replays:** a cleared slot in the stage select says "Already cleared. No crate for replays." A replay's win screen
  shows no crate.
- **Not signed in, or a guest** (an anonymous session counts as not signed in): every unlocked stage still plays. The
  stage select shows "You're not signed in. Progress is saved on this device only, and clears won't grant crates."
  and the win screen offers "Sign in to earn crates from Gauntlet clears." with a Sign in button.
- **Signing in later** switches to the account's own progress. The device's clears are NOT imported and grant nothing
  retroactively; they stay on the device for when the player is signed out again.

## How it works

- **Server** (`supabase/migrations/2026-09-29-gauntlet-progress.sql`, also appended to `schema.sql`):
  - `gauntlet_progress`: one row per (user, stage) cleared. Stage N is unlocked iff N-1 has a row (stage 1 always);
    no separate unlock flag. Owner-only read; clients never write.
  - A **Gauntlet crate is an ordinary `loot_crates` row with `earned_level` NULL and `source = 'gauntlet:N'`.** Level
    crates are untouched: they keep their level, a null source and the unique (user, level) key the settlement's
    `on conflict` relies on (NULL levels never collide). A check requires a level OR a source; one crate per source
    per account. `open_crate` opens both kinds alike; `progression_crate_json` now carries `source`.
  - `record_gauntlet_clear(user, stage)` (service role only): the first clear inserts the progress row and one sealed
    crate in the same transaction (`first_clear` + the crate); every later clear is `already_cleared`, no crate. It
    validates the stage (integer 1 to 10) and nothing else (trust the client), and takes the settlement's per-user
    advisory lock (`'progression:' || user_id`) so it can't race a settlement or an open.
  - **`crates_enabled` only gates OPENING.** A first clear always grants its crate (banked sealed while the switch is
    off), exactly like level crates. Gating the grant would lose that stage's crate forever, since a replay never
    grants one.
- **Edge Function** `gauntlet-clear` (logic in `packages/progression/src/gauntlet.ts`, generated into
  `supabase/functions/_shared/progressionGauntlet.ts`): body `{ stage }` only; 401 without a verified caller,
  **403 `sign_in_required` for an anonymous account**, 400 `bad_stage`, then the one SQL call with server-side args.
- **Client** (`packages/ui/src/gauntlet/`):
  - `gauntletProgress.ts`: two stores behind one API. Signed in = a mirror of the account's rows
    (`ascent.gauntlet.acct.<userId>`) plus that account's queued clears; otherwise the device list
    `ascent.gauntlet.local`, exactly as before. Only the latest account refresh writes the mirror.
  - `gauntletClearQueue.ts`: a signed-in clear is written to its own durable queue (`ascent.gauntlet.clearqueue`,
    never the progression queue) before it is sent; exponential backoff, retried on boot, sign-in and the `online`
    event; a flush called mid-flush runs its own pass afterwards so no clear is missed.
  - The crate is queued in New Rewards once per crate id; the win screen shows it only for the stage just cleared.

## Owner runbook

1. **Merge the PR and ship the client.** Safe before the server work: see "Before the runbook".
2. **Paste the SQL.** Supabase, SQL Editor, New query: paste ALL of `supabase/migrations/2026-09-29-gauntlet-progress.sql`
   and Run. Expected: "Success. No rows returned". It must run AFTER `2026-09-29-hero-titles.sql` (the newest
   progression file) and every earlier progression file. It replaces `loot_crates_transition_guard` and
   `progression_crate_json` from `2026-09-28-progression-crates.sql`: if that file is ever re-run, run this one again
   after it. Idempotent: safe to re-run.
3. **Verify in the same editor** (expected answers in the comments):
   ```sql
   select to_regclass('public.gauntlet_progress') is not null;                           -- true
   select count(*) from pg_proc where proname = 'record_gauntlet_clear';                  -- 1
   select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'loot_crates' and column_name = 'earned_level';  -- YES
   ```
4. **Deploy the Edge Functions** from the repo (Supabase CLI logged in):
   ```
   npx supabase functions deploy gauntlet-clear --project-ref zcwhbejpqcdcfdpfxeza
   npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza
   ```
   `gauntlet-clear` is new. `progression-inventory` must be redeployed too: its bundled crate parser now accepts a
   crate with no level and a `gauntlet:N` source. The currently deployed copy would answer `inventory_malformed`
   when a Gauntlet crate is opened (level crates are unaffected).
5. **Smoke test:** sign in, clear stage 1, and check the win screen shows the crate and the Collection lists a
   "Gauntlet Crate · Stage 1" that opens. Clear it again: no crate.

## Before the runbook (what the shipped client does)

- The feature is effectively off. A signed-in clear still counts at once on the account mirror (the next stage
  unlocks), and it waits in the clear queue: `gauntlet-clear` not deployed (404) is retryable, so the queue backs off
  and retries on boot, sign-in and network return, and each queued clear is sent once the function exists. No crate
  is granted until then.
- The account read of `gauntlet_progress` answers "off" while the table is missing; the mirror is simply kept.
- **Crates keep loading:** the crate list reads the new `source` column and, if the server doesn't have it yet
  (`42703` / `PGRST204`), falls back to the old column list (`packages/ui/src/progression/progressionRemote.ts`).
- Guests and players who are not signed in are unaffected: device-only progress, no queue, no crates.

## Design notes

- **Gauntlet crates are `loot_crates` rows** (`earned_level` NULL + `source 'gauntlet:N'`), so opening, the New
  Rewards pop-up and the Collection's crate bay needed no new path; only naming (`crateLabel`) and ordering (level
  crates first, then level-less ones) learned about sources.
- **`crates_enabled` only gates opening**, never the grant (see above).
- **Guests count as not signed in.** "Signed in" is `identity.anonymous === false`. The client never queues a guest's
  clear, and the server refuses an anonymous caller (403) as a second line.
- **Trust the client** (owner): the server doesn't re-simulate a stage. Server-side verification is future work if
  crates ever carry real value.
