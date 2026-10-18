# EXPEDITION: the two-player co-op PvE event for ASCENT (final scope, v2)

*Design scope. 2026-10-17. Design only. No code is written or implied by this document. Supersedes
`2026-10-17-coop-mode-scope.md`.*

> **How this was made.** Three independent design angles were written against one digest of ASCENT's live mechanics
> (read from `main`): **the earlier draft** (a careful Slay-the-Spire-shaped adventure), **the rival draft** (a brave raid built on a
> per-turn Link Draft and a lockstep "Tandem" fight) and **Expedition** (the earlier draft's bones plus a loud per-turn loot
> draft). A blind critic scored them against the owner's brief: Expedition 69, the rival draft 68.5, the earlier draft 57. This final
> scope keeps Expedition's loot creativity, boss-to-loot ties and visibility spec, and grafts in what the critic named:
> the rival draft's **Twin anchor**, **Threads and Resonance**, **Link levels and Melt**, the **private row with one shared
> Handshake**, **Lead-and-Follow** as the middle MVP step, **Surge bundling**, **Momentum** and a visible rubber band,
> **Fusion** as the climax, **Voltara** and the **Linkbreaker**, "every turn is a fight", **Link minions in the Shop
> pool**, and the **Ghost's gift slot**. From the earlier draft it takes **recorded-board anchoring**, the **continuation rule**,
> the **Phase 0a / 0b split**, **telegraphed Shop-touching bosses with a Gold budget**, the exam and loss lines, and
> an **honest vocabulary count** with a staged tutorial. Everything the critic called scaffolding or bookkeeping is cut:
> the 4-lane map, Roles, companions, Hearths, fightless Vaults, Partings, the Relay, the Vigil, the shared four-card
> tray, Twin Table, the loot-merge Fusions and the small stat-bump entries.

## Executive summary (15 lines)

1. **Expedition** is ASCENT for two: same Shop, Gold, tiers, cards, keywords, heroes, runes; every fight is `simulate()`.
2. A run is 3 acts and a finale, about 28 turns and 50 to 58 minutes. **Every turn is one ASCENT turn and one fight.**
3. The map is a choice of two doors per step. Each door is a fight plus a loot flavour. No fightless nodes.
4. **Every turn a Haul arrives: 4 loot cards, you take 1, free.** Three are private. One, the **Handshake**, is shared.
5. If both of you take the Handshake it becomes a **Twin Link**: level II, firing both ways. One conversation a turn.
6. Loot rewires the two boards. **Your slot N and your partner's slot N are Twins.** Every automatic Link lands on a Twin.
7. Loot comes in 4 kinds: **Link** (run-long, levels I to III), **Graft** (on a minion), **Burst** (one-shot), **Card**.
8. Six **Threads** tie loot to ASCENT trigger families. The pair's levels per Thread wake **Resonance** I, II and III.
9. The two fights run on one step clock (**Tandem**). A Link fired in your fight lands in your partner's one step later.
10. Win your front and your survivors **Charge** into your partner's fight. A won Charge saves them from the Hit.
11. Nine bosses break ASCENT rules out loud and target the loot engine: a serpent with one body in two fights, a Tithe
    that eats the Haul, Voltara who cuts Links and then dies to them, a mirror that Fuses your boards against you.
12. **No damage caps.** Overkill becomes **Momentum** (Gold and rarity for both). Bosses gain printed **Wrath** steps
    when the pair runs ahead. Both are on screen.
13. A Fallen player is a **Ghost**: still shops, still takes loot (plus a gift slot), and can be Charged back to life.
14. **Visibility law:** every cross-board effect shows source flash, travel, landing and a name chip on both screens.
15. MVP path: offline with a bot partner, then a dev room with real pairs, then Lead-and-Follow online, then Tandem.

## Contents

1. Pitch and name
2. Pillars (fun first)
3. Core loop: one ASCENT turn per step
4. Run structure and pacing
5. Solo vs co-op split
6. Identity: heroes and the Spark Thread
7. THE HAUL: the per-turn loot system (57 entries plus 4 Grudges)
8. Other co-op mechanics: Hand Off, ally scope, Tandem, the Charge, Fusion, Momentum, Wrath
9. Bosses: 9, plus 6 Juggernauts
10. Mode-only cards and keywords (25)
11. Visibility and presentation spec
12. Difficulty (Mayhem) and falling
13. Two narrated example runs
14. Highlight moments catalogue
15. Architecture mapping and risks
16. MVP vs full vision, with sizes
17. Open questions

Player-facing strings (in quotes, on cards) follow the owner's text rules: short plain sentences, no em dashes, never
"Oath" or "climb". All numbers are first pass, to be measured by the bot driver and the dev-room pairs (16).

---

## 1. Pitch and name

**Name: EXPEDITION.** (Alternates: *Two-Fisted*, *the rival draft*.)

> Two heroes. Two boards. One Haul every turn. Grab the loot that wires your boards together, then watch your Beast's
> Echo bring your friend's Dragon back to life in a fight on the other half of the screen.

- **It is ASCENT.** Shop, Gold 3 rising to 10, tiers 1 to 6, triples, Gilded, Discover, Choose One, runes at the
  Runeforge, spells, Rubies, Whispers, Equipment, Starform. A player who knows ASCENT knows how to play.
- **Every turn opens a Haul.** Four loot cards above the Shop. You take one. Most of them do not make *your* board
  bigger. They make your boards **talk**: your Echoes fire on your partner's board, your Rallies make their minion
  attack, your dead come back on their side, your Taunt guards their carry.
- **Twins make it plannable.** Your slot 3 and your partner's slot 3 are Twins. Every Link lands on a Twin. So board
  order becomes a co-op plan: "Put Karwind in slot 2, my Wolvie lives in slot 2."
- **Fights are linked.** Your fight and your partner's run side by side on one clock. A Link in your fight crosses the
  gap and lands in theirs a step later, with a bolt both of you see.
- **Bosses break the rules out loud.** A serpent whose head is in your fight and whose tail is in your partner's, with
  one Health bar. A Tithe that steals the loot you passed on. A storm queen who cuts your Links, then takes damage
  from every Link that crosses. A mirror that copies both boards and Fuses them against you.
- **It is an event, not a ladder.** Huge numbers, "LINK x31", overkill fireworks, Gilded copies raining into both
  hands. A strong pair is meant to feel unstoppable for a turn. The bosses are built to stop them anyway.

**The north-star moment.** The ribbon reads "Jormun bites Mike's slot 2 for 30 this round." Kevin's Haul shows
**Bodyguard** and his slot 2 is a Taunt Golem: its Twin is Mike's slot 2 carry. He takes it. The Handshake is
**Ghost Relay** and both chips land on it: "Handshake!". In the fight the head lunges at Mike's carry and Kevin's Golem
steps through the gap to take the bite. Kevin's first two dead Beasts appear on Mike's front at their Twin slots. Mike's
Echohorn Rallies, triggers the ghost Grim's Echo, Mike's Beasts gain +8/+8, the tail dies on Mike's side, and the
shared body drops to 1 Health in Kevin's fight. Kevin's Wolvie finishes it. Both screens: "LINK x14". Nobody planned
it in words. They planned it in slots and loot.

---

## 2. Pillars (fun first)

1. **It is still ASCENT.** Every loot entry is data on an existing trigger, or one of a short, named list of new co-op
   primitives (15.3). The landing FX of every cross effect is the ASCENT FX players already know.
2. **Every turn has a loot moment that rewires the pair.** No turn ends without a pick. No entry is a small stat bump.
3. **Two boards, one machine.** The best loot connects a trigger on one board to a payoff on the other. The Twin rule
   makes that connection a plan, not a dice roll.
4. **If it touches your partner, both of you see it.** Source, travel, landing, chip, live text. Always (section 11).
5. **The boss is the show, and the boss reads your loot.** Each boss breaks one rule loudly, aims at the loot engine,
   and also has a weakness only the loot engine can hit.
6. **Every turn ends in a fight.** No service nodes. The map changes the fight and the loot, never skips them.
7. **Brakes only where the game would break.** Kept: printed fire caps on loop-prone Links, the Ping-pong guard, the
   7-slot board, 10-card hand, Rack size with Melt, the phase gate, and a visible Wrath step. Cut: damage caps, wasted
   overkill, currencies, budgets, Bond ledgers, Roles.
8. **One identity layer.** You are your hero plus one Spark Thread. No Roles, no companions.
9. **Falling never benches you.** A Ghost still shops, still takes loot, still fights, and can be Charged back.
10. **Snappy at all times.** 160 fps on the prod build. One Pixi arena on screen. Bolts are pooled sprites on
    transform and opacity. The partner lane is memoized DOM.

---

## 3. Core loop: one ASCENT turn per step

### 3.1 One turn, beat by beat

| Beat | What happens | Who | Seconds |
|---|---|---|---|
| **Start of Turn** | Gold refills (3, +1 a turn, cap 10). Whispers, Equipment rebuild, Start-of-Turn triggers, queued Discovers and forges, all as in ASCENT. The boss intent (or door twist) for this fight appears on the ribbon with exact numbers. | each | 0 |
| **The Haul arrives** | Four loot cards slide into the Haul row above the Shop (7.2). Not a modal. You can shop at once. | each, one card shared | 0 |
| **Shop + pick** | Normal ASCENT shopping. Take one Haul card at any moment. It resolves at once, so it shapes this turn's Shop. | each, live | the standard clock (18 to 75 s) |
| **Channel** | Hand Off cards, ally-scope casts, pings on the Handshake. Shop-phase Links fire live, with bolts on both screens. | both | inside the Shop |
| **Lock** | End Turn locks, as in Versus (`faceOmen { deferFight: true }`). End of Turn triggers fire, including cross End of Turn Links. | each | 0 |
| **Tandem fight** | Both fronts fight on one step clock on the server (8.3). Links cross. A finished winner Charges. | server, both screens | 15 to 45 |
| **Settle** | Hits, boss bars, Momentum, carry-backs. The **Link Ledger** shows for 2 s: "Kevin gave Mike +41/+33 and 2 Rise. Mike gave Kevin 3 Ward and 18 damage." | both | 2 |

### 3.2 What the pair does every turn

- **Reads the fight.** One intent, exact numbers, aimed at a front, a slot, or a Link.
- **Reads the Haul.** Yours (your board), Pull (your partner's board, turned into your loot), the **Handshake** (the same
  card for both), Wild (a rarity step up).
- **Talks about one card.** "Handshake?" on the shared card. That is the per-turn conversation, and it is short.
- **Arranges Twins.** Board order now matters across boards. The Twin guides at Start of Combat show the pairs.
- **Shops to the loot.** A pair that just took Echo Chamber starts buying Echo. That is the point.
- **Watches the machine run.** Two fights at once, bolts across the gap, a Charge when one side finishes early.

### 3.3 Why this suits two players

- ASCENT's Shop is private and simultaneous, so two people shop with zero waiting (Versus proves it).
- Auto-combat frees attention to watch the partner lane and the bolts between.
- The private row keeps solo agency. The Handshake gives one decision worth talking about, every turn, without letting
  the louder player steer both picks.
- The Twin rule turns "what is my partner doing" into "what is in my partner's slot 3", which is something you can
  act on in your own Shop.

---

## 4. Run structure and pacing

### 4.1 Shape

| Part | Turns | Ends with | ASCENT curve | Minutes |
|---|---|---|---|---|
| **Act 1: The Hollows** | 8 (turns 1 to 8) | an Act 1 boss (2 to 3 phases, 2 to 3 turns) | Tier 1 to 4, first Links | 11 to 13 |
| **Act 2: The Gilt Deep** | 8 (turns 9 to 16) | an Act 2 boss (3 phases, 3 to 4 turns) | Tier 4 to 6, engines form | 15 to 17 |
| **Act 3: The Unlit Spire** | 7 (turns 17 to 23) | an Act 3 boss (3 phases, the last one Fused) | Tier 6, full machines | 15 to 17 |
| **Finale: The Seven-Crowned Engine** | 4 to 5 | 3 crowns, the last one Fused | Tier 6, Tier 7 opens | 7 to 9 |
| **Run** | **~28** | | | **50 to 58** |

Boss turns count inside each act. About 28 turns sits inside the recorded lobby range (boards recorded into the high
20s), so every boss can be anchored to real wave-N boards (9.1). Tier 7 opens for the finale only (the Summit
precedent): the release valve for absurd power.

### 4.2 The map: two doors per step

No lane map. Each step shows **two doors** (three on the step after a boss phase). Both players tap a door (8 s).
Agreement goes at once. **A split vote alternates**: the first split of the run goes to the host, the next to the
guest, and so on. A pill on the door panel shows whose split is next. It cannot be gamed and nobody tracks it.

The act boss portrait sits at the top of the door panel from turn 1, with its exam line. The panel reuses the Menu
backdrop and the card-frame pills for doors (no code-drawn paths).

### 4.3 Door types (every door is a fight plus a flavour)

| Door | The fight | The loot twist | Reuses |
|---|---|---|---|
| **Brawl** | Two authored packs, one per front. | Normal Haul next turn. | authored boards (`AuthoredOmen` pattern with real cards) |
| **Juggernaut** (elite) | One elite split across both fronts, one shared bar, one turn (9.10). | **Pick 2** from the next Haul. | boss bar |
| **Forge Fight** | An easy Brawl. | Then a normal ASCENT Runeforge visit: Basic in Act 1, Epic in Act 2, a bonus Epic in Act 3. | Runeforge verbatim |
| **Storm Front** | A Brawl with a mutator on all four sides ("All minions have Flurry this fight."). | Next Haul is **all one Thread**, the storm's Thread. | rift-style combat flags |
| **Vault** | A Vault Guardian per front: a big Health pool, no attack, a timer of 12 steps. | Damage dealt to it scales the next Haul: under 50% a normal row, 50%+ a row of 6 with pick 2, 100% a row of 6 with pick 2 and the Wild at Legendary. | authored board |
| **Campfire** | A light Brawl. | After the fight each player picks one: **Rest** (heal 12), **Gild** a board minion, **Engrave** a minion, or **Revive** a Ghost partner. | Gilding, Engraved |
| **Mystery** | A random door from above, shown after the vote. | +1 rarity step on one slot of the next Haul. | |

**Anchors per act:** turn 1 is a Brawl. One Forge Fight in turns 3 to 5 in Acts 1 and 2 (so every player gets
ASCENT's Basic and Epic forge). One Campfire on the step before the boss. At least one Juggernaut door per act. The
First Road (12.5) fixes Act 1's doors on a pair's first run.

### 4.4 Boss turns

A boss is several turns. Each is a full ASCENT turn: Shop, Haul, lock, Tandem fight. A phase has a bar. Won fronts
damage the bar. A broken bar ends the phase; the next phase starts next turn, so **every phase gets a Shop and its
signature always fires in its first turn**. No damage caps. Overkill becomes Momentum (8.6).

### 4.5 Pacing model

| Part | Avg Shop | Avg Tandem fight | Overhead (Haul reveal, door vote, settle) | Per turn | Turns | Minutes |
|---|---|---|---|---|---|---|
| Act 1 | 30 s | 18 s | 10 s | ~58 s | 8 + boss | ~12 |
| Act 2 | 50 s | 28 s | 12 s | ~90 s | 8 + boss | ~16 |
| Act 3 | 60 s | 32 s | 12 s | ~104 s | 7 + boss | ~16 |
| Finale | 60 s | 40 s | 15 s | ~115 s | 4 to 5 | ~8 |
| **Run** | | | | | **~28** | **~52** |

**Valves.** Both locked ends the turn. Brawls play at 1.4x. A Charge leg against one enemy minion skips to its result.
The Haul never adds a modal: it lives inside the Shop clock.

---

## 5. Solo vs co-op split

| Moment | Solo or together | Why |
|---|---|---|
| Door vote | Together (8 s) | One short joint call. Splits alternate. |
| Shop | **Solo, with a live channel** | Your Gold, rolls, triples, tiers. You never click your partner's Shop. |
| Haul pick | **Solo row, one shared card** | Three private slots only you see. The Handshake is the same card in both rows, and both chips show on it live. |
| Board order | Solo, but read together | Twins make your order matter to your partner. Twin guides show at Start of Combat. |
| Hand Off, ally-scope casts, pings | Together | The narrow channel. |
| Lock | Solo | Lock order only matters to Mirror effects (Vel locks to the board as it is). |
| Tandem fight | **Fought apart, watched together** | Each board fights its own front; Links tie the fronts step by step. |
| Charge, Fusion | Together | One shared board moment on both screens. |
| Campfire | Solo, except Revive | |
| Runes, Discovers | Solo, private until picked | As in ASCENT. |

**Attention target:** about 60% own Shop and fight, 25% Haul and channel, 15% shared moments.

**Anti-alpha rules (real ones).**
- Your private Haul slots are **hidden from your partner until you take one**. They cannot steer what they cannot see.
- No control of the partner's Shop, Haul row or board, ever. There is no Twin Table.
- One clock for both. Coaching costs your own Shop time.
- The Handshake is the only shared card, and it only matters if **both** choose it. A lone pick still works for you.
- Bosses read both boards (Vel, the Tithe), so a passenger board loses fights the pair needs.

---

## 6. Identity: heroes and the Spark Thread

### 6.1 Heroes (reused, one allow-list)

Hero Select is Versus's: 3 private heroes, one re-roll, 20 seconds. An allow-list of about 20 heroes whose powers make
sense in PvE: Warden, Indy, Auctioneer, Soren, Nadja, Lord of the Risen, Disco Dan, Brackus, Xerox, Underdweller,
Rayse, Gorun, Robin, Darah, Kindness, Midas, Tradesman, Membrance, Cassen, Gildmaster.

- Heroes that read "an opponent" (Membrance, Underdweller) read "the enemy front you fought".
- **Ally scope on hero powers.** Any power that targets "a friendly minion" may target a minion on your partner's ally
  strip instead, for +1 Gold (Warden's Aegis on Mike's carry, Indy's Masterwork on Mike's minion, Auctioneer's Pulse on
  Mike's Shout minion). One generic primitive, not per-hero code. The targeting arrow crosses onto the ally strip, and
  the effect plays on the partner's real card with a chip (11.4).
- No Hero Link text, no Roles, no companions. Identity comes from the hero plus one Thread.

### 6.2 The Spark Thread (the only other layer)

Turn 1's Haul row is special: **six Thread cards** (Ember, Bone, Steel, Storm, Gold, Star), each showing its ASCENT
trigger family and one starter Link. You take one. It does three things:

- You get that Thread's **starter Link at level I** (7.8 marks each Thread's starter).
- Your **Yours** slot draws from your Thread 50% of the time all run.
- Your Thread's Resonance needs one fewer pair level to wake (7.6).

You are now "the Bone player", and your partner knows what that means for the Handshake. Two players may pick the
same Thread: Resonance then wakes very fast, at the cost of breadth.

### 6.3 Tribes and the pool

The pinned set's five tribes plus neutrals, as in any ASCENT run, and **one shared pool with doubled copies** (two
players draw from it). Overlap is good: two Beast boards can Hand Off Wolvies to triple. **Link minions** (10.2), about
2 per tier, join the pool as mode-only cards, so co-op content also shows up through ASCENT's own Shop.

