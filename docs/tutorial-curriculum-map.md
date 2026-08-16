# ASCENT Teaching Curriculum — the complete map

**What this is.** Every concept the two onboarding systems teach, where it is taught, and what the player is
expected to be able to do afterwards. Scoped from:

- `ascent-ftue-playable-scenario-spec.md` — the 10-round core tutorial (FTUE).
- `ascent-tactical-trials-handoff.md` — the reusable puzzle system (supersedes the old Advanced Tutorial spec).

The two systems teach **different classes of knowledge** and must not be collapsed:

| | Core FTUE | Tactical Trials |
|---|---|---|
| Teaches | The **verbs** of the game | How verbs **combine** |
| Shape | One authored 10-round run you win | Short fixed positions with objectives |
| Failure | Authored, never punishing | The point — traps teach |
| Guidance | Explicit, step-by-step | Withdrawn progressively |
| Duration | 15–20 min, once | 2–9 min, replayable forever |

---

# PART 1 — Core FTUE

## The 14 canonical outcomes

The spec commits to these. Everything below exists to deliver one of them.

1. The Shop phase is where you spend Gold to improve a **persistent** warband.
2. Minions are bought into **hand**, then played onto the **board**.
3. Position and attack order affect combat.
4. Combat is automatic; **preparation is not**.
5. Losing costs Resolve; zero Resolve eliminates a player.
6. Refreshing trades Gold for new options.
7. Freezing preserves an option for next turn.
8. Selling creates space and recovers Gold.
9. Upgrading sacrifices current tempo for stronger future options.
10. Three copies Gild into one stronger card.
11. **Shouts** on play, **Rallies** on attack, **Echoes** on death.
12. Runes are paid, run-long rules that should support the build you are assembling.
13. The lobby rail identifies your next opponent and preserves the lobby's history.
14. Card inspection and the Glossary resolve unfamiliar text.

**Deliberately NOT taught:** Quests, Rifts, scouting, full keyword coverage, damage math, high-level
counterplay, Tier 7.

## The vehicle: one Beast Echo build

Final engine (Turn 7): `Gilded Void Panther → T-Rex → T-Rex → Wolvie → Echohorn`, extended by Turn 9 to a full
seven with Sea Urchin + Dawnclaw, and by Turn 10 with Beardsley replacing a T-Rex.

The build is chosen so the player learns **one coherent idea** rather than five unrelated demo cards:
Panther/T-Rex leave bodies behind, Wolvie improves the next summon, Echohorn triggers the left-most Echo
*without a death*, and **board order decides what Echohorn finds**.

## Turn-by-turn teaching inventory

### Pre-game — first launch
- The game has a lobby you can be eliminated from. **Learn to Play** / **Skip for Now** (skip is always
  recoverable from the title).

### Lobby lesson (before Turn 1)
| Step | Teaches |
|---|---|
| L1 | You are one seat. Warband **and** Resolve persist between fights. 0 Resolve ends the run. |
| L2 | The highlighted row is your **next opponent**. Hovering shows only *public* info: Shop tier, most common tribe, Gild count, recent results. |
| L3 | The loop: build in the Shop → combat is automatic → wins damage opponents, losses cost Resolve. |

### Turn 1 — the six basic verbs (vs Rook)
| Step | Teaches |
|---|---|
| T1.1 | Read the Gold counter against a card's cost. Minions cost 3. |
| T1.2 | **Buy** → the card enters your **hand**, not the board. |
| T1.3 | **Play** → onto the warband, which *persists between combats*. |
| T1.4 | **Inspect**: Rally triggers when this minion attacks. Hover/inspector/Glossary. |
| T1.5 | **Hero power is an active, targeted tool** — press it, observe the armed state, choose a target. Explicitly framed: powers differ per hero in cost, recharge and targeting. |
| T1.6 | **End Turn** ends the Shop phase. |
| Combat | Rally fired *before* the attack landed. Combat effects and position make a small minion beat its printed stats. |

### Turn 2 — investment, and the authored loss (vs Vale)
| Step | Teaches |
|---|---|
| T2.1 | The **Tavern tier gates the card pool**. T-Rex needs Tier 2 (shown as a non-interactive preview). |
| T2.2 | Upgrading spends the whole turn's Gold. Critically: *you do not receive T-Rex* — it can now **appear**. |
| T2.3 | Investment costs tempo. Vale is stronger this round *because* you invested. |
| T2.4 | A loss is not the end of a run. |
| Combat | **You lose on purpose.** Resolve drops, the run continues, and the investment is what unlocks the next Shop. Never rewound. |

