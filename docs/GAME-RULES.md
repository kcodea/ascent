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
  so an empty pool degrades to a fully generated table rather than a smaller one. **Which** snapshot runs sit
  at the table is a seeded uniform shuffle of every eligible run in the lobby's set (owner 2026-09-13): every
  run is equally likely, the same lobby seed always seats the same table (restore / replay), and nothing
  weights the draw — no strength band, no author cap (an author may hold several seats through different
  runs; a per-author cap is a future knob), no win-rate weighting (that exists only on the pre-lobby pool pick).
  **All eight heroes are unique per lobby, the player's included** (owner 2026-09-13): a run on a hero already
  seated — or on the player's hero — is passed over for the next run in the shuffle, and generated seats never
  repeat a hero either.
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

**The shop draws from a shared, finite pool, weighted by copies left** (owner ruling 2026-09-10). Every
minion of the run's tribes starts with a fixed number of copies per tier; buying takes one, selling or
discarding returns one. Each roll picks a card with probability proportional to the copies it has left, so
a card down to its last copy is rarer in proportion, and the odds shift gradually as the pool drains rather
than falling off a cliff at zero. (Practice tribe surge doubles that tribe's tickets.)

### Equipment (owner rulings 2026-08-28 + 2026-09-11)

**Equipment** is a Shop-phase ability granted by an *Equip* minion (Alchemist Frank → Bloodpot, Titan
Sculptor → Titan Hammer, …) and owned by the **player**, shown in a second slot beside the hero power.
Playing the minion grants it at once; selling the minion does **not** revoke it for the rest of the turn; at
every Start of Turn the collection is rebuilt from the surviving board, so keeping it means keeping an Equip
minion alive. Duplicates collapse into one entry; a single Gilded source upgrades the entry for everyone.

**Charges (2026-09-11):**
- **Every Equipment has its OWN charge, once per turn.** Holding Bloodpot and Titan Hammer, you may activate
  each once per turn. Own charges reset at Start of Turn; nothing carries across turns.
- **Bonus charges are ONE shared pool.** Jumpstart Jules's Start of Turn grant (gilded = 2) and any future
  source add to it; two grants = a pool of 2. Per-turn only — it expires at End of Turn / the next rebuild.
- **The number shown on an Equipment = its own remaining charge + the shared pool.** With one bonus every
  Equipment reads **2**, in **green** (modified above baseline); plain when the pool is 0 (1, or 0 once its
  own charge is spent).
- **The pool is spent FIRST.** With a pool of 1, activating Equipment A spends the pool: every Equipment drops
  from green 2 to plain 1, and A can still be activated once more on its own charge. Only when the pool is 0
  does an activation spend that Equipment's own charge (it then reads 0 and its button disables; the others
  still read 1).
- Swapping the selected Equipment is **free** (no Gold, no charge). Activation is **atomic** (validate, pay,
  spend, resolve in one action — a cancel costs nothing by construction). Gold cost, temporary cost
  reductions, extra-trigger repeats and Choose One on an Equipment are unaffected by charges.
