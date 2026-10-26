# 2026-10-26 — Versus: End Turn is a ready signal, the round closes faster, Duos tag-in and the dock clear of the rail

Owner feedback after playing Ranked Duos with a friend (2026-10-26), one PR (`fix/duos-ready-flow-portraits`):

1. "hitting end turn shouldn't restrict anything, it should just signal that you are ready to move on, but you should be
   able to move things around on your board/view your teammate's board etc still." Then, for every mode: "the end turn
   ready-signal should be the same for versus modes too. it's a ready signal, not a 'i cant do anything anymore'".
2. "there's a ton of hang time when time hits 0 / when both players ready up, id like to make that more seamless."
3. "the player frame doesn't need to swap to the teammate's when they come in to attack. we can fade out their frame from
   the bottom right, and fade it in eclipsing the player hero in the bottom left or slightly offset".
4. "the teammate is behind the lobby rail ... we dont need the health there since we have it under the player frame".

Oracle: R-VERSUS-READY-01, R-DUOS-FLOW-01, R-DUOS-SLOTS-02, R-DUOS-VIEW-05 (R-DUOS-SLOTS-01, -VIEW-03, -PASS-01 amended).
Rules: GAME-RULES.md (Versus rounds, Group, Versus Duos, Ranked Duos).

## 1. End Turn is a ready signal (every Versus mode)

- **Client.** `versusTurn` has a `ready` kind: End Turn pressed while the round is open. It holds nothing (no `.vshold`,
  every action allowed; the 0:00 engine lock still ends shopping). Only once the server closes the round (`resolving`)
  is it `locked` and held. The gem shows pressed with "Players ready N/M" and stays live: a second press above 0:00
  un-readies (`unreadyTurn`, relights with the End Combat shine; a second click inside 450 ms is the same press).
- **The board that fights is the board at the close.** While ready, every run change re-locks: the final side, checkpoint
  and scout are rebuilt on a clone exactly as the lock is (`readySideOf`) and sent with a newer seq (`relocks`, idle, 200
  ms, skipped when the checkpoint is unchanged; flushed at 0:00). Lock, re-locks and un-ready go out one at a time in
  press order (`inOrder`), and share one seq counter, so an un-ready never overtakes the ready it takes back.
