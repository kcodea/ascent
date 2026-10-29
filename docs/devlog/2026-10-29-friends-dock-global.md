# 2026-10-29 · One global Friends dock, bottom left (R-FRIENDS-DOCK-02)

Owner: "Move the friends panel to the bottom left ... be shown at all times in game through menus and in game etc.
you can then remove the friends area in the menus since it's redundant".

- `FriendsDock` is mounted once in `Game` and shows on every screen (title, ladder pages, hero select, every game mode,
  spectating, replays). The dock store (`dockStore.ts`) now carries the panel's `tab` too, so open / tab / open chat
  survive screen changes. Only an identity change closes it.
- The Friends page is gone (`FriendsPage` component, `showFriends`, the sidebar plaque, the `friends` backdrop entry).
  Its helpers moved to `friends/friendBits.tsx`. `goTo('friends')` is kept as a redirect that opens the dock in place.
- The panel has tabs (the Career `.cv2-tabs` pill): Friends (handle, Add by handle, every friend), Requests, Blocked
  (only while someone is blocked). Guests get a "Sign in to add friends." panel instead of no button.
- Placement (friendsDock.css): `--fdock-cb / --fdock-x / --fdock-y` on the button, the stack and the DM toast. Menus:
  40u at 12 px in; `html[data-fdock]` lifts the side menu's Settings plaque and shifts the title footer right. In a run
  (`.ingame`): 32u at 10 / 5 px, tucked under the hero's Health plate, counts beside the button instead of on top.
  Phones: the touch size, and the panels zoom by `--touch-inv-s * 0.7` so they stay readable on the scaled stage.
- Fixed on the way: Escape with the friend menu open over the dock closed the dock too (the dock's capture listener was
  registered first); it now leaves that Escape to the menu.
- Verified with headless screenshots (desktop 1920x1080 and phone 844x390) on title, modes, Career, Leaderboard,
  Collection, hero select, shop and combat, closed / open / with a chat, plus an occlusion probe at the button.
