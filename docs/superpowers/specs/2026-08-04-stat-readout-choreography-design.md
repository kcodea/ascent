# Stat readout choreography — design

**Date:** 2026-08-04
**Status:** approved, not yet implemented
**Branch it builds on:** `feat/fx-number-spin` (PR #858)

---

## The problem

A stat change and the effect that causes it are currently unrelated events that happen to coincide. The
reducer commits, React re-renders, and the badge snaps to its new value on its own schedule; an effect then
plays over the top. In the owner's words from the original statHold work: *"the plate can pop, but by then
the number has already changed, so the pop decorates a number rather than delivering it."*

`feat/fx-number-spin` has been closing that gap one case at a time — withholding the number, rolling it on
the effect's clock, cutting the `+N/+N` floats that competed with the badge, popping the badge so a `+1` has
motion. This design finishes the job by making **when a number lands** a first-class property of a stat
change rather than an assumption.

### Why this matters at the scale of the game

Strip ASCENT down and nearly every mechanic terminates in the same place: two numbers on a card moved. 130
minions and 72 spells' worth of distinct causes — buffs, gems, auras, Shouts, Echoes, Avenge, Rally, quests,
runes, hero powers, tripling — collapse into one readout. For most of the game's surface area, the badge is
not a UI detail that displays the game; it *is* the game's output.

That makes this a legibility problem, not a polish problem:

- **Attribution is the skill expression.** A wave-15 End Turn can fire a Shout hitting three bodies, a Ruby
  cascade with a Deepdelve multiplier, an aura re-applying, an Avenge, and a triple collapsing two cards —
  all committing on one tick. Landed simultaneously, the player sees the board got bigger and cannot tell
  *what made it bigger*. Choreography **serialises** a parallel state change into a sequence a human can
  parse and attribute. The stagger is not juice; it is how the game explains itself.
- **The pressure runs the wrong way.** Every card added raises the odds of many sources firing on one tick —
  precisely when simultaneity becomes unreadable. The system must get better at explaining itself exactly as
  boards get harder to read.
- **The board is where players look.** The combat log narrates every buff in full, but nobody reads a log
  mid-fight. If the board can't narrate itself, the information lives somewhere players don't go.
- **Per-effect authoring cannot carry a primary interface.** Hundreds of stat-touching sources, each needing
  a def bound to the right moment with `carries` ticked, each able to fail in six ways that look identical
  and fail *silently*. At that count "someone forgot" is a statistical certainty, and it ships because
  nothing complains. The systemic floor is the only way the guarantee survives the content pipeline.
- **The badge is the only verification surface.** The genre runs on hidden multipliers (`rubyBonus`, the
  Deepdelve multiplier, golden doubling, imp auras). Players constantly ask "did that apply, and by how
  much?" and the badge is the only place the true post-multiplier number appears. Hence the standing rule:
  **motion may live in the glyph, never in the value** — which is why the reel was cut on 2026-08-04.

### Two systems, one guarantee with a hole

Combat and the shop have independent implementations of this feature:

| | Shop | Combat |
|---|---|---|
| Store | `fx/statHold.ts` module, **delta** | `useCombatReplay` Maps, **absolute** |
| Delivery | `useSyncExternalStore` per uid | props threaded `Recruit → Unit → Card` |
| Withholding | cue / authored / intrinsic holds | `statHoldFor(uid)`, buff-tendril only |
| Badge pop | `useBadgePop`, off the printed value | `statFlashFor(uid)` → `.statflash` CSS |

Two consequences, both live defects:

- `Unit` renders `<Card>` **without a `uid`**, so `statHoldKey(uid)` never runs and `held` is always null in
  combat. `choreo/score.ts:364`'s `holdStat` writes into a store no combat badge reads — it has never done
  anything.
- The shop had no badge pop at all until 2026-08-04, because `flashAtk`/`flashHp` are only ever set by
  `Unit`.

A guarantee with a hole is not a guarantee; it is a thing you have to remember the exceptions to.

---

## Decisions taken

| # | Question | Decision |
|---|---|---|
| 1 | Should syncing require authoring? | **Automatic floor with authored override.** Cues that already compute a stagger publish it; a `react` layer overrides. |
| 2 | Which surfaces? | **Shop and combat**, having first confirmed the combat hold is dead. |
| 3 | How far does unification go? | **Wholly.** One store, one clock, one pop, one vocabulary; combat's bespoke props are deleted. |
| 4 | Does damage roll? | **No.** Damage delivers instantly. The badge still pops to acknowledge it. |

---

## The model

Three facts are currently bundled that don't belong together:

| Fact | Who knows it |
|---|---|
| **The delta** — how much changed | whoever caused it: a value moving, or a cue reading an event |
| **When it lands** — the schedule | whoever choreographs: a cue holding `Land[]`, or a `react` layer |
| **How it lands** — roll duration, then the pop | the system, unless an effect overrides |

"When" is currently hardcoded to *now* unless an authored layer claims it. Making it an optional property of
a hold costs almost nothing, because every cue that staggers anything is already holding a
`Land { uid, at }` at the moment it decides when each effect fires.

**The rule:** whoever knows the choreography owns the schedule; the system owns everything else.

```
Card       sees an unauthored change   → places a hold, no schedule
Cue        knows its cascade           → places a hold with startAt: land.at
react      knows its own beat          → places and drives its own
statHold   owns the clock for anything no effect claimed
```

The pop is unchanged and needs no special case. It fires on the printed value moving, so it inherits
whatever schedule delivered that value — cascade, ripple, authored beat, or instant. Damage works because
no hold is placed: the number snaps and the badge still pops.

---

## Store design (`fx/statHold.ts`)

### The hold

```ts
interface Hold {
  attack: number; health: number;   // the delta — unchanged
  revealed: number;                 // 0..1 — unchanged
  reel: number;                     // unchanged; 0 from every non-authored path
  origin: 'intrinsic' | 'cue' | 'effect';
  startAt: number;                  // when delivery BEGINS (performance.now basis)
  rollMs: number;                   // how long the reveal takes once started
  until: number;                    // TTL — see below
}
```

`startAt` is the feature. Before it, `revealed` stays 0, so `heldFor` withholds the full delta and the badge
sits on the old number — which is what "the seventh minion in the cascade hasn't been reached yet" should
look like.

### Precedence is a rank

The existing `authored`-beats-`intrinsic` rule generalises into a three-way ordering by **how much the placer
knows about when the number should land**:

| Origin | Knows | Rank |
|---|---|---|
| `intrinsic` | only that the value moved | 1 |
| `cue` | a schedule (`land.at`) | 2 |
| `effect` | a schedule *and* owns a clock | 3 |

Higher rank replaces lower outright. Equal rank accumulates (two genuinely separate changes — existing
behaviour). Lower never overwrites higher, so `Card`'s intrinsic hold landing first (React flushes layout
effects child-first) still cannot stomp the cue's. This turns the special case patched on 2026-08-04 into a
general rule.

