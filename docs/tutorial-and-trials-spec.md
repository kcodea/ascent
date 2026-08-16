# ASCENT — Tutorial & Tactical Trials: authoring spec

**Status:** scope only. Nothing built. This is the document the implementation PRs get written against.

Derived from `ascent-ftue-playable-scenario-spec.md` and `ascent-tactical-trials-handoff.md`, then
**reconciled against shipped content** (owner ruling 2026-08-16: *current card values/effects override any
tutorial mention*). See [`docs/tutorial-curriculum-map.md`](tutorial-curriculum-map.md) for the pedagogy map —
this doc is the buildable version of it.

---

## 0. Ground rules

1. **Shipped content is the source of truth.** Where a handoff describes a card differently from the card,
   the card wins and the lesson is rewritten around it. No card is to be changed to serve the tutorial.
2. **Real systems only.** Both features drive the real reducer, simulator, content and presentation. The
   scenario controls *inputs* — never outcomes. No fake damage, no forced results, no victory override.
3. **Set 2 is the tutorial's pinned set** (`setId: 'set2'`, the live set). Every card below was verified
   present and drawable in Set 2.
4. **Shop actions stay immediate.** Coaching may *wait* on the presentation queue; it may never slow the shop.
5. **No live-data contamination.** No rating, no run history, no board upload, no achievements, no telemetry.

### Corrections applied to the source handoffs

| # | Handoff said | Truth | Consequence |
|---|---|---|---|
| 1 | Front to Back "improves every other cast" | `fronttoback` T4, 1g: *"Give a minion **+2/+2**. Improve this by **+2/+2** **each cast**."* | A3's arithmetic is rebuilt; the puzzle gets *easier per cast*, so its par count rises |
| 2 | "Seven-Turn Economy" heading | The FTUE is **ten** turns | Full 10-turn ledger below, built on real `CONFIG` values |
| 3 | "Final warband" listed five | Final board is **seven** (`boardMax: 7`) | The five-card list is the **Turn 7** board; Turns 9–10 fill to seven |
| 4 | Pinned cards unverified | **All exist.** See manifest | No substitutions needed |
| 5 | Spellstone/Ruby umbrella ambiguity | Current logic stands as-is | E2 is authored against current behaviour, not a hypothetical fix |
| 6 | Closed Casket suppressed the first Echo | Now `sp_closedcasket`: *"Choose a minion. **Start of Combat:** destroy it."* | E4 loses its caveat and gets a cleaner lesson |
| 7 | "Drakko" doubles Shout triggers | **No such card.** The real doublers are `d2_orivax` (Orivax, the Spellchoir, T7 — *Shouts trigger an additional time*) and `b2_elderhorn` (Elderhorn, T7 — *Beast Rallies or Echoes trigger an additional time*) | A2 is re-authored without a doubler; doubling becomes an **Expert** trick |

---

# PART 1 — The Core Tutorial (FTUE)

## 1.1 Verified content manifest

Every card the tutorial serves, by ID, with its **shipped** text. If any line here stops matching the card,
CI must fail (§1.7).

### Minions — the Beast Echo build

| ID | Name | Tier | Shipped text |
|---|---|---|---|
| `b2_packstrider` | Packstrider | 1 | **Rally:** gain **+1 Attack** for every Beast you control. |
| `manasaber` | Void Panther | 1 | **Echo:** summon two 0/2 Void Cubs with **Taunt**. |
| `b2_trex` | T-Rex | 2 | **Echo:** summon a **T-Rex Baby** with **Taunt**. |
| `b2_wolvie` | Wolvie | 2 | **Taunt. Echo:** give the next **Beast** you summon **+2/+4**. |
| `b2_echohorn` | Echohorn | 3 | **Rally:** trigger your left-most **Echo**. |
| `b2_dawnclaw` | Dawnclaw | 4 | **Taunt. Echo:** trigger an adjacent minion's **Shout**. |
| `b2_beardsley` | Beardsley | 4 | Whenever you summon a **Beast**, give it **+6/+6**. |
| `seaurchin` | Sea Urchin | 4 | **Shout:** Discover a Beast. |

