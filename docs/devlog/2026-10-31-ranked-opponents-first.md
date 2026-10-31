# 2026-10-31: ranked picks the opponents before the hero offer (R-RANKED-OPPONENTS-FIRST-01)

Owner: "in ranked solos, are the player's hero options chosen before the opponents? and the player cannot have a
duplicate hero as someone else in the lobby right? we want full unique heroes, and i want the players in ranked modes
to get their options technically after the opponents are chosen, so it forces more variety in hero selection".

Before: the ranked offer was the whole tribe-gated roster (`rollHeroChoices`, at Play), and `createRunLobby` picked the
seven seats at the hero pick, skipping the picked hero. Uniqueness held, but the offer often showed heroes the table
would then hold (30% of entries, measured below), and the heroes that dominate the pool were offered as often as any.

## Ranked solo

- `packages/sim/src/lobby/runLobby.ts`: `createLobbyTable(seed, rules, setId, opts)` is `createRunLobby`'s selection with
  no player hero (`seatRunLobby(seed, null, ...)`: the player seat is a placeholder, `heroId: ''`), flagged
  `opponentsFirst`. `seatPlayerAtTable(table, hero, seed, setId)` fills the seat on a copy, or returns null (a held hero,
  another seed or set). `createLobbyRun(..., seatOpts.table)` uses it in `lobby` mode and falls back to the old pick.
- `packages/sim/src/lobby/opponentsFirst.ts`: `rankedHeroOffer(tribes, held, rand)` (three free heroes, `toppedUp` when
  fewer than three are free), `freeRankedHeroes` (the re-roll pool).
- `packages/ui/src/store.ts`: `startLobby` deals the table then the offer and stores the table on the `RankedEntry`
  (`rank/rankedEntry.ts`, `table` + `toppedUp`, validated on load). It returns a promise: when the pool is still loading
  it waits on `rankedEntryPoolGate` (its own gate, its panel over the shut ranked gate, `pool-wait-over-gate`); Cancel
  commits nothing. `prepareRankedDeal()` (called by the Title when the ranked confirmation opens) deals in idle time, so
  "Yes" only commits it and the ~30 ms build never lands on the gate's slam. `heroRerollPoolOf` drops the table's heroes.
  `pickHero` passes the entry's table. The Title's gate passes `onPress: () => dealt` so the crystal holds for a wait.
- `packages/ui/src/session/gameSession.ts`: `pinEntryTable` pins the table's opponent keys on the game session at "Yes"
  (the session keeps the first keys; the recruit pin later adds the recordings). Skipped for a topped-up offer.
- The launch curtain skips its pool gate for a table with no recorded seat (Play anyway at "Yes" already chose bots).

Versioning: the lobby is stored in the save, so a saved / replayed / Continued run never re-picks either way.
`RunLobby.opponentsFirst` marks the new order. An entry saved before this (no `table`) keeps the old order.

## Ranked Duos (Worker; ships with the next pack)

- `workers/versus/src/core/groupMatch.ts`: `newGroupState(..., { deferOffers })` + `dealGroupOffers(g, exclude)`.
- `workers/versus/src/core/roomCore.ts`: a ranked_duos match asks for the team AND the table at creation, offers deferred.
- `workers/versus/src/core/rankedMatch.ts`: `deal_by` (now + 12 s); `seatTable` deals the party around the six served
  heroes (`dealt: 'table'`) and starts the 20 s clock; past `deal_by` the offers are dealt the old way
  (`dealt: 'fallback'`) and the table seats after Hero Select (a table that lands after that deal is dropped).
  `pick_hero` / `reroll` refuse `not_dealt` while dealing; `register_offer` is ignored.
- `packages/sim/src/versus/rankedDuosSeat.ts`: `opponentsFirst` skips the both-heroes-locked check (no live hero).
- `packages/sim/src/versus/heroOffers.ts`: `versusDisjointHeroOffers(..., exclude)` (nothing excluded = the old deal).
- Client: `versusStore.onMatch` never rolls or registers a Ranked Duos offer itself and re-reads the private row until
  the deal is in; `versusCfRemote` announces a newly dealt offer as a match change (the match push goes out first). The
  entry gate's crystal already waits for the offer (`heroSelectReady`). The bot driver waits too.

## Measured (1000 simulated ranked entries, `set2`, a 400-run / 150-player pool skewed Zipf toward a few heroes)

- Offers showing a hero the table holds: 300/1000 before, 0/1000 after. Top-ups: 0/1000.
- Offered counts of the pool's five most-seated heroes, before -> after: warden 64->13, indy 73->41, soren 50->49,
  myra 65->47, drakko 62->61. Offered spread: before max 95 / min 50 per hero, after max 88 / min 13 (the heroes the
  table usually holds are offered less, the rest more). All 42 heroes still offered.
- `createLobbyTable`: p50 28.6 ms, p90 42.8, p99 79.9 (first call ~350 ms, warm-up) with the pool; ~240 ms with an
  empty pool (seven generated seats probed). The same build used to run at the hero pick; it now runs in idle time while
  the confirmation is read.

## Not changed (owner may ask later)

Practice keeps the old order. Doing the same there: call `createLobbyTable` in `confirmPracticeSetup` (band = the
setup's Opponent Rank via `practiceStrengthBand`, plus `seatExclusionsFor`), keep the table in store state beside
`pendingSeed`, filter `practiceHeroChoiceIds` by `lobbyTableHeroes`, and pass `table` from `pickHero` (createLobbyRun
would need to accept it in `practice` mode; the Practice-rank band sample may still be fetching at setup, so it needs
the same gate). About an hour. Note that in "All heroes" mode the exclusion shrinks a list, not an offer of three, and
Beginner mode's three fixed heroes would have to be kept (or the seats made to skip them).

"Casual" is not a separate door: it is a lobby from the same ranked Play that ended up unrated (offline, every seat
generated), so it already gets the new order. The dev-only `newRun` path is unchanged.
