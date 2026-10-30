# 2026-10-30: Live Games Watch said "Could not reach that game" (R-LIVE-WATCH-REACH-01)

Owner: "i keep getting this error trying to spectate. why?" (Live Games, a ranked game on `cf:7a0e7dc6`).

**Root cause.** `lobbyLiveWatchUrl` sent a watch for a game on this build's OWN engine to `cfUrl`, the build's own
Worker. In a pack that is the deployed Worker, but in a dev build (5173) `cfUrl` falls back to local `wrangler dev`
(`http://127.0.0.1:8787`). Every listed row is written by a deployed Worker (a local one has `PERSIST=0`), so a dev
build on the live pack's engine (main at 4e8f6c6b8, before #2456 changed content) aimed every Watch at a port nothing
served. The browser sees a refused upgrade as a plain dropped socket, `VersusCfClient` retries with backoff, and
`openWithin` gives up at 6 s with `unreachable`. Every refused upgrade (401 on a bad token, 403 on origin) looks the
same, so the message could never say why.

**Probed live** (anonymous Claudebot accounts, Node WebSocket, no Origin): the deployed `ascent-versus-v1-7a0e7dc6`
answers `/health`, upgrades `/live/<game>/ws` (401 without a token), and a watcher joins a game published on the same
engine AND with a hello naming another content revision. Only the PUBLISHER is held to the Worker's engine
(`version_mismatch`, 4409). So cross-version spectating already works server side; no Worker change was needed.

**Fix (client only).**
- `lobbyLiveWatchUrl` always returns `versusCfLiveUrl(<the row's rev>)` (a dev tab's explicit `?versusHost=` pick aside).
  A pack is unchanged: its own Worker is that same URL.
- `watchOnCf` retries one `unreachable` timeout; refusals stay final. A later Watch overtakes a slower open.
- A Watch that still fails is diagnosed with two plain reads (`diagnoseCfOpen`): offline / `/health` down /
  `/me/room` 401 (sign in again) / else "Could not reach that game". `version_mismatch` says reload to update.

Not changed: in a dev build the PUBLISHER still tries local `wrangler dev` first and falls back to Supabase after 6 s
(`lobbyLivePublishUrl`), which is the intended dev behaviour.
