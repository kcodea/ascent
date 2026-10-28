# 2026-10-28 — Supabase cleanup Phase 0: measure, drift check, migrations ledger

Scope: [`docs/design/2026-10-28-supabase-cleanup.md`](../design/2026-10-28-supabase-cleanup.md) PRs 0.1-0.3. All
read-only against production except `db:apply`, which only the lead runs.

- **`npm run db:measure`** (`scripts/supabase/measure.mjs`) writes `docs/ops/db-reports/<date>-measure.md`: the stats
  window, size, deadlocks, temp spill, rollbacks, role timeouts; the **egress-weighted drivers** (calls from
  `pg_stat_statements` x bytes per answer, measured server-side with `octet_length` of exactly what the client selects);
  top targets by total time / mean / calls, grouped as `rpc:<fn>`, `read:<table>`, `insert:<table>`, `realtime:wal-poll`;
  every public table's size, dead tuples, scans and writes; pg_cron health. The first report
  ([`2026-10-28-measure.md`](../ops/db-reports/2026-10-28-measure.md)) reproduces the scope doc's numbers:
  `pool_runs_sample` 3,873 calls x 3.6 MB = 14 GB and 13.9 GB of temp spill, `insert:boards` 1.39 s mean / 7.7 s max,
  57 deadlocks, realtime WAL polling 24.8% of DB time.
- **`npm run db:drift`** (`scripts/supabase/drift.mjs`, built on the scope's prototype) compares every live `public`
  function body with the repo's LAST definition (schema.sql then migrations by filename), comments and whitespace
  normalized on both sides (a PGlite test pins that the JS and SQL normalizations agree). Verdicts OK / OLDER / NOMATCH /
  NOREPO / NOTLIVE; explained exceptions live in `scripts/supabase/drift-known.json`; exit 1 on anything new. Today:
  229 of 234 OK and 7 known findings, including one real one: **`god_board_sample` (2026-10-08) was never applied**, so
  God Mode runs on its startup-board fallback. Lead/owner call whether to apply it.
- **Ledger:** `supabase/migrations/2026-11-07-ops-schema-ledger.sql` creates a private `ops` schema and
  `ops.schema_ledger` (append-only: file, sha256 with CRLF normalized, applied_at, applied_by, commit, note) and seeds
  91 of the 92 existing files as `pre-ledger` with the drift evidence in the note (`npm run db:ledger -- --seed-sql`
  regenerates it). `npm run db:apply -- <file> --yes` runs a file, records it, then runs `db:drift`; without `--yes`
  it is a dry run; `--record-only` records a file applied by hand in the SQL Editor. `npm run db:ledger` lists PENDING
  and CHANGED files.
- The ledger file is dated 2026-11-07 so filename order stays apply order (the newest existing file is 2026-11-06).

Apply order for the lead: `npm run db:apply -- supabase/migrations/2026-11-07-ops-schema-ledger.sql --yes`, then
`npm run db:ledger` (expect only files merged after this PR as PENDING). No Edge Function redeploy.