> `manasaber` and `seaurchin` are Set-1 cards **opted into Set 2** via `SET1_BEASTS_IN_SET2`. Verified.

### Spells

| ID | Name | Tier | Cost | Shipped text |
|---|---|---|---|---|
| `growth` | Growth | 2 | 2 | Give your minions **+1/+1**. |
| `preemptive` | Pre-emptive Assault | 4 | 3 | You attack **first** next fight. |

### Runes

| ID | Name | Cost | Rarity | Shipped text |
|---|---|---|---|---|
| `rune_packcraft` | Rune of Packcraft | 2 | basic | Minions you summon in combat have **+6/+6**. |
| `rune_rebirth` | Rune of Rebirth | 3 | basic | **Start of Combat:** give a random friendly minion **Echo:** summon an exact copy of this without Echo. |
| `rune_aftershocks` | Rune of Aftershocks | 4 | basic | Triggering an **Echo** gives your minions **+4/+4** this combat. |
| `rune_dawnclaw` | Rune of Dawnclaw | 5 | **epic** | Get a **Dawnclaw**. Your **Dawnclaws** also trigger their Echo at **Start of Combat**. |

### Why this build teaches

It is **one idea with four roles**, and every role is a real card doing its printed job:

- **Bodies on death** — Void Panther, T-Rex (Echo → Taunt tokens)
- **Payoff per summon** — Wolvie, then Beardsley (+6/+6 on every summoned Beast)
- **Echo without dying** — Echohorn (Rally → triggers your **left-most** Echo)
- **Formation** — because Echohorn reads *left-most*, board order is a **rule**, not a preference

Runes then amplify the same axis: Packcraft buffs summons, Aftershocks pays per Echo trigger, Dawnclaw
converts an Echo into a Start-of-Combat Shout trigger.

## 1.2 The economy ledger (real `CONFIG` values)

`startEmbers: 3`, `embersPerWave: 1`, `embersCap: 10`, `minionCost: 3`, `refreshCost: 1`, `sellValue: 1`,
`boardMax: 7`. Tier costs `{2:5, 3:7, 4:8, 5:11, 6:10}`, **−1 per wave you don't upgrade**.

| Turn | Gold | Spend | Left | Board after |
|---|---|---|---|---|
| 1 | 3 | Packstrider 3 | 0 | Packstrider |
| 2 | 4 | **Tier 2** (5−1 waited = **4**) | 0 | Packstrider |
| 3 | 5 (+1 sell = 6) | Sell Packstrider, Void Panther 3, T-Rex 3 | 0 | Panther · T-Rex |
| 4 | 6 | Refresh 1, Panther#2 3, Growth 2 | 0 | Panther ×2 · T-Rex |
| 5 | 7 | Frozen Panther#3 3 → **Gild**, T-Rex#2 3 | 1 | ✦Panther · T-Rex ×2 |
| 6 | 8 | Rune (2–4), Wolvie 3 | 1–3 | ✦Panther · T-Rex ×2 · Wolvie |
| 7 | 9 | **Tier 3** (7−5 waited = **2**), refresh 1, Echohorn 3, Growth 2 | 1 | + Echohorn **(5)** |
| 8 | 10 | **Tier 4** (**8**), refresh 1 | 1 | *(freeze Sea Urchin)* |
| 9 | 10 | Rune of Dawnclaw 5 *(grants Dawnclaw)*, frozen Sea Urchin 3 | 2 | **7 — full** |
| 10 | 10 (+1 sell) | Sell a T-Rex, Beardsley 3, Pre-emptive Assault 3 | 5 | 7, final |

**The two authored teaching moments in the ledger are real, not staged:**
- Turn 2 costs *exactly* your whole turn (4 gold, 4 cost) → the loss on Turn 2 is earned.
- Turn 7's Tier 3 costs **2** because you waited five waves → "the upgrade got cheaper" is arithmetic, not copy.

