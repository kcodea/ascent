# 2026-09-27 — Practice "Tribes": pick the run's tribes (replaces Tribe surge)

Owner: "yeah let's change tribe surge to that tribe's cards plus neutral cards, and all spells associated, but make
it multi select. so i can choose demons + dragons and have demons/dragons/neutrals in the game. reword 'none' to
'Normal'". Rule: R-PRACTICE-SURGE-01 (rewritten).

- `PracticeConfig.tribeSurge` became `tribes: PracticeTribe[]` (empty = Normal). `packages/sim/src/practiceTribes.ts`
  holds the options (active set's tribes), the Normal-exclusive toggle, and `practiceRunTribes`.
- `createLobbyRun` passes the picks to `createRun`'s new `tribesOverride`, so `RunState.tribes` IS the picks. The
  tribe roll has its own RNG stream; skipping it moves no other seed.
- `poolOf(state)` narrows the set pool to the picked tribes + neutral (tokens kept) for a practice run with picks.
  That covers the ungated "random minion" grants and combat-generated cards (combat `poolIds` come from `poolOf`,
  for BOTH sides of the player's fight). Every other run gets the untouched set pool.
- New core `inRunTribes(card, tribes)`: neutral, tribe or `tribe2` in the run. Replaced the inline
  `tribe === 'neutral' || tribes.includes(tribe)` gates (dual types now count by either tribe; a no-op while every
  set rolls all five of its tribes). Tribe ratchet pins lowered accordingly.
- The 2x surge weight left `drawOfferId` (its signature lost the `surge` arg). Old drafts with `tribeSurge` open on
  Normal (deliberately not mapped to a single-tribe game).
- Announcer `tribeSurge` event now reads `practiceConfig.tribes` (first picked tribe with a take).