Replacement covers a better-informed placer that computes the delta itself. It does **not** cover the `react`
layer, which never computes a delta — it only *drives* one the cue already withheld, and placing a second
hold there would restart `revealed` and tick the badge backwards on the handover. So the layer **claims** the
live hold instead: `claimStat(uid)` promotes it in place to `effect`, leaving delta, schedule and expiry
alone. That promotion is the entire mechanism by which the ticker stands down and authored timing wins.
Without it both clocks drive one counter, the faster one wins every frame, and whichever reaches the end
first deletes the hold out from under the other.

### One ticker, not one per card

```js
let raf = 0;
function tick() {
  const t = now();
  for (const [uid, h] of holds) {
    if (h.origin === 'effect') continue;   // its player owns the clock
    if (t < h.startAt) continue;           // scheduled for later in the cascade
    advance(uid, h, t);
  }
  emit();                                  // ONCE, after all of them
  raf = holds.size > 0 ? requestAnimationFrame(tick) : 0;
}
```

Today the loop lives in `Card`'s layout effect, so it belongs to one card instance and seven gemmed minions
means seven self-rescheduling rAF chains. Each tick calls `revealStat` → `emit` → **every** mounted card's
subscriber (board, hand and shop, ~20 in a normal turn) re-runs `statHoldKey`. Seven rolling badges therefore
cost ~140 snapshot reads per frame, most of them cards answering "no, nothing changed for me". One shared
loop advances all seven and emits once: ~20.

The performance is the smaller half. The reason that matters is `h.startAt` — a per-card loop has no way to
know it is the fourth minion in a cascade, and a loop sitting beside the holds can read it off each one.
Keeping the driver in the card would mean threading cascade timing through React into every card.

**This reverses a stated property of the module.** The header currently reads *"Sweeping on read rather than
on a timer keeps this module free of its own clock — nothing here ticks."* That was correct while the store
only remembered deltas and something else always delivered them. It stops being correct once the store owns
delivery, and it must own delivery for a cue to schedule one. The header gets rewritten to say what is true
and why it changed.

### The TTL must include the schedule

```
until = now() + startAt + rollMs + HOLD_GRACE_MS
```

Non-negotiable and easy to miss. A seven-gem cascade at `RUBY_GAP_MS` exceeds the flat 1200ms TTL, so the
tail would be force-delivered by the failsafe *before its own gem arrives* — the exact desync being fixed,
reintroduced by the safety net.

### `Card` shrinks

