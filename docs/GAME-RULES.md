# ASCENT — Game Rules (canonical)

The current player-facing rules of the game, verified against the code. Every claim cites its
source file. Anything not confirmable from code is marked **(unverified — confirm)**.

ASCENT is a deterministic, **asynchronous auto-battler**: shop for minions, build a 7-slot board, and fight
auto-resolved combats inside an **eight-seat elimination lobby**. You are not racing a fixed course — you are
outlasting seven other seats, and your **final placement** is the result that moves your ladder Rating.

> **RETIRED — do not describe as current.** The **17-round course** and the **Line / Oath** success contract
> are no longer the game. Their constants (`CONFIG.courseRounds: 17`, `defaultLine`, `calibrationRounds`,
> `maxWave`) and helpers (`metLine`, `lineResult`) still exist in code, and are still read by balance tools,
> older saved runs, and the non-lobby modes — but the live `Play` route is the lobby, which has no course
> clock and no Line verdict. Legacy sections of this document were rewritten on 2026-08-20; the historical
> detail lives in [`devlog.md`](devlog.md).

> **Player-facing vocabulary:** the UI displays some systems under themed names while the code keeps the
> internal terms — **Resolve** is the seat's health pool, **Embers** are Gold. **Rating is displayed as
> "Rating"** (owner 2026-08-04; the earlier *Renown* rename is reverted). A lobby run's Career row reads as
> its score, finish position, Victory/Defeat and the Rating change — no Oath verdict.

---

## The lobby — eight seats, elimination

- A run is **one seat in an eight-seat lobby** (`DEFAULT_LOBBY_RULES.seatCount: 8`). **Seat 0 (`s0`) is the
  live player**; the other seven are independently developed runs.
- A non-player seat is a **snapshot** (a recorded player run), a **hybrid**, a **bot**, or — in the tutorial
  only — an **authored** seat. Player snapshots fill every seat the pool can cover; bots take what is left,
  so an empty pool degrades to a fully generated table rather than a smaller one.
- The lobby is **asynchronous**: opponents are recordings and generated runs, never live opponents. It never
  requires two players online at once.
- Each round, surviving seats are **paired**. **One authoritative `simulate()` resolves each encounter and
  supplies BOTH sides' damage** — combat is not symmetric, so a fight must never be re-run with the sides
  swapped to get the "other" result.
- **Armor absorbs damage before Resolve** (`startingArmor: 15`, `startingResolve: 30`). A seat whose total
  reaches 0 is eliminated and receives a placement.
- The lobby ends when **one seat remains**. `maxRounds: 60` is a **deterministic stalemate backstop**, not a
  course length or a player-facing target.
- **Placement is the result.** A lobby finish resolves a placement-based Rating change; 1st is the win. (A
  lobby never reaches the `victory` phase — `advanceCombat` ends every lobby at `gameover` whether you won or
  lost, because a lobby has no course clock to complete.)
- A run **pins its set at creation** and reads it forever after, so an in-progress or replayed run is
  unaffected by a later global set change.

Source: `packages/sim/src/lobby/lobby.ts` (`DEFAULT_LOBBY_RULES`, damage application),
`packages/sim/src/lobby/runLobby.ts`, `packages/sim/src/lobby/seats.ts`,
`packages/sim/src/lobby/snapshotSeats.ts`, `packages/sim/src/playerRating.ts`.

---

## Health & economy

- **Health** is the hero's life total. All heroes start with **30 Health**, plus per-hero **Armor**
  (8–19 today) that sits on top and takes loss damage first (no regen). Health 0 = run over.
  *(Called "Resolve" until 2026-08-17. The rename is DISPLAY-ONLY — the state field, its types and the
  saved-run format are still `resolve` / `maxResolve` / `startingResolve`, so code and saves read one name
  and players read the other.)*
- **Loss damage** is capped per round, the cap widening as the run escalates: **5** (rounds 1–3),
  **10** (4–7), **15** (8–11), **20** (12–15), then **uncapped from round 16 on**. The lobby applies the
  same cap (`lossDamageCap`, imported by `lobby.ts`) — so a lobby that runs long is uncapped for every
  round past 15, not just a "finale"
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

## Quests — ⚠️ ARCHIVED (owner ruling 2026-08-28)

