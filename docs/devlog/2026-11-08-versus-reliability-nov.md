# 2026-11-08 · Versus reliability pass: 1v1 persistence verdict, a half-open reconnect, the double pause

Owner bar: Versus (1v1, Group, Duos, Ranked Duos) must be "spotless". Branch `fix/versus-reliability-nov`. Rules
R-VERSUS-CF-HANDSHAKE-01, R-VERSUS-GROUP-UNPAUSE-01.

## 1. Cloudflare 1v1 results ARE persisted (the lead was "zero cloudflare rows in versus_matches")

Read-only checks on the live project (2026-11-08):

- `versus_matches`: 88 rows, all `backend = 'supabase'`, the newest 2026-10-26 16:58. `versus_group_matches` has 13
  Cloudflare rows (1 Duos, 12 Ranked Duos) from 2026-11-01 to 11-05, and no Cloudflare `group` (3-4 player) row either.
- The deployed `versus_cf_persist` is the 2026-11-07 version; its `match` / `round` branches are byte-for-byte the
  2026-11-04 writer's. Every column the room sends exists with a compatible type; the only triggers on `versus_matches`
  (`lobby_live__versus_trg`, `versus__phase_watch`) swallow their errors or only touch `resolving`.
- `versus_host_config` has had `duel = 'cf'` since 2026-10-28; the writer key for the release Worker
  (`ascent-versus-v2-8a6257b2`) was added 2026-11-08 01:32, beside the v1 Workers' keys.
- `progression_results` (mode `versus`) has no row since 2026-10-25 whose match is missing from either table: every
  settled Versus game has its match row, and the last 1v1 settle is 2026-10-26.

What was never proved: that the rows the ROOM queues fit the SQL (`cfWriter.db.test.ts` sends a hand-built row). New
`workers/versus/test/cfWriter1v1.db.test.ts` drives a real `RoomCore` 1v1 (create, gate, heroes, shops, fights) and
feeds every `PersistJob` it emits, in order, through `wireRow` into the real migrations in PGlite, as `SupabaseRpcSink`
does. All end reasons land: Health 0 (one `versus_rounds` row per fight, scouts kept), concede, leaving, missed (three
auto rounds), abandoned, void; a second match in the same room is its own row. **Verdict: the path works; the empty
table means nobody finished a 1v1 on a persisting Worker since the cutover** (consistent with the group table: almost all
recent Versus play is Ranked Duos). Note the row is written at create, after every round and at the end, so a match
abandoned in Hero Select stays `hero_select` until its final write.

Side finding (ops, not code): today's health cron fails `versus_worker` because the site's `release.json` still points at
`ascent-versus-v1-63fb56b5` (cfProtocol 1) while main expects protocol 2. Expected until the next exe/pack ships.

## 2. Harness runs (local only, nothing against the live backend)

- `npm run versus:cf:test` (workerd, wrangler 4.149, Node 24): 41/41.
- Chaos matrix, `CHAOS_FULL=1`, on main before any change: **127/127**.
- New cells (`versusChaosCf.test.ts` CF_EXTRA), the paths no chaos client ever drove (they never pressed Concede or
  Unpause): `concede` and `concedeInFight` (all five modes), `goneForGood` (unpause, auto, out; duel/group3/group4/duos),
  `autoReturn` (back while on auto: no new pause, nobody waits), `twoGone` (two players drop together; group3/group4/duos).
  First run: every cell clean except `twoGone` (a real bug, below) and the two Ranked Duos concede cells (a harness false
  positive: a Ranked Duos concede leaves the party for good, so the player's room screen is not "stuck"; the snapshot now
  carries `left` and `stuck` skips it). Smoke gains `concede/ranked_duos`, `goneForGood/duel`, `twoGone/duos`.
- Full matrix after the fixes: see the PR.

## 3. Bugs found and fixed

**A reconnect could hang half-open for good (R-VERSUS-CF-HANDSHAKE-01, client).** The keep-alive (ping 5 s, stale 15 s)
only starts once the room answers the hello, and the hello's timer only forgot the request. A socket whose upgrade or
hello was lost (a phone changing networks while it reconnects; no close ever arrives) stayed not-ready with no watchdog:
every request queued behind it timed out, nothing replaced it, and the returning player sat on a frozen screen while the
match went on. `connectTimeoutMs` covered the first connect only. Now every socket must finish its upgrade and hello in
8 s or it is dropped and retried on the normal backoff; queued requests go out on the replacement.
`workers/versus/test/clientHandshake.test.ts` (2 of 3 fail without the fix). The chaos harness cannot reach this: its drop
closes the socket at once, and its hang holds every frame, so neither leaves a socket open without a hello.

**Two players gone together cost two pauses, and the match could sit paused (R-VERSUS-GROUP-UNPAUSE-01, Worker).** Group /
Duos `unpause` put only the paused seat on auto. At the resume, the match paused again at once on the other absent seat
with a FRESH 30 s grace, so the players still in waited 30 s + 3 s + 30 s + 3 s and had to press Unpause twice; without
the second press the match sat paused (chaos `twoGone`: stuck in round 2 for the whole 7 minute cap, in every 3-4 player
mode). Now one Unpause puts on auto every absent player whose own grace is over, and a re-pause on a player still gone
shows only the rest of THEIR grace (measured from their own close). `groupCore.test.ts` (2 new; both fail without the fix).
Not a fight-rules change, so no `VERSUS_CF_PROTOCOL` bump (R-VERSUS-WORKER-RULES-01); 1v1 is unaffected (two seats).

## Not covered (needs real clients)

The chaos harness runs the real store and transport but not the screens' render: animation-frame timing, the End of Turn
animation actually painting, the browser's own WebSocket/TCP behaviour on a network change (the handshake bug was found
by reading the client, not by the harness), mobile backgrounding beyond the throttle model, and the exe build. Those
still need a two-machine pass (or `scripts/versus-qa` headless shells on a local Worker).
