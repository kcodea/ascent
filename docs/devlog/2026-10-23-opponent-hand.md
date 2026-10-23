# The opponent's hand, face down (2026-10-23)

Owner ask: "i think it's important to add an opponent's hand area to the left of their runes. it should show their
card plate they have equipped, but without the minions text or art, so it is 'hidden.' ... this will also bridge the
opponent summon from hand animation so they can have the card drop in from their hand etc", and "for the opponent hand
info - i'd like it to show when opponents get cards added to hand in real time as well". Rule: R-OPP-HAND-01.

## What it shows

- One face-down card per card the foe holds, in a compact fan to the left of its rune slots. Ten fit without touching
  the runes or the portrait. The cards are smaller than the player's hand.
- Each card is ONE picture: the foe's equipped card plate WHOLE (`CardPlateLook.thumb`, the Collection composite),
  else `frames/cardplate-standard.webp` (no plate, a bot, an older recording, or "Show opponent cosmetics" off).
- Hover: the in-game bubble (`.gtip`) "Opponent's hand: N cards". No native tooltip, no card info. The DOM carries
  no card id, name, art, text, stats or even the hand uid (the summon source resolves keys through a module map).
- Starting hand: the served board's `handMinions` then `handSpellIds` (the snapshot records them apart, so the order
  is minions first). A Scene Builder rig's authored board wins over the paired seat's, as it does for the fight.
- Mid-fight: every enemy `toHand` through the replay cursor (`processedEnd`) appends a card, which materialises with
  the player's own grant coalesce (`playPlateCoalesce`; at most 2 per commit, the rest pop in). Capped at the hand
  cap (the snapshot's `handRoom` when it records one).
- A copy summoned from a card greys it for the fight (`enemyHandSummonedShown`, which waits for a summon hold to
  release the body, like the player's). A consuming summon would remove it: no event marks one today (Rope
  Wrangler's primitive is unused and stamps nothing), so `summonConsumesHandCard` reads a `fromHandConsumed` flag that
  nothing sets yet.

## The enemy hand-summon (R-HANDSUMMON-FX-01)

- `OpponentHand` registers `setHandSummonSource('enemy', …)` while it is mounted.
- `useCombatReplay` now launches flights for enemy bodies too (`combatHandSummonOrigins(events, foeHand, 'enemy')`,
  Spirit `fromHandUid` and the Waking Reserve match). The drawn-set is keyed per side, because the two boards come
  from different runs and their uids can coincide.
- The lift goes TOWARD the board: `liftSign('enemy') = -1`, so the copy dips down out of the foe's hand instead of
  rising away from its row. Everything else is the shipped Lift and land.

## Placement

`.opphand` is in the stage host and pinned off the same anchor as `.combatopp` (the foe hero power's top-right
corner, `top` from `var(--bar-y)`, R-STAGE-OPP-HUD-01), nudged by `--oh-x` / `--oh-y` / `--oh-s`. Cards are placed
with the independent `translate` / `rotate` properties, so a re-fan eases on the compositor. Phones (the phone GPU
flag) drop the per-card drop shadow.

## Perf

See the PR for the before/after table (prod bench builds, headless Chrome, uncapped frames).
