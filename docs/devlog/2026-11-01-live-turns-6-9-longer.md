# 2026-11-01 · Live modes: turns 6 and 9 get 25 more seconds

Owner ask 2026-11-01: "Add 25 seconds to turn 6 and 9 in all live modes, aka all but ranked solos". Branch
`feat/live-shop-bonus-6-9`. Rule R-VERSUS-TURN-TIME-02 (approved/actions.ts; R-VERSUS-TURN-TIME-01 notes the addition).

## What

- `LIVE_SHOP_BONUS_SECONDS = { 6: 25, 9: 25 }` in `packages/sim/src/versus/constants.ts`, added inside
  `versusTurnSeconds` AFTER the mode percent (flat seconds, not scaled). That one function already feeds every live
  deadline: `roomCore.turnSeconds` (1v1) and `groupMatch` openShop / startClock (Group, Duos, Ranked Duos, which
  extends GroupEngine), plus the HUD's pre-deadline face in `VersusHud.tsx`. Once a deadline exists the HUD, the 0:00
  lock, spectators and the test bots all read the server's `shop_deadline`, so nothing drifts.
- New lengths, rounds 5/6/9/10: 1v1 / Group 39, 76, 89, 69; Duos / Ranked Duos 44, 82, 98, 78.
- Unchanged: the ranked solo lobby and Practice (`standardTurnSeconds`), Hero Select, intro cap, combat, pause grace,
  Ranked Duos overtime. The legacy Supabase `versus_turn_seconds` SQL is not touched (Versus is Cloudflare-only).

## Ship note

Needs the next pack (Worker redeploy of `workers/versus`) for the server deadline; a client without the Worker would
show the longer face only until the deadline arrives, then follow the server.
