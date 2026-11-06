# Spectator rail and chat bubbles

Owner ask 2026-11-06: spectators get a rail of their own top left that minimizes and expands when they type or emote, plus
Deadlock-style chat bubbles: an ellipsis while someone types, then their text in a speech bubble. Rules: R-SPECTATE-RAIL-01,
R-CHAT-BUBBLE-01.

## What changed

- **Rail.** `SpectatorSlice` replaces the ring and name plate on both the player's list and a spectator's own. The seat is only
  the small tab and the hit area. The full slice is parked to the left and slides out on `transform`, so rows never move and an
  open slice takes no clicks. Tooltips open under the row (`.gtip-under`).
- **Speech state.** `lobbyChat/chatSpeech.ts` is its own store, so a keystroke never re-renders the game.
- **Bubbles.** `ChatBubbleLayer` places each bubble once from `emoteBubble.placementFor`, the same anchors emotes use.
- **Wire.** New event `lobby_chat_typing`, stamped by the room and live objects, never stored. The sender renews every 2.5 s and
  readers expire it after 5 s. A team tab's notice goes only to that team.

## Worth remembering

- The rail's navy is `--pill-plate`. `--ui-plate` is plum, which was the first attempt's mistake.
- `VERSUS_CF_PROTOCOL` was not bumped: the event is additive, an older client ignores it, and fight rules did not change.
- Emote mute (right-click a slice) and chat mute are separate, so an emote-muted spectator's bubbles still show.