- **Server** (`supabase/migrations/2026-11-01-versus-ready-signal.sql`): `versus_submit` (1v1), `versus_group_submit`
  and `versus_ranked_duos_submit` accept a final side from an already-ready seat with a newer seq (replace side /
  checkpoint / scout, keep the seat ready and Ranked Duos' first `locked_at`); older sends and stray candidates are
  ignored without an error. `versus_unready` (1v1) and `versus_group_unready` (Group / Duos / Ranked Duos) take the signal
  back above 0:00 only (`deadline_passed` at 0:00, `stale_round` once closed). `versus_duos_pass` no longer refuses a
  ready sender. versus-resolve already fights the stored final side at the close: no resolver logic change for this.
- **"Connection problem" on a double press.** A second gate press after the room started (`room_not_sealed`) no longer
  sets the room error, and a failed lock no longer parks "Connection problem. Try again." for the room screen (it was
  never visible in a match, only after it). A double End Turn press is one press.

## 2. The hang between the last ready (or 0:00) and the fight

Measured live (headless prod bench builds of `origin/main` and this branch, Claudebot5 + Claudebot10, in-tab test bots
Claudebot6/7 for the other Versus Duos team, the live backend). Per round, from the LAST End Turn press (or the clock's
0:00, or Ranked Duos' gate moment) to the fight on screen, both clients:

| Case | Before (main) | After (this branch, resolver not yet redeployed) |
| --- | --- | --- |
| Versus Duos, both ready | 2.4-3.8 s, typically ~3.2 s (13 rounds) | 2.0-3.6 s, typically ~2.4 s; 2 rounds of 9-13 s |
| Versus Duos, clock to 0:00 | 2.8-3.2 s | 2.8-4.2 s |
| Ranked Duos, both ready | 1.5-2.4 s (2 rounds) | 2.1-3.3 s (2 rounds) |
| Ranked Duos, one ready, gate (0:00 + 5 s) | ~2.9 s after the gate moment | (not repeated) |

Where the time goes now (the in-app timeline, `versusFlowTimings()`, the closing client):
- close seen to resolver asked: **~2 ms** (was up to the next 500 ms tick, then every player asked);
- the resolver call itself: **1.7-2.7 s** typically, and 8.4 / 11.5 s twice, both times with a second client's backstop
  call in flight (a second resolver instance spinning up);
- resolver answer to the fight row in: **~110-180 ms** (match row + round in parallel; was ~4 sequential reads);
- fight row to the fight on screen: ~2 ms (plus the End of Turn effects when a board has them).

So the client side is down to ~0.3 s around the resolver, and the resolver is the remaining hang. A no-op resolver call
measured 390-930 ms (the caller check `auth.getUser()` plus one read; a refused call without them answers in 40-170 ms).

Changes:
- `onOwnAnswer`: the client whose own lock / re-lock / reconcile closed the round asks the resolver at once; the others
  only as a backstop after **4 s** (the duplicate calls went with the slow answers).
- `refreshMatch(id, true)` / `prefetchRounds`: after the resolver answers (and on the round's realtime insert) the match
  row and the committed round are read in parallel; `groupMatch`, `groupRounds` and `rankedRounds` read their two tables
  in parallel.
- `armCloseTimer`: the shop's close (deadline + grace; Ranked Duos: the gate moment) is reconciled on its own timer.
- Realtime wake coalesce 120 -> 50 ms.
- **versus-resolve** (`supabase/functions/versus-resolve/index.ts`, needs the redeploy): the caller check runs in parallel
  with the reads the handler will make (`callerId`, `memoReads`, `prefetchable`: only for a bearer request naming a
  well-formed match and round), instead of before them, and those reads (match, final sides, seats, teams; Ranked Duos'
  round input) all start at once. Expected to take the auth round trip (~0.4-0.7 s measured) and one or two read round
  trips off every finalize; to be measured after the redeploy. `versus:parity -- bundle` 98/98.

Not done (needs an owner call): starting the End of Turn / combat curtain while the resolver is still working. It would
hide most of the remaining ~2 s but plays the real End Turn before the fight exists, a bigger change to the Versus land
path.

## 3. Your hero slot stays yours (R-DUOS-SLOTS-02)

`StatusBar` no longer swaps the player's portrait, skin, frame or name to the teammate. While the teammate's board fights
on your side (`useDuosCombat.selfSeatId`), the bottom-right `DuosMateDock` fades out (`.tagged`, an opacity transition)
and `DuosTagIn` fades a copy in over your own hero, up and to the right (`--duos-tag-x/-y` 0.42 / 0.3 of the disc,
`--duos-tag-s` 0.82, in front), then back. Opacity + `scale` only, one-shot. The foe slot still follows its board.
Screenshot: `scratchpad/duos-flow/shots/vduos-combat-tagin-1920x1080.png`.

## 4. The teammate portrait clears the rail, no Health box (R-DUOS-VIEW-05)

`fitDock` (pure): the dock keeps the mirror's distance from the right edge, drops to your Health box's bottom (its own
Health box is gone; the team pool is under your hero) and shrinks around its centre only as far as its "Teammate" cap
needs to clear the lobby rail (floor 55% of your hero disc). Re-fit on resize and on the rail's size changes
(ResizeObserver). Measured live: Versus Duos 4-row rail 243 px (full size); Ranked Duos 8-row rail 175 px at 1920x1080,
192 px at 2560x1080, the phone layout at 844x390 clear too (screenshots `ranked-shop-*.png`).

## Deploy (the lead)

1. Apply `supabase/migrations/2026-11-01-versus-ready-signal.sql` (after `2026-10-31-ranked-duos-live-fixes.sql`)
   BEFORE the web build ships: a client of this branch on an old server keeps playing after End Turn, but its re-locks
   are refused, so the fight would use the board at the first press.
2. `npm run versus:bundle && npx supabase functions deploy versus-resolve --no-verify-jwt`, then
   `npm run versus:parity -- remote <url>` (the finalize wiring changed; the engine and parity cases did not).

## Verification

- `versusReady.db.test.ts` (PGlite, every mode: re-lock, late sends, un-ready above 0:00 only, the newest board fights,
  passing after ready, Ranked Duos' gate keeps the first ready time), `versusLockOrder.test.ts` with the new migration,
  `versusTurn.test.ts` (ready in 1v1 / Group / Duos is not held), `flowTiming.test.ts`, `duosMateDock.test.tsx`
  (tag-in, no Health box, `fitDock`).
- Live: the two runs above (Versus Duos 2 matches per build, Ranked Duos 1 per build, conceded at round 4 so no duo run
  was recorded as eligible). The live server does not have the new migration, so the re-lock / un-ready server half was
  verified by the PGlite suite only; the client half (shop live after End Turn, "Players ready 3/4" with Refresh lit)
  was seen live.