### 6.4 Starting kit

**40 Health** plus the hero's Armor, 3 Gold, the Spark Thread pick, and the first fight. No starter spells: the first
Haul is the starter kit.

---
## 7. THE HAUL: the per-turn loot system

This is the centre of the mode. Every turn, in the Shop, with loot built to change how two boards play together.

### 7.1 The Twin rule (the one anchor)

**Your slot N and your partner's slot N are Twins.** Slots count left to right, 1 to 7, on the board as it stands
(in combat: as it stands at that step). If your partner's slot N is empty, the effect lands on their nearest minion to
the left, then to the right. The bolt always shows where it went.

Every automatic loot effect lands in exactly one of three places, and the card says which:

| Target word | Meaning | Example |
|---|---|---|
| **"its Twin"** / **"your Twin"** | the partner minion in the same slot as the source (or the target of your spell or Shout) | "When your minion dies, its Twin gains its Attack." |
| **"your partner's board"** / **"front"** | every partner minion, or an enemy on their front (normal ASCENT attack targeting: Taunt first, then random) | "Deal 8 damage to an enemy on your partner's front." |
| **"your partner"** | their hero: Gold, hand, Armor, Discovers, tier costs | "Your partner gains 1 Gold." |

There is no "left-most", "random friendly", "left-most without Ward" or "left-most Echo minion" on cross effects. A
player-chosen target (a spell, a hero power, Golden Gift) uses the targeting arrow and may pick any partner minion.

**Why it matters.** A pair can plan: "My Ghost Relay drops my dead into your slots. Keep slot 5 empty for it." "Your
Tag In makes my slot 1 attack. Put Karwind in slot 1." And the visibility law is easier to keep: every bolt goes
straight across, slot to slot, and the Twin guides (11.1) show those lines before the fight.

**Shop slots have Twins too.** Your Shop slot N and your partner's Shop slot N are Shop Twins (Market Share, 7.8 #38).

### 7.2 What loot is: four kinds

The kind is printed on the card's top pill (the existing card-frame pill). The Thread is a coloured band.

| Kind | What it is | Lasts | Lives in | Built on |
|---|---|---|---|---|
| **Link** | A rule that wires a trigger on your board to a payoff on your partner's (or both ways). Levels I, II, III. | run | your **Rack** (the rune-row component, extended) | an effect subscription with an ally scope (15.3 B) |
| **Graft** | Attaches to one minion you choose. Its text joins the minion's text. One per minion. A Gilded copy keeps it. | while the minion lives | the minion | a granted effect on the instance |
| **Burst** | A one-shot. Resolves at once in the Shop, or banks for the next fight as a pill above your hero. | one turn | a banked cast pill | Shop spells, next-combat spells |
| **Card** | A mode-only minion or spell, straight to your hand (10.3). | until used | your hand | `CardDef` data |

**Levels.** Taking a Link you already own raises it one level (I to II to III). Levels print in the frame and live
text shows the current level's numbers. A level III Link offered again becomes its **Mythic echo**: the Haul swaps it
for a Mythic of the same Thread. Duplicates always do something (the ASCENT rune rule).

**Direction.** Every Link prints its direction as two portrait chips and an arrow: "Kevin to Mike", or "Both ways"
when it is a Twin Link. A Link fires only from its owner's board unless it is a Twin Link.

### 7.3 Cadence: the Haul row

- **When.** Every turn, at Start of Turn, after Gold refills and before any modal. Boss turns included. Turn 1 is the
  Spark Thread pick (6.2).
- **Where.** A row of 4 card frames above the Shop row, the Runeforge offer-row component shown inline. It slides in
  once (transform) and stays until you lock.
- **The four slots.**

  | Slot | Pill | Built from | Who sees it |
  |---|---|---|---|
  | 1 | **Yours** | your board, hand and Rack (50% from your Spark Thread) | you |
  | 2 | **Pull** | your **partner's** board: a Link that turns their engine into your payoff, or yours into theirs. This is how a board is pulled toward its partner. | you |
  | 3 | **Handshake** | both boards: the pair's best joint fit. **The same card is in both rows.** | both, with live chips |
  | 4 | **Wild** | rarity +1 step; 50% ignores fit (a pivot or a dream); in a boss turn, the boss's themed list (9) | you |

- **Take one, free, any time in the Shop.** Click it. It resolves at once: a Link stamps into your Rack, a Card goes
  to hand, a Graft asks for a minion with the existing targeting arrow, a Burst resolves or banks. **Your partner
  sees what you took** the moment you take it (a stamp beat on your Rack tile in their ally strip and a chip: "Kevin
  took Echo Chamber"). They never see the cards you passed.
- **The Handshake.** Both rows show it. Either player can ping it ("Handshake?"). If one of you takes it, it is a
  normal level I Link for that player. **If both take it in the same turn, it becomes a Twin Link: it enters at
  level II for both of you and fires both ways.** "Handshake!" plays on both screens with one chord. If the first
  taker already resolved it at level I, it upgrades in place.
- **Handshake-only cards.** A few Mythics say "Both must take." Each prints a plain alone-text in grey under the main
  text, so a lone pick is never wasted: "Alone: your first Start of Combat effect triggers twice."
- **Refit (free, once a turn).** Redraws your Yours slot from your board **as it is right now**. It fixes the lag
  between Start of Turn and what you just bought. Seeded by turn, seat and refit count.
- **Reroll (2 Gold, once a turn).** Redraws Yours, Pull and Wild. The Handshake never rerolls. "Do I roll my Shop or
  my Haul?" is a real ASCENT decision.
- **Skip.** Lock without taking a card and your next Haul has a 5th private card and its Wild is +1 step (max one
  bank). Shown as a "+1 card" pill on your Haul tab.
- **Pick 2** (Juggernaut win, a 100% Vault): take any two, the Handshake included.

### 7.4 How offers are generated from both boards

The server builds each Haul at Start of Turn with `fork(runSeed, 'haul', turn, seat, refit)`. It is deterministic: a
replay shows the same Haul. Clients cannot fish for offers.

**Step 1. Tag profiles.** Every card, rune and loot entry carries tags, generated at build time from its effect
subscriptions and keywords (a small override file for edge cases):

| Tag group | Counted from |
|---|---|
| tribes | minions of each tribe (All-tribe counts for every tribe, as in runes) |
| triggers | Shout, Echo, Rally, Avenge, Rise/Rebirth, Start of Combat, End of Turn, Slaughter, Pummel, Overflow |
| keywords | Ward, Taunt, Flurry, Cleave, Execute, Stealth, Engraved |
| spells | Shop spells and Rubies cast last turn, Whisper sources, spell power |
| gold | Gold spent last turn, max-Gold raisers, Dwarf Gold watchers |
| shop | Starform present, shop-buff minions, Consume |
| gild | Gilded minions, pairs (2 copies) and near-triples |

A **board profile** is the tag count across the 7 board minions (Gilded counts twice), plus 1 per hand minion, plus 1
per Rack level with that tag.

**Step 2. Each entry declares an anchor.** A **from** tag (the trigger it listens to) on the owner's board and a
**to** tag (what it pays into) on the partner's board, with a weight. Score = `from(owner) x to(partner) x weight`.
Bursts and Grafts score against one board.

**Step 3. Slot rules.**

| Slot | Rule |
|---|---|
| Yours | Weighted draw from entries whose **from** is in your top 4 tags. 50% restricted to your Spark Thread. |
| Pull | Weighted draw from entries whose **to** is in your partner's top 4 tags and whose **from** you have at least 1 of, or **Pivot** (25%): a from-tag you have 0 of but your partner has 3+ of. |
| Handshake | The highest joint score among entries that work in both directions. If both boards share a top tag, it prefers that Thread (Resonance bait). In a boss turn it is 50% the boss's themed card. |
| Wild | Any entry one rarity step up. In a boss turn, 100% the boss's themed list. |

**Step 4. Guarantees.**
- **Fit floor:** at least one private card fits your board now.
- **Every row has a cross-board card** (the Handshake guarantees it).
- **No dead offers:** an entry whose from-tag is 0 on its owner's board is offered only as a Pivot.
- **No duplicates in one row.** An entry you own at level III is offered as its Mythic echo instead.
- **Anti-repeat:** an entry passed twice in a row is benched for 3 turns.
- **Turn 2** (thin boards) scores from the Spark Thread and hero only.

### 7.5 Rarity and escalation

Five rarities, shown by the existing frame gem colours. One rarity sting per card on reveal (one-shot sound).

| Rarity | Feel | Act 1 | Act 2 | Act 3 | Finale |
|---|---|---|---|---|---|
| **Basic** | a wire | 55% | 20% | 0 | 0 |
| **Rare** | a trigger crosses the gap | 35% | 40% | 30% | 0 |
| **Epic** | a tribe or trigger family plays across both boards | 10% | 32% | 42% | 45% |
| **Legendary** | build-defining, "did that just happen" most fights | 0 | 8% | 24% | 45% |
| **Mythic** | rule-breaking. Boss Hoards, Act 3 Wild, Mythic echoes. | 0 | 0 | 4% | 10% |

**Steps** (each moves one slot one row up; at most +2 steps per slot per turn):
- **Victor's pick:** you won your front: next turn your Yours slot is +1 step.
- **Double Win:** both fronts won: next turn the Handshake is +1 step.
- **Grudge:** you lost your front: next turn your Yours slot is a **Grudge** (a Burst, +1 step; 7.8 G1 to G4).
- **Momentum:** each 10 overkill past a boss bar gives one step on one slot for both players (max 2; 8.6).
- **Pity:** no Epic or better taken by you in 4 turns: your Wild is Epic.
- **Hoards.** After a boss phase breaks, the next Haul is a **Hoard**: every slot Epic or better. After the act boss
  dies, a **Boss Hoard**: every slot Legendary or better, and the Handshake is a Mythic.

**What escalates across acts (what loot does, not only rarity).**
- **Act 1: stats and keywords cross.** Start-of-Combat grants, Shop-phase Shout and spell sharing, Gold links.
- **Act 2: triggers cross live fights.** Echo Chamber, Tag In, Ghost Relay, Shared Grave. Grafts become common.
- **Act 3: systems merge.** Shared triples, merged counters, shared multipliers, FUSION.
- **Basic and Rare numbers grow by act**, printed live: a Basic taken in Act 1 shows double numbers from Act 2 on. An
  early pick is never dead weight. Level it or Melt it.

### 7.6 Threads and Resonance (the combo layer)

Six Threads, each tied to an ASCENT trigger family. Every loot entry has a Thread (Wild cards may have two).

| Thread | Colour | ASCENT mechanics |
|---|---|---|
| **Ember** | orange | Shout (Battlecry), Shout multipliers (Drakko, Orivax), Dragons, Karwind |
| **Bone** | pale green | Echo (Deathrattle), Rise, Rebirth, Avenge, Overflow, Undead Aura |
| **Steel** | silver | Ward, Resilient Ward, Taunt, Armor, Engraved |
| **Storm** | blue | Rally, Flurry, Cleave, Slaughter, Pummel, attacks |
| **Gold** | gold | Gold spent, rerolls, tier-ups, Gild and triples, Dwarves, Ales, max Gold |
| **Star** | violet | Shop spells, Rubies, Whispers, spell power, Starform, Collapse |

**Resonance** counts the **pair's total Link levels** in a Thread (a level III Link counts 3). The Spark Thread's
owner needs one fewer for step I.

| Thread | I (4 levels) | II (8) | III (12) |
|---|---|---|---|
| **Ember** | "Shouts on both boards give +1/+1 more." | "Your Shout minions trigger their Shout once more when played if their Twin has a Shout." | "Every Shout on either board also fires on its Twin." |
| **Bone** | "Rise minions on both boards return with +3/+3." | "Echoes on both boards trigger an extra time, once per minion each combat." | "The first friendly minion to die on each front each combat Rebirths." |
| **Steel** | "Start of Combat: both slot 1 minions gain Ward." | "Taunt minions on both boards have +0/+8." | "Wards on both boards absorb two hits." |
| **Storm** | "The first attack on each front each combat deals double damage." | "Rallies on both boards trigger once more, once per minion each combat." | "Every minion on both boards has Flurry for its first attack." |
| **Gold** | "You both gain 1 Gold at Start of Turn." | "Your first reroll each turn is free, for both of you." | "Triples need 2 copies, for both of you." (Rune of Twin Gilding) |
| **Star** | "You both have +1/+1 spell power." | "The first spell each of you casts each turn casts twice." | "Spells cast in combat also cast on the other front." |

The **Resonance gauge** is six small Thread pills between the two Health slots (the Resolve-slot style), each showing
the pair's count and the number to the next step. When a step wakes, its colour sweeps once across both boards
(one-shot) and a Resonance card slides into both Racks (it takes no Rack slot).

### 7.7 How picks interact: Twin Links, Combos, Melt

- **Twin Links** (Handshake taken by both) are level II and fire from both boards. They are worth more than two lone
  copies by construction: a lone pick is level I and fires one way; a Twin Link is level II and fires both ways. That
  is a rule, not a promise.
- **Same Link, two owners.** If you each own Echo Chamber from different turns, both fire. Two players can pile one
  Link from both ends. Legal and loud.
- **Combos.** Some pairs of Links, owned by **different players**, light a named **Combo**: a bonus line on both Racks.
  The first time it fires in a run, a banner names it on both screens. Combos are what a pair hunts in Act 2.

  | Combo | One player owns | The other owns | Bonus |
  |---|---|---|---|
  | **Haunted House** | Ghost Relay | Echo Chamber | Ghosts keep their Echo, and it triggers on both fronts. |
  | **Shield Wall** | Bodyguard | Lend a Shield | The guarding minion arrives with Ward. |
  | **Choir** | Chorus Line | Call and Answer | Shouts triggered by Chorus Line count as Shouts played for Call and Answer. |
  | **Thunderclap** | Tag In | Thunder Pact | A Twin that attacks from Tag In gains +4 Attack first. |
  | **Bucket Brigade** | Joint Account | Tier Draft | Gold from Joint Account counts as Gold spent for the receiver's cards. |
  | **Gem Rain** | Gemlink | Spill Over | Rubies cast on a Twin count as Ruby casts for the Twin's owner. |
  | **Night Shift** | Graveyard Shift | Shared Grave | Echoes triggered at End of Turn count for Avenge next fight. |
  | **Two-Way Street** | Return to Sender | Return to Sender | Also gives the dying minion's Health. |

- **The Rack and Melt.** The Rack holds **6 Links in Act 1, 9 in Act 2, 12 in Act 3 and the finale**. A level-up
  takes no slot. When the Rack is full, taking a new Link asks you to **Melt** one: the melted Link is gone and the
  new one **enters one level higher**. Melting is the thinning tool and it never feels like a loss. Runes keep their
  own row as in ASCENT. Grafts live on minions. Bursts are gone after use. So the Act 3 screen holds one Rack of at
  most 12, the rune row, and pills on minions. That is the clutter ceiling.
- **The Ping-pong guard.** A cross effect may start another cross effect, but **no Link fires twice in the same step
  from the same source**, and **a chain stops after 3 crossings in one step**. Loop-prone Links also print their own
  caps ("Up to 5 times each combat"). The Tandem engine has a hard backstop of 200 crossings per fight that no legal
  build reaches (it exists so a bug can never hang a fight). This is the only brake on combos.

### 7.8 The catalogue: 57 entries plus 4 Grudges

Format: **Name** (kind, rarity, Thread). Text at level I, then the level II and III changes. **Built on** names the
ASCENT mechanic. **Shown as** is the cross-board presentation, using these codes (full spec in 11):

- **BOLT**: a combat crossing. Source flash, a pooled bolt in the Thread colour flies slot to slot, the target gets
  its normal ASCENT beat, name chip on both screens.
- **SHOP**: a Shop-phase crossing. Bolt from the source card to the ally strip tile on your screen; on your partner's
  screen it enters from their ally strip and lands on the real card.
- **CROSS**: a whole minion moves between fronts (card lifts, slides to the gap, fades through, summon beat).
- **SOC**: a cross Start-of-Combat cast, shown as a banked cast with the owner's name before the first attack.
- **COIN**: a coin hops between Gold pills or onto a button.
- **STAMP**: a permanent change: one-shot gold stamp on the card plus a line in its live text.
- **TEXT**: live value on both boards (always present in addition to the above).

**Starters** (one per Thread, the Spark pick): Ember *Chorus Line*, Bone *Echo Chamber*, Steel *Lend a Shield*, Storm
*Opening Volley*, Gold *Joint Account*, Star *Spill Over*.

#### Ember (Shout)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 1 | **Chorus Line** (Link, Basic, Ember, starter) | "The first Shout you play each turn also triggers its Twin's Shout." II: first 2 Shouts. III: every Shout, once per Twin each turn. | Auctioneer's Pulse (trigger a Shout), aimed at the Twin | SHOP. Your Shout plays, a bolt crosses, the Twin's own Shout beat plays on your partner's board with "via Kevin". |
| 2 | **Call and Answer** (Link, Rare, Ember) | "When your partner plays a Shout minion, your next Shout this turn triggers twice." II: next 2. III: the rest of the turn. | trigger multiplier (`battlecry`, `factor`), turn scope | An ember spark leaves Mike's played card and lands on Kevin's hand; Shout cards there show "x2 (Mike)" until used. |
| 3 | **Two Throats** (Link, Epic, Ember) | "Your Shout multipliers also apply to your partner's Shouts." II: and theirs to yours. III: +1 extra trigger on Shouts whose Twin is the same tribe. | `TriggerMultiplierDef` read across boards (Drakko, Orivax) | A thin static ember tether from Drakko to the ally strip while active; each multiplied Shout on Mike's board reads "x2 (Kevin's Drakko)". |
| 4 | **Echo of a Voice** (Graft, Rare, Ember/Bone) | "Graft. Echo: trigger its Twin's Shout." II (Handshake): "and this minion's own Shout." | Echo, Shout re-trigger in combat | BOLT from the dying minion; the Twin's Shout beat plays in the partner's fight. |
| 5 | **War Herald** (Link, Epic, Ember) | "Start of Combat: trigger the Shout of your slot 1 minion on its Twin." II: slots 1 and 2. III: slots 1 to 3. | Shout re-trigger via the banked Start-of-Combat path | SOC beat on Kevin's front, BOLT to the Twin, the Shout FX on Mike's minion. |
| 6 | **Dragonsong** (Link, Rare, Ember) | "When a Shout gives your Dragon stats, its Twin gains the same if it is a Dragon." II: any tribe. III: twice. | Dragon Shout targeting (Karwind) | SHOP or BOLT in Dragon orange, the buff beat on the Twin. |
| 7 | **Megaphone** (Card spell, 1 Gold, Basic, Ember) | "Trigger a minion's Shout. It may be your partner's minion." | Pulse as a spell, ally scope | The targeting arrow crosses onto the ally strip; the Shout plays on the real card on Mike's screen. |

