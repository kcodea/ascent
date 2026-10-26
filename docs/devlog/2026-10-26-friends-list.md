# 2026-10-26 — Friends: requests, blocks, presence and Versus room invites (feat/friends-list)

**Why.** Owner (2026-10-26): "yes to adding a friends list that shows online players, to simplify invites" (Ranked Duos
parties and Versus rooms). Rules in `docs/GAME-RULES.md` (Friends), oracle R-FRIENDS-01..05.

## Server: `supabase/migrations/2026-10-28-friends.sql` (NOT applied; the lead applies it)

Additive and idempotent. Tables `friendships` (one ordered pair row, requester, `pending | accepted`), `user_blocks`,
`player_presence`, `friend_invites`, `friend_rate` (the rate-limit ledger). Every write is a security-definer RPC; the
client roles may only SELECT their own rows (RLS: my pairs, my blocks, invites I sent or got, presence of me and my
accepted friends). RPCs: `friends_request` (by id or `Name#1234`; a crossed request accepts), `friends_respond`,
`friends_cancel`, `friends_remove`, `friends_block` / `friends_unblock`, `friends_beat` (presence write + inbox
answer), `friends_list` (the batched read), `friends_invite` / `friends_invite_respond` / `friends_invite_cancel`.
Accounts only (`auth.users.is_anonymous` false on both ends). One Realtime publication entry: `friend_invites` (the
client listens to INSERTs filtered to `to_user = me`). No Edge Function.

## Client (`packages/ui/src/friends/`)

- `friendsRemote.ts` the adapter + error sentences; `friendsStore.ts` the state, presence derivation, the beat, the
  list loop, actions, the invite API (`inviteFriend(userId, kind, target)` + `registerInviteHandler(kind, fn)`, which
  the Ranked Duos party will use with kind `duos_party`); `friendsGo.ts` Watch and Accept through the existing paths
  (`watchLiveGame`, `openVersus` + `joinRoom`).
- `FriendsPage.tsx` (new sidebar page, Community > Friends; `showFriends` / `goTo('friends')` in the store),
  `InviteNotice.tsx` (corner notice on the `.vspanel` look, menus only), `RoomInvitePanel.tsx` (the room's
  "Invite friends"), `AddFriendButton.tsx` (another player's Career header; the room panel's "In this room").
- The Leaderboard rows stay button-free (owner 2026-10-16: "the big CAREER PAGE + WATCH buttons on every row are
  heavy"): a row opens the player's Career, whose header carries Add friend. Recent Games and match rows lead there too.

## Egress (R-FRIENDS-05)

One call is the whole periodic cost: `friends_beat` every 60 s visible / 120 s hidden / 180 s with no friends, at
once on a status change (5 s floor), backing off on failure, never for a guest, stopped by an undeployed server. It
returns the inbox, so requests and invites need no extra poll. Response bodies measured on the SQL (PGlite): beat ~95 B
(518 B with one invite), list 122 B empty / 1.9 KB at 5 friends / 3.8 KB at 10 / 7.5 KB at 20, invite 158 B, accept
136 B. Wire bytes (headers, gzip, the Realtime INSERT frame) can only be measured once the SQL is live: run the
egress meter (`__egress.mark`) with the Friends page open 60 s and one invite round trip.

## Verification

`friends.db.test.ts` (21 cases: every RPC, RLS, grants, limits, expiry), `friendsFlow.db.test.ts` (the real client
adapter against the SQL), `friends.test.tsx` (presence, beat cadence, invite subscription gating, the page, the
plaque, the notice). Screens checked in the Browser pane against a faked network (no backend writes).

## Follow-ups

- Live two-account check (request, accept, presence, room invite, decline/expiry, block) once the SQL is applied. It
  needs two EMAIL accounts: the Claudebot identities are anonymous and cannot hold friends by design.
- Ranked Duos party: call `inviteFriend(friendId, 'duos_party', partyId)` and `registerInviteHandler('duos_party', ...)`.
