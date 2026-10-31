# Versus on Cloudflare (the only host)

Owner decision 2026-10-28 (design: [`design/2026-10-28-versus-cloudflare.md`](design/2026-10-28-versus-cloudflare.md)):
live Versus moved from Supabase SQL functions to Cloudflare Durable Objects. Owner 2026-10-29: "why are we using
supabase for versus instead of cloudflare? stop doing that". Since then **every Versus mode (1v1, Group, Versus Duos,
Ranked Duos) and live-game spectating runs on the Versus Worker only** (`R-VERSUS-CF-ONLY-01`). There is no per-mode
switch to flip and no Supabase fallback: a Worker problem is fixed forward on Cloudflare, never by sending a mode back.

This file keeps its old name because migrations and devlogs link to it. The cutover history (the switch, the router,
the one-mode-at-a-time flip) is in [`devlog/2026-10-28-versus-cf-cutover.md`](devlog/2026-10-28-versus-cf-cutover.md)
and the retirement in [`devlog/2026-10-29-retire-supabase-versus.md`](devlog/2026-10-29-retire-supabase-versus.md).

## How it works

| Piece | Where | What it does |
|---|---|---|
| **The adapter** | `packages/ui/src/versus/versusRemote.ts` (`versusRemote`) over `versusCfRemote.ts` | Every room and match call goes to the Worker: writes on the room socket, reads answered from its pushes, the room list / my room / create as HTTP. A Worker that cannot be reached is an error the screen shows with Try again. |
| **The Worker URL** | `VITE_VERSUS_CF_URL`, baked in by `npm run release:web` | Trusted only when it is exactly the Worker for the build's own content revision (`embeddedCfUrl`); otherwise the build talks to the Worker named after its own engine (`ascent-versus-v<protocol>-<content>`). A dev build talks to `npm run versus:cf:dev` (127.0.0.1:8787). |
| **Records** | Supabase, through the Worker's key-gated writer (`versus_cf_persist`, `spectate_cf_beat`; `versus_cf_live` / `lobby_live_cf` only until the list retirement) | Results, rounds, history, ratings and spectator XP land in the same tables as always; the client reads team names, a settled ranked result and the Duos leaderboard there (`makeVersusRecords`). |
| **Live Games** | the friends hub's directory (`ascent-hub`, `LiveDirectory`) | Every revision's rooms and live games register there through the `LIVE_DIR` service binding; players read the list, the glow count and one row from the hub (R-LIVE-DIR-01). |
| **Room references** | `cf:<room id>` | Every invite, Friends "Watch" id and Live Games row names the room `cf:<id>`. A bare id is a retired Supabase room from an older client: the client says "That room has closed." instead of trying it. |
| **Origin allowlist** | `ALLOWED_ORIGINS` in `workers/versus/wrangler.toml` | `https://ascent-game-web.netlify.app` + localhost dev ports. Deploy-time override: `VERSUS_ALLOWED_ORIGINS`. |

**Why the Worker lists its own rooms (not a registry table in Supabase):** the Worker already keeps every live room in
its directory object (`workers/versus/src/directory.ts`, `GET /rooms`). Reading it costs zero Supabase egress and needs
no new write path from Cloudflare into Postgres.

## Releasing

```
npm run release:web
```

(needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in the environment). It deploys the Worker for that exact commit
**first** (`npm run versus:cf:deploy -- --persist`), checks its `/health` answers that engine, gives a NEW Worker its
result-writer secret (`writer-secret.mjs`; it prints one `insert into public.versus_cf_writer_keys ...` line: run it on
Supabase before uploading the zip, or that Worker's matches leave no records), deploys the friends hub when its code
changed, then builds the zip with the Worker URL baked in. Nothing else is deployed for Versus. `--versus-cf` (the old
opt-in flag) is still accepted and changes nothing; `--versus-cf-no-persist` is for test packs only.

**Desktop builds** (`scripts/release-desktop.mjs`) do not deploy a Worker. A desktop build talks to the Worker named
after its own content revision, so ship one only for a commit whose Worker a web release already deployed.

## Retiring the Supabase host (2026-10-29)

What changed in the client (chore/retire-supabase-versus): the cutover router, the per-mode switch read, the Supabase
room / match adapter, its Realtime channel and the Supabase Ranked Duos Live Games heartbeat are gone. The server half
is `supabase/migrations/2026-11-14-retire-supabase-versus.sql`.

**Order, and how long to wait:**

1. Upload the first pack built from a commit that has this change. `index.html` is served no-cache, so any reload or new
   visit runs the new build at once.
2. **Wait about 24 hours.** Only a tab left open from before the upload still runs the old code. That old code makes a
   Supabase room in one case only: its Cloudflare create failed on the network (every mode was already on `cf`). Until
   step 3 such a room still works end to end, because the old Supabase server is still there.
3. Run the two check queries at the top of the migration (no Supabase-hosted match still playing), then apply
   `2026-11-14-retire-supabase-versus.sql`. From then on an old tab whose Worker create fails sees its generic
   "Connection problem. Try again." (the server answers `versus_moved`), and no Supabase room can be made at all. The
   switch stays, pinned to `cf`: an old client treats a failed read of it as "everything on Supabase", so it must keep
   answering until no pre-retirement build is in use.
4. Once the same check queries stay at 0 (a Supabase match can last at most about two hours, and the migration's last
   sweep ended every silent one), delete the Edge Function:
   `npx --yes supabase@2.120.0 functions delete versus-resolve --project-ref zcwhbejpqcdcfdpfxeza`. An old tab still in
   a Supabase match after that would freeze at the round's close (its resolver is gone); the check queries are what
   rule that out.
5. Follow-up PR (after step 4): delete `supabase/functions/versus-resolve/`, `npm run versus:bundle`
   (`packages/tools/src/versus-bundle.ts`) and the `bundle` / `remote` modes of `npm run versus:parity` (keep its
   `generate`, which builds the sim's parity fixture). Later still, once no pre-retirement build is in use: drop
   `versus_host_config` and its read, and the Supabase room / match functions. Never drop the data tables (results,
   rounds, history, ratings).

**Old desktop builds** never carried a Worker URL, so they are Supabase-only for Versus: after step 3 they cannot make a
Versus room, and after step 4 a Supabase match on them cannot finish. Ship a new desktop build first if any are in use.

## Origin allowlist

Default (`workers/versus/wrangler.toml`): `https://ascent-game-web.netlify.app,http://localhost:*,http://127.0.0.1:*`.
To add a custom domain without a code change, deploy with the list in the environment:

```
VERSUS_ALLOWED_ORIGINS="https://ascent-game-web.netlify.app,https://play.example.com,http://localhost:*,http://127.0.0.1:*" npm run release:web
```

`deploy.ts` validates each entry (https origins, or http on localhost / 127.0.0.1) and echoes the list.

## Live Games and invites

- **Live Games** (owner 2026-10-28: every game is a live game): a room registers its own row (`versus:cf:<room>` for 1v1 /
  Group / Versus Duos, `duos:cf:<room>` for Ranked Duos) in the hub's directory (and, until the list retirement, in
  Supabase through the key-gated `versus_cf_live`), only when the listing changes (start, round, phase, end) plus a
  2-minute keep-alive; the row stays listed 4 minutes past its last write and is removed at the end. Watch from Live
  Games or Friends joins the room on the Worker.
- **Invites**: the client asks its room for a proof (`invite_proof` on the room socket); the room runs the checks (open,
  I am in it, they are not) and signs `<exp>.<hmac>` with the sha256 of its writer secret (the value
  `versus_cf_writer_keys` holds); `friends_invite` refuses a `cf:` invite without a valid proof (`room_check`). A Worker
  with no writer secret answers `invites_unavailable`.

## Lobby and Practice spectating

Owner 2026-10-29: "build the cloudflare spectating for lobby and practice too so it's all uniform" (R-LIVE-CF-01). A new
live lobby or Practice game publishes to its own Durable Object on the Worker (`VersusLiveGame`,
`GET /live/<game>/ws`); the object writes the game's Live Games row itself through the key-gated `lobby_live_cf` (on a
change plus a 2-minute keep-alive, `live_host = 'cf:<content revision>'`, removed at the end); watchers reach the game
on that Worker. The client no longer reads the switch for this.