> ⚠ Turn 8's Tier 4 is full price (8) since you upgraded the turn before. The handoff's "8 → 7" is wrong.
> With 10 gold this still works: upgrade + one refresh + a freeze. Verify against the tuned build before locking.

## 1.3 The lobby lesson (pre-Turn-1)

| Step | Gate | Teaches |
|---|---|---|
| L1 | observe | You are one seat in a lobby. Warband **and** Resolve persist. 0 Resolve ends the run. |
| L2 | soft | The highlighted row is your **next opponent**. Hover shows only public info: Shop tier, most common tribe, Gild count, recent results. |
| L3 | observe | The loop: build → combat resolves automatically → wins damage opponents, losses cost Resolve. |

## 1.4 The ten turns

Format: `intent` is the input-agnostic action the step waits on. `gate` is `observe` (waits) / `soft`
(nudges, allows) / `hard` (rejects with a reason).

### Turn 1 — the six basic verbs · vs Rook

| # | Intent | Gate | Teaches |
|---|---|---|---|
| 1.1 | — | observe | Read the Gold counter against a card's cost. Minions cost 3. |
| 1.2 | `buyCard(b2_packstrider)` | hard | **Buy** → the card goes to your **hand**, not the board. |
| 1.3 | `playCardAt(0)` | hard | **Play** → onto a warband that *persists between combats*. |
| 1.4 | `inspectCard` | observe | **Rally** triggers when this minion **attacks**. Inspector + Glossary exist. |
| 1.5 | `useHeroPower(target)` | hard | The hero power is an **active, targeted tool**: press → armed state → choose a target. Powers differ per hero in cost, recharge and targeting. |
| 1.6 | `endTurn` | hard | Ending the shop phase starts combat. |

**Combat 1 · win.** Callout: *Packstrider's Rally fired before its attack landed.* Combat effects and position
make a small minion beat its printed stats.

### Turn 2 — investment, and the authored loss · vs Vale

| # | Intent | Gate | Teaches |
|---|---|---|---|
| 2.1 | `inspectLockedPreview(b2_trex)` | observe | The **Tavern tier gates the pool**. T-Rex needs Tier 2 — shown as a non-interactive preview. |
| 2.2 | `upgradeTavern` | hard | Upgrading costs this whole turn's Gold, and **does not give you T-Rex** — it makes T-Rex *possible*. |
| 2.3 | — | observe | Investment costs tempo. Vale is stronger *because* you invested. |
| 2.4 | `endTurn` | hard | A loss is not the end of a run. |

**Combat 2 · LOSS (authored).** Resolve drops. **Never rewound, never apologised for.** Callout: *that
investment is what fills the next shop.*

### Turn 3 — selling, packages, position · vs Mira

| # | Intent | Gate | Teaches |
|---|---|---|---|
| 3.1 | — | observe | Your tier change is *why* these cards are here. Tier-2 crest visible on T-Rex. |
| 3.2 | `sellCard(packstrider)` | hard | **Sell** (drag above the warband) returns 1 Gold. Strong runs replace yesterday's best card. |
| 3.3 | `buyCard(manasaber)` | hard | Buying a *package*, not the biggest single card. |
| 3.4 | `buyCard(b2_trex)` | hard | — |
| 3.5 | `playCardAt` ×2 | **soft** | **Position:** minions attack left→right. Void Panther left, so its Echo fills the front with **Taunt** Cubs before T-Rex is exposed. **Wrong order is allowed** — it becomes a reposition lesson: you can reorder freely in the shop. |
| 3.6 | `useHeroPower` | observe | The power **refreshed** — once per shop phase. |
| 3.7 | `inspectKeyword(Taunt)` | observe | **Taunt** forces attacks toward it. Taught by *your own* summoned Cubs. |

**Combat 3 · win.** Callout: *Echo triggers on death.* The fragile Panther left two Taunt bodies behind and
shielded the board.

### Turn 4 — refresh, spells, freeze · vs Flint

