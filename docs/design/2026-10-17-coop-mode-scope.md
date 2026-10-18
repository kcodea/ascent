# EXPEDITION (working name was Kinbound): a two-player co-op PvE adventure for ASCENT

*Design scope, final. 2026-10-17. Design only: no code is written or implied by this document.*

## How this was made

- **Research first.** A study of Slay the Spire (map, intents, elites, boss relics, rest sites, potions, curses,
  Ascension) and its co-op descendants (StS2, Together in Spire), plus Battlegrounds Duos and TFT Double Up, and a
  digest of ASCENT's own systems.
- **Three rival drafts.** Three full scopes were written independently from the same brief.
- **A blind critic loop.** A critic who did not know which draft was which judged them, picked a winner and listed its
  weaknesses. The winner was revised **three times**, taking the best ideas from the losing drafts each round.
- **This final pass** applies the last critique's clear fixes: fewer terms, a cheaper Rescue, a tighter Bond meter, a
  Fallen rule that can't be farmed, a brake on snowballing, and the rule slips it found (see "Final pass changes").

## Executive summary (12 lines)

1. **Kinbound** is a two-player co-op PvE adventure built on ASCENT's own Shop, cards, keywords, heroes and runes.
2. Every step on a Slay the Spire style map is one normal ASCENT turn: shop, lock, then the node resolves.
3. Each player owns a full build: hero, a new **Role** (Guard, Blade, Weaver, Keeper), Shop, board and runes.
4. The road, the bosses, a small **Bond** meter and the run's fate are shared.
5. Three acts of 5, 5 and 4 steps end in multi-phase bosses that show their next move, with exact numbers.
6. Most fights are **Twin Fronts**: one front each, and both wins fill one boss bar.
7. When one front wins and the other loses, the winner's survivors cross over and **Rescue** the partner.
8. Rare **Relays** make one player open and the other close; each Act 3 boss ends in one **Joined Front** board.
9. Co-op runs through narrow channels: send cards and Gold, cast on your ally's minions, take a boss's aim.
10. Runes are the relics (a row of 6), plus new Boss runes with drawbacks your partner covers, and Duets.
11. A Fallen player keeps shopping and holds a **Vigil** that guards the partner until a Revive brings them back.
12. MVP: one act, two Roles, one boss, played offline with a bot, then by real pairs, before any server work.

## Final pass changes (critique of revision 3, and the fix)

