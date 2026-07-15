# ASCENT — Game Rules (canonical)

The current player-facing rules of the game, verified against the code. Every claim cites its
source file. Anything not confirmable from code is marked **(unverified — confirm)**.

ASCENT is a single-player roguelike auto-battler: shop for minions, build a 7-slot board, and
fight an ever-rising curve of enemy boards across a fixed course. You don't play forever — you
play a **17-round course** and are graded against a personal target called **the Line**.

---

## The course — 17 rounds (2 calibration + 15 scored)

- A run plays a fixed course of **17 rounds** (`courseRounds: 17`, `maxWave: 17`).
- The first **2 rounds are calibration** (`calibrationRounds: 2`): they still cost Resolve and run
  the full economy, but do **not** count toward your record.
- The remaining **15 rounds are scored** — your W–L record over these is the run's score
  (`runRecord` slices off the calibration rounds; draws count as neither win nor loss).
- The run always completes the course **unless Resolve hits 0** (the only failure state).

Source: `packages/sim/src/config.ts`, `packages/sim/src/state.ts` (`runRecord`, `isCalibrationRound`).

---

## The Line — the success contract

**The Line is the run's win condition**, not merely a survival stat. It's the number of scored
wins a run must **cover** to count as a success — a golf-handicap-style *expectation*.

- Covering the Line is a **win even if you then fall** before round 17; falling short is a **loss**
  even if you survive to the end (`metLine`, `lineResult`).
- Grades (`LineStatus`): `flawless` (won every scored round) · `exceeded` (over the Line) ·
  `covered` (met it exactly) · `missed` (under par but survived the course) · `failed` (under par
  **and** died before finishing). The first three are wins; the last two are losses.
- The Line is **rating-driven** via a career profile. New profiles start at rating 0 → **Line 7**
  (the floor); the Line climbs with rating through bands **7–12** with promotion/demotion hysteresis
  (`MIN_LINE = 7`, `MAX_LINE = 12`, `resolveLine`). The static config default is **Line 9**
  (`defaultLine: 9`), used by tools/tests and any caller that doesn't track rating.
- **Rating change** after a run (`resolveRunRating`) = a line component (scored wins − Line, e.g.
  +4 for covering exactly, up to +20 for +4 over, negative for misses) **plus** end-game bonuses:
  reaching the summit (all 17 rounds) = **+8**; winning round 15 = **+8**, round 16 = **+12**,
  round 17 (the final) = **+16**. So a *true* win (over your Line **and** won the closing rounds) is
  worth far more than merely covering par.

Surviving the whole course is therefore an **extra achievement** (the summit bonus), layered on top
of the central contract: **cover your Line.**

Source: `packages/sim/src/playerRating.ts`, `packages/sim/src/state.ts` (`lineResult`, `metLine`).

---

## Resolve & economy

- **Resolve** is the hero's HP. All heroes start with **30 Resolve**, plus per-hero **Armor**
  (8–19 today) that sits on top and takes loss damage first (no regen). Resolve 0 = run over.
- **Loss damage** is capped per round, ramping up as the course escalates: **5** (rounds 1–3),
  **10** (4–7), **15** (8–11), **20** (12–15), then **uncapped** for the finale (rounds 16–17)
  (`lossDamageCap`).
- **Gold** ("Embers"): start with **3**, **+1 per wave**, capped at **10**
  (`startEmbers: 3`, `embersPerWave: 1`, `embersCap: 10`).
- **Shop**: minion cost **3**, sell value **1**, refresh (reroll) cost **1**
  (`minionCost`, `sellValue`, `refreshCost`).
- **Board** holds **7** minions; **hand** holds **10** (`boardMax: 7`, `handMax: 10`).
- **Tiers** run **1–6** (`maxTier: 6`). Tavern-up costs: T2 **5**, T3 **7**, T4 **8**, T5 **11**,
  T6 **10**, and the cost drops by **1** each wave you don't upgrade, down to a floor of 0
  (`upgradeCost`, `upgradeDiscountPerWave`, `upgradeCostFloor`).
- **Enemy curve**: enemy board width grows **+1 every 6 waves**; stats scale by
  `1 + wave × 0.16` (`curve.extraCountPerWaves: 6`, `curve.statScalePerWave: 0.16`).

Source: `packages/sim/src/config.ts`, `packages/sim/src/heroes.ts` (`resolve`/`armor`),
`packages/sim/src/reducer.ts` (`lossDamageCap`).

---

## The loop — shop → board → combat