| # | Intent | Gate | Teaches |
|---|---|---|---|
| 4.1 | — | observe | Gold buys cards **or** buys another look. |
| 4.2 | `refreshShop` | hard | **Refresh** costs 1 Gold. |
| 4.3 | `buyCard(manasaber)` | hard | A second copy moves you toward a Gild. |
| 4.4 | `inspectCard(growth)` | observe | **Shop spells** resolve immediately instead of joining the warband. |
| 4.5 | `castSpell(growth)` | hard | Growth gives your current warband **+1/+1**. |
| 4.6 | — | observe | Two copies stay separate. The **third** is the one that matters. |
| 4.7 | `freezeCard(manasaber)` | hard | **Freeze** preserves the third Panther you cannot afford this turn. |

**Combat 4 · win.** Callout: refreshing *found* the copy; freezing *protected* it.

### Turn 5 — Gilding · vs Ibis

| # | Intent | Gate | Teaches |
|---|---|---|---|
| 5.1 | — | observe | Frozen cards are exactly where you left them. |
| 5.2 | `buyCard(manasaber)` | hard | **Three copies → one Gilded card.** |
| 5.3 | — | observe | Gilding is stronger **and** frees board space. Uses the real triple flow including its reward. |
| 5.4 | `positionCheck` | **soft** | Keep the Gilded Panther **left-most among your Echoes** — "a card you find later will care." |

**Combat 5 · win.** Callout: your printed board was smaller than Ibis's; the Echoes were the difference.
**Lobby:** first elimination (off-screen). Eliminated rows **remain**, with a placement badge.

### Turn 6 — Runes · vs Nox

| # | Intent | Gate | Teaches |
|---|---|---|---|
| 6.1 | — | observe | Runes are **permanent run rules** bought with Gold — they compete with this turn's shop. |
| 6.2 | `inspectRune` ×3 | observe | Inspect all three. "Recommended for this build" is instructional UI, **not** card text. |
| 6.3 | `forgeRune(any)` | **soft** | **All three are legal.** Each gets its own coaching line: Aftershocks (recommended — you trigger Echoes constantly), Packcraft (your summons arrive bigger), Rebirth (a second Echo out of nowhere). |
| 6.4 | `buyCard(b2_wolvie)` + place | hard | Wolvie: Taunt + improves the **next Beast summoned after its Echo** — so it belongs where it dies before your summoners. |

**Combat 6 · win.** Callout: the Rune changed how your **existing** Echoes paid off. Choose the Rune that
connects the pieces you already have.

### Turn 7 — the engine, and your first elimination · vs Rook @ 2 Resolve

| # | Intent | Gate | Teaches |
|---|---|---|---|
| 7.1 | `upgradeTavern` | hard | It cost **2**, down from 7 — the price fell every round you waited. |
| 7.2 | `refreshShop` | hard | Look inside the tier you just bought. |
| 7.3 | `buyCard(b2_echohorn)` + place | hard | **Echohorn's Rally triggers your left-most Echo** — this is the payoff for step 5.4. |
| 7.4 | `castSpell(growth)` | hard | A second Growth. |
| 7.5 | `positionCheck` | **hard** | The **invariant**: Gilded Void Panther is left-most among Echoes. Rejection explains the plan. |
| 7.6 | — | observe ×4 | The build named in four anchored callouts: **enabler → target → payoff → formation.** *"That is a build."* |
| 7.7 | `hoverOpponent(rook)` | observe | **Counterplay from public info:** Rook is at 2 Resolve; a win eliminates them. No board reveal. No prediction. |

**Combat 7 · win.** Your first player-caused elimination.

### Turn 8 — investing again, and the rematch · vs Vale @ 2 Resolve