#### Bone (Echo, Rise, Avenge, death)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 8 | **Echo Chamber** (Link, Basic, Bone, starter) | "When your minion's Echo triggers, its Twin's Echo triggers too. Up to 3 times each combat." II: up to 5. III: up to 7, and the Twin's Echo summons with +2/+2. | Echo re-trigger (Echohorn, Spots) aimed at the Twin | BOLT from the dying minion; the Twin's Echo pill flashes and its Echo beat plays. |
| 9 | **Ghost Relay** (Link, Legendary, Bone) | "The first 2 of your minions to die each combat are summoned at their Twin slots on your partner's front with 1 Health. They are Ghosts and leave after the fight." II: first 3. III: with full Health. | combat-only summon (token rules), Twin slot | CROSS. The dead card lifts as a translucent copy, slides into the gap, drops into the partner's slot with the summon beat and an owner pip. Full board: Overflow fires there, chip "No room on Mike's front". |
| 10 | **Return to Sender** (Link, Epic, Bone/Storm) | "When your minion dies, its Twin gains its Attack this combat." II: and its Health. III: and its keywords. | death event, combat-only buff | BOLT carrying the number along the path ("+9"); buff beat on the Twin. |
| 11 | **Shared Grave** (Link, Epic, Bone) | "Your Avenge counts deaths on your partner's front too." II: and their Avenge counts yours. III: each death counts twice. | Avenge counter read across fronts | A small wisp per death into the Avenge minion; its counter reads "Avenge (3): 1 left (2 from Mike)". |
| 12 | **Borrowed Breath** (Link, Rare, Bone) | "When your minion Rises, its Twin gains Rise this combat." II: and +3/+3. III: Rebirth instead of Rise. | Rise and Rebirth keyword grant mid-fight | BOLT; the Rise pill pops onto the Twin with "from Kevin". |
| 13 | **The Other Side** (Link, Epic, Bone) | "When a summon on your front has no room, it is summoned at its Twin slot on your partner's front." II: with +3/+3. III: and Overflow triggers fire on both fronts. | Overflow redirected cross-front | CROSS-lite: the summon silhouette slides across and lands; Overflow beat on both. |
| 14 | **The Long Goodbye** (Graft, Epic, Bone) | "Graft. When this Rebirths, its Twin gains Rebirth." | Rebirth | BOLT, the Rebirth pill on the Twin. |
| 15 | **Last Rites** (Burst, Rare, Bone) | "Your 2 left-most Echo minions and their Twins gain Rise permanently." | Rise grant, permanent (recruit) | STAMP: four Rise pills pop in turn, alternating boards. |
| 16 | **Undertakers** (Link, Rare, Bone) | "Your Rise minions return with +3/+3 for each Rise minion on your partner's board. (Now +6/+6.)" II: +4/+4 each. III: and with Ward. | Rise, live scaler reading the partner board | TEXT on both boards; Mike's Rise minions show "Feeds Kevin's Undertakers". |
| 17 | **Graveyard Shift** (Link, Epic, Bone) | "End of Turn: trigger the Echo of your slot 1 minion and of its Twin." II: slots 1 and 2. III: 1 to 3. | Rune of the Reliquary (EoT Echo trigger) | SHOP at lock: two Echo beats, one per board, bolt between. |

#### Steel (Ward, Taunt, defence)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 18 | **Lend a Shield** (Link, Basic, Steel, starter) | "Start of Combat: each of your Taunt minions gives its Twin Ward." II: and Taunt. III: Resilient Ward instead. | Ward grant on the banked SoC path | SOC: a silver shield flies slot to slot; the Ward FX on the Twin. |
| 19 | **Bodyguard** (Burst, Epic, Steel) | "Next combat: your slot 1 Taunt guards its Twin. The first 3 attacks aimed at its Twin hit it instead." Twin Link (Handshake): 5 attacks, and slot 2 too. | Taunt, attack redirect (NEW) | CROSS: a ghost of the Taunt stands beside the Twin in the partner's arena. Each redirect draws the enemy's lunge across the gap on both screens; damage lands on the real minion in the guard's fight. |
| 20 | **Iron Twins** (Link, Epic, Steel) | "When your Taunt minion and its Twin both have Taunt, hits on either are split evenly between them." II: and both have +0/+6. III: and both have Ward at Start of Combat. | cross-front damage split (NEW `sharedBody` lite) | A static silver tether between the two for the fight; each hit shows the split number on both. |
| 21 | **Shoulder to Shoulder** (Link, Rare, Steel) | "Your Taunt minions' Twins have Taunt. When your Taunt dies, its Twin gains its Health this combat." II: and Attack. III: and Ward. | Taunt aura across fronts, death buff | Tether line at SoC (opacity in), a BOLT on death. |
| 22 | **Engrave the Pair** (Burst, Epic, Steel) | "Your slot 1 minion and its Twin gain Engraved." | Engraved keyword | STAMP: the etch FX on both cards. |
| 23 | **Armor Share** (Link, Rare, Steel) | "When you gain Armor, your partner gains the same." II: and their board gains +0/+1 per 2 Armor. III: both ways. | hero Armor (Rayse, Summit) | The Armor number floats from Kevin's portrait to Mike's. |
| 24 | **Aegis Lattice** (Link, Mythic, Steel) | "Every Ward on both boards is a Resilient Ward." | Resilient Ward (RW) | SOC: a silver lattice sweeps both arenas (one-shot); each Ward gains its second ring. |

#### Storm (Rally, attacks, Slaughter, Pummel)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 25 | **Opening Volley** (Link, Basic, Storm, starter) | "Start of Combat: the Twin of your slot 1 minion attacks at once." II: and gains +3 Attack first. III: slots 1 and 2. | "attacks immediately" (Rune of Forthcoming wording), cross | SOC, then the partner's minion lunges first with the chip "Kevin's Opening Volley". |
| 26 | **Tag In** (Link, Legendary, Storm) | "Rally: its Twin attacks at once on its own front. Once per minion each combat." II: twice. III: and the Twin gains +3 Attack first. | Rally, cross "attacks immediately" | BOLT (blue lightning), then the Twin lunges at once. "Kevin's Tag In: Mike's Karwind attacks." |
| 27 | **Thunder Pact** (Link, Epic, Storm) | "Your Rallies also trigger its Twin's Rally." II: and the Twin gains +2/+2 first. III: twice. | Rally re-trigger (Rune of Rallying), cross | BOLT, then the Twin's Rally beat. |
| 28 | **Mirror Strike** (Link, Legendary, Storm) | "When your slot 1 minion attacks, its Twin attacks too." II: slots 1 and 2. III: slots 1 to 3. | cross "attacks immediately" | A gold ring pip on each linked pair; when one lunges the other lunges on the next step with a short BOLT between. |
| 29 | **Crossfire** (Graft, Epic, Storm) | "Graft. Rally: deal damage equal to this minion's Attack to an enemy on your partner's front." | Rally, cross damage (NEW) | Projectile leaves through the gap on your screen and hits on theirs with the existing hit beat. "Kevin's Raptor: 14." |
| 30 | **Overkill Express** (Link, Epic, Storm) | "When your minion deals more damage than its target has Health, the extra hits an enemy on your partner's front." II: the extra is doubled. III: and the Twin gains it as Attack. | excess damage value, cross damage | The extra number ("+11") flies through the gap and lands as a hit. |
| 31 | **Slaughterhouse** (Link, Rare, Storm) | "When your minion kills an enemy, its Twin gains +2/+2 permanently. Up to 4 times each combat." II: +3/+3. III: and it triggers the Twin's Slaughter. | Slaughter, permanent gain (combat carry-back) | BOLT plus STAMP ("From Kevin: +6/+6 this run"). |
| 32 | **Shared Pummel** (Link, Rare, Storm) | "Damage your Twins deal also fills your Pummel meters." II: both ways. III: both meters fill double. | Pummel (lifetime damage meter) | Damage on Mike's front sends a small blue arc into Kevin's meter; chip on the first tick each fight only. |
| 33 | **Storm Bridge** (Link, Epic, Storm) | "Start of Combat: your Flurry and Cleave minions give their Twins Flurry and Cleave this combat." II: and Execute from Execute minions. III: and Immune while attacking for their first attack. | keyword grants | SOC: keyword pills fly slot to slot. |
| 34 | **Hivemind** (Link, Mythic, Storm/Bone) | "Your two fronts count as one board for Avenge, Rally and Slaughter counts." | merged counters across fronts | Counters on both boards show the merged number with a twin-chain icon. |

#### Gold (economy, Gild, triples)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 35 | **Joint Account** (Link, Basic, Gold, starter) | "Every 4 Gold you spend, your partner gains 1 Gold. Up to 3 a turn." II: every 3. III: up to 4, and it counts as Gold spent for them. | Gold-spent watcher (Coinfire, Pimm) | COIN from your Gold pill to the ally strip; on Mike's screen it lands in his pill with "+1 from Kevin". |
| 36 | **Tier Draft** (Link, Rare, Gold) | "When you tier up, your partner's next tier up costs 3 less." II: and they Discover a minion of their new tier when they do. III: both ways. | tier-up cost and discount | COIN arrow from Kevin's tier pip to Mike's upgrade button, which shows the new price "(Kevin)". |
| 37 | **Golden Gift** (Burst, Legendary, Gold) | "Gild one of your partner's minions. You choose." | the Gild primitive (Indy, Auric Runemaster) | SHOP: a gold flare crosses; the Gild beat on Mike's real card. "Kevin Gilded your Grim." |
| 38 | **Market Share** (Link, Epic, Gold) | "When a minion in your Shop gains stats, its Shop Twin in your partner's Shop gains the same. Up to 8 times a turn." II: both ways. III: and the Starform too. | shop buffs (Contract Butcher, Market Tormentor) | Bolt to the ally strip's "Shop" chip on your screen; on Mike's screen it enters his Shop row at the same slot with the buff beat. |
| 39 | **Triple Threat** (Link, Epic, Gold) | "When you make a triple, your partner Discovers a minion from one tier above their shop tier." II: both ways. III: two tiers above. | Triple Reward (Discover T+1) | Gold burst to Mike's portrait; his Discover opens with the header "Kevin's triple". |
| 40 | **Shared Triples** (Link, Mythic, Gold) | "Copies on both your boards and hands count together for triples. When one forms across both, each of you gets the Gilded copy." | triples, R-GILD-03 (board copies consumed first) | Copies slide from both boards to the centre, merge, and two Gilded cards fly to both hands. |
| 41 | **Ale for Two** (Link, Rare, Gold) | "Dwarven Ales you drink on a minion also pour on its Twin." II: twice. III: and on your partner's Shop Twin too. | Dwarven Ales (Shop spells) | SHOP with the ale foam colour. |
| 42 | **Jackpot** (Burst, Rare, Gold) | "Your next refresh, and your partner's next refresh, show minions one tier above your shop tiers." Twin Link: next 2 each. | refresh pool rule (Tier 7 precedent) | SHOP: a one-shot gold rim on Mike's refresh button and the chip "Kevin's Jackpot". |

#### Star (spells, Rubies, Whispers, Starform)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 43 | **Spill Over** (Link, Basic, Star, starter) | "Your targeted spells also cast on the target's Twin. Up to 3 a turn." II: up to 5. III: and spell power counts twice on the Twin. | targeted spell cast, spell power | SHOP: a second targeting line crosses to the Twin tile; the spell's own FX on Mike's real card. |
| 44 | **Gemlink** (Link, Rare, Star) | "Your Rubies also cast on the target's Twin. Kobold riders fire if the Twin is a Kobold." II: riders fire on any tribe. III: twice. | Rubies and their riders | SHOP in the Ruby's own colour. |
| 45 | **Power Grid** (Link, Epic, Star) | "Your spell power is yours plus your partner's. (Now +3/+2.)" II: for both of you. | `spellPowerAtk/Hp` on the side state | TEXT on every spell in hand ("+3/+2, with Mike"); a violet line on the Resonance gauge. |
| 46 | **Whisper Network** (Link, Epic, Star) | "When you get a Whisper, your partner gets a copy." II: and its stats are permanent for them. III: two copies. | Whispers (Set 3 Dragons) | The existing Whisper grant beat in Mike's hand, card tagged "From Kevin". |
| 47 | **Twin Cast** (Link, Legendary, Star) | "The first spell you cast each turn casts again on its target's Twin." II: first 2. III: and they count as your partner's casts too. | cast multipliers (Yazzus, Grimoire), cross target | The spell art flips across the screen and casts on Mike's minion. |
| 48 | **Spellstorm** (Link, Mythic, Star) | "Spells cast in combat on either front also cast on the other front, on the Twin of their target." | in-combat casts (Dragonflame, Star Crash, Queen Morro) | The spell plays on one front, its art streaks across, it plays again on the other. |
| 49 | **Shared Sky** (Link, Epic, Star; only in a Celestial set) | "You share one Starform. Shop buffs from either of you feed it. Either of you can buy it." II: it costs 2 less. III: its Collapse also feeds your partner's Celestials. | the Starform pattern | The Starform sits pinned in both Shops; each feed shows a violet mote from the partner's side. |

