# 2026-10-27 — Duos: teammate tier-up burst, "still working" glow, one rail slot per team

Owner asks (Versus Duos + Ranked Duos): a burst over the teammate portrait when they tier up; a glow on it while an End
of Turn hang is the teammate's; and chunkier team slots on the lobby rail.

- **Signal source.** A Duos player already receives and caches the teammate's spectator stream
  (`spectate.receiveSpectate`, `trackDuosMatch`). Each frame now goes through `versus/duosMateSignals.ts`
  (`noteMateFrame`): a tier that goes UP between two frames bumps `tierPop[seat]`; the view's wave / phase and the round
  of an `endTurn` act with End-of-Turn beats are kept per seat (written only on change). No new network traffic.
- **Tier-up.** `DuosMateDock` plays the player's own `shop-tier-up` def over the disc centre (scale 0.85) on each new
  count; never on mount, never while watching the teammate (their screen shows the press), never at Hero Select.
- **Working glow.** `mateWorking` (pure): the round has closed (`combat`, or `resolving` after their End Turn press)
  and the teammate's view is still on that round's shop (their End of Turn is playing), OR I am back from the fight and
  they are not, with their fight still playing. Never while they only shop or are away. CSS (`duosMateSignals.css`):
  a static gold shadow breathing by opacity (`kwglow`) plus a turning arc (transform), faded in after 0.6 s so an
  instant End of Turn never flashes it; also drawn on the tag-in copy.
- **Rail.** `LobbyPanel` wraps each Duos team's rows in `.lobbyteamslot` (`versus/duosRailTeams.ts`): team name on top
  (Ranked Duos), both members (face + name), the team's one pool + bar at the foot; the slot carries you / next foe
  (pulse moved to the slot) / out. Solo rails are untouched.

Found while testing (not fixed here, out of scope): on the bench prod build the dock's `measureDock` never produced a
geometry (its inline style stayed empty in shop and fight), so it sat at its CSS fallback spot and the tag-in copy over
your own hero never mounted. Worth its own look.

Rules: R-DUOS-MATE-SIGNALS-01, R-DUOS-RAIL-TEAM-01.
