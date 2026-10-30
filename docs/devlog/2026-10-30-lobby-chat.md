# 2026-10-30 — Lobby chat (R-LOBBY-CHAT-01)

Owner idea: "spectator group chats within a game". Owner ruling the same day: "spectator group chat can be lobby chat,
and should include everyone in the game i think including the player".

## What shipped

- **One chat per game, for everyone in it**: a Versus room (all seats + the stands, kept through every match in the
  room) and a live lobby / Practice game on Cloudflare (the player + everyone watching).
- **Server** (`workers/versus/src/lobbyChat.ts`, pure, imported by the UI as `@game/versus-cf/lobbyChat`): three `bc`
  events the room / live objects intercept like the pings: `lobby_chat` (post; echoed to every socket, the sender's
  too, with server-stamped id / from / name / role / at), `lobby_chat_sync` (the last 100 to the asking socket, plus
  `canSend`), `lobby_chat_refused`. Members only, never a guest (the Worker now stamps `X-Versus-Guest` from the JWT's
  `is_anonymous`), 1 msg/s per sender with bursts of 5, bodies cleaned by `cleanDmBody` (500 chars). The backlog is
  mirrored to the object's own storage with `allowUnconfirmed` so no game frame waits on that write; nothing reaches
  Postgres.
- **Client** (`packages/ui/src/lobbyChat/`): a session seam installed by `versusStore`, `livePublisher` and
  `liveWatch`; the panel appears only once a real sync answer arrives (an older Worker, or a Supabase-hosted lobby
  game, shows nothing). Left-edge panel (between Tavern Up and the emote wheel), collapsible to a pill with an unread
  chip, local Mute, the DM swear filter, and a Settings switch ("Lobby chat", on by default). A lone lobby player with
  nobody watching sees no panel. Starts collapsed on a small touch screen.
- Dev tokens ending `.guest` are guests (local Worker tests only).

## Measured

Local wrangler dev, 2 players + 2 spectators in a Versus room: every message reached all four; the player's frames
while 4 messages arrived in the shop: p50 8.3 ms, p95 12.5 ms, no long tasks.

## Follow-ups (not built)

- A moveable / pinnable panel like the DM chat window, and sharing one message-list / composer component with
  `friends/dm` once that work settles (this PR reuses `dm.css`, `dmTime` and `maskProfanity` but not the components,
  which are bound to the DM store).
- An emote picker in the lobby chat composer. Emotes already RENDER (the DM `DmBody`: `:id:` tokens inline), but
  the DM picker lives inside the DM composer and is not exported.
- Reporting a lobby chat message (needs a server record; messages are deliberately not stored).
- A reconnect does not backfill messages sent while the socket was down (the next session install re-syncs).
