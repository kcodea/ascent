# 2026-11-18: Add friend on another player's Career, and your tag in Settings

Owner asks (Kevin, two screenshots).

- **Career header.** The party home Career of another player lost its friend control on 2026-11-06 (`PhCareer` rendered
  `addFriend` only on your OWN page, where it is always null). It is back as `PhAddFriend`
  (`partyHome/pages/career/PhAddFriend.tsx`): a kit `PhButton` in the header actions, left of the close X. The
  relationship logic is the shared `useAddFriend` hook lifted out of `friends/AddFriendButton.tsx` (the classic Career
  and the Versus invite panel keep the old button). One press calls `addFriend(userId)` (`friends_request` by id).
  States: Add friend, Request sent (disabled), Accept friend, Friends (disabled). Hidden for yourself, guests, blocked
  players, no backend, the same as before. A refusal shows the friends flash text beside the button, because the
  Friends panel that normally shows it may be closed.
- **Entry paths.** Only the Leaderboard (two calls in `Rankings.tsx`) and Recent Games (`RecentGames.tsx`) open another
  player's Career, and `CareerView.userId` is a required string, so the id is always there. Live Games and the friends
  list do not open a Career today.
- **Settings, Account.** A first row with `formatHandle(playerName, account.discriminator)` and a Copy button
  (`navigator.clipboard.writeText` in the click, rejection caught, reads Copied or Could not copy). Guests get a tag
  from `claimHandle` too, so they see the row with a note that adding friends needs a sign in. No tag yet: no row.

Rules: R-CAREER-ADD-FRIEND-01, R-SETTINGS-ACCOUNT-TAG-01. Tests: `partyHome/pages/career/phAddFriend.test.tsx`.
