# 2026-10-30 — Live Games and friends on the hub (Cloudflare is the source of live information)

Owner: "I want us to make cloudflare work as our source for live information and action like spectating". Follow-up to
`2026-10-30-cf-only-live-spectate.md` (#2483), which left the Live Games list, the glow count, a friend's Watch row,
`friends_beat` and the invite Realtime wake-up on Supabase. Rules: R-LIVE-DIR-01, R-FRIENDS-HUB-LIVE-01. Branch
`feat/cf-live-directory`. Runbook and cutover order: `docs/versus-cf-cutover.md`, "Live Games and friends on the hub".

## What changed

- **A live directory on the hub** (`workers/versus/src/liveDirectory.ts`, rules `core/liveDirCore.ts`, wire
  `liveDirProtocol.ts`): one `LiveDirectory` object on `ascent-hub` (new DO class, migration `v2`). Versus Workers of
  every revision register rooms and live lobby games through a service binding to the hub's `LiveDirectoryWriter`
  entrypoint (`hubWorker.ts`; `[[services]] LIVE_DIR` in `wrangler.toml`). The writes ride the existing `LiveSlot`
  (change + 2-minute keep-alive) through `TeeLiveSink` (hub + Supabase until the retirement; a retry re-sends only to the
  half that failed). Ranks / team names: `live_dir_meta`, cached 10 minutes per id. Friends-only rooms: the reader's own
  `FriendHub.friendsFor` (cached 2 minutes), only when such a row is listed.
- **Client reads** (`packages/ui/src/live/liveRemote.ts`): list, count and one row are HTTP GETs on the hub
  (`/live/games`, `/live/count`, `/live/game/<id>`) with the hub token (`friends/dm/hubToken.ts`, moved out of
  `dmStore.ts`). Seat recordings stay a Supabase read (storage).
- **Friends** (`friendsStore.ts`, `dm/dmStore.ts`, `hub.ts`): the 60 s `friends_beat`, the Offline beat on close and the
  Realtime subscription are gone. Presence is sent to the hub socket when it settles (`onPresenceSettled`); the hub mirrors
  it into Supabase (`hub_presence_cf`, `core/presenceMirror.ts`: change, 2.5-minute keep-alive, Offline at last close,
  restored across hibernation). The inbox is read on sign-in, on a hub (re)connect and on the new `inbox` push; my
  friend actions and invites `nudge` the other player's hub (hub protocol 3, minimum still 1). The dock's online count
  overlays the hub's live peers.
- **Release order**: `release:web` deploys the hub before the Versus Worker (the binding needs the hub's entrypoint).
- **SQL**: `2026-11-18-live-directory.sql` (apply BEFORE the pack) and `2026-11-19-retire-supabase-live-list.sql` (about
  24 h after). The retirement also relaxes the `live:` spectate invite check (it read the now-empty `lobby_live_games`).

## Measured

`friendsBeatBudget.test.ts` (the scripted 35-minute session): Supabase calls from the friends client went from 46 beats
to 1 (the boot inbox read); presence sends to the hub: 46 (the changes only), 3 with "Show friends what I am doing" off.
Live Games: no Supabase read per 10 s page poll or 45 s glow poll; each is one hub GET answered from memory.

## Tests

`workers/versus/test/liveDirCore.test.ts` (registration across revisions, order, page, TTL, one-per-player, Ranked Duos,
friends-only, the Worker row mapping, the tee), `presenceMirror.test.ts`, `test/it/liveDir.it.ts` (real workerd: two
Versus Workers into one hub over the service binding, a Versus match listed, no public write, nudges and a new friend
online at once), `packages/ui/src/friends/liveDirectorySql.db.test.ts` (both migrations on PGlite), the friends / dm /
live UI suites. The IT driver now gives each local Worker its own dev registry (`startLocalWorker` runs with
`LIVE_DIR_OFF=1`).
