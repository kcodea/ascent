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

- `spectateTap.tapSkipCombat()`: the Skip press is a tag (`t: 'skipCombat'`) on the next message. The watch screen
  turns it into a request (`useSpectate.skip = { wave, n }`, like the existing `seek`), and Recruit runs its own
  `skipCombat` once that fight is actually playing (`fighting`) and not done. A first version fired a press cue at once;
  live testing showed the tag usually lands during the fight's entrance curtain, before the replay exists, so the cue
  did nothing. The request waits for the fight instead.
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

## 4. Spectators drawn like players (R-SPECTATE-HUD-03)

Owner (via the coordinator): "make the spectators look a bit larger, and set them up like a normal 'player' or hero
where the names under the portrait." CSS only (`versus.css`): every `.vswatch-seat` (the player's Spectating row and the
spectator's own row) stacks the ring on top (72u, 84u for the spectator's own plate, up from 44u / 54u), the name plate
under it tucked over the ring's edge like the hero's, and the Spectating / Muted tag smaller under that. The row wraps.
Same markup, same ring / name / pill classes.

## 5. A reloaded player froze their spectators (R-SPECTATE-RESUME-01)

Found while testing with two clients. A publisher's `seq` started at 0, so a player who reloaded or reconnected sent
seq 1, 2, ... again: every spectator dropped those as stale (`applySpectatorMessage` ignores a seq at or below the one
it holds) and the server's keyframe upsert (`versus_publish_frame`, `lobby_live_publish_frame`: only a higher seq
replaces) kept the old frame. The stands froze on the round before the reload. `newPublisher` now starts at
`Date.now()`, so a new session always outranks the last (seq is a bigint in both tables). Verified live: the host
reloaded at round 5 and the spectator moved from round 1 to round 5 at once.

## Verification

- Unit tests below, plus typecheck, lint, test, build:web.
- Two clients against the live backend (Versus room, host + the in-tab test bot + one spectator; identities named
  Claudebot1 to Claudebot4, plus two test bot accounts, one per browser profile): the spectator entered each fight within about 200 ms of the
  host, the host's Skip reached the spectator about 300 ms later and its replay finished early, and when the host went
  back to the shop the spectator's exit curtain started about 600 ms later and the shop was on screen about 1.8 s later.
  The Discover cards on the watch screen had `pointer-events: auto` and the gauntlet cursor (Disco Dan's turn-1
  Discover). The restyled plates were checked on desktop (1600x900) and the phone layout (844x390), with five fake
  watchers (three plates, then "+2").
- Seen while testing, NOT fixed here: a host client that sat behind the pre-match gate crystal for a whole shop stayed
  on round 1 locally while the match moved on, until it reloaded. Probably a scripting artefact (nobody pressed the
  crystal), but worth a look.

## Tests

- `packages/ui/src/versus/spectateSkip.test.tsx` (new): the tap, the mirrored skip, the immediate exit with held shop
  actions, the same-hero seat switch on the watch screen, and the Discover card's hover rule.
- `packages/sim/src/versus/versusFoeDriver.test.ts` (new): a grown lobby and the other side never reuse a driver.
- `packages/ui/src/versus/spectatorParity.test.ts`: "leaving a fight" now expects the exit at once.
- `packages/ui/src/versus/spectatorView.test.ts`: a reloaded publisher outranks the old session.
- `packages/ui/src/versus/spectatorHud.test.tsx`: the plate layout.
