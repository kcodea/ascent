# 2026-10-31: unique heroes per lobby, in every mode (R-VERSUS-UNIQUE-HEROES-01)

Owner rule (via the lead): "build unique heroes per lobby rule". No two players or seats in one game play the same hero.

## What was already true

- **Lobby** (ranked, casual, Practice with players): `createRunLobby` has skipped a held hero since 2026-09-13, the
  player's included. A run on a held hero is passed over for the next run in the shuffle; the band widens step by step
  when the table still cannot fill; generated seats fill last on fresh heroes. Practice bots use distinct portraits.
- **Ranked Duos seating** (`rankedDuosSeating.ts`): all eight heroes unique, the live pair included.

So nothing changed in lobby seat selection, and no run flag was needed: old saves and replays are unaffected.

## What changed: Versus deals the offers on the server

Before, each Versus client drew its own three heroes from its private hero seed and registered them, so two players
could be offered the same hero (Duos only blocked a teammate's pick).

- `packages/sim/src/versus/heroOffers.ts`: `versusDisjointHeroOffers(seats, setId)` deals every seat's three. Each seat
  keeps its own seeded order (`versusHeroShuffle`, the list `versusHeroOffer` always sliced); slot by slot the seats take
  turns, the first seat rotating each slot, each taking the next hero nobody was dealt. A seat alone gets exactly the
  old three (`versusHeroOffer` is unchanged, pinned by a test).
- The Worker (`roomCore.createMatch`, `groupMatch.newGroupState`) stores the dealt offers on the private rows at match
  creation. Clients already prefer the row's offer (`versusStore`, now the bot driver too), so `register_offer` becomes a
  no-op for new matches.
- Server guards for every room kind: a pick of a hero another player holds is refused (`hero_taken`), a re-roll never
  lands on a hero another player was dealt (nothing filtered = the old draw), and a clock pick takes its seeded hero
  unless held, then the first free one. RankedEngine's own teammate-only clock-pick logic is replaced by this.

Ships with the next Worker pack. Matches created before the deploy keep their registered offers.

## Pool check (step 4 of the brief)

Read-only metadata of the 433 eligible set2 runs (51 heroes, 11 owners), 1000 lobbies per band (Bronze, Silver, Gold,
none) at 50%, 75% and 100% of the pool, emulating the session sample and `createRunLobby`: about half the lobbies pass
over one same-hero run (avg 0.7 to 1.0 skips), and the rule never forced an extra band widening or a generated seat.

## Not changed (flagged)

- The Learn Ascent tutorial's seven authored omen seats all wear the `aster` portrait (portrait only, they play no hero).
- The legacy Supabase Versus SQL functions (Versus is Cloudflare-only now).
