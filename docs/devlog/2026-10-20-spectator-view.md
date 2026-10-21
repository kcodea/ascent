# 2026-10-20 — Spectator view: skipped fights, same-hero opponents, Discover hover

Three owner reports from spectating live games and Versus ("the spectator and versus modes need a massive amount of
polish"), fixed on `fix/spectator-view`.

## 1. A skipped fight broke the watch screen (R-SPECTATE-SKIP-01)

Owner: "spectating combat when a player skips breaks everything basically, if a player skips combat the spectator
should follow their view back to shop in real time."

**Cause.** Two gaps in `packages/ui/src/versus/spectate.ts` and the tap:

- Skip is a presentation on the player's screen (`Recruit.skipCombat`, nothing dispatched), so it never reached the
  stands. The spectator kept playing the fight at normal speed.
- The first combat view of a fight is PINNED until the spectator's own replay is done plus the strike's 2.6 s
  (`pinnedView`), so a player settle arriving early cannot cut the strike. Only a late join released the pin when the
  player went back to the shop. A player who skipped and pressed End Combat was in the shop a whole fight before the
  spectator. Their shop actions queued up and `land()` presented them (placing, played, sold, sounds) over the fight,
  because `render()` kept returning the pinned combat view.

**Fix.**

- `spectateTap.tapSkipCombat()`: the Skip press is a tag (`t: 'skipCombat'`) on the next message. Recruit taps it and,
  on the watch screen, answers the `skipCombat` press cue with the same `skipCombat`. The spectator emits the cue only
  while its screen is in that fight and its replay is not done.
- `render()` releases the pin the moment the player's real latest view has left the fight (any join, not only late
  ones). The pin still holds a fight the player is IN, so the strike is not cut by the player's settle.
- `pump()` never lands a shop action on a fight: it holds the queue (`awaitingShop`), shows the shop as it stood
  BEFORE the queued actions (each queued item now carries `before`), lets the exit curtain run, and resumes after the
  swap.

An older player client sends no Skip tag: the spectator then follows the player out when they reach the shop.

## 2. Same hero on both Versus seats hid the opponent (R-SPECTATE-SAMEHERO-01)

Owner: "having 2 of the same hero doesnt show the opponent or something idk what the deal is here but opponent info
isnt showing in combat."

**Cause.** Not a heroId-keyed React key or portrait lookup (those are all seat-keyed). The Versus display lobby's
opponent is an `authored` seat whose board table grows a round at a time, and `driverFor` caches seat drivers by
`kind:seed:heroId:runKey` (`packages/sim/src/lobby/runLobby.ts`). The player's own client evicts on every lobby rebuild
(`syncVersusLobby`). The watch screen renders the lobby the player SENT and never evicted, so:

- a driver built from an earlier lobby (the rail calls `playerOpponent` in the round-1 shop, before any board exists)
  answered every later round with no board, and `playerOpponent` returned null: no portrait, Health, board or Summary;
- the two sides of one match share the foe seat's seed, so with the SAME hero the two sides' keys are identical and a
  spectator switching seats got the other side's driver.

**Fix.** Two layers. `driverKey` for an authored seat adds its label and board count, so a grown table or the other
side (different player name) never reuses a stale driver anywhere. The watch screen (`spectate.freshDrivers`) also
evicts the authored seats of every new lobby object it puts on screen (a round, a seat switch), which covers two
players with the same name too. Only authored seats are evicted: a live lobby game's recorded seats are never rebuilt.
The fight Summary (`FightRecap`) read the same `playerOpponent`, so it is fixed by the same change. Players were never
affected (their client evicts), and an 8-seat lobby's seats have distinct seeds.

## 3. Discover cards could not be hovered by a spectator (R-SPECTATE-DISCHOVER-01)

**Cause.** An offer card takes a click, so `Card` renders it with `role="button"`, and the watch screen's inert rule
`.app.viewing [role="button"] { pointer-events: none }` (`styles.css`) removed its hover along with its press. Hand cards
have no click (they drag), which is why they could be hovered.

**Fix.** `versus.css`: `.app.viewing.spectating .discover-ov .card` takes pointer events again, with the gauntlet's
default cursor (reads, never picks), the same treatment runes got. The press still does nothing (the store swallows a
viewer's dispatch; Game.tsx skips the pick sound for `.app.viewing`). The offer cards join `LOCAL_HOVER_SELECTOR`, so
the spectator's own hover lifts the player's mirrored one, as for runes. Covers Discover, Gift picks, the hero-power
Discover, Choose One, the Quest pick and the scout.

## Tests

- `packages/ui/src/versus/spectateSkip.test.tsx` (new): the tap, the mirrored skip, the immediate exit with held shop
  actions, the same-hero seat switch on the watch screen, and the Discover card's hover rule.
- `packages/sim/src/versus/versusFoeDriver.test.ts` (new): a grown lobby and the other side never reuse a driver.
- `packages/ui/src/versus/spectatorParity.test.ts`: "leaving a fight" now expects the exit at once.
