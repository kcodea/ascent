# Card sets

A **set** is the pool of cards a run draws from. Sets are built in parallel and flipped live, the same way
[`RIFTS`](../packages/sim/src/config.ts) are: add an entry, flip `enabled`, ship.

Registry: [`packages/content/src/sets.ts`](../packages/content/src/sets.ts).

## The two rules

1. **At most one set is active** — the first `enabled` entry in declaration order. Leaving two on isn't an
   error, it just silently ignores the later one, so `sets.test.ts` asserts against it.
2. **A run pins its set at creation** (`RunState.setId`) and reads it back through `poolOf(state)` forever
   after. Flipping the global switch never changes what an in-flight or replayed run rolls. This is the same
   "pin what actually happened" rule as rifts and pinned opponents — and here it's load-bearing, because shop
   draws are `rng.int(pool.length)`: a run that changed pools mid-flight would diverge on its very next roll.

**Never call `activeSet()` outside `createRun`.** It answers "what's switched on right now", which is only
the right question when starting a new run. Everything else wants `poolOf(state)`.

## Adding a set

1. Put its cards in `packages/content/src/cards/set3/*.ts`. **Its own directory** — that's what keeps two
   people authoring different sets out of the same file. (Before sets, everyone appended to the tail of the
   same tribe array, which is the worst possible shape for git.)
2. Add a registry entry:

```ts
set3: {
  id: 'set3', name: 'Set 3', blurb: '…',
  enabled: false,
  inherits: 'set2',                 // the overlap — start from another set's pool
  excludes: ['oldcard', 'retired'], // …minus what you don't want
  own: [...SET3_BEASTS, ...SET3_MECHS],
},
```

3. Flip `enabled: true` (and `false` on the outgoing set) when it goes live.

Resolution is `inherits − excludes + own`, **in that order**. `own` appends at the end, so adding cards to a
set never disturbs the prefix it inherited.

## Determinism — the part to internalise

A set's pool **order and size are load-bearing**. Editing a set's own cards changes that set's seeds. That
was already true of the flat pool before sets existed and is unavoidable while content is in flux.

What sets buy you is **isolation**: building set 2 cannot perturb set 1's seeds, because set 2's cards are
appended after set 1's rather than interleaved into the same tribe files. That is the whole reason for the
directory split.

## Flipping a set live — the operational checklist

Flipping `enabled` is one line, but two things follow from it:

- **Bake the opponent pool for the new set:** `SET=set2 npm run pool`. Boards are stamped with the set they
  were built under, and a run is only served boards from its own set — a set-2 board is made of set-2 cards.
  **Until you bake, a set-2 run has no captured opponents** and falls back to procedural threat boards. It
  degrades, it doesn't crash, but the matchmaking is gone until the bake exists.
- **In-progress runs keep playing set 1.** They pinned it. Saves written before sets existed heal to `set1`
  explicitly (*not* to whatever is live), so the flip can't re-home someone mid-run.

Supabase boards, runs and leaderboard rows are already partitioned by `patch`; the set rides alongside as
`BoardSnapshot.setId`.

## What is NOT set-scoped yet

Quests, runes and heroes. They have their own on/off switches (`CONFIG.questsEnabled`,
`CONFIG.runeforgeEnabled`, the Runeforge registries) and are shared across sets. `SetDef` has room to grow
those fields when a set wants its own — the seam is there, the wiring isn't.

## Where the seams are

| Concern | Seam |
|---|---|
| Which set is live | `activeSet()` — `createRun` only |
| Which set a run plays | `RunState.setId` → `poolOf(state)` / `setIdOf(state)` |
| Drawing cards | `poolOf(state).buyable` / `.spells` — ~20 sites in `shop.ts`, `recruit.ts`, `reducer.ts` |
| Resolving an id → def | `CARD_INDEX` — **global on purpose**, no set awareness needed (~500 sites) |
| Opponent boards | `BoardSnapshot.setId`, filtered in `pickOpponent` |
| Synthetic boards | `CurveSynthOptions.setId`, via `SET=… npm run pool` |
| Broken save | `missingCardIds(state)` — refuse Continue instead of crashing on a dangling id |