| # | Intent | Gate | Teaches |
|---|---|---|---|
| 8.1 | `hoverOpponent(vale)` | observe | This is the opponent you lost to on Turn 2. |
| 8.2 | `upgradeTavern` | hard | Levelling is **required** to reach key pieces. |
| 8.3 | `refreshShop` | hard | Refresh into the newly unlocked tier. |
| 8.4 | `inspectCard(seaurchin)` | observe | Sea Urchin has a **Shout**; Dawnclaw can trigger an adjacent Shout through its Echo. *(The Rune is not mentioned yet.)* |
| 8.5 | `freezeCard(seaurchin)` | hard | Freeze — now a familiar tool, not a new lesson. Reduced coaching. |
| 8.6 | `useHeroPower` | soft | Reused without instruction. |

**Combat 8 · win, Vale eliminated.** Callout: *the turn that felt weak is the turn that won the rematch.*
Plus one off-screen elimination.

### Turn 9 — Epic Runes and adjacency · vs Crown

| # | Intent | Gate | Teaches |
|---|---|---|---|
| 9.1 | `inspectRune(rune_dawnclaw)` | observe | **Epic** Runes arrive later and can be build-defining. This one **grants a minion** *and* changes how it behaves. |
| 9.2 | `forgeRune(rune_dawnclaw)` | **hard** | Authored choice. Alternatives are inspectable but disabled with an honest reason. |
| 9.3 | `buyCard(seaurchin)` | hard | Collect what you froze. |
| 9.4 | `playCardAt` (Dawnclaw adjacent to Sea Urchin) | **hard** | **Adjacency** — a formation rule distinct from left-most ordering. |
| 9.5 | — | observe | **Board capacity: 7.** From here, improving means **replacing**. |

**Combat 9 · win.** The Rune fires Dawnclaw's Echo at Start of Combat → Sea Urchin's Shout. Crown eliminated;
the lobby narrows to you and Nox.

### Turn 10 — counterplay and the win · vs Nox

| # | Intent | Gate | Teaches |
|---|---|---|---|
| 10.1 | `hoverOpponent(nox)` | observe | Read the *pattern* ("their wins came from attacking before slower boards set up"). Never the board. Never a prediction. |
| 10.2 | — | observe | Identify your **weakest** piece. |
| 10.3 | `sellCard(b2_trex)` | hard | Sell to make room. Late-game improvement = **replacing** a good card. |
| 10.4 | `buyCard(b2_beardsley)` + place | **hard** | Every Beast you summon gets **+6/+6** — the capstone on an engine that summons constantly. Must not break either formation invariant. |
| 10.5 | `castSpell(preemptive)` | hard | **Counterplay chosen from public information:** you attack first. |
| 10.6 | `useHeroPower` | soft | — |
| 10.7 | — | observe | Read your own engine as a trace. |

**Combat 10 · win the lobby.** Seven eliminations → winner treatment → completion screen.

**Final board (7):** ✦Void Panther · T-Rex · Wolvie · Echohorn · Dawnclaw · Sea Urchin · Beardsley.

## 1.5 Completion screen

Recaps **five decisions the player actually made** (not a generic summary), then the loop:
**Shop → Build → Fight → Learn → Rebuild.** Generates no rating, history, achievements or rewards.

## 1.6 The coaching system

- **Focus mask on first use only.** 18 tracked action keys (`buy`, `play`, `sell`, `refresh`, `freeze`,
  `cast`, `upgrade`, `heroPower`, `gild`, `forgeRune`, `reposition`, `inspect`, `hoverOpponent`, `endTurn`,
  `discover`, `adjacency`, `boardFull`, `epicRune`). Repeats get a small reminder. The game stops holding your
  hand the moment you've done a thing once.
- **Three gate strengths.** Hard rejection **must explain the plan** —
  `Keep that card for now. Sell Packstrider so you can afford both Echo minions.` Never silently swallow input.
- **Copy limits.** ≤5-word titles, ≤18-word instructions, ≤35-word "Why?", **one new rule + one action per
  prompt**, and no internal jargon ever shown to a player.
- **Input-adaptive.** Steps declare *intent* (`buyCard`, `playCardAt`); an adapter supplies mouse / touch /
  controller wording. The words "click" and "drag" never enter completion logic.