### Turn 3 — selling, packages, position (vs Mira)
| Step | Teaches |
|---|---|
| T3.1 | Your tier change is *why* these cards appeared. |
| T3.2 | **Sell** (drag above the warband): returns 1 Gold. Strong runs replace yesterday's best card. |
| T3.3–4 | Buying a *package* rather than the biggest single card. |
| T3.5 | **Position**: minions attack left to right. Panther first so its Echo opens space before T-Rex dies. Wrong order is **not rejected** — it becomes a reposition lesson: you can reorder freely in the Shop. |
| T3.6 | The hero power **refreshed** — once per Shop phase. |
| T3.7 | **Taunt** forces your attacks toward it. |
| Combat | **Echo triggers on death.** The fragile Panther left two bodies and protected the warband. |

### Turn 4 — refresh, spells, freeze (vs Flint)
| Step | Teaches |
|---|---|
| T4.1 | Gold buys cards **or** buys another look. |
| T4.2 | **Refresh** costs 1 Gold. |
| T4.3 | A second copy moves you toward a Gild. |
| T4.4 | **Shop spells** create immediate effects instead of joining the warband. |
| T4.5 | **Cast**: Growth gives your current warband +1/+1. |
| T4.6 | Copies stay separate until the third. |
| T4.7 | **Freeze** preserves a card you cannot afford yet. |
| Combat | Refreshing *found* the package; Freezing *protected* it. |

### Turn 5 — Gilding (vs Ibis)
| Step | Teaches |
|---|---|
| T5.1 | Frozen cards remain exactly as left. |
| T5.2 | **Three copies → one Gilded card.** |
| T5.3 | Gilding is stronger *and* frees board space. Uses the real triple flow, including any reward/Discover. |
| T5.4 | Keep your strongest Echo left-most — a later card will care. (Plants Echohorn.) |
| Combat | Your printed board was smaller than Ibis's; Echoes created the difference. |
| Lobby | **First elimination** (off-screen). 0 Resolve leaves the lobby, but the row *remains* so the story stays readable. |

### Turn 6 — Basic Runes (vs Nox)
| Step | Teaches |
|---|---|
| T6.1 | Runes are **permanent run rules** that cost Gold — they compete with this turn's Shop. |
| T6.2 | Inspect all three. "Recommended for this build" is instructional UI, not card text. |
| T6.3 | Forge one. **All three are legal**, each with its own coaching line. |
| T6.4 | Wolvie: Taunt + improves the next Beast summoned after its Echo. Placement matters. |
| Combat | The Rune changed how your **existing** Echoes paid off. Choose the Rune that connects pieces you already have. |

### Turn 7 — the engine, and your first elimination (vs Rook @ 2 Resolve)
| Step | Teaches |
|---|---|
| T7.1 | The upgrade got **cheaper every round you waited** — Tier 3 for 2 Gold. |
| T7.2 | Refresh to look in the stronger pool. |
| T7.3 | **Echohorn's Rally triggers your left-most Echo** — the payoff for T5.4. |
| T7.4 | A second Growth. |
| T7.5 | **Formation as a rule**: the invariant is Gilded Panther left-most among Echoes. |
| T7.6 | The build named in four parts: **enabler → target → payoff → formation**. |
| T7.7 | **Counterplay via public info**: Rook is at 2 Resolve; a win eliminates them. No board reveal, no prediction. |
| Combat | Your first player-caused elimination. Eliminated rows stay visible with a placement badge. |

### Turn 8 — investing again, and the rematch (vs Vale @ 2)
| Step | Teaches |
|---|---|
| T8.1 | Read the rematch — this is the opponent you lost to on Turn 2. |
| T8.2 | Levelling is *required* to reach key pieces; waiting cut the cost 8 → 7. |
| T8.3 | Refresh into the tier you just unlocked. |
| T8.4 | **Forward-looking synergy**: Sea Urchin has a Shout; Dawnclaw triggers adjacent Shouts via its Echo. (The Rune is not yet mentioned.) |
| T8.5 | Freeze again — now a familiar tool, not a new lesson. |
| T8.6 | Hero power reused. |
| Combat | Win + eliminate Vale. **The turn that felt weak is the turn that won the rematch.** Plus one off-screen elimination. |

### Turn 9 — Epic Runes and adjacency (vs Crown)
| Step | Teaches |
|---|---|
| T9.1 | **Epic Runes** arrive later and can be build-defining — this one *grants a minion* and changes how it behaves. |
| T9.2 | Forge Rune of Dawnclaw (authored choice; alternatives inspectable but disabled with an honest reason). |
| T9.3 | Buy the card you froze last turn. |
| T9.4 | **Adjacency** as a formation rule, distinct from left-most ordering. |
| T9.5 | **Board capacity**: full at seven. From here, improving means **replacing**. |
| Combat | Epic Rune payoff; Crown eliminated; the lobby narrows to you and Nox. |