> **The quest system is OFF. Nothing below happens in the game today.**
>
> Owner ruling, 2026-08-28: *"we have more or less retired quests for now. we can archive that system fully,
> it can be more or less turned off and away from our code for now as we are centering on runes for the
> foreseeable future."*
>
> `QUESTS_ARCHIVED` (`packages/sim/src/config.ts`) short-circuits `questOfferPlan` to `null` before any rule
> below is reached. That function is the ONLY producer of a quest offer — both mint sites (`createRun` for the
> turn-1 hero quest, the turn advance in `reducer.ts` for everything else) go through it — so in every mode,
> on every seed, for every hero: no offer is generated, the quest overlay never opens, `buyQuest` has nothing
> to take, `activeQuests` stays empty and no objective ever advances.
>
> **This is an ARCHIVE, not a deletion.** `QUEST_DEFS` / `QUEST_INDEX`, the objective machinery, the reward
> engine (`applyQuestReward`) and the quest UI are all intact and every quest id still resolves — the
> `ARCHIVED_CARDS` / `ARCHIVED_RUNES` contract. A run or replay recorded before the archive still loads, still
> ticks its quest and still pays it out (`questArchiveSaves.test.ts`). The reward engine in particular MUST
> stay live: every **rune** in the game pays out through it.
>
> **Note the older `CONFIG.questsEnabled` flag is NOT this switch and never could have been** — it gates only
> the universal turn-5/11 offers, and the quest-native heroes were deliberately checked above it. Setting it
> back to `true` no longer reopens anything (`systemToggles.test.ts`).
>
> Fi and Coran, whose whole powers were hero quests, are `wip` — withheld from Play, from Practice and from
> every hero-power Discover pool — pending redesign. Their defs stay in `HEROES` so saves and replays resolve.

The rules the system will have again when it is un-archived, unchanged below:

- Quest turns are **waves 5 and 11** (`questOfferPlan`: `s.wave === 5` / `=== 11`), gated by the
  master switch `CONFIG.questsEnabled`.
- Each quest turn offers **4 quests**: **1 neutral** slot + **3 distinct-tribe** slots, drawn from
  that turn's **tier bucket** (`generateQuestOffer`). Wave 5 draws the "early" bucket (Lesser + most
  Greater quests); wave 11 draws the "late" bucket (Capstones + two promoted Greater neutrals).
- The two main quest turns **guarantee your dominant board tribe** appears in a tribe slot (with a
  chance at a second, once a tribe has ≥2 quests in the bucket).
- Hero exception (stands **on top of** the normal turns and survives `questsEnabled = false`): **Fi** and
  **Coran** open the run on a **turn-1 two-option pick** from their own private **hero quest** lists (reworked
  2026-08-21 — the old turn-4 Errand / turn-10 Pathfinder bonus offers are retired). Every hero quest shares
  one objective: **travel N steps**, where playing a minion, casting a spell or upgrading the Shop is one
  step. Fi's five pay early (12–26 steps); Coran's five pay late and large (28–46). The two three-variant
  families (Opening Act / Resonant Path — a Shout, Echo and Rally spelling each) never offer two variants at
  once, and hero quests never appear in the universal turn-5/11 offers.

Source: `packages/sim/src/quests.ts`; the archive switch, `packages/sim/src/config.ts`.

---

## Henchmen — ⚠️ ARCHIVED (owner ruling 2026-08-28)

A **henchman** was a hero-bound minion, never sold in the Shop, recruitable once per run at a price that fell
every round (win −3, loss −2, floored at 0). Owner triage, 2026-08-28: *"henchmen are not in the game and are
extremely WIP / being removed for now."*

`HENCHMEN_ARCHIVED` gates `henchmanOffer` (`packages/sim/src/state.ts`), the single producer of an offer. With
it null, `buyHenchman` refuses and the StatusBar's henchman chip — which renders only on a non-null offer —
never appears. As with quests this is an archive: the `HENCHMEN` registry, the `HeroDef.henchman` link and the
cost-decay state all stay live and resolvable, so un-archiving restores a correctly-priced offer rather than a
broken one.

Only one henchman was ever authored (a placeholder on Warden), and because Warden is the first and fully
playable hero, that placeholder was reachable in real games until this ruling.

---

## Runes (the Runeforge)

Runes are run-long permanent buffs bought from a **Runeforge**, available only to specific heroes
(never in the regular shop / Discover / quest pool):

- **Basic Runeforge** — hero **Runesmith**: opens on **turn 5**, offers a random 3 Basic Runes, buy
  ONE (re-roll once for 2 Gold). Its power text and `oncePerGame` comment both say turn 7 (the
  internal comment "fires on the turn-6 advance" refers to the setup tick that *opens* the turn-7
  offer). Verified turn = **7**.
- **Epic Runeforge** — hero **Runeguard**: opens on **turn 8**, buy one Epic Rune
  (scheduled at run start via `epicForgeWave`).

Each rune's effect reuses the quest `QuestReward` application engine — it just takes effect with no
objective.

