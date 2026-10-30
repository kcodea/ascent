# 2026-10-30 — Lobby chat gets the DMs' quality of life (R-LOBBY-CHAT-02, R-CHAT-EMOTE-SIZE-01)

Owner: "lobby chat needs the same quality of life that dm's have". Then: "emotes in chats should be 20% larger as well".

## Shared chat parts (`packages/ui/src/chat/`)

The DM message row, composer and window chrome were bound to the friends-hub store; they are now store-agnostic and
both chats use them (no copies, pinned by a source test):

- `ChatMessage.tsx`: `ChatBody` (was `DmBody`), `chatTime` (was `dmTime`), `ChatRow` (bubble, sender line, quote,
  Sending / Retry / time, Reply, then the caller's own actions), `useQuoteJump` (scroll + one-shot flash).
- `ChatComposer.tsx`: field + Send, the emote button and picker, the "Replying to" bar, the char count. Escape is
  `pass` (the DM window closes on it) or `blur` (the lobby panel).
- `ChatFrame.tsx`: move by a handle (transform only), resize from 8 grips through a ghost outline (commit on release),
  `ChatPinButton`, `phoneChat`. `chatGeom.ts`: the pure geometry with per-window limits + `createChatPrefs(key)`.
- `pageSeen.ts`: the "page is in front of me" check both read-when-seen rules use.

The DM modules keep their old exports (`DmBody`, `dmTime`, `dmEmotePickerOpen`, `clampChatGeom`, `useChatWindow`, ...)
as thin re-exports, so nothing else moved. Class names (`dm-*`, `dmchat-rs`, `dmchat-at`) are unchanged; the lobby frame
carries `dmchat-at lchat-at`.

## Lobby chat

- Emote picker + inline emotes; Reply with a quote that jumps to the original.
- Movable (header), resizable (grips), its own remembered place (`ascent.lobbyChatWindow.v1`), default = today's place.
  **Pinned by default** (today's behaviour: stays up while playing); unpinned, a press outside folds it to the pill.
- Unread like DMs: counts unless open AND the page is visible + focused; coming back, a press / focus in the panel,
  typing or sending clears it. While open, a count shows in the header.
- Phones: the compact fixed panel as before, no move / resize / pin; emotes and replies work.

## Worker (ships with the next pack)

`workers/versus/src/lobbyChat.ts`: `lobby_chat` accepts `replyTo`; the object stamps `reply` {id, from, name, 140-char
snippet} from its own backlog (never the payload's). `lobby_chat_sync` accepts `since`; the answer is only what came
after it (whole backlog if it is gone) and echoes `since`. Both backward compatible. The client calls
`resyncLobbyChat()` on every socket `open` (`versusCfRemote`, `liveCf`) and merges by id.

## Emotes 20% larger

`.dm-emote` 1.5em -> 1.8em (margins -0.225em top and bottom keep the margin box at the 1.35 line height: no row-height
change, the overflow sits inside the bubble padding), solo 2.4em -> 2.88em. Quote / reply bar / toast emotes unchanged.

## Not built

- Report a lobby chat message (no server record of messages).
- Escape does not fold an unpinned lobby panel (the game owns Escape; the composer's Escape only leaves the field).