**No fallback (R-LIVE-CF-ONLY-01; owner 2026-10-30: "Remove fallback for spectating. I want us to make cloudflare work as
our source for live information and action like spectating").** The Supabase live path is gone from the client: no
heartbeat, no broadcast channel, no `lobby_live_frames`, no watcher RPCs, no watch poll. A player whose Worker does not
answer is retried in the background (5, 10, 20, 40 s, then every 60 s); until it answers the game is not watchable, and
the game itself never notices. A friend's Watch (no row in hand) reads the game's listing row for its `live_host`, or,
with no row yet, tries this build's own Worker. A lobby row with no `live_host` (an older build on the retired path) says
"That game is on an older version. It cannot be watched." The server half is
`supabase/migrations/2026-11-17-retire-supabase-live.sql`: run it about 24 hours after the first pack with this change is
live (its check query is at the top). From then an old tab's Supabase heartbeat is refused (`live_moved`, which it
ignores: its game is just not listed) and its Supabase watch answers `other_host`, which its friend Watch already follows
to the Worker. Nothing on the Worker changed.

**Spectator XP (R-LIVE-CF-XP-01).** The Versus room (any mode) and the live game object beat their stands' watch record
through the key-gated `spectate_cf_beat` (same accrual rule and caps as `spectate_beat`; one call per object every
30 s for all its watchers). It needs a Worker deployed with `--persist` whose writer key is registered.

Check: start a Practice game in one browser, Watch it from Live Games in another (Claudebot accounts). The row's
`live_host` is `cf:<rev>` (`select game_id, live_host, live_until from public.lobby_live_games;`); during the watch,
`select * from public.spectate_sessions where run_id like 'watch:lobby:%' order by last_seen_at desc limit 5;` shows
the watcher's time growing every 30 s.

## Live Games and friends on the hub (R-LIVE-DIR-01, R-FRIENDS-HUB-LIVE-01; 2026-10-30)

Owner 2026-10-30: "I want us to make cloudflare work as our source for live information and action like spectating".
Since feat/cf-live-directory every LIVE read and push runs on Cloudflare; Supabase keeps the storage.

**The directory.** The Versus Worker is deployed per content revision, so its own directory only knows its own
revision's games. Live Games spans every revision, so it lives on the one stable Worker, `ascent-hub`: a
`LiveDirectory` Durable Object (`global`). Every Versus Worker reaches it through a service binding
(`[[services]] binding = "LIVE_DIR" service = "ascent-hub" entrypoint = "LiveDirectoryWriter"` in `wrangler.toml`):
Worker to Worker, no secret, no public write route. The same `LiveSlot` that wrote the Supabase row decides when a
write is due (a listing change, the 2-minute keep-alive), so the directory sees a few small writes per game per round.
Players read `GET /live/games?page=N`, `GET /live/count` and `GET /live/game/<id>` on the hub with their token (a guest's
too), answered from the directory's memory. It ports the SQL: one live game per player, the rank order, the spectator
count, Ranked Duos team name and medal, and friends-only rooms seen only by the host and the host's friends (asked of the
reader's own friends hub, cached 2 minutes, only when such a row is listed). Ranks and team names are looked up by the
hub through `live_dir_meta` once per id per 10 minutes; the writer's own values stand when that read fails.

**Friends.** Presence goes over the hub socket when it settles (no periodic call); the hub pushes it to connected friends
and MIRRORS it into `player_presence` (`hub_presence_cf`: on a change, every 2.5 minutes while connected, Offline at
the last close), which `friends__online` (the invite check) and older clients read. A friend request, accept, decline,
cancel, removal, block, unblock or invite makes the sender's client `nudge` the other player's hub (hub protocol 3; the
oldest client stays 1); their hub pushes `inbox` and their client reads `friends_list` once. No `friends_beat`, no
Realtime subscription on `friend_invites`.

| Path | Where now |
|---|---|
| Lobby / Practice publish + watch, Versus rooms, room list, open-room counts, Ranked Duos parties | Versus Worker |
| Live Games list, glow count, a friend's Watch row | hub `LiveDirectory` (HTTP) |
| Friends presence (live), DMs, request / invite notifications | hub socket (`FriendHub`) |
| Presence row (`player_presence`) | Supabase storage, written by the hub's mirror |
| Friendships, requests, blocks, invites, DMs, results, ratings, snapshots, Duos teams, spectator XP record | Supabase storage |

**What is left on Supabase is storage.** The client reads it only on an event: `friends_list` at sign-in, on a hub
(re)connect, on an `inbox` push and while a friends surface is open (60 s, as before); DM history when a conversation
opens; seat recordings when a watch starts. The hub writes the presence mirror and reads friends (at most every 2
minutes per connected account) and ranks (per id per 10 minutes).

### Cutover order