- **Clock-window Equipment** (Thymepiece, owner design 2026-09-12: *"All cards cost 1 less Gold for the next
  8 seconds"*; gilded −2) runs on the **turn clock**, not wall time: the activation records the clock's reading,
  the window is 8 clock-seconds in every mode (Practice's multiplier only stretches the real seconds), it
  pauses with the clock (Discover / Choose One / aim / hero select), it discounts **cards only** (Shop minions,
  the spell slot, spell offers in the row — never the Shop upgrade or a refresh), prices floor at 0 (the
  Starform's live price included), every discounted coin shows green, the slot counts it down, and it ends on its own expiry
  action, at combat entry, or at the turn flip. A Continue whose saved clock is already past the window
  resumes without it; the engine never reads a clock (`RunState.cardDiscountWindow`).
- **Amplified** (owner design 2026-09-16, Set 3 batch 2): a per-Equipment STATE. The rune prints *"Equipment you
  do not use becomes Amplified."* (owner wording 2026-09-18); the glossary pill / Compendium define the state:
  *"An Amplified Equipment will trigger its effect twice for no additional gold."* An Amplified Equipment's next
  activation runs **twice** — the whole activation, extra triggers
  included, so `(1 + extra) × 2` — and the stack is **consumed** by it. One stack per Equipment, never more.
  Written by **Rune of Amplification** (Basic 4: at End of Turn every held Equipment you did not activate this
  turn — through the pool or its own charge — gains a stack) and **Rune of the Grand Workshop** (Epic 6: every
  held Equipment now, and again every Start of Turn). The stack **survives the Start-of-Turn rebuild** for every
  Equipment still held (it is the one piece of Equipment state meant to carry) and is pruned for one whose
  sources all left. Presentation: the Equipment's **charge number turns BLUE** while Amplified (over the pool's
  green), the tooltip says so, and the tally carries `data-fx="equipment-amplified"` as the binding point for
  the owner's future authored cue. Engine: `PlayerEquipmentState.amplified` + `sim/equipment.ts`
  (`amplifyEquipment` / `amplifyUnactivated` / `amplifyAllHeld` / `consumeAmplified`), pinned in
  `set3RunesTrancheC.test.ts`.

### The Starform — the Celestials' shop token (owner design 2026-09-12; rules v2 2026-09-13)

The **Starform** is a **1/1 Celestial token that lives IN THE SHOP** as an ordinary shop offer (normal unit
frame, no rules text — **its printed stats are the counter**). Celestial cards create it, grow it and cash it
in; the shop never rolls it. Engine: `packages/sim/src/starform.ts`; every rule below is pinned in
`starform.test.ts`.

1. **Created into the right-most Shop slot.** With no slot open it **Consumes the right-most Shop minion**
   (that offer leaves; the Starform gains its current buy stats) and takes its slot — a real Shop consume,
   with every latch and watcher a Demon's consume touches (Bottomless Banquet, Open Market, `onConsume`,
   the consume meter). A spell / Ruby in the right-most slot is skipped leftward; a full row with no minion
   at all still gets the token (appended — the one case the row overflows by one, until the next roll).
2. **Only one at a time.** A second create is a no-op (cards that say "give it +2/+2 instead" handle that
   themselves).
3. **It persists through refreshes at the RIGHT-MOST slot** (owner 2026-09-14) — the player may drag it
   anywhere in the row during a turn, but every rebuild (a roll, a Muster, a spell shop, a restock) puts it
   back at the far right, past any spell offers (kept Layaway offers still pull left) — and across turns and
   combat, and under Freeze, until it is consumed, collapsed or destroyed. It takes a slot: a tier's row is one
   draw shorter while it is out. **Creating into a full row is silent on screen**: the eaten right-most
   minion simply leaves and the token takes its slot in place — no pull, no row shift — while the owner's
   `starform-create` cue plays on the token (it plays on every creation, open slot or not). Mechanically the
   meal is still a real Shop consume.
4. **Refresh-time slot buffs land on it ONCE.** Market Tormentor's right-most enchant, Rune of the Embers'
   doubling, the Display Case's left-most enchant and Veinstorm's per-refresh Ruby stamp each land on a
   Starform the first refresh it sits in the slot and **never again** on later refreshes (they are gated,
   not redirected to the next minion). Right-most buffs from a *play* (a Shout, a hero power) apply as
   normal.
5. **It has a PRICE, and buying it feeds it to your LEFT-MOST Celestial** (owner rules A + B, 2026-09-13).
   It spawns at **6 Gold**; **every refresh — paid or free — knocks 1 off** (floor 0); the reduction
   **survives the turn boundary** (a 3-Gold Starform is 3 Gold next turn); a **new** token (Zenith's
   re-creation included) starts at 6 again. Every regular discount applies exactly as to a minion (Cadence,
   Trade-In, the Friends-and-Family Gift, the Thymepiece window, the free first buy), and the coin always
   shows the charged price. **Buying it = your left-most board Celestial CONSUMES it** for its full stats
   (base 1/1 included) — it leaves through the consume path, so Zenith re-creates and Twin Star hears the
   gain. **With no Celestial on board the Gold is still spent and the token is simply lost** (consumed into
   nothing; Zenith still re-creates). The buy counts as a minion bought (on-buy watchers, buy tallies,
   quest / rune / hero-power counters) but puts nothing in hand and returns nothing to the pool. The old
   0-Gold "dismiss" buy is gone. It is never gilded, never tripled, never held / laid away, never displaced,
   never stolen to hand, never replaced by a Discover. For **everything else it is a regular Shop minion**:
   random-shop picks, Demon consumes (a Demon *can* eat it), "this shop" buffs, hero powers and spells aimed
   at a shop minion.
6. **Every shop buff bakes onto the token.** Direct buffs, permanent shop buffs ("minions in the Shop get
   +X/+X"), *this-turn* shop buffs and consumes all fold into its printed stats as they happen — so a
   refresh that clears a this-turn buff for every other offer leaves the Starform's total intact. It is the
   one offer that keeps them.
7. **Consume = 100% of its stats to one Celestial; Collapse = 50% to 3 UNIQUE random friendly Celestials
   plus the extras** (owner rule D, 2026-09-13; 3 hits since 2026-09-18, was 2), halves rounded **up**, the base 1/1 **included** in what
   transfers. The extras (Fuse Aldrin's passive: +2 per Herald, +4 gilded; plus the run-wide
   `collapseExtraTargets` counter, 0 today and reserved for future cards) are drawn **with replacement** —
   an extra may land on a Celestial that already took a hit, so with two Celestials one can take 3 and the
   other 1. One Celestial: 1 original + every extra on it. None: the token still collapses and the stats go
   nowhere. With no Starform both do nothing. **Under Rune of Soul Script** (owner 2026-09-16) your **Undead are
   Collapse receivers beside your Celestials** — originals, extras and the Supernova's "all your Celestials" alike —
   and any Undead whose text Consumes may eat the token (the shared Shop-consume chokepoint takes any eater).
8. Two board-wide watcher moments: **"whenever your Starform gains stats"** (the gain's amount rides along)
   and **"when your Starform leaves the Shop"** (consumed — the buy, a Demon, or a card — or collapsed,
   with its full stats). The Star Destroyer's exit (below) fires **neither**.
9. **STAR DESTROYER** (owner rule C, 2026-09-13): while a Starform exists the player holds the
   `star_destroyer` Equipment — **a standard Equipment in every respect** (the rail, the selector, its own
   once-per-turn charge, the shared bonus pool; gilding does not apply) whose **source is the Starform offer**
   rather than a board minion. It is granted when a token is created, leaves the rail the moment the token is
   gone (any exit), and comes back with the next token. **Using it (0 Gold) is the silent exit**: the token
   leaves the Shop and nothing else happens — no consume, no collapse, no watcher, no gain, not a buy, no
   pull animation, no Zenith re-creation.

**The Starform roster's card-level readings** (owner spec 2026-09-12; `packages/content/src/cards/set3/celestials.ts`,
pinned in `packages/sim/src/set3CelestialRoster.test.ts`):

- **"This shop" +X/+X** (Rocket Power, The Great Attractor's Shout, the Stellar Lens) buffs the **offers standing
  in the row right now** — the owner's "this shop" vocabulary (2026-07-25), not the per-turn channel. The Starform
  keeps it through the next refresh; every other offer loses it. (Wishing Star is a plain adjacent +3/+4 Shout
  since 2026-09-14.)
- **The Great Attractor** (2026-09-14) gives **this shop +4/+3** and THEN its Starform eats the **highest current
  buy Health** offer — so the meal carries the buff. **Black Hole** (was Accretion; no Star Crash any more) eats
  **3 random** Shop minions, one real consume each, fewer if the row is short. Ties for "highest" go to the
  **right-most**. With no Starform neither consumes.
- **Rocket Power** (was Shooting Star; no Flurry) counts Shop spells cast this turn (`spellsThisTurn` — a multiplied
  cast counts each time); the card prints the live total. **Zenith** counts a spell of **any** kind, Rubies included
  (the Gravestar Seer ruling).
- **Stardust Peddler** (2026-09-18, 2/5): **when you spend 5 Gold** (a per-instance Gold meter while it stands — the
  Coinfire Forewoman / Billings shape; the remainder carries, a big spend can cross it twice; the step counter shows
  N/5) it **creates** a Starform if you have none, else the token gains **+3/+3** (gilded +6/+6).
- **The Stellar Lens** (2026-09-14) **creates** a Starform if you have none, then gives **this shop +7/+7** (gilded
  +14/+14) — the fresh token is one of the offers that takes it.
- **Star Seed** gives an existing token **+4/+4** (gilded +8/+8).
- **Solburn** (rules v2) **Collapses** the token: 3 unique random friendly Celestials each gain the rounded-up
  half (the Devotee itself is eligible; gilded → each hit gains the full stats); a token with no Celestial at all
  still collapses and the stats go nowhere; no token → nothing happens. Its old Consume is now the token's **buy**.
  **Fuse Aldrin** is a **passive**: while it stands, every Collapse hits **2 additional** random friendly Celestials
  (4 gilded; two Heralds → 4), drawn with replacement. Its text prints the static "2" (owner: "table for now").
- **Lodestar** gives a friendly Celestial its **MAX stats**: current Attack + undamaged max Health (a 10/10 damaged
  to 10/5 then buffed +5/+5 hands over 15/15). Both phases.
- **Twinning** (was Twin Star; Tier 5) mirrors every gain path (a buff, a shop buff, the token's consumes, a Star Crash aimed at the token,
  a slot enchant landing on a roll) — and, when it is the left-most Celestial, receives the token's buy itself.
  **Zenith** rebuilds the token after a **consume or collapse** (the buy, a Demon eating it, a Devotee's Collapse,
  Herald-assisted or not) — never after the Star Destroyer's silent exit — with half its stats rounded up, at the
  fresh 6-Gold price; a full row eats its right-most minion as any create does.
- **Constellation Prime** — "your Star Crashes cast an additional time" means the **PRIMARY** +5/+7 lands one extra
  time on the chosen Celestial per Prime (two per gilded Prime); the secondary random-friendly half fires **once per
  cast**. A Comet / Nimbus-multiplied cast re-lands the primary on every repeat. Applies to a Star Crash aimed at the
  Starform too.
- **Star Crash may be aimed at the Starform** (a friendly Celestial): the token gains +5/+7 (Twin Star hears it) and
  the secondary half still lands on a random friendly minion on the **board**. Only the tribe's own Celestial-aimed
  spell reaches the token — a plain `friendly` spell keeps its board-only aim (rule 5 stays whole).
- **Roundabout** (Tier 5, 7/5; 2026-09-18): **End of Turn: create a Starform and give it +10/+10** (gilded +20/+20).
  With no token out it creates one first (into a full row → it eats the right-most minion); with one already out
  the create is the usual no-op and only the +10/+10 lands. (Until 2026-09-18 it created at Start of Turn and had
  the token eat the whole row at End of Turn.)
- **Crash Course** (2026-09-18): the **first Star Crash you cast on it each turn casts an additional time** on it —
  Mirrorwing's shape (a FULL re-cast, scaled by the cast multiplier) gated to the named spell; gilded 2 additional.
  (Until 2026-09-18 it spread the cast to 2 other Celestials instead.)
- **Sugarnova** (2026-09-18, 4/2): **Shout: give your next Shop spell +4/+4** (gilded +8/+8). The bonus is a run
  field: it **survives End Turn → combat → the next shop** if unspent, every Shop spell offer / hand spell prints
  it live in place, and exactly the next Shop-spell cast consumes it (Gifts and Rubies neither read nor spend it).
- **Maestro Lux** Discovers a Celestial from the run's pool — never itself, and never the Starform (a token, outside
  every draw pool).

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

**Set scoping (`sets`) is MECHANICAL COMPATIBILITY, not set of origin.** A rune with no `sets` is offered in
every set; a scoped rune is offered only where its mechanics exist. Since the **Set 3 rune roster handoff
(2026-09-14)** set 3 draws **115 Basic / 97 Epic** from carryovers: the 85 + 64 unscoped baseline plus 63
carryovers (30 Basic + 33 Epic) from sets 1/2 — the Ruby, Ale, Dwarf, Kobold, Undead and Shop-consume packages —
each of which KEPT its original scope (set 1 = 105/90 and set 2 = 135/126 are unchanged). (98 Epic at the
handoff; Rune of Frontline Glory was dropped from set 3 by the owner on 2026-09-16 and is a set-1 rune again.) Attachment, Mech, Fodder and
absent-tribe packages stay off set 3. Rune of the Night Market and Rune of Baal are deliberate off-tribe
bridges (a rune-exclusive body that supplies its own function). The rolled-tribe gate still applies on top:
a "your Dwarves" rune reaches a set-3 run only when Dwarf rolled.

**Set 3-original runes (batch 2, 2026-09-16).** Set 3 now also has runes of its own — `sets: ['set3']` alone,
no origin scope — starting with tranche A's 24 Spirit / Celestial / Undead runes (11 Basic + 13 Epic, taking the
set-3 static pool to **126 Basic / 111 Epic**), plus the rune-exclusive **Handy Flame** token. The two combat-side
runes of that sheet shipped in tranche D: **Rune of the Open Hand** (Epic 5 — when you summon a minion from your
hand, another random friendly minion gains its current stats; every landed hand-summon, both phases) and **Rune of
the Waking Reserve** (Epic 6 — Start of Combat: a copy of your highest-stat hand minion when the board has room;
the hand card is NOT marked, so a Spirit may still summon it later that fight; it IS a hand-summon for Dreamed
Graves / the Open Hand). Neither is tribe-gated: the text names no tribe (the 2026-09-10 rule). The tribe
faucets (Rune of Basic/Epic Spirits, Celestials, Undead) are capped at the shop tier by the engine, like the
Dwarf/Kobold ones. See `docs/devlog/2026-09-16-set3-runes-tranche-a.md` and `…-tranche-d.md` for the rulings and
interpretations. **Rune of the Traveling Festival**'s "+2/+2 more" is applied ONCE per Reveler trigger (owner
2026-09-16: *"the 2/2 is 1 time"*) — a second copy pays its Reveler drip again but never raises the extra.