#### Wild (any Thread; Bursts and rule-benders)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 50 | **Swap Meet** (Burst, Epic, Wild) | "Next combat: your slot 7 minion and its Twin swap fronts. Both gain +4/+4 permanently. They come home after." | cross move at SoC (NEW `crossMove`) | CROSS: both leap into the gap at once and land in each other's arena; reverse at settle. |
| 51 | **Mirror Mirror** (Link, Epic, Wild) | "Start of Combat: summon a combat copy of your partner's highest-Attack minion on your front with half its stats." II: full stats. III: 2 copies. | SoC summon, combat-only copy | A reflection of Mike's minion slides out of the ally lane into Kevin's arena. |
| 52 | **Kin of Two Kinds** (Link, Legendary, Wild) | "Your minions also count as your partner's two biggest tribes. (Now Beast and Dragon.)" Twin Link: for both of you. | tribe counting (All-tribe precedent) | STAMP: extra tribe pills on each of your minions; Mike's board shows "Kevin counts as yours". |
| 53 | **Field Promotion** (Burst, Rare, Wild) | "Your partner Discovers a minion from one tier above their shop tier. You get the two they did not pick." | Discover, Triple Reward tier rule | Mike's Discover opens with "Kevin's Field Promotion"; Kevin's hand receives the two with "Mike passed". |
| 54 | **Twilight Pact** (Link, Mythic, Wild, Both must take) | "Both must take. Start of Combat effects on both boards trigger twice." Alone: "Your first Start of Combat effect each combat triggers twice." | Rune of Twilight (SoC repeat) | STAMP on both Racks; every SoC cast in the fight shows "x2 Twilight Pact". |
| 55 | **Overdrive** (Burst, Mythic, Wild, Both must take) | "Both must take. Next combat both boards have double Attack. If you lose a front, it takes a double Hit." Alone: "Next combat your slot 1 minion has double Attack." | combat stat flag | SOC: a one-shot red flare over both arenas. |
| 56 | **FUSION** (Link, Mythic, Wild, Both must take) | "Both must take. Once per boss, either of you may press Fuse in the Shop. If both press, your Twins fuse into one board at Start of Combat." Alone: "Once per boss: Start of Combat: your slot 1 minion gains its Twin's stats this combat." | Fuse transform (8.5) | The Fusion sequence (11.6). |
| 57 | **Copycat** (Card minion 3/3, 3 Gold, Rare, Wild) | "Shout: become a copy of its Twin, plus this card's 3/3." | copy (Xerox precedent), Twin target | SHOP: the Twin flashes on Mike's board; the copy unfolds on Kevin's with "Copy of Mike's Grim". |

#### Grudges (only in your Yours slot, the turn after you lost your front)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| G1 | **Grudge Match** (Burst, Rare) | "Next combat: your minions have +1/+1 for each damage you took last fight. (Now +9/+9.)" | combat stat flag, live scaler | SOC with a red chip "Grudge". |
| G2 | **Avenge Me** (Burst, Epic) | "Next combat: when your first minion dies, your partner's board gains +4/+4." | death trigger, cross buff | BOLT fanning to all partner tiles (one sprite per side, 11.8). |
| G3 | **Back for More** (Burst, Epic) | "Next combat: your 3 left-most minions have Rebirth." | Rebirth | SOC. |
| G4 | **Payback** (Burst, Legendary) | "Next combat: Start of Combat: deal damage equal to last fight's Hit, split among enemies on both fronts." | SoC AoE | SOC AoE beat on Kevin's front, then a projectile spray crossing to Mike's front. |

**Coverage check.** Every Thread has a starter, a Rare, an Epic, a Legendary or Mythic, and a Burst. Every ASCENT
trigger family named in the brief is a **Built on**: Shout (1 to 7), Echo (8, 17), Rise and Rebirth (12, 14, 15, 16),
Avenge (11), Start of Combat (5, 18, 25, 54), End of Turn (17), Rally (26 to 29), Slaughter (31), Pummel (32), Ward and
Taunt (18 to 24), Gild and triples (37, 39, 40), Engraved (22), Whispers (46), Starform (49), Rubies (44). There are no
flat "+1 Attack" entries: Basics are wires that grow by act and level.

### 7.9 Combos the system is built to produce

- **The Ferry (Bone + Storm).** Kevin: Echo Beasts (Wolvie, Grim, Echohorn). Mike: Rally Beasts. *Ghost Relay* drops
  Kevin's first dead at their Twin slots on Mike's front. *Thunder Pact* makes Mike's Echohorn Rally trigger Kevin's
  Twin's Rally. Echohorn's Rally triggers the left-most Echo, which is the ghost Grim: +8/+8 to Mike's Beasts.
- **The Shout Cannon (Ember).** Kevin plays Drakko; *Two Throats* doubles Mike's Shouts; *Chorus Line* fires Kevin's
  Karwind's Twin's Shout on every play. "Any Shout gives Dragons +4/+4" fires four times a play across two boards.
- **The Gold Engine (Gold + Star).** Mike's Dwarves spend; *Joint Account* feeds Kevin, and at level III counts as
  Gold spent; Kevin's Kobolds cast Rubies; *Gemlink* fires them on Mike's Dwarves; *Shared Triples* turns two half-built
  boards into Gilds every turn.
- **The Wall and the Hammer (Steel + Storm).** Kevin: Taunts in slots 1 and 2. *Shoulder to Shoulder* and *Bodyguard*
  guard Mike's slot 1 and 2 carries, while *Tag In* makes Kevin's Rally Taunts hand Mike's carries extra attacks.
- **The Star Pot (Star + Gold, in a Celestial set).** *Shared Sky* plus Mike's Demon shop buffs and *Market Share*
  grow one Starform from both Shops. Kevin buys it on the boss turn.

---
## 8. Other co-op mechanics

### 8.1 Hand Off (sending cards)

- Drag a card from your hand onto your partner's portrait. It lands in their hand with the card-to-hand beat and a
  bolt across the gap on both screens.
- **One free Hand Off a turn.** Each extra costs 1 Gold. Minions, Shop spells, Rubies and Gifts can be sent. Whispers
  only with Whisper Network.
- **Sent minions count toward your partner's triple.** "I send you the third Wolvie" is the most common beat.
- No Hand Off after your partner locks (their hand is frozen for the fight). The drop is refused and nothing is spent:
  "Mike has locked."

### 8.2 The ally scope

Any targeted Shop spell, Ruby, Shout or hero power that targets "a friendly minion" may instead be dropped on a tile
of your partner's ally strip: **+1 Gold** for spells and hero powers, **free** for Shouts if you own an Ember Link. It
resolves on their real board at once, with the normal FX on their screen and a bolt on both. Counters ("spells cast
this turn") count for the caster. If the partner has locked, the drop is refused. If the target leaves in the same
instant, the cost refunds.

### 8.3 Tandem fights (the default format)

**Every fight is a Tandem fight.** Each board fights its own front, and **the two fights advance on one step clock**.

- **A step** is one attack and every trigger it causes, as `simulate` already resolves it.
- **Order.** Start of Combat resolves on the leading front, then the other, after cross Start-of-Combat casts from
  both Racks are compiled in. Then steps alternate: lead step 1, other step 1, lead step 2, and so on. **The lead
  alternates every turn** (the Versus `firstSide` idea, one level up). The leading front shows a small "Leads" pill.
- **Crossings.** An effect aimed at the other front is put in that front's inbox, tagged with its source (seat,
  minion, Link id). A front drains its inbox at the start of its next step, before it attacks. So a crossing always
  lands **at most one step later**. That gap is when the bolt flies.
- **Symmetric.** The enemy side of one front can send to the enemy side of the other through the same inbox. Bosses
  use this. Nothing reads "player": a cross effect reads its owner's side through `stateOf(side)` as everything does.
- **A front ends.** The other front keeps stepping alone. Crossings into an ended front go to a Charge if one is coming
  (8.4), otherwise they fizzle with a visible chip: "Mike's fight is over."
- **One log, one clock.** The engine writes one merged log with a global step index; each client plays its own front
  and shows the partner front in the lane on the same clock.
- **Parity guard.** A Tandem fight with no cross effects must produce, per front, a log byte-identical to a plain
  `simulate` call on that front. That test guards the refactor (15.5).

### 8.4 The Charge (one rule for helping)

There is one help mechanic, with one set of rules. **When your front is won, your survivors Charge into your
partner's front**, whether that fight is still running or already lost.

**Into a running fight.**
- Chargers wait at the gap and enter the player side at the target front's next step boundary, **one per free slot,
  from the right end**. If the board is full, the rest wait and step in as slots open (they enter at the dead body's
  slot, as summons already do).
- They keep their **current stats and spent flags**: a broken Ward stays broken, a used Rise stays used, Execute
  already dropped stays dropped, Pummel meters as they stand. `socSpent` is set, so **Start of Combat never fires
  again** for a charger. Their **Charge:** text fires on arrival.
- **Attack order.** The arriving minions attack first: the next player-side attack on that front is taken by the
  left-most charger, then each charger in turn, then the normal attack pointer resumes from where it was.
- Chargers are Twins of nothing on the new front: Links that need a Twin read their slot as it now stands.

**Into a lost fight (the continuation leg).** If your partner's front was already lost when yours was won (or both
ended on the same step), the enemy survivors stay as they ended (current stats, spent flags, Start of Combat already
spent), and your chargers fight them in one more Tandem leg. **The arriving board attacks first.**

**Outcome, the same in both cases.**
- **Charge won:** the front is **Saved**. Your partner takes **no Hit**. The boss bar takes the tiers of the surviving
  chargers only (a Saved front deals none of its own damage).
- **Charge lost:** your partner takes the full Hit.
- A Charge never chains back.
- On screen: your survivors lift and run off toward the gap, both clients cut to the partner's arena (one arena at a
  time), and they burst in. "CHARGE!" plays once on both screens. Both of you now watch the same fight.

**Why a sacrificial board does not pay.** A Saved front deals no boss damage of its own, its owner gets no Victor's
pick, and its owner's Yours slot is a Grudge only if the Charge was lost. A pair that ships one throwaway board kills
bosses at half speed. The **sacrificial-board test** in the bot driver (16.6) has to prove it: a "one strong, one
empty" pair must break bars measurably slower than a median pair.

### 8.5 Fusion (the raid's climax)

**Fusion** happens in three places: the **FUSION** Mythic Link (once per boss, both press Fuse), the last phase of
**Vel** (forced), and the last crown of the **Seven-Crowned Engine** (forced).

- At Start of Combat both boards **Fuse**: each pair of Twins becomes one **Fused** minion. A slot with only one
  minion stays as it is. The result is one 7-slot board, one side.
- A Fused minion has **summed Attack and Health**, **every keyword from both**, **every trigger from both** (Echoes,
  Rallies, Avenge, Slaughter, Pummel meters), both tribes, Gilded if either half was. Owner pips show both portraits.
- The Fused side takes the **higher** of each side value (spell power, Ruby strength, each Aura). Rune flags from both
  rune rows apply (duplicates stack as runes always do).
- **Fused reading.** A Link between Twins has no Twin on a Fused board, so every Link prints a **Fused reading** in
  its glossary entry and shows it live while Fused: "its Twin" reads "its neighbours". Echo Chamber: "When your Echo
  triggers, a neighbour's Echo triggers." Fusion is where every Link in both Racks fires inside one fight, with no gap
  delay.
- After the fight the Fused minions split. Permanent and Engraved gains carry back to **both** halves.
- Damage: a Fused win deals the higher shop tier plus the tiers of every surviving Fused minion (each counts both
  halves). A Fused loss costs each player half the Hit, rounded up.

This is legal in `simulate`: a Fused board is still one 7-slot side with one `CombatSideState`. The new work is the
pure `fuseBoards` transform before and `splitCarry` after (15.3).

### 8.6 Momentum (overkill that pays)

Boss damage past a full phase bar is **Momentum**. Each 10 Momentum gives **both players +1 Gold** next turn and **one
rarity step** on one slot of each player's next Haul (max +3 Gold and +2 steps). The next phase still starts next
turn, so its signature still fires. "OVERKILL +23" shows over the bar; the Gold and the steps are shown as pills on
both Haul tabs.

### 8.7 Wrath (the one visible rubber band)

Each act has a **Link mark**: the pair's expected total Link levels at that act's boss (first pass: Act 1 8, Act 2 20,
Act 3 32, finale 40). **For every 4 levels the pair holds above the mark, the boss gains one Wrath step**: each boss
minion +15% Attack and Health, rounded. The boss card shows it: "Wrath +2: you are 8 levels ahead." Below the mark
there is no help and no penalty: the act's numbers are the floor. A strong pair still kills faster, and sees why the
boss got bigger.

### 8.8 Joint calls and talk

- **Door vote** (4.2). Splits alternate.
- **Fuse** button (FUSION): either player presses it in the Shop; a "Mike wants to Fuse" pill glows on the other
  screen; both presses = Fuse at Start of Combat.
- **Swap Meet / Field Promotion:** the receiving player's choice has a 10 s timer with a stated default.
- **Emotes** as in Versus (4 equipped, 8 s cooldown in this mode). **Pings** (right-click radial, 3-second pill on the
  partner screen) with lines per object: on the Handshake "Handshake?", "Taking it", "Skip it"; on a Rack Link "Feed
  this" (asks for that tag); on a board slot "Twin here"; on the lane "Watch this". **Peek** (hold Tab): the Versus
  spectator view of the partner's screen, zero cost until opened.

---

## 9. Bosses: 9, plus 6 Juggernauts

### 9.1 How bosses are built

A boss is an authored encounter of **real ASCENT cards plus boss tokens**, with a full enemy `CombatSideState` per
front (tier, Auras, spell power, Ruby strength, rune `questMods` flags). Combat sides are symmetric, so a boss can hold
Rune of Fury or Rune of Twilight exactly as a player does.

Each boss has: an **exam line** on the door panel, **phase bars** (one per phase), a **Hit** (what a lost front
costs), an **intent cycle** shown a full Shop ahead with exact numbers, one **rule it breaks** loudly, a weakness the
loot engine can hit, a **themed Wild list**, and a **loss line** for the end screen ("What beat us").

**Anchoring (so the numbers mean something).**
- Each phase's front template is built from the **median recorded lobby board of wave N** (the turn the boss is met)
  times an uplift for Links: Act 1 x1.15, Act 2 x1.35, Act 3 x1.6, finale x2.0. The bot driver measures the uplift and
  retunes.
- **The bot bar:** the bot partner (16.6) must play at 90% of the median human snapshot's board strength at turns 7,
  12 and 17. Below that, tuning against bot pairs is not trusted.
- **Bars and Hits** (first pass, at the act baseline turn):

  | Act | Bar per phase | Hit | Median won-front damage, before Links |
  |---|---|---|---|
  | 1 | 30 | 7 | ~9 |
  | 2 | 50 | 11 | ~17 |
  | 3 | 70 | 15 | ~24 |
  | Finale | 90 per crown (crown 3: 120) | 18 | ~28 |

- **Wrath** (8.7) adds visible steps on top. **Enrage** from a phase's 4th turn: its minions gain +6/+6 each turn and
  its Hit doubles. No timeout loss.

**Shop-touching rule.** A boss that touches a Shop, a Haul or a Rack **telegraphs the exact cards a full Shop ahead**
and spends from a **printed Gold-value budget** per turn (a Shop minion is worth its tier in Gold; a Haul card is worth
its rarity: Basic 1, Rare 2, Epic 3, Legendary 4, Mythic 5). The budget shows on the boss card: "Appetite 6 this turn."

**Intent vocabulary** (one plain sentence each): **Hit**, **Sharpen** (+stats), **Brace** (Taunt or Ward), **Brood**
(summons), **Burn** (Start-of-Combat damage), **Hunt** (aims at a slot), **Countdown**, and three Expedition intents:

