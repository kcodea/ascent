# 2026-10-29 · Friends dock: a home in each menu's own corner (R-FRIENDS-DOCK-03)

Owner, on a near-square window (~1191x1147): "looks like friends moved over the menus and stuff - can you fix that?".

The first global dock (#2424) was only checked at 1920x1080 and 844x390. A real-browser sweep
(12 window sizes × 11 screens × closed/open; an occlusion probe that counts a neighbour only where the dock is
actually painted over it) found, on every size: the button sat on the side menu's foot (that page shifted Settings up
to make room), the title footer links were pushed right, and the open panel covered the title plaques and the side
menu (on phones, all of them).

Fix: a menu with its own bottom-left space marks it with a `DockSlot` (`friends/dock/dockSlot.tsx`): the side menu's
foot under Settings, and the title menu column under its last plaque. The button is portalled INTO the slot (in flow,
so it scales with that layout and never covers or shifts anything); the panel and the DM toast open to the RIGHT of
the slot's column (`useDockAnchor`: stage px, measured on open and on resize only, clamped to the room left). The last
mounted slot wins (the title stays mounted under a ladder page). No slot (hero select, games, spectating, replays) =
the fixed corner as before. The `html[data-fdock]` footer / Settings shifts are gone.

After: the sweep is clean on every size and screen (see the PR for the worst-size before/after shots).
