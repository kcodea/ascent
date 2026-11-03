# 2026-11-03 · Spectating Duos 1:1: the cursor layer, pass streams, team names, the teammate portrait

Owner reports from live spectating Versus / Duos (2026-11-02), owner rule: a spectator sees the watched player's screen
1:1. Branch `fix/spectator-duos-layer`. UI only: no Worker, Supabase or engine change.

## Root causes and fixes

- **"mouse goes under equipment"** (R-SPECTATE-CURSOR-LAYER-01). A Versus spectator's `SpectatorCursor` was mounted by
  `SpectatorBar`, which lives inside Recruit's `.app`. In the shop `.app` is a stacking context (`z-index: 1`) and the
  hero cluster `.statusbar` (portrait, hero power, Equipment) is its sibling at z40 / z100, so the cursor's own z540 only
  counted inside `.app` and the whole layer painted under the Equipment slot. (In combat `.app` dissolves its context,
  which is why it only showed in the shop.) Now ONE root mount, `versus/SpectatorCursorLayer.tsx`, in Game.tsx's replay
  layer block, serves all three paths (Versus stands, Live Games, a replay with a recorded stream); `SpectatorBar` and
  `LiveWatchBar` no longer mount it. Same z540 rung, now measured against the HUD; under the replay transport by DOM order.
- **No pass animation for spectators** (R-SPECTATE-DUOS-PASS-01). The streams were played only by a seated player's own
  transport (`duosPasses.ts`: sends as entries ship, gifts on their `teamSend` beat, arrivals as rows land). A spectator
  ships and lands nothing. Now the stands play them from the frames: `spectatorPasses.watchedPasses(prev, next)` (pure)
  finds new outbox entries and newly received pass keys between two frames of the same watched run; `spectate.ts render`
  streams the sends before the new frame replaces the screen (the source is still drawn) and the arrivals after it.
  A drag pass (`passCard`) is now a tagged spectator act, so the stands' held card parks where it was let go (a committed
  drop) and streams from there (`presentHeldDrop`), once; an older player's untagged pass streams from the hand card.
  Fight gifts: `useDuosCombatSync` streams each held entry from its unit when this screen's replay reaches its
  `teamSend` beat. `playEntryFlight` takes the run id for its play-once key (every watched run carries seed 0).
- **No team names** (R-SPECTATE-DUOS-TEAMNAMES-01). `LobbyPanel` built Ranked Duos labels only from `group.me`, which is
  null for a spectator. It falls back to the watched seat. The names were already on the wire (match row + ranked table).
- **No teammate portrait** (R-SPECTATE-DUOS-MATEDOCK-01). `DuosMateDock` needs `group.me`. A `stands` mode reads the
  watched seat's teammate (`duosMateOf`), face only (no click, no pass target), mounted by `SpectatorBar` in the shop and
  the fight. The stands now record the teammate signals too (`noteMateFrame` for a Duos spectator), so the tier-up burst
  and working glow show. The stands' player switcher moves to the top edge in Duos (`.vswatchpanel-top`), since the
  bottom-right corner is now the portrait.

## Verification

Unit + scenario tests in `packages/ui/src/versus/spectatorDuos.test.tsx`. Real-browser run on a local `wrangler dev`
Versus Worker with a VITE_PERF_BENCH bundle and Playwright's bundled headless shell (throwaway contexts): Ranked Duos
(2 players + a spectator) and Versus Duos (4 + a spectator). The spectator's cursor layer has no stacked ancestor but its
own z540 and draws over the Bloodpot; the dock reads the right teammate; the rail's team names match the player's; a
pass streams from the hand into the dock with its coin; a pass back coalesces into the watched hand.

## Deploy

None beyond the web build. The spectator stream already carried everything needed (each seat's frames with `duos`,
the match row's team name, the ranked table's names), so the Versus Worker needs no change or redeploy.
