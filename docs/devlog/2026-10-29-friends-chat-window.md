# 2026-10-29 · Friends: the chat window, a wider panel, the title corner again (R-DM-CHAT-01, R-FRIENDS-DOCK-04)

Owner: "make the friends panel larger on desktop so it shows a bit more info. the chat should open as a larger overlay
in the center of the screen, and should have tabs that hold all conversations ... also dont have the friends button at
the main menu be next to the other buttons. put it at the bottom left again."

- **Chat window** (`friends/dm/ChatWindow.tsx`). Pressing a friend (or a DM toast) now opens a centred window (960x720
  layout px, the stage scales it on smaller windows; full screen on phones) instead of the 340-wide card beside the
  list. Tabs: `dockStore.chatTabs` (every conversation opened this session, in order) plus every friend with unread
  messages (`chatTabOrder`, derived, not stored). `dmWith` now means "the chat window's active tab"; it no longer
  depends on the dock's `phase`, so `dmStore.viewing()` and the open-conversation subscription read `dmWith` alone, and
  `closeDock()` no longer clears it. Opening a chat collapses the list (one surface at a time). The window lives in the
  dock shell, so it is still one instance across screens. A Send button joined the composer.
- **Closing**: X, Escape (its own capture listener), or a press on the veil (caught + `swallowNextClick`). The veil dims
  menus (0.5) and barely dims games (0.22). Watch in the header closes the window first via a capture handler; the
  Watch button's own click (owned by another branch) is unchanged.
- **Wider panel**: 520 on non-touch, with the game line allowed to wrap; touch keeps 380.
- **Title corner**: the title's `DockSlot` moved from the menu column into `.titlefoot`, absolutely positioned just above
  the footer links (out of flow, nothing pushed). The panel still opens right of `.titlenav` (the slot looks its column
  up on the same screen), so the plaques stay visible (R-FRIENDS-DOCK-03 still holds).

Checked headless at 1280x720, 1920x1080, 2560x1080 and phone 844x390 (mocked friends + DMs).