1. **Before the pack:** apply `supabase/migrations/2026-11-18-live-directory.sql` (`hub_presence_cf`, `live_dir_meta`,
   `player_presence.source`, `friends_beat` stamping `beat`). It is additive: every older client keeps working.
   It must be in before the pack: the new clients do not beat, so without the mirror their presence row goes stale and
   `friends_invite` would refuse invites to them (`not_online`).
2. **The pack** (`npm run release:web`): the hub deploys FIRST now (its code changed: the directory, the mirror,
   protocol 3), then the Versus Worker for the commit (its `LIVE_DIR` binding names the hub's entrypoint, so the hub
   must exist first), then the site. The hub's writer key is the one it already has (`ascent-hub`); nothing to run.
   From this upload: new Workers write their rows to the hub AND Supabase; new clients read the list from the hub.
3. **For about 24 hours both run side by side.** An old tab still reads the Supabase list (new Workers keep writing it)
   and still beats (the hub's mirror and its beat write the same row). Known gaps in this window, all ending when the
   old tabs reload: a game on a Worker deployed before this change (an old tab's Practice game, a match still finishing
   on an old revision) is listed only in Supabase, so new clients do not see it; an old tab's friend request or invite
   reaches a new client when the new client next reads its list (opening Friends, a hub reconnect), not instantly.
4. **About 24 hours later:** run the two check queries at the top of
   `supabase/migrations/2026-11-19-retire-supabase-live-list.sql` (beats in the last 15 minutes should be 0), then apply
   it. The Worker listing writers answer `retired` (each Worker object stops calling them), `lobby_live_games` is
   emptied and unreadable, `friends_beat` is refused (`beat_moved`), `friend_invites` leaves the Realtime publication,
   and a `live:` spectate invite no longer looks for a Supabase row. No table is dropped.
5. **Later (a follow-up PR):** delete the Supabase halves from the Worker (`SupabaseRowSink`, `TeeLiveSink`) and drop
   `lobby_live_games` and its functions once no Worker from before the retirement is still running.

**Desktop builds** have no hub (the hub refuses the `app://` origin, as the Versus Worker does): they get no live
presence, no inbox pushes and no Live Games list, as they already had no Versus and no DMs.

## Dev and test

- A dev build talks to `npm run versus:cf:dev`. `?versusHost=cf-live` picks the deployed Worker for this build's
  engine, `?versusCfUrl=<url>` any allowed Worker (dev builds, or with the Versus test tools on); `?versusHost=off`
  clears the pick.
- `npm test` covers the Cloudflare-only contract (`packages/ui/src/versus/versusCfOnly.test.ts`), the connect deadline
  (`rankedDuosPartyCf.test.tsx`), the origin list (`workers/versus/test/origins.test.ts`), what every mode's screens
  show plus the result writer (`packages/ui/src/versus/chaos/versusCfParity.db.test.ts`) and the chaos smoke.
- **The chaos matrix** (`packages/ui/src/versus/chaos/versusChaosCf.test.ts`; `npm test` runs its smoke,
  `CHAOS_FULL=1 npx vitest run versusChaosCf` the whole matrix in about 8 minutes). Known failures live in
  `chaosKnownCf.ts`.

## The game session: ranked, casual and Practice on Cloudflare (R-SESSION-CF-01, R-POOL-MIRROR-01; 2026-10-31)

Owner 2026-10-31: "Is it possible to just have ranked solos run on cloudflare too so that we aren't read writing in real
time? Can we offload that to cloudflare" → "Do it". Design and audit: [`devlog/2026-10-31-ranked-session-cf.md`](devlog/2026-10-31-ranked-session-cf.md).

**What it is.** With the hub's switch on, every new lobby / Practice game is a SESSION game. One Durable Object
(`GameSession`, `workers/versus/src/session.ts`) on the stable `ascent-hub` Worker is both:
- its live host: `/session/<game>/ws`, the same live protocol as `VersusLiveGame`, listed once in the hub directory with
  `live_host = 'session'`;
- its session: the per-round cloud save held in the object, the table pinned at the start, and the run-end writes and the
  rating settle flushed to Supabase in one key-gated call (`session_cf_flush`) when due.

The opponent pool is served from the hub's mirror (`PoolMirror`, synced every 5 minutes by the hub's cron). A game started
while the switch is off (or by an older build) keeps the old path for its whole life.