| Intent | Sentence | Built from |
|---|---|---|
| **Sever** | "Next fight: Kevin's Echo Chamber is cut." | NEW: disables one Link for one fight |
| **Steal** | "End of Turn: it takes Mike's Shop slot 4." | NEW: boss reaches a Shop, under the budget |
| **Mirror** | "Next fight: each of you fights a copy of the other." | NEW: front swap |

**Format per act.** Act 1 has two bosses, Act 2 three, Act 3 three; the act's boss is drawn at act start and shown on
the door panel from turn 1. The finale is one.

---

### 9.2 Act 1. MOTHER HOLLOW, THE SPLITTING QUEEN

*Exam: "Kill her halves together, or she comes back whole."* Phases 30 / 30 / 30. Hit 7. Teaches the Tandem clock.

- **Phase 1, The Swell.** Each front: Mother Hollow 6/30 Taunt, "Start of Combat: gain +2/+4 for each turn this phase
  has lasted. (Now +0/+0.)", and 2 Hollowlings 2/3.
  - **Rule break: the Heartstring.** The two Hollows are one queen. A gold string is drawn between the two portraits.
    When one takes damage, **half of it also hits the other** (rounded down), through the inbox one step later. The
    pair learns that damage in one fight shows up in the other.
- **Phase 2, The Split.** One Half per front: 10/24 Taunt.
  - **Rule break: Sync or Swell.** When a Half dies, a **3-step ring** appears on the other Half. If the other Half
    dies before the ring empties, both stay dead ("SYNCED"). If not, the dead Half **comes back whole** (Rebirth, full
    stats) in its fight. Board order across boards is now the plan: "Put your Cleave in slot 1, my Tag In is slot 1."
- **Phase 3, Brood Flood.** Each front: 2 Halves 8/16 and 4 Hollowlings.
  - **Rule break: Cross Brood.** Every enemy death on either front summons a 1/1 Hollowling on the other front at the
    same slot (CROSS, enemy side, boss colour).
