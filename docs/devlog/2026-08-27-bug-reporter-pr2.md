# Bug reporter PR 2 — durable queue + Edge Function upload

**Branch:** `feat/bug-reporter-queue` (PR 2/5 of the bug-reporter blueprint; client half only — the
`submit-bug-report` Edge Function + `bug_reports` table shipped separately and are already deployed).

## What shipped

The Ctrl+B reporter's submit path is now the real thing (blueprint §1.3 / §6): validate → **persist to a
durable local queue** → close the modal + resume play → upload asynchronously → toast `Report sent. Thank
you.` on success or `Report saved. It will send when you reconnect.` otherwise. Submitting never blocks
gameplay on network latency, and a report survives a crash immediately after submission.

- **`bug-report/bugReportQueue.ts`** — the queue (§6.1). IndexedDB, in its OWN database
  (`ascent.bugreports`), deliberately NOT the existing localStorage upload queue: capsules are hundreds of
  KB and must never evict board/career uploads (or vice versa). Patterns copied from
  `replay/replayDraft.ts` (lazy shared open, resolve-never-reject). Retention: max 25 reports, oldest
  evicted; a report is NEVER discarded merely because upload attempts failed. Where IndexedDB is
  unavailable the store degrades to a session-lifetime memory mirror **and reports it** (`'memory'`), so
  the §13 row (immediate upload attempt + non-blocking warning) can happen.
- **`bug-report/bugReportUpload.ts`** — upload via `supabase.functions.invoke('submit-bug-report')` on the
  SAME client/session as every other write (`remoteBoards.supabaseClient()`, a new narrow export). Delete
  from the queue ONLY after the server returns an id. Idempotency is free: the server dedupes by
  `client_report_id` (= `envelope.reportId`), so a retried upload gets 200 with the original id — 200 and
  201 both count as success. Retry triggers (§6.2): app boot, the browser `online` event, auth restoration
  (wired beside `flushUploadQueue` at both identity sites in the store), and an in-session
  exponential-backoff timer (30s · 2^n, cap 15 min). Failure classification: 413/422 = server REJECTION —
  retained with the response code recorded, parked ~6h so a fixed build can pick it up; 401/429/5xx/network
  = transient backoff; no-session/no-backend = not an attempt at all (report stays `queued`, zero backoff
  burned, the auth trigger re-fires). The §3.5 trim ladder (`trimEnvelope`) runs before persisting and
  would run on 413: drop previous-wave frames, then UI details, marking `contextTruncated` — authoritative
  combat events are never trimmed.
- **Store seam** — `submitBugReport` now awaits `enqueueBugReport` before closing (persistence-before-close
  is the §14.4 contract), keeps the DEV JSON export, and reports through the existing `bugReportToast`.
- Patch notes entry (the player-facing loop is now complete) + §14.4 tests in
  `bug-report/bugReportQueue.test.ts` (persistence-before-close through the real store, reload survival via
  a minimal in-test IndexedDB stub, success-deletes, failure-retains-with-backoff, idempotent retries,
  the 25-cap, isolation from `ascent.uploadqueue`, trim ladder).

## Judgement calls (flag for review)

- `remoteBoards.ts` gained one export (`supabaseClient()`) rather than bug-report code building a second
  client or remoteBoards absorbing the bug upload.
- A server rejection parks 6 hours instead of retrying on the session backoff — the server already said no
  to this exact payload; boot after a redeploy is the realistic fix window.
- The repo has no fake-indexeddb dependency; the reload-survival test carries a ~90-line minimal IDB stub
  local to the test file instead of adding a dev dependency.
