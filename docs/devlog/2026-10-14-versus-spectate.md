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

## Follow-up: the player's actions and live hand (2026-10-14)

Owner-approved upgrades:

- **Action animations.** Each committed shop action becomes a small tag on the next spectator delta
  (`spectateTap.ts`: `{ t, uid, index, drag }`; a drag-driven action carries the replay recorder's own drag path).
  The spectator plays the watched player's actions one at a time (`spectate.ts`): a dragged buy, play, sell or move
  flies the player's own path over the screen as it was (the replay viewer's drag ghost and card hold) and lands; the
  button actions replay the button's own press visual through `pressCue.ts` (Refresh, Freeze, Tavern Up, the hero
  power), which the buttons now share with their own click; every action plays its live sound (`actionSfx`). More
  than two queued actions land without flights, so the screen never falls behind; switching players drops the queue.
- **Live hand.** While someone watches, the player's client sends its pointer as window fractions plus the card in
  hand, about 15 Hz, coalesced, from a passive move listener and a timer (no layout read); a backgrounded or idle tab
  sends one hide. The spectator draws the game's gauntlet about 100 ms behind, interpolated (`SpectatorCursor.tsx`),
  with the held card under the closed fist and lifted out of its zone. A drag the spectator watched live is not flown
  again when it lands.
- **Polish.** The spectator bar's players and the stands' bench use the portrait ring with the member's frame
  cosmetic (`MemberRing.tsx`), the opponent block's name and heart pills, and a lit state for the watched player.

Measured (dev build, headless with the GPU, uncapped, steady shop): the player with one spectator p95 0.4 ms, p99
0.6 ms, 1 frame over 6.25 ms in 6 s, and with none p99 0.3 ms, 0 over; the spectator with the cursor streaming p95
0.8 ms, p99 0.9 ms, 0 over. Spikes above that came only at the round's lock and fight start. Tests:
`versus/spectateLive.test.ts`. Oracle: R-VERSUS-SPECTATE-02.
