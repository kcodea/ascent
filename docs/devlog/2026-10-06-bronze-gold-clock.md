# 2026-10-06 · Bronze ranked games use the Gauntlet's gold-spend shop timer

Owner ask (2026-10-06), verbatim: *"the system we implemented for the gold spend timer in gauntlet. i want to make that
the experience for all players who are bronze ranked. once you become silver, it should transfer over to the standard
timer experience. we should have that as a notification on the silver rank up screen"*. Follow-ups: *"lets do 20
gold."*, scope = ranked (rated) lobbies only while the player is Bronze, and *"can we up it to a 90 second timer on
turns 9+?"*. Rules: **R-TIMER-BRONZE-01** (the clock), **R-TIMER-BRONZE-02** (the Silver notice).

## What changed

- **One gold-spend clock, two configs** (`packages/ui/src/goldClock.ts`). `goldClockOf(run)` is the shared predicate:
  a Gauntlet stage gets `{ gold: 30, seconds: 60 }` (unchanged, R-GAUNTLET-04); a rated lobby started in Bronze gets
  `{ gold: 20, seconds: 60 }`, 90 seconds from turn 9; everything else gets null (the standard clock). Recruit
  (`turnSeconds`, the start effect, the `clockWaiting` tick gate, the ShopTimer plaque's `spent/goal` bar), the
  store's Thymepiece clock stamp and `DiscountWindowReadout` all ask it, so a Bronze lobby behaves exactly like a
  Gauntlet round apart from the numbers. `gauntlet/gauntletClock.ts` keeps the Gauntlet's own names as thin wrappers.
- **"Is Bronze" is pinned at run start**: `RunState.medalAtStart` (optional, serializable; one field in
  `packages/sim/src/state.ts`, read by nothing in the sim). The store stamps it with `pinMedalAtStart(run, profile)`
  in `pickHero` and `newRun`, beside `runId`, and only on a RATED table (an all-generated lobby is unrated,
  R-LOBBY-06). It rides the save, the cloud save and replay frames, so a game started in Bronze keeps its clock
  through Save & Quit, a cloud resume and a promotion earned elsewhere mid-game. A brand-new account (Bronze I) counts.
  Old saves have no pin and keep the standard clock.
- **The Silver notice** (`rank/rankFormat.ts` `silverClockNoticeOf`, `RankScreen.tsx` `.rankend-notice`): on a
  promoted result whose `before` is Bronze and `after` is Silver, a gold-edged plaque appears once the sequence has
  settled: "New at Silver: the standard shop timer. Your shop timer now starts at the beginning of every turn, like
  other ranked players." The sentence is appended to the live-region announcement. One-shot rise, transform/opacity
  only. A `promo-silver` fixture shows it in the DEV Rank Screen preview.

## Things worth knowing

- Save & Quit needed nothing new: the parked value (99999) is what is saved and restored, exactly as for the Gauntlet.
- The announcer's clock lines (TimeRunningOut at 15 s, Idle, FastTurn) only hear a turn once its countdown runs, since
  a parked clock does not tick. A Bronze turn ended before 20 Gold is spent can never be a "fast turn".
- No per-frame work: the threshold check is one comparison when `goldSpentThisTurn` changes.
