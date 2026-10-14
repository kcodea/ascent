# Versus phase 2: spectating (2026-10-14)

Owner said yes to Versus phase 2. Owner, verbatim: "spectators should be able to change the player they are spectating
within a spectator ui". Branch `feat/versus-spectate`, stacked on `feat/versus-phase0`. No migration, no deploy: the
spectator table, the publish RPC and the protocol (`spectatorView.ts`) were already live from phase 0.

## What a spectator gets

- A seatless room member enters the WATCH screen as soon as a match reaches its shop (joining mid-match lands on the
  current moment). One player's full game screen at a time, on the real components: Recruit, the board, the hand, the
  HUD, the opponent block from that player's side, the clock, every fight and its recap.
- The spectator bar, top left: both players as plates (Match details' seat portrait, name, hearts), the watched one lit.
  Click a plate or press 1 / 2. Switching is instant: both seats' views are cached. In a fight the same control picks
  whose side the fight is shown from. The bar's hearts are the screen's own (the watched run's two-seat lobby), so it
  never gives away a fight that is still playing.
- Leave (the bar, or the Esc menu's "Leave match") returns to the room; the room's Watch button goes back. The room shows
  "N / 20 watching" beside its name; the bench already showed the spectators.

## How

- `versus/spectate.ts`: the receiver. Keyframes from `versus_spectator_frames`, deltas from the room's broadcast channel
  (`applySpectatorMessage`). A sequence gap re-reads the keyframes and broadcasts `spectate_key`; a player answers on its
  next ordinary deferred publish (a sticky flag, never per spectator). Renders are coalesced to one per animation frame,
  and an unchanged view keeps the same run object.
- The watch screen is the replay viewer's render-only mode (`replaying` with no replay session): `dispatch` and End of
  Turn preparation swallow every action, the board is inert (`.app.viewing`), the hero-power and Equipment aims never
  arm, emotes never open. A right-click inspect still opens.
- The fight on screen is the watched seat's own `CombatResult` from the committed round row (rounds are readable by
  every member). A view whose fight has not been read yet holds the previous frame and asks for the rounds.
- A view with no two-seat lobby (the test bot's) gets one built from the rounds for that seat, cached per round.
- Players: the frames writer does nothing at all while no one is in the stands; a newcomer in the stands gets a
  keyframe on the next publish.
- The test bot now publishes spectator frames like a person's client, and shows each fight on its run while it watches
  it (it used to jump straight from the lock to the next shop).

## Verified

Live with two test bots (one per browser identity, `localhost` and `127.0.0.1`) and the room host in the stands:
shop on both seats, 1 / 2 switching, fights from both sides, input inert, Leave back to the room. Uncapped headless
(dev build, D3D11): 8 s of the watch screen, combat p50 0.3 ms / p99 1.2 ms, shop p50 0.3 ms / p99 1.3 ms, with one
158 ms frame at a shop opening (the round's new run mounting). Tests: `versus/spectate.test.ts`. Oracle:
R-VERSUS-SPECTATE-01.
