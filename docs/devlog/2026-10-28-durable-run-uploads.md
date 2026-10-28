# 2026-10-28 — Durable, idempotent run-end uploads; no more downgrade ladders (Supabase cleanup 2.4-2.5)

Scope: [`docs/design/2026-10-28-supabase-cleanup.md`](../design/2026-10-28-supabase-cleanup.md) section 4. Rule:
R-NET-OUTBOX-01. Migration (not applied by the builder): `supabase/migrations/2026-11-07-durable-run-uploads.sql`.

**Problem.** The four run-end writes (boards, `run_telemetry`, `run_history`, `lobby_fights`) were one attempt each,
errors swallowed; the offline queue cleared itself up front and dropped failed items; and the board / telemetry
"fallback ladders" re-sent a poorer row on ANY error, a timeout included. `pg_stat_statements` shows the lower rungs
really fired in the 16-day window: 5 boards without strength, **2 boards without `unrated` (an unrated board stored as
rated)**, 10 telemetry rows without their set / source / derivation stamps. Failed statements never reach the stats, so
the drops themselves were invisible.

**Change (client, `packages/ui`):**
- `net/runOutbox.ts`: a durable outbox (IndexedDB `ascent.runoutbox`, memory fallback) modelled on the rank queue.
  Each write is an item with a dedupe key; it is sent in the same tick it is submitted (the Career row still leaves
  ahead of the rank request, `runEndUploadOrder.test.ts`), kept on a transient failure (network, timeout, deadlock,
  5xx, JWT refresh) with a 5 s doubling delay up to 30 min, retried on the timer, on `online`, at boot and on identity,
  oldest first, stopping at the first transient failure. A permanent rejection (RLS, bad data, a constraint) removes it
  and reports it; a write still failing after 5 tries is reported once and keeps retrying; overflow (60 items) evicts
  the oldest and reports it. Account-bound; a session-less item is adopted by the next session, its boards UNRATED.
- `remoteBoards.ts`: `uploadBoards`, `uploadRunTelemetry`, `uploadRunHistory`, `recordLobbyFights` build their rows and
  hand them to the outbox (signatures unchanged; `uploadRunTelemetry` takes `meta.uploadKey`, the store passes
  `seed|finishTime`). **Both ladders are gone.** A column is dropped only when the server names it as missing, and
  never `user_id` / `unrated`. Items in the old `ascent.uploadqueue` (older builds) move into the outbox on flush.
- Victory (`runs`) and profile writes are untouched (out of this PR's scope).

**Change (server):** `upload_key` on `boards` (generated: `snapshot->>'id'`), `run_history` (generated:
`seed|at` from the entry) and `run_telemetry` (sent by the client), each UNIQUE with `user_id` (NULLs never collide,
legacy rows untouched; production checked: every board has an id, every Career row a seed + at, no duplicates). The
client upserts with `on_conflict=user_id,upload_key` + ignore duplicates, so a retry after a committed timeout is a
no-op. Until the file is applied the client sees "no unique constraint" / "unknown column" and falls back, for the
session, to the plain insert. `report_write_failure(kind, key, error, detail)` (signed-in only, 50 per account per day,
texts cut) writes `ops.events` (private schema; the same table the pool job logs to).

**Not in this PR:** the pool triggers' swallowed errors are fixed by #2385 (the pool refresh moved to a job that logs to
`ops.events`). The client egress work (Phase 1) belongs to another builder; nothing here touches the reads.

**Daily digest (lead, read-only):**

```sql
select source, kind, detail ->> 'write' as write, left(detail ->> 'error', 80) as error, count(*), max(at)
from ops.events where at > now() - interval '1 day' group by 1, 2, 3, 4 order by 5 desc;
```

**Verification:** `net/runOutbox.test.ts` (11: classification, backoff, same-tick send, retry then success, reject +
report, duplicate = done, missing column vs protected `unrated`, keyless fallback, account binding + adoption, order
+ stop, report-after-5, overflow), `net/durableUploads.db.test.ts` (7, PGlite: keys, retries are no-ops, cross-account
and keyless rows never collide, an old client's duplicate is refused, the RPC's session / cap / cuts / grants),
`uploadQueue.test.ts` + `fightLedgerFetch.test.ts` updated to the outbox.
