# The perf HUD speaks the game's language

**Owner ask (2026-08-30):** *"id love the performance hud to use in-game names and call outs for effects and
jank frames etc if possible so it's easy for us to diagnose issues."*

## The problem

The monitor's labels are **addresses, not names**: `reduce:play:b2_packstrider`, `fx:weldBatch`,
`layout:handglide`, `render:recruit`. They are exactly the right thing to *record* — stable, greppable, cheap
to build in a hot path — and exactly the wrong thing to *read*.

"Playing **b2_packstrider** took 41 ms" makes you stop and go look the id up. "Playing **Packstrider** took
41 ms" tells you which card to suspect while you still remember the turn it happened on. The HUD is read
mid-play, where that lookup is the difference between noticing a problem and not.

## The shape

A translation layer, `perfNames.ts`, deliberately **outside** `perfDiagnose`.

The diagnosis engine stays a pure function of buckets with no content dependency — that is what makes its 28
tests hermetic — so `diagnose()` takes an optional `SubjectNamer` that defaults to the raw label. The naming
is applied at the edge, where `CARD_INDEX` is already loaded. Both behaviours are pinned by test: the engine
prints the raw id with no namer, and the in-game name with one.

Two registers, because the two surfaces are read differently:

- **`displaySubject`** — the report, read afterwards as prose. It can afford
  `**Packstrider** (b2_packstrider, on playing a card)`: the name you recognise *and* the id you grep for,
  because dropping either one costs the reader a step.
- **`shortName`** — the HUD's rows, read at a glance in a narrow panel with about twenty characters before it
  wraps. It gets `Packstrider · buy` and nothing else, with the raw label kept one hover away in `title`.

Card names come from `CARD_INDEX`. Reducer actions get the game's words (`roll` → "rolling the Shop",
`buyRune` → "taking a Rune"). The engine's own blocks are named in plain English — `view:board` → "building
the board view" — and that is the most useful class of all, because it tells the reader immediately that **no
card is to blame**. Phases become the words players use: `recruit` → **Shop**.

FX ids have no display name to look up anywhere — they are authored strings — so `effectName` only re-spaces
and capitalises what is already in the id. It never invents words.

**Anything unrecognised falls through to the raw label** rather than being hidden or guessed at. An unnamed
hotspot you can still grep for beats a prettified one that points nowhere.

## Before and after, from the live HUD

| before | after |
|---|---|
| `render:recruit ×3` | the recruit-screen render ×3 |
| `layout:flip` | the board re-layout (FLIP) |
| `reduce:roll` | rolling the Shop |
| `layout:handglide ×3` | the hand glide ×3 |
| `view:board ×2` | building the board view ×2 |
| `reduce:buy:d2_embermouth` | **Embermouth Whelp · buy** |
| context: `recruit · wave 1` | context: **Shop · wave 1** |

Every row above was read out of the running HUD after driving real rolls and a real buy, not composed by hand.
