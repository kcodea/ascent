# Versus on Cloudflare Durable Objects (design + 1v1 spike)

> Owner decision 2026-10-28: move live Versus (1v1, Group 3-4, Versus Duos, Ranked Duos) off Supabase SQL functions +
> Postgres Changes onto Cloudflare Durable Objects. Built in parallel; Supabase Versus keeps serving players until a
> flag cutover. This document is the architecture; `workers/versus/` is the working 1v1 spike (local only: no
> Cloudflare account yet, nothing deployed, nothing written to Supabase).
>
> Why: the forensic audit (`chore/versus-reliability-audit`, PR #2362, `docs/devlog/2026-10-27-versus-server-reliability.md`)
> traced the End of Turn freezes, false pauses, deadlocks and pause/resume bugs to the architecture itself: clients
> race to call a separate resolver (2-15 s resolves, duplicate calls), state is shared through row locks, presence is a
> 12 s heartbeat lease, and every change reaches clients as a "re-read the row" wake-up over a reused Realtime channel
> plus polling. Each symptom has a Supabase fix landed or landing; this removes the class.

## 1. Shape

```
 browser ──HTTPS──▶ Worker (ascent-versus)                         Supabase (unchanged role: identity + records)
   │                 ├─ GET  /health          (no auth)              ├─ auth: JWKS for access tokens  ◀── Worker verifies
   │                 ├─ POST /rooms           ──▶ Room DO.init()     ├─ versus_matches / versus_rounds ◀── Room DO outbox
   │                 ├─ GET  /rooms, /rooms/open ─▶ Directory DO     ├─ settle_progression (XP), versus_records (reads)
   │                 └─ GET  /me/room          ─▶ Directory DO       └─ snapshots, duo_runs, ratings, Live Games, friends
   └──WebSocket──▶ /rooms/<id>/ws ──▶ Room DO "<roomId>" (one per room, holds its current match)
                                         memory: room, members, match, private rows, current-round submissions, rounds
                                         storage (SQLite-backed KV): the same, split per key (write-through)
                                         ONE alarm: the earliest deadline (gate, hero, intro, shop+250 ms, combat, resume,
                                                    disconnect grace, abandon, prune, persistence retry)
                                         engine: @game/sim/versus/server (the exact versus-resolve bundle entry)
```

- **One Durable Object per room, named by the room's uuid.** A room outlives its matches (GAME-RULES "Rooms are
  continuous"), so the match lives inside the room's object: no cross-object hop between "room" and "match", and every
  rule that touches both (start, leave-concedes, complete-reopens) is one synchronous function.
- **One Directory object** (`idFromName('global')`) replaces `versus_list_rooms`, `versus_open_rooms` and the
  one-room-per-account unique index. Rooms push a listing summary to it when it changes; it is never on a round's path.
- **The engine runs in the object.** `workers/versus` imports `@game/sim/versus/server`, the same entry
  `npm run versus:bundle` ships to `versus-resolve`. The round is resolved by calling `handleVersusFinalize` (the Edge
  Function's own handler) over an in-memory store, so there is exactly one implementation of resolve + damage + pools.
  Wrangler bundles it (1.82 MB, 427 KB gzipped: inside the Workers Paid 10 MB limit).
- **The rules are a pure state machine** (`workers/versus/src/core/roomCore.ts`), ported function by function from the
  1v1 SQL. The object (`room.ts`) is a shell: sockets, storage, alarm. `now` and seeds are injected, so the rules are
  tested on a fake clock in the ordinary `npm test` (`workers/versus/test/roomCore.test.ts`, 21 tests).

## 2. Message protocol (client ⇄ room)

Defined in `workers/versus/src/protocol.ts` (`VERSUS_CF_PROTOCOL = 1`), used by the game's dev transport, the
integration tests and the measurement script through one client (`workers/versus/src/client.ts`).

| Direction | Frame | Meaning |
|---|---|---|
| C → R | `{t:'req', id, op, args}` | A request; answered once by `res` with the same id. Ops = the SQL RPCs: `hello`, `join`, `take_seat`, `leave`, `start`, `gate`, `set_options`, `register_offer`, `pick_hero`, `reroll_hero`, `submit`, `unready`, `intro_done`, `combat_ready`, `forfeit`, `unpause`, `request_resume`, `heartbeat`, `publish_frame`, plus reads `sync`, `rounds`, `my_private`, `my_checkpoint`, `latest_frames`. |
| C → R | `{t:'bc', event, payload}` | Relay to every other member (spectator frames, cursors, emotes): what the Realtime broadcast channel carried. |
| C → R | `ping` (text) | Keep-alive every 5 s, answered `pong` **by the runtime without waking the object** (`setWebSocketAutoResponse`). |
| R → C | `{t:'res', id, ok, data \| error, now}` | The answer: the same row json the SQL function returned (`versus__room_json`, `versus__match_json`, ...), error codes identical. |
| R → C | `{t:'room'}`, `{t:'match'}`, `{t:'round'}`, `{t:'priv'}` | State pushes. A committed round is pushed **before** the match row that moved to `combat`, in one burst, so a client that sees `combat` already holds the fight. `priv` (hidden hero offer) goes only to that seat's sockets. |
| R → C | `{t:'bc', event, payload, from}` | A relayed broadcast. |

Rows keep the Supabase shapes, so `versusStore.ts` runs unchanged over either transport. The difference is the
cadence: the Supabase build sends "something changed, re-read it" and the client reads; here the change IS the message.

## 3. Auth

- The player's existing Supabase access token, sent as the WebSocket subprotocol `bearer.<jwt>` (a browser cannot set
  an Authorization header on a WebSocket; a token never goes in a URL), or `Authorization: Bearer` on HTTP.
- The Worker verifies it locally with WebCrypto (`src/auth.ts`): ES256/RS256 against the project JWKS
  (`/auth/v1/.well-known/jwks.json`, cached 10 min, refetched on an unknown `kid`), or HS256 when the legacy
  `SUPABASE_JWT_SECRET` is set. Checks signature, `exp` (30 s skew), `aud = authenticated`, `sub`. No round trip to
  Supabase per connection (the Edge Function paid one `auth.getUser()` per finalize).
- The verified user id reaches the room as an internal header the Worker overwrites; the room is unreachable except
  through the Worker.
- `DEV_AUTH=1` (local `wrangler dev` and tests only) accepts `dev.<uuid>.<name>`.

## 4. Timers: one alarm per room

`RoomCore.nextAlarm(now)` returns the earliest pending moment strictly after `now`; the shell sets the object's alarm
to it (and to the persistence retry / stale-socket sweep). The alarm runs `tick`, which is the port of
`versus_reconcile` + `versus_reconcile_room`: gate expiry, hero deadline, round-1 intro cap, shop deadline + 250 ms
grace (promote candidates, resolve), combat cap, resume countdown, pause, abandon, prune.

What this removes: clients no longer drive deadlines. Today every client ticks every 500 ms and calls `reconcile` /
`finalize` when a deadline passes (with keyed backoff to keep the cost down), and the first caller to win the row lock
does the work. On Cloudflare nobody asks: the 0:00 close fires on the server's own clock, once.

Lesson recorded in the code: a "next alarm" that includes passed times re-arms "now" forever (seen locally: thousands
of wakes a second, starving the runtime). Only future times are armed; a test pins it.

## 5. Presence, disconnect, reconnect, pause

| | Supabase today | Cloudflare |
|---|---|---|
| Presence | `last_seen_at` from a 4 s heartbeat RPC; gone = no beat for 14 s (`versus__lease`, #2362; was 12 s) | The socket. Gone = no open socket for **3 s** (`DISCONNECT_GRACE_MS`) |
| Detection | 14 s lease + up to one beat (~18 s) | Close frame: the room knows in **~3 ms**; pause after the 3 s grace |
| Return from a pause | the absent player's next heartbeat starts the 3-2-1 (R-VERSUS-AUTO-RESUME-01, #2362) | the socket reopening starts the 3-2-1 at once (same rule; the heartbeat does it too) |
| Half-open phone socket | lease expiry | Client: no `pong` for 15 s ⇒ drop + reconnect. Room: alarm sweep closes a socket whose auto-response is older than 15 s |
| Blip (reload, network hand-over) | can pause if the beat gap passes the lease | Back inside 3 s ⇒ never paused (measured reconnect 120 ms) |
| Reconnect | re-subscribe + re-read room, match, rounds (several round trips) | `hello` answers room + match + private row in one frame (7-18 ms locally) |

The pause rules are GAME-RULES' unchanged: a seat gone pauses the match (deadlines stop and move later by the pause);
after 30 s the opponent may unpause, the absent seat then plays its last locked board, three such rounds forfeit;
coming back clears auto and starts the 3-2-1 by itself (R-VERSUS-AUTO-RESUME-01: the reopened socket is the return;
`heartbeat` and `request_resume` still work); both gone for 10 minutes of pause =
abandoned; leaving mid-match concedes. One live socket per account per room: a newer socket replaces an older one
(close 4000), and a closing socket only counts as "gone" if it was the account's last open one.

Hibernation: between messages the object may be evicted while sockets stay open. All state is write-through to
storage (split keys: `meta`, `sub:<seat>`, `last:<seat>`, `ckpt:<seat>`, `round:<n>`, `ob:<seq>`), every socket
carries its user in its attachment, and on wake the object re-reads storage and re-counts sockets
(`restoreSockets`). A test rebuilds a room from its storage keys mid-round and finishes the round identically.

## 6. Spectators, Duos teammate view, passing

- **Spectators** are room members in the stands on the same socket. Spectator frames, cursors and emotes are `bc`
  relays (same payloads the Realtime broadcast carried); the latest keyframe per seat is held in memory
  (`publish_frame` / `latest_frames`) for a late joiner, replacing `versus_spectator_frames` (no row write per keyframe).
  A player with no watchers still publishes nothing (the store already gates on watchers).
- **Duos teammate live view** is the same relay with a team filter: phase 3 adds `bc` targeting (`to: 'team'`), so a
  teammate's frames reach only the teammate and the stands, never the opponents.
- **Duos passing** (`versus_duos_pass` / `answer_pass` / `hand_room`) becomes an op on the room: the room records the
  pass, pushes it to the receiver, and takes the receiver's landed/refused answer, all in memory, in order, with the
  same per-round cap. No RLS-filtered Postgres Changes needed: the room knows who is on which team.

## 7. Ranked Duos matchmaking

The table is still seated from recorded duo runs and solo runs read from Supabase (`duo_runs_sample`,
`pool_runs_sample`, `duos_team_ranks`). In phase 4 the room calls those RPCs (read-only, service key) once when both live
heroes lock, runs `handleRankedDuosSeat`'s selection in the object, and keeps the three recorded teams' whole
recordings in storage for the match (they are served verbatim per round: the snapshot serving integrity bar is kept
by construction, since the same pinned recordings serve every round). Rounds resolve with `handleRankedDuosFinalize`
over an in-memory store, as 1v1 does today. The team rating settles through the existing `settle_duos_rank` path
(called by the persistence writer), so the ladder code is untouched.

## 8. Persistence to Supabase

Results go to the SAME tables, so every reader keeps working: XP (`settle_progression` reads `versus_matches` +
`versus_rounds`), room-card records (`versus_records`), Previous match stats, Career.

- `versus_matches` upserted at creation, after each round and at completion (`room_id = null`: rooms live in Cloudflare).
- `versus_rounds` inserted once per committed round (primary key `match_id, round`).
- Later phases: `versus_group_*` rows, `duo_runs` / `duo_run_rounds` + placements, rating settles, snapshot uploads
  (the client keeps uploading its own run snapshots exactly as today; nothing about snapshot capture moves).
- **Outbox:** jobs are written to the object's storage (`ob:<seq>`, one key each) in the same step as the state change,
  drained in order by the alarm, retried with backoff (1 s → 60 s). Every write is an idempotent upsert on the primary
  key (`Prefer: resolution=merge-duplicates`), so a retry after an ambiguous timeout is harmless. Persistence never
  sits on the round's path: the fight reaches clients before anything is written to Supabase.
- **Ordering hazard to handle before go-live:** the client settles XP right after the match; the persistence write may
  land a moment later. Either the room pushes `complete` only after the match row is acknowledged, or the client's
  settle retries `not_found` for a few seconds. Recommendation: the latter (the end screen must not wait on Postgres).
- **Migration needed at cutover (not written in this PR):** the `versus__round_scouts` BEFORE INSERT trigger
  overwrites `p1_scout`/`p2_scout` from `versus_submissions`, which Cloudflare matches never write; it must keep a
  supplied value (`coalesce(new.p1_scout, ...)`). And `versus_matches.p1_hearts` is NOT NULL (the writer sends 7).

## 9. Revision pinning (client and room always run the same engine)

- The Worker answers `/health` with `{cfProtocol, protocol, contentRevision}`; the client's `hello` carries its own
  three; a mismatch closes the socket with 4409 and the client never plays a fight resolved under rules it did not show.
- A room pins the content revision it was created under (as `versus_rooms.content_revision` does).
- **The Netlify-pack rule extends:** every pack deploys the Worker from the same commit (`npm run versus:bundle` is not
  needed: wrangler bundles the same entry). Deploy order: Worker first, then the site. A Worker deploy restarts objects
  and drops sockets; clients reconnect within ~100 ms-3 s and resume from storage. During the window where a new site
  meets an old Worker (or the reverse), the hello refuses with `version_mismatch`, exactly as `versus-resolve` answers 409 today. What happens to a room mid-match when the content changes under it is **open question Q3** (Workers has no per-room code pinning: a deploy replaces the code for every live room).

## 10. Observability

- Structured JSON logs (Workers Logs, `wrangler tail`): `versus_cf_resolve` (room, round, ms), `versus_cf_socket`
  (open/close, user, remaining sockets), `versus_cf_persist_retry`.
- Per-room counters (messages, bytes, alarms, wakes, resolve times, outbox depth) at `/rooms/<id>/metrics` (DEV only
  in the spike; behind an admin token in production).
- Workers Analytics Engine (phase 1 go-live): one data point per round (resolve ms, last-ready→commit ms, clients
  connected) for dashboards; one per pause (detection ms, duration, outcome).

## 11. Measurements (local, 2026-10-28)

`npm run versus:cf:measure`: workerd via wrangler's local runtime, two headless players on the same machine (so no
network round trip is included; add the player's RTT to the nearest Cloudflare PoP, typically 10-40 ms, once deployed).

| | Supabase today (audit) | Cloudflare spike, local |
|---|---|---|
| Last End Turn → fight available on every client | resolve 1.7-2.7 s (2-15 s with duplicate finalizers) | **median 5.7 ms, p90 10-13.5 ms, max 13.7 ms** (n=24, 12 rounds) |
| The locking player's own answer | match row, then a separate finalize call | already `combat` (median 4.4 ms) |
| Resolve inside the object (simulate + digest + commit) | inside the 1.7-2.7 s | 0-11 ms per round (workerd's timer is coarse; the end-to-end number above bounds it) |
| 0:00 → fight on every client (timer close) | Duos median 4.8 s | **286-299 ms** (250 ms grace + ~40 ms) |
| Disconnect → server knows | 12 s lease (+ up to 4 s) | **~3 ms**; pause shown at 3.02 s (3 s grace by design) |
| Blip (drop + auto-reconnect) | could pause | back in **120 ms**, no pause |
| Reconnect → full state | several reads after re-subscribe | **7-18 ms** (one `hello`); resume after the 3-2-1 at 3.03 s |
| Re-run after rebasing on #2362/#2363 | | median 6.6 ms ready close, 274 ms timer close, 9.8 ms reconnect (same) |
| Messages per both-ready round (2 players, 2 candidates + a lock + End Combat each) | RPCs + Realtime wake-ups + re-reads + 500 ms tick asks + 4 s heartbeats | clients send 8, receive 18 (8 answers + 10 pushes); room in 8 / out 18; 26-70 KB out (both fight perspectives to both players) |
| Worker cold start (first request, engine module init) | Edge Function cold start | ~300-440 ms locally, once per isolate |

### 11b. LIVE, over the real internet (2026-10-28)

`npm run versus:cf:measure -- --url <worker>` against a throwaway TEST Worker on the owner's account
(`ascent-versus-test-v1-bef2d3c2.team-ascent.workers.dev`: dev tokens, no writes; deleted after), two headless players
on the owner's PC (Ireland) through the nearest Cloudflare PoP; two runs (8 + 3 ready rounds, 2 + 2 timer rounds), plus
a concede and a full match to Health 0 (7 rounds, `hearts`). The timer close is corrected for the PC's clock offset.

| | Supabase today | Cloudflare, LIVE |
|---|---|---|
| Last End Turn → fight on every client | 1.7-2.7 s resolve (+ the read) | **median 75-90 ms, p90 98-125 ms, max 125 ms** (n=50) |
| The locking player's own answer (already `combat`) | | median 32-49 ms |
| 0:00 → fight on every client | Duos median 4.8 s | **318 ms** (250 ms grace + ~70 ms) |
| Disconnect → the room knows / shows it | 14 s lease | **40-55 ms**; paused at 3.04-3.05 s (3 s grace) |
| Blip (drop + auto-reconnect) | could pause | back in 420-540 ms (new TLS + WebSocket handshake), no pause |
| Reconnect → full state / resumed | several reads | **~500 ms** / 3.4 s (the 3-2-1 starts on the reconnect itself) |
| Concede → both clients see the end | | 41-57 ms |
| Messages per round | | unchanged: clients 8 out / 18 in |

The real game client was also driven headless over the same Worker (Supabase env blanked, dev identities): room →
seats → gate → Hero Select → shop → combat → concede, both tabs in step.

The production Worker is deployed with persistence OFF (`ascent-versus-v1-bef2d3c2.team-ascent.workers.dev`; it refuses
dev tokens, foreign origins and the metrics route). Players stay on Supabase: only a dev tab with `?versusHost=cf-live`
reaches it.

The game's store still sends its 4 s heartbeat and 500 ms tick asks; over this transport `reconcile` is answered from
the cache and `finalize` is a no-op, so only the heartbeat adds traffic (one tiny request per 4 s per client). It can
be dropped at cutover (presence is the socket).

## 12. Cost estimate (Workers Paid, list prices as of 2026-10)

$5/month base includes 10 M Worker requests, 1 M Durable Object requests, 400,000 GB-s of DO duration, 5 GB SQLite
storage. Incoming WebSocket messages bill at 20:1 as requests; auto-answered pings are not billed as requests and do
not wake the object; outgoing messages are free.

Per 1v1 match (~15 rounds, ~15 min): ~1,200 incoming messages (candidates, locks, heartbeats, spectator relays) ⇒ ~60
billed DO requests; the object stays awake most of the match (a message every few seconds) ⇒ 0.125 GB × ~900 s ≈
110 GB-s. Included duration covers ~3,600 matches/month; beyond it ≈ $0.0014 per match (≈ $40/month at 1,000 matches a
day), requests negligible. Group/Duos rooms cost about the same per room (more sockets, same object). Supabase egress
and realtime load for Versus drop to the persistence writes (a few KB per round) plus the XP settle, which is the
point given the egress overage noted 2026-10-26.

## 13. Every Versus SQL function → its new home

1v1 (ported in this spike, `roomCore.ts` unless noted):

| SQL | Cloudflare |
|---|---|
| `versus_create_room` | Worker `POST /rooms` → `newRoomState` + Directory claim |
| `versus_join_room`, `versus_take_seat`, `versus_leave_room`, `versus_set_options` | ops `join`, `take_seat`, `leave`, `set_options` (one-room-per-account via Directory `claim`/`release`) |
| `versus_start_game`, `versus_press_gate`, `versus_reconcile_room` | ops `start`, `gate`; gate expiry in `tick` |
| `versus_list_rooms`, `versus_open_rooms` | Directory `list`, `openCounts` |
| `versus__room_json`, `versus__match_json`, `versus__seat_of`, `versus_clock` | `roomJson`, `matchJson`, `seatOf`; the object's clock |
| `versus_register_offer`, `versus_pick_hero`, `versus__pick`, `versus__maybe_start`, `versus_reroll_hero` | ops; `seededPick` (FNV-1a over seed+label instead of Postgres `hashtext`: server-owned either way) |
| `versus_intro_done`, `versus__start_clock`, `versus__open_shop`, `versus_turn_seconds`, `versus__shop_grace` | op + `startClock`, `openShop`, `turnSeconds`, `SHOP_GRACE_MS` |
| `versus_submit` (both overloads, scout), `versus_unready`, `versus__finalize_seat`, `versus__maybe_resolve` | ops `submit`, `unready`; `finalizeSeat`, `maybeResolve` |
| `versus__raise_reported_armor` (+ `versus__reported_armor`, `versus__armor_floor_max`) | `raiseReportedArmor` (uses the sim's `reportedVitals` / `versusArmorFloorMax`) |
| `versus-resolve` `finalize` + `versus_commit_round` + `versus__round_scouts` trigger | `settle` → `handleVersusFinalize` (same code) → `commitRound` |
| `versus_combat_ready`, `versus_forfeit`, `versus__complete` | ops; `complete` |
| `versus_heartbeat` (#2362: lock-free beat, 14 s lease, auto-resume) | the socket (presence) + `returned()` on reconnect or op `heartbeat`: clears auto, starts the 3-2-1 for the paused seat (R-VERSUS-AUTO-RESUME-01); `seen` while paused |
| `versus_reconcile` (#2362: lock-free when nothing is due), `versus__resume`, `versus_unpause`, `versus_request_resume` | `tick` (alarm), `resume`, ops |
| `versus__close_json` / `closed_by_me` (R-VERSUS-CLOSE-ONCE-01) | not needed: the object closes AND resolves; nobody else is asked. The adapter's `finalize` is a no-op, so the client's one-asker logic (#2363) is inert |
| `versus__phase_watch`, `resolving_since` / `resolve_deadline` / `resolve_retry`, `versus__resolve_overdue`, `versus__unresolvable` (R-VERSUS-RESOLVE-TIMEOUT-01) | in one step: a resolve that fails (throws, engine/content mismatch) ends the match `void` at once (it would never succeed on a retry inside the same object); test-pinned |
| `versus_sweep` + cron (R-VERSUS-SWEEP-01) | each room's alarm (abandon after 10 min of pause with both gone; prune); no global sweep |
| `versus_events` + `versus__event` (R-VERSUS-EVENTS-01) | `CoreEffects.events` → `versus_cf_event` log lines (same kinds); can be mirrored into `versus_events` through the outbox if wanted |
| `versus_publish_frame` + `versus_spectator_frames` | op `publish_frame` (memory) + `bc` relay |
| `versus_records`, `settle_progression` (versus branch), `spectate_beat` | stay in Supabase (readers of persisted rows) |
| `versus_test_bot_register`, `versus_dev_*` | not ported (dev tools; re-add as DEV-only ops if needed) |

Group (phase 2): `versus_group_*` (submit, pick, reroll, intro, combat_ready, forfeit, unpause, request_resume,
reconcile, unready, publish_frame, eliminate, seat_out_to_stands, maybe_next, living, commit_round) → the same room with a
seat list of 3-4; `handleVersusGroupFinalize` in-object. Duos (phase 3): `versus_duos_*` (pass, answer_pass, hand_room,
commit_round, team helpers) → room ops + team-scoped relays; `handleVersusDuosFinalize`. Ranked Duos (phase 4):
`versus_ranked_duos_*` (seat, table, round_input, submit, commit_round, place_team, record_run, maybe_close, sweep) →
room ops + Supabase reads/writes through the outbox; the `sweep_abandoned` cron disappears (the room's own alarm abandons).

## 14. What becomes simpler

- No finalize hop, no "who calls the resolver", no duplicate resolves: the object that closes the round resolves it.
- No row locks, lock ordering, deadlock retries or `for update` choreography: one single-threaded object per room.
- No client-driven deadlines (the 500 ms tick, keyed backoff, reconcile storms): one alarm.
- No heartbeat lease and no false pauses from a late beat or a lock wait: presence is the socket, with a 3 s grace.
- The whole of #2362/#2363's machinery (closed_by_me, one resolver asker, resolve retry windows, void after 90 s, the
  global sweep, lock_timeout heartbeats, Realtime heal/re-open, RPC abort timers) has no counterpart to maintain: the
  object resolves synchronously, owns its own timers, and the client has one socket that reconnects itself.
- No Postgres Changes, no channel reuse bugs, no polling, no re-read after a wake-up: state is pushed.
- No RLS gymnastics for private rows (hero offers, Duos passes): the object sends each seat its own.
- `versus_spectator_frames` writes and most Versus egress disappear.

## 15. Keeping both in sync during the port

Supabase Versus keeps receiving fixes while this is built. Rules for the port window:

- **Every Versus rule change lands in BOTH places**, in the same PR when possible: the SQL migration and
  `roomCore.ts`, with a `roomCore.test.ts` case. A PR touching `supabase/migrations/*versus*` without touching
  `workers/versus` must say why in its body. (A CI check comparing the two is a cheap follow-up.)
- Engine-side rules (damage, pools, resolve, digests) live once in `@game/sim/versus/*` and are shared automatically.
- The chaos harness (`test/versus-chaos-harness`) gains a transport switch and runs against both backends; each
  phase's cutover requires a clean chaos run on Cloudflare.
- Folded in from main since the spike started: #2360 live Armor (raise on a fresh report), #2362 server reliability
  (auto-resume on return, void instead of a stuck resolving round, the event log kinds; lease/lock/close-once/sweep are
  structurally unnecessary), #2363 client reliability (the adapter matches the new `subscribeRoom` shape; its resolver
  asker and Realtime heal are inert over this transport).
- Known current deltas carried into the port: the 1v1 `submit` scout overload path; `versus_ready_signal` (ready is a
  signal); live Armor (`2026-11-03-versus-live-armor.sql`); `R-VERSUS-EMPTY-01` (empty boards fight) all included.

## 16. Cutover and rollback

- A server-side flag `versus_backend` (Supabase `app_config` row, read at room creation and cached 30 s by the client):
  `supabase` | `cloudflare` | `cloudflare:<percent>`. It decides where NEW rooms are created; nothing else.
- In-flight rooms finish where they started: a Supabase room keeps its RPCs; a Cloudflare room keeps its socket. The
  client stores the backend with the room (`room.backend`), so a reload or Live Games watch goes to the right place.
- Rollback = flip the flag back: new rooms go to Supabase at once; Cloudflare rooms finish (or are abandoned by their
  own rules); persisted rows are the same tables, so records and XP are continuous.
- No downtime: the flag flip needs no deploy, and both backends run side by side.

## 17. Phased rollout (each gated by a clean chaos-harness run on Cloudflare)

1. **1v1** (this spike → production hardening: deploy, JWKS, persistence on a staging Supabase, Analytics Engine,
   XP settle ordering, spectators + Live Games entry, friends invites carry the backend, cutover flag at 10% → 100%).
2. **Group 3-4** (round robin, Copy fights, ghosts, knockout to the stands).
3. **Versus Duos** (tag-team resolve, team pool, passing, teammate view relays).
4. **Ranked Duos** (table seating from Supabase samples, team rating settle, duo_runs recording, abandon sweep by alarm).

## 18. What the owner must provide before going live

1. **A Cloudflare account on Workers Paid** — DONE (2026-10-28; `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are set
   locally, `wrangler whoami` works). Nothing has been deployed: the first deploy waits for the owner's review of this PR.
2. **The deploy token's scope**, confirmed before CI uses it: "Edit Cloudflare Workers" on this account only (Workers
   Scripts:Edit, Account Settings:Read; Durable Objects come with Workers Scripts). Stored as a GitHub Actions secret for
   the pack/deploy job, never in the repo.
3. **Supabase key for the persistence writer** (stored as a Worker secret, never in the repo). Recommendation: NOT the
   service role. A dedicated Postgres role (`versus_writer`) with INSERT/UPDATE on `versus_matches`, `versus_rounds`
   (later `versus_group_*`, `duo_runs*`) and EXECUTE on the few RPCs it calls (`settle_duos_rank`, the samples), reached
   with a JWT signed for that role. If that is too much setup for phase 1, the service role works (the spike's writer is
   written for it) and can be swapped later without code changes.
4. A **domain/route** decision (e.g. `versus.<game domain>` or the `*.workers.dev` URL) and the CORS origin list.
5. Whether the project signs access tokens with the new asymmetric keys (JWKS, nothing to share) or the legacy HS256
   secret (then `SUPABASE_JWT_SECRET` as a Worker secret).

## 19. Open design questions

- **Q1 Disconnect grace.** 3 s before a closed socket pauses the match (so a reload never pauses). Owner call: 3 s, or 0?
- **Q2 Heartbeat.** Keep the store's 4 s heartbeat at cutover (it is now pure overhead), or remove it for Cloudflare rooms?
- **Q3 Deploys mid-match.** A Worker deploy changes the code for every live room at once. Options: (a) only deploy
  between waves with no live matches (a "drain" check), (b) refuse a content-changing deploy while rooms are in a match
  and retry, (c) keep the previous version's Worker under a versioned name and route rooms by their pinned revision.
  Recommendation: (c) for content changes, (a) otherwise.
- **Q4 Where the persisted record is written from** (room outbox, as built, vs a Supabase Edge Function the room calls).
- **Q5 Region.** A room's object lives near its creator; an opponent across an ocean pays the RTT on every message (the
  same as today's single Supabase region). Location hints (`locationHint`) per room are possible later.
- **Q6 Spectator scale.** 20 spectators per room relay every frame through one object; fine at today's sizes, but frames
  could move to per-match fan-out objects if rooms ever grow.

## 20. The spike, concretely

- `workers/versus/` (`@game/versus-cf`): `src/index.ts` (Worker), `src/room.ts` (Room DO shell), `src/directory.ts`,
  `src/core/roomCore.ts` (the rules), `src/core/storage.ts`, `src/auth.ts`, `src/persist.ts` (writer, OFF),
  `src/protocol.ts`, `src/client.ts`, `wrangler.toml` (no secrets).
- `npm run versus:cf:dev` — `wrangler dev` on :8787 with dev tokens.
- `npm run versus:cf:test` — the room in real workerd (6 tests: auth, hello version check, one room per account, ready
  → fight on both clients with the reference digest, the alarm's 0:00 close, blip / pause / reconnect). Needs Node 22+;
  not in the root `npm test` (CI is Node 20).
- `npm run versus:cf:measure` — the numbers in section 11.
- `workers/versus/test/roomCore.test.ts` (in `npm test`, 21 tests) — void on an unresolvable round, ready, ready-signal unready, 0:00 close with grace, AFK both
  sides, End Combat, combat cap, pause/resume with deadlines moved, blip, unpause → auto → missed forfeit, heartbeat
  clears auto, abandon, concede and leave, Health 0, spectators, hibernation restore, alarm never re-arms the past, and
  **parity**: every fixture fight resolved in the room equals `simulate()` run locally (events and result) and its
  digest equals `resolveVersusFight`'s.
- Game: `packages/ui/src/versus/versusCfRemote.ts`, selected only in a dev build (or with the Versus test tools) by
  `?versusHost=cf` (`?versusCfUrl=http://127.0.0.1:<port>` for another port; `?versusHost=supabase` to switch back).
  Smoke-tested headless: two tabs created, joined, seated, gated, picked heroes, played round 1 to combat and conceded
  over the transport with the unchanged store and screens (Supabase env blanked so nothing touched the live project).
