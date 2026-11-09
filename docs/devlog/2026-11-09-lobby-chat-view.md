# 2026-11-09 — Lobby chat: the chat view, the chat button, muting and room on the spectator rail

Owner (Mike) spent the day on the in-game lobby chat. All in `feat/chat-hotkey`.

## What changed

- **The chat view** (R-LOBBY-CHAT-VIEW-01). Enter or Y opens a focused view: the game dimmed and blurred, the history over
  the board, the bar under it. Enter sends AND leaves; empty Enter leaves; Escape (capture, never the Esc menu) leaves; a
  press on the veil leaves. The old movable/resizable/pinnable side window is gone (`setLobbyChatOpen`, the window prefs
  and the `ascent.lobbyChatWindow.v1` key no longer exist). Layout and dim/blur are tunable in the dev "Chat Bubbles" panel
  (`chatBubbleConfig.ts`, view keys migrate via `ascent.chatView.layout`).
- **Who said what**: `chatSpeakerColour(gameKey, from)` hands out 8 colours in first-speak order per game; the name leads
  the message inside the bubble. A reply quote uses the ORIGINAL speaker's colour (`--quote-who`).
- **Emotes off** in lobby chat (`LOBBY_CHAT_EMOTES = false`, the composer's `emotes` prop). Tokens still render.
- **The chat button**: the Friends corner plaque with `frames/chat_medallion.webp`. It must NOT carry `.pressable` —
  that primitive sets `overflow: hidden` and clipped the unread chip. In a game it takes the dev tuner's old square (one up
  from Friends, `html[data-bl="game"] .lchat-pill`); the dev tuner moved to the bottom-right cluster left of the Compendium.
- **Mute** (R-LOBBY-CHAT-HUSH-01): right-click the button or the view's Mute chat switch. `hushed` gates `noteChatSaid` /
  `noteChatTyping` in the store and clears speech at once; the badge hides; the chat still opens.
- **Bubbles**: hand-drawn SVG shapes (`chatBubbleShape.ts`), springs (`chatBubbleSpring.ts`), long messages split into up to
  three bubbles whose later tails reach the first tip (R-CHAT-BUBBLE-02). Pop sound halved (`chatpop: 0.2`).
- **Room on the spectator rail** (R-CHAT-BUBBLE-RAIL-ROOM-01): `syncRailRoom` in `ChatBubbleLayer.tsx` runs in the layer's
  layout effect (after the bubbles place themselves, before paint). Each row's room = how far its speaker's bubbles reach
  below the row + 6px, written as the row's `margin-bottom`; rows and their bubbles that moved get a one-shot `translate`
  spring (not `transform`, so it never fights the slice slide-out or the bubble's own spring). Rail bubbles only collide
  with bubbles of rows ABOVE them. Known gap: a bubble opening mid-slide can land a few px off.

## Dev tools

- Dev menu, "Chat sandbox: long message" (`devChatLongDemo`): the top fake spectator sends a three-bubble message and the
  one under them replies while it is up.
