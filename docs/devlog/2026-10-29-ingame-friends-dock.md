# 2026-10-29 · In-game Friends dock + friend menu (feat/ingame-friends-dock)

Owner asks (2026-10-29): a Friends button in game, bottom right, that expands upward to the online friends and opens a
DM overlay per friend (messaging later); then a right-click menu (Spectate / Invite to lobby / Invite to Duos / Invite
to spectate) on both friends lists; then "invite to lobby / duo instantly puts me in a room, he joins when he accepts".

## What shipped
- `packages/ui/src/friends/dock/`: `FriendsDock` (gate: a game screen + an account) → `DockShell` (button, catcher,
  Escape) → `DockFriendList` + `DmPanel` (a `conversation` render slot and a disabled composer for messaging).
  `dockStore.ts` holds `phase` (closed / open / closing) and `dmWith`; `openDm(userId)` is the hook messaging will use.
- Placement: slot 3 of the corner row (gear, Compendium, Rules, Friends), with matching rules for touch, phone zoom and
  the phone layout. The DEV menu button moved from slot 3 to slot 4 (dev only) so it never covers the dock button.
- Outside press: a transparent catcher closes on pointerdown and swallows the press (chosen over pass-through: the shop
  clock runs and Refresh / Tier / End Turn / Buy are one-click Gold spends).
- `FriendMenu.tsx`: one menu layer for both surfaces; entries are the pure `friendMenuEntries(friend, ctx)`.
- New invite kind `spectate`: `supabase/migrations/2026-11-11-friends-invite-spectate.sql` (NOT applied), the Worker's
  `inviteCheck` signs it for a running Cloudflare room (Worker redeploy needed), `acceptSpectateInvite` watches.
- Spectate / Watch are disabled while I am playing my own game (watching would abandon it).

## Perf
Closed = one button (no list loop, no timers). Open/close and the DM slide are one-shot transform + opacity animations;
the menu measures itself once when it opens. The online badge is the presence beat's own answer (no new call).