- **Intent cycle:** Sharpen ("Mother Hollow gains +4/+8 this fight."), Burn ("Start of Combat: 2 damage to each of
  Kevin's minions."), Brace ("Hollowlings gain Taunt."), Hunger ("If this front wins, the queen heals 8 on the bar.").
- **Weakness:** Tag In, Mirror Strike and Opening Volley sync kills across fronts.
- **Themed Wild:** Opening Volley, Mirror Strike, **Heartstring** (Epic Link: "When your minion takes damage, its Twin
  gains that much Attack this combat. Up to 6 times each combat.").
- **Loss line:** "Her Halves died 5 steps apart. Sync them."

### 9.3 Act 1. THE GOBBLER KING

*Exam: "He eats your Shop. Feed him something else."* Phases 30 / 30. Hit 7. Teaches cross-board consequence.

- **Phase 1, The Feast.** Each front: Gobbler King 4/36, "Start of Combat: gain the stats of everything in his
  Belly.", and 3 Gobblings 3/2, "Echo: the King gains +2/+2."
  - **Rule break: Appetite.** Each End of Turn he eats Shop minions from each player's Shop worth up to **Appetite 4
    Gold** (Act 1), starting from the right-most. The cards he will eat next turn wear a **"Gobbler eats this"** pill
    a full Shop ahead. Freeze protects them. Buying them protects them. Feeding him a minion you hate is legal. Eaten
    cards drop into the Belly pill on his portrait with their stats added. Pool copies return when he dies.
- **Phase 2, The Gulp.** At Start of Combat he swallows **a combat copy** of the highest-stats minion on each board
  (shown a Shop ahead: "He will swallow Mike's Grim, 14/14"). Your real minion is safe; the copy fights for him.
  - **Rule break: Burp.** When the King dies in a fight, his Belly spills **onto the other front's player side** as
    combat copies at +5/+5, Gilded. Kevin's swallowed Wolvie comes out fighting for Mike. CROSS, with a big one-shot
    "BURP" beat on both screens. Bait with a cheap buffed minion and the Burp is your own carry's copy.
- **Victory:** each player gets one of the swallowed minions as a real Gilded card in hand.
- **Intent cycle:** Feast ("Appetite +3 next turn."), Gulp, Belly Ache ("Start of Combat: 1 damage to each enemy for
  each card in his Belly. Now 4."), Snack Break ("Heals 6 on the bar.").
- **Weakness:** Bodyguard and Lend a Shield (a Warded bait loses Ward instead of being swallowed).
- **Themed Wild:** Golden Gift, Copycat, **Doggy Bag** (Rare Burst: "Next combat: if the King swallows your minion,
  he swallows its Twin's copy instead, and the Burp lands on your front.").
- **Loss line:** "He ate your Shop slot 5 three turns in a row. Freeze it."

---

### 9.4 Act 2. JORMUN, THE TWO-ENDED SERPENT

*Exam: "Its head is in one fight. Its tail is in the other. It has one life."* Phases 50 / 50 / 50. Hit 11.

- **Phase 1, Head and Tail.** The Head goes to the hunted front, the Tail to the other.
  - Head: 15 Attack, Flurry, "Rally: attack again if it killed." Tail: 6 Attack, Taunt, "Rally: summon a 4/4 Coil."
  - **Rule break: One Body.** Head and Tail share **one Health pool of 120**, shown as one bar stretched across both
    portraits on both screens. Damage in either fight lowers both. Kill it in one fight and it dies in both.
- **Phase 2, The Turn.**
  - **Rule break: Head swap.** At Start of Combat Head and Tail swap fronts (CROSS, a long body slides through the
    gap, 1.2 s, the only slowed beat). The hunt moves with the Head.
  - **Constrict** intent: "The Tail gives Kevin's slots 1 and 2 -0/-4 this fight."
- **Phase 3, Ouroboros.** The serpent bites its tail: one minion that is in **both** fights at once (one body, two
  slots, `sharedBody`).
  - **Rule break: Shed.** Each time it is attacked in either fight, it summons a 4/4 Scale on **the other** front, at
    the slot facing the attacker's Twin. Fast double kills beat it; slow grinders feed it. Up to 10 Scales per front.
- **Hunt** (the one aim rule left): the hunted slot is shown a Shop ahead ("Jormun bites Mike's slot 2 for 30."). Either
  player may drag the hunt pip onto the other portrait; the newly hunted front's Head gains +5/+5 this fight.
- **Intent cycle:** Hunt, Coil ("The Tail summons 2 Coils now."), Molt ("Heals 20 on the body."), Venom ("The Head has
  Execute this fight.").
- **Weakness:** Crossfire, Overkill Express: damage from one fight lands on the shared body.
- **Themed Wild:** Bodyguard, Return to Sender, **Fang and Rattle** (Epic Link: "When an enemy on either front is hit
  by a cross effect, it takes 2 more.").
- **Loss line:** "The body healed 40 from Molt. Burst it the turn before."

### 9.5 Act 2. THE GRAND TITHE

*Exam: "It takes what you leave behind. Then it takes what you kept."* Phases 50 / 50. Hit 11.

- **Phase 1, Collection.** Each front: The Tithe 8/40, "Start of Combat: its minions gain +2/+2 for each card in its
  Rack. (Now +0/+0.)", and 4 Collectors 5/5.
  - **Rule break: It eats the Haul.** When the Shop ends, the Tithe takes the **highest-rarity card neither of you
    took** from your rows, within **Appetite 4** (Act 2) worth of rarity, and puts it in its own Rack (a pill row
    under its portrait). Its Links fire for its side, and its two fronts are each other's partner through the inbox.
    If you pass on Bodyguard, its Collectors start guarding each other. Starve it by taking the Handshake together, or
    feed it a Basic on purpose. **Max 3 cards stolen per phase.**
- **Phase 2, Repossession.**
  - **Rule break: Borrowed loot.** At Start of Combat it borrows **one Link from each player's Rack**: the one that
    fired most last fight, shown a full Shop ahead ("It will borrow Kevin's Echo Chamber."). You fight your own loot.
  - **Refund.** When the Tithe dies, every card it took comes back: **each one levels up for the player who passed it**
    (a Link not owned arrives at level I plus one level; a Burst arrives as two copies), and every borrowed Link
    returns one level higher. The biggest payout in the run, capped by the 3-per-phase steal limit.
- **Intent cycle:** Levy ("Your first reroll costs 2 this turn."), Audit ("Its Collectors gain Ward."), Lien ("If this
  front wins, you have 3 less Gold next turn."), Foreclose ("Appetite +3 this turn.").
- **Weakness:** a pair that takes the Handshake together leaves nothing good behind.
- **Themed Wild:** Joint Account, Market Share, **Tax Return** (Rare Burst: "When the Tithe takes a card this turn, you
  each gain 3 Gold next turn.").
- **Loss line:** "It held your Swap Meet. You passed it on turn 14."

### 9.6 Act 2. AUREX AND NOCTRA, THE TWIN DRAGONS

*Exam: "Two dragons. Two fronts. They will trade."* Phases 50 / 50 / 50. Hit 11.

- **Phase 1, Sun and Moon.** Front A: Aurex 12/40 Ward, "Start of Combat: give your minions +3/+3", and 3 Sunscales 6/6.
  Front B: Noctra 14/36 Flurry and 3 Moonscales 5/7 Taunt.
  - **Rule break: Mirrored Roars.** Every Start-of-Combat and Rally effect either dragon fires also fires on the other
    dragon's front, at the Twin slot (enemy-side bolt in the dragon's colour).
- **Phase 2, The Trade.**
  - **Rule break: Mid-air Swap.** On step 8, Aurex and Noctra leap through the gap and switch fronts, keeping their
    damage taken. Each player now fights the dragon the other one wounded. CROSS on both screens, slowed to 1.2 s.
  - **Crossed Breath:** "Aurex's breath hits Mike's board for 4 each." Damage from one fight onto the other board.
- **Phase 3, Eclipse.** The dragons merge into **Eclipse** 30/90 on the leading front with 4 Duskscales; the other front
  fights 2 Embers 10/10 and must finish fast and **Charge** into Eclipse.
- **Intent cycle:** Sharpen ("Both dragons gain +6/+0 this fight."), Crossed Breath, Brace ("Scales gain Taunt and
  Ward."), Dive ("Noctra attacks first and is Immune while attacking this fight.").
- **Weakness:** Lend a Shield and Aegis Lattice answer Crossed Breath; Charges finish Eclipse.
- **Themed Wild:** Mirror Strike, Swap Meet, **Dragon's Pact** (Legendary, Both must take: "Your Dragons Shout twice.
  Your partner's too." Alone: "Your first Dragon Shout each turn triggers twice.").
- **Loss line:** "Eclipse lived because the Ember front lost. Charge into it."

---

### 9.7 Act 3. VOLTARA, THE STORM BETWEEN

*Exam: "She lives in your Links."* Phases 70 / 70 / 60. Hit 15.

- **Phase 1, Static.** Each front: Voltara's Coil 10/50 and 3 Arcs 8/8 Flurry.
  - **Rule break: Sever.** "Next fight: your two highest-level Links are cut." Named a Shop ahead and shown cracked in
    the Rack. **Signature:** she Severs on the phase's first turn. The pair must win with what is left.
- **Phase 2, Lightning Rod.**
  - **Rule break, reversed:** "Each time a Link crosses between your fronts, it deals 2 damage to Voltara's bar." Fill
    the screen with bolts and she breaks. A bolt counter on the bar. A pair with 30+ crossings breaks the phase in one
    fight. The loot engine is the weapon.
- **Phase 3, Overload.** "Every Link fires twice. So do mine." Her Arcs gain copies of every Storm Link the pair owns
  (boss colour bolts, "Voltara's copy of Mike's Tag In"). Your engine at double speed against itself.
- **Intent cycle:** Sever, Discharge ("Start of Combat: 3 damage to each minion on both fronts."), Ground ("Links
  cannot cross in steps 1 to 3."), Arc Flash ("Her Arcs gain Ward.").
- **Weakness:** Phase 2 itself, and Resonance steps (which Sever cannot cut).
- **Themed Wild:** Twin Cast, Storm Bridge, **Grounding Rod** (Epic Link: "Your Links cannot be Severed. Each Sever
  aimed at you gives your board +4/+4 instead.").
- **Loss line:** "Phase 2 needed 35 crossings. You made 18."

### 9.8 Act 3. VEL, THE MIRROR UNWRITTEN

*Exam: "You will fight your friend. Then you will fight yourselves."* Phases 70 / 70 / 60. Hit 15.

- **Phase 1, The Swap.** Kevin's front is **a copy of Mike's board as it locks**, and Mike's is a copy of Kevin's, in
  Vel's pale frame with a "Vel's copy of" chip. The copies keep the original's runes and Rack, and their Links point at
  each other through the inbox, as the real ones do.
  - **Rule break: Know your friend.** The Shop shows each player their partner's board as the enemy. Lock order
    matters: locking last means your partner's copy is final before you finish. Asking your partner to sell the card
    that beats you is legal.
- **Phase 2, Turned Links.** Each front is a copy of **your own** board from last fight. Vel holds a copy of **both
  Racks**, and its Links fire **into your partner's real fight** on the enemy side. Your Echo Chamber fires Vel's
  Echoes on your friend's front. Boss-colour bolts: "Vel's copy of Kevin's Echo Chamber".
- **Phase 3, Fused Reflection (forced Fusion).** You are Fused (8.5). Vel is your Fused board as you locked it last
  turn, with every Link in both Racks.
- **Intent cycle:** Reflect ("The copies gain the Haul cards you take this turn."), Shatter ("At half bar, the copies
  gain Rebirth."), Doubt ("The copy of Kevin's board attacks first."), Hollow Glass ("Copies have +10/+10 and no
  Ward.").
- **Weakness:** Reflect makes the Haul a double-edged choice; Unwrite.
- **Themed Wild:** Copycat, Kin of Two Kinds, **Unwrite** (Legendary Burst: "Next combat: the enemy copy of your slot 1
  minion starts dead.").
- **Loss line:** "Vel's copy of your cannon came through Swap Meet. Unwrite was offered on turn 21."

### 9.9 Act 3. THE HUNGERING STAR

*Exam: "It grows in your Shop. Every buff you give, it eats."* Phases 70 / 70 / 60. Hit 15. Built on the Starform
pinning rule; works in any set.

- **Phase 1, Accretion.** Each front: The Hungering Star 10/50, "Start of Combat: gain the stats of the Star Seed in
  your Shop.", and 3 Satellites 8/8.
  - **Rule break: the Star Seed.** A boss Star Seed is pinned in the right-most slot of **both** Shops. **Every Shop
    buff either player makes also lands on both Seeds** (SHOP bolt into the Seed, boss colour). It cannot be frozen
    out. It counts against no Appetite (it eats buffs, not cards).
  - **Steal it.** The Seed can be bought for 8 Gold, minus 1 per refresh. The buyer gets it as a Celestial minion with
    all its stats, and the Star loses them. A new Seed forms next turn. One partner buffs, the other buys.
- **Phase 2, Supernova.** "Supernova in 3 turns: 40 damage split among each board, and a Hit to both." Each Seed
  stolen pushes the Countdown back 1; a Collapse (in a Celestial set) pushes it back 2.
- **Phase 3, Event Horizon (Fused if FUSION is pressed; Tandem otherwise).** "Start of Combat: it pulls your slot 1
  minion into itself. It fights for the Star, then comes home." Order slot 1 to choose what it takes.
- **Intent cycle:** Feed ("Seeds gain +3/+3 for every Gold you spend this turn."), Gravity ("Your Shop has 1 less
  slot."), Flare ("Start of Combat: 3 damage to each minion on both fronts."), Corona ("The Star has Ward and Taunt.").
- **Themed Wild:** Market Share, Golden Gift, **Shared Orbit** (Epic Link: "When you buy a Star Seed, its stats are
  also given to your slot 1 minion's Twin.").
- **Loss line:** "The Seeds reached 60/60. One of you buffs, the other buys."

---

### 9.10 Juggernauts (elites, one turn, one shared bar, win = pick 2)

| Juggernaut | Act | Each front | Twist |
|---|---|---|---|
| **The Twin Wardens** | 1 | Warden 4/18 Ward Taunt, 2 Squires 2/4 | "If one Warden dies, the other gains Resilient Ward." Kill them in sync. |
| **Gob and Gobbo** | 1 | Gob 5/20, 3 Goblins 3/3 | "Rally: summon a Goblin on the other front." Overflows on purpose. |
| **The Glasswing** | 2 | Glasswing 12/12 Stealth Execute, 2 Shards 4/6 Taunt | Ward on the carry, or many bodies. |
| **Grubb the Spellhater** | 2 | Grubb 8/24, 3 guards 5/5 | "+2/+2 for each spell either of you cast this turn." Star pairs plan. |
| **The Linkbreaker** | 3 | Breaker 14/40, 3 Severers 6/10 | "Each Severer cuts one of your Links for this fight. Kill it to restore the Link." The Link snaps back with a bolt and a chip. |
| **Colossus of Counts** | 3 | Colossus 0/90 Taunt, 2 Gearguards 8/8 | "Countdown 4, ticks when attacked: at 0 it deals 30 split." Big hits, not many hits. |

---

### 9.11 The finale. THE SEVEN-CROWNED ENGINE

*Exam: "Seven heads. Cut one and two grow. Only a Link burns the stump."* Three crowns. Hit 18. Tier 7 opens in the
Shop for the finale.

- **The heads.** Seven heads, one per ASCENT trigger family, split 4 and 3 across the fronts (the leading front takes 4):

  | Head | Stats | Text |
  |---|---|---|
  | Echo Head | 12/30 | "Echo: summon two Echo Heads 6/15." |
  | Rally Head | 14/26 Flurry | "Rally: the other heads gain +2 Attack." |
  | Shout Head | 10/30 | "Start of Combat: trigger every Start of Combat effect on its side again." |
  | Ward Head | 8/40 Resilient Ward | "When its Ward breaks, give a random head Ward." |
  | Rise Head | 12/24 Rise | "Rise: returns with full stats." |
  | Avenge Head | 10/30 | "Avenge (2): the heads gain +4/+4." |
  | Pummel Head | 16/30 | "Pummel (30): deal 30 split among enemies." |

- **Rule break: Regrowth.** When a head dies, **two copies grow at its slot** (board limit, then Overflow gives the
  other heads +10/+10). **Unless it was killed by a cross effect** (a Link, a Graft, a Charger, a Mirror Strike or Tag
  In attack): then it is **cauterised** and stays dead, with a one-shot white flash and "Burned by Kevin's Crossfire".
  The whole run's loot is the weapon.
- **Crown 1 (bar 90, Tandem):** all seven heads.
- **Crown 2 (bar 90, Tandem):** the four heads with most kills last crown return Gilded. **The Pendulum** 20/40, Immune
  while attacking, takes **every third step** on both fronts (a free attack). "In 3 steps it Severs a random Link."
  The pair races the clock.
- **Crown 3, ASCENDANT (bar 120, forced Fusion).** One board against one **Titan**: seven Limbs that each fill a slot,
  30/80 to 60/150, one ASCENT keyword each. "When a Limb dies, the others gain its keyword." The Titan takes at most 60
  damage per fight, printed **Invincible (60)**, so it is at least two fights. Every cross reading of every Link fires
  inside the Fused board, and Limbs killed by those effects stay dead.
- **Intent cycle:** Many Mouths ("Two heads attack first."), Old Crown ("The heads gain +8/+8 while the bar is over
  half."), Regal ("Regrowth makes three copies this fight."), Bow ("The heads lose Ward and Taunt this fight.").
- **Themed Wild (every Wild in the finale):** any Mythic; **Kingslayer** (Mythic Link: "Your cross effects deal double
  damage to heads and Limbs.").
- **Victory:** the end screen draws both Racks wired together (painted frames, Link cards in the rune frame) with the
  run's crossing count ("1,214 Links crossed"), the best Combo and the best LINK count. XP and the mode's title.
- **Loss line:** "Six heads regrew from plain attacks. Kill them with crossings."

---

## 10. Mode-only cards and keywords (25)

These never enter normal ASCENT pools. Link minions join this mode's shared Shop pool; spells come through the Haul.

### 10.1 New keywords and trigger words (4)

| Term | Kind | Rule (player text) | Engine |
|---|---|---|---|
| **Charge:** | trigger word | "Charge: when this crosses into your partner's fight." | arrival hook in the Tandem engine (NEW) |
| **Assist:** | trigger word | "Assist: when its Twin attacks." | partner-front attack watcher (NEW) |
| **Baton:** | trigger word | "Baton: when this dies, its Twin gets this." | death trigger, cross target (EXTEND Echo path) |
| **Fused** | state | "Made of two Twins. Has both bodies, all keywords and all triggers." | Fuse transform (NEW) |

"Twin", "Link", "Ghost" and the rest are terms (12.5), not card keywords.

### 10.2 Link minions in the shared Shop pool (14)

| Tier | Card | Text | Built on |
|---|---|---|---|
| 1 | **Pen Pal** 2/2 | "Shout: give its Twin +2/+1." | Shout, cross target |
| 1 | **Signal Kobold** 2/3 Kobold | "Shout: cast a Ruby on its Twin." | Shout, Rubies, ally scope |
| 2 | **Shield Mate** 2/4 Taunt | "Assist: gain Ward. Once per combat." | Assist, Ward |
| 2 | **Courier Hound** 3/3 Beast | "Echo: your partner gets a copy of the last card they sold." | Echo, card to hand |
| 3 | **Echo Pair** 4/3 Beast | "Baton: its Twin gains this minion's Echo this combat." | Baton, Echo grant |
| 3 | **Brewmates** 3/5 Dwarf | "End of Turn: give its Twin +1/+1 for each card your partner played this turn. (Now +0/+0.)" | EoT, team watcher, live text |
| 3 | **Tag Team Imp** 4/4 Demon | "Rally: summon a 2/2 Imp at its Twin slot on your partner's front." | Rally, cross summon |
| 4 | **Bridgewyrm** 5/5 Dragon | "Shout: your partner's Dragons gain +2/+2." | Shout, Dragon synergy |
| 4 | **Lantern Twin** 5/4 Rise | "Charge: give the minions you join +3/+3." | Charge |
| 4 | **Coinbound** 4/4 Dwarf | "Every 4 Gold your partner spends, gain +2/+2. (Now 2 left.)" | Gold watcher, live text |
| 5 | **Mirror Knight** 6/6 | "Start of Combat: copy its Twin's keywords." | SoC keyword grant |
| 5 | **Herald of Two** 5/7 | "Start of Combat: give its Twin +2/+2 for each Link level you and your partner own. (Now 14: +28/+28.)" | SoC, live scaler |
| 6 | **Storm Conduit** 7/7 Flurry | "Whenever a Link crosses from your board, gain +1/+1 permanently. (Now +0/+0.)" | Link-crossing watcher |
| 6 | **Grand Duet** 10/10 | "Your Links' caps are 2 higher. Your partner's too." | Link layer |

Tier 7 (finale only): **The Linkmaker** 10/10, "Shout: level up one of your Links and one of your partner's."

### 10.3 Spells (6, Haul-only)

| Spell | Cost | Text |
|---|---|---|
| **Lifeline** | 1 | "Next combat: if your partner's front is lost before yours ends, your 2 left-most minions Charge at once." |
| **Gap Bolt** | 2 | "Next combat: Start of Combat: deal 8 damage to an enemy on your partner's front." |
| **Pass the Torch** | 0 | "Move a minion's Graft onto its Twin." |
| **Mirror Coin** | 1 | "Cast a copy of the last spell your partner cast this turn. (Now Pouring Ale.)" |
| **Tug of War** | 2 | "Swap a minion with its Twin until the end of next combat." |
| **Reunion** | 3 | "Your Ghost partner returns at 10 Health." (Only offered while your partner is a Ghost.) |

### 10.4 Enemy-only tokens (data)

Hollowling, Mother Hollow and Halves, Gobbler King, Gobbling, Jormun's Head, Tail and Ouroboros, Coil, Scale, The
Tithe, Collector, Aurex, Noctra, Sunscale, Moonscale, Duskscale, Ember, Eclipse, Voltara's Coil, Arc, Vel copies
(orchestrator-made), The Hungering Star, Satellite, the boss Star Seed, the seven heads, the Pendulum, the Titan's
Limbs, and the Juggernauts. All are `token: true` cards on authored enemy boards with an enemy `CombatSideState`.

---
## 11. Visibility and presentation spec

**The law: nothing crosses between boards without being seen on both screens.** Every cross effect has four parts,
**source flash, travel, landing, name chip**, plus **live text** on both boards. No exceptions, bosses included.

### 11.1 The screen in this mode

- **Your arena:** the normal combat stage, unchanged size. One Pixi arena on screen, always.
- **The gap:** a thin painted gold edge (painted art, not code-drawn) on the side of your arena facing the ally lane.
  Things that leave your fight exit through it; things that arrive enter through it. Player text never names it.
- **The ally lane:** in the Shop it is the **ally strip** (7 small tiles with art, Attack, Health and keyword pips, plus
  your partner's Gold, hand count, lock state and Rack tiles). In a fight it grows into a **mini arena**: the same 7
  tiles plus your partner's enemy front as 7 tiles above, animating attacks as small lunges (transform only). It reuses
  the lobby scouting-board component at reduced scale. Your partner's screen mirrors it: you are their lane.
- **Twin guides:** at Start of Combat a faint vertical guide joins each Twin pair (your slot 3 to lane slot 3) for
  0.6 s, opacity in and out. In the Shop, hovering one of your minions lights its Twin tile on the strip (one-shot
  opacity). The player always knows where a Twin is.
- **The Rack** (your rune row, extended) and the **Resonance gauge** (six Thread pills between the two Health slots).
- **The Haul row** above the Shop row, with the Handshake card in the third frame showing both chips live.

### 11.2 The four parts of every cross effect

| Part | Source screen | Target screen | Timing | Built from |
|---|---|---|---|---|
| **Source flash** | the source's own ASCENT beat (Echo, Shout, Rally pop) plus a Thread-colour rim one-shot | nothing yet | the source's beat | existing beats + opacity on a static glow (the `kwglow` pattern) |
| **Travel** | a bolt flies from the source to the gap, then to the Twin tile in the lane | a bolt enters through the gap toward the real target | 300 ms (one step gap at 1x) | pooled Pixi sprite, Thread tint, additive blend, transform + opacity only |
| **Landing** | the lane tile pulses and its numbers tick | the target's normal ASCENT FX: buff pop, Ward ring, Rise pill, summon, hit | at the target front's next step boundary | existing `cardbuff`, keyword-gain, summon, hit beats |
| **Name chip** | "Echo Chamber: Mike's Hound" by the tile | "Kevin's Echo Chamber: Rise on your Hound" by the target | at landing, 1.4 s fade | the existing beat label pill |

**Name chip grammar (one form, always):** `<Owner>'s <Source>: <what> on <whom>`. On your own screen your name drops.
"Kevin's Wolvie: Rise on Mike's Hound." "Mike's Tag In: Kevin's Karwind attacks." "Vel's copy of Kevin's Echo
Chamber: Echo on Mike's Grim." Boss crossings use the boss's name and the boss colour.

**Consequence timing rule.** A crossing's consequence (the stat change, the keyword, the summon, the damage) is
applied on the target **at landing, never earlier**, so a number never changes before the bolt arrives. On the source
screen, the lane tile updates at the same tick.

**The Linked pill.** A target minion that received crossings this fight shows a small **Linked** pill with the incoming
total: "+6/+6, Rise from Kevin". Hover (the game's data-tip hover, no native tooltips) lists each source. After the
fight it shows permanent gains only: "From Mike this run: +18/+14."

### 11.3 Five travel shapes (one sprite set)

- **Bolt:** a buff, keyword or trigger. Thread colours: Ember orange, Bone pale green, Steel silver, Storm blue, Gold
  gold, Star violet; boss crossings black and white. Colour is a tint on one sprite, so no texture per Thread. The
  keyword grant shape uses the keyword pill icon as the bolt head.
- **Projectile:** damage (Crossfire, Overkill Express, Gap Bolt, Crossed Breath). Lands with the existing hit beat and
  number.
- **Cross:** a whole minion (Ghost Relay, Charge, Swap Meet, boss swaps). The card lifts (scale 1.05), slides to the gap
  (translate), fades through (opacity), and enters the other arena with the summon beat.
- **Coin:** Gold (Joint Account, Tier Draft). The existing coin sprite hops between Gold pills or onto a button.
- **Stamp:** a permanent change (Slaughterhouse, Golden Gift, Engrave the Pair). A one-shot gold stamp on the card,
  and the card's live text gains the line.

### 11.4 Shop-phase crossings

- On your screen, your Shop-phase crossings land on the **ally strip** tile (or its Gold pill, Rack tile, hand count).
- On your partner's screen, the bolt enters from their ally strip and lands on their **real** card, in board, hand or
  Shop, with that card's existing beat.
- **Partner Shop effects** (Market Share, Jackpot, Ale for Two at III) show on your strip as a small "Shop +3/+3 (slot
  4)" chip under the Gold count, since their Shop row is not on your screen.
- **Haul picks:** when your partner takes a private card, their Rack tile on your strip plays the stamp beat with
  "Mike took Echo Chamber". Their chip on the Handshake moves live with a 0.3 s snap. "Handshake!" plays on both.
- **Ally-scope casts:** the targeting arrow visibly crosses onto the ally strip on the caster's screen; the target
  screen shows the spell's FX and the chip.

### 11.5 Bosses in the Shop, the Haul and the Rack (every boss touch is visible)

| Boss touch | Telegraph (a full Shop ahead) | When it happens, on both screens |
|---|---|---|
| **Gobbler King eats Shop cards** | A red "Gobbler eats this" pill on each targeted Shop card; the Appetite number on his card. Your partner's targeted cards show as a count on your strip ("Gobbler: 2 of Mike's"). | At End of Turn a mouth sweep crosses the Shop row (transform), each card drops into the Belly pill on his portrait with its stats added ("+5/+4"). On the partner's strip: the count drops into the same Belly pill. |
| **Tithe takes a Haul card** | During the Shop the Tithe's eye pill sits over the highest-rarity card nobody has taken, and moves when someone takes it. "The Tithe takes this if you both pass." | At lock, the card lifts out of the row it sat in (its owner sees it leave; the partner sees it leave the Haul tile on their strip), flies to the Tithe's Rack pills under its portrait, and its frame turns boss colour. Chip: "The Tithe takes Bodyguard." |
| **Tithe borrows a Rack Link** | The Link in your Rack shows a hook pill: "Borrowed next fight." Your partner sees it on your Rack tile. | At Start of Combat the Link card slides out of your Rack to the Tithe's portrait; a ghost frame stays in its slot reading "Borrowed. Back after this fight." Its crossings in the fight are boss-colour bolts: "The Tithe's copy of Kevin's Echo Chamber". At settle it slides home. |
| **Refund** | The Tithe's Rack pills each show "Refund" on hover. | Each card flies from the Tithe's Rack to its new owner's Rack with a level-up stamp. "REFUND" plays once; the count per player shows on the Ledger. |
| **Voltara Sever / Linkbreaker** | The Link in your Rack shows a crack pill a Shop ahead, by name. | At Start of Combat the Rack card cracks (one-shot) and greys; a thin cut mark sits on its bolt path for the fight. A restored Link (a Severer dies) snaps back with a bolt from the dead Severer and the chip "Echo Chamber restored." |
| **Hungering Star feeds** | Both Star Seeds show their stats live. | Each Shop buff spawns a small boss-colour mote from the buffed card into your Seed, and a second mote into the lane chip for your partner's Seed. |
| **Vel copies a board** | The enemy front in the Shop preview shows your partner's board in Vel's pale frame, live as they change it. | At lock the copy freezes with a glass crack one-shot. |
| **Boss crossings in fights** | Intent ribbon with the slot or front. | Boss-colour bolts, cross shapes and chips, exactly the four parts. |

### 11.6 The Fusion sequence

1. "FUSION" across both screens (one-shot text).
2. The ally lane grows down into the arena while your board slides up (transform). Twins meet slot by slot, left to
   right, 100 ms apart, each with a flash and both owner pips.
3. One Fused board sits in one arena. **Both clients now show the same fight from the same side.**
4. After the fight the Fused minions split with a reverse flash, and each half flies home.

### 11.7 Bundling (the Link Surge)

If more than **3 crossing beats would start inside 250 ms**, they bundle into one **Link Surge**: one thicker bolt per
Thread (max 6 at once), an "x7" counter on the target, and **one combined chip** ("Kevin's Links: 7 effects on Mike's
board"). Hover lists them (data-tip). Consequences still apply at landing, all at once, with one buff pop per target.
This keeps the screen readable and the frame budget flat when an Act 3 engine fires 30 crossings in one step.

### 11.8 The big-moment layer (one-shots only)

- **LINK counter:** a pill above the lane counts crossings this fight ("LINK x9"). Every 5 it pops (scale, opacity) and
  its sound rises a step. At x20 it turns gold for the rest of the fight. One DOM text node.
- **Combo banner** the first time a Combo fires in a run (1.5 s, both screens). **Handshake!**, **CHARGE!**,
  **SYNCED**, **BURP**, **REFUND**, **CAUTERISED**, **FUSION**, **BACK!**: each a one-shot banner plus an announcer line,
  under the announcer's once-per-event and cooldown rules.
- **OVERKILL +23** big over the boss bar when a phase breaks with damage to spare, with the Momentum pills it buys.
- **Link Ledger** after every fight, 2 s on both screens, dismissable: what each gave the other this fight.
- **Wrath** pill on the boss card, never animated beyond its one-shot appearance.

### 11.9 Choreographer beats (new kinds)

| Beat | Fires on | Plays | Length |
|---|---|---|---|
| `linkOut` | a crossing leaving a front | source flash + travel to the gap | 150 ms |
| `linkIn` | the crossing landing at the target's next step | travel from the gap + landing FX + chip | 250 ms |
| `linkSurge` | 4+ crossings starting inside 250 ms | bundled bolts + counter + combined chip | 350 ms |
| `crossMinion` | a minion changing fronts (Charge, Ghost Relay, swaps) | cross shape | 600 ms (1.2 s for boss swaps) |
| `chargeCut` | a Charge begins | both clients cut to the charged arena | 500 ms |
| `twinGuides` | Start of Combat | Twin guide lines | 600 ms, non-blocking |
| `fuse` / `split` | Fusion start and end | 11.6 | 1.2 s / 0.8 s |
| `phaseBreak` | a bar empties | bar shatter, next bar lights, announcer | 1.5 s |
| `haulReveal` | Start of Turn | row slide-in, one sting per card | 600 ms, non-blocking |
| `haulTake` | a pick, a Handshake | stamp, chip snap | 300 ms |
| `bossTouch` | a Shop, Haul or Rack touch (11.5) | the matching shape | 400 to 700 ms |
| `ledger` | settle | Link Ledger | 2 s, dismissable |

Every beat gets a presentation policy entry, as every new effect factory already must.

### 11.10 Live card text on both boards

Live text is a hard rule, and crossings make it richer. On every surface (Shop, board, hand, Haul, Discover, combat):
- **The source Link or Graft:** its level, current numbers and count. "Echo Chamber II: trigger its Twin's Echo. Fired
  3 of 5 this combat."
- **Scalers that read the partner:** the live number folded in. "Undertakers: +3/+3 for each Rise minion on Mike's
  board. (Now +6/+6.)"
- **The target:** the Linked pill (11.2).
- **Fused reading** shown live while Fused.
- Both text chains get the helpers in the same PR as each effect: `liveCardText` for recruit surfaces and `Unit.tsx`
  for combat. Doc Bot's live-text tripwire extends to loot defs.

### 11.11 Performance rules

- **One arena on screen.** The partner fight is the DOM lane, not a second Pixi arena. Peek is the spectator stream.
- **Pooled bolt sprites, max 12 live.** Past that, bundling (11.7). Travel and landing are transform and opacity only,
  additive blend, static textures.
- **No looping paint animations.** The gap's glow is a static painted image whose opacity breathes on a `::before`
  layer, only while a Tandem fight runs. Every glow is opacity over a static sprite.
- **No per-frame layout reads.** Gap and tile positions are cached once per fight (the `insertRectsRef` pattern); a
  resize re-caches.
- **Memoized tiles.** Lane tiles use the `Unit` memo pattern with a value comparator, and update per beat only when
  their values change.
- **Fan-outs** (Avenge Me, Resonance sweeps) draw one sprite per side plus per-tile pulses, never one sprite per tile.
- **One Choreographer clock** drives your front and the lane from the merged Tandem log.
- **Measure before shipping:** prod build, an Act 3 fixture with 30 crossings per step and the finale's Regrowth,
  p95 and p99 frame time against the 160 fps bar (6.25 ms), frames over budget reported, plus `npm run perf` for the
  Tandem engine.

---

## 12. Difficulty (Mayhem) and falling

### 12.1 Health and Hits

**40 Health** plus the hero's Armor each. Armor absorbs first. A lost front costs the boss's or pack's **Hit**
(Brawls use the lobby formula, capped at 5 / 10 / 15 by act). A boss victory heals each player half their missing
Health. Campfire Rest heals 12.

### 12.2 Mayhem (the ladder, wilder as well as harder)

Every level adds one boss power and one loot power. Unlocked for the pair by winning the level below.

| Level | The bosses get | The pair gets |
|---|---|---|
| 0 | As written. | As written. |
| 1 | Bosses start with one themed Haul card in their own Rack. | The Wild is +1 rarity step. |
| 2 | Bars +15%. | The Handshake is +1 rarity step. |
| 3 | One intent number shows "?" until both lock. | The Finale's Tier 7 opens in Act 3. |
| 4 | Enrage from a phase's 3rd turn. | Rack +2 slots. |
| 5 | Each boss uses its signature twice per phase. | Juggernaut wins give pick 3. |
| 6 | Brawl packs carry one rune flag. | Every Hoard has one Mythic. |
| 7 | Hits +50%. | Melt raises two levels. |
| 8 | Ghosts cannot be Charged back. | Every Haul has 5 private cards. |

### 12.3 Falling: the Ghost

At 0 Health a player becomes a **Ghost**. A Ghost is not out.

- **Still plays.** The Ghost shops, Hands Off, takes a Haul card every turn, and their Links stay live.
- **Ghost board.** It fights its front at half Attack. It deals no boss damage. A lost Ghost front costs the living
  partner nothing. A won one counts toward Revive (below). Pale painted frame variant.
- **The gift slot.** The Ghost's Haul gains a 5th card: a Burst that only helps the living partner ("Your partner's
  slot 1 minion gains Rebirth this combat."). The Ghost's loot becomes a story about the teammate.

**Ways back.**
1. **Charged back.** If the living partner wins their front while the Ghost's front still fights, and their Charge
   wins it, the Ghost returns at **12 Health** after the fight. "BACK!" on both screens. Earned in the fight.
2. **Give up your loot.** The living partner skips their Haul pick for **2 turns in a row**: the Ghost returns at 15
   Health at the next Start of Turn. A real price, and a story.
3. **Two won Ghost fronts in a row** bring the Ghost back at 10.
4. **Campfire Revive** (the living partner's Campfire action): back at 15.
5. **Boss victory:** back at 15. **Reunion** (10.3): back at 10.

The run ends when both players are Ghosts at the end of a fight. The end screen shows the run's Ledger and who held out.

### 12.4 Losing well

- Every boss shows its next move in numbers, and every death traces to a fight both players watched.
- The end screen shows the **loss line** of the boss that won (9), the best Combo, the highest LINK count, the best
  Overkill, and the Haul cards the pair passed that would have answered it: "You passed Unwrite on turn 21."
- A coach line the first time each format appears: Tandem ("Your fights run side by side. Links cross the gold
  edge."), Charge ("Win first, then go help."), Fusion ("Your Twins become one minion.").

### 12.5 The honest vocabulary count, and the First Road

New player-facing words this mode adds, where each is first taught, and on which turn of the **First Road** (a pair's
first run, which fixes Act 1's doors and Hauls to teach in order):

| # | Word | What it is | First Road |
|---|---|---|---|
| 1 | **Haul** | the 4-card loot row | turn 1 |
| 2 | **Thread** | the six colours tied to trigger families | turn 1 (the Spark pick) |
| 3 | **Link** | run-long loot that wires boards | turn 1 (the starter) |
| 4 | **Twin** | your slot N and your partner's slot N | turn 2 (guides shown, coach line) |
| 5 | **Handshake** | the shared card; both take it for a Twin Link | turn 3 (forced to a strong fit) |
| 6 | **Rack** | where Links live | turn 3 |
| 7 | **Burst** | one-shot loot | turn 4 |
| 8 | **Charge:** | win, then cross over to help | turn 5 (a Juggernaut door, a scripted early win) |
| 9 | **Resonance** | pair levels per Thread wake a bonus | turn 6 (the first step wakes) |
| 10 | **Graft** | loot on one minion | Act 2, turn 9 |
| 11 | **Melt** | full Rack: swap one out, the new one enters a level higher | Act 2 (Rack hits 6) |
| 12 | **Momentum** | overkill pays Gold and rarity | Act 1 boss, first phase break |
| 13 | **Wrath** | the boss grows when you are ahead | Act 2 boss (first time it can show) |
| 14 | **Ghost** | the fallen state | when it first happens |
| 15 | **Fused** / **Fusion** | Twins merged into one board | Act 3 boss |
| 16 | **Assist:**, **Baton:** | two trigger words on Link minions | on first sight (card text explains itself) |

Sixteen entries, nine of them taught in Act 1. Combo names, boss names and loot names are proper names, not rules.
Glossary pills cover all of them. The Haul tab has a "What is this?" pill that opens the glossary page (no modal).

---

## 13. Two narrated example runs

### Run 1: "The Ferry" (Mayhem 0, Set 2, a win, 54 minutes)

**Kevin:** Lord of the Risen, Spark **Bone**, goes Beasts. **Mike:** Auctioneer, Spark **Ember**, goes Dragons.
Starters: Kevin *Echo Chamber I*, Mike *Chorus Line I*.

**Act 1, The Hollows** (the door panel shows Mother Hollow).

| Turn | Door | Kevin's row (Yours / Pull / Wild) | Handshake | Picks | Why |
|---|---|---|---|---|---|
| 2 | Brawl | Borrowed Breath / Dragonsong / Jackpot | **Lend a Shield** | Kevin Jackpot. Mike Megaphone (his Yours). | Tempo first. Jackpot's partner refresh finds Mike a Tier 3 Dragon. |
| 3 | Brawl | Undertakers / Call and Answer / Last Rites | **Ghost Relay** (Legendary, forced strong on the First Road) | **Both take Ghost Relay: Handshake!** | Twin Link at level II both ways: first 3 deaths cross, either direction. Kevin moves Wolvie to slot 2 because Mike's Karwind sits there. |
| 4 | Forge Fight | Echo of a Voice / Two Throats / Graveyard Shift | Thunder Pact | Kevin **Echo of a Voice** on Wolvie (Graft). Mike Thunder Pact. | Wolvie's Echo now triggers its Twin's Shout: Karwind. "Any Shout gives Dragons +4/+4." |
| 5 | **Juggernaut: The Twin Wardens** | | Opening Volley | Kevin Opening Volley. Mike Call and Answer. | Kevin wins on step 9 and **Charges** into Mike's fight; both Wardens die within 2 steps. Pick 2 next turn. |
| 6 | Mystery (Storm Front) | Pick 2: Return to Sender, Slaughterhouse, Echo Chamber (level up), Tag In (Wild, all Storm) | Mirror Strike | Kevin Echo Chamber II and Return to Sender. Mike **Tag In**. | Bone Resonance I wakes (Kevin's Spark needs 3): Rise minions return with +3/+3 on both boards. |
| 7 | Campfire | | | Kevin Gilds Grim. | |
| 8 to 10 | **Mother Hollow** | Boss Wild: Heartstring, Mirror Strike, Opening Volley | | see below | |

**The boss.** Phase 1 breaks in one turn on 9 Momentum. Phase 2 is the lesson. Kevin's Half dies on step 6 and the
3-step ring spins on Mike's Half at 9 Health. Mike's Echohorn Rallies on step 7; Thunder Pact triggers Kevin's slot 3
Rally; Tag In makes Mike's slot 1 attack at once. Mike's Half drops to 1. On step 8 a ghost Hawkus from Kevin's front
drops into Mike's slot 4 through Ghost Relay and, as a summon, attacks next: "SYNCED" on both screens, LINK x11. Phase 3's
Cross Brood is ugly for a turn, then Kevin's Wolvie dies, Echo of a Voice fires Karwind's Shout on Mike's side, and
the queen falls with **OVERKILL +22**: +2 Gold each and two rarity steps. Boss Hoard (Mythic Handshake): **Twilight
Pact**. Both take it before either says a word.

**Act 2, The Gilt Deep.**
- **Turn 12, Vault (100%).** Row of 6, pick 2. Kevin takes **Shared Grave** and levels **Ghost Relay** to III (full
  Health ghosts). Mike takes **Two Throats** and **Dragonsong**. Mike's Rack is full at 6 on turn 13; he **Melts**
  Call and Answer, and Kin of Two Kinds enters at II.
- **The Combo:** Kevin's Ghost Relay plus Mike's Echo Chamber (Mike took it as a Pull on turn 14 to make exactly this)
  forms **Haunted House**. Banner on both screens: ghosts keep their Echo, and it triggers on both fronts.
- **Jormun (turns 15 to 17).** Wrath +1 ("you are 4 levels ahead"). The Head hunts Mike's slot 2. Kevin drags the hunt
  onto himself (+5/+5 on the Head) because his board is Rise everywhere. Turn 1: One Body drops 61 from Kevin's side and
  48 from Mike's: phase broken, OVERKILL +19. Turn 2 (Head swap): Mirror Strike was never taken, so Tag In does the
  syncing. Turn 3 (Ouroboros): Shed would flood a slow board, but with Haunted House every early death on one front
  lands on the other with Echo, and both Echo Chambers keep the ghost Echoes firing. The fight ends at **LINK x31**,
  bundled into Link Surges after step 10. Boss Hoard: **Spellstorm** (Kevin passes, it does nothing for Beasts) and
  **Hivemind** (Kevin takes it).

**Act 3.** Vel. Phase 1 makes Kevin fight a copy of Mike's Dragons. Mike offers to sell Karwind for a turn. Kevin says
no: his Rise wall outlasts the copy's Shouts, and it does. Phase 2's Turned Links hurt: Vel's copy of Ghost Relay drops
enemy ghosts into Mike's slots. Mike falls to 6. Phase 3, the forced Fusion, is the payoff: Kevin's Gilded Grim and
Mike's Karwind are Twins in slot 2 and become one Fused 61/58 with Echo, Shout and Ward; Twilight Pact doubles every
Start of Combat; every Link fires inside one board with no gap. **LINK x44.** Vel's reflection dies with 3 Fused
minions standing.

**Finale** (opt-in, they take it). Crown 2's Pendulum Severs Haunted House's half (Echo Chamber) on step 3. Crown 3's
Titan takes 60 and 60 across two fights; the last Limb is **CAUTERISED** by a Return to Sender reading inside the
Fused board. "1,214 Links crossed."

**Why it worked:** they put the wire in slot 2 early (Wolvie and Karwind as Twins), took the Handshake together every
time it fed that wire, and used Pull picks to build Combos on purpose.

---

### Run 2: "Tax Season" (Mayhem 2, Set 2, a loss with a lesson, 46 minutes)

**Kevin:** Gorun, Spark **Storm**, goes Demons (Shop buffs). **Mike:** Warden, Spark **Steel**, goes Kobolds (Rubies).
Starters: Kevin *Opening Volley I*, Mike *Lend a Shield I*.

**Act 1.** The Gobbler King. Kevin takes **Market Share** on turn 3: his Contract Butcher's Shop buffs now land on
Mike's Shop Twins. Mike takes **Gemlink** as his Pull on turn 4 (a Star Link that wants Kevin's board to have a
Kobold). Mike pings "Twin here" on Kevin's slot 3. Kevin buys one Prospector just to sit in slot 3. Every Ruby Mike casts
on his slot 3 also casts on Kevin's Prospector, which becomes the run's tankiest Demon-board Kobold.

The Gobbler's Appetite pills sit on Kevin's Shop slots 5 and 6 every turn. Kevin freezes once, then starts feeding him
a Market Tormentor's leftover 1-drops on purpose. In phase 2 the King swallows a copy of Mike's Gilded Geode Guardian.
Kevin's front kills the King first, and the **BURP** spills the Guardian onto Kevin's front at +5/+5, Gilded, where its
Echo summons a Gemheart Golem with its Rubies. Victory: Mike gets the Guardian as a real Gilded card.

**Act 2.** Kevin grafts **Crossfire** onto his 30-Attack Imp lord and takes **Overkill Express**. Mike takes
**Bodyguard** as a Handshake that Kevin joins (Twin Link: slots 1 and 2 guard for 5 attacks) and **Iron Twins**. The
plan: Kevin's board is a cannon that shoots into Mike's fight; Mike's board is a wall that guards Kevin's slots 1 and 2.
Steel Resonance II wakes on turn 13: Taunts on both boards +0/+8.

**The Grand Tithe.** The lesson starts. Twice the Handshake was a Gold card neither wanted, so the Tithe's eye sat on
**Swap Meet** and **Joint Account** in their rows and took them (Appetite 4, the most it can). In phase 2 it borrows
Kevin's Crossfire (fired most) and shoots it into Mike's fight in boss-colour bolts. Mike falls to 0 and becomes a Ghost.

Turn 17. Mike, as a Ghost, takes his gift slot: "Your partner's slot 1 minion gains Rebirth this combat." Kevin's front
wins on step 11 while Mike's Ghost front is still running at 2 vs 3. **CHARGE!** Kevin's four survivors burst into Mike's
arena from the right; Overkill Express spills into the last Collector; the Ghost front is won. **BACK!** Mike returns at
12. The Tithe dies the turn after and the **REFUND** levels both stolen cards for the player who passed them: Mike gets
Swap Meet as two copies, Kevin gets Joint Account at II.

**Act 3, Vel.** Here they die. Reflect copies the Haul cards they take; Kevin takes Swap Meet anyway. Phase 2 copies
both Racks, and Vel's copy of Swap Meet sends its copy of Kevin's Crossfire Imp into Mike's slot 7 at Start of Combat.
Mike's wall faces the wrong way for a 60-Attack Imp behind it. Both fronts lose. Mike falls again. Kevin gives up his
Haul pick for 2 turns to bring Mike back, and that is the turn **Unwrite** was in his Wild.

**The end screen:** "Vel's copy of your cannon came through Swap Meet. Unwrite was offered on turn 21." Best Combo
**Shield Wall**, best LINK x26, Overkill +19.

**The lesson:** a pair whose engine is one huge cross-board threat is exactly what Vel turns around. The answer was in
the Haul: a second threat, or the boss's own themed card.

---

## 14. Highlight moments catalogue

1. **Handshake!** Both chips snap onto the shared card in the same second without a word.
2. **The first bolt.** Turn 3, your Echo fires and a pale green bolt crosses to your partner's slot 2. "Was that you?"
3. **Twin here.** You move your carry one slot left because your partner's Tag In lives there, and it wins the fight.
4. **SYNCED.** Mother Hollow's Halves die within the ring, one in each fight.
5. **BURP.** The Gobbler King spits your partner's swallowed carry out onto your front, Gilded.
6. **Mid-air Swap.** Two dragons cross the gap in slow motion and each of you meets the dragon your partner wounded.
7. **One Body.** A Crossfire shot in your partner's fight kills the serpent's head in yours.
8. **REFUND.** The Tithe dies and every card it stole comes back levelled up.
9. **Lightning Rod.** A screen of bolts breaks Voltara's bar in one fight; the bolt count reads 40.
10. **Restored.** The Linkbreaker's Severer dies and your Echo Chamber snaps back with a bolt.
11. **You fight your friend.** Vel's phase 1: your partner's whole engine, pointed at you.
12. **Turned Links.** Your own Ghost Relay drops Vel's ghosts into your partner's slots. You apologise.
13. **CHARGE!** Your fight ends, your survivors run off, and both clients cut to your partner's arena as they burst in.
14. **BACK!** A Charge wins your Ghost partner's fight and they return at 12.
15. **The Ghost's gift.** A fallen player's gift slot hands their partner the Rebirth that wins the phase.
16. **FUSION.** The arenas slide together and your Twins become one minion with both bodies.
17. **LINK x20.** The counter turns gold. Nobody can follow the bolts any more and nobody cares.
18. **The Combo banner.** "COMBO: Haunted House", the first time it ever fires.
19. **Resonance wakes.** A colour sweeps both boards and a new rule slides into both Racks.
20. **Golden Gift.** You Gild your partner's best minion from across the table.
21. **Steal the Star.** One of you feeds the Star Seed for three turns, the other buys it as a 40/40.
22. **CAUTERISED.** A head dies to a crossing and stays dead. The whole run's loot was for this.
23. **OVERKILL +40.** A bar shatters with a number bigger than the bar, and both Haul tabs light up.
24. **The Ledger.** "Kevin gave Mike +212/+190 this run." Read out loud.

---

## 15. Architecture mapping and risks

### 15.1 Reused as-is

| Need | Existing piece |
|---|---|
| Rooms, seats, ready gate, Hero Select, clock, lock, pause, reconnect, spectators, emotes, Peek | Versus (`ui/src/versus/*`, Versus SQL + Edge Function) |
| Shop, economy, tiers, triples, Gilded, Discover, Choose One, Whispers, Equipment, Starform, Rubies | `packages/sim` as is |
| A single fight (each front, a Charge leg, a Fused fight) | `simulate()` |
| Enemy boards with Auras, spell power, rune flags | authored boards + enemy `CombatSideState` (symmetric) |
| Runes and the Runeforge (Forge Fight) | `RUNES`, `EPIC_RUNES`, the forge flow, verbatim |
| Haul row frames, Rack | the Runeforge offer-row component, the rune-row component |
| Graft and ally targeting | the existing targeting arrow |
| Door panel, Hoards | Menu backdrop + card-frame pills; Discover frames |
| Shop-resident boss object (Star Seed) | the Starform pinning rule |
| Gild a partner's minion | the Gild primitive (Indy, Auric Runemaster) |
| Live text | `cardText.ts` helpers into `liveCardText` and `Unit.tsx` |
| Ally lane | the lobby scouting-board component |

### 15.2 Extended

- **Trigger multipliers** gain a partner scope (Two Throats, Call and Answer) and a phase scope (Twilight Pact, Dragon's
  Pact) on `TriggerMultiplierDef`.
- **"Attacks immediately"** gains a cross form (Opening Volley, Tag In, Mirror Strike).
- **Rune duplicate rule** reused for Link levels.
- **Hero powers:** one generic ally-scope flag on friendly-target kinds, +1 Gold.
- **`CombatConfig`:** `frontLead`, `injections` (Lead-and-Follow), `fusedFrom` metadata for owner pips.
- **Versus server resolve:** resolves two fronts (Lead-and-Follow, then Tandem), plus Charge legs and Fusion.

### 15.3 New primitives and systems (the honest list)

**A. The Tandem engine (XL; the bravest bet).** Make `simulate` steppable: a cursor that resolves one attack and its
trigger chain, then yields (`init`, `step`, `drainInbox`, `isOver`). A `simulateTandem` driver alternates fronts,
routes crossings to the other front's next step boundary, merges both logs with a global step index, enforces the
Ping-pong guard and the 200 backstop. Each front is still one player side against one enemy side, so **combat symmetry
holds per front**; the bus reads per minion and per side, never per seat. New `CombatEvent` kinds (`linkOut`,
`linkIn`, `crossMove`, `chargeIn`) are a shared-boundary change in `core/types.ts`: Kevin and Mike agree first.

**B. Lead-and-Follow (M; the middle step).** Before Tandem: run the leading front with plain `simulate`, collect its
crossings with step indices, then run the other front with those crossings **injected** at matching steps (a new
`injections` input). Crossings from the following front into the lead land in the lead's **next** fight, and the Link
text says so while you lead ("Lands next fight while Mike leads."). The lead alternates every turn, so both directions
get live crossings half the time. A Charge is a continuation leg (C). Two plain `simulate` calls plus injections:
server-friendly, testable, ships first.

**C. The continuation rule (S).** A Charge leg or a Charge into a running fight carries current stats and spent flags,
sets `socSpent`, and the arriving board attacks first (8.4). One function, used by both Lead-and-Follow and Tandem.

**D. Ally scope (M).** `scope: 'twin' | 'partnerBoard' | 'partnerFront' | 'partner' | 'both'` on effect subscriptions
and targeted effects. In the Shop it resolves as an ally op on the receiving seat through the team bus; in combat
through the inbox (Tandem) or injections (Lead-and-Follow). Every Link and most Grafts are data on this one primitive.

**E. The team state and team bus (M).** Each player keeps a full `RunState`. A server `TeamState` holds doors, boss
bars, Momentum, Wrath, Resonance counts, Ghost state, the Haul seeds and picks, and the **sequenced bus** of cross-board
Shop actions (Hand Off, ally casts, Shop-phase Links). Each client applies incoming ops in server order, so each
`RunState` stays a deterministic fold of its own actions plus the ordered bus. The server re-derives both prepared
sides from the two action logs plus the bus before resolving (Versus trusts prepared sides more today; check before
building).

**F. The Haul (M).** A server-side generator: tag profiles (generated from effect subscriptions at build time, plus an
override file), anchors, slot rules, rarity table, steps, guarantees, refits. Loot defs are zod-validated data:
`LootDef { id, kind, rarity, thread, levels[], anchor, scope, fireCap?, bothMustTake?, aloneText?, fusedReading,
themedFor? }`, where each level points at existing `QuestReward` kinds, ally-scoped subscriptions, or card ids.

**G. Cross primitives (M each, L together).** `crossSummon` (Ghost Relay, Tag Team Imp, Cross Brood), `crossDamage`
(Crossfire, Overkill Express, Gap Bolt), `crossRedirect` (Bodyguard), `crossMove` (Swap Meet, boss swaps, Charge),
`sharedBody` (Jormun, Iron Twins, Heartstring), the `Charge:` / `Assist:` / `Baton:` triggers, `sever`.

**H. Fusion (M).** A pure `fuseBoards(a, b, sideA, sideB) -> { board, side, splitMap }` before the fight and
`splitCarry` after. One 7-slot side, so `simulate` is untouched. Each Link def carries its Fused reading.

**I. Bosses (L).** Phase machine, intent cycles, Appetite budgets, the boss Rack (Tithe), board copies (Vel), regrowth
with a cauterise check that reads an effect's cross tag (Seven-Crowned), the boss Star Seed in both Shops, Wrath.

**J. Presentation (L).** The gap, the lane, Twin guides, bolts and five shapes, chips, Linked pill, bundling, the Haul
row, the Rack, the Resonance gauge, boss touches (11.5), the new beats and their policies.

### 15.4 Determinism and seeds

`fork(runSeed, 'haul', turn, seat, refit)` for the Haul; `fork(runSeed, 'fight', turn)` for each Tandem fight (one
seed, forked per front inside); `fork(runSeed, 'doors', step)` for doors. Picks, Hand Offs and ally ops are sequenced
team ops in each seat's action log. A run replays from runSeed, both action logs and the bus. The Haul is generated on
the server so clients cannot fish for offers.

### 15.5 Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Steppable `simulate`** | ~6.7k lines, one internal loop. | Lead-and-Follow ships first. The cursor lands behind the parity test: a stepped front with no crossings matches plain `simulate` byte for byte across the golden suite. |
| **Degenerate loops** | Two Links feeding each other through the partner. | Ping-pong guard, printed caps, 200 backstop, a fuzz test that builds random Racks and runs 10k Tandem fights checking termination and frame budget. |
| **Snowball** | No caps, Twin Links, Refunds, Momentum. | Accepted, fun first. Wrath is the visible rubber band; Refund is capped by 3 steals per phase; Momentum is capped at +3 Gold and +2 steps; the phase gate keeps every signature live. Target run win rate at Mayhem 0: 55 to 65% for median pairs. |
| **Sacrificial board** | One strong board carrying an empty one. | A Saved front deals no damage of its own; the sacrificial-board test (16.6) must show slower bar breaks. |
| **Shop-touching bosses** | The owner may refuse bosses that take Shop cards. | Telegraph a full Shop ahead, printed Appetite budget, pool copies return. If refused, the Gobbler eats combat copies only and the Tithe only takes unpicked Haul cards (it never touches the Shop). |
| **Readability** | 12-slot Racks, bolts everywhere. | Twin anchor (every bolt goes straight across), bundling, Linked pill, Ledger, Melt, 16-word vocabulary with the First Road. |
| **Live text load** | Every Link, level and Fused reading needs current text on both chains. | Helpers ship in the same PR as each primitive; Doc Bot's tripwire covers loot defs. |
| **Perf** | Bolts, lane tiles, counters in a fight. | 11.11; profile the worst Act 3 fixture on the prod build before Phase 2 ships. |
| **Act 3 tuning** | Links add power not in recorded boards. | Anchor to wave-N boards times measured uplift; record Expedition's own boards from Phase 1 and retune. |

---

## 16. MVP vs full vision, with sizes

### 16.1 Phase 0a: "First Haul" offline, bot partner (L)

- One act (The Hollows), Brawls, one Juggernaut (Twin Wardens) and the **Gobbler King phase 1** (Appetite, Gulp copies;
  no Burp). Twin fronts as **two separate `simulate` calls**: nothing crosses inside a fight yet.
- The Haul with **20 entries** that need no in-fight crossing: Shop-phase Links (Chorus Line, Call and Answer, Spill
  Over, Gemlink, Market Share, Joint Account, Tier Draft, Ale for Two, Graveyard Shift), Start-of-Combat crossings
  compiled at lock into the partner's side (Lend a Shield, Opening Volley, War Herald, Storm Bridge, Engrave the Pair),
  partner-reading scalers (Undertakers, Power Grid, Kin of Two Kinds), Bursts (Jackpot, Golden Gift, Field Promotion).
- The Twin rule, Threads, levels, the Handshake, Refit, the Rack, the ally strip, Shop bolts, chips, live text.
- The bot partner: board-fit tag score for its pick, "take the Handshake if the human pinged it".
- **Question:** is a per-turn co-op loot draft with Twins fun on its own, before anything crosses mid-fight?

### 16.2 Phase 0b: dev room with real pairs (M)

- The same content in a **host-resolved** dev room (the host client resolves; no server work).
- **6+ real pairs**, per-turn logging of every pick, Handshake (who took it first, whether the other followed), ping,
  Refit and Reroll, and "who decided" (a one-tap post-turn tag).
- **Question:** does the Handshake create talk without an alpha? Do private rows keep both players engaged?

### 16.3 Phase 1: "Lead and Follow" online (L)

- Versus rooms and server resolve of **Lead-and-Follow** (15.3 B) plus the continuation rule (C): live crossings from
  the lead into the following front, next-fight landing the other way, alternating lead.
- The Charge (both cases), Ghosts and every way back.
- Acts 1 and 2: Mother Hollow (Sync works lead to follow), the full Gobbler King, Jormun, the Grand Tithe, Aurex and
  Noctra; four Juggernauts; doors.
- 40 loot entries, Grudges, 6 Combos, Resonance, Momentum, Wrath.
- **Question:** do crossings that land mid-fight feel like the heart of the mode?

### 16.4 Phase 2: "Tandem" (XL)

- The steppable `simulate` and `simulateTandem`, behind the parity test, replacing Lead-and-Follow. Both directions
  live every fight. Bundling, the LINK counter, the full lane.
- Act 3: Voltara, Vel (with Fusion), the Hungering Star; the Linkbreaker and the Colossus; Fusion and FUSION.
- All 57 entries and 8 Combos.

### 16.5 Phase 3: "Crowned" (M each)

- The Seven-Crowned Engine, Mayhem 1 to 8, Tier 7 Linkmaker, set packs for Set 3 (Spirits, Undead) and Set 4
  (Celestials, Shared Sky).

### 16.6 Measurement harness (S to M, alongside Phase 0a)

- The **bot driver**: bot pairs play full runs headless. The **bot bar**: the bot must reach 90% of the median human
  snapshot's board strength at turns 7, 12 and 17 before its tuning results are trusted.
- The **sacrificial-board test**: a "one strong, one empty" pair must break bars measurably slower than a median pair.
- The **fuzz test**: random Racks, 10k fights, termination and frame budget.
- Win rate per Mayhem level, uplift per act, Wrath frequency, Momentum per boss.

### 16.7 Sizes at a glance

| Piece | Size |
|---|---|
| Haul generator + loot defs + Rack + levels + Melt | M |
| Ally scope (Shop + combat) | M |
| Team state + bus + server validation | M |
| Lead-and-Follow + injections + continuation rule | M |
| Tandem engine (steppable `simulate` + parity) | XL |
| Cross primitives (G) | L together |
| Fusion transform + Fused readings | M |
| Bosses (9) + Juggernauts (6) | L |
| 57 loot entries + 4 Grudges + 25 mode cards | M (data on primitives) |
| Presentation (lane, gap, bolts, chips, Haul row, Rack, gauge, boss touches, beats) | L |
| Doors, Campfire, Vault, Mayhem | S to M |
| Bot partner + measurement harness | S to M |

### 16.8 Art (placeholder first; the owner names files before any wiring)

Painted: the gold gap edge, the Haul row backing, Thread band colours (if not a tint), boss portraits and act
backdrops, the Ghost frame variant, Vel's pale frame, the boss-colour frame, boss and Juggernaut tokens. No code-drawn
props.

---

## 17. Open questions (short)

1. **Tandem engine:** is a steppable refactor of `simulate` acceptable behind the byte-identical parity test? If not,
   Lead-and-Follow becomes the shipped mode.
2. **No damage caps,** with Wrath as the only rubber band. Is that the event feel you want?
3. **Shop-touching bosses** (Gobbler eats Shop cards, the Tithe takes Haul cards) under a printed Appetite budget:
   keep, or limit to combat copies and Haul cards only?
4. **A won Charge fully saves** the partner (and deals no damage of its own). Agree?
5. **Health 40** plus Armor, or the lobby's 30?
6. **Spark Thread** as the only identity layer beyond the hero. Enough?
7. **Fusion** forced in Vel and the finale, optional through FUSION. Right amount?
8. **Name:** Expedition, or the rival draft?