Loses the per-card rAF loop and the `STAT_ROLL_GRACE_MS` failsafe (the store's ticker plus the corrected TTL
cover both). Keeps: notice an unauthored change, place a rank-1 hold, pop the badge when the printed number
moves.

Gains one prop, `autoRoll`, default `true`, passed `false` by `Unit`. That is where decision 4 lives: in
combat the intrinsic path is off, so a number rolls only if something choreographed it, and everything else
— damage included — updates instantly and pops.

### Unchanged

`heldFor`, `statHoldKey`, `revealStat`'s monotonic guard, the wobble maths, `useBadgePop`. `holdStat` grows
optional fields; every existing call keeps working.

---

## Combat migration

> **SHIPPED 2026-08-06 — how the implementation diverged from this section.** Two things below turned out
> wrong once combat was read closely and are recorded here so the spec matches the code:
>
> 1. **Combat holds use `origin: 'effect'`, NOT `origin: 'cue'` with `startAt: <strike beat>`** (as the
>    snippet later in this section shows). The strike time is measured POST-paint (DOM geometry in
>    `fireBuffCasts`) while the hold is installed PRE-paint — they cannot be one value. An `effect` hold is
>    skipped by the store's ticker, and combat's own replay timers drive it, which is exactly the
>    "the replay owns the clock" contract. No `startAt` in combat.
> 2. **Making the roll ride combat's clock was not a field addition — it was a beat-pipeline fight.** The
>    roll had to survive the beat advance (a combat-lifetime registry, cancelled only on teardown/re-seek),
>    track live combat speed per frame, carry an explicit `ttlMs` (combat's wind-up chain outruns the store's
>    default TTL), and — because a surviving roll outlives the beat — have DAMAGE interrupt it, or a
>    buffed-then-damaged unit prints below its floor. See the combat plan and the 2026-08-06 devlog entry.
>
> The rest of this section (the deletion list, `.statflash` retiring into the pop, `autoRoll`, decision 4)
> shipped as written.

Combat's `statHold` prop **is** this feature, built separately and earlier: while a buff tendril flies, show
pre-buff stats; on the strike, release and flash. This deletes a second implementation rather than porting a
foreign concept.

### `Unit`

```jsx
<Card card={view} uid={u.uid} autoRoll={false} pulse={triggered} pulseRally={rallyPulse} />
```

`uid` connects combat badges to the module store for the first time. `statHold` and `statFlash` come off the
props, off `UnitProps`, and off the memo comparator (`Unit.tsx:140–141`).

### The tendril hold, converted

Combat stores **absolute pre-buff values**; the store wants a **delta**. At the site in `useCombatReplay`
that snapshots pre-buff stats the reducer has already applied the buff, so the delta is `current − snapshot`,
available in place:

```js
holdStat(uid, { attack: dA, health: dH }, { origin: 'cue', startAt: <strike beat>, rollMs: ROLL_MS })
```

`startAt` at the strike is exactly what hold-until-strike does today, now in the shared vocabulary — and it
inherits the cascade machinery the bespoke version never had.

### `.statflash` retires

| | scale | duration |
|---|---|---|
| `.statflash` (combat today) | 1.5 | 340ms |
| `useBadgePop` (approved 2026-08-04) | 1.35 | 180ms |

**Keep 1.35 / 180.** The pop is about to fire on every number change everywhere, damage included; 1.5 over
340ms per damage tick is too much badge movement. Combat's buff pop gets slightly lighter — the price of it
being the universal acknowledgement rather than a buff-specific cue. If combat buffs need to land harder
than a damage tick, the fix is making the pop authorable, not keeping two pops.

### Deleted

- `UnitProps.statHold`, `UnitProps.statFlash`
- `statHoldFor` / `statFlashFor` and both Maps in `useCombatReplay`
- the four prop threadings at `Recruit.tsx:4020/4021` and `4075/4076`
- `CardView.flashAtk` / `flashHp`, their entries in `cardViewEqual.ts:23`, Card's `.statflash` class logic
- the `.statflash` rule and `@keyframes statflash` in `styles.css`

### Prerequisite: wire up `releaseAllStats`

`releaseAllStats` is **never called in production** — only from tests — despite its doc comment describing
exactly the scenario it exists for. Harmless while the store serves only the shop; a hazard the moment combat
reads it, because a hold could survive into a fight or outlive a run and land on a recycled uid. It must be
called on the recruit ↔ combat transitions and on run reset **before** combat starts reading the store.
`clearAllSpellBuffs` is in the same state and should be wired at the same point.

---

## Cue sites

### What is tunable per effect

