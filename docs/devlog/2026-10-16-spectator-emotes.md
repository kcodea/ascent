# Spectator emotes, the spectator HUD, local rail / guides / Summary (2026-10-16)

Owner asks (via the coordinator): spectators emote to players ("they can see in the top left where the spectators
are"); the spectator's own HUD top left with the watched player and switcher bottom right; the cursor breaking over
the top-left portrait / rank; spectators using their guides and the lobby rail; spectators opening the fight Summary.
Rules: R-SPECTATE-EMOTE-01, R-SPECTATE-HUD-01, R-SPECTATE-CURSOR-02, R-SPECTATE-LOCAL-01. The Versus shop emote fix
(R-EMOTE-VERSUS-SHOP-01) shipped first on its own (#2126) and is cherry-picked here.

## How

- `versus/spectatorEmotes.ts`: the wire (`spectate_emote`, `{ e, from }`, no timestamp), the sender (installed as the
  emote runtime's "spectator sink", so `sayEmote` keeps the one cooldown and menu), and the receiver guard (sender must
  be in this client's stands, held 3 s for a late watcher row; per-sender gap = cooldown - 2 s; burst cap 3 / 3 s;
  the Esc switch and per-spectator mutes, both device-local). All clocks are the receiver's.
- `emotes/emoteBubble.ts`: a `w:<id>` seat anchors to the `[data-watcher]` chip (or the "+N" chip).
- `versus/SpectatorHud.tsx`: `SpectatorSelf` (top left) + `WatchedPanel` (bottom right); `SpectatorBar` (Versus) and
  `LiveWatchBar` (live) are now thin wrappers. `WatchersBadge` exports `StandsPlates` (shared with the spectator row).
- Channel wiring: `versusStore` (room channel; fellow spectators = other room spectators), `livePublisher` (the player
  hears `spectate_emote`), `liveWatch` (sends; reads fellow watchers every 15 s through `lobby_live_watchers`).
- `.app.spectating` (Recruit) + versus.css: the watch screen stays `.viewing`, but the spectator HUD, the rail, the
  rail tab, the Versus Guides plate, the Summary pill and the recap take presses again. LobbyPanel hides guide Edit for
  spectators. All rail state is LobbyPanel's own; rail seats are not cursor anchors, so the player can't drive them.
- Odds: `spectateTap.tapOdds` (called by Recruit after the player's deferred probe) rides the next spectator message
  and every keyframe of that fight as `od`; `spectate.ts` keeps it per seat; Recruit shows it and skips the probe on
  the watch screen (its synthetic run has seed 0, and the probe must not compete with the replay).
- Cursor: `live.css` had `.lvbar .vsspec-seat { cursor: default }`, the OS arrow over the portrait and rank. Gone.

## SQL (owner applies)

`supabase/migrations/2026-10-16-lobby-live-fellow-watchers.sql`: a current watcher of a live game may read
`lobby_live_watchers` too (it was player-only), so live spectators see each other. Without it, live spectators see only
themselves top left; the player still gets every spectator emote. Versus needs nothing.

## Not done

No server-side rate limit: the spectate channels are public Realtime broadcast, which any subscriber can send on and
which can't be limited per sender. A real limit means private channels plus an RPC that does `realtime.send`. That's
its own change.
