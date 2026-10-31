# 2026-10-31 — The Docked rail in every mode (Versus 1v1, Group, Duos, Ranked Duos)

Owner, 2026-10-31: "I think we should move all modes to this rail type. 1v1, even 3 and 4 player group games."
Built on `feat/lobby-rail-tiles` (#2489, the Docked rail shipping as the lobby rail).

- **1v1.** The `VersusFoe` block, its `.vsplace` placement and its Guides drawer are no longer drawn: you and the opponent
  are two slices (capped at the layout's Max slice height, anchored under the round slice), and the guides open from the bottom-right Guides corner (#2502),
  as in a lobby game. Where the rail cannot dock, a 1v1 is the Gem rail with two rows. `VersusFoe.tsx` (and its test,
  and the emote fallback onto `.vsfoe-face`) is left in the tree unused, a follow-up cleanup.
- **Group (3-4).** Already the ranked rail; docks as before.
- **Duos / Ranked Duos.** `dockedLayout(..., teamOf, teamLead)` lays the pairs out with an extra `DOCK_TEAM_GAP` between
  teams and returns one `DockTeam` box per pair. LobbyPanel draws a plate under each pair (dark backing + a bracket on its
  right: gold yours, red the next foe's) and, in Ranked Duos, the team's name in the gap above it (`teamLead` keeps a gap
  above the first team too). The shared pool's bar is drawn once, on the pair's last slice. Spectators get the same
  grouping (`duosTeams` reads `match.group.duos`, not the viewer's own mate). With no room to dock, a Duos table falls
  back to the old team slots on the Gem rail.
- **Player state on the slice.** `versus/versusRailStatus.ts` maps the match (1v1 or group raw) to Locked in / Ready /
  Away / Disconnected per rail seat id (`duosLobbySeatId`); others' slices show it as a one-shot pill.
- **Slice label (owner 2026-10-31: "add an option for hero name in the lobby rail as text instead of player name").**
  Lobby Rail Tuner 2 "Slice art & name" > "Slice label": Player name (default) / Hero name / None, persisted with the
  other Tuner 2 values. It feeds a tiny store in `lobbyRailVariant.ts` (`useSliceLabel`), so every mode's Docked rail
  reads it, the fallen too; production reads the default. Same font, alignment and 2-line ellipsis; the hover card keeps
  both names.
- **75% fade + presets (owner 2026-10-31: "I like the full hero art but can we add a 75% art into a fade option and try
  hero names as the text with that").** Art layout `fade75` (full-strength art over the left 75%, fading over the last
  quarter; the label from 42%, right-aligned) and two Tuner 2 one-click presets: "Full art" (Full width, label None) and
  "75% fade + hero name". Production default unchanged. The name clamp's fit test now allows 2px (scrollHeight rounds
  up, clientHeight down), which was cutting 2-line names to one line.
- **Shipped look = Full art (owner pick 2026-10-31: "i like the full art look").** Production default for every mode's
  Docked rail: the art across the whole slice (the base CSS rule; "Left fade" is now the `data-lr2-art="left"` Tuner 2
  option) and no slice label (`useSliceLabel` defaults to `none`). Slices stay identifiable by the gold you edge, the
  red foe edge and swords, team plates and the fallen's skull; the hover card names the player and hero.
- **Duos teammate portrait unchanged (owner ruling 2026-10-31: "portrait needs to remain separate for duos").** The
  bottom-right `DuosMateDock` stays the click-to-swap and drag-to-pass control. The teammate's slice is a team-grouped
  slice; it keeps the rail's existing click-to-view (R-DUOS-VIEW-01, a second way in that the Gem rail row already had)
  and is not a pass target.
- **Fix: the Health bar beside the coin / gem (R-RAIL-DOCKED-BAR-01).** The bar ran under the cut (clipped to the slice
  outline), so the start of the red was hidden beside the Gold coin and a healthy player read as nearly dead. The bar now
  starts at `--fx` (the slice's `footX`, where the foot is clear of any cut); verified live: visible fill / visible bar
  equals the bar's scale on all eight slices.
- **Hover card.** In Versus the Docked card adds the hero's name under the player's.
- **Fix found on the way.** `ClampedName` trimmed every name to "…" when it first measured before the slice had its
  box (the 1v1 rail mounting under the game-start curtain). It now skips a zero box and re-fits on its first box or a
  width change (ResizeObserver, a layout event, never per frame).

Kept as they were (flagged to the owner): the bottom-right teammate portrait (`DuosMateDock`) stays the pass drop target
and signal surface; Versus has played on Health + Armor since 2026-10-26 (R-VERSUS-HEALTH-01), so the slices show the
normal Health bar rather than hearts, and the round slice keeps "ROUND N / MAX DMG X" (Versus uses the lobby's caps).

Rule R-RAIL-DOCKED-ALLMODES-01; tests `lobbyRailDockedModes.test.ts` (layout + state) and `.test.tsx` (rendered per mode).