**Set 3-original runes (batch 2, 2026-09-16).** On top of the carryovers, set 3 now draws its OWN runes, scoped
`sets: ['set3']` alone: tranche B ships 8 Basic + 11 Epic Starform / Equipment / Undead runes (see
`docs/devlog/2026-09-16-set3-runes-tranche-b.md` for where each fires). Two engine facts they rest on: a
**grafted Echo** (`grantedEffects` — Contract Rewrite, Rune of Rebirth, Rune of the Last Tool) fires on a SHOP
death exactly as it does in combat; and a Starform rune is gated on Celestials (the token IS Celestial content),
the way an Imp rune is gated on Demons.

**Set forks.** A card a rune grants BY ID resolves to the pinned set's fork when one exists
(`SET_FORKS` in `packages/content/src/sets.ts`). The map is EMPTY today: its one entry, the set-3 Yazzus fork,
went when the owner ruled there is **one Yazzus** (2026-09-16) — `yazzus` (Tier 7, 4/8, "your targeted spells
cast an additional time": Shop spells, Rubies, Tower Shields and Clues alike) is the same card in every set that
carries him, and the retired `n3_yazzus` id still resolves to it for saved runs and replays (`LEGACY_CARD_IDS`).
The Open Market's "first Shop consume each turn" hears the Starform's consumes (they ride the one Shop-consume
chokepoint).

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

### "A card buffed in hand keeps the buff" — permanent, every phase (owner rule 2026-09-09, R-HAND-02)

*"cards buffed in hand are always permanent. so if something buffs a card in hand during combat, that card in
hand retains the buff. the buff also needs to show in real time like all of our other effects do."*

A stat buff that lands on a card **in your hand** is **permanent**, whichever phase granted it:

- **In the shop** it is an ordinary recruit buff (a Ruby-strength rise growing the Rubies you hold, a
  rune's "your Dwarves +2/+2" reaching the Dwarves in hand).
- **In combat** a hand card an effect buffs keeps the buff into the next shop and for the rest of the run —
  there is no "for this combat" scope on a hand card, because a hand card is never in the fight.
- **It shows as it happens.** The replay grows the hand card on the beat the buff fires, the same way a
  board buff moves stats on the body as it lands; settle then makes it the card's own.

**How it is enforced.** Combat reaches the hand through one verb (`ctx.buffHand`), which logs a `handBuff`
event and carries `playerHandBuffs` back for settle to apply with `addBuff`. Both phases share the arena body
(`buffHandTribe`), so a hand-buffing effect cannot be permanent in one phase and temporary in the other.
Pinned by `handBuffInCombat.test.ts` and the replay helper's test.

---

### "When a friendly minion Rises" — both phases, permanent in the shop (owner rule 2026-09-09, R-RISE-03)

*"if minions rise in shop, that would trigger rising tide and that buff would be permanent since it's in
recruit. this will be a common trigger/effect in set 3."*

A **Rise** — a body with the keyword returning after it dies — is an event its watchers (Revenant, Rising Tide)
hear **wherever it happens**:

- **In combat**, when the body returns to the line. A watcher's board grant is a normal combat gain; a hand
  grant is permanent (R-HAND-02).
- **In the shop**, when a destroyed body returns (Cage Breaker, the Deathfibrillator, any destroy — R-RISE-02).
  Everything a watcher grants there is **permanent**: the stats and any keyword (Revenant's Ward).
- **Friendly only.** An enemy body Rising is not your Rise; your watchers stay quiet.

**How it is enforced.** One trigger, `onRise`, from the single Rise site of each phase (`bus.emit` in
`simulate.ts`, `fireOnRise` off the shop's `riseReturn`), with the risen body in the payload. Pinned in
`set3Undead.test.ts` for both phases and for the enemy case.

### Echo first, THEN the Rise attempts — every Rise/Echo interaction, both phases (owner ruling 2026-09-18)

*"When I used Deathfibrillator on a minion with 7 bodies on board, it gives the minion Rise and kills it, but
then that minion rises BEFORE its Echo triggers. This is wrong. The Echo should trigger from the death of the
minion, THEN the minion attempts to rise. This is true for ALL Rise/Echo interactions."*

A minion with **Rise** (or **Rebirth**) that dies resolves in this order, in **combat and in the shop** alike:

1. the minion **dies** — it leaves its slot (a real death: Avenge, tallies, on-death watchers, kill credit);
2. its **Echo fires** (and every on-death watcher, in the existing order) — an Echo that summons lands its
   bodies **in the freed slot**, where the minion died;
3. **THEN** the minion **attempts** to return — to the right of what its Echo summoned. If the board is full
   by then (the Echo's summons took the room), the return **finds no room**: it counts as an **overflow**
   (Squatimus / Flowing Monk / Rune of the Crowded Crypt pay off) and the body stays dead. Its Rise is spent.

So on a full board a **Warden Rodrick** dies, his Spear Warden takes his slot, and Rodrick does not come back.
A Rise minion whose Echo summons nothing (Sergeant) still rises on a full board — the slot its death freed is
still free. This **reverses the 2026-09-09 ruling** under which a rising body held its slot through its Echo
(so the Echo's summon overflowed and the body returned) — that read as "the minion rose before its Echo".

**How it is enforced.** Combat: `killOrReborn` in `simulate.ts` holds no slot reservation (the `occupied` room
check is the living count); the Echo's summons place first, then the return is gated on `living < 7`. Shop:
`settlePendingDeath` / `destroyMinionInShop` in `recruit.ts` mark EVERY dying body `vacatingUid` (the summon
path discounts it), then `riseReturn` / `rebirthReturn` gate on the board cap. Pinned in
`core/src/combat/simulate.test.ts`, `core/src/combat/rebirth.test.ts`, `sim/src/set3Undead.test.ts` and
`sim/src/shopDestroy.test.ts`. Rule **R-RISE-05** in the registry records the supersession.

### Rebirth — a NEW keyword, distinct from Rise (owner ruling 2026-09-16)

**Rebirth** (`RB`): when the minion dies it returns **once with its FULL current body** — stats (Health refilled
to its max), granted buffs, keywords, effects and every per-instance counter. *"A Warded 50/50 dies and comes
back a Warded 50/50."* **Rise**, by contrast, returns the **printed** body at 1 Health. Not the Rise → Rebirth
rename (that stays reserved); a second keyword beside it. Granted by **Rune of Rebirth** (Basic 3, changed: Start
of Combat — a random friendly minion gains Rebirth) and **Rune of Dreamed Graves** (Epic 4: the first minion
summoned from your hand each combat gains Rebirth).

**Rebirth acts like Rise** (owner 2026-09-16: *"it acts like rise, so copy that"*). Its combat rules are
Rise's rules, step for step, with ONE intended difference — nothing is rebuilt from the printed card (`killOrReborn`
in `simulate.ts`, mirrored by `rebirthReturn` in the shop; pinned in `core/src/combat/rebirth.test.ts`, including
a Rise-vs-Rebirth parity fixture whose flow of deaths, returns and Avenge payouts must be identical):

- **The Echo fires on the Rebirth death** exactly as on a Rise death: die → Echo → the body returns to the
  RIGHT of what its Echo summoned. The death is a **real death** (Avenge, the death tallies, on-death watchers,
  kill credit) and is flagged like a Rise death for the replay (`death { rise: true }`).
- **A Ward the body carried at any point this combat is restored** on the return (in practice a Warded body
  has lost its Ward by the time it dies — the owner's example wants it back). Taunt, Flurry and every other
  keyword come back with the body. Rebirth itself is **spent**; nothing re-arms it unless something re-grants
  it.
- **Its Avenge progress restarts** on the return, as a Rise's does (*"1/3 should reset to 0/3"*) and as any
  body placed mid-combat: the deaths tally is side-level state, not part of the body it keeps.
- **A body that dies to retaliation on its own swing and returns is next to attack again** — the Rise rewind
  in the attack rotation applies to a Rebirth return too.
- **NOT a Rise:** the Rise watchers (Revenant, Rising Tide — `onRise`) stay quiet, and Rune of the Deathtouched
  Apple (a Rise re-arm) does not touch it — those two are Rise's own.
- **It IS a summon in full** (the owner's Rise ruling 2026-08-12): the summon-entry suite runs on the return.
- **A full board at the return = an overflow**; the body stays dead (the Rise rule). The body holds NO slot
  while it is dead: its Echo fires first and takes the freed room, and only then is the return attempted (see
  "Echo first, then the Rise" above).
- **A body holding BOTH keywords: Rebirth resolves first.** Rise has no precedence rule of its own (it is one
  keyword), so the stronger return goes first and the buffs are not thrown away; its Rise stays armed, so its
  NEXT death Rises the printed body.
- **In the shop** (a destroy, Cage Breaker, the Deathfibrillator) the same body returns — buffs, keywords
  (Rebirth spent), counters — with a fresh uid for the departure diff; Rise's `onRise` payout does not fire.
- **Snapshot fidelity:** a Rebirth granted mid-combat is a plain `keyword` event, folded into the SoC board like
  any keyword grant.
- **Presentation:** the return reuses the Rise beat and FX (`reborn { rebirth: true }`; the Card's Rise dome and
  the `rise` glyph) as PLACEHOLDERS until the owner authors a Rebirth cue.

---

### A named-spell caster prints the spell, not its value (owner rule 2026-09-09, R-TEXT-01)

A minion whose effect **casts a named spell** — Watcher, Wick Mortis, Anubis — reads "cast
**Lantern of Souls**." and stops. The spell is the minion's associated card, previewed on hover with its live,
spell-power-aware value, the way a Ruby is previewed from the Kobolds that cast it. The caster never restates
the number.

### An Aura-affecting spell is permanent from any phase (owner rule 2026-09-09, R-AURA-02)

Lantern of Souls raises the **Undead Aura** for the rest of the run whether it is cast in the shop or in
combat (a Rally, an Avenge, an Echo). Combat casts carry the gain back at settle. There is no combat-only Aura.

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