| # | Problem | Fix in this final pass |
|---|---|---|
| 1 | Complexity creep: 27 terms, a Relay possible on the first boss. | **23 real terms.** Cut: Swap, Stagger, the Way Back, Paired runes (moved to "later"), Furl (now "Remove a tribe"). The Relay is gone from Act 1: Ironbell is Twin Fronts only. The first Relay is the Long Patrol in Act 2, with a coach line. |
| 2 | A won Rescue was over-rewarded. | A won Rescue now **halves the loss and strikes small** (crossers' tiers, up to **a third** of the act cap) and gives +1 Bond. It is **not** a Double Win, pays no Purse, and does not earn a Champion rune. Rune of the Rescuer is cut. Rune of the Crossing is smaller. A "sacrificial board" test is added (15.12). |
| 3 | Bond filled in Act 1. | **Max 8. Gains are smaller** (most +1, max 1 send-Bond a turn). **Revive costs 5.** A generous pair earns 3 to 5 an act, so one Revive is roughly one act of giving. |
| 4 | The Way Back was farmable. | **Cut.** Only a **won Vigil** lowers the Revive (by 1, to a minimum of 2). No self-Return. Dread 13 is now the harsh rule: no Vigil at all. |
| 5 | Snowball with no brake; exams skippable. | **Caps lowered** to about 1.5x the median win (14 / 24 / 34). Stagger and the fifth Boss rune are cut. **Every boss's signature fires in the first round of its phase**, so no pair skips the exam. The Joined Front's 7th slot goes to the board that dealt **less** last round. |
| 6 | Rule slips. | Debt is now an ordinary Hex intent. The Hexlamp's Tending is not a Hex (same budget). Companions count as Tier 1. Shield and Spear names its target in the Joined Front. The Pale Choir's flip is in-leg only and carries by the normal rule. |
| 7 | Lingering risks. | **The Closer's call:** between Relay legs the Closer gets 8 seconds to reorder. The bot bar is tied to recorded human boards. Act 3 data risk gets a plan. The pool constant is fixed before Phase 1. Pacing is checked per act. |

**Grafted from the rival drafts:** Sworn Pair (lock order matters), Hand Off (board-to-board transfer), the catch-up
7th slot, free twin swaps before the first lock, Champion twists for Keeper Rise and Rescue arrival, the Blind Seer
ping moment, and the per-act pacing check.

> **The rule of this scope: build on ASCENT, then add a thin adventure layer.** The Shop, the economy, the tiers, the
> keywords, the tribes, the heroes, the runes, the spells, Equipment, Discover, Choose One and Gilding are used as
> they are. On top sit a map, authored encounters, bosses with intents, a narrow co-op channel and a small set of new
> cards and runes. Sections say what they **REUSE**, **EXTEND** and add **NEW**. The Gauntlet mode is not used or
> referenced anywhere.
>
> Player-facing strings (in quotes, on cards) follow the text rules: short plain sentences, no em dashes, never
> "Oath" or "climb". Numbers are first pass, but every encounter number is anchored to a stated reference (9.5):
> **an encounter met on turn N is tuned against recorded lobby boards from wave N**, which the snapshot pool holds.

## Contents

1. Pitch and working name
2. Pillars
3. Core loop and why it suits two players
4. Run structure: acts, map, nodes, length, pacing
5. Solo vs co-op balance
6. Player identity: hero, Role, companion, starter kit
7. The build loop: economy, rewards, Gilding, removal, junk, how builds emerge
8. Co-op mechanics in depth
9. Encounters: intents, Skirmishes, Champions, 11 bosses and the Crown
10. Relics (runes), Boss runes, ally runes, Duets, Tonics, junk, 11 events
11. Content list: 48 cards and abilities across four Roles
12. Difficulty (Dread), losing and learning, vocabulary, when a player falls
13. Two narrated example runs
14. Exciting moments catalogue
15. Architecture mapping onto ASCENT
16. MVP vs full vision, sizes, art
17. Open questions for the owner

---

## 1. Pitch and working name

**Working name: EXPEDITION (working name was Kinbound).** (Alternates: *Two Lanterns*, *The Underway*, *Shared Road*.)

> Two heroes. One road. Each of you builds your own warband in your own Shop. Pass each other what you need. Break
> the boss at the end of every act together. If one of you falls, keep the watch until the other brings you back.

Kinbound is an ASCENT match with Slay the Spire's run wrapped around it, for exactly two people.

- **Every step on the map is one ASCENT turn.** Gold, Shop, play, lock. Then the node happens: a fight, a Hearth, a
  Bazaar, a Runeforge, a Chest, an event. The Shop is unchanged. A player who knows ASCENT knows 90% of Kinbound.
- **The opponent is authored.** Packs built from real ASCENT cards, Champions that test one build over two rounds,
  and bosses that **show their next move while you shop**. The Shop becomes your answer to a question the boss asked
  out loud.
- **The partner changes everything.** You shop at the same time on one clock. You can send a card, cast a spell onto
  their minion from across the table, give their left-most minion Ward at Start of Combat. When your fight is won and
  theirs is lost, **your survivors cross over and Rescue them**. Some bosses make you fight in order: one of you
  **opens**, the other **closes** what is left.
- **The arc is Slay the Spire's.** Three acts on a visible branching map, the act boss shown from the first step,
  rewards that are 1 of 3 or skip, Boss runes with real drawbacks, a Hearth that asks "heal, upgrade, or help", and a
  Dread ladder the pair works through together. A first win opens the Crown, a fourth act.

The north-star moment: the ribbon reads "Breach Cannon fires this round. Aimed at Mike." Kevin drags the aim onto his
own portrait (the boss is angry and its Hound gains +4/+4), casts Shared Shield on Mike's carry, and Mike buys the
Taunt he would never buy alone. The cannon hits Kevin's Ward wall, and Kevin still wins. Mike's front falls with one
Hound left, and Kevin's three survivors cross over, finish it and hit the boss for 7 on the way out. Mike takes half.
The bar breaks. Nobody said what to do. They pinged, they pointed, and they each made their own Shop work for the pair.

---

## 2. Pillars

1. **It is still ASCENT.** Same Shop, same Gold curve, same tiers, keywords, tribes and cards. The adventure frames
   the match and never replaces it. A new card is data on an existing trigger unless it is about the partner or the
   boss; then it is a small, named primitive.
2. **Your board is yours. The road is shared.** Each player owns a full build: hero, Role, Shop, board, hand, runes,
   Purse. Shared: the map, the bosses, the Bond meter, the Trail and the run's fate. One merged board appears only at
   an act's climax (the Joined Front), and each player chose what to bring.
3. **Every board fights every round.** No format leaves a board out, living or Fallen. If your fight ends early, your
   survivors can go help. If you are Fallen, you hold the Vigil. In a Relay the Closer fights second and makes the
   Closer's call between legs.
4. **The boss asks, the Shop answers.** Every boss and Champion shows its next move with exact numbers. Scouting is
   total. A new phase always starts on the next round, so every phase gets a Shop to answer it. **Every boss's
   signature fires in the first round of its phase**, so no build skips the exam. Deaths trace to choices.
5. **A bigger build kills faster, up to a ceiling.** Damage caps sit about 1.5x the median win. A strong pair can
   break a phase in one round and takes fewer Hits for it. Overkill pays nothing extra, so strong pairs don't
   compound.
6. **Narrow channels, and giving pays.** Sending is cheap but limited. Giving earns Bond, and Bond buys the pair's
   lifeline (Revive) and its best tools.
7. **Falling is the thing you fear, never the end of your agency.** One fallen player halves the pair's boss damage,
   costs rewards and runes, and must be bought back with most of an act's Bond. The Fallen player still fights to
   protect their partner and to make their Revive cheaper.
8. **Complementary, not parallel.** Roles, the shared pool and partner-aware bosses make "one of us walls, one of us
   kills" stronger than two copies of one plan.
9. **No one waits, and nothing is random between you.** Both Shops run on one clock. Every node is simultaneous, even
   when the road parts. Ties between the two of you are settled by the Trail, never a coin.
10. **One evening, snappy at all times.** A full run is 45 to 55 minutes; the Crown adds a quarter of an hour. One
    arena on screen at a time, partner info as thin DOM strips, no new looping paint animations. Kinbound is held to
    the 160 fps bar.

---

## 3. Core loop and why it suits two players

### 3.1 Three nested loops

**The turn (30 to 90 seconds; solo, with your partner in your ear).** Start of Turn as in ASCENT: Gold refills,
Whispers arrive, Equipment rebuilds. Then the normal Shop: buy, sell, reroll, freeze, tier up, play, hero power,
Equipment. Three things are new on screen: the **intent ribbon** above the enemy portrait (what the coming fight does,
in numbers), the **ally strip** under your hero (your partner's seven minions as small read-only tiles, their Gold and
lock state), and the **Bond** counter between the two Health slots, with the **Trail** pill on one portrait. End Turn
locks, exactly as in Versus.

**The node (the turn plus what it resolves into).** Skirmish, Champion, Boss round, Hearth, Bazaar, Runeforge,
Chest, Mystery. Fights resolve on the server from both locked sides. Service nodes resolve after the lock.

**The act (5 steps plus a boss).** Pick a route on a visible map with the act boss at the top. Spend Health for power
at Champions, buy it back at Hearths, arrive at the boss with a plan.

### 3.2 Why this shape fits co-op

- **ASCENT's Shop is already simultaneous and private.** Two people shop at once with zero waiting, which removes the
  biggest co-op killer for free. Versus already proves the plumbing.
- **Auto-combat frees attention for the partner.** The fight plays itself, so both players can watch. A Rescue or a
  Relay hand-off is a moment both screens show.
- **Scouting is ASCENT's version of intents.** StS intents turn hidden information into a plan. Here you see the
  enemy board and its next move while you shop, and two players can split the answer ("I bring Ward, you bring
  Cleave", "I open and kill the Blades, you close with Execute").
- **Battlegrounds Duos and TFT Double Up found the genre's co-op levers**: separate boards, a narrow pass channel, a
  board that jumps in to help, a partner who fights next. Kinbound takes those and adds the StS frame (map, intents,
  relics, rest choices, phased bosses) that neither has.
- **StS2 and Together in Spire made the same call this scope does:** each player keeps a complete solo build, and the
  co-op comes from shared fights, shared routing and a small layer of ally-targeting effects.

---

## 4. Run structure

### 4.1 Overview

The economy is ASCENT's: Gold starts at 3 and rises by 1 per turn to 10, tier-up costs and the per-turn discount are
the lobby's. So an act's position on the map is also its position on ASCENT's curve.

| Part | Steps | Boss rounds (typical) | ASCENT turns | What the curve looks like | Real time (typical) |
|---|---|---|---|---|---|
| Act 1: The Hollows | 5 | 4 (2 for a strong pair) | 1 to 10 | Tier 1 to 4, boards forming | 10 to 12 min |
| Act 2: The Gilt Deep | 5 (incl. a 2-row Parting) | 4 (2 to 3 strong) | 11 to 20 | Tier 5 to 6, scaling must start | 14 to 17 min |
| Act 3: The Unlit Spire | 4 (incl. a 2-row Parting) | 6 (3 to 4 strong) | 21 to 30 | Tier 6, full builds | 18 to 21 min |
| Between acts | | | | Boss rewards, Role upgrade, Duet | 3 to 4 min |
| **Run total** | **14** | **~14** | **~30** | | **45 to 55 min** |
| The Crown (opt-in, after a first win) | 1 (Last Camp) | 6 | 31 to 37 | Tier 6, runes and Gilds | +12 to 15 min |

A Champion takes one turn when the pair fells it in one round, two turns otherwise; the table counts 1.5. A typical
loss lands in Act 2 at 20 to 30 minutes. A run is one sitting. A pair that loses connection rejoins through the Versus
reconnect flow (15.7).

**Why about 30 turns.** Lobby games run to roughly 20 rounds, with boards recorded through the high 20s. A 30-turn
road keeps Acts 1 and 2 inside the recorded, balanced range and puts only Act 3 a little past it. That is the honest
risk. The plan for it: measure recorded waves 24 to 28 before Act 3 is written (15.12); where data is thin, tune
against the bot driver's boards at those turns; once Phase 1 ships, **Kinbound records its own boards** and Act 3 is
retuned on those. Strong pairs end faster (pillar 5). The Crown runs further past the data on purpose: it is the
optional hard ending.

### 4.2 The map (NEW system, built from existing UI)

- A DAG of **4 lanes and 5 rows** per act (4 rows in Act 3), generated from the run seed. Lanes cross and merge. The
  whole act is visible on arrival. The **act boss sits at the top** with portrait, name and a one-line exam ("It
  punishes boards that can't burst.").
- **Anchors:** row 1 is always a Skirmish. The middle row always offers a Chest on at least one lane. The last row is
  always a Hearth. No Champion in row 1. Every lane meets a **Runeforge** in Act 1 (Basic) and in Act 2 (Epic), so
  every player gets at least the lobby's two forges.
- **Partings:** Act 2 rows 2 and 3, and Act 3 rows 2 and 3, split the road (4.4).
- **Each act draws its boss from 3 to 5 candidates** (Act 1 three, Act 2 five, Act 3 three).
- **Presentation (no code-drawn props):** a full-screen panel on the existing Menu backdrop, a painted act
  background, node icons as the existing card-frame pills. **Default without connector lines:** nodes sit in clear
  rows, and hovering a node lights the nodes it leads to (opacity only). Plain UI connector lines in the existing rail
  style are an optional later layer (question 17.5).

### 4.3 Node types

| Node | What happens | REUSES | NEW |
|---|---|---|---|
| **Skirmish** | Two enemy packs, one per player. One pack has a skull pip: harder, pays more. Each fights their own pack. A winner can Rescue a loser. | authored boards (Practice-bot pattern), `simulate`, lobby damage formula | pack pick, Rescue |
| **Champion** | An elite over **up to 2 rounds** on one shared bar. Felled: each player who won a round of it takes a rune pick; both take Purse and a reward at tier + 1. After round 1 the pair may Withdraw. After round 2 an unfelled Champion flees. | Runeforge offer logic, rune pool, boss bar | shared Champion bar, Withdraw |
| **Hearth** | Choose one: **Rest** (heal 8), **Tend** (heal your ally 12), **Gild** a board minion, **Engrave** a minion, or **Revive** your Fallen ally (5 Bond, 1 less per Vigil they won, minimum 2). | Gilding, Engraved | Hearth menu |
| **Bazaar** | Spend Purse: runes, Tonics, Role cards, Equipment, **Remove** a card from your Shop, **Remove a tribe**, remove a Hex Scar. | Runeforge offer, Equipment defs, pool | Purse, Remove |
| **Runeforge** | An ordinary forge visit: 4 offers, buy one for Gold, the run's one free re-roll. Act 2 forges are Epic. | the Runeforge, verbatim | placement only |
| **Chest** | 3 items shown to both. The player without the Trail picks first, then the other. The last item becomes 1 Bond. | Discover modal, Equipment, Tonics | the shared pick |
| **Mystery** | An event 65%, a Skirmish 15%, a Bazaar 10%, a Chest 10%. Odds shift toward what you haven't seen (StS pity). | Choose One modal | events |
| **Parting** | The road splits for 2 rows. Each player walks a different row, **at the same time, alone**. | all node types | Parting |
| **Boss** | Several rounds against one boss with phase bars, intents and a format per phase. | lobby damage formula, Armor, enemy `CombatSideState` | phases, intents, formats |

**Every node is one turn** (a two-round Champion is two). Gold and the tier discount keep moving on quiet nodes. On a
Hearth you shop, lock, then rest.

### 4.4 Partings (the solo stretch)

At a Parting each player drags their portrait onto one of two rows, one Champion-heavy and one service-heavy (for
example, "Champion, then Runeforge" and "Bazaar, then event"). Both rows have 2 steps, so the pair finishes together.
Fights on a Parting are **one pack, alone, with no Rescue**. A Champion on a Parting is fought alone on a **half-size
bar**. This is where each player proves their own build. When the rows rejoin, each player's board and new runes flash
on the ally strip (a one-shot pulse).

If both pick the same row, the Trail holder keeps it and the other is moved, with a 3-second window to swap back.

### 4.5 Pacing per act

**Act 1, The Hollows (find a direction).** Rows 1 and 2 draw easy packs (tier 1 and 2 cards). Then packs with one
gimmick each (a Taunt wall, an Echo swarm, a Ward line). Champions check early power. The boss tests one basic thing
(can you burst, can you go wide, can you control damage). **Act 1 uses only Twin Fronts and Rescue**, so a first
run learns those before anything else.

**Act 2, The Gilt Deep (scale or fall).** Packs bring Avenge, Pummel and Rise. Champions punish an archetype (spells,
a lone carry, low Health). One, the Long Patrol, is the first **Relay** a pair meets, with a coach line the first
time. The Parting happens. Bosses use Hexes within budget; the Hexlamp
makes a Hex its whole fight. Each player picked a **Role upgrade** after Boss 1. Most runs that die, die here.

**Act 3, The Unlit Spire (prove the build is complete).** Packs are tier-6 boards with rune flags. Each boss punishes
one dominant plan and ends in a **Joined Front**. The pair picked a **Duet** after Boss 2.

**Inside an act:** easy, harder, a Chest, a Champion or Hearth choice, a Hearth last, the boss. The StS sawtooth, one
ASCENT turn per tooth.

### 4.6 Pacing model and valves

| Part | Avg Shop | Avg fight | Overhead | Per turn | Turns | Minutes |
|---|---|---|---|---|---|---|
| Act 1 | 35 s | 20 s | 12 s | ~67 s | 10 | ~11 |
| Act 2 | 55 s | 30 s | 15 s | ~100 s | 10 | ~16 |
| Act 3 | 65 s | 35 s | 18 s | ~118 s | 10 | ~20 |
| Between acts | | | | | | ~3 |
| **Run** | | | | | **30** | **~50** |

Shop time is the standard ASCENT clock (`standardTurnSeconds`), so early turns are short. Slow pairs who use the full
clock and rewatch fights land near 60 minutes; strong pairs who break bosses early land near 42.

**Valves:**
1. **Both locked, turn over.** As in Versus.
2. **Quiet turns.** On a node with no fight (Hearth, Bazaar, Chest, Runeforge, most events) the Shop clock is 70% of
   standard.
3. **Fast fights.** Skirmish fights play at 1.5x by default. A Rescue against one enemy minion is skipped to its result
   with a one-line beat.
4. **Haste valve.** In a Relay, the second leg is skipped when nothing is left for the Closer to fight (8.7 C).
5. **Fewer steps late.** Act 3 has 4 steps. The run gets shorter per act exactly where turns get longer.
6. **Bigger builds finish sooner.** Caps above the median mean a strong pair takes 2 boss rounds where a median pair
   takes 4.

The pace is checked two ways (15.12): total run length, and **median turns per act within 1 of the target**.

---

## 5. Solo vs co-op balance

### 5.1 The timeline of one step

| Moment | Solo or together | Seconds | What matters |
|---|---|---|---|
| Map vote | **Together** | up to 8 | Both tap a node. Agreement goes at once. A split vote goes to the Trail holder. |
| Pack, front or Relay pick | **Together** | during the Shop | Drag your portrait onto a pack, a front, or the Open or Close slot. **Lock-commit rule:** until the first of you locks, both move freely and can swap at no cost. After that, the locked pick is fixed and the other player takes what is left. |
| Start of Turn | solo | 0 | Intent ribbon updates. |
| Shopping | **Solo, with a channel open** | 18 to 75 | Your Shop and board. Sends, Send Gold, ally-targeted spells and pings are the channel. |
| Lock | solo | 0 | Irreversible, as in Versus. Once your ally locks, their board can't be targeted. |
| Fight | **Every board fights; watched together** | 15 to 45 | Each watches their own fight with the partner pip ("4 vs 2") on the partner portrait. Then any Rescue or Relay hand-off plays on both screens. |
| Rewards | **Solo** | 5 to 10 | Your reward pick, your rune pick. Chests and Boss runes are drafted between you. |
| Service nodes | **Solo, except Tend and Revive** | 5 | Hearth choice, Bazaar purchases. |
| Events | **Mixed** | 10 to 20 | Each event has one joint choice or two personal ones (10.9). |

### 5.2 Exactly when you are alone, and why it matters

1. **Every Shop phase.** Your Gold, rolls, triples, tier-ups. Your partner sees your board but can never click your
   Shop.
2. **Your own fight.** In a Skirmish, a Champion or most boss rounds you fight your own front with your own board.
   Your loss costs your Health.
3. **Your leg of a Relay.** The Opener's leg is the Opener's alone; the Closer inherits whatever it left, and makes
   the Closer's call (8 seconds to reorder) before their leg.
4. **Your rewards.** Reward picks, rune picks, your Role upgrade, your Boss rune (from a shared draft).
5. **Partings.** Two rows per act in Acts 2 and 3 where you walk alone and fight alone, with no Rescue.
6. **Your Hearth action.** Rest yourself, Gild, Engrave, or spend it on your ally.
7. **Your Vigil, if you fall.** Your board alone holds your front.

### 5.3 Exactly when you are together, and why it matters

1. **Boss rounds.** Both boards fight the same boss. Damage from both wins goes into one phase bar. Intents aim at one
   player or split the boss in two. A Rescue softens a loss and strikes the boss.
2. **Champions.** One shared bar over up to two rounds. A Champion felled by the pair pays both players.
3. **Relays.** Order is the decision: who opens, who closes, and what the Opener must strip so the Closer can finish.
4. **Path, packs, fronts.** Short joint decisions, each with a timeout that resolves to a sensible default (the Trail).
5. **The channel.** Sends, Send Gold, ally spells, ally Start of Combat, Batons, Tend, Revive, taking an aim, and
   lock order (Sworn Pair reads who locked first).
6. **Drafts.** Chests and Boss runes are picked between you.
7. **The Duet** after Boss 2 and the **Joined Front** at the end of each Act 3 boss (and the Crown).
8. **Chores.** The Hexlamp gives one of you the cleaning and the other the building, then swaps.

A rough split of a run's attention: about 70% on your own Shop and fight, 20% on the channel, 10% on joint decisions.
That matches the StS2 lesson: personal turns, shared stakes.

### 5.4 Anti-alpha rules (so one player can't play for both)

- **No control of the partner's Shop, ever.** You can Peek (hold Tab: the spectator view of their screen) but never
  click it.
- **One clock for both.** A player who coaches for 40 seconds has 40 fewer seconds to shop.
- **Private offers.** Your rewards, rune offers and Discovers stay hidden until you pick ("Kevin is choosing a rune").
- **Roles split the job**, so each player is the expert on their half.
- **The Trail rotates.** Route ties alternate between you every step, so neither player owns the map.
- **Bosses read both boards.** The Magpie Queen, Vel and the Tithe Collector punish a pair where one player carries and
  the other is a passenger.

---

## 6. Player identity

Identity in ASCENT is already **hero + board**. Kinbound keeps the hero and adds one layer, the **Role**, and one
companion (a Henchman). Three layers, two of them reused.

### 6.1 Hero (REUSED, filtered)

Hero Select works exactly as in Versus: 3 private heroes, one re-roll, 20 seconds. Kinbound uses an **allow-list of
about 18 heroes** whose powers make sense against PvE: Warden, Indy, Auctioneer, Soren, Nadja, Lord of the Risen,
Disco Dan, Brackus, Xerox, Underdweller (Soulkeeper reads "either side", so it Discovers dead enemy minions), Rayse,
Gorun, Robin, Darah, Kindness, Midas, Tradesman, Membrance (its "last opponent's board" becomes the last encounter).
Heroes that read lobby placement or other seats are hidden by a per-mode filter on the hero list (the `poolOf`
pattern).

**Ally clauses (EXTEND).** Four heroes gain one Kinbound-only clause (same `HeroPowerKind`, one new param):

| Hero | Power | Ally clause |
|---|---|---|
| Warden | Aegis | "You may target your ally's minion." |
| Auctioneer | Pulse | "You may trigger your ally's minion's Shout. It happens on their board." |
| Kindness | Gifts | "You may send a Gift to your ally. It doesn't use a send." |
| Xerox | Copy Machine | "You may copy your ally's minion. The copy is yours." |

### 6.2 Tribes and the pool (REUSED, one stated change)

A Kinbound run plays the pinned set's **5 tribes plus neutrals**, exactly like a lobby run. Both players draw from
**one shared pool at twice the lobby's copy counts** (`POOL_QUANTITIES` x2, a mode constant).

**Why twice, and what it does.** An ASCENT run's pool has one buyer: the live player. Two buyers on the normal counts
would drain copies twice as fast, which is a real change to triple odds. With twice the copies:
- **A pair that splits tribes** depletes its own cards at about the rate a solo lobby player does. Per-Shop odds for
  the cards you chase match ASCENT's.
- **A pair that overlaps** (both on Kobolds) drains those copies twice as fast. That is the intended co-op texture:
  "You take Beasts, I'll stay out" is a plan the pair makes on turn 2.
- **Sends move copies, not totals.** A sent card is still out of the pool; it returns only when sold.
- **Measured, not assumed:** triple rate per player against a solo lobby run at the same turn (15.12 point 3).

**Role cards never enter the Shop row.** They live outside the pool and arrive through rewards, Chests and Bazaars
(7.3). The Shop row, its slot count and its draw odds are the lobby's. Two priced Bazaar services shape your own odds
(7.5).

### 6.3 Roles (NEW layer, built from existing keywords)

A Role is Kinbound's character class, picked after Hero Select (15 seconds). At Dread 0 to 4 the two players must pick
different Roles. A Role gives:

1. a **Role rune** (an ordinary rune def on an existing reward kind, plus one ally clause),
2. a **companion** (an archived Henchman, revived),
3. a **trait** (one mode rule),
4. **10 Role cards** offered in your rewards, Chests and Bazaars (section 11),
5. a **Role upgrade** choice after the Act 1 boss (6.5).

| Role | Job | Keyword family | Role rune | Companion | Trait |
|---|---|---|---|---|---|
| **Guard** | Protector. Walls and Ward. Takes hits for the pair. | Taunt, Ward, Resilient Ward | **Rune of the Guard**: "Start of Combat: give your left-most minion Ward. Also give your ally's left-most minion Ward." | **Ott the Shieldbearer** 1/4 Taunt | **Stand Firm**: "Once per boss, you may take an aim from your ally without angering the boss." |
| **Blade** | Carry. One huge threat or a cleaving line. | Cleave, Flurry, Execute, Pummel, Slaughter | **Rune of the Blade**: "Your minions with Cleave, Flurry or Execute have +2 Attack." | **Rook Ashblade** 2/1 | **Finisher**: "In a Rescue, or when you close a Relay, your minions have +1 Attack for each enemy minion in that fight. (Now +3.)" |
| **Weaver** | Enabler. Spells and Whispers, gives to the partner. | Shop spells, Whispers, Rubies, spell power | **Rune of the Weave**: "Your first spell each turn also casts on your ally's left-most minion." | **Sabe the Inkling** 1/2 | **Light Load**: "You get 3 sends a turn, all free." |
| **Keeper** | Undying and wide. The reviver. | Echo, Rise, Rebirth, Avenge, Overflow | **Rune of the Keeper**: "The first friendly minion to die each combat Rises." | **Wisp of Isola** 1/1 | **Ferryman**: "When you Revive your ally, it costs 1 less Bond. They return at 15 Health, not 10." |

**Finisher** is real-time: the count is read inside the one fight it applies to, and its live value updates as enemy
minions die (the pill on each Blade minion counts down).

**Companions, reconciled with the Henchmen rules.** A companion is a Henchman with Kinbound settings: it starts in
your hand, free (its one recruit for the run, so the once-per-run rule holds), cost decay is off, it never enters the
pool, and if it is sold it returns to your hand at the next Hearth (once per act). Each grows at Hearths.
**A companion counts as Tier 1** wherever a tier is read: board damage, the Rescue strike, tier-based card text.

**How two players become complementary:**

- **Guard + Blade:** wall and blade. Guard takes the aims and opens Relays; Blade closes and finishes Rescues. The
  textbook pair.
- **Weaver + Blade:** enabler and carry. Weaver pours spells into one big minion. Vel and the Magpie Queen punish
  this pair, so it must keep a second threat.
- **Keeper + Guard:** attrition. Nothing stays dead, nothing gets through. Low boss damage, so Enrage is its clock,
  and it needs the Hexlamp's chores split well.
- **Weaver + Keeper:** engine pair. Fragile in Act 1, huge in Act 3.
- **Blade + Blade (Dread 5+):** two carries, no wall. Fast, glorious, often dead to the Breach Cannon.

### 6.4 Starter kit

Each player starts with 30 Health plus their hero's Armor (the live per-hero numbers), 3 Gold, an empty board, and in
hand their companion (free to play) and one **Role starter spell**:

- Guard: **Shared Shield** (1 Gold): "Give a minion Ward. Then give one of your ally's minions Ward."
- Blade: **Whetstone** (1 Gold): "Give a minion +3 Attack and Execute until the end of next combat."
- Weaver: **Twin Ember** (1 Gold): "Give a minion +2/+2. Give one of your ally's minions +2/+2."
- Keeper: **Grave Lantern** (1 Gold): "Next combat: the first friendly minion to die returns as a 2/2 Lantern Wisp."

The kit is deliberately small, like StS's Strikes and Defends. The run is what you make of it.

### 6.5 Role upgrade (EXTENDS the Ancients pairing pattern)

Ancients prove the pattern: a milestone opens a Discover, and the pick changes a power for the run. After the Act 1
boss each player picks **1 of 2 upgrades** to their Role rune (StS's Burning Blood to Black Blood).

| Role | Upgrade A | Upgrade B |
|---|---|---|
| Guard | **Bastion**: "Your Role rune gives Resilient Ward instead of Ward." | **Phalanx**: "Your Taunt minions have +3/+3. In a Rescue, your Taunt minions cross first." |
| Blade | **Executioner**: "The first minion your left-most minion damages each combat is destroyed." | **Whirlwind**: "Your left-most minion has Cleave. If it already has Cleave, it gains Flurry." |
| Weaver | **Loom**: "Your spells have +1/+1 spell power. Your ally's spells too." | **Echo Thread**: "Your first spell each turn casts on your ally's left-most minion twice." |
| Keeper | **Ferry**: "Your Rise minions return with full stats (Rebirth)." | **Haunt**: "The first 2 of your minions to die each combat gain Baton: a 1 Health copy of it joins your ally's next fight." |

Each upgrade is data pointing at an existing primitive (spell power, Rebirth, a Cleave grant, a Resilient Ward grant)
or at Baton (8.5). Haunt is a Baton grant on dying minions, so it obeys the Baton rule exactly: it fires on that
minion's death and lands in the ally's next fight that has not started.

---

## 7. The build loop

### 7.1 What is unchanged

**REUSED verbatim:** Gold start 3, +1 per turn, cap 10; minion 3, sell 1, reroll 1; tier costs and the per-turn
discount; Shop row widths; board 7, hand 10; triples and Gilded with Triple Rewards; the Shop spell slot; Freeze;
Discover, Choose One, Whispers, Equipment, Starform (if the set has it), Rubies; all live card text. Tier 7 appears
only through existing grants (Brackus, Disco Dan) and one Boss rune (Rune of the Summit, 10.2).

**What Kinbound adds to the build:** Role cards through rewards, rewards after won fights, more runes than a lobby
game (forges plus Champions plus Boss runes, capped by a **rune row of 6**, plus one shared Duet), Hearth Gilds and
Engraves, and Tonics. Encounter numbers carry an uplift for this extra power (9.5), measured, not assumed.

### 7.2 Purse (NEW saved currency, earned only on the road)

ASCENT Gold vanishes at the end of each turn, which is right for the Shop. The adventure needs StS's "save for the
merchant", so it adds **Purse**, a second currency that **only the road pays**:

- Skirmish win 3 (skull pack 5), Champion felled 4 to 5, boss victory 10, skipping a reward 2, some events.
- **Unspent Gold never becomes Purse.** The Shop's spend-it-now tension is untouched.
- Purse caps at 30. It is spent at Bazaars and in some events. It shows as a small counter beside Gold (the Gold pill
  component).

### 7.3 Rewards (EXTENDS Discover; StS card rewards)

After every **won** fight (Skirmish, Champion felled, boss victory), the winner gets a **reward: pick 1 of 3, or skip
for 2 Purse.** A loss gives nothing, even if a Rescue softened it. Rewards use the Discover modal.

| Slot | Content |
|---|---|
| 1 | A minion from the pool at your shop tier (skull packs, Champions, boss victory: tier + 1) |
| 2 | A Role card of your Role, at or below your shop tier |
| 3 | A Shop spell, a Tonic, or 3 Purse (Tonic 40%, +10% per miss, StS potion odds) |

**Give it away:** pick "For my ally" and your pick goes straight to their hand (if they have room) without using a
send. +1 Bond. A Role card given away keeps its Role text and works for anyone. Boss rounds don't give a reward each
round; the boss victory gives one at tier + 1 with a guaranteed Gilded option.

### 7.4 Upgrades: Gild and Engrave (REUSES the Gild primitive and Engraved)

StS's Smith is ASCENT's Gild. At a Hearth, **Gild** turns one board minion into its Gilded version in place (the
primitive Indy, Auric Runemaster and Masterwork use). An in-place Gild gives no Triple Reward. Tripling the normal way
still does. The minion's tier must be at most your shop tier.

**Engrave** gives a minion **Engraved** (combat stat gains carry back). It is StS's "upgrade the scaling card":
Engrave your Slaughter or Rally minion and it grows for the run.

The Hearth is a real dilemma: Rest (Health now), Tend (more Health, for your partner), Gild (power now), Engrave
(power later), Revive (your partner's life).

### 7.5 Removal and thinning (EXTENDS the pool filter)

- **Remove** (Bazaar, 4 Purse, +2 for each further Remove this run): one minion card stops appearing in **your** Shop.
  Its copies stay in the pool for your ally. Your rerolls hit everything else more often.
- **Remove a tribe** (Bazaar, 10 Purse, once per run): one tribe stops appearing in your Shop. Your ally still sees it.
  This is the strongest thinning in the mode and the one most likely to need tuning, so it costs a third of a full
  Purse and is offered at most once per act.
- **Selling** stays the in-Shop thinning, as in ASCENT.

Both are per-player filters on the Shop draw, the same kind of filter `poolOf` already applies per mode.

### 7.6 Junk (StS Curses and Statuses, built on Fodder and the Starform pattern)

Four junk cards, all from boss intents, Champions or events. Each is a named card with self-contained text:

| Junk | Where it lives | Text |
|---|---|---|
| **Husk** | Your Shop (pinned right, Starform pattern) | "Buy it for 1 to clear it. In hand it is a 0/3 Fodder." Demons can Consume it. |
| **Cinder** | Your Shop (pinned right) | "Buy it for 1 to put it out. If it is still here at End of Turn, you take 1 damage." |
| **Rust Coin** | Your hand | "Can't be played. Start of Turn: lose 1 Gold. Sell it for 0 to drop it." |
| **Hex Scar** | Your rune row | "Your first reroll each turn costs 2." Removed at a Bazaar for 6 Purse. It doesn't count toward the rune row's 6. |

### 7.7 How builds emerge

1. **Act 1 on raw value.** A normal ASCENT opening against weak packs.
2. **A commitment point in Act 1.** The first Champion rune, the first triple, the first skull pack. The pair often
   commits after one says "I've got Taunt covered, go greedy".
3. **The Role upgrade after Boss 1** hardens your half.
4. **A Boss rune after each boss** bends the build around a drawback your partner can often cover.
5. **The rune row fills.** By Act 3 most players hold 6 runes and start trading one for a better one. Which 2 you
   bring to the Joined Front is a late, sharp choice.
6. **The Duet after Boss 2** is a pair commitment ("Guard plus Blade, we go Shield and Spear").
7. **No tutoring.** You can't search for a card. Removing a card or a tribe shapes odds but never picks.

---

## 8. Co-op mechanics in depth

### 8.1 What is shared and what is split

| Thing | Shared or split | Note |
|---|---|---|
| Map, route, act boss | Shared | Vote; a split goes to the Trail holder. |
| The Trail | Shared token | Passes every step (8.12). |
| Health and Armor | **Split** | Each keeps their own. Your lost front hurts you. |
| Boss and Champion bars | **Shared** | Both boards' wins and Rescues go into one bar. |
| Bond | **Shared** | One meter, max 8. |
| Run fate | Shared | The run ends when both are Fallen. |
| Gold, Purse, Shop, board, hand, runes | Split | Sends, Send Gold and ally effects move value across. |
| The pool | Shared (x2 copies) | Contention is real when you overlap. |
| Rewards, Role upgrade | Split | Rewards can be given. |
| Chests, Boss runes | Drafted | One pick each; the player without the Trail picks first. |
| Duet | Shared | One pick for the pair. |

### 8.2 Sending cards (the Battlegrounds Duos portal, on ASCENT's hand)

- **Drag a card from your hand onto your ally's portrait to send it.** It lands **in their hand at once** (with the
  normal "card to hand" beat). If their hand is full, the send is refused.
- **Cost:** your **first send each turn is free; the second costs 1 Gold.** Weavers send 3 a turn, all free.
- **What can be sent:** minions, Shop spells, Rubies, Tonics, Gifts. Whispers can't (they fade by rule). Junk can't.
- **Triples cross the table.** A sent minion counts toward the receiver's triple. "I'll send you my Wolvie, you have
  two" is the most common co-op beat in the mode.
- **Pool rule:** a sent card returns to the pool only when sold.
- **Bond:** when your ally plays a card you sent, the pair gains 1 Bond (max 1 a turn for the pair).
- **No sends after your ally locks.** Their board and hand are frozen for the fight.

### 8.3 Send Gold, and trading

- Click the coin on the ally strip to send **1 Gold for 1 Gold**, at most **2 a turn**, before your ally locks. It
  arrives at once and must be spent this turn like any Gold.
- The cost is opportunity: a Gold you send is a Gold you didn't spend. Sending is right when your partner is one Gold
  from a tier-up, a triple or a key buy, and you are not.
- **Trading:** there is no market. "I'll pay you for your Wolvie" is: Mike sends 2 Gold, Kevin sends the Wolvie (free,
  first send). Fair, and it earns a Bond when Mike plays it.
- **Selling to the pair:** a card you send instead of selling costs you the 1 Gold sell value. That is the honest
  price of a gift, and it is small on purpose.
- **Rune trade (Bazaar):** give one of your runes to your ally for 10 Purse (paid by the giver). Their row must have
  room.

### 8.4 The ally target scope (NEW primitive; the heart of the co-op cards)

Any targeted spell, Shout or hero power that says "one of your ally's minions" (or "you may target your ally's
minion") can be dropped on a tile of the **ally strip**. It resolves on your ally's board, and they see the buff land
with the normal buff FX.

**Timing rules (the whole list):**
1. **Your ally hasn't locked:** it applies at once, as a recruit-phase effect. Stats are permanent (owner rule:
   recruit buffs are permanent).
2. **Your ally has locked:** the ally strip greys out and the drop is refused ("Mike has locked."). Nothing is spent.
   The exception is effects that fire on their own at **your** End of Turn or at Start of Combat (Thread Sprite,
   Aegis Sister): the server applies those when both have locked, before any fight starts, so they always land and
   are in the fight.
3. **The target left the board in the same instant** (sold, consumed, merged into a triple): the effect fizzles and
   **refunds** you (the card returns to your hand, the Gold returns).
4. **Counters:** spell counters count for the caster (you cast it). "After a minion gains stats" watchers fire on the
   receiver's side.
5. **Untargeted ally effects** ("your ally's left-most minion") pick at the moment they apply.

Because a fight only resolves after both players lock, and a locked board refuses ally effects, the server never has
to decide which effects "made" a fight. A buff changes stats, never layout, so a minion your ally is dragging can
receive it with no wait.

### 8.5 The cross-fight rule, ally Start of Combat, and the Baton (NEW)

**The cross-fight rule (one sentence, no exceptions).** *Nothing reaches into a fight that is already running.* An
effect aimed at your ally lands:
- **at once**, if your ally is in the Shop, or in the **same fight** as the source (a Rescue leg, the Closer's leg of a
  Relay when the source is the Closer's own board, the Joined Front);
- otherwise **in your ally's next fight that has not started**.

Nothing waits for a fight to end, so no Kinbound effect resolves at settle. This keeps the owner's real-time rule: an
effect happens the moment it fires, in the first place it can exist. Twin Fronts run as two separate simulations, so
a front can't touch the other front mid-fight; that is physics, stated once, and every card text follows it.

**Ally Start of Combat.** Cards like Aegis Sister say "Start of Combat: give your ally's 2 left-most minions Ward."
The server compiles these, when both have locked, into banked Start-of-Combat casts on the ally's side (the existing
banked-cast path), owned by the caster for text and FX ("Aegis Sister (Kevin)" in Mike's log).

**Baton (NEW keyword, strictly a death trigger).** "Baton: when this dies, your ally's next fight gets X."
- **Where it lands:** in your ally's **next fight that has not started yet**. In Twin Fronts both fights start
  together, so a Baton lands in your ally's **Rescue** of your front if one happens this round, otherwise in their
  next round's fight. In a Relay, an Opener's Baton lands in the Closer's leg.
- The neat result: when your board loses and your partner Rescues you, **your dying minions hand their Batons to the
  rescuers**. When you open a Relay and fall, your dying minions arm the Closer.
- **Live text always says where it will land:** "Lands: Mike's Rescue" during a fight, "Lands: Mike's leg" in a Relay,
  "Lands: next fight" in the Shop, and greyed "No fight for Mike" on a Parting row.
- Batons are compiled by the server into banked casts on the receiving leg. Nothing inside `simulate` reaches another
  fight.
- **Other "next fight" effects** (Rallying Standard, Mourning Bell, Shield and Spear) are not Batons. They use the same
  landing rule, and their text says "your ally's next fight".

### 8.6 Bond (NEW shared meter)

One meter for the pair, **max 8**, shown between the two Health slots (the Resolve slot style).

| Gain | Bond |
|---|---|
| Your ally plays a card you sent (max 1 a turn for the pair) | +1 |
| Give your reward pick to your ally | +1 |
| A Rescue wins | +1 |
| A Relay's Closer wins after the Opener lost | +1 |
| Tend at a Hearth | +1 |
| A Chest's leftover | +1 |

| Spend | Bond |
|---|---|
| **Revive** your Fallen ally at a Hearth (plus your Hearth action) | 5, minus 1 for each Vigil they won while Fallen, minus 1 if you are a Keeper. **Never less than 2.** |
| **Steady**: take an aim this round without angering the boss | 2 |
| Re-roll a Boss rune draft | 2 |

**The budget.** A generous pair earns **3 to 5 Bond an act**. So a Revive is about one act of giving, a Steady is half
an act, and the meter is never full for long. Tuning target (15.12): Bond reaches the cap in fewer than 1 run in 5.

### 8.7 Fight formats: how two players fight one enemy

All formats are compositions of the same `simulate()` call. There are **four**, and every boss names its format per
phase.

**One continuation rule for every format.** A board that carries on into another leg (crossing survivors, enemy
survivors, a Relay's Main wave) keeps its current stats and its used flags (Ward gone, Rise spent, Execute dropped,
Pummel meters). **A minion that already fought this round doesn't fire Start of Combat again; a fresh minion does.**
**The arriving board attacks first.** The rule is per minion and per side, never per "player", so sides stay
symmetric.

**A. Twin Fronts (Skirmishes, Champions, most boss rounds).** The enemy fields two fronts, one per player. Two
`simulate` calls, one per front. Each won front damages the boss (or the Champion bar). Each lost front hurts its
player.

**B. Rescue (the cross-over, inside Twin Fronts).** If one player won and the other lost, **the winner's survivors
cross over** and fight what is left of the lost fight, in a third `simulate`.
- **"Rescue:" is a trigger word** (like Shout or Echo). Crossing minions fire their Rescue effects on arrival. Batons
  from the lost board land here.
- **If the Rescue wins:**
  - the lost player takes **half** the damage (rounded down) and gets no reward;
  - the crossing survivors **strike**: the boss (or Champion) bar takes the **tiers of the surviving crossers**
    (companions count as Tier 1), up to **a third of the act cap** (Act 1 4, Act 2 8, Act 3 11). No shop tier is
    added, so a Rescue always strikes for much less than a win;
  - the pair gains 1 Bond. "Rescued!" plays on both screens.
- **What a Rescue is not.** It is not a won front: it doesn't count as a Double Win (only two won fronts do), pays no
  Purse, and doesn't count as a won round for the rescued player (so it doesn't earn them a Champion rune).
- **If the Rescue loses:** the lost player takes full damage.
- **Why it is priced this low.** A lost front must always cost more than a won one. The test in 15.12 point 9 checks
  that "one strong board plus one sacrificial board" never beats two honest boards.
- **The rescuer risks nothing permanent.** Crossing minions are combat copies, but Slaughter, Pummel and Engraved gains
  they make in the Rescue carry back, so carries like to Rescue.
- A Rescue never chains. On a Parting there is no Rescue.

**C. Relay (a rare format: the Long Patrol Champion in Act 2, the Pale Choir phase 2 in Act 3, and one event).
Never in Act 1.** The enemy fields one board in two parts: the **Main wave** (up to 7) and a **Reserve** (listed on the
ribbon, 2 to 5 minions).
- **Order.** During the Shop each player drags their portrait onto **Open** or **Close** (lock-commit rule). If nobody
  picks, the Trail holder opens.
- **Leg 1:** the Opener's board fights the Main wave.
- **The Closer's call (8 seconds).** When leg 1 ends, the Closer sees exactly what is left and may **reorder their
  board** before leg 2 (drag, as in the Shop; no buying, no casting). If they do nothing, the locked order stands. It
  is the only input after a lock in the mode, and it gives the Closer a real decision during leg 1: plan the order.
- **Leg 2:** the Closer's board fights the **Reserve plus every Main wave survivor**. Survivors carry on under the
  continuation rule; the Reserve and the Closer are fresh.
- **One tally for both legs.** Enemy counters and thresholds (Sergeant Vask's count, the Pale Choir's Hymn) count across
  both legs. The Opener's damage is damage the Closer doesn't have to deal.
- **Results.** Each leg won deals its board's damage to the bar. A lost leg takes its player the front's Hit. If the
  Opener lost and the Closer wins, the Opener takes half (as in a Rescue) and the pair gains 1 Bond. Both legs won is a
  Double Win.
- **Haste valve:** if leg 1 ends with no Main wave survivors and the Reserve is empty (some Relays have no Reserve in
  a later round), leg 2 is skipped and the Closer counts as winning with their board's full damage.
- No Rescue inside a Relay: the Closer's leg already finishes what the Opener left.
- **Why it is here:** it is the one format that only exists with two players and is about **sequencing**. The Opener
  wants to strip Wards and thin the wave; the Closer wants burst and Execute. Rune of the Opener and Rune of the
  Closer (10.3) reward taking the job.

**D. Joined Front (each Act 3 boss's last phase, and the Crown's last phase).** One merged board.
- During the Shop a **Joined row** of 7 slots appears above the board (the board slot component). **Each player brings
  up to 3 minions** by dragging board minions up. **The 7th slot goes to the player whose board dealt less boss damage
  last round** (a tie: the player without the Trail), shown on the slot. It is a catch-up rule: the weaker half of the
  pair gets the extra voice. A Fallen player may bring 2; the living player then brings 5.
- **Runes: each player also brings 2 runes** by dragging them from their rune row to the Joined row's banner. The
  joined side's rune flags are those 4 runes plus the Duet. A rune both bring counts once. (Taking both full rows would put 12
  or more runes on one board.)
- **Side values:** the joined side takes **the higher of each value** across the two players: spell power, Ruby
  strength, each tribe Aura (Undead Aura, Imp Aura) separately. Hand spells that cast in combat come from both hands.
- Minions are combat-only copies with every baked stat, keyword and granted effect intact. A small owner pip on each
  says whose it is. Engraved and permanent gains carry back to the owner.
- Minions and runes not brought sit out. Choosing what to bring is the decision.
- **Damage to the boss:** the higher of the two shop tiers plus the tiers of surviving minions, up to the Joined cap
  (40). **If the joined board loses, each player takes half the Hit**, rounded up.
- No alternation, so the board doesn't swing round to round.

**Damage and Hit.** A won board damages the enemy for **its shop tier + the tiers of its surviving minions**, the lobby
formula players already know, up to a per-board cap by act (9.5). The caps sit about 1.5x the median win, so a
bigger build hits harder, up to a ceiling. A lost board takes the front's printed **Hit** (bosses and Champions) or
the lobby formula with an act cap (Skirmishes). Armor absorbs first, as everywhere.

**Double Win** (used by a few bosses): both fronts won, or both Relay legs won. Never a Rescue.

### 8.8 Aims, the Hunt, and the boss's anger

- **Aimed intents** name a player: the **Hunt** ("It hunts Kevin. If Kevin loses, he takes double.") and boss cannons
  and curses. The ribbon shows the aim from the Shop before.
- **Taking an aim.** During the Shop either player may drag the aim pip onto the other portrait or their own. **Each
  time an aim moves, the boss is angry: the aimed front's left-most minion gains +4/+4 this fight** ("It is angry it
  missed you.").
- **Steady** (2 Bond) or the Guard's **Stand Firm** (once per boss): move the aim with no anger.
- **Hunter's Mark** (Tonic): take the Hunt with no anger.
- In a Relay, a Hunt names a leg's player as usual. In the Joined Front there is no aim: both take half.

Taking a hit for your partner is always possible and always costs something.

### 8.9 Duets (NEW, built on runes; Hades duo boons for two)

After the Act 2 boss, the pair is offered **3 Duets** that match their two Roles. Both tap one. If the taps differ
after 10 seconds, the Trail holder's tap stands. A Duet is a run-long rune both players own; it doesn't take a rune
row slot, and it always comes to the Joined Front.

| Duet | For | Text |
|---|---|---|
| **Shield and Spear** | Guard + Blade | "Whenever your Ward breaks, your ally's left-most minion gains +2 Attack this combat. If your ally is in another fight, it lands in their next fight. In the Joined Front: the left-most minion your ally brought." |
| **Ink and Iron** | Weaver + Blade | "Once per turn, a spell you cast on your ally's minion also gives it Cleave until the end of next combat." |
| **Lantern and Wall** | Keeper + Guard | "Your Rise minions return with Taunt. Your ally's too." |
| **The Long Song** | Weaver + Keeper | "Once per combat: when a friendly minion Rises, give it the stats of the last spell your ally cast. (Now +2/+2.)" |
| **Twin Fang** | Blade + Blade | "Slaughter effects trigger twice. Rescue: your crossing minions gain Flurry." |
| **Open and Shut** | any, both have met a Relay | "In a Relay, the Opener's minions have Cleave and the Closer's minions have +3 Attack." |
| **Kindred Fire** | any, both have 3+ Dragons | "Your Shouts on Dragons also fire on your ally's left-most Dragon." |
| **Kindred Hunt** | any, both have 3+ Beasts | "When your Beast's Echo triggers, your ally's left-most Beast gains +2/+2 permanently. If your ally is in another fight, it lands in their next fight." |
| **Kindred Hoard** | any, both have 3+ Kobolds | "Your Rubies on your ally's Kobolds give +1/+1 more. You share Ruby strength: the higher counts for both." |

### 8.10 Saving a teammate

- **Before the fight:** take the aim, send Ward or Taunt, Shared Shield on their carry, Aegis Sister, Hunter's Mark,
  take the front that suits your board before the first lock.
- **In the fight:** the **Rescue** (half damage and a small strike) or **closing** a Relay they opened.
- **At the Hearth:** **Tend** heals your ally 12 (Rest heals you only 8). Generosity is the efficient choice.
- **When they fall:** **Revive** them at the next Hearth (your Hearth action and 5 Bond, 1 less for each Vigil they
  won, never less than 2; they return at 10, or 15 with a Keeper partner). A **boss victory** returns them at 10. A
  **Phoenix Ember** Tonic (rare, Bazaar 12 Purse) returns them at 8 at once. The **Old Hearth** event can too (12.6).

### 8.11 Shared resources, on purpose few

The pool, the boss and Champion bars, the Bond meter, the Trail, the Duet, the run's fate. Everything
else is personal and moves only through narrow channels.

### 8.12 Voting on the path, and the Trail

- **The Trail** is a small lantern pill on one player's portrait (an existing pill). It starts with the host and
  **passes to the other player after every step**.
- **Map vote:** both tap a node (8 seconds). Each tap shows as that player's portrait chip pinned to the node.
  Agreement goes at once. **A split goes to the Trail holder.** A node both tapped gets a static glow.
- **Drafts** (Chests, Boss runes): the player **without** the Trail picks first. So the player who decides the next
  step pays for it with the second pick, and both rotate every step.
- **Other ties** use the Trail the same way: Parting rows, Duet taps, Relay order by default, a tie for the Joined
  row's 7th slot (to the player without it), Champion Withdraw (a split vote stays).
- No coin flips between players anywhere in the mode, and nothing about Health decides order, so nothing can be gamed
  by spending Health.

### 8.13 Communication (REUSES emotes, the spectator stream, right-click)

- **Emotes** as in Versus: 4 equipped, right-click portrait. Cooldown 8 seconds in Kinbound.
- **Pings** (NEW, small): right-click any card, minion, ally tile, map node or intent icon. A radial of 4 lines on the
  emote-wheel UI, chosen by object type:
  - Shop card: "I want this", "For you", "Triple!", "Skip it".
  - Your minion: "Can send", "Carry", "Bringing this" (Joined Front), "Selling".
  - Enemy minion or intent: "Danger", "Kill first", "I'll take it", "Take the aim?".
  - Relay slot: "I'll open", "I'll close", "Strip the Ward", "Save the Execute".
  - Map node: "Heal here", "Champion?", "Shop", "Not this".
  A ping shows on the partner's screen as a short pill on that object for 3 seconds (3 second cooldown). Pings travel
  on the match channel next to `EmoteMessage`.
- **Peek:** hold Tab to see your ally's whole screen, read-only, through the spectator stream (zero cost when nobody
  peeks). Your clock keeps running.
- **Ally strip:** always on. 7 small tiles with Attack and Health, a lock icon, their Gold and hand count. DOM text,
  memoized, a one-shot pulse when it changes. After a fight it shows a win or loss mark for their front.
- **Partner pip (during split fights):** a small pill on the partner's portrait reads live minion counts in their
  fight ("4 vs 2"), updated from the partner leg's event log at the same playback time. One DOM text node, no
  animation. It turns into "Won" or "Lost" when their fight ends, which is the cue that a Rescue is coming.

---

## 9. Encounters

### 9.1 How enemies are made (REUSES authored boards and the enemy side state)

Every enemy is an **authored board of real ASCENT cards and mode tokens**: the `AuthoredOmen` / Practice-bot pattern
with real `CardDef`s instead of anonymous omens. Because combat sides are symmetric, an encounter also carries a full
**enemy `CombatSideState`**: tier, tribe Auras (Imp Aura, Undead Aura), spell power, Ruby strength, hand spells it
casts in combat, and rune `questMods` flags (Rune of Fury, Rune of Twilight, Rune of Forthcoming). "The Champion has
Rune of Fury" is the same flag a player's rune sets. Nothing in `simulate` learns it is fighting PvE.

An encounter is `{ id, act, pool, format, fronts[ { board[], side{} } ], reserve?, hit, bar?, theme, counters[] }`. A
board is authored at a **baseline turn** and scaled to the turn it is met with the existing `statScalePerWave`-style
curve and the `BOT_LEVELS` utility swap. Stats printed in this document are at the act's baseline turn (Act 1 turn 5,
Act 2 turn 15, Act 3 turn 24).

**Scouting is total.** During the Shop the enemy portrait opens the existing lobby scouting panel with every minion,
keyword, the encounter's one-line exam, its intent and, for a Relay, the Reserve.

### 9.2 Intent vocabulary (exact numbers, one fight ahead)

Every Champion and boss front shows **one intent for the coming fight**, plus any Countdown. Intents come from an
authored cycle per boss and phase, picked by the seeded RNG with an anti-repeat rule (never the same intent three times
in a row), like StS move tables. Each icon is always shown with its full sentence, so the icon names are labels, not
words a player must learn.

| Icon | Example sentence on the ribbon | Built from |
|---|---|---|
| **Hit** (fist, number) | "If this front beats you, you take 9." | printed number on the front |
| **Sharpen** (blade, number) | "Its left-most minion gains +8 Attack." | enemy banked Start-of-Combat cast (REUSE) |
| **Brace** (shield) | "Its minions gain Ward." (or Taunt, or +0/+X) | keyword grant or buff (REUSE) |
| **Brood** (egg, number) | "It starts with 2 more minions." | board template add (REUSE) |
| **Burn** (flame on a portrait) | "Start of Combat: you take 3. Win or lose." | NEW small Start-of-Combat hero damage |
| **Hex** (eye) | "Next Shop: Mike's first 2 rerolls cost 2." | Shop dial modifier (EXTEND) |
| **Hunt** (crosshair on a portrait) | "It hunts Kevin. If Kevin loses, he takes double." | team-state aim |
| **Countdown** (hourglass) | "Breach Cannon fires in round 4. Aimed at Mike." | counter on the boss state |

At Dread 10+ one intent each round is shown as "?" until both players lock.

### 9.3 The Hex budget (a Hex is a puzzle, not a lost turn)

Hex is ASCENT's own intent: a StS boss can't touch your deck, but an ASCENT boss can touch your Shop. It is the only
place Kinbound bends the Shop, so it is tightly bounded:

1. **Telegraphed a full Shop ahead.** "Next Shop: Tax on Mike" shows during the current Shop, so Mike can roll or tier
   up now.
2. **Never on both players in the same turn.**
3. **At most once per boss phase per player.**
4. **Budget: at most 2 Gold of value per player per turn** (3 at Dread 10+). A zod rule on the Hex defs enforces it.

These four rules bind **every** Hex, with no exceptions. The Hexlamp's **Tending** (boss 7) is not a Hex: it is that
boss's own fight, shown a Shop ahead like a Hex, and the same zod rule holds it to the same 2-Gold budget per player
per turn.

| Hex | Effect | Value |
|---|---|---|
| **Tax** | "Your first 2 rerolls cost 2 this turn." | 2 |
| **Seal** | "One Shop minion slot is sealed this turn." | 1 |
| **Husk** | "A Husk is pinned in your Shop." | 1 |
| **Spell Seal** | "Your spell slot is closed this turn." | 1 |
| **Short Fuse** | "Your Shop clock is 10 seconds shorter." | 1 |
| **Tariff** | "Minions of one tribe cost 4 this turn." (never your only tribe on board) | 2 |
| **Smolder** | "2 Cinders in your Shop." | 2 |
| **Rust** | "A Rust Coin goes into your hand." | 1 |

**Never allowed:** "you can't tier up", "all minions cost 4", discarding from hand, anything that removes a board
minion during the Shop.

### 9.4 Skirmishes (sample table)

A Skirmish has two packs. The **skull pack** is the same pack with stats one tier higher and one extra minion, and pays
5 Purse and a tier + 1 reward. Players pick packs by dragging portraits (lock-commit rule, 5.1). If nobody picks, the
Trail holder takes the skull pack.

| Encounter | Pool | Pack (at baseline) | Tests |
|---|---|---|---|
| **Gnawling Pack** | A1 easy | 4 Gnawlings 2/1, a Prospector | Basic tempo. |
| **Shieldwall Kobolds** | A1 easy | 3 Kobold Shields 1/3 Taunt, a Geode Guardian | Break Taunt without losing the race. |
| **Imp Circle** | A1 hard | Brood Matron, 4 Imps, side Imp Aura +1 | Cleave and AoE. |
| **Echo Den** | A1 hard | Wolvie, Echohorn, 3 Beast pups with "Echo: summon a 1/1" | Execute is wasted; wide AoE wins. |
| **Ward Line** | A1 hard | 4 Warded 2/2s, a 4/4 Ward Taunt | Ward breaking (Flurry, Cleave, many hits). |
| **Uneven Ground** | A1 hard | One pack is the Ward Line at +1 tier, the other is 3 Gnawlings | Teaches Rescue: the easy pack's winner crosses to help. |
| **Toll Dwarves** | A2 hard | Paymaster Pimm, Coinfire, 3 Dwarves +2 Attack, side spell power +1 | A scaling race. |
| **The Dragonflight** | A2 hard | Karwind, Mirrorwing, 3 Dragons; enemy hand: Dragonflame | Health pool and Ward. |
| **Bone Choir** | A2 hard | 5 Rise bodies, side Undead Aura +2 | Kill twice. Execute shines. |
| **Rust Raiders** | A2 hard | 4 Raiders 6/5 Flurry; loser's next Shop: Hex "Rust" | Win, or pay a Gold next turn. |
| **Runebound Patrol** | A3 | A tier-6 board with Rune of Fury and Rune of Forthcoming flags | Full builds. |
| **The Glass Garden** | A3 | 6 Glass Wards 8/12 Ward, side spell power +3 | Ward breaking at scale. |

### 9.5 The damage reference, caps, bars, overkill and Enrage

**Anchoring.** An encounter met on turn N is tuned against **recorded lobby boards from wave N**, then multiplied by an
**uplift** for the extra power Kinbound gives (Role cards, rewards, extra runes, Hearth Gilds): first guess Act 1 x1.10,
Act 2 x1.25, Act 3 x1.35. The bot driver measures both the boards and the uplift (15.12) before any tuning pass.

**The reference boards and the cap**

| Act | Boss turns | Reference board (wave median) | Median won-board damage | Per-board cap |
|---|---|---|---|---|
| 1 | 7 to 10 | tier 3 to 4, 6 to 7 minions, ~30 Attack / ~42 Health in total, best ~8/10 | ~9 | **14** |
| 2 | 17 to 20 | tier 5 to 6, 7 minions, ~95 / ~115, best ~25/25 | ~17 | **24** |
| 3 | 25 to 30 | tier 6, ~190 / ~230, best ~50/50 | ~24 | **34** (Joined 40) |
| Crown | 31 to 37 | strongest fifth of wave 24+ | ~26 | **34** (Joined 40) |

**The boss side**

| Act | Team damage per round | Phase bars | Typical rounds (strong pair) | Boss Hit | Enrage from |
|---|---|---|---|---|---|
| 1 | ~11 | 24 / 24 | 4 (2) | 6 | round 6 |
| 2 | ~20 | 44 / 44 | 4 (2 to 3) | 9 | round 6 |
| 3 | ~29, Joined ~20 | 64 / 64 / 44 (Joined) | 6 (3 to 4) | 12 | round 7 |
| Crown | ~31, Joined at most 25 | 70 / 70 / 50 (Joined) | 6 | 15 | round 7 |

"Team damage per round" assumes each board wins about 60% of the time and includes Rescue strikes (about +1 a round
in Act 1, +1.5 in Act 2, +2 in Act 3).

**Why caps at about 1.5x the median.** A board that answers the exam and scales well deals visibly more. Two strong
boards can clear a phase in one round (14 + 14 > 24, 24 + 24 > 44, 34 + 34 > 64). But **no single board can clear a
phase alone**, and nothing past the cap counts, so a strong pair is rewarded once (a fast, safe kill) and doesn't
compound.

**Front design target:** a reference board beats an on-curve boss front about 60% of the time; a board that answers the
exam about 80%; a board that ignores it about 35%.

**Phase bars (no hidden caps).** A boss shows one bar per phase, side by side. Bars are sized to about **two median
rounds**. A phase that empties ends the round, and **the next phase starts on the next round**, so every phase has a
Shop in which its first intent is shown and answered. Only the Crown's last phase has a per-round limit
(Invincible), printed on its card.

**Overkill.** Damage past a full bar is lost. A fast kill already pays in the way StS pays it: fewer rounds means
fewer Hits taken, and Enrage never arrives. A Champion felled in one round offers a slightly better rune pick (9.6).
Nothing else stacks on a fast kill, which is the brake on snowballing.

**Enrage.** "From round 6, its minions gain +5/+5 each round and its Hit doubles." (Act 3 and the Crown: round 7.)
There is no timeout loss. Enrage kills you through Health.

**Boss victory:** each player heals half their missing Health (Dread 6+: a quarter), a Fallen player returns at 10, the
pair drafts **Boss runes** (10.2), each player takes a reward at tier + 1 with a guaranteed Gilded option, and 10
Purse.

**A Fallen player's front.** If a player is Fallen, their front is still there, and their board holds it as a
**Vigil** (12.6). A **won** Vigil: the front deals nothing this round. A **lost** Vigil: the front deals **half its
Hit to the living player** (rounded down). A Vigil never damages the boss. So a fall halves the pair's damage and, on
a bad round, still bleeds the partner. Each won Vigil makes the Revive 1 Bond cheaper (12.6).

### 9.6 Champions (two-round elites on one shared bar)

A Champion is an elite fought in Twin Fronts (one in Relay) for **up to 2 rounds**. Each front faces a copy (or one
half) of it. It shows **one bar** (Act 1 16, Act 2 30, Act 3 44; half on a Parting). Both won fronts and any Rescue
strike fill the bar. A lost front takes the Champion's Hit (Act 1 5, Act 2 8, Act 3 10) each round; a Rescue halves
it. A new intent shows for round 2.

| Result | What it pays |
|---|---|
| **Felled in round 1** | Each player who won its round: a rune pick from **4** (Basic in Acts 1 and 2, Epic in Act 3). Both: 5 Purse and a reward at tier + 1. |
| **Felled in round 2** | Each player who won a round of it: a rune pick from 3. Both: 4 Purse and a reward at tier + 1. |
| **Withdraw after round 1** (both tap within 5 seconds; a split stays) | Each player who won a round keeps 3 Purse. No rune. |
| **It flees after round 2** | Each player who won a round gets 3 Purse and a normal reward. No rune. |

The bar is shared, so both players take the Purse and the reward when the pair fells it. **The rune goes only to a
player who won a round of it**; a Rescue doesn't count as a won round. A player who lost both rounds gets 3 more Purse
instead of the rune. This is StS's elite: a visible risk (two rounds of Hits), a shared payoff, and a way out.

| Champion | Act | Each front | Punishes | Two-player twist |
|---|---|---|---|---|
| **Grubb the Spellhater** | 1 | Grubb 6/14 and 2 guards 3/4. "Start of Combat: gain +2/+2 for each spell your opponent cast this turn. (Now +4/+4.)" | Spell-heavy turns | Each Grubb counts only the spells its own player cast. A Weaver who casts on the partner's minions grows their own Grubb and nobody else's. |
| **The Sleeping Vault** | 1 | Lagavault 0/30 Taunt, Immune. "Avenge (4): lose Immune and gain +12 Attack." 4 chaff 1/1, 2 Vault Mites 3/3. | Slow builds | Feed it exactly 4 deaths, then burst it. A Keeper's Rise bodies count twice toward its Avenge, so a Keeper wakes it fast. Round 2 starts it awake. |
| **Three Lanterns** | 1 | 3 Lantern Sentries 3/5. "Echo: the loser of this fight gets 2 Cinders next Shop." | Shop consistency | The Cinders land on whoever lost, so a Rescue doesn't save you from the chore. |
| **The Many-Handed** | 2 | Book of Knives 4/40, Flurry. "Rally: attacks one more time this combat." | Low Health, no Ward | A Guard's Ward wall is the textbook answer, and the Guard can send Ward across. |
| **Warchief Gob** | 2 | Gob 5/20 and 2 Goblins 3/3. "Rally: summon a 3/3 Goblin. Overflow: Goblins gain +2/+2." | Target priority | Cleave beats it. A Rescue that arrives into a full Goblin board triggers Overflow at once. |
| **The Glasswing** | 2 | Glasswing 12/12, Stealth, Execute. "Rally: regain Stealth." 2 Shards 4/6 Taunt. | A lone carry | Ward on the carry, or many small bodies. Keep survivors for the likely Rescue. |
| **The Long Patrol** (Relay) | 2 | Main wave: 5 Patrol Blades 6/6. Reserve: Sergeant Vask 12/30 Taunt, "Start of Combat: gain +3/+3 for each Main wave minion still alive. (Now +0/+0.)", and 2 Shieldmen 4/10 Taunt. | A weak opener | **The first Relay a pair meets** (coach line: "One of you opens. The other closes what is left."). The Opener's job is to kill Blades, not to win. Every Blade left alive grows Vask for the Closer. |
| **Countdown Colossus** | 3 | Colossus 0/80 Taunt. "Countdown 3: ticks when it is attacked. At 0: deal 30 damage split among enemy minions." 2 Gearguards 10/10. | Many small hits | Big hits, not many hits. A Rescue's arriving board meets it with its count already low. Its Countdown also carries into round 2. |
| **Flickerwraith** | 3 | Wraith 10/30. "Immune to every other attack it receives." 2 Wraithlings 4/4 Rise. Burn 3. | Single big hits | Flurry and Cleave beat it. The Blade's Whirlwind upgrade decides who takes which front. |

### 9.7 The bosses

Each act's boss comes from its pool: **Act 1 three, Act 2 five, Act 3 three**, plus the Crown. **TF** is Twin Fronts,
**R** a Relay, **JF** the Joined Front. Formats change by phase, so no boss is just "two fronts again". "Check" lines
state the design target against the reference board, to be confirmed by the bot driver. Every Countdown names the
round it fires in.

**The signature rule.** Each boss's signature mechanic (the split, the Close, Pilfer, the cannon, the Wicks, the Tick,
the copies, the Hymn) is live **in the first round of every phase**. A pair can shorten a phase, but never skip the
question the boss is built to ask.