- **Presentation-aware.** Coaching waits on the presentation queue going idle. It never retimes authored FX,
  and it never delays a shop action.

## 1.7 Gating, recovery, validation

- Entry: first-launch panel → **Learn to Play** / **Skip for Now**. Skip is always recoverable from the title.
- The tutorial is its own run kind — pinned `setId: 'set2'`, pinned seed, scripted `ShopOfferProvider`,
  scripted opponents, no rating write-back.
- Quit-and-resume restores at turn granularity.
- **Content fingerprint test (blocking).** Assert every ID in §1.1 exists, at the stated tier, with the stated
  effect signature. A balance patch that keeps an ID but changes the effect must fail CI, not silently
  invalidate a lesson.
- **Golden playthrough test.** Replay the scripted action list end-to-end and assert the semantic outcome of
  each combat (won/lost, which Echoes fired) — never animation timing, never DOM state, never log prose.

## 1.8 Deliberately not taught

Quests · Rifts · scouting · full keyword coverage · damage math · advanced counterplay · Tier 7.
Deferred to contextual first-time hints in a real run: hero selection · public-info counterplay ·
Quests being hero-specific · Glossary on first unfamiliar keyword · Tier 7 access.

---

# PART 2 — Tactical Trials

## 2.1 The engine

A trial is a **fixed position with an objective and at least one valid solution line**. Where the FTUE teaches
verbs, Trials teach **how engines combine**.

```
TrialDef ──▶ scripted RunState + scripted ShopOfferProvider + pinned seed
         ──▶ player acts through the REAL reducer
         ──▶ semantic event trace ──▶ declarative predicates ──▶ Solved / Optimal / Mastered
```

**Non-negotiables** (all inherited from the FTUE spine):

1. **Validate semantics, not stats.** Different bugs produce identical numbers. Read a semantic event trace —
   never animation timing, DOM state, combat-log prose or FX callbacks.
2. **Accept equivalent solutions.** The canonical line exists for verification, hints and playback — not as
   the only pass condition. Exact order is enforced *only when order is the lesson*.
3. **Determinism + instant restart**, including the subtle state: spell escalation counters, charge progress,
   per-instance improvements, RNG cursor.
4. **Content fingerprinting** by ID + tier + effect signature, same blocking CI rule as §1.7.
5. **Failure teaches the concept**, never says "wrong":
   `Living Grimoire was still charged when two Shouts triggered. Reset progress does not bank.`

## 2.2 The difficulty ladder

| Tier | Shape | What the withdrawal teaches |
|---|---|---|
| **Introductory** | One engine, one ordering decision, full highlighting, may block one invalid action | The concept in isolation |
| **Intermediate** | Two engines (or engine + Rune), **one attractive wrong line**, 6–10 actions, checklist but no arrows | Recognising a trap |
| **Expert** | 3–5 engines, resource/space/timing pressure, 10–18 actions, alternate lines accepted, objective only | Planning a whole turn |

**Grades:** *Solved* → *Optimal* (within par) → *Mastered* (no hints, no undo, no solution playback).

## 2.3 The launch set — five trials

All cards below verified present in Set 2.

### A1 · First Things First — *Introductory, ~2 min*

**Cards:** `d2_spellkeeper` Spell Warden (T5) — *"After you cast your **second Shop spell** each turn, get a
copy of the first."*

**Position:** Spell Warden on board. Hand holds one cheap economy spell and one expensive payoff spell.
Gold is exactly enough for both.

**Objective:** End the turn holding a copy of the **payoff** spell.

**Lesson:** *first* and *second* are positions in a sequence you control.

**The trap:** casting the cheap spell first — the natural, affordable-feeling order — copies the **cheap**
spell. The board state looks fine; the reward is wrong.

**Failure copy:** `Spell Warden copied your first spell. You cast the cheaper one first.`

**Canonical line:** cast payoff → cast cheap → Warden grants the payoff copy. **Par: 2 actions.**

---

