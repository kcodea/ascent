# 2026-11-02 · Lobby chat closes with the game; a Team tab in Versus team modes

Owner ask 2026-11-01 (screenshot of the main menu with the "Lobby chat" button still showing after a game): "also lobby
chat should close after games end. in versus team modes, there should be a tab in lobby that has a team chat too."
Branch `feat/lobby-chat-team-tab`. Rules R-LOBBY-CHAT-CLOSE-01 and R-LOBBY-CHAT-TEAM-01 (approved/foundation.ts).

## Close on game end

- Cause: a Versus room keeps its socket (and so its lobby chat session) through every match. After a match the end gate
  opens on the room, and from there the player can go back to the main menu while still a member, so the panel's
  button stayed on the menu. Lobby / Practice games already closed their chat at `gameover` (the publisher's socket
  ends), and watchers on leaving.
- Fix: `LobbyChatPanel` renders only while a game is on screen (`!useGame.showTitle`: shop, fight, Hero Select, the
  watch screen). The title, the menus and a Versus room between matches never show it. The session and the room socket
  are untouched (the room needs its socket); the chat itself has no connection of its own.
- Judgement call: the lead's assumption was "readable on the end screen until the player leaves to the menu". In
  practice no mode has a chat on its end screen: Versus leaves through the end gate straight to the room (stats there),
  and a lobby game's socket closes at `gameover`. Kept as is (no new socket lifetime) and flagged.

## Team chat

- Wire (`workers/versus/src/lobbyChat.ts`): the same `lobby_chat` / `lobby_chat_sync` / `lobby_chat_refused` events with
  `channel: 'team'`. `lobbyChatTeamOf(mode, role)`: Duos p1+p2 = `a`, p3+p4 = `b`; Ranked Duos p1+p2 = `a`; anything
  else (spectators, solo modes) none. `LobbyTeamChats` holds one `LobbyChat('team')` per team for the CURRENT match
  (a new match id forgets them), stored under `lobbyChatTeams` in the room object's storage.
- Room (`room.ts teamChat`): the team comes from the sender's seat, never the payload. A post goes only to the sockets of
  `lobbyChatTeamAudience` (that team's seated members); a member with no team gets `not_member` / an empty team sync. The
  LOBBY sync answer carries `team: true` for a seated teammate. `liveHost.ts` (lobby / Practice / session games) refuses
  a team request instead of posting it to the lobby.
- Compatibility: the client opens the Team tab only after the lobby answer says `team: true` AND the team backlog
  answers, so it never sends a team message to an older Worker (which would post it to the lobby). An older client that
  receives a team message (only teammates ever do) shows it in its lobby list.
- Client (`lobbyChatStore.ts`): a second channel (`teamMsgs`, `teamUnread`, `teamAvailable`, `teamCanSend`, `tab`).
  Read-when-seen is per tab (looking at Lobby never reads Team). The collapsed button shows both counts added up. A full
  team answer (not a catch-up) replaces what is held, so a new match's tab starts empty. A lobby answer without `team`
  drops the tab. `returnToRoom` re-syncs, so a team knocked out to the stands loses its Team tab.
- Panel: the header shows `cv2-tabs` Lobby / Team (the Friends dock's tab pill) with a DM red chip per tab, else the old
  "Lobby chat" title. Placeholder "Message your team". Mute applies to both tabs.
- Spectators / mentors: no Team tab (lead's assumption; no existing rule says otherwise).

## Verification

- `workers/versus/test/lobbyChat.test.ts` (team of seat, audience, stamping, per-match store + wake).
- `workers/versus/test/it/room.it.ts` "TEAM CHAT" in real workerd: a 4-seat Duos room; the lobby sync says team; p1's
  team post reaches p2 and not p3/p4; p3's team chat is theirs; a lobby post reaches all four.
- `packages/ui/src/lobbyChat/lobbyChat.test.tsx`: the panel hides with `showTitle`; tabs only after both answers; sends
  carry the channel; per-tab unread; refusal text; a new match empties the tab; the tab drops without `team`; catch-up.

## Deploy

The versus Worker (`workers/versus`, the Room object) must be deployed for team chat. Nothing in Supabase changes; no
`versus-resolve` redeploy.
