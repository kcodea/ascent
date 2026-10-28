# 2026-10-27 — Versus server reliability: one resolver, auto-resume, lock-free presence, no stuck resolving

Owner, after a night of End of Turn freezes: Versus 1v1, Group, Duos and Ranked Duos "need to be spotless
experiences"; "disconnect/reconnects werent done correctly, where it would simply pause when someone returned".
This is the SERVER half (branch `fix/versus-server-reliability`); the client half is `fix/versus-client-reliability`.

## What changed (migration `supabase/migrations/2026-11-02-versus-server-reliability.sql`, NOT applied)

1. **One close, one resolver** (R-VERSUS-CLOSE-ONCE-01). The six close paths answer `closed_by_me`. The commit RPCs
   answer a duplicate save of a committed round from a plain read (no match lock).
2. **Auto-resume** (R-VERSUS-AUTO-RESUME-01). The paused player's own heartbeat sets `resume_at = now + 3 s` (same 3-2-1 as
   Unpause / Resume), in Hero Select and the shop, 1v1 and Group / Duos. `versus__resume` now always clears `resume_at`
   (the 10-14 trio defined it twice; the shop-start copy did not clear it), and every new pause clears a stale one.
   After the grace, any other player may still Unpause (unchanged and confirmed by test).
3. **Lock-free presence** (R-VERSUS-LEASE-01). The heartbeat no longer takes the match lock unless it must change the match
   (its own auto flag, the 3-2-1), and then under `lock_timeout = 2s` with the step skipped on timeout; presence is
   always written. Reconciles do a lock-free first look and return without a lock when nothing is due. Lease 12 s -> 14 s
   (`versus__lease()`): 4 s beats, so two whole missed beats + a third allowed 2 s of round trip / lock wait.
4. **Resolving timeout** (R-VERSUS-RESOLVE-TIMEOUT-01). A BEFORE UPDATE trigger stamps `resolving_since` and
   `resolve_deadline` (+10 s) on every move into resolving (both match tables). A reconcile past the deadline bumps
   `resolve_retry` (+ revision) and sets a new deadline; at 90 s unpaused, or at the first window after versus-resolve
   logged a handler `engine_mismatch` / `content_mismatch` for that round, the match ends `end_reason = 'void'` (no
   winner; Ranked Duos `unrated = 'void'`, live team placed in the lowest open place, nothing settled). Chosen over
   replaying the round (clients' runs would diverge from the committed rounds) and over inventing a result.
5. **Sweep** (R-VERSUS-SWEEP-01). `versus_sweep()`: 1v1 / Group / Duos matches nobody has beaten in for 10 minutes end
   'abandoned'; runs the Ranked Duos sweep (now SKIP LOCKED too); prunes events > 14 days. Candidates `FOR UPDATE SKIP
   LOCKED`, 50 per mode per run, via new partial indexes on open matches. Cron: `2026-11-02-versus-sweep-cron.sql`
   (every 2 min, replaces the `ranked-duos-sweep` job).
6. **Ranked Duos auto visible** (R-RANKED-DUOS-AUTO-VISIBLE-01). Reconcile auto on/off touches the match row.
7. **`versus_events`** (R-VERSUS-EVENTS-01). Service-role-only log (pause, resume, resume_request, close, resolve_ok with
   ms, resolve_err, resolve_retry, void, auto_on, auto_off, sweep_end). `versus-resolve` records `resolve_err` on any
   failed match action for a signed-in caller (stage `identity` / `handler` / `exception`).

## Client contract (for fix/versus-client-reliability)

All additive; an old client keeps working.

- **`closed_by_me: boolean`** — top-level key on the jsonb answer of `versus_submit`, `versus_reconcile`,
  `versus_group_submit`, `versus_group_reconcile`, `versus_ranked_duos_submit`, `versus_ranked_duos_reconcile` (and
  `versus_group_reconcile` / `versus_group_submit` when they hand a Ranked Duos match over). `true` on exactly one call per
  round. Kick versus-resolve immediately ONLY when `closed_by_me === true`. If the key is ABSENT (server without this
  migration), keep the old behaviour.
- **Match row (to_jsonb, so also Realtime + every match json): `resolving_since`, `resolve_deadline` (timestamptz or
  null), `resolve_retry` (int, 0 on entering resolving).** When `resolve_retry` goes UP for the current round, kick
  versus-resolve once (any client). The 4 s "backstop" kick in R-DUOS-FLOW-01 can become this signal.
- **`end_reason: 'void'`** (both match tables, winner null): "the fight could not be settled". Add it to the
  `end_reason` unions in `versusRemote.ts`; treat like `abandoned` for records / XP (winner null). Ranked Duos:
  `unrated: 'void'`.
- **Auto-resume:** after a reconnect the heartbeat answer's `match.resume_at` / `groupMatch.resume_at` is set; the client
  needs no Resume press (keeping the button is harmless: `versus_request_resume` is a no-op once `resume_at` is set).
  Reconcile at/after `resume_at` as today to resume.
- **Lease is 14 s** (was 12 s). Any client-side "gone" display keyed to 12 s should use 14 s.
- Heartbeat / commit answers are otherwise unchanged (`alreadyCommitted` already existed).

## Deploy notes (for the lead)

- Apply `2026-11-02-versus-server-reliability.sql`, then `2026-11-02-versus-sweep-cron.sql`.
- `versus-resolve` redeploy is OPTIONAL (only adds `resolve_err` logging, which enables the fast void on a content
  mismatch); no engine/content change, so parity is unaffected. Without it, a mismatched round voids at 90 s.

## Verification

- `packages/sim/src/versus/versusReliability.db.test.ts` (22 cases, PGlite, every mode).
- The migration is appended to `versusReady`, `rankedDuos` and `rankedDuosParty` DB suites (all still green, incl. a full
  Ranked Duos match through the real finalize + commit).
- `versusLockOrder.test.ts` proves the lock order after this migration; it now treats a SKIP LOCKED row as held (never
  waited for), which is what it is.
- Not testable in PGlite (one connection): real lock contention. Proved structurally instead: `pg_locks` inside the
  heartbeat's / reconcile's / duplicate commit's own transaction shows no match-row lock.