**Duplicates always do something** (owner rulings 2026-08-27, decisions `q-runedup-*`). Rune ownership is
COUNTED (`RunState.runeStacks`; combat boolean flags use `flagCopies`), and a second copy stacks per family:
recurring effects fire once per copy; meter runes keep ONE meter but pay double at each trip; repeat runes
add +1 repetition per copy; one-shots simply grant again (banked to next turn when immediate value is
impossible); engine runes double their output where a sensible doubling exists. A duplicate that genuinely
cannot stack pays the universal sweetener — Gold equal to half the rune's printed cost rounded up, plus a
free refresh — and the Runeforge stops OFFERING owned runes whose duplicate would only pay that sweetener
(Rune of Duplication still reaches them deliberately). Rune of the Ornate Clock is ruled unique: a duplicate
does nothing. Classification lives in `packages/sim/src/runeDup.ts`.

Source: `packages/sim/src/heroes.ts` (`runeforge`, `epicRuneforge`),
`packages/content/src/runes.ts`, `packages/sim/src/runeDup.ts`.

---

## Matchmaking

**In the lobby (the live route), your opponent each round is the SEAT you are paired with** — not a board
drawn from the pool. Pairing is deterministic and avoids unnecessary immediate rematches; the encounter is
resolved once and both seats take their damage from that single result.

The pool-based `pickOpponent` path below still exists and still serves the **non-lobby** modes and tooling. It
is NOT what a lobby run faces, which is why injecting served boards into a lobby replay changes nothing:

1. **Wave-first** — a board at the same development stage; widen to the closest wave if none match.
2. **Recent-opponent exclusion**, unless that would leave nothing to serve.
3. **Source priority** — shared remote pool → local player/friend boards → committed synthetic floor.
4. **Uniformly random within the chosen tier**; empty pool falls back to the procedural threat board.

Source: `packages/sim/src/lobby/runLobby.ts` (pairing), `packages/sim/src/opponents.ts` (pool path).

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
| Venomous | **Execute** |
| Reborn | **Rise** |
| Magnetize | **Attach** |
| Magnetic | **Attachment** |
| Golden | **Gilded** |

**Kept as-is** (no rename): Taunt, Avenge, Choose One, Start of Combat, End of Turn, Rally, Cleave,
Consume, Discover.

Source: `packages/ui/src/terms.ts`.

### "A card is added to your hand" — every source, every phase (owner rule 2026-08-29)

*"cards added to hand is an effect in recruit + shop and should trigger effects that track them in all
places."*

A card **arriving in your hand** is an event in its own right, and every effect that watches for it
(Gangplank, Kegheart Dwarf, the Rune of Heavy Payroll) fires **wherever the card arrives from**:

- **Any source counts.** Buying a minion or a Shop spell, taking a Discover pick, a triple's golden, an Ale,
  a minted Ruby, a conjure, a rune or hero grant, restoring a displaced minion — all of them. There is no
  privileged "grant path": a card is a card.
- **Any phase counts.** Including **mid-combat**. A combat effect that grants a card to hand (a Deathrattle
  copy, a minted Ruby) fires these reactors **during the fight**, so the payout can affect the fight that
  earned it — not only afterwards when the card settles into the next shop.

The one asymmetry, and it follows from the engine rather than from this rule: a **served enemy board has no
hand**, so nothing ever reaches one and an enemy's watcher never fires. The event is scoped to the side whose
hand actually received the card.

**How it is enforced.** Each phase supplies its own dispatcher — the shop diffs the hand by uid in `reduce`
(so a new `hand.push` site cannot forget to fire it), combat emits from `ctx.grantToHand` / `ctx.grantRubies`
(the only two ways a card reaches a hand mid-fight). Both run the *same* effect bodies, in
`ARENA_EFFECTS`, so the two phases cannot drift apart.

---

### Aura — the run-wide scope noun (owner ruling 2026-08-28)

A grant that reaches a whole tribe/class **wherever its members sit** — the board, your hand, the Shop, and
copies you acquire later — prints as an **Aura**: *"give your **Beast Aura** +8/+8"*, *"improve your **Imp
Aura** by +2/+2"*. The shape is `your <Tribe-singular> Aura`.

This replaced the older scope tails **"wherever they are"** and **"everywhere"**, which no longer appear in
any printed text. It is a **vocabulary change only** — an Aura grant is the same run-wide grant it always
was, with the same numbers, targets and timing; no engine identifier, effect id, or FX path moved. The rule
and its machine-checkable predicate live in the language guide as **LG-SCOPE-01**
(`packages/rules/src/languageGuide.ts`), and a grow-loudly test fails if new text reintroduces a retired tail.

Unrelated and **reserved**: the owner's own **Rise / Reborn → Rebirth** rename is still in flight and was not
touched here (LG-KEYWORD-02).

---

## Unverified / confirm

- **Starting Health divergence:** all heroes are 30 Health *today*, but the code comment notes it
  "will diverge per hero over time" — **(unverified — confirm)** whether any hero already differs.
- **Practice mode** is a lobby that "can't be lost" (unlimited health, longer
  per-turn clock) per the config comment — the exact per-turn clock difference is
  **(unverified — confirm)** against the recruit timer.