### A2 · Spend and Recharge — *Intermediate, ~4 min*

**Cards:** `d2_grimoire` Living Grimoire (T6) — *"The first spell you cast each turn **casts twice**. Once
used, trigger **3 Shouts** to reset this."* Plus three Shout bodies available to buy and play.

**Position:** Grimoire on board, already **spent** this turn. Gold covers exactly three Shout minions with
nothing to spare. Board has exactly three open slots.

**Objective:** Cast a second doubled spell **this same turn**.

**Lesson:** Grimoire is a **charge**, not a passive. You spend it, then pay 3 Shout triggers to get it back.

**The trap:** trying to bank progress — triggering Shouts *before* spending the charge does nothing.
**Reset progress does not bank while charged.**

**Failure copy:** `Living Grimoire was still charged when those Shouts triggered. Reset progress does not bank.`

**Canonical line:** play Shout ×3 → Grimoire resets → cast the payoff spell doubled. **Par: 4 actions.**

> Re-authored: the handoff's "Drakko halves the requirement" was written against a card that does not exist.
> Trigger-doubling (`d2_orivax` — *Shouts trigger an additional time*) moves to Expert, where it belongs.

---

### A3 · Sevenfold Front — *Expert, ~9 min · the falsification test*

**Cards:** `fronttoback` Front to Back (T4, 1g) — *"Give a minion **+2/+2**. Improve this by **+2/+2** **each
cast**."* · `d2_grimoire` Living Grimoire · `d2_mirrorwing` Mirrorwing (T2) — *"The first **Shop spell** you
cast on this each turn **casts again**."* · `d2_recaller` Recaller (T4) — *"**Shout:** get a copy of the last
**Shop spell** you cast this turn."* · `d2_spellvault` Spellvault Drake (T5) — *"**End of Turn:** get a copy
of the first **Shop spell** you cast this turn."* · Shout bodies for the Grimoire reset.

**Objective:** Resolve **Front to Back seven or more times** in one turn.

**Lesson:** four independent copy/repeat engines stacked, under **hand cap** and **board space** pressure.
Every source of repetition has a different key: Grimoire keys on *first spell of the turn*, Mirrorwing on
*first spell cast on Mirrorwing*, Recaller on *last spell cast*, Spellvault on *first spell cast*.

**The traps:** spending the Grimoire charge on the wrong spell · casting on the wrong body and burning
Mirrorwing's once-per-turn window · filling the board so a Shout body can't be played to reset Grimoire ·
hitting the hand cap and losing a granted copy.

**Alternate lines are expected and must be accepted.** The trial checks *"Front to Back resolved ≥ 7 times"*,
not a fixed action list.

> **Because Front to Back improves on *each* cast (not every other), each resolution is +2/+2 bigger than the
> last.** Seven casts is a cumulative **+56/+56** on a single body. Re-tune the target against the shipped
> card before locking par.

**This is the falsification test.** Implement A1 end-to-end, then A3 **immediately**. If A3 needs bespoke
React, stop and strengthen the scenario/validator layer before authoring any more content.

---

### I4 · Echo Formation — *Intermediate, ~5 min · the tutorial's sequel*

**Cards:** `rune_dawnclaw` Rune of Dawnclaw · `b2_echohorn` Echohorn · `b2_dawnclaw` Dawnclaw · `seaurchin`
Sea Urchin · filler.

**Position:** all pieces owned, board **not** in the right order. One board slot free.

**Objective:** Trigger Sea Urchin's Shout in combat **twice**.

**Lesson:** a three-link positional chain, each link with a *different* positional rule —
Echohorn reads **left-most Echo**; Dawnclaw reads **adjacent**; the Rune adds a **Start of Combat** trigger.

**The trap:** believing Rally can be fired manually in the shop. **It cannot** — Rally is a combat trigger.
The whole solution is arrangement, not activation.

**Failure copy:** `Rally only triggers when a minion attacks. Combat is where this pays off — arrange for it.`

