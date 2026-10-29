# 2026-10-28 — Versus on Cloudflare: Duos parity (fix/versus-cf-duos-parity)

Owner played Ranked Duos live on the Cloudflare host and reported: the game opened on the 1v1 view, the end of the
game hung and dropped everyone to the room showing "2nd", and no Cloudflare group match ever reached Supabase.

## Root causes
- **Results never landed (Ranked Duos).** `ranked_finish` sent the room's raw seat rows; `locked_at` / `auto_since` /
  `left_at` are epoch ms in the room but `timestamptz` in `versus_group_seats`, so `versus_cf_persist` threw ("date/time
  field value out of range") on every Ranked Duos result. The outbox retried it forever. Seats are now sent as ISO
  (`wireSeat`), and a job queued by the old build is fixed at send time (`wireRow`). Proven by replaying the real room's
  jobs through the real writer on PGlite (`versusCfParity.db.test.ts`). 1v1 / Group / Versus Duos jobs already landed.
- **Size.** The whole Ranked Duos result (six recordings, every fight's event log, every final board) can pass 2 MB,
  the limit of both the writer (`bad_row`) and a Durable Object storage value. A failed outbox put threw inside
  `apply()` BEFORE the pushes, so the final match row never reached anyone. Now: `fitFinishRow` trims archive-only data
  to 1.5 MB, a failed enqueue is logged and the pushes still go, and a job failing 10 times is set aside (`dead:`).
- **End screen hang.** `loadDuosResult` polls Supabase for the rating for ~15 s; with no write it gave up and showed
  the bare placement. Fixed by the above.
- **1v1 view at the start.** `LobbyPanel` chose the 1v1 block by seat count; a Ranked Duos table holds only the live
  pair until its recorded teams are seated (on Cloudflare: after both heroes lock, by the room). Now any group match
  shows the rail (`versusDuelLayout`). Same window existed on Supabase.

## Harness
- `ChaosScenario.onStep` (a per-step recorder) and the new parity test: same scripted match per mode on both hosts,
  compares layout, rail size, gem states and each player's final screen, then persists the Cloudflare match.
- The Supabase chaos server now grants new public tables to the API roles (Supabase's default ACL); without it a
  Ranked Duos client there could never read `versus_group_teams`, so its rail never showed the recorded teams.

## Not reproduced (see the PR)
- "Both ready, each waiting on the other": not reproduced in either harness (the gem states match host for host).
- Spectator end-of-combat jank: the harness has no spectator client yet.
- The repeated team on the rail: the table is picked by the same shared handler on both hosts; it served two recorded
  runs of one pair, including one of the live players (no exclusion rule exists on either host).
