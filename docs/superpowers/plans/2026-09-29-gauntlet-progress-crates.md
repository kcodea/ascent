# Gauntlet — PR 4 (Account progress + crates) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stage clears are stored on the player's account; the FIRST clear of each stage grants one standard crate;
replays grant nothing; players who aren't signed in keep device-only progress with a clear "no rewards" warning.

**Architecture:** A Supabase table `gauntlet_progress` + a service-role SQL function `record_gauntlet_clear` (claim-once,
advisory-locked, inserts the crate in the same transaction) behind a thin edge function `gauntlet-clear`, whose logic is
a pure handler in `packages/progression` (Node-tested, copied to Deno by `npm run progression:shared`). Crates today are
keyed on `earned_level`; Gauntlet crates carry `earned_level = null` + `source = 'gauntlet:<stage>'`. The UI's
`gauntletProgress` module becomes account-aware (account mirror + a retrying clear queue) while keeping its API.

**Tech Stack:** Postgres/Supabase (SQL migrations pasted by the owner; PGlite tests in CI), Deno edge functions, TS packages, React/Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-gauntlet-design.md` §6 · Builds on PR 3 (`packages/ui/src/gauntlet/gauntletProgress.ts`, store run-end hook, `GauntletEndScreen` `reward` slot, `StageSelect`).

## Global Constraints

- One row per `(user_id, stage)`; stage N unlocked iff N−1 has a row (stage 1 always). No separate unlock flag.
- `record_gauntlet_clear`: first clear → insert progress row AND one sealed `loot_crates` row in the same transaction,
  `crate_granted = true`; any later clear → no-op (`already_cleared`, no crate). Serialize with the existing per-user
  advisory lock key `'progression:' || user_id` so it can't race settlement/opening. Service-role only (revoke from public/anon/authenticated).
- **Trust the client** (owner 2026-09-29): the server does not re-simulate; it validates stage is an integer 1–10.
- **Not signed in = no account progress, no crates.** "Signed in" means a non-anonymous account (`identity.anonymous === false`).
  Guests and no-session players use the device-local store (`ascent.gauntlet.local`) and see: *"You're not signed in —
  progress is saved on this device only and clears won't grant crates."* The server also refuses anonymous users (403 `sign_in_required`).
  Signing in later does NOT merge or grant anything retroactively; the account's own rows take over.
- Cleared stage in stage select shows "Already cleared — no crate for replays".
- Offline clears queue and retry (own queue key; never the progression queue, whose mode enum is fixed).
- Level crates must behave exactly as before (settlement, opening, naming, ordering).
- Migrations: `supabase/migrations/2026-09-29-gauntlet-progress.sql`, idempotent, banner/header like `2026-09-28-progression-crates.sql`,
  appended identically to root `schema.sql`. The owner pastes it and deploys the function (documented runbook) — we can't run prod.
- Branch `feat/gauntlet-progress` off `feat/gauntlet-screens`. Gate: `npm run typecheck && npm run lint && npm test && npm run build:web`.

---

### Task 1: Migration + PGlite test

**Files:** Create `supabase/migrations/2026-09-29-gauntlet-progress.sql`, `packages/progression/src/gauntlet.db.test.ts`; append the same SQL to `schema.sql`.
- `loot_crates`: `alter column earned_level drop not null`; `add column if not exists source text`; add a check that a row
  has a level OR a source (`earned_level is not null or source is not null`); keep `unique (user_id, earned_level)` (NULLs don't collide).
  Existing level rows and `settle_progression`'s `on conflict (user_id, earned_level)` keep working unchanged.
- `gauntlet_progress (user_id uuid references auth.users on delete cascade, stage int check (stage between 1 and 10), first_cleared_at timestamptz not null default now(), crate_granted boolean not null default false, crate_id uuid references loot_crates(crate_id), primary key (user_id, stage))`; RLS on; owner-read policy for `authenticated`; no write policies.
- `record_gauntlet_clear(p_user uuid, p_stage int) returns jsonb`, `security definer set search_path = public`:
  validate stage (raise `bad_stage`); advisory lock (same key as settle/open); `insert … on conflict (user_id, stage) do nothing`;
  if no row inserted → `{ status: 'already_cleared', crate: null }`; else insert `loot_crates (user_id, earned_level, source, source_id)` =
  `(p_user, null, 'gauntlet:' || p_stage, 'gauntlet:' || p_stage)`, set `crate_granted = true, crate_id`, and return
  `{ status: 'first_clear', crate: progression_crate_json(<row>) }` (reuse the existing json helper; if it needs `source`, extend it compatibly).
  Honour `progression_config.crates_enabled`: when false, record the clear but grant no crate (`crate_granted = false`) — document it.
  Revoke/grant like `open_crate`.
- PGlite test modelled on `packages/progression/src/crates.db.test.ts` (read it — STUB schema, migrations applied in order from `supabase/migrations`):
  first clear → one crate with null level + source; second clear → `already_cleared`, still one crate; stage 0/11 → error;
  a level crate settlement afterwards still works (call the existing path the crates test uses); clients (anon/authenticated) cannot execute the function or write the table; owner can read own rows only; `crates_enabled = false` → no crate.
- Commit `feat(db): gauntlet_progress + record_gauntlet_clear (first clear grants a crate)`.

### Task 2: Progression package — handler + crate typing

**Files:** Create `packages/progression/src/gauntlet.ts` (+ `gauntlet.test.ts`); modify `packages/progression/src/cosmetics.ts`
(`CrateRow`, `parseCrate`, `crateName`), `packages/progression/src/index.ts`, `packages/progression/src/sharedArtifact.ts`
(+ run `npm run progression:shared` to generate `supabase/functions/_shared/progressionGauntlet.ts`).
- `handleGauntletClear(userId: string | null, anonymous: boolean, body: unknown, rpc: RpcCall, log?)` → `HandlerResponse`:
  401 `unauthenticated` (no user), 403 `sign_in_required` (anonymous), 400 `bad_body`/`bad_stage` (validate `{ stage }` integer 1–10),
  RPC `record_gauntlet_clear`, error mapping via a status map like `INVENTORY_ERROR_STATUS`, 200 `{ status, crate }` (crate parsed with `parseCrate`).
  Mirror `packages/progression/src/server.ts` / `inventory.ts` shapes exactly (read them).
- `CrateRow`: `earnedLevel: number | null`, new optional `source?: string`. `parseCrate` accepts a null level when `source`
  starts with `gauntlet:`; everything else unchanged. `crateName(crate)`-style helper: level crates keep their names;
  gauntlet crates → "Gauntlet Crate · Stage N". Keep `crateName(earnedLevel)` callers compiling (add `crateLabel(row)` rather than
  breaking the old signature if many callers use it; update UI callers that display crate names in Task 4).
- Tests: handler (all statuses, RPC args, error mapping) with a mocked `RpcCall`; `parseCrate` for level + gauntlet rows; `sqlParity`/`sharedArtifact` tests stay green.
- Commit `feat(progression): gauntlet-clear handler; crates can come from the Gauntlet`.

### Task 3: Edge function

**Files:** Create `supabase/functions/gauntlet-clear/index.ts` — copy `supabase/functions/progression-inventory/index.ts`'s
shape (CORS, OPTIONS, 405, env checks, user client for `getUser()`, service client `rpc`), read `userData.user.is_anonymous`
for the `anonymous` argument, call `handleGauntletClear` from `../_shared/progressionGauntlet.ts`. No tests exist for
functions (logic is tested in Task 2); make sure `npm run typecheck` / lint don't include or break on it (they skip `supabase/functions` today — verify).
Commit `feat(functions): gauntlet-clear edge function`.

### Task 4: Client — remote, queue, account-aware progress, crate labels

**Files:** Create `packages/ui/src/gauntlet/gauntletRemote.ts`, `packages/ui/src/gauntlet/gauntletClearQueue.ts` (+ tests);
modify `packages/ui/src/gauntlet/gauntletProgress.ts`, `packages/ui/src/store.ts` (run-end hook only), `packages/ui/src/progression/newRewards.ts`
(a `queueNewCrate` path that doesn't infer a level), crate-name call sites in `packages/ui/src/progression/*` (CrateBay/CrateOpener/NewRewardsPopup — grep `crateName`).
- `gauntletRemote.ts`: `submitGauntletClear(stage)` → `{ status: 'confirmed', result: { status, crate } } | { status: 'retryable' | 'rejected', reason }`
  via `supabaseClient().functions.invoke('gauntlet-clear', …)` with the same timeout/classification as `progressionRemote.ts`
  (reuse `classifyFunctionError` if exported, else mirror it); `fetchGauntletProgress(userId)` → cleared stage numbers from
  `gauntlet_progress` (owner-read), mapping "table missing" PG codes to "feature off" like the crate probes.
- `gauntletClearQueue.ts`: localStorage `ascent.gauntlet.clearqueue`, items `{ userId, stage, at, attempts, nextAttemptAt? }`,
  dedupe on userId+stage, backoff like `progressionQueue.ts`, flush sequentially, only for the current user; an `online` retry trigger.
- `gauntletProgress.ts` (keep its exported API): signed-in (non-anonymous, current user id) → `clearedStages()` = account
  mirror (`ascent.gauntlet.acct.<userId>`, refreshed by `fetchGauntletProgress` on app start / sign-in / after a clear) ∪ that
  user's queued clears; otherwise the device-local list as today. `recordClear` for a signed-in player enqueues + optimistically
  marks the mirror and returns `firstClear` from the mirror (the server remains the authority for the crate). Add
  `gauntletAccountMode(): 'account' | 'local'`.
- Store run-end hook (where PR 3 calls `recordClear`): after recording, when in account mode, flush the queue; on a confirmed
  `first_clear` with a crate → `queueNewCrate(userId, crate)` + `refreshCrates()` + set store `gauntletReward = { crateId, stage }`.
  Keep the rest of the run-end block unchanged.
- Tests (jsdom + the mocking pattern of `packages/ui/src/progression/progressionQueue.test.ts`): remote classification; queue
  dedupe/backoff/user binding; account vs local mode switch (anonymous → local); signing in doesn't import local clears;
  first confirmed clear queues the crate once, a repeat doesn't.
- Commit `feat(ui): Gauntlet clears save to the account and grant a crate on first clear`.

### Task 5: Player-facing surfaces

**Files:** `packages/ui/src/gauntlet/StageSelect.tsx`, `packages/ui/src/gauntlet/GauntletEndScreen.tsx` (+ tests), styles.css.
- StageSelect: in local mode show the banner *"You're not signed in — progress is saved on this device only and clears won't grant crates."*
  (with a "Sign in" button → `openAccountPanel` if that store action exists); cleared slots show *"Already cleared — no crate for replays"* (small tag / `.gtip`).
- GauntletEndScreen `reward` slot: when `gauntletReward` matches this stage → a crate card *"You earned a Crate!"* with
  **Open in Collection** (opens the Collection screen; find the store action) — reuse existing crate art/classes from
  `packages/ui/src/progression/`; while the claim is pending show *"Saving your clear…"*; in local mode on a clear show
  *"Sign in to earn crates from Gauntlet clears."*; on a repeat clear nothing.
- Tests for each state.
- Commit `feat(ui): Gauntlet crate on the win screen, signed-out banner, replay note`.

### Task 6: Rule, docs, runbook, gate

- Oracle: `R-GAUNTLET-05` at the END of `packages/rules/src/registry/approved/foundation.ts`: the first clear of each stage
  grants one standard crate to a signed-in account; later clears grant nothing; players who aren't signed in keep progress
  on the device only, get no crates, and signing in later grants nothing retroactively. Evidence (owner quotes):
  "clearing each stage grants a crate", "players can replay stages they've already cleared, but will not get any more rewards for clearing it more than once",
  "lets not require sign-in, but let the player know with a warning that they will not get rewards for any progress made",
  "signing in later would not grant them rewards", "progress should be stored on account level", "yes, trust the client for now".
  Enforcement: the db test + the UI tests. Run `npx vitest run packages/rules` + `npm run docbot:report -- --check`.
- `docs/GAME-RULES.md` Gauntlet section: add the sign-in / crate lines if missing.
- Devlog `docs/devlog/2026-09-29-gauntlet-progress-crates.md` with the **owner runbook**: paste the migration into the Supabase SQL
  editor (after the latest progression migration), then `supabase functions deploy gauntlet-clear`; until then the client
  degrades to "feature off" (clears still count on the account mirror/queue and retry later).
- `patchNotes.ts`: extend the Gauntlet entry: the first clear of each stage earns a crate (signed-in players).
- Full gate — report real summaries.
