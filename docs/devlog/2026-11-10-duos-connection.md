# 2026-11-10 · Duos connection fixes (netcode audit follow-up)

Branch `fix/duos-connection`. The owner approved fixing the findings of the 2026-11-09 Duos netcode audit
(`.versus-qa/NETCODE-AUDIT.md` in the `duos-audit` worktree; F-numbers below are its). **The Versus Worker must be
redeployed after merge**: half of this is server code.

Rules: R-RANKED-DUOS-AWAY-GRACE-01, R-VERSUS-AUTO-NEWEST-BOARD-01, R-DUOS-PASS-EXPIRE-01, R-VERSUS-LINK-STATUS-01,
R-VERSUS-CF-PROBE-01, R-VERSUS-CF-LOST-CALL-01, R-VERSUS-CF-FETCH-TIMEOUT-01, R-VERSUS-CF-RELAY-SCOPE-01,
R-VERSUS-CANDIDATE-DEDUPE-01.

## What changed, and every number

| Item | Change | Value | Why that value |
|---|---|---|---|
| F1 | Ranked Duos: a seat with no socket is away (auto) after a longer grace | `RANKED_AWAY_GRACE_MS = 12_000` | the client's worst ordinary reconnect: 8 s handshake watchdog + 3 s backoff cap + 1 s hello. Never past the round's own clock: a seat inside the grace is "not ready yet", and 0:00 + 30 s overtime still closes the round |
| F1 | An auto seat fights the newest board the room holds for the round, else the last locked one | none | the candidate is the freshest truth the server has |
| F3 | A card pass waiting on a seat that is auto / left / out is refused by the room (`reason: 'teammate_away'`) | no timer of its own | tied to the same moment new passes are refused, so there is one definition of "away" |
| F2 | Connection status: hidden under 1.5 s, "Reconnecting", then "Connection lost" | `LINK_SHOW_AFTER_MS = 1_500`, `LINK_LOST_AFTER_MS = 12_000` | 1.5 s = the first four retries (100 + 200 + 400 + 800 ms); 12 s = the moment the room treats the seat as away, so the stated consequence is true |
| F2 | A socket closed for good fails requests at once; `reclaim()` reopens it | none | it used to queue each call for 15 s |
| F11 | Probe on visible / pageshow / online; a late keep-alive timer probes instead of dropping | `VERSUS_CF_PROBE_MS = 2_000` | one round trip on a slow phone link, far inside the 15 s stale window |
| F4 | `timeout` / `closed` reach the store as `network` | none | the recovery paths key on `network` |
| F10 | Supabase fetch deadlines | read 5 s, write 15 s | two reads fit the 12 s table wait; a 1.5 MB result row needs longer, and the write is idempotent |
| F10 | A round waiting on a table that failed to read is seated with generated teams | `RANKED_SEAT_MAX_FAILS = 3` | three 5 s retries; only when a round is actually waiting, so a rated match is not given up while nothing is blocked |
| F12 | The rating read keeps going while the screen is up and reads as still saving | quick reads as before, then every 8 s, each read 8 s deadline, stop after 10 min | the room's outbox gives a write up after about 8 minutes |
| F6 | Spectator frames, cursor and keyframe asks are relayed to the stands and the teammate only | none | |
| F17 | The Duos cursor stream only while the teammate is viewing (or the stands hold someone) | beat 5 s, lapse 12 s | one lost beat is covered; a viewer who vanished stops costing within 12 s |
| D8 | An identical candidate is not uploaded again | none | |
| F5 | In the last 2 s of a clock-closed round a change is sent on the next task, not at idle | `CLOSING_FLUSH_MS = 2_000` | covers the 600 ms idle wait several times over |

## Things a future session would otherwise re-derive

- `finalizeSeat(seat, auto)` used to do `cur.prepared_side = last ?? cur.prepared_side` for an auto seat. That one line is
  the whole "last round's board fought" bug; the 3 s grace only made it easy to hit.
- A SILENT drop (a stale socket: the room only notices after 15 s without a keep-alive) is credited 9 s of the 12 s
  (`RoomCore.staleSilenceCredit`), so it is away 3 s after the room notices, 18 s in all, exactly as before. Without the
  credit a silent drop would have taken 15 + 12 = 27 s. Ranked Duos only; the other modes' pause timing is untouched.
- The room's `DISCONNECT_GRACE_MS` (3 s) is NOT changed. It still decides when a 1v1 / Group / Versus Duos match pauses
  (audit F16 asks for 6 to 8 s there; not in this PR). Ranked Duos reads `goneFor()` against its own 12 s.
- Pass expiry has one known gap, written into the rule: a receiver whose run landed the card in the very instant its
  connection died, and who then stays away past the grace, keeps the card while the sender is refunded. Closing it needs
  an "un-receive" in the run reducer. The old behaviour lost the card for good every time, so this is the better side.
- A receiver viewing the teammate keeps pushed passes in `owed`; a later push of the same pass (the refusal) now REPLACES
  the kept row. Without that an expired pass would land when they returned.
- `makeCfVersusRemote` is built more than once per tab (the dev test bots, the chaos harness). Only the game's own
  instance sets `reportLink`, or a bot's socket state would drive the player's status.
- "Back to menu" on the replaced-tab panel is `leaveVersusLocally`, which never calls the server's `leave`: that would
  forfeit the match for the tab that is playing it. It lands on the main menu, not the Versus door, because the door
  looks for my room again and would take the socket back.
- A replaced socket never reconnects by itself, on purpose: two tabs would trade the socket for ever.
- The relay scoping needs no protocol bump: message shapes are unchanged, and a new client on an old Worker still works
  (the old Worker relays `spectate_watch` to everyone; the client filters by seat).

## Not done (reported to the owner)

- F5's server half: a short "closing" window in which a higher seq from an already-final seat still replaces the side.
- F7 (a reload mid-shop loses the turn so far), F8 / F9 (dead air behind the gate, no overtime clock), F13, F14, F16,
  F18 to F29: outside this PR's list or a redesign.
- "Waiting for <mate> to reconnect" on the present teammate's End Turn pill: the pill lives in files another PR owns.
  The match json already carries what it needs (the seat is simply not auto yet).
- No sound for the connection states (none exists; not added by rule).

## Verification

Unit: `workers/versus/test/duosConnection.test.ts`, `relay.test.ts`, `clientLink.test.ts`;
`packages/ui/src/versus/versusConnection.test.ts`, `candidateDedupe.test.ts`. Live, local stack only
(`scripts/versus-qa/duos-connection.mjs`, two headless browsers, every non-local host blocked): the 3 s blip against the
unfixed Worker and the fixed one, the long drop, and the second tab.