---

#### Act 1, Boss 1. MOTHER HOLLOW (the burst check; StS Slime Boss)
*Exam: "It punishes boards that can't burst."* Bars 24 / 24. Hit 6. Enrage from round 6.

- **Phase 1, The Swell (TF, bar 24).** Both fronts face her: Mother Hollow 4/30 Taunt, "Start of Combat: gain +2/+4
  for each round this fight has lasted. (Now +2/+4.)" and 2 Hollowlings 2/3. Both boards' wins fill one bar.
- **The Split.** When the phase 1 bar empties, she splits into two **Halves**, one per front, next round. **The later
  she splits, the bigger they are**, and the ribbon shows it live:

  | She splits after round | Each Half |
  |---|---|
  | 1 | 4/12 Taunt |
  | 2 | 6/16 Taunt |
  | 3 | 9/24 Taunt |
  | 4 or later | 12/32 Taunt |

  Ribbon: "If she splits now: Halves are 6/16. Next round: 9/24."
- **Phase 2, The Halves (TF, bar 24).** Each front: one Half and 2 Hollowlings. Each Half has "Echo: summon two 2/2
  Hollowlings."
- **Intent cycle:** Brood 1 (a Hollowling on each front), Sharpen 3 (her or the Halves), Brace (+0/+6 on her), Hunt
  (alternating).