**Direct sequel to FTUE Turns 7 and 9.** Ideal first trial after the tutorial.

---

### E4 · Casket Full of Beasts — *Expert, ~7 min*

**Cards:** `sp_closedcasket` Closed Casket (T5, 2g, friendly target) — *"Choose a minion. **Start of Combat:**
destroy it."* · `b2_mammoth` Menagerie Mammoth (T5) — *"**Echo:** summon **3** random other **Beasts**."* ·
`b2_oona` King Oona (T5) — *"When you summon a Beast in combat, **double** its Attack."* · `b2_beardsley`
Beardsley (T4) — *"Whenever you summon a Beast, give it **+6/+6**."* · `rune_reinvestment` Rune of
Reinvestment.

**Position:** board nearly full of filler. Gold covers Closed Casket plus one purchase.

**Objective:** Reach a stated Attack total at Start of Combat.

**Lesson:** **board space is the binding constraint.** Closed Casket kills Mammoth on turn one of combat;
Mammoth's Echo summons 3 Beasts; each is caught by Beardsley (+6/+6) *and* Oona (double Attack). But three
summons need three open slots — so you must **sell filler first**, which competes with your Gold.

**The traps:** casting Closed Casket before making room (summons are lost) · targeting the wrong body ·
selling the body that was feeding the payoff.

> **Simplified by the 2026-08-16 rework.** Closed Casket now performs a real destroy, so the marked minion's
> Echo fires normally. The handoff's "the first death Echo is suppressed" caveat is gone, and the lesson gets
> cleaner: *destroy it early, while you still have room to catch what it leaves behind.*

## 2.4 What Trials teach that the FTUE never touches

1. Order-of-action memory — effects that remember *first*, *second*, *last*
2. Charge economies, and reset progress that **does not bank**
3. Trigger multiplication (Expert only)
4. Selling as **space** management, not Gold recovery
5. Investing in a shop offer before you own it
6. Adjacency engines, distinct from left-most rules
7. Consume and its "another friendly X" conditions
8. Reclassification — a Rune changing what a card *counts as*
9. Attack-order counterplay instead of stat scaling
10. Phase discipline — what can only happen in combat vs in the shop

---

# PART 3 — Build order

The two features share ~70% of a foundation: scenario definition, checkpoint/restore, scripted shop provider,
scripted opponents, declarative predicates, anchors, gating, and presentation-idle waiting.

| Milestone | Contents | Gate |
|---|---|---|
| **M1 — Scenario spine** | `TutorialScenarioDefinition`, scripted `ShopOfferProvider`, scripted opponents, pinned seed + `setId`, checkpoint/restore | FTUE Turns 1–3 playable end-to-end |
| **M2 — Coaching layer** | Focus mask, 3 gate strengths, intent→input adapter, first-use tracking, presentation-idle wait | Turns 1–5, copy-reviewed |
| **M3 — FTUE complete** | Turns 6–10, Runes, Gilding, adjacency, board-full, completion screen | Golden playthrough test green |
| **M4 — Trial engine** | `TacticalTrialDef`, semantic event trace, declarative predicates, restart/undo, grading, hint ladder | **A1 end-to-end, then A3 immediately** |
| **M5 — Launch trials** | A2, I4, E4 + Trial Workshop authoring surface | Content fingerprint tests green |

**Build the FTUE spine first.** It is the higher-value artifact and it hands the Trials most of their Phase 1
for free.

# PART 4 — Open questions for the owner

1. **Turn 8's Tier 4 costs 8, not 7.** Confirm the turn still works as scripted, or re-shape the turn.
2. **A3's par count.** Front to Back improving on *each* cast makes seven resolutions enormous (+56/+56).
   Is seven still the right target, or should the objective be a stat threshold instead of a cast count?
3. **Which hero does the FTUE use?** The spec implies Aster with a `+1/+1` targeted power. Confirm the hero ID,
   or nominate an existing one.
4. **Trial entry point** — where does Tactical Trials live in the UI? Its own menu, or gated behind FTUE
   completion?
