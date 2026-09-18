# 2026-09-18 — Bicycle Ben (a new set-3 Undead) + the per-tribe "played this turn" channel; Robinson / Adeptus edits

**Owner handoff 2026-09-18, three items.** Branch `feat/bicycle-ben-robinson-adeptus`.

## What shipped

- **Bicycle Ben** (`u3_bicycleben`) — Tier 4 Undead 3/9: *"When a summoned minion does not fit, give a random
  Undead +1/+1. Improves for every Undead played this turn."* Owner clarification: the grant is
  `(1 + undeadPlayedThisTurn)/(1 + undeadPlayedThisTurn)`, gilded ×2. One arena body,
  `overflowBuffRandomTribePerPlayed` (`packages/core/src/effects/arena.ts`), on the existing `summonOverflow`
  trigger in BOTH phases (Flowing Monk / Squatimus's twins in `recruit.ts` + `factories.ts`). The grant is
  `arena.buffPermanent` — a shop buff already is, combat carries it back like the Monk's. Target pool is
  `others(arena, isTribe)` — never Ben (R-TARGET-03). The factory takes a `tribe` param, so it is reusable.
  Appended last in `SET3_UNDEAD` (after the Skeleton token); roster pins bumped. No art yet — tribe sprite,
  excused in `allTypesPill.test.ts`'s `ART_PENDING`.
- **Robinson** → Tier 4, 5/7 (text unchanged). **Adeptus** → Tier 4; its Echo now gives Shop spells **+1/+1**
  (`deathrattleBuffSpellPower` `{attack: 1, health: 1}`; was `{1, 0}`), gilded +2/+2. Stats stay 5/1.

## The plumbing: `spiritsPlayed` generalised to a per-tribe map

Kindled Sprite's channel (`playedThisTurn` → `CombatSideState.spiritsPlayed` → `ctx.spiritsPlayedFor`) is now
one instance of a general one:

- `recruit.ts`: **`playedThisTurnFor(state, tribe)`** is THE counting function (the shared `defIsTribe`
  predicate — an all-types card counts for every tribe). `tribesPlayedThisTurn(state)` builds the
  `Partial<Record<Tribe, number>>` map over `TRIBES` (new in `core/types.ts`, complete by construction via a
  `Record<Tribe, true>`), and `spiritsPlayedThisTurn` is `playedThisTurnFor(state, 'spirit')`.
- `CombatSideState.tribesPlayed` (required; `EMPTY_SIDE` has `{}`). The reducer's `faceOmen` build and
  `snapshotBoard` both call `tribesPlayedThisTurn` ONCE and read `beastsPlayed` / `spiritsPlayed` off the map —
  no second filter anywhere. `BoardSnapshot.tribesPlayed` is written next to the two legacy scalars so an older
  build reads a new capture unchanged; `sideFromSnapshot` threads it.
- **`combatSide()` reconciles the two forms**: a side built from `{ spiritsPlayed: 2 }` (a legacy capture, a
  test) gets `tribesPlayed.spirit = 2`; a side built from `{ tribesPlayed: { spirit: 2 } }` gets
  `spiritsPlayed = 2`. So every reader sees one answer whichever form the caller used.
- `CombatContext.playedThisTurnFor(side, tribe)` reads the map; `EffectArena.playedThisTurn(tribe)` is the
  arena verb (combat → `ctx.playedThisTurnFor(self.side, tribe)`; shop → `playedThisTurnFor(state, tribe)`).
  `spiritsPlayedFor` / `beastsPlayedFor` keep working (the scalars are derived from the same map).
- `EnemyScalers.tribesPlayed` carries it to the UI for a served Ben's combat text.

## Live text (the hard rule)

`overflowPerPlayedText` in `cardText.ts` prints the current grant green in place of the printed `+A/+H` once any
Undead has been played this turn (null before — the base is exact). Wired in `instView`'s chain: the player's
count is derived from the `playedThisTurn` ids (`playedThisTurnFor`), a foe passes `tribesPlayed` from its
snapshot. `Unit.tsx` passes `foe ? enemyScalers.tribesPlayed : tribesPlayedThisTurn(run)`. Pinned by
`packages/ui/src/bicycleBenText.test.ts` plus the `renderedText` cross-chain exemplar (shop = combat = foe).

## Judgement calls

- **Ben counts himself when played this turn** — `playedThisTurn` is the reducer's play stamp and a played Ben
  is an Undead played. Documented on the arena body and pinned by a test; trivial to change if the owner
  disagrees.
- The map includes `neutral` (Paragon prints `tribe: 'neutral'` and `defIsTribe(def, 'neutral')` is true for
  it). Harmless — nothing reads it — and it keeps the map a pure image of the shared predicate.
- Ben is appended AFTER the Skeleton token in `SET3_UNDEAD` (the file's "append, never insert" rule); in the
  set-3 pool order he lands after Wick Mortis and before the carried set-1 Undead. Set 3 is disabled, so no
  live shop reseeds.
- `packages/tools/src/balance/aggregate.test.ts`'s inline snapshot was regenerated (`-u`): it synthesises set-3
  lobbies, and a new set-3 card shifts every placement — the same regeneration the last two content PRs did.

## Docbot / registries

`contracts:extract` regenerated (the Adeptus "mismatch" in `textParse` was just the stale registry);
`thisTurnRegistry` classifies `u3_bicycleben` as `conforms`; `noSelfTarget`'s `ARENA_PICKERS` drives the new
body; `presentation/policies.ts` classifies `factory:overflowBuffRandomTribePerPlayed:summonOverflow` as a
`foldedCue` react; `final-report.md` headline numbers bumped (1043 contracts).
