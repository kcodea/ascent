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
| **Records** | Supabase, through the Worker's key-gated writer (`versus_cf_persist`, `versus_cf_live`, `spectate_cf_beat`, `lobby_live_cf`) | Results, rounds, history, ratings, Live Games rows and spectator XP land in the same tables as always; the client reads team names, a settled ranked result and the Duos leaderboard there (`makeVersusRecords`). |
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

- **Live Games** (owner 2026-10-28: every game is a live game): a room writes its own row (`versus:cf:<room>` for 1v1 /
  Group / Versus Duos, `duos:cf:<room>` for Ranked Duos) through the key-gated `versus_cf_live`, only when the listing
  changes (start, round, phase, end) plus a 2-minute keep-alive; the row stays listed 4 minutes past its last write and
  is removed at the end. Watch from Live Games or Friends joins the room on the Worker.
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

## What still reads Supabase for live information (audit 2026-10-30)

Results, history, ratings, snapshots, DMs and Duos teams are storage and stay in Supabase. The live paths:

| Path | What it does | Where | Status |
|---|---|---|---|
| Lobby / Practice publish + watch | the stream, keyframe, stands, end, chat, pings | Worker (`VersusLiveGame`) | Cloudflare only (R-LIVE-CF-ONLY-01) |
| Versus rooms, room list, open-room counts, my room, Ranked Duos parties | every room and match op | Worker (`VersusRoom`, `VersusDirectory`) | Cloudflare only (R-VERSUS-CF-ONLY-01) |
| Friends presence overlay, DMs | live presence of connected friends, messages | friends hub (`ascent-hub`) | Cloudflare (messages stored in Supabase) |
| Spectator XP record | the watch record of a Cloudflare watch | the Worker writes `spectate_cf_beat` | Cloudflare is the witness; Supabase stores it |
| **Live Games list** | one page of `lobby_live_games` every 10 s while the page is open | Supabase read (rows written by the Worker) | remains |
| **Live Games glow count** | a head-only count every 45 s while a menu is on screen | Supabase read | remains |
| **A friend's Watch** | one row read per Watch, for `live_host` | Supabase read | remains |
| **`friends_beat`** | my presence row and my inbox (friends, requests, invites), every 60 s | Supabase RPC | remains |
| **The invite wake-up** | Realtime `postgres_changes` on `friend_invites` addressed to me | Supabase Realtime | remains |

**Why the list is not on Cloudflare yet, and the follow-up.** The Versus Worker is deployed per content revision, so its
directory object only knows its own revision's rooms and games; the list spans every revision. A Cloudflare list needs a
version-independent directory: a `LiveDirectory` object on the `ascent-hub` Worker that every revision's live-game and
room objects register into (a key-gated internal write, as `lobby_live_cf` is today), read by Live Games, the glow count
and a friend's Watch. It must also take over what SQL does on the way in: the rank and rating sort (the listing would
carry them, as the live listing already sends division and points), the Ranked Duos team name and medal, and the
friends-only visibility of a private room (the hub would need the reader's friends). Then `lobby_live_cf` /
`versus_cf_live` stop writing and the table can retire. Presence (`friends_beat`) and the invite wake-up move to the hub
after that: the hub already carries live presence; it would also need to push invites and the inbox counts.

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
