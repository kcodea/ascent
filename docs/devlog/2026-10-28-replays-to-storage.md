# 2026-10-28 · Replays move to Storage (cleanup Phase 4.1)

Owner ruling 2026-10-28: "move to cheap storage, keep all". `run_telemetry.replay` was 121 MB of a 254 MB database
(409 rows, 385 MB as text).

- **Migration** `supabase/migrations/2026-11-07-replays-storage.sql`: private bucket `replays` (a session uploads only into
  `<its uid>/`, never overwrites; any session reads, matching the table's visibility); `run_telemetry.replay_path /
  replay_head / replay_sha256 / replay_bytes / replay_copied_at`; the `tp_*` facts become plain columns (values kept)
  filled by a trigger from `replay` or `replay_head` with the generated columns' own expressions (clients can no longer
  write facts, and a path must sit in the owner's folder); `maint.replay_head`, `maint.run_telemetry_replay_report()`,
  `maint.run_telemetry_clear_copied_replays(phrase, limit)`.
- **Client**: `replayStorage.ts`. A new game uploads gzipped JSON and inserts the row with `replay: null`, the pointer and
  the head; any failure falls back to the inline row (old ladder untouched). Every Watch path reads `replay_path` and
  plays the inline replay or the object (`v2OfRow`), and filters by `tp_seed` / `tp_v2_version` (a stored row's
  `replay` is null). A backend without the column answers the exact old selects.
- **Backfill**: `npm run replays:backfill` (service-role key from the untracked root `.env`): `replay::text` -> gzip ->
  upload `<uid>/rt-<id>.json.gz` -> download -> byte-equal + gunzip-equal -> records sha256/bytes on the row.
  `--dry-run`, `--max N`, `--restore` (writes Storage-only replays back, sha-checked).
- **Clear** (lead): nulls `replay` only where the column still hashes to the proof, writing `replay_head` in the same
  statement, so the list facts never change.

Proof: `replayStorage.db.test.ts` (facts identical to the generated columns for old, new and cleared rows; the client and
SQL heads agree; bucket policies; clear guarded by the proof), `replayStorage.test.ts`, `careerWatch.test.ts`,
`packages/tools/src/replays/backfill.test.ts`. Not moved: `practice_games.replay` (8.5 MB) and `perf_runs`.
