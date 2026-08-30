# Practice bots start at full health — and the length brake moves to its own dial

**Owner report (2026-08-30):** *"practice bots still start at half hp or less. can you fix this so they start
at normal hp?"* — with a screenshot of the round-1 standings reading **18 / 17 / 16 / 15 / 14 / 13 / 12**
against the player's **30**.

## What was happening

`createPracticeBotLobby` built each bot seat with:

```ts
resolve: Math.max(10, Math.round(r.startingResolve * BOT_HEALTH_MULT) - i),   // 0.6x, staggered by seat
armor: 0,
```

`round(30 * 0.6) = 18`, minus the seat index, and no Armor — which is exactly the ladder in the screenshot.

It was deliberate, added 2026-08-25 against *"practice bot games ran far too long"*. Seven seats each soaking
full health meant the table had to absorb a lot of damage before a winner existed, and cutting the pool was
the bluntest way to shorten it. It worked. It also made the practice table visibly **not a lobby** — and since
the standings panel prints the numbers, the sandbox was lying about the one thing it exists to rehearse.

## Why it could not simply be reverted

Restoring full Resolve + Armor pushed a dominant run from **≤15 rounds back to 21** — most of the way back to
the ~25 that prompted the original complaint.

The obvious lever, `BOT_DAMAGE_MULT`, was the wrong one, and this is the useful finding: that constant is read
in **two** places — `practiceBotDamageMult` (what the PLAYER takes, reducer) and `settleRunLobbyRound` (what
bots deal EACH OTHER). Raising it to thin the table faster would also have made *easy* bots hit the player
harder, which is not what "easy" is for.

## The fix

Split the two, because they were never the same concern:

- **`BOT_DAMAGE_MULT`** stays the **difficulty** dial — unchanged at 1.5 / 2 / 2.5, player-facing only.
- **`BOT_SEAT_DAMAGE_MULT` (new, 5)** is the **pacing** dial — difficulty-independent, seat-vs-seat only.

Seats carry it as `botSeatDamageMult`, and `settleRunLobbyRound` prefers it, falling back to `botDamageMult`
so a practice run **saved before the split** keeps resolving exactly as it did.

## Measured

Rounds for a dominant run, sweeping the new dial (all three difficulties move together, which is the point —
table pacing is not a difficulty concern):

| seat mult | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|
| rounds | 19 | 16 | 16 | **15** | 15 |

It **saturates at 5**: `lossDamageCap` bounds a round's damage, so beyond roughly there a losing bot already
takes the cap and more multiplier buys nothing. 5 is chosen as the smallest value that reaches the floor.

A do-nothing run is untouched by this dial (easy 8 / medium 7 / hard 6 rounds) — those end by the player
dying, which is governed by the difficulty dial, so **hard still kills faster than easy**.

## Guarded by

`practice bots sit at a real lobby seat` asserts every bot's Resolve and Armor equal **the player's seat**
(compared against `s0` rather than a literal, so it survives a retune of starting Resolve) and that no
per-seat stagger remains. The pre-existing `resolve on a sane clock` bar (≤15 rounds) was **left where it
was** — the fix had to meet it, not move it.

## If bot games drag again

Reach for `BOT_SEAT_DAMAGE_MULT` or `TIER_RAMP`. **Do not** reach back for starting health.