- **Check:** the reference board wins a phase 1 front about 60%. A median pair splits her after round 2 about half the
  time. Two strong boards (14 or more each) split her after round 1, and the Halves are 4/12.
- **The two-player read:** a pure burst check, readable at a glance. Both must win early, so the stronger player sends
  the weaker one a key piece on turn 6 instead of buying for themselves. Splitting her a round early makes phase 2 a
  rout.

#### Act 1, Boss 2. VASHKA, THE BROOD MOTHER
*Exam: "It punishes boards that can't hit wide."* Bars 24 / 24. Hit 6. Enrage from round 6.

- **Phase 1, The Brood (TF).** Front L: Brood Matron, 5 Imps 1/1, side Imp Aura +1. Front R: a Broodling 6/10 Taunt
  and 3 Imps, Imp Aura +1. Uneven on purpose: one wide, one tall. Players choose fronts.
- **Phase 2, The Mother (TF).** Vashka stands on **the Hunted player's front**: Vashka 8/24 Taunt, "Avenge (3): summon
  two 2/2 Imps. Each Imp that dies before her gives her +1/+1 this combat." and 2 Imps. The other front: a Broodling and
  4 Imps. Imp Aura +2 on both.
- **Intent cycle:** Brood 2 (two more Imps on a front), Sharpen 4 (the Broodling), Hunt (the Hunt also decides
  Vashka's front), Hex "Tax" on the player who is not Hunted.
- **Check:** the reference board beats the wide front about 55% and the tall front about 65%. A Cleave board beats the
  wide front about 85%.
- **The two-player read:** the AoE player takes the wide front in phase 1, and in phase 2 takes the Hunt on purpose
  (accepting the anger) so their Cleave meets Vashka.

#### Act 1, Boss 3. IRONBELL, THE WARDING ENGINE (the damage-control check)
*Exam: "It punishes damage you can't control."* Bars 24 / 24. Hit 6. Enrage from round 6.

- **Phase 1, The Bell (TF).** Each front: Ironbell 6/30 with Resilient Ward, a Bell Warden 2/6 Ward, a Clapper 4/4.
  **The Close:** "When Ironbell has taken 15 damage this combat, it Closes. Its minions gain Ward and Taunt. A minion
  that attacks them takes 2 damage. A board that beats a Closed Ironbell deals half damage to the boss."
- **Phase 2, The Toll (TF).** Each front: Ironbell 8/36 Resilient Ward, 2 Bell Wardens 2/6 Ward **Taunt**, a Clapper
  4/4. "Ironbell Closes when it has taken 18 damage this combat. (Now 0 of 18.)" **The Toll** fires in the phase's
  first round and every other round after: "Start of Combat: deal 8 damage split among enemy minions." It is shown a
  Shop ahead.
- **Intent cycle:** Brace (Wardens regain Ward), Sharpen 5 (Ironbell), Brood 1 (a Bell Warden), Hunt.
- **Check:** a reference board deals Ironbell 12 to 20 in a fight, so the Close is a live question every round. A board
  with Execute or one huge hit wins a phase 2 front about 75%; a board of many small hits about 40%.
- **The two-player read:** each board must burst through the Close or stop short, and the pair decides who carries
  the Execute. The Guard sends Ward across before a Toll round; the Blade takes the front with the Hunt off it.
  "Save the Execute for the bell." (The Relay waits for Act 2, so first-run pairs learn Twin Fronts and Rescue first.)

---

#### Act 2, Boss 4. AURUM AND FERRUM, THE GILT TWINS
*Exam: "Two bosses, one each. They must fall together."* A bar of 30 each. Hit 9. Enrage from round 6.

- **Every round is TF.** Front L: Aurum (Gilded) 10/24 Ward, "Rally: give Ferrum's front +2/+2 next fight." and 3 Gilt
  Guards 4/8. Front R: Ferrum 14/20 Cleave and 3 Rust Hounds 5/4. Each player picks a twin. A Rescue strike hits the
  twin of the front it rescued.
- **Twin rule:** "If one twin's bar empties while the other has more than 12 left, the fallen twin returns next round
  with 15." The bars sit side by side.
- **Phase 2, when either bar is at 15 or less:** the healthier twin gains "Start of Combat: copy the other twin's
  keywords."
- **Intent cycle (per twin):** Sharpen, Brace, Hunt, Hex "Tax" (Aurum's player) alternating with "Tariff" (Ferrum's
  player), never both in one turn.
- **The two-player read:** pure timing. "I'm rolling for my triple this turn. Hold your burst for next round." Before
  the first lock, the pair can swap twins at no cost, so the stronger board meets the twin that is behind.

#### Act 2, Boss 5. THE MAGPIE QUEEN
*Exam: "It punishes a single carry."* Bars 44 / 44. Hit 9. Enrage from round 6.

- **Board (TF).** Each front: 4 Glintwings 5/6. The Queen 8/16 Stealth stands on one front (shown, alternating).
- **Pilfer (every round).** "Start of Combat: she takes a copy of the highest-Attack minion on the stronger board and
  puts it on the other front." Your carry fights your partner. The copy keeps baked stats and keywords; side Auras
  don't come with it.
- **Hoard.** Each Pilfered card leaves a Gilded token in her hoard row. Each token gives her fronts +1/+1 (max +6). A
  Double Win (two won fronts; a Rescue doesn't count) clears the hoard.
- **Phase 2, Greed:** she Pilfers from both boards. Each board's best goes to the other's front.
- **Intent cycle:** Hunt, Brace (Glintwings gain Ward), Brood 2, Hex "Seal" on the stronger player.
- **The two-player read:** balance the boards, or make sure the partner has an answer to your carry (Execute, Taunt
  sponges, a Ward breaker).

#### Act 2, Boss 6. BRASSJAW, THE SIEGE ENGINE
*Exam: "It punishes a fragile board."* Bars 44 / 44. Hit 9. Enrage from round 6.

- **Board (TF).** Each front: 2 Brass Hounds 6/5 Flurry, 2 Gearsmiths 3/8 Taunt.
- **Breach Cannon.** "When it fires: Start of Combat, deal 24 damage split across the aimed board, highest Health
  first. If that board then loses, its player takes double." It aims at the board with **lower total Health** at the
  start of the Shop in which its Countdown begins. The aim can be taken (8.8).
- **Timing, round by round (phase 1).** The aim is shown on the map before the boss, so the first Shop already
  answers it.

  | Round | Ribbon during that round's Shop | That round's fight |
  |---|---|---|
  | 1 | "Breach Cannon fires THIS round. Aimed at Mike." | The cannon fires at Start of Combat. |
  | 2 | "Reloading. Fires in round 3. Aimed at Kevin." Intent: Steam Vent. | Gearsmiths have Ward. No cannon. |
  | 3 | "Fires THIS round. Aimed at Kevin." | The cannon fires. |
  | 4 | "Reloading. Fires in round 5." Intent: Overdrive. | Hounds have +3 Attack. |
  | 5 | "Fires THIS round." | The cannon fires. |

- **Phase 2, Twin Barrels:** the cannon fires in the phase's first round, then every other round, for 18. Its aim
  alternates by itself. Taking the aim still works (and still angers it).
- **The two-player read:** the readable tank swap. The wall takes the aim and the anger. The pair sends Ward and Taunt
  across before every cannon round and keeps 2 Bond for a Steady. Every pair meets the cannon at least twice.

#### Act 2, Boss 7. THE HEXLAMP (the chore boss)
*Exam: "It punishes a pair that won't share the chores."* Bars 44 / 44. Hit 9. Enrage from round 6.

- **Board (TF).** Each front: a Lampwright 10/24 Taunt and 3 Wax Moths 6/5 Flurry.
- **The Wicks (shared).** Six Wicks burn on the boss bar. "Start of Combat: for each lit Wick, the Hexlamp's fronts gain
  +2/+2. (Now 6 Wicks: +12/+12.)"
- **Tending (alternates every round, shown a Shop ahead).** "Next Shop: Mike tends the lamp." Two **Lamp Cinders**
  are pinned in the Tender's Shop: "Buy it for 1 to snuff a Wick. If it is still here at End of Turn, you take 1
  damage and a Wick relights." So each round one of you spends 2 Gold cleaning while the other builds, and then you
  swap. Tending is the boss's own mechanic, not a Hex (9.3), and it is held to the same 2-Gold budget.
- **Dark Lamp.** "While no Wick is lit, the Hexlamp's minions lose Ward and Taunt."
- **Phase 2, The Relighting:** at the start of phase 2, 4 Wicks relight. The Tender gets 2 Lamp Cinders and the other
  player gets 1 (each within the 2 Gold budget).
- **Divider Charge.** Countdown "Divider fires in round 3, then every 3 rounds. Start of Combat: its fronts gain +1/+1
  for each point of Health between you. (Now +7/+7.)" It rewards keeping your Health even: Tend the lower one, let
  the healthier one take the Hunt.
- **Intent cycle:** Brood 1 (a Moth), Brace (Lampwrights gain Ward), Hunt, Sharpen 6.
- **Check:** with all six Wicks lit, a reference board wins about 35%. With two snuffed, about 55%. With all out (Dark
  Lamp), about 75%. Snuffing all six takes three rounds of steady tending in phase 1.
- **The two-player read:** "This turn is yours to build. I'll clean." The Tender's turn is a weak Shop on purpose; the
  partner's is a strong one, and the order flips every round. Before the Divider, the healthier player takes the Hunt
  and the anger to close the gap.

#### Act 2, Boss 8. THE TITHE COLLECTOR
*Exam: "It punishes greed, and a pair that leans on one player."* Bars 44 / 44. Hit 9. Enrage from round 6.

- **Board (TF).** The Hunted player's front: the Collector 8/30, "Start of Combat: gain +1/+1 for each Gold your
  opponent left unspent last turn. (Now +2/+2.)" and 2 Debt Collectors 4/4 Execute. The other front: 3 Bailiffs 5/8
  Taunt and a Debt Collector.
- **Debt (a Hex intent in its cycle).** "Next Shop: Debt on Mike. His first 2 rerolls cost 2." It names whoever
  dealt less boss damage last round (a tie: no Debt that round, and the intent moves on). Like every Hex, it hits each
  player at most once per phase. A Rescue strike counts for the rescuer.
- **Phase 2, The Ledger:** "At End of Turn, for each card in your hand past 3, the Collector gains +2/+2." Debt
  Collectors gain Rise.
- **Intent cycle:** Debt, Sharpen 8 (the Collector), Hunt, Spell Seal (the player not in Debt).
- **The two-player read:** spend everything, keep hands small (send spare cards to the partner instead of holding
  them), and keep damage even. A carry with a passenger spirals into Debt.

---

#### Act 3, Boss 9. THE CLOCKWRIGHT
*Exam: "It punishes doing too much."* Bars 64 / 64 / 44 (Joined). Hit 12. Enrage from round 7.

- **Phase 1 (TF).** The Hunted player's front: Clockwright 14/60 Taunt and 2 Gearlings 8/8. The other front: 3
  Chronoguards 10/10 and a Gearling.
- **The Tick (one count for both players).** "Every card either of you plays from hand is a Tick. Every 10 Ticks this
  Shop: a Gear. Each Gear gives the Clockwright +6/+6 and its Gearlings Flurry next fight." Live on the ribbon:
  "Ticks: 7 of 10". Sends, Tonics, hero powers and Equipment don't Tick.
- **Phase 2:** a Gear every 8 Ticks. Gearlings join both fronts.
- **Phase 3, The Last Second (JF):** the Clockwright 20/60, "Immune while attacking", and 4 Gearlings with Flurry. A
  Gear every 7 Ticks.
- **Intent cycle:** Sharpen 12, Brace, Hex "Overwind: each card you play counts as 2 Ticks" (one player), Hunt.
- **The two-player read:** StS's Time Eater, shared. The pair has one budget of plays. "Don't play it. Send it to me."
  A Weaver casting six spells costs the Blade a Gear.

#### Act 3, Boss 10. VEL, THE MIRROR UNWRITTEN
*Exam: "It punishes a single carry."* Bars 64 / 64 / 44 (Joined). Hit 12. Enrage from round 7.

- **Phase 1 (TF).** Each front: Vel 14/50 and 3 Glass Wards 8/12 Ward. "Start of Combat: summon a copy of the
  highest-Attack minion from **each** enemy board (both of yours). (Now: Kevin's Geode Guardian 28/44, Mike's Twinblade
  52/30.)" So each front holds a copy of your best and your partner's best. Copies keep baked stats and keywords, not
  side Auras (so a copy of a minion buffed by an Aura comes in smaller than the original).
- **Phase 2:** Vel also copies the highest-Health minion from each board (up to 4 copies; Glass Wards make room).
- **Phase 3 (JF):** Vel copies the 2 highest-Attack minions of the joined board, and the copies have Rise.
- **Intent cycle:** Brace, Sharpen 10 (the copies), Hunt, Countdown "Shatter fires in round N: Start of Combat, your
  highest-Attack minion's Attack becomes its printed Attack this fight" (aimed at one player).
- **Check:** a pair whose best minion holds more than half of a board's total Attack loses phase 1 fronts about 70%. A
  pair with even boards and one Execute loses about 40%.
- **The two-player read:** both carries come back at you, on both fronts. The answer is spread stats, Execute, Taunt
  sponges that soak your own carry, and a Guard who keeps the copies busy. It is legible: the ribbon names the copies
  before you lock.

#### Act 3, Boss 11. THE PALE CHOIR
*Exam: "It punishes Echo and Rise."* Bars 64 / 64 / 44 (Joined). Hit 12. Enrage from round 7.

- **Phase 1 (TF).** The Hunted player's front: the Cantor 4/24 Stealth, "While the Cantor lives, enemy Echoes on this
  front don't trigger." and 2 Choristers 3/10 Taunt, "Echo: the Cantor gains +4/+4." The other front: 3 Choristers and
  a Psalter 6/12. **Answering Hymn:** "Each enemy Echo that triggers adds a 2/2 Taunt Chorister to the other front next
  round."
- **Phase 2, The Procession (Relay).** **Main wave:** the Cantor 8/30 (no Stealth) and 4 Choristers. **Reserve:** a
  Psalter 10/20 and 2 Choristers. The Hymn now works **across legs**: "Each enemy Echo that triggers in the Opener's
  leg adds a 2/2 Taunt Chorister to the Reserve." And **"In the Opener's leg, your Rise and Rebirth return the minion
  on the Choir's side instead."** The flip happens inside leg 1. The returned bodies are then Main wave survivors, so
  they walk into the Closer's leg by the ordinary continuation rule.
- **Phase 3 (JF):** the Cantor 12/60 and 4 Choristers. Countdown "Requiem fires in round N: Start of Combat, every
  enemy minion with Echo loses it."
- **Intent cycle:** Brood 2 (Choristers), Brace (Ward on the Cantor), Hunt, Spell Seal.
- **The two-player read:** the Keeper must not take the Hunt in phase 1, and must not open in phase 2: their Rises
  would feed the Closer's enemy. The Keeper closes, and the Joined Front brings the non-Echo half forward.

---

### 9.8 THE CROWN (the opt-in fourth act; StS Act 4)

After a pair's **first win**, every later run that beats its Act 3 boss offers a choice at the end screen: **"Go on to
the Crown"** or end here. The Crown is one node, the **Last Camp** (a Hearth action and a Bazaar visit in one turn),
then the boss. About 12 to 15 minutes.

**THE UNMADE CROWN.** *Exam: "Can you stand alone, then together?"* Bars 70 / 70 / 50 (Joined). Hit 15. Enrage from
round 7. Built against the strongest fifth of recorded late boards.

- **Phase 1, The Two Hands (TF, bar 70).** Front L, **the Left Hand**: 7 Hollow Knights 7/9 with Rise (wide). Front R,
  **the Right Hand**: 2 Crown Giants 35/60 Ward Cleave and a Warden 10/20 Taunt (tall). Players pick fronts (lock-commit
  rule). Intents: Brood (Left), Brace (Right), Sharpen, Hunt.
  **Sever:** "Each card or Gold either of you sends this phase gives the Crown +3/+3 in phase 2. (Now +6/+6.)" Giving
  is still allowed, and now it has a price you can read, because the channel is about to close.
- **Phase 2, The Crown Divides (TF, bar 70).** "The road between you closes." For this phase: **no sends, no Send
  Gold, no ally spells, no ally Start of Combat, and Bond can't be spent.** Rescue and Batons still work: the bond is
  cut, not broken. The Crown 25/90 (plus Sever) sits on the front of the **player with more Health** (so the stronger
  must face it); the other front holds its Shadow, a copy at half stats with Stealth. Each player stands alone.
- **Phase 3, The Crown (JF, bar 50).** The channel reopens. The Unmade Crown 30/150 with Resilient Ward. **"Invincible:
  the Crown loses at most 25 Health per round."** (stated on its card and bar). "Start of Combat: deal 5 damage to all
  enemy minions." 4 Crown Shards 10/10. Intents: Countdown "Crownfall fires in round N: Start of Combat, deal 6 to
  every enemy minion", Sunder (its left-most gains Cleave), Brace.
- **Victory:** the end screen, a cosmetic title for the pair, a Crown mark on the Dread you beat it at.

**Why this finale:** phase 1 asks the pair to split jobs (who kills wide, who kills tall) and prices every last gift,
phase 2 removes the channel so each build must stand alone, and phase 3 is the one merged board of the run against a
boss whose limit is printed, not hidden.

---

## 10. Relics, consumables, events

### 10.1 Runes are the relics (REUSED), with a row of 6

StS relics are always-on rule changes that stack. ASCENT runes are exactly that, with a forge UI, a duplicate rule
("duplicates always do something"), a board-fit guarantee and 358 Basic and Epic defs. Kinbound uses them as the relic
layer and adds three small adventure-only groups.

| Group | Source | Count at launch | Note |
|---|---|---|---|
| **Role rune** | Your Role | 4 | Upgraded after Boss 1 (6.5). Takes a row slot. |
| **Basic and Epic runes** | Runeforge nodes (one guaranteed per lane in Acts 1 and 2), Champions (Basic in Acts 1 and 2, Epic in Act 3), Bazaar (6 / 12 Purse) | existing pools, filtered | Lobby-only runes are excluded by the mode filter. |
| **Boss runes** | Boss victory (shared draft) | 14 new | Big power, a real drawback your partner can often cover. |
| **Ally runes** | Bazaar, Chests, events | 11 new | Ordinary runes whose text mentions your ally. An ally icon marks them. |
| **Duets** | After Boss 2 | 9 new | 8.9. No row slot. |

**The rune row holds 6** (Role rune included; Hex Scar and the Duet excluded). Taking a 7th asks you to drop one; a
dropped rune becomes 3 Purse. A typical player by Act 3 has met 7 or 8 runes (Role, 2 forges, 1 to 2 Champions, 2 Boss
runes, a Bazaar buy) and keeps 6. A lobby player ends with about 2 to 3. The gap is the uplift encounters are tuned
for (9.5), and the fallbacks in 15.12 cut it if it is too much.

The scheduled turn-6 and turn-9 forges are replaced by the guaranteed Runeforge nodes, so the forge count is the
lobby's and the timing is the map's. Rifts are off.

### 10.2 Boss runes (NEW; StS boss relics, drafted)

After each boss, **4 Boss runes** are shown to both, however fast the boss fell. The player without the
Trail picks one, then the other, and the rest are gone. 2 Bond re-rolls the draft. Most drawbacks are things your
partner can cover.

| Boss rune | Power | Burden | Who covers it |
|---|---|---|---|
| **Crown of Hunger** | "Your tier-ups cost 2 less." | "You can't Rest at Hearths." | Your ally Tends you (12, better than Rest). |
| **Rune of the Iron Purse** | "+1 max Gold." | "Your Shop clock is 10 seconds shorter." | Your ally Peeks and pings. |
| **Rune of the Blind Seer** | "Your Shop shows 1 more minion." | "You can't see intents. Your ally can." | Your ally pings every intent. |
| **Rune of the Spent Hoard** | "Your first 2 rerolls each turn are free." | "You earn no Purse." | Your ally gives you rewards or a rune trade. |
| **Rune of the Heavy Crown** | "Start of Combat: your left-most minion gains +10/+10." | "Your rewards offer 2 cards, not 3." | Your ally gives you rewards. |
| **Rune of the Summit** | "You can tier up to Tier 7." (Tier 7 costs 13) | "Your tier-ups cost 3 more." | Your ally sends Gold on tier-up turns. |
| **Rune of the Gilded Cage** | "Your triples need only 2 copies." | "You can't Gild at Hearths, and your Triple Rewards offer 2." | Your ally sends you second copies. |
| **Rune of the Lonely Road** | "Gain 2 extra Gold every turn." | "You can't send or receive cards, Gold or ally effects." | Nobody. You walk alone. |
| **Rune of the Open Hand** | "You get 3 sends a turn, all free." | "End of Turn: minions in your hand lose 1/1. At 0 Health they are gone." | You, by sending fast. |
| **Rune of Haste** | "Your first minion each turn costs 2." | "Your Shop clock is 15% shorter." | Your ally Peeks for you. |
| **Rune of the Last Stand** | "While you are Hunted, your minions have +4/+4." | "You are always Hunted. The Hunt can't leave you." | Your ally's Rescue. |
| **Rune of Borrowed Strength** | "Your minions have +3/+3." | "Your ally's minions have -1/-1." | Nobody. The pair decides. |
| **Shepherd's Crown** | "Your ally's rewards offer 4." | "Your rewards offer 2." | You, by choice. |
| **Giver's Crown** | "You get 2 extra sends a turn, free." | "Ally effects can't target you." | Nobody. This is the supplier's rune. |

### 10.3 Ally runes (NEW; co-op relics)

| Rune | Text |
|---|---|
| **Rune of Kinship** | "When your ally plays a Gilded minion, Discover a minion of their shop tier." |
| **Rune of the Shared Hearth** | "When you Rest, your ally heals 5 too." |
| **Rune of the Long Rope** | "You get 1 more send each turn. It is free." |
| **Rune of the Mirrored Banner** | "Your ally's tribe Auras also count for you." |
| **Rune of Second Wind** | "Once per act: when your ally would fall, they stay at 1 Health." |
| **Rune of the Crossing** | "Rescue: your crossing minions gain +2/+2." |
| **Rune of Open Hands** | "When you give a reward, your ally picks from all 3." |
| **Rune of the Bond** | "Steady and Boss rune re-rolls cost 1 less Bond." |
| **Rune of the Torch** | "Your Batons trigger twice." |
| **Rune of the Opener** | "When you open a Relay: Start of Combat, your 2 left-most minions gain Cleave, and Wards you break give your ally's next fight +1 Attack on its left-most minion. (Lands: Closer's leg.)" |
| **Rune of the Closer** | "When you close a Relay: your minions gain +1/+1 for each enemy minion that died in the Opener's leg. (Now +0/+0.)" |

### 10.4 Paired runes (cut from launch; a later idea)

A rune in two halves, one per player, that works only while both hold a half. It is a good idea, and it is the kind
of extra term this scope can't afford at launch. It is parked for Phase 3 (16.4).

### 10.5 Tonics (StS potions, built on next-combat spells)

ASCENT already has **next-combat spells** (Pre-emptive Assault, Last Stand, Decoy Sigil, Weaken) that bank at Start of
Combat. Tonics are those, held in a **2-slot belt** (the Equipment slot style), used during the Shop. They don't count
as Shop spells or casts, and they can be sent.

| Tonic | Text |
|---|---|
| **Ember Draught** | "Next combat: your left-most minion gains +6 Attack and attacks immediately." |
| **Wardwater** | "Next combat: your 3 left-most minions gain Ward." |
| **Smoke Flask** | "Next combat: the enemy's 2 highest-Attack minions start with 1 Health." |
| **Fairy Lantern** | "If you would fall this turn, go to 8 Health instead." |
| **Reroll Dust** | "Refresh your Shop 3 times for free." |
| **Shared Cup** | "You and your ally heal 6." |
| **Gilding Oil** | "Gild a minion of Tier 2 or lower." |
| **Phoenix Ember** | "Your Fallen ally returns now at 8 Health." (Bazaar only, 12 Purse.) |
| **Bottled Avalanche** | "Next combat: Start of Combat, deal 4 damage to every enemy minion." |
| **Hunter's Mark** | "Take the Hunt from your ally this fight. The boss isn't angry." |

### 10.6 Other consumables (REUSED as-is)

Rubies, Gifts (Kindness, Merry Christmas), Whispers, Clues, Dwarven Ales and Equipment charges all work unchanged. All
of them except Whispers can be sent.

### 10.7 Junk (see 7.6)

Husk, Cinder, Rust Coin, Hex Scar, and the Hexlamp's Lamp Cinder. They come from Hexes, Three Lanterns, Rust Raiders,
the Hexlamp and events, and are cleared by buying (Husk, Cinders), selling (Rust Coin) or a Bazaar (Hex Scar, 6 Purse).

### 10.8 How the run's power stays readable

Every rune and Tonic is an ordinary rune-row or belt card with self-contained live text. The end screen
lists all of them per player, with what each did this run ("Rune of the Crossing: 4 Rescues, +36 Health given").

### 10.9 Events (11 written, each with a co-op angle)

Events use the Choose One modal with 2 to 4 choices. **Joint** choices need both players (after 10 seconds the Trail
holder's choice stands). **Personal** choices are made separately. Each event appears at most once per run. No choice
leaves one living player out of the next fight.

**1. The Toll Bridge** (joint)
"A troll wants 10 Purse to let you cross. Only one of you has to pay."
- Kevin pays 10 Purse.
- Mike pays 10 Purse.
- Split it. You each pay 6.
- Fight it: each of you faces a Troll Bridgekeeper 8/40 Taunt. Each winner gains 8 Purse.

**2. The Wishing Well of Twins** (personal, linked)
"Throw a coin in. The well gives to the one who didn't."
- Throw 3 Purse: your ally Discovers a minion of their tier + 1.
- Throw nothing.
(If both throw, both Discover.)

**3. The Hall of Mirrors** (personal)
"You see your board, but better."
- Copy a minion on your board. The copy has -2/-2.
- Break a mirror: lose 6 Health and gain a random Epic rune. A Hex Scar joins your rune row.
- Leave.

**4. The Ferryman's Price** (joint)
"The Ferryman carries one thing across. Name it."
- Carry a minion: send a board minion to your ally for free. It gains +4/+4. You gain 2 Purse.
- Carry a rune: give one of your runes to your ally for 4 Purse (a cheap rune trade).
- Carry the both of you: each pays 4 Purse, and your next Skirmish packs both lose their 2 strongest minions.
- Refuse.

**5. The Bloodforge** (personal)
"An anvil that drinks."
- Lose 8 Health: Gild a minion of any tier on your board.
- Lose 4 Health: Engrave a minion.
- Feed your ally's minion: you lose 8 Health, and your ally Gilds a minion of their choice. +1 Bond.

**6. The Two Flags** (joint)
"Two flags, one pole. Each of you lowers one."
- Each of you removes a tribe from your own Shop for free. You must pick different tribes.
- Raise both: each of you gains 4 Purse.
- Leave both flags.

**7. The Hungering Shrine** (personal)
"It wants a minion. It gives back a promise."
- Give a minion from your board: your next reward offers only Gilded minions.
- Give a minion from your hand: gain its tier in Purse.
- Leave.

**8. The Lost Patrol** (joint, a Mystery fight)
"Soldiers of another road. They still fight."
- Fight them: a Relay against a generated board in the style of a past pair (never real players' boards unless the
  owner opts in, 17.6). If the pair wins both legs, each gains an ally rune.
- Bury them: each of you gains a random Tonic.

**9. The Gambler's Table** (personal)
"Roll the bones."
- Bet 5 Purse: 50% to win 12.
- Bet 10 Health: 50% to take a Boss rune of your choice from 3.
- Bet on your ally: your ally rolls. Win, you both get 6 Purse. Lose, a Rust Coin lands in each hand.

**10. The Old Hearth** (joint; more likely when a player is Fallen)
"A cold fire. It will take one gift."
- Light it with a minion from either board: both of you get a Hearth action now.
- Light it with 6 Purse from each of you: a Fallen player returns at 15 Health. If nobody is Fallen, you both heal 15.
- Leave it cold.

**11. The Broken Ring** (joint)
"Half a ring each. It only shines when both are worn."
- Wear it: 3 ally runes are shown. The player without the Trail takes one, then the other.
- Melt it down: each of you gains 5 Purse.
- Sell it to the one who wants it more: one of you gains 9 Purse, the other gains 1 Bond for the pair.

---

## 11. Content list

Format: **Name** (Tier, Role or neutral, Attack/Health, keywords). Card text. *Gilded:* full text. Tags: `[REUSE]` only
existing triggers and factories; `[ALLY]` the ally target scope; `[ALLY SoC]` ally Start of Combat; `[BATON]` the Baton
keyword; `[RESCUE]` the Rescue trigger; `[RELAY]` reads Relay order; `[TEAM]` reads team state; `[NEW]` names another
primitive. Live values show in parentheses, as the card-text rule requires on every surface. Role cards are offered
through rewards, Chests and Bazaars, never the Shop row (6.2).

### 11.1 Guard (protector)

1. **Shieldwright** (T1, Guard, 2/3). "Shout: give a minion Ward. You may target your ally's minion." *Gilded:* "Shout:
   give two minions Ward. You may target your ally's minions." `[ALLY]`
2. **Ott the Shieldbearer** (companion, 1/4, Taunt). "At each Hearth: gain +1/+2 permanently. (Now +2/+4.)" *Gilded:*
   "At each Hearth: gain +2/+4 permanently." `[REUSE Henchman + hearthVisit]`
3. **Bannerman Hale** (T2, Guard, 3/4, Taunt). "Your Taunt minions have +1 Health for each Ward on your board. (Now
   +2.)" *Gilded:* "Your Taunt minions have +2 Health for each Ward on your board." `[REUSE]`
4. **Wardkeeper** (T3, Guard, 2/6). "After a friendly Ward breaks, give your left-most minion +2/+2 this combat."
   *Gilded:* "After a friendly Ward breaks, give your left-most minion +4/+4 this combat." `[REUSE]`
5. **Gatewarden** (T3, Guard, 3/7, Taunt). "Rescue: gain Ward and +0/+6." *Gilded:* "Rescue: gain Resilient Ward and
   +0/+12." `[RESCUE]`
6. **Rampart Golem** (T4, Guard, 4/10, Taunt, Resilient Ward). "Baton: your ally's next fight starts with a 0/8 Taunt
   Rampart Shard. (Lands: next fight.)" *Gilded:* "Baton: your ally's next fight starts with a 0/16 Taunt Rampart
   Shard." `[BATON]`
7. **Aegis Sister** (T5, Guard, 5/5, Ward). "Start of Combat: give your ally's 2 left-most minions Ward." *Gilded:*
   "Start of Combat: give your ally's 4 left-most minions Ward." `[ALLY SoC]`
8. **Lord Bastionne** (T6, Guard, 6/12, Taunt). "Your minions with Ward have +6 Attack. So do your ally's." *Gilded:*
   "Your minions with Ward have +12 Attack. So do your ally's." `[TEAM aura]`
9. **Shared Shield** (spell, 1 Gold, starter). "Give a minion Ward. Then give one of your ally's minions Ward."
   `[ALLY]`
10. **Shield Toss** (spell, 2 Gold). "Move Ward from one of your minions to one of your ally's minions. It becomes
    Resilient Ward." `[ALLY]`

### 11.2 Blade (carry)

11. **Grit Raider** (T1, Blade, 3/1). "Rally: gain +1 Attack this combat." *Gilded:* "Rally: gain +2 Attack this
    combat." `[REUSE]`
12. **Rook Ashblade** (companion, 2/1). "Slaughter: gain +1/+1 permanently. (Now +3/+3.)" *Gilded:* "Slaughter: gain
    +2/+2 permanently." `[REUSE]`
13. **Twinblade** (T2, Blade, 2/3, Flurry). "Slaughter: gain +2/+1 permanently." *Gilded:* "Slaughter: gain +4/+2
    permanently." `[REUSE]`
14. **Bonecleaver** (T3, Blade, 4/4, Cleave). "Pummel (12): give your minions +2/+2 permanently. In the Joined Front,
    give your ally's minions +2/+2 permanently too. (Next in 5.)" *Gilded:* "Pummel (12): give your minions +4/+4
    permanently. In the Joined Front, your ally's minions too." `[REUSE Pummel + owner tag]`
15. **Headsman Vey** (T4, Blade, 5/3, Execute). "After this destroys a minion, it regains Execute." *Gilded:* "After
    this destroys a minion, it regains Execute and gains +3/+3." `[NEW small: regain Execute]`
16. **Vanguard Duelist** (T4, Blade, 6/4). "Rescue: attack immediately, and gain +6 Attack this combat." *Gilded:*
    "Rescue: attack immediately, and gain +12 Attack this combat." `[RESCUE]`
17. **Bloodrush Champion** (T5, Blade, 7/7, Flurry). "Rally: give your other minions +1 Attack this combat. Baton: your
    ally's left-most minion gains this minion's Attack in their next fight. (Now 7.)" *Gilded:* "Rally: give your other
    minions +2 Attack this combat. Baton: your ally's left-most minion gains twice this minion's Attack in their next
    fight." `[BATON]`
18. **The Last Blade** (T6, Blade, 10/10). "While you are Hunted, this has Flurry and Cleave. Shout: take the Hunt from
    your ally. The boss isn't angry." *Gilded:* "20/20. While you are Hunted, this has Flurry and Cleave. Shout: take
    the Hunt from your ally. The boss isn't angry." `[TEAM]`
19. **Whetstone** (spell, 1 Gold, starter). "Give a minion +3 Attack and Execute until the end of next combat."
    `[REUSE]`
20. **Closing Strike** (spell, 2 Gold). "Next combat: if you close a Relay or cross in a Rescue, your left-most minion
    attacks immediately with +8 Attack." `[RELAY + RESCUE, banked spell]`

### 11.3 Weaver (enabler)

21. **Thread Sprite** (T1, Weaver, 1/3). "End of Turn: give your ally's right-most minion +1/+1." *Gilded:* "End of
    Turn: give your ally's right-most minion +2/+2." `[ALLY, applied before the fight]`
22. **Sabe the Inkling** (companion, 1/2). "Grants a Whisper each turn: Mote. Give a minion +1/+1. It can target your
    ally's minions. At each Hearth, Mote gives +1/+1 more. (Now +2/+2.)" `[REUSE Whisper + ALLY]`
23. **Loomwitch** (T2, Weaver, 2/4). "After you cast a spell on your ally's minion, gain +1/+1 permanently. (Now
    +3/+3.)" *Gilded:* "After you cast a spell on your ally's minion, gain +2/+2 permanently." `[NEW trigger:
    allySpellCast]`
24. **Spellcourier** (T3, Weaver, 3/3). "Shout: add a copy of the last spell your ally cast this turn to your hand.
    (Now: Twin Ember.)" *Gilded:* "Shout: add two copies of the last spell your ally cast this turn to your hand."
    `[TEAM read]`
25. **Stitchwork** (T3, Weaver, 2/5). "Rescue: give every crossing minion +2/+2." *Gilded:* "Rescue: give every
    crossing minion +4/+4." `[RESCUE]`
26. **Weftmaster** (T4, Weaver, 4/6). "Your spells have +1/+1 spell power. So do your ally's." *Gilded:* "Your spells
    have +2/+2 spell power. So do your ally's." `[TEAM side stat]`
27. **Tapestry Matron** (T5, Weaver, 4/8). "Grants a Whisper each turn: Thread of Fate. Give a minion +3/+3. On your
    ally's minion it casts twice." *Gilded:* "Grants a Whisper each turn: Thread of Fate. Give a minion +6/+6. On your
    ally's minion it casts twice." `[REUSE Whisper + ALLY]`
28. **The Grand Weaver** (T6, Weaver, 6/10). "Spells you cast on your ally's minions cast twice." *Gilded:* "Spells you
    cast on your ally's minions cast three times." `[ALLY + trigger multiplier on the ally scope]`
29. **Twin Ember** (spell, 1 Gold, starter). "Give a minion +2/+2. Give one of your ally's minions +2/+2." `[ALLY]`
30. **Hand Off** (spell, 2 Gold). "Send a minion from your board to your ally's hand. It gains +3/+3. Doesn't use a
    send." `[ALLY]` (the clean board-to-board transfer: your carry becomes theirs)

### 11.4 Keeper (undying)

31. **Gravewick** (T1, Keeper, 1/2). "Echo: summon a 1/1 Wick. Baton: your ally's next fight starts with a 1/1 Wick."
    *Gilded:* "Echo: summon a 2/2 Wick. Baton: your ally's next fight starts with a 2/2 Wick." `[REUSE + BATON]`
32. **Wisp of Isola** (companion, 1/1). "Baton: your ally's next fight starts with a Wisp. At each Hearth, the Wisp
    gains +1/+1. (Now a 3/3 Wisp.)" `[BATON + hearthVisit]`
33. **Lantern Bearer** (T2, Keeper, 2/3). "Shout: give a minion 'Baton: your ally's next fight starts with a 2/2
    Wisp.'" *Gilded:* "Shout: give a minion 'Baton: your ally's next fight starts with a 4/4 Wisp.'" `[BATON grant]`
34. **Ferry Kestrel** (T2, Keeper, 2/2, Rise). "Baton: your ally's left-most minion gains +2/+2 in their next fight."
    *Gilded:* "Baton: your ally's left-most minion gains +4/+4 in their next fight." `[BATON]`
35. **Hollow Shepherd** (T3, Keeper, 3/5). "Avenge (3): summon a 3/3 Lost Sheep with Rise." *Gilded:* "Avenge (3):
    summon a 6/6 Lost Sheep with Rise." `[REUSE]`
36. **Mourning Bell** (T4, Keeper, 0/8, Taunt). "Whenever a friendly minion dies, your ally's first summon in their
    next fight gains +1/+1. (Now +4/+4.)" *Gilded:* "Whenever a friendly minion dies, your ally's first summon in their
    next fight gains +2/+2." `[next fight accumulator]`
37. **Ferrywoman Isola** (T5, Keeper, 5/6). "Rescue: summon a copy of the first minion your ally lost in this fight."
    *Gilded:* "Rescue: summon copies of the first two minions your ally lost in this fight." `[RESCUE + leg read]`
38. **The Lantern King** (T6, Keeper, 7/7). "Your minions with Rise have Rebirth instead. So do your ally's." *Gilded:*
    "Your minions with Rise have Rebirth instead, and return with +7/+7. So do your ally's." `[TEAM, REUSE Rebirth]`
39. **Grave Lantern** (spell, 1 Gold, starter, next-combat). "Next combat: the first friendly minion to die returns as
    a 2/2 Lantern Wisp." `[REUSE banked spell]`
40. **Last Rites** (spell, 2 Gold). "Choose One: give a minion Rise. Or give one of your ally's minions Rise."
    `[REUSE Choose One + ALLY]`

### 11.5 Neutral Kinbound cards (any Role; these four minions do enter rewards for everyone)

41. **Kinsman's Toast** (Dwarven Ale, 1 Gold). "Give your minions +0/+1. Your ally's too." `[ALLY]`
42. **Twinned Courier** (T2, neutral, 2/3). "Shout: send a copy of a minion in this Shop to your ally. Doesn't use a
    send." `[ALLY + REUSE "this Shop"]`
43. **Sworn Pair** (T4, neutral, 4/5). "End of Turn: if your ally locked before you, gain +2/+2. (Mike hasn't locked
    yet.)" *Gilded:* "End of Turn: if your ally locked before you, gain +4/+4." `[TEAM: allyLocked]` (it makes "you
    lock first" a real conversation)
44. **Kindred Herald** (T3, neutral, 3/4). "Has +1/+1 for each minion your ally controls of your most common tribe.
    (Now +2/+2, Beasts.)" `[TEAM]`
45. **Relay Runner** (T4, neutral, 4/4). "Baton: if this dies while opening a Relay, the Closer's left-most minion
    gains Ward and +4/+4. Otherwise, your ally's next fight gets a 2/2 Runner." *Gilded:* "Baton: if this dies while
    opening a Relay, the Closer's left-most minion gains Resilient Ward and +8/+8. Otherwise, a 4/4 Runner." `[BATON +
    RELAY]`
46. **Rallying Standard** (T5, neutral, 5/5). "Rally: your ally's left-most minion gains +2 Attack in their next fight.
    (Now +4. Lands: next fight.)" `[next fight]`
47. **Echo of Two** (T6, neutral, 6/6). "Shout: trigger the Shout of a minion on your ally's board. It happens on their
    board. Echo: do it again." `[ALLY, REUSE Auctioneer's Pulse]`
48. **Pathfinder's Compass** (Equipment, bought at a Bazaar for 4 Purse; costs 2 Gold to use). "Reveal what the next
    row's Mystery nodes are." `[NEW map read]`

### 11.6 Enemy-only tokens (data)

Gnawling 2/1; Imp 1/1 (existing); Hollowling 2/3; Hollow Half (4/12, 6/16, 9/24 or 12/32, Taunt, "Echo: summon two
2/2 Hollowlings"); Broodling 6/10 Taunt; Bell Warden 2/6 Ward (phase 2: Taunt); Clapper 4/4; Gilt Guard 4/8; Rust Hound
5/4; Glintwing 5/6; Brass Hound 6/5 Flurry; Gearsmith 3/8 Taunt; Lampwright 10/24 Taunt; Wax Moth 6/5 Flurry; Debt
Collector 4/4 Execute; Bailiff 5/8 Taunt; Patrol Blade 6/6; Sergeant Vask 12/30 Taunt; Shieldman 4/10 Taunt; Gearling
8/8; Chronoguard 10/10; Glass Ward 8/12 Ward; Chorister 3/10 Taunt "Echo: the Cantor gains +4/+4"; Psalter 6/12 (Relay
10/20); Hollow Knight 7/9 Rise; Crown Giant 35/60 Ward Cleave; Crown Shard 10/10; Rampart Shard 0/8 Taunt; Lost Sheep
3/3 Rise; Wick 1/1; Wisp; Runner 2/2; Husk 0/3 Fodder; Cinder, Lamp Cinder, Rust Coin, Hex Scar. Every one is a
`token: true` CardDef (the Hex Scar a rune-row def). Boss bodies are in 9.7.

---

## 12. Difficulty, losing and learning, vocabulary, when a player falls

### 12.1 Health budget (Dread 0)

- Start: 30 Health plus hero Armor (live per-hero numbers). Armor absorbs first.
- Skirmish loss caps by act: 5 / 8 / 10. Champion Hits: 5 / 8 / 10 per round. Boss Hits: 6 / 9 / 12, Crown 15. The
  Hunt doubles. A won Rescue (or a won closing leg) halves.
- Healing: Rest 8, Tend 12, boss victory half your missing Health, Shared Cup 6, events.
- **Health is the act resource. Board, runes and Gilds are the run resource.** Every Champion is "spend Health to buy a
  rune", and its second round is "spend more, or Withdraw". Every Hearth is "buy Health back, buy power, or buy your
  partner's Health".

### 12.2 Dread (the Ascension ladder, shared by the pair)

The run's Dread is the lower of the two players' unlocked levels. A win unlocks the next level for both. One legible
rule per step.

| Dread | Rule (player text) |
|---|---|
| 1 | "More Champions appear on the map." |
| 2 | "Skirmish enemies are stronger." |
| 3 | "Champions are stronger." |
| 4 | "Bosses have more Health." (+10% per bar) |
| 5 | "You may share a Role." |
| 6 | "Boss victories heal a quarter of your missing Health." |
| 7 | "You start with 5 less Health." |
| 8 | "The Fallen get 1 less Gold." |
| 9 | "Your second send each turn costs 2 Gold." |
| 10 | "One intent each round is hidden until you lock. Hexes are stronger." (budget 3) |
| 11 | "Your Tonic belt holds 1." |
| 12 | "Bazaar prices rise by 2." |
| 13 | "The Fallen don't hold the Vigil. Their front goes unanswered and hits their ally for half its Hit." |
| 14 | "Champions have a random Basic rune." (enemy `questMods`) |
| 15 | "Act 3 ends with two bosses, back to back." |

### 12.3 Losing and learning

- **Full information:** the map, the boss and its exam line from step 1, every enemy scouted, intents a fight ahead,
  Countdowns with their round, the Relay's Reserve. A death traces to a choice.
- **End screen** (the match-details screen, extended): both final boards, both rune rows, the route with each node's
  result, the Duet, and **Replay** on the fight that ended the run. Replays are free: the server stored the seeds and
  both locked sides.
- **"What beat us" line:** the encounter's exam plus a measured fact ("Vel: punishes a single carry. Your best minion
  had 70 Attack. Your next had 11."). Authored per encounter, shown only on a loss.
- **Short failure loops.** Most losses are in Act 2 at 20 to 30 minutes.
- **Seeded runs.** Every run has a shareable seed. A **Weekly Road** (fixed seed and Roles) lets pairs compare routes.
- **Light meta.** Dread levels, Role unlocks, the Crown mark, cosmetic titles. Players get better, not their accounts.
  Account XP from Kinbound needs the same `settle_progression` change Versus is waiting for.

### 12.4 Vocabulary: the honest count, and onboarding

Every word a Kinbound player meets that ASCENT doesn't already teach, counted. Card names, enemy names and event
titles are not counted: each has self-contained text.

| Group | Terms | Count |
|---|---|---|
| Map and nodes | Skirmish, Champion, Hearth, Bazaar, Chest*, Mystery*, Parting, Trail | 8 |
| Hearth actions | Rest*, Tend*, Revive* (Gild and Engrave are existing words) | 3 |
| Economy | Purse, Reward*, Remove* | 3 |
| Co-op | Ally*, Send*, Front*, Rescue, Bond, Baton, Relay, Open*, Close*, Joined Front, Fallen, Vigil | 12 |
| Bosses | Intent, Phase*, Hunt, Aim*, Hex, Enrage, Steady*, Withdraw* | 8 |
| Build | Role, Boss rune, Tonic, Duet | 4 |
| Meta | Dread | 1 |
| **Total** | | **39** |

\* 16 of the 39 are plain words used in their everyday sense, which leaves **23 real terms**. Revision 3 had 27;
this pass cut the Way Back, Stagger, Paired rune and Furl, and Swap and Return are gone with them. On top sit **8
intent icons** (Hit, Sharpen, Brace, Brood, Burn, Hex, Hunt, Countdown), always shown with a full sentence.

**Formats by act.** Act 1 uses only Twin Fronts and Rescue. The Relay first appears in Act 2 (the Long Patrol), the
Joined Front in Act 3. So a first run meets two formats, and a pair meets the full four only once it reaches Act 3.

**Run 1 teaches 13:** Skirmish, Champion, Hearth, Rest, Tend, Purse, Reward, Ally, Send, Front, Rescue, Intent, Bond.
The rest unlock as the pair reaches them: Trail (the first split vote), Role (run 2), Hunt and Aim (first hunting
boss), Phase and Enrage (first boss), Bazaar, Chest, Mystery, Remove (first visit), Withdraw (first Champion that
survives round 1), Parting and Hex (Act 2), Relay, Open and Close (the Long Patrol), Boss rune, Duet, Joined Front,
Baton, Tonic (when first offered), Fallen, Vigil and Revive (the first time someone falls), Steady (the first aim),
Dread (after the first win).

**The First Road** (EXTENDS the Learn Ascent pattern). A pair's first run is a guided Act 1 on a fixed map, with
authored encounters and a coach line before each Shop:
1. Skirmish: two easy packs. Teaches **Front** and pack picks.
2. Skirmish (Uneven Ground): one easy pack, one hard. The easy pack's winner **Rescues**, and the strike shows.
3. Chest: one item finishes the partner's pair. Teaches **Send**, and the first ping ("Triple!").
4. Champion (Grubb): teaches **Intent** with exact numbers, the shared bar and **Reward**.
5. Hearth: shows **Tend** heals more than **Rest**.
6. Boss: Mother Hollow at reduced bars (18 / 18), with the split table explained.

Both players use fixed starter Roles on the First Road (Guard and Blade). Solo players can take it with the **Kinbound
bot** as partner. Weaver and Keeper unlock after the first Act 1 boss kill. The Relay is taught by the Long Patrol's
coach line the first time a pair meets it, in Act 2. **Pings get a coach line too**, the first time a player holds
Rune of the Blind Seer: "You can't see intents now. Your ally can. Ask them to ping."

### 12.5 How a run ends

- **Win:** the Act 3 boss falls (or the Crown, if the pair went on).
- **Loss:** both players are Fallen at the same moment. With one Fallen, a run is very much alive, and very much in
  danger.

### 12.6 When one player falls: the Vigil

At 0 Health you are **Fallen**. The goal: falling is costly and frightening, the Fallen player still has real things
to do every turn, and nothing about it can be farmed or used as an advantage.

**What you lose.**
- **Your board deals no boss damage.** Only your partner's board fills the bar, so the pair's damage halves and
  Enrage comes close.
- **No rewards, no rune picks, no Purse, no Boss rune pick.**
- **2 less Gold a turn** (minimum 3). Your Hearth action can only be Tend.
- **Bond:** your Revive costs most of an act's giving (8.6).

**What you still do (every turn).**
- **You shop.** Every Shop prepares the board you will come back with.
- **You supply.** 3 free sends a turn and up to 3 Send Gold. You can't receive sends. A card you send still earns the
  pair's 1 Bond a turn when it is played, as for anyone.
- **You hold the Vigil.** Your board still fights your front (or your Skirmish pack, or your Relay leg if you are
  given one):
  - A **won Vigil** stops your front: it deals nothing to your partner this round. It deals **no** boss damage and pays
    nothing. It makes your Revive **1 Bond cheaper** (at most 3 off, so a Revive never costs less than 2). A small pill
    on your portrait counts it: "Vigils held: 2".
  - A **lost Vigil** costs you nothing (you have no Health to lose), but your front deals **half its Hit to your
    partner**.
  - A Vigil can be Rescued. A won Rescue stops the front's damage, but it isn't a held Vigil.
  - In a Joined Front you may bring 2 minions (your partner brings 5).

**Ways back (only these):** your partner's **Revive** at a Hearth (their Hearth action, 5 Bond, 1 less per Vigil you
held, never less than 2; you return at 10, or 15 with a Keeper partner), a **boss victory** (10), a **Phoenix Ember**
(8, at once), the **Old Hearth** event (15). There is no way to bring yourself back: your partner always pays.

**Why this can't be farmed.** Only a won Vigil lowers the price, at most one a round, at most 3 in all, and the
floor is 2 Bond plus a Hearth action. Sends earn Bond at the normal rate and nothing more. A Fallen player is strictly
worse than a living one: no boss damage, no rewards, a bill for the partner. What it gives them is a fight that
matters (protect your partner) and a number they can move (the Revive price).

**Dread 13 (the harsh rule).** The Fallen don't hold the Vigil: their front goes unanswered and hits the partner for
half its Hit every round. They still shop and send.

**If your partner falls while you are Fallen,** the run ends. The end screen shows who held out longest.

---

## 13. Two narrated example runs

### Run 1: "The Wall and the Blade" (Dread 0, Set 2, a win, 52 minutes)

**Pair:** Kevin, hero Warden (Aegis), Role **Guard**. Mike, hero Gorun (Blade Mastery), Role **Blade**. On turn 2 they
split the pool out loud: "Kobolds and Dwarves are mine, Beasts and Demons are yours." The Trail starts with Kevin.

**Act 1, The Hollows. Boss shown: Ironbell ("It punishes damage you can't control.").**
- **Step 1, Skirmish.** Mike drags onto the skull pack. Both win. Mike's tier + 1 reward offers **Twinblade** in the
  Role slot, and he takes it.
- **Step 2, Skirmish, the trade.** Kevin's Shop shows a Wolvie. Mike has two and pings it "Triple!". Kevin buys it and
  sends it (first send, free). Mike plays it, triples, and his Triple Reward Discover hits **Spots**. Bond 1. Kevin is a
  tempo turn down; the pair is up a Gilded Wolvie and a tier-up minion.
- **Step 3, the vote.** Kevin taps the Chest, Mike taps the Champion. Kevin holds the Trail, so it's the Chest, and
  Mike, without the Trail, picks first: **Ember Draught**. Kevin takes **Titan Hammer**. The leftover Wardwater becomes
  1 Bond. Bond 2.
- **Step 4, Champion: Grubb the Spellhater (bar 16).** Kevin casts one spell all turn: Shared Shield, half of it on
  Mike's Rook. Kevin's Grubb reads +2/+2; Mike's reads nothing. Round 1: Kevin wins for 7, Mike for 10. 17 of 16:
  **felled in one round.** Both won the round, so each picks a rune from 4: Kevin **Rune of Forthcoming**, Mike **Rune
  of Fury**.
- **Step 5, Hearth.** Kevin **Gilds Ott**. Mike **Engraves Rook**.
- **Ironbell, phase 1 (Twin Fronts).** Round 1: both win, 8 and 9 (17 of 24). Round 2: Kevin's Ironbell Closes at 15
  and his board falls with one Clapper left. The partner pip on Mike's portrait flips to "Lost". Mike wins for 9, and
  his Rook (a companion, Tier 1) and Twinblade (Tier 2) cross: **Rescue.** Rook attacks first and kills the Clapper.
  "Rescued!" Kevin takes 3, not 6. The crossers strike for 3. 29 of 24: the bar breaks. Bond 3.
- **Ironbell, phase 2 (Twin Fronts).** The ribbon: "The Toll fires THIS round. Ironbell Closes at 18." Kevin's Ward
  wall eats the Toll's 8 damage, three Wards popping at once, and wins slowly without passing 18. Mike pings his
  Whetstone "Carry" and puts it on Rook. Rook's first swing lands on the bell: Execute. Round 3: 10 and 12 (22 of 24).
  Round 4: both win, and the second bar breaks. Four rounds.
- **Boss rune draft.** Kevin, without the Trail, picks first: **Crown of Hunger** (cheaper tiers, can't Rest). "You're
  Tending me from now on." Mike takes **Rune of Haste**. Upgrades: Kevin **Phalanx**, Mike **Whirlwind**.

**Act 2, The Gilt Deep. Boss shown: the Hexlamp ("It punishes a pair that won't share the chores.").**
- **Parting, rows 2 and 3.** Kevin takes the Champion row: The Glasswing, alone, on a half bar of 15. He deals 11 in
  round 1 and wins round 2: felled. He picks **Rune of Bulk Order**, then an Epic forge. Mike takes the service row: at
  the Bazaar he **Removes** two Demons he never plays, and at **The Bloodforge** he chooses "Feed your ally's minion".
  He drops to 14, and Kevin Gilds his Geode Guardian. Bond 4. When the rows rejoin, Kevin's ally strip pulses with
  Mike's new runes, and Kevin pings his Gilded Guardian: "Carry".
- **Step 5, Hearth.** Kevin can't Rest (Crown of Hunger) and sits at 19. Mike **Tends** Kevin (+12, to 31) and stays
  at 14. Bond 5. Kevin **Engraves** his Guardian.
- **The Hexlamp (turns 17 to 20).** The ribbon: "Divider fires in round 3. Now +17/+17." Seventeen points of Health
  between them, and six Wicks lit.
  - Round 1: "Mike tends the lamp." Mike buys both Lamp Cinders (4 Wicks left) and still tiers up. Kevin builds:
    **Lord Bastionne**. Both win, 20 and 15. 35 of 44.
  - Round 2: Kevin tends (2 Wicks left). The Hunt is on Mike. Kevin could Steady for 2 Bond. He keeps the Bond for a
    Revive and drags the Hunt onto himself, eating the anger. "If I lose, the gap closes. If I win, the bar breaks."
    He loses, at double: 31 to 13. Mike wins for 17, and the bar breaks. Mike's Rescue loses to the last Moth. The gap
    is now 1.
  - Round 3, phase 2: four Wicks relight. The Divider fires for **+1/+1**. Mike tends 2, Kevin 1. Both win, 22 and 18.
  - Round 4: both win again. The Hexlamp goes dark and falls. Kevin is the one who paid for it, and the boss victory
    heals him half his missing Health.
- **Boss rune draft.** Nothing fits Mike's Twinblade plan, so they spend 2 Bond to re-roll it. Bond 3. **Duet:**
  **Shield and Spear.**

**Act 3, The Unlit Spire. Boss shown: Vel, the Mirror Unwritten ("It punishes a single carry.").** Mike's Engraved
Twinblade is 52/30. Kevin's Engraved Gilded Geode Guardian is 28/44, his highest-Attack minion before Bastionne's
bonus. Kevin reads the exam aloud: "Your Twinblade fights both of us." Mike takes **Headsman Vey** from a reward. Kevin
buys **Rune of the Crossing** at a Bazaar; his row is full, so he drops Rune of Bulk Order for 3 Purse. On the last
step Kevin buys **Sworn Pair**: "Lock first from now on. My Pair wants it." Mike does.
- **Vel, phase 1.** The ribbon names the copies before lock: "Kevin's Geode Guardian 28/44, Mike's Twinblade 52/30."
  On Mike's front, Vey Executes the Twinblade copy at once, but the Guardian copy walls him, and Mike loses with Vel at
  6. Kevin's Ward wall soaks the Twinblade copy's Flurry, and he wins. His survivors cross with the Crossing's +2/+2,
  finish Vel's front, and strike for 11 (a third of the cap). Mike takes 6. Round 2: both win, and the bar breaks.
- **Phase 2.** "Shatter fires in round 4. Aimed at Mike." Shatter would set Twinblade back to 2 Attack. Kevin has 3
  Bond, but a Steady would leave them short of a Revive, so he takes the aim and the anger. His Guardian drops to
  printed Attack for the fight, and his board still wins on Ward. Mike's Twinblade, untouched, hits the cap of 34. The
  bar breaks in round 4.
- **Phase 3, the Joined Front.** Each brings 3 minions and 2 runes. Kevin's board dealt less last round, so the 7th
  slot is his, and he brings the Gilded Guardian. Kevin brings Rune of Forthcoming and Rune of the Guard; Mike brings
  Rune of Fury and Rune of the Blade. Shield and Spear lands at once, on the left-most minion Mike brought, each time a
  Ward breaks. Vel copies Twinblade and Vey with Rise. Vey kills the Twinblade copy twice. The Mirror falls in the
  second Joined round.
- **End screen:** both boards, the route, "Bond earned: 9, spent: 2", and the Crossing's line: "1 Rescue, +6 Health
  given." The Crown is offered. They stop. "Crown tomorrow."

### Run 2: "The Lanterns Go Out" (Dread 6, Set 2, a loss with a lesson, 40 minutes)

**Pair:** Ana, hero Kindness, Role **Weaver**. Jo, hero Lord of the Risen, Role **Keeper**. Both like Dragons and
neither says so.

**Act 1. Boss shown: Vashka.** Ana pours Twin Embers into Jo's Rise minions; Jo's Ferry Kestrels hand Batons into
Ana's Rescues. Vashka falls in four rounds. **Boss rune draft:** Jo (without the Trail) takes **Rune of the Last
Stand**; Ana takes **Rune of Borrowed Strength** (+3/+3 to her, -1/-1 to Jo). Jo shrugs: "You carry." Upgrades: Ana
**Echo Thread**, Jo **Haunt**.

**Act 2. Boss shown: the Magpie Queen ("It punishes a single carry.").** They read it and keep going: Ana builds one
Mirrorwing that eats every spell. Both are buying Dragons, and twice Ana's Shop misses the third Mirrorwing because Jo
is holding two. Bond 4 by the Parting.
- **Parting.** Jo takes the Champion row alone: Warchief Gob, on a half bar. His Rise board can't out-Cleave the
  Goblins and he loses round 1. He could Withdraw and keep his Health. He fights on, loses again, and drops to 9.
- **Step 4, Skirmish (Bone Choir).** Jo loses. Ana wins and Rescues with two survivors, but the Rescue loses. Jo takes
  the full 8. **Jo is Fallen.**
- **Falling.** Jo keeps shopping with 2 less Gold. He finally finds what he should have sent all along: he sends Ana a
  Mirrorwing. She plays it and triples. Bond 5. "That's your Revive," Ana says.
- **Step 5, Hearth.** Ana is at 18. Jo held no Vigil (there was no fight), so the Revive costs the full 5, and she
  has exactly 5. She spends all of it and her Hearth action to **Revive** Jo at 10. She stays at 18. Bond 0.
- **The Magpie Queen.** Pilfer copies Ana's 48/48 Gilded Mirrorwing onto Jo's front every round. Round 1: Jo loses;
  Ana's Rescue wins and strikes, and Jo takes half of a doubled Hit (Last Stand keeps him Hunted): 9. He is at 1. The
  Hoard stays: only two won fronts clear it. Round 2: the Rescue loses and Jo falls again, mid-boss. Now only Ana's
  board fills the bar. Jo's Vigil holds round 3 (no damage to Ana; "Vigils held: 1"), loses round 4 (4 to Ana), and
  holds round 5 (2). Ana breaks the second bar in round 6 with Enrage on, at 5 Health. The boss victory returns Jo at
  10. Duet: **The Long Song**.

**Act 3. Boss shown: Vel ("It punishes a single carry.").** Ana's Mirrorwing is now 70/70; her next minion is 11/14.
- **Phase 1:** Vel puts a 70/70 copy on both fronts. Jo's front can't kill it. Ana's front has no Execute and no way
  through her own carry. They lose rounds 1 and 2 on both fronts. Jo falls in round 3. His Vigil loses twice to a copy
  of his partner's carry, and the spill finishes Ana in round 5.
- **End screen:** "Vel: punishes a single carry. Your best minion had 70 Attack. Your next had 11." The replay of round
  2 shows Ana's carry killing Ana's carry, twice. And a second line: "Mirrorwing copies Jo held: 2. Copies sent: 1, on
  turn 15." They queue again with Guard and Weaver, and this time they split the tribes before turn 2.

---

## 14. Exciting moments catalogue

1. **The cross-table triple.** You send the third copy; your partner's Gilded minion lands and their Triple Reward
   Discover pops while you watch.
2. **The Rescue that finishes it.** Your fight is over, your survivors cross, finish your partner's fight at the last
   minion, and chip the boss on the way out. The bar breaks on a Rescue.
3. **"Kill the Blades."** You open the Long Patrol and fall, but only one Patrol Blade is left alive, so Vask is
   +3/+3, not +15/+15. Your partner closes it.
4. **The Closer's call.** Leg 1 ends with both Shieldmen standing. You drag your Cleave minion to the front with two
   seconds left.
5. **The Baton pass.** Your board loses, and your dying Kestrels hand their Batons to the rescuers who just arrived.
6. **"Give me the cannon."** The wall drags the aim to itself, the boss gets angry, and the wall eats it anyway.
7. **One-round Champion.** 17 of 16. Both of you pick from four runes.
8. **The Withdraw you didn't take.** Round 2 of a Champion, both at low Health, one tap away from leaving.
9. **The early split.** Mother Hollow splits after round 1 into 4/12 Halves because you both went all in on turn 6.
10. **The chore swap.** "This turn is yours to build. I'll clean the lamp." Next turn you swap.
11. **The Divider closes.** The healthier player takes the Hunt to close a 17-point gap before the charge fires.
12. **Ward from across the table.** Shared Shield lands on your partner's carry two seconds before they lock.
13. **The Clockwright budget.** "Don't play it. Send it to me." Ticks 9 of 10 at the lock.
14. **The twins in one round.** Two fronts, two kills, one round. Both players stand up.
15. **Your carry, their problem.** The Magpie Queen Pilfers your 48/48 onto your partner's front, and your partner's
    Execute minion deletes it.
16. **The copy you planned for.** Vel names your carry before you lock, and Headsman Vey is waiting.
17. **The Vigil holds.** You are Fallen, but your board beats your front, and your partner takes nothing.
18. **The price drops.** "Vigils held: 3." The Revive is down to 2 Bond, and your partner has exactly 2.
19. **The Revive.** The last Hearth before the boss, every Bond in the meter, and your partner walks back in.
20. **The Joined Front.** Seven minions and four runes from two players, one fight that ends the act.
21. **The Boss rune you take for them.** "Take Crown of Hunger. I'll Tend you." They do.
22. **Sever.** "Now +12/+12." One more send before the road closes, or not?
23. **The Crown Divides.** The channel closes, and you find out whether your build stands on its own.
24. **The Blind Seer pings.** One of you took Rune of the Blind Seer and can't see intents. The other pings every one
    ("Danger", "Kill first"), and the blind player's extra Shop minion finds the triple.
25. **Sworn Pair.** "Lock first. My Pair wants it." The +2/+2 lands as your partner hits End Turn.

---

## 15. Architecture mapping onto ASCENT

### 15.1 Reused as-is

| Kinbound need | Existing piece |
|---|---|
| Shop turn, all actions, Gold curve, tiers, keywords, triples, Gilded, Discover, Choose One, Whispers, Equipment, Rubies, Starform | `reducer.ts`, `recruit.ts`, `shop.ts`, `config.ts`, `whisper.ts`, `equipment.ts`, `starform.ts` |
| Every fight | `simulate()` unchanged in shape; formats are compositions of calls |
| Enemy passives | enemy `CombatSideState` (`questMods`, Auras, spell power, hand spells) |
| Rooms, seats, ready gate, Hero Select, server deadline, lock with `deferFight`, auto-resolve at 0:00, pause and reconnect, spectators, emotes, protocol and content stamps | Versus (`sim/src/versus/*`, `ui/src/versus/*`, versus SQL, `versus-resolve`) |
| Relics | runes and the Runeforge (offers, re-roll, duplicates, board-fit) |
| Upgrades | the Gild primitive (Indy, Auric Runemaster), Engraved |
| Companions | archived Henchmen registry |
| Role upgrade | the Ancients pairing pattern (milestone Discover, run-long change) |
| "Vigils held" counter | the quest progress pill (UI only; no quest engine needed) |
| Tonics | next-combat spells / `bankedCast` |
| Junk | Starform shop-resident pinning, Fodder, the rune row |
| Encounter boards | `AuthoredOmen` / Practice-bot pattern, `BOT_LEVELS`, `UTILITY_ROSTER` |
| Damage and Hit | the lobby damage formula, Armor |
| Clockwright Ticks | the existing "cards played this turn" counter (Striker, Kringle) on each `RunState` |
| End screen and replays | match details, deterministic replays |
| Live card text | `cardText.ts` helpers on both chains |

### 15.2 Extended

| Piece | Extension | Size |
|---|---|---|
| `RunMode` | add `'kinbound'`; `poolOf` gains the mode filter (hero allow-list, lobby-only runes out, per-player Remove-card and Remove-tribe filters) | S |
| Pool | one pool for two `RunState`s at `POOL_QUANTITIES` x2 (a mode constant, fixed per set before Phase 1), with copy moves on send | S to M |
| `SetDef` | a Kinbound overlay on the live set: its 5 tribes plus `own` Role cards (reward-only, never in the Shop draw) and enemy tokens | S |
| Hero powers | 4 ally clauses as a new param on existing `HeroPowerKind`s | S |
| Runeforge | Champion picks with skip, Purse pricing (Bazaar), map placement instead of turns 6 and 9, the 6-slot row with drop-for-Purse | S |
| Henchmen | Kinbound settings (free start, no decay, Hearth return), a Hearth growth hook | S |
| Discover | rewards (skip, give away), Chest picks, Boss rune and Duet drafts | S |
| Clock | Quiet-turn multiplier on the server deadline | S |
| Versus resolver | `resolveKinboundNode`: builds enemy fronts from encounter id, seed, boss state and Dread; runs up to 3 legs; returns all legs | M |
| Combat input | a per-minion `socSpent` flag on `BoardMinion` (the continuation rule; additive, defaults false) | S |
| Combat output | `CombatResult` gains a final-board snapshot for both sides (for continuation) and a `batonOut` list (additive; shared `types.ts`, coordinate with Mike) | S |
| Match details | two boards, a route, multiple legs per node | M |

### 15.3 New systems

**A. Team state (M).** `KinboundState` held server-side: map (seeded DAG), current node, votes, the Trail, Bond, boss
and Champion state (bars, phase, round, intent queue, Countdowns, aims, Hoard, Wicks, Tender, Sever), Fallen flags
and Vigils held, the Duet, Dread. Each player's `RunState` stays as it is; team state
wraps both. The run reducer stays round-shaped: a node is a round, and the map decides what the round's fight is.

**B. Fight orchestration (M).** Four formats, all orchestration over `simulate`:
- **Twin Fronts:** two independent calls.
- **Rescue:** one continuation call. The winner's survivors and the enemy survivors come from the final-board
  snapshot with current stats and consumed flags, each marked `socSpent`. The arriving side is the existing
  `firstSide`. Rescue triggers fire on the arriving side at the start of the leg.
- **Relay:** leg 1 is a normal call (Opener vs Main wave). Then the **Closer's call**: the server publishes leg 1's
  result and waits up to 8 seconds for one board-order op from the Closer (default: the locked order). Leg 2 is a
  continuation call: Main wave survivors (`socSpent`) plus the fresh Reserve, against the fresh Closer, Closer first. **The cross-leg tally** (Vask's count, the
  Hymn) is a counter on the enemy `CombatSideState` carried from leg 1's result into leg 2's input, the same way
  Pummel meters carry. The Haste valve is a check in the orchestrator.
- **Vigil:** a normal call whose result writes only team state (front stopped or not, Vigils held). No reward path
  runs.
- **Batons and "next fight" effects** write into `batonOut`; the orchestrator turns them into banked casts and summons
  on the receiving leg (a Rescue, a Closer's leg, or the next round). Nothing inside `simulate` reaches another fight.
- **Pilfer and Vel copies** are added by the orchestrator to the enemy board at resolve, from the locked boards. No
  simulator change.
- **Joined Front** builds one `CombatSideState`: per numeric field the max of the two players, per tribe Aura the max,
  rune flags from the **4 brought runes plus the Duet** (duplicates once), hand-spell lists concatenated. Minions are
  combat-only copies with an owner tag used only for text, FX and carry-back routing. No per-minion side context.
- Every leg is its own event log and replays through the normal Choreographer.

**C. Team ops (M).** Real-time cross-player effects in the Shop:
- Sends, Send Gold, ally-targeted casts, aim moves, pack, front and Relay picks, Joined row placements and the
  Closer's call go through a `kinbound_team_op` RPC. The server sequences, validates (Gold, sends left, target exists,
  **ally not locked**, hand room, the lock-commit rule) and broadcasts.
- **The receiving seat's reducer applies it** as an `applyAllyOp` action, in sequence order. If the target left the
  board in the same instant, the reducer fizzles it and the server refunds the sender.
- **No inbound queue and no resolve cut**: ops against a locked seat are refused, and a fight only resolves once both
  have locked. **Lock-time compiled effects** (ally Start of Combat, ally End of Turn effects) are applied by the
  server at resolve, before any leg, and never race.
- **Determinism:** each seat's action log, including its applied ally ops with their sequence numbers, is a full
  replay. Lock checkpoints carry the last op sequence number, so a reconnecting client catches up exactly (the
  `catchUpVersusRun` pattern).

**D. Intents, Hex, phases (M).** Authored per boss: `{ cycle[], antiRepeat, phases[{ bar, format, fronts, reserve?,
intents }], enrageFrom }`. Combat intents compile to enemy side state and banked casts. Aims are team-state fields;
"anger" is a banked +4/+4 on the aimed front. Hex compiles to Shop dial modifiers on one player for one turn (a small
set of reducer hooks, like a per-turn rift), checked against the budget table by a zod rule at data-validation time.
The Hexlamp's Tending (its Lamp Cinders) is a boss-mechanic def, not a Hex def, and the same zod rule checks it
against the same budget.

**E. Map and nodes (M).** Seeded DAG generation with the anchor rules, vote flow with the Trail, Parting rows, service
handlers (Hearth, Bazaar, Chest, events). Events are data: `{ id, act, conditions, joint, choices[{ text, cost,
reward }] }`, with rewards on `applyQuestReward` kinds where they fit.

**F. Sends, Send Gold, Bond (S to M).** Transfer rules, pool copy moves, triple counting on receipt, the Bond ledger
(gains and spends as team-state events, so the end screen can show "Bond earned").

**G. Triggers and keywords (M).** Trigger word **Rescue** and keyword **Baton** (code, pill, glossary). New watchers:
`allySpellCast`, `allyLocked`, `hearthVisit`, `relayRole` (open or close). Every one obeys the hard rules: seeded RNG
only, `stateOf(side)` reads, bounded recursion, cross-phase by default, current-value text on both chains, a patch
note, an oracle rule per fix.

### 15.4 New effect primitives (enumerated)

1. `allyTarget` scope on targeted spells, Shouts and hero powers (C).
2. `allyStartOfCombat` and `allyEndOfTurn` (applied at resolve into the receiver's banked casts or board).
3. `baton` (a death trigger that writes to `batonOut`).
4. `rescueTrigger` (fires on arrival in a Rescue leg) and `relayRole` reads (Rune of the Opener and Closer, Closing
   Strike, Relay Runner, Finisher).
5. `damageTakenThreshold` (Ironbell's Close), and a cross-leg tally on the enemy side state for Relays (Vask's count,
   the Hymn).
6. `summonToOppositeSide`, **in-leg only** (the Pale Choir's phase 2). It never crosses legs: the flipped bodies are
   ordinary Main wave survivors, carried into leg 2 by the continuation rule.
7. `burnHero` (Start-of-Combat damage to the opposing player, Armor first, win or lose).
8. `shopResident` tokens Husk, Cinder and Lamp Cinder (the Starform pinning rule, generalised); `handCurse` (Rust
   Coin); `runeCurse` (Hex Scar).
9. Hex dial overrides (per turn, per player).
10. `teamTally` (the Clockwright's shared Ticks: the sum of both seats' cards-played counters; the Hexlamp's Wicks).
11. `regainExecute` (Headsman Vey), unless an existing factory already restores Execute.
12. Orchestrator-only (no simulator change): Pilfer and Vel copies, the Joined side builder, continuation inputs,
    the Closer's call, Vigil results, Fallen-front damage.

Removed in revisions: `allyDamageToMeter` (Bloodtrail and the old Bonecleaver), the only primitive that needed to
resolve at settle, and `pairedRune` (Paired runes are parked).

### 15.5 Rooms and the server

- **Room flow is Versus:** host creates a Kinbound room, the partner joins P2, spectators allowed, Start, ready gate,
  Hero Select, then Roles (15 seconds).
- **Each turn** both lock with `faceOmen { deferFight: true }`. The **Kinbound resolve function** (a sibling of
  `versus-resolve`: the same esbuild bundle of core and content, plus encounter and boss data) builds enemy fronts,
  runs at most 3 `simulate` calls (two fronts and a Rescue, two Relay legs, or one Joined fight), updates team state
  (Health, Bond, bars, Fallen, Vigils held) and commits idempotently. A Relay resolves in two steps around the
  Closer's call. Clients `landCombat` and replay the legs.
- **Parity:** the byte-for-byte Node vs Edge parity test Versus uses, extended to every format.
- **Content stamps** already refuse mismatched clients; encounter data rides that stamp.

### 15.6 Determinism and seeds

- `runSeed` from the server at room start. Map: `fork(runSeed, 'map', act)`. Encounters: `fork(runSeed, 'enc', act,
  step)`. Legs: `fork(runSeed, 'leg', act, step, legIndex)`. Intents: `fork(runSeed, 'intent', act, round)`. Each
  player's own `RunState`: `fork(runSeed, 'seat', seat)`, so Shop rolls are private and replayable. The shared pool's
  draws are per seat but read one copy table, so the order of the two seats' buys is part of the op sequence.
- No coin flips between players exist (the Trail replaced them), so the only randomness is the seeded kind.
- A run replays fully from runSeed, both action logs (with their applied ally ops) and team-state events.

### 15.7 Persistence, reconnect, sessions

- **A run is one sitting (45 to 55 minutes),** so Phase 1 needs only what Versus has: pause up to 30 seconds on a
  disconnect, lock checkpoints, `catchUpVersusRun`.
- **Crash recovery (Phase 2, S to M):** a `kinbound_runs` row checkpointed at each node boundary (team state plus both
  `RunState`s). "Continue Road" within 24 hours re-forms the room at the last node boundary. Mid-turn state is never
  resumed.
- **Isolation like Versus:** a Kinbound run never touches the lobby save slot, rating or the opponent pool.
- Saving across evenings is only needed if the full road grows longer; it is Phase 3 and not required by this scope.

### 15.8 Leaving, and the AI partner

- **Disconnect mid-turn:** Versus rules. Pause up to 30 seconds, then the absent board auto-locks (seeded legal picks).
  After 3 auto-locked turns the **Kinbound bot** takes the seat. It is co-op, so never a forfeit.
- **Leaving:** "Leave Road" in the Esc menu hands your seat to the bot. The partner can continue. A run finished with a
  bot seat still unlocks Dread for the human who stayed. Three leaves in a week from stranger rooms puts a 30-minute
  cooldown on stranger matchmaking (friends are never limited).
- **Rejoining:** a returning partner takes the seat back at the next node boundary.
- **The Kinbound bot:** the Practice-bot Shop heuristics, picking rewards by board-fit. Co-op rules kept simple: plays
  sent cards unless they break its own triple, sends the third copy of anything the human holds two of, casts ally
  spells on the human's highest-Attack minion, takes the front the human didn't pick, opens Relays when it is the Guard
  or the weaker board, votes with the human, takes an aim when the human is at lower Health, tends the lamp when it is
  the Tender, Revives when it can.
- **Bot bar (a stated risk, tied to real data):** at turns 7, 12 and 17, the Kinbound bot's median board must reach
  **at least 90% of the median recorded human snapshot board at the same wave**, using the same weighted-strength
  measure the lobby strength reference already uses. It is measured before the bot is used in any fun test or as a
  solo partner.
- **Solo Kinbound:** start a run with the bot as partner. It is the balance driver's main tool, and a fallback for
  players without a partner, not the way the mode's fun is judged.

### 15.9 Spectators and matchmaking

- **Spectators (REUSE):** up to 20, as in Versus, switching between the two players' screens.
- **Friends:** room code or invite.
- **Strangers (Phase 2):** a "Find a partner" queue matched by highest Dread unlocked (within 2) and region. Strangers
  talk through emotes and pings only.

### 15.10 Presentation and the honest UI list

**Genuinely new compositions (4):** the **map screen**, the **ally strip**, the **intent ribbon**, and the **boss bar
with phase segments** (it also carries Wicks and the Champion bar). Each is built from existing primitives
(panel, card-frame pills, Gold-pill text, the board slot component) with painted art for backgrounds and icons.

**Existing components in new places:** Purse (the Gold pill), Bond (the Resolve slot), the Trail and the partner pip
(existing pills), "Vigils held" (the quest progress pill), Tonic belt (the Equipment slot), pings (the emote wheel),
Peek (the spectator view), rewards, Chests, Boss runes, Duets and Role upgrades (the Discover modal), events (the
Choose One modal), Hearth and Bazaar (the Choose One and Runeforge modals), the Relay Open and Close slots and the
Joined row (the board slot component), "Leave Road" (the Esc menu), the end screen (match details), the room (Versus
room and seats), Hero Select, the clock.

| Beat | What the player sees | Length | Built from |
|---|---|---|---|
| Pack, front or Relay pick | Portrait chips snap onto the pack, front or slot | 0.3 s | portrait chip, transform only |
| Rescue | Survivors lift and leave the screen edge; the lost fight's arena loads with them entering left; label "Rescue" | 1.5 s | arena swap + summon entry |
| Rescued! and strike | One-shot pop on both portraits; the bar ticks down | 0.8 s | existing `questbounce`-style one-shot |
| Relay hand-off | The Opener's arena fades; the Closer's loads with the Main wave survivors already standing and the Reserve entering right; label "Closing" | 1.5 s | arena swap + summon entry |
| Baton | A small token flies from the dying minion to the ally's portrait; label "Baton" | 0.6 s | existing to-hand beat |
| Anger | The aimed front's left-most minion gets the buff pop; line "It is angry it missed you." | 0.8 s | existing `cardbuff` |
| Phase change | The next bar lights; one-line rule card ("She splits: Halves are 9/24.") | 2 s | announcer line + intent ribbon |
| Closer's call | Leg 1's result freezes; an 8-second ring on the Closer's portrait; the board can be dragged | 0 to 8 s | the existing clock ring, transform only |
| Breach Cannon | The Countdown pill hits 0; the existing AoE beat on the aimed board | 1.5 s | existing Start-of-Combat AoE beat |
| Pilfer / Vel copy | A copy fades in on the enemy front with its owner's name | 1 s | summon beat + owner tag |
| Wick snuffed | One Wick icon on the bar dims (opacity) | 0.3 s | opacity only |
| Parting rejoin | One-shot pulse on the ally strip | 0.6 s | ally strip pulse |

**Twin Fronts on screen:** you watch your own fight with the partner pip live. When both are done, the existing
fight-end banner shows both results in one line, and any Rescue plays **on both screens** (the shared moment). Your
partner's fight is a replay button at 2x. **A Relay** plays both legs on both screens in order: the Closer watches the
Opener's leg because it is their briefing for the Closer's call.

### 15.11 Performance (160 fps)

- One arena at a time. Legs play in sequence. The partner's fight is never a second live arena; the partner pip reads
  their event log as numbers.
- The ally strip is memoized DOM text; it re-renders only when a digest changes.
- Peek uses the spectator stream, which costs nothing until opened.
- The intent ribbon, map highlights, ping pills, the Trail, the pip and the Bond counter animate transform and opacity
  only, with static shadows and one-shot pulses.
- Ally ops change stats, never layout, so drag-time cached rects stay valid.
- Server: at most 3 `simulate` calls per node per pair, each the size of a lobby fight.

### 15.12 Tuning (assumption first, then measure)

The headless balance runner gains a Kinbound driver (bot pairs over many seeds):
1. **Reference boards:** median and 80th percentile total stats from snapshot boards at waves 7, 17 and 26. If they
   differ from 9.5 by more than 15%, rescale enemy fronts, not player rules.
2. **Uplift:** compare Kinbound bot boards to lobby bot boards at the same turn. Set each act's uplift from the
   measured gap (the 1.10 / 1.25 / 1.35 guesses are placeholders).
3. **Pool:** measure the triple rate per player against a solo lobby run at the same turn, for a pair that splits
   tribes and a pair that overlaps. Target: split pair within 10% of solo by turn 15; overlap pair 15 to 30% lower. If
   the split pair is off, adjust the x2 multiplier (a mode constant), not the Shop. Adjust only in steps of 0.5, settle
   it once per set before Phase 1, and then freeze it, so triple feel doesn't drift between patches.
4. **Rune density, with named fallbacks.** Measure win rate by rune count at Act 3 arrival, and audit every pair of
   combat flags the Joined Front can carry. If Act 3 win rate at Dread 0 lands more than 10 points over target:
   (a) Champion rune picks become "a rune **or** 6 Purse" with Basic only in every act; then if still over,
   (b) the rune row drops to 5; then (c) any flag pair whose measured win-rate swing exceeds 15 points goes on a
   Joined deny list (the second brought rune of that pair is inert there, and the bring panel says so).
5. **Caps and the snowball:** the share of boss phases broken in one round should be about 10% for median pairs and
   35 to 50% for the top fifth. If the top fifth sits over 50%, lower the caps; under 25%, raise them. If median pairs
   exceed 20%, raise the bars. Also check the gap: the top fifth's Act 3 win rate should sit no more than 30 points
   over the median pair's.
6. **Fallen:** Vigil win rate, average Revive price paid, and Bond at the cap. Targets: a Fallen player sends or
   Vigils every turn; the average Revive costs 3 or more; Bond reaches the cap of 8 in fewer than 1 run in 5. The
   "let one fall" line must never win more often than keeping both alive (if it does, a won Vigil stops only half the
   front's damage).
7. **Targets at Dread 0:** Act 1 boss win rate 85%, Act 2 65%, Act 3 60%, Crown 50% given arrival. Each boss must end
   the run for at least one Role pairing twice as often as for the others (proof it's an exam).
8. **Pacing:** median run length within 8 minutes of 50, **and** median turns per act within 1 of the target (10, 10,
   10).
9. **The sacrificial board test.** A bot pair where one player builds all-in and the other throws its board to feed
   Rescues must **win less often** than a bot pair with two honest boards, at every act. If it doesn't, a won Rescue
   halves less (the lost player takes three quarters), then the strike drops to a quarter of the cap.

### 15.13 Main build risks

1. **Act 3 past the recorded curve** (turns 25 to 30). Mitigation: measure with the bot driver before Act 3 content is
   written; Act 3 has only 4 steps; strong pairs finish earlier.
2. **Extra runes** on a game balanced for 2 or 3 per run. Mitigation: the 6-slot row, Basic Champion picks, 2-rune
   Joined bring, and the three fallbacks in 15.12 point 4.
3. **Team ops across two reducers:** ordering, fizzle refunds, live text that reads another player. Mitigation: the
   lock refusal rule removes the hardest cases; a fidelity test over recorded op logs.
4. **Continuation fidelity (Rescue and Relay):** every per-instance flag must carry (Rise used, Ward broken, Pummel
   meters, Ruby tallies, `socSpent`, the cross-leg tally). Mitigation: a continuation fidelity test modelled on the
   snapshot fidelity audits.
5. **Shared pool across two seats:** draw order and copy accounting must be exact for replays. Mitigation: pool ops
   ride the same sequenced op log as ally ops.
6. **Role-pairing balance** (6 pairings at Dread 0 to 4, 10 at 5+, times 11 bosses). Mitigation: the bot driver first.
7. **Bot quality** (Phase 0a and solo play). Mitigation: the bot bar in 15.8, tied to recorded human boards; the fun
   verdict comes from humans (16.1).
8. **Rescue as a crutch.** If a lost front plus a Rescue is ever cheaper than two honest fights, pairs will throw
   boards. Mitigation: the Rescue's low price (8.7 B) and the sacrificial board test (15.12 point 9).
9. **The Closer waits.** In a Relay, the Closer's board fights second. Mitigation: Relays are rare (two bosses' phases
   and one Champion), leg 1 is short, and the Closer's call gives the wait a decision.
10. **Scope.** Mitigation: the thin Phase 0 (16.1).

---

## 16. MVP vs full vision

### 16.1 Phase 0: "One Hollow" (two steps)

**Phase 0a: systems, offline, one human and the Kinbound bot (M).**
- **Act 1 only:** 5 steps on a fixed small map, then the boss. Nodes: Skirmish, Champion, Hearth (Rest, Tend, Gild,
  Engrave), Runeforge. No Bazaar, Chest, Mystery or Parting.
- **Formats:** Twin Fronts and Rescue (with the strike). Both reducers run on one client, so ally effects are
  trivially real-time.
- **One boss: Mother Hollow.** Two Champions (Grubb, the Sleeping Vault) on the two-round bar. Six Skirmish
  encounters.
- **Two Roles, Guard and Blade,** 8 cards each, Role runes, companions. No upgrades yet.
- **Sends** (cards and Gold), **Bond** with one spend (Revive), the Trail, the Fallen rules with the Vigil. Intents: Hit, Sharpen, Brace, Brood, Hunt (with aims and anger). No Hex.
- End screen with replays. No server, no persistence.
- **What it answers:** does the burst check read, do caps above the median feel like "my build broke the boss", does
  the Rescue strike land, is the Vigil a real fight, is the bot good enough (the 15.8 bar). It does **not** answer
  whether co-op is fun.

**Phase 0b: the social test, two humans, a dev-only room (S to M on top of 0a).**
- **Transport:** the Versus room, seats and realtime channel, unchanged. **The host's client resolves fights**
  locally with the same `simulate()`; the guest re-simulates each leg and flags any mismatch (the sim is
  deterministic, so a mismatch is a bug). No Edge Function, no parity suite, no anti-cheat: friends only, behind a dev
  flag.
- **Same content as 0a**, plus the Long Patrol Champion (to test one Relay and the Closer's call).
- **Played by 6 or more real pairs** (Kevin and Mike, then friends), some on voice and some on pings only.
- **What it must answer:** is the Rescue exciting, does sending feel generous rather than taxing, do pings carry a
  pair with no voice, does one player take over, does falling feel scary but playable, is the Relay order a real
  conversation. Logged per turn: sends, pings, aim moves, lock order, who decided votes. If the answers are no, stop here
  and rethink before building the server.

### 16.2 Phase 1: "Two on the Road" (online; Acts 1 and 2) (L)

- Room flow on Versus plumbing, the Kinbound resolve function, the team-op RPC, parity tests for every format.
- Pings, Peek, ally strip, partner pip, reconnect and bot takeover, the leave policy.
- Act 1's other bosses (Vashka, Ironbell). Act 2 with Parting, Bazaar, Chest, Mystery, Hex with the budget, Role
  upgrades, Boss runes, ally runes, Tonics, junk, 11 events, the Long Patrol, and 4 Act 2 bosses (Gilt
  Twins, Magpie Queen, Brassjaw, the Hexlamp).
- The First Road tutorial.
- A playable 2-act road (about 30 minutes) is shippable as an early access mode.

### 16.3 Phase 2: "The Spire" (M to L)

- Act 3 (Clockwright, Vel, Pale Choir), the Joined Front with the 2-rune bring, Duets, Weaver and Keeper Roles, Dread 1
  to 12, crash recovery, the Weekly Road, stranger matchmaking.

### 16.4 Phase 3: "The Crown and beyond" (M each)

- The Crown with Sever, Dread 13 to 15, the Tithe Collector and more bosses per act, Paired runes (10.4), more Roles (a Ruby Role, a
  Starform Role once Set 4 ships), more events, and an async "play your half later" mode against a recorded partner
  log.

### 16.5 Sizes at a glance

| Item | Size |
|---|---|
| Map + node flow + Parting + Trail + team state | M |
| Fight orchestration (Twin Fronts, Rescue, Relay, Vigil, Joined) | M |
| Kinbound resolve function + parity | M |
| Phase 0b host-resolved dev room | S to M |
| Team ops (with the lock refusal rule) | M |
| Shared pool across two seats | S to M |
| Lock-time compiled ally effects + Batons | S |
| Intents + Hex budget + phases + aims | M |
| Sends + Send Gold + Bond | S to M |
| Purse, rewards, Hearth, Bazaar, Remove a card or tribe, Chest | M |
| Fallen rules and the Vigil | S |
| First Road tutorial | M |
| Roles x4 (runes, companions, 48 cards) | M (data) |
| Boss runes + ally runes + Duets (34) | M (mostly data on reward kinds) |
| 11 bosses + the Crown + 9 Champions + ~20 Skirmishes | M (data) + S per new primitive |
| Crash recovery | S to M |
| Kinbound bot (to the bot bar) | M |
| Dread ladder | S |
| Stranger matchmaking | M |

### 16.6 Art (placeholder first; the owner names files before any wiring)

Placeholders: map backgrounds reuse each act's nearest existing backdrop; node icons use existing card-frame pills with
text; bosses use the art of the nearest existing minion (a Demon brute for Mother Hollow, Brood Matron for Vashka,
Geode Guardian for Ironbell); Role cards reuse existing minion art from matching tribes. The Trail, pip and "Vigils held"
use existing pills with text.

Owed painted art (none of it code-drawn), by phase:
- **Phase 0:** 1 act map background, 4 node icons, Mother Hollow and her Halves, 2 Champion portraits, 2 Role emblems,
  2 companions, 16 card arts, 6 intent icons.
- **Later:** 2 more act backgrounds and the Crown, 5 more node icons, 10 boss portraits plus 2 Crown phases, 7
  Champions, 2 Role emblems and companions, 32 more card arts, ~24 enemy tokens, 10 Tonic icons, 34 rune icons, 2 intent icons, 5 junk cards, a Wick icon, Hearth and Bazaar panel art, the Bond
  counter frame, a Trail lantern icon.

---

## 17. Open questions for the owner

1. **Name:** Kinbound, or *Two Lanterns*, *The Underway*, *Shared Road*?
2. **Health:** separate Health per player (this scope), or one shared pool like Battlegrounds Duos?
3. **Falling:** is "no boss damage, no rewards, a 5-Bond Revive your partner pays, and a Vigil that guards them and
   lowers the price" the right weight? (Dread 13 removes the Vigil.)
4. **Hex:** OK for bosses to change one player's Shop for one turn, inside a 2-Gold budget and shown a Shop ahead? And
   is the Hexlamp, whose whole fight is that chore, welcome?
5. **Map lines:** plain connector lines in the rail style, or keep the no-lines highlight map?
6. **Lost Patrol:** may it use anonymised boards from other Kinbound pairs (opt-in), or generated ones only?
7. **Roles:** a Role layer on top of heroes, or should the hero alone be the character?
8. **Which set:** pin Kinbound to Set 2 at launch, or wait for Set 3 (Spirits, Undead, Whispers suit Weaver and Keeper)?
9. **Pool:** one shared pool at twice the copies (this scope), or a private pool per player at normal counts?
10. **Cross-fight rule:** "an effect on your ally lands at once if it can, otherwise in their next fight that has not
    started" is how this scope keeps your real-time rule across two separate fights. Is that reading right?
11. **Phase 0** in two steps (0a with the bot, 0b with real pairs in a host-resolved dev room) before the server:
    agreed?
12. **Rescue weight:** a won Rescue halves the loss and strikes for a third of the cap, and that's all. Is that enough
    of a payoff to feel exciting, or should it be a touch bigger?
13. **The snowball brake:** caps at about 1.5x the median mean a great pair can't carry a phase with one board, and
    overkill pays nothing. OK to put a ceiling on strong pairs like this?
14. **The Closer's call:** the one input after a lock in the mode (8 seconds to reorder between Relay legs). Worth the
    small break from "lock is final", or keep the lock absolute and accept a short wait?