### Turn 10 — counterplay and the win (vs Nox)
| Step | Teaches |
|---|---|
| T10.1 | Read the final opponent's *pattern* ("their wins came from attacking first") — never the board, never a prediction. |
| T10.2 | Identify your **weakest** piece. |
| T10.3 | Sell to make room. Late-game improvement = replacing a good card with a stronger payoff. |
| T10.4 | Add Beardsley **without breaking either formation invariant**. |
| T10.5 | **Pre-emptive Assault** = counterplay chosen from public information. |
| T10.6 | Final hero power. |
| T10.7 | Read your own engine as a trace. |
| Combat | Win the lobby. Seven eliminations, then the winner treatment, *then* the completion screen. |

### Completion screen
Recaps five decisions the player actually made, then the loop: **Shop → Build → Fight → Learn → Rebuild.**
Explicitly generates no rating, history, board upload, achievements or rewards.

## What the coaching system itself teaches

The presentation is pedagogy, not decoration:

- **Focus mask on first use only** (18 tracked action keys). Later repeats get a small reminder — so the game
  stops holding your hand as soon as you have done a thing once.
- **Three gate strengths.** *Observe* (waits), *Soft* (nudges), *Hard* (rejects with a reason). Hard rejection
  must explain the plan — `Keep that card for now. Sell Packstrider so you can afford both Echo minions.`
  Never silently swallow input.
- **Copy limits** force clarity: 5-word titles, ≤18-word instructions, one new rule + one action per prompt,
  and **no internal jargon** ever shown to a player.
- **Input-adaptive**: steps declare intent (`buyCard`, `playCardAt`), and an adapter supplies mouse / touch /
  controller wording. "Click" and "drag" never enter the completion logic.

## Deferred to first-real-lobby hints (not the tutorial)
Hero selection guidance · public-info counterplay · Quests being hero-specific · Glossary on first unfamiliar
keyword · where Tier 7 access comes from.

---

# PART 2 — Tactical Trials

## The premise

A **chess-puzzle** framing: a fixed position, a concrete objective, one or more valid solution lines. Where the
FTUE teaches verbs, Trials teach **how engines combine** — sequencing, trigger multiplication, resource and
space management, and phase timing.

## The difficulty ladder (itself a teaching structure)

| Tier | Shape | What withdrawal of help teaches |
|---|---|---|
| **Introductory** | One engine, one ordering decision, full highlighting | The concept in isolation |
| **Intermediate** | Two engines (or engine + Rune), **one attractive wrong line**, 6–10 actions, checklist but no arrows | Recognising a trap |
| **Expert** | 3–5 engines, resource/space/timing pressure, 10–18 actions, alternate lines accepted, objective only | Planning a whole turn |

**Grades:** *Solved* → *Optimal* (par constraints) → *Mastered* (no hints, no undo, no solution playback).

**Failure must teach the concept, not say "wrong":**
`Living Grimoire was still charged when two Shouts triggered. Reset progress does not bank.`

## Advanced Tutorial — Spell Recursion Workshop (3 trials, 6–9 min)

| Trial | Difficulty | The lesson | The trap |
|---|---|---|---|
| **A1 First Things First** | Intro | Spell Warden remembers the **first** Shop spell and pays on the **second** | Casting the cheap spell first copies the cheap spell |
| **A2 Spend and Recharge** | Intermediate | Living Grimoire is a **charge**: spend it, then 3 Shout triggers reset it. Drakko doubles Shout triggers, so **two bodies** suffice | **Reset progress does not bank while charged** |
| **A3 Sevenfold Front** | Expert | Combine copy generation, repeated charge windows, hand management, selling for space, and Mirrorwing's target-specific recast → 7+ resolutions | Wasting a charge, or losing the Mirrorwing window |

## Intermediate tribe trials

| Trial | Teaches | Trap |
|---|---|---|
| **I1 First and Last** | *First*, *second* and *last* spell identities can all be manipulated in a single turn (Warden + Recaller + Spellvault Drake) | — |
| **I2 Brewer's Memory** | Choosing **economy over stats** under a constraint | Copying the stat Ale when the position needs Gold |
| **I3 Distilled Feast** | Rune of Distillation + Consume + Avarice; investing in a Shop offer before it is yours | Targeting Avarice itself fails its "**another** friendly Demon" clause |
| **I4 Echo Formation** | A three-link positional chain: Rune of Rallying → Echohorn → Dawnclaw → adjacent Shouts | Believing Rally can be fired manually in the Shop — **it cannot** |