| Path | Session game | Any other game |
|---|---|---|
| Live socket, listing, chat, pings, spectator XP | hub `GameSession` (`live_host = session`) | Versus Worker `VersusLiveGame` (`cf:<rev>`) |
| Per-round cloud save (signed in) | held in the session; `saved_runs` written on Save & Quit / 60 s with no live socket / 10 min with no save | `put_saved_run` every shop start |
| Run-end boards, fights, Career, telemetry | session, then ONE `session_cf_flush` (rating settle inside, writes first) | client outbox → PostgREST |
| Rank settle (finish) | session (`submit-rating`'s checks + this game + the pinned table) | `submit-rating` Edge Function |
| Abandon settle, progression, Storage replay, Practice row, profile | client, as before | client |
| Pool sample (keys + boards) | hub mirror (with the switch on, for every game) | Supabase RPCs |

**No data loss.** Every session call that is not answered (unreachable, refused, or a hub deployed without persistence,
which answers `session_off`) is made the old way by the client at once: Supabase direct, the durable outbox, or the rank
queue. All of those writes are idempotent by key, so one the session also lands is stored once.

### Cutover order

1. **SQL first:** apply `supabase/migrations/2026-11-20-game-session-cf.sql`. It is additive: `session_cf_writes`,
   `session_cf_flush`, `pool_mirror_version/index/boards`, all key-gated by the hub's existing writer key (`ascent-hub` in
   `versus_cf_writer_keys`). Check:
   `select proname from pg_proc where proname in ('session_cf_flush','pool_mirror_version','pool_mirror_index','pool_mirror_boards');`
2. **The pack** (`npm run release:web`). The hub's code changed, so it deploys (with `--persist`), and the switch stays
   OFF: `hub:deploy` keeps the live hub's setting, and an older hub counts as off. New `GameSession` / `PoolMirror`
   classes come in by migration tag `v3`. Within 5 minutes the cron fills the mirror. Check
   `curl https://ascent-hub.team-ascent.workers.dev/pool/status`: `ready: true`, `runs` about the eligible pool size
   (`select count(*) from pool_runs where eligible`).
3. **Flip:** `npm run hub:deploy -- --persist --session on` (it refuses `--session on` without `--persist`). Check
   `curl .../session/config` answers `{"enabled":true,"protocol":1}`. Pages that load from now on start session games.
4. **Watch the first games:**
   - writes: `select user_id, game_id, tbl, status, at from session_cf_writes order by at desc limit 20;`
   - settles: `select * from rank_results order by created_at desc limit 5;`
   - saves: `select user_id, run_key, revision, updated_at from saved_runs order by updated_at desc limit 5;`
   - rejected writes: `select * from ops.events where source = 'session' order by at desc limit 20;`
   - Live Games shows those games, and Watch works from Live Games and Friends.
5. **Rollback:** `npm run hub:deploy -- --persist --session off`. Pages that load afterwards start old-path games. A
   session game already in progress keeps its session and flushes as normal; its tab remembers its choice.

**Known gap (the cutover window only):** a client from before this change cannot watch a session-hosted game. It does not
know `live_host = 'session'` and shows "Could not reach that game". It ends when old tabs reload (`index.html` is served
no-cache).

**Later (after about 14 days on, owner's call):** there is nothing to retire on Supabase. The old paths (`put_saved_run`,
the outbox inserts, `submit-rating`) stay as the session's fallback and the abandon path. A follow-up may stop routing
lobby games to `VersusLiveGame` once no old-path game is in use.

### Dev and test

- Local hub with the session on: `npx wrangler dev --config workers/versus/hub.wrangler.toml --port 8788 --var DEV_AUTH:1 --var SESSION_MODE:on`
  (persistence off: the session records its flushes; `GET /session/<game>/metrics` shows them). A dev page reaches it
  with `?hubUrl=http://127.0.0.1:8788` (and `?session=on|off|clear` forces the switch in a dev or test-tools build).
- `POST /pool/dev-load` (DEV only) loads the mirror from rows a test read itself. `scripts/egress-game-probe.mjs
  --session-hub <url>` does it and plays a whole game against the local hub.
- Tests:
  - `workers/versus/test/sessionCore.test.ts`
  - `workers/versus/test/sessionCf.db.test.ts` (serving exactness and the flush)
  - `workers/versus/test/it/session.it.ts` (`npm run versus:cf:test`)
  - `packages/ui/src/session/session.test.ts`