| Timing | Where it's set | Per-effect? |
|---|---|---|
| When the number lands *within* an effect | `react` layer `hold × peak` | **Yes** — workbench dial |
| How long the roll takes | `react` layer `roll` | **Yes** — workbench dial |
| Overshoot | `react` layer `reel` | **Yes** — workbench dial |
| Which bodies react, in what order | `reach` / `order` / `gap` | **Yes** — workbench dials |
| Cascade rhythm *between* minions | `RUBY_GAP_MS` / `RUBY_BEAT_MS` | **No** — code constants, per cue |
| Fallback delivery point with no `react` layer | one constant per cue | **No** — code constant |

Any effect wanting its own timing gets it by adding a `react` layer with `carries`; under decision 1 that
overrides the automatic floor entirely. The override is not implicit in the rank — the layer has to `claimStat`
the cue's live hold as it spawns, or the ticker keeps driving the same counter alongside it.

**Known limit:** the cascade *rhythm* belongs to the cue, not the def, because one `playDef` fire targets one
minion — the def cannot know it is the fourth gem in a sweep. Making that per-effect would mean moving
`RUBY_GAP_MS`/`RUBY_BEAT_MS` onto the def as a schedule block. Out of scope here; recorded as a follow-up.

### The three adopters

**Shop ruby cascade — `Recruit.tsx:890`.** The hold covers every land at once in a layout effect; the fires
are staggered later in a rAF. Those are separate effects and must not each compute their own schedule or they
will drift. Compute `scheduleLands(...)` **once** in the layout effect, stash the `Land[]` in a ref keyed by
`rubyLandedFxSeq`, and have the fire effect read that same array — one schedule, two consumers, enforced
structurally. The hold stays in the layout effect regardless, or the new number paints for a frame before
being withheld.

**Fodder tendrils — `Recruit.tsx:2758`.** Hold at commit with `startAt: land.at + CRUMBLE_MS + travelMs`, so
the eater's numbers land as the tendril arrives. The fodder `statFloats` block then goes — deliberately left
in place on 2026-08-04 because cutting it without fixing the timing would have removed the beat's payoff.
This is the last `+X/+X` float in the game.

**Combat ruby cascade — `score.ts:364`.** Add `startAt: land.at` to the `holdStat` already there, from the
`scheduleLands` call already above it. Dead code today that becomes correct once `Unit` passes a `uid`.

The buff tendril from the combat migration is a fourth adopter in the same shape.

---

## Testing

**Store units (`statHold.test.ts`)**
- a hold with `startAt` in the future withholds the full delta and reveals nothing
- the TTL covers `startAt + rollMs + grace` *(the regression that would silently undo the feature)*
- rank precedence: replace / accumulate / ignore across `intrinsic` < `cue` < `effect`
- the ticker starts on the first hold and stops when the map empties
- `effect`-origin holds are never advanced by the ticker
- a CLAIMED hold is skipped by the ticker, does not tick backwards on the handover, and still expires on its
  own — promotion must not defeat failing open

**Cue level**
- the hold's `startAt` and the fire's scheduled time derive from the *same* `Land` — the drift guard

**Browser (Puppeteer over CDP against the dev server)**
- *Cascade sync* — gem several minions; per-badge delivery times must be staggered and match the FX
  schedule, not land together. This is the feature; everything else is scaffolding.
- *Combat safety* — drive a real fight sampling every frame; every badge equals its unit's true value except
  while a hold is legitimately open. **Gate the merge on this**: a wrong number mid-fight is the worst
  outcome available, during the part of the game the player cannot pause.
- *Damage policy* — damage never opens a hold, the number changes instantly, the badge still pops.

**Negative controls** for the two that could pass for the wrong reason: reverting the `startAt` wiring must
fail the cascade test; reverting the TTL change must fail the long-cascade test. A sync test that passes
because everything happened to land at once is worse than no test.

---

## Risks

- **Combat is the most tuned surface in the game and starts reading a store it has never read.** The failure
  mode is a badge showing a wrong number mid-fight, not a crash. Mitigated by the per-frame combat assertion
  above, gated before merge.
- **One shared loop is one shared point of failure** — a bug there is every badge on screen rather than one
  card.
- **The store loses its "nothing ticks" property**, which is part of why it is easy to reason about today.
  Accepted deliberately; recorded in the module header.
- **Timing is wall-clock**, so a combat-speed change mid-roll is not picked up by a roll already running.
  Authored (player-driven) rolls do not have this problem. Accepted; speed is baked into `land.at` at
  schedule time, so only a mid-cascade speed change is affected.
- **Scheduling means badges intentionally show stale numbers for longer**, up to the length of a cascade.
  This is the trade being made on purpose, but it is a real cost on information the player buys and
  positions from.

## Out of scope

- Making the cascade rhythm (`RUBY_GAP_MS` / `RUBY_BEAT_MS`) per-effect.
- Making the badge pop authorable per effect.
- Rolling damage in combat (decision 4 — revisit as its own feel pass if wanted).
- The self-buff-on-placement report from 2026-08-04, still unreproduced across three probes.