## Expert trials

| Trial | Teaches |
|---|---|
| **E1 Resonant Heart** | Ruby routing: Prismcaster casts, Resonance Idol bounces, Ruby Transfer consolidates, then **position a body to die** and convert Rubies into a Golem |
| **E2 False Gem** | Rune of the Spellstone reclassifies a Ruby as a *Shop* spell. Trap: a Ruby is **already** a spell for Grimoire, so casting it first wastes the charge |
| **E3 War Chorus** | Simultaneous positional constraints — which Rally is left-most, which Shout is left-most, which tribes remain for Paragon, and survival order |
| **E4 Casket Full of Beasts** | Board **space** as the binding constraint: sell filler so Closed Casket's summons fit, then convert them via Rune of Reinvestment |
| **E5 Infernal Payroll** | Threshold sequencing (Baal's every-two-spells) + preserving the best offer for the final Consume |
| **E6 Contained Counterattack** | Pure **counterplay**: Containment Rune + Stolen Initiative to beat a board that wins under normal attack order |

## Concepts Trials teach that the FTUE never touches

1. **Order-of-action memory** — effects that remember *first*, *second* or *last*.
2. **Charge economies** and reset counters that do not bank.
3. **Trigger multiplication** — a doubler satisfies a counter with fewer cards.
4. **Selling as space management**, not just Gold recovery.
5. **Investing in a Shop offer** before buying it.
6. **Adjacency engines** distinct from left-most rules.
7. **Consume** and its "another friendly X" conditions.
8. **Reclassification** — a Rune changing what a card *counts as*.
9. **Attack-order counterplay** rather than stat scaling.
10. **Phase discipline** — what can only happen in combat (Rally) vs in the Shop.

---

# Cross-cutting rules both systems obey

1. **Real systems only.** Both drive the real reducer, simulator, content and presentation. The scenario
   controls *inputs*; it never imitates outcomes. No fake damage, no forced attacks, no victory overrides.
2. **Validate semantics, not stats.** Different bugs produce identical numbers, so validation reads a
   **semantic event trace** — never animation timing, DOM state, combat-log prose or FX callbacks.
3. **Accept equivalent solutions.** The canonical line exists for verification, hints and playback — not as
   the only pass condition. Exact order is enforced only when *order is the lesson*.
4. **Determinism and instant restart** — including the subtle state: spell escalation, charge progress,
   per-instance counters, RNG cursor.
5. **Content fingerprinting.** Reference IDs, never names; pin tier + effect signature. A balance patch can
   keep an ID and silently invalidate a lesson, so CI must fail or quarantine the puzzle.
6. **FX stays authoritative.** Coaching *waits* for the presentation queue; it never retimes authored FX.
7. **No live-data contamination.** No rating, history, board upload, achievements or balance telemetry.

---

# Open items before authoring

| # | Item |
|---|---|
| 1 | **Front to Back drift.** Trials §5 says "improves every other cast"; the shipped card says **each cast**. The flagship puzzle's arithmetic depends on this. |
| 2 | **FTUE §6 heading** says "Seven-Turn Economy" over a ten-row table. |
| 3 | **FTUE §3 "Final warband"** lists five — that is the *Turn 7* board; the real final board is seven. |
| 4 | **Pinned cards unverified** — Packstrider, Void Panther, T-Rex, Echohorn, Sea Urchin must exist at the stated tiers before content is authored. |
| 5 | **Spellstone umbrella** — a Ruby currently counts through *both* halves of the spell umbrella. E2 is built on this interaction and needs it pinned (and possibly resolved) first. |
| 6 | **E4 simplified** — Closed Casket now simply destroys the minion, so the "first death Echo is suppressed" caveat no longer exists. The trial's lesson becomes cleaner: destroy it early, while you still have summon space. |

# Build order

The two systems share ~70% of their foundation — scenario definition, checkpoint/restore, scripted Shop
provider, scripted opponents, predicates, anchors, gating, presentation-idle waiting.

**Build the FTUE spine first** (its Milestone 1). It is the higher-value artifact, and it hands Tactical
Trials most of its Phase 1 for free.

Then honour the Trials' own falsification test: implement **First Things First** end-to-end, then **Sevenfold
Front** immediately. If the hardest launch puzzle needs bespoke React, stop and strengthen the
scenario/validator layer before authoring any more content.