Each round: shop the tavern (buy/sell/reroll/tier-up), arrange your board and hand, then **Face the
Omen** to fight the served opponent. Combat is a **pure, deterministic simulation** (`simulate`) that
returns an event log; the UI only replays it and never computes outcomes. Recruit-phase effects
(Shouts/Battlecries, buff-on-summon, Consume) bake into stats *before* combat; the simulator runs
combat-time effects (Start of Combat, Echoes/Deathrattles, on-kill, etc.) and emits log events.

The **combat event vocabulary** is a union of **22 distinct event types** in
`packages/core/src/types.ts` (`CombatEvent`): `sc, attack, dmg, shield, shieldUp, poison, reborn,
death, reveal, keyword, keywordLost, venomLost, summon, ascend, buff, improve, rally, maxGold,
toHand, hpGrant, spellProgress, questTrigger`.

---

## Quests

- Quest turns are **waves 5 and 11** (`questOfferPlan`: `s.wave === 5` / `=== 11`), gated by the
  master switch `CONFIG.questsEnabled`.
- Each quest turn offers **4 quests**: **1 neutral** slot + **3 distinct-tribe** slots, drawn from
  that turn's **tier bucket** (`generateQuestOffer`). Wave 5 draws the "early" bucket (Lesser + most
  Greater quests); wave 11 draws the "late" bucket (Capstones + two promoted Greater neutrals).
- The two main quest turns **guarantee your dominant board tribe** appears in a tribe slot (with a
  chance at a second, once a tribe has ≥2 quests in the bucket).
- Hero exceptions: **Fi** adds a bonus Lesser-only quest offer on turn 3; **Coran (Pathfinder)**
  skips the turn-5 quest and gets the late-bucket quest early, on turn 7.

Source: `packages/sim/src/quests.ts`.

---

## Runes (the Runeforge)

Runes are run-long permanent buffs bought from a **Runeforge**, available only to specific heroes
(never in the regular shop / Discover / quest pool):

- **Basic Runeforge** — hero **Runesmith**: opens on **turn 7**, offers a random 3 Basic Runes, buy
  ONE (re-roll once for 2 Gold). Its power text and `oncePerGame` comment both say turn 7 (the
  internal comment "fires on the turn-6 advance" refers to the setup tick that *opens* the turn-7
  offer). Verified turn = **7**.
- **Epic Runeforge** — hero **Runeguard**: opens on **turn 12**, buy one Epic Rune
  (scheduled at run start via `epicForgeWave`).

Each rune's effect reuses the quest `QuestReward` application engine — it just takes effect with no
objective.

Source: `packages/sim/src/heroes.ts` (`runeforge`, `epicRuneforge`),
`packages/content/src/runes.ts`.

---

## Matchmaking (served opponents)

Opponents are real captured/authored boards served from a pool, with a procedural threat board as
fallback. The pick (`pickOpponent`) is deterministic (seeded) and works as:

1. **Wave-first** — you face a board at the **same development stage** (same wave = same amount of
   shopping); widen to the closest available wave if none match exactly.
2. **Recent-opponent exclusion** — boards fought in the last few rounds are dropped, unless that
   would leave nothing to serve.
3. **Source priority** — live Supabase shared pool (`remote`) → local player/friend boards
   (`self`/`friend`) → committed synthetic floor.
4. **Uniformly random within the chosen source tier** (no power/similarity weighting — the `power`
   arg is retained only for signature stability).

If the pool is empty for a wave, it falls back to the **procedural threat board** (`buildEnemyBoard`).
The pool is static per session (registered once at startup), so replays within a session are
byte-identical; across sessions the remote fetch can differ.

Source: `packages/sim/src/opponents.ts`.

---

## Displayed terminology (rename table)

Player-facing text renames the underlying keyword vocabulary (display-only; internal ids and card
data are unchanged) via `packages/ui/src/terms.ts`:

| Internal / classic | Displayed |
| --- | --- |
| Battlecry | **Shout** |
| Deathrattle | **Echo** |
| Divine Shield | **Ward** |
| Windfury | **Flurry** |
| Venomous | **Toxin** |
| Reborn | **Rise** |
| Magnetize | **Attach** |
| Magnetic | **Attachment** |
| Golden | **Gilded** |

**Kept as-is** (no rename): Taunt, Avenge, Choose One, Start of Combat, End of Turn, Rally, Cleave,
Consume, Discover.

Source: `packages/ui/src/terms.ts`.

---

## Unverified / confirm

- **Starting Resolve divergence:** all heroes are 30 Resolve *today*, but the code comment notes it
  "will diverge per hero over time" — **(unverified — confirm)** whether any hero already differs.
- **Practice mode** shares the same 17-round course but "can't be lost" (unlimited health, longer
  per-turn clock) per the config comment — the exact per-turn clock difference is
  **(unverified — confirm)** against the recruit timer.
