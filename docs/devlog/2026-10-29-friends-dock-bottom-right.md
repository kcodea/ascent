# 2026-10-29 · Friends: the dock moves bottom right and expands out of its button; the chat moves, resizes and pins (R-FRIENDS-DOCK-05, R-DM-CHAT-02)

Owner: "move the friends thing to the bottom right instead i guess because this looks super sloppy how this looks. i
want the friend button to like expand into the list/collapse back down. can you improve this?" and "let me move the
chat panel around, resize it, and pin it so that it stays while i play if i want it up".

- **Placement**: the button is slot 3 of the corner row (gear 0, Compendium 1, Rules 2), the slot R-FRIENDS-DOCK-01
  first used and `.devmenu-btn` already left free (it sits at slot 4). One set of variables (`--fdock-slot`, `--fdock-r`,
  `--fdock-b` in `friendsDock.css`) drives the button, the panel and the toast for every framing (desktop, touch,
  phone zoom, the legacy phone layout). `dockCorner` (FriendsDock.tsx) puts it in the corner itself (`corner`, slot 0)
  where something lies over the whole row: hero select, any side-menu page, the in-game menu (z 465 / 470); a phone's
  side-menu screens also use slot 0 (CSS on `data-phone-sbpage`).
  On the title the gear is under the title layer, so the row reads Friends, Rules, Compendium with the gear's square
  empty, as before.
- **Removed**: `dockSlot.tsx` (`DockSlot`, `useDockAnchor`), the slots in `MenuSidebar` and `Title`, the `.ingame`
  tuck-under sizing and its side-by-side chips. Nothing measures the layout any more.
- **One panel**: the list's title bar moved to its foot and ends in `.fdock-btnroom`, an empty square the size of the
  button (divided by the panel zoom on phones), and the stack's bottom-right corner sits `--fdock-pad` (6 px) outside the
  button's, so the real button lands in the room. The button stays on top (z 487), shows a chevron while open and drops
  its chips. Motion: `scale(0.12)` + opacity from `transform-origin: 100% 100%`, 0.2 s in / 0.16 s out.
- **Chat window**: the panel now sits in a frame (`.dmchat-at`) positioned by CSS vars (`--dmx/--dmy` via transform,
  `--dmw/--dmh` size) so the open animation (on the inner panel) never fights the drag transform. Drag = pointerdown on
  the strip / header, a 5 px slop, then pointer capture and `style.transform` writes; commit to `chatWindowPrefs` on
  pointerup (one render) and clear the inline transform. Resize = eight grips, an outline (`.dmchat-ghost`) moved per
  move, the size committed on release. Geometry maths is pure and unit-tested (`clampChatGeom`, `moveChatGeom`,
  `resizeChatGeom`). The view is read from `stageViewport()` on open and on `onStageChange`, never per frame.
- **Pin**: no veil, no Escape capture, Watch keeps it; z 479 (over the game and the pages, under the button / toast /
  list). Prefs (geometry + pin) in localStorage `ascent.chatWindow.v1`, guarded. Phones (`data-touch-ui` +
  `data-touch-small`) keep the full-screen window with no grips or pin. A pinned window is excluded from the ping
  layer's right-click (`.dmchat-at`).
- **Judgement calls**: the title bar sits along the panel's FOOT (where the button is) rather than its top; menu pages
  put the button in the corner itself; phones get no pin.

Checked headless at 1280x720, 1920x1080, 1191x1147 and phone 844x390 (mocked friends + DMs): title, Career,
Leaderboard, hero select, shop, combat, spectating, a stand-in Duos teammate disc, the toast, the list and the chat
(centred and pinned).
