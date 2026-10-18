# EXPEDITION: the two-player co-op PvE event for ASCENT (scope v3)

*Design scope and vision document. 2026-10-17. Design only. No code is written or implied by this document.
Supersedes `2026-10-17-coop-mode-scope-v2.md` (kept as it was for the record).*

## The one-page pitch

**EXPEDITION is ASCENT for two friends against the world.**

Two players. Two boards. One run. You recruit side by side in the Shop you already know, then fight side by side, and
everything you take makes your two boards play as one machine. Your Echo brings your friend's Dragon back. Your Rally
makes their carry attack. Your Drakko, parked in the slot you share, makes **both** of you Shout twice. And the bosses
do not just fight you: they reach into your Shop, curse your best minion, tax your Gold, silence your hero, and dare
you to answer them **together**.

**The hook, in three beats.**
1. **Every turn, a Haul.** Four loot cards, one of them shared. Take the same one and it becomes a Twin Link that fires
   both ways. One short conversation a turn: "Handshake?"
2. **One slot, two boards.** Slot 7 is the **Shared Slot**. Whatever sits there stands on both boards and fights in both
   fights. It is the pair's carry, fed from two Shops, swapped on alternating turns.
3. **Bosses that hit the recruit phase, and a way around every blow.** "Next turn: Rot 2 on Kevin's Wolvie. Answer:
   Mike splits it." Split it, and next turn both halves turn gold. Every curse on one player opens a door on the other.

**Why it is special.**
- **It is still ASCENT.** Same Shop, Gold, tiers, triples, keywords, runes. Shout is Shout. Echo is Echo. A player who
  knows ASCENT already knows how to play.
- **Co-op that is about the game, not about chat.** You plan in slots (Twins), in loot (the Handshake), and in the one
  slot you share. You save each other with a Charge, a Hand Off, two coins of Send Gold, or by taking a Curse onto your
  own board.
- **You build your hero as you go.** Nobody starts with a hero power. You find them: from bosses, elites, the Haul and
  the Campfire, up to three, levelled and swapped. Your finished hero is the story of your run.
- **Bosses drop themselves.** Beat the Gobbler King and he might become your card: a minion in your Shared Slot that
  eats a Shop card every turn and spits out a Gilded army when it dies.
- **It looks like a showpiece.** One visual grammar, a storyboard for every mechanic, a 60-second trailer you could cut
  tomorrow, and the 160 fps bar on every frame (section 17).

> Two heroes. Two boards. One Haul every turn. Grab the loot that wires your boards together, park your Drakko in the
> Shared Slot so both of you Shout twice, and when the serpent curses your carry, let your friend take the bite.

## What changed in v3

Owner feedback (Kevin, 2026-10-17): keep the concept ("actually loves" it); use ASCENT's own keywords ("Shout is
Shout, not Ember"); add cards that work on both boards for a turn and a shared, swappable card slot; give enemies their
own art; add boss drops, boss cards and rune drops; start with no hero power and build the hero; make bosses press on
the recruit phase with co-op bypasses; make Curses a real system; raise the presentation to pitch quality.

1. **Real ASCENT vocabulary everywhere.** The six Threads (Ember, Bone, Steel, Storm, Gold, Star) are gone. Every loot
   card carries the **real keyword pill** it builds on (Shout, Echo, Rise, Rebirth, Avenge, Ward, Taunt, Rally,
   Slaughter, Pummel, Overflow, Start of Combat, End of Turn, Gold, Gild, Rubies, Shop spells, Whispers, Starform). The
   catalogue (7.8) is grouped by those keywords. Bolts use the keyword's own ASCENT colour.
2. **The combo layer is Harmony, named by keyword** ("Shout Harmony II"). Not "Resonance": **Rune of Resonance** is a
   live Set 2 rune and **Resonance** is a Set 1 spell.
3. **NEW: Both boards (8).** "Until your next fight ends, this works on both boards." 12 entries, each storyboarded.
4. **NEW: the Shared Slot (9).** Slot 7 is one slot for both boards; the pick alternates; it fights as a copy on each
   front. Rules for swaps, the lock, buffs, deaths, Gilds and triples, and 6 entries built around it.
5. **NEW: Curses (11).** On a minion, a Shop, a hero, or a card in hand; applied by bosses, enemy units, events and
   risky loot; Take, Split, Cleanse, buy out; Curses that **turn good**. 14 Curses.
6. **NEW: bespoke enemies (12).** Enemies no longer reuse shoppable cards. A full Act 1 roster (15 pack units, the Vault,
   2 elites, 2 bosses: 22 portraits).
7. **Bosses press on the recruit phase (13.2, 13.3).** 14 asymmetric pressures, each with an opening on the partner, a
   co-op bypass, a worse solo fallback, and a three-line telegraph (WHAT / WHO / ANSWER). Every boss has an **Exam**:
   the co-op skill it tests.
8. **NEW: drops and boss cards (14).** Seeded drop tables, hero powers, mode runes and ASCENT runes, and a shared chance
   that the enemy drops **as a card**. A boss card for every boss and elite (15).
9. **NEW: build your hero (15).** You start with **no hero power**. 3 slots, levels I to III, Melt to swap. 20 findable
   powers, reusing ASCENT's `HeroPowerKind`s where they fit, plus 6 co-op powers. A hero is a cosmetic portrait.
10. **NEW: the Presentation Bible (17).** The two-player screen layout, the visual grammar, feel rules, 20 storyboards,
    the 60-second trailer and the full asset list.
11. **Vocabulary cut and audited** (19). Removed: Thread, Spark Thread, Resonance, Rack (Links sit in the rune row),
    Refit and Reroll (one Haul **Refresh**, the Shop's own verb), Hoard (now **Boss Haul**), Grudge (now **Comeback**),
    Hit (now "damage"), Storm Front (now **Rift Fight**), the Link Ledger (now a plain recap), **Assist:** and
    **Baton:** (now plain text and Echo), and Ghost Relay (now **Ferry**, so "Ghost" means only the fallen player).
12. **Kept as Kevin liked them:** the per-turn Haul and the Handshake, the Twin rule, Links / Grafts / Bursts / Cards,
    Charge, Tandem, the over-the-top bosses, Momentum and Wrath, the Ghost, the visibility law, the MVP path. The
    examples, combos, example runs and catalogue are rewritten to the real keywords and the new systems.

## Executive summary (15 lines)

1. **Expedition** is ASCENT for two: same Shop, Gold, tiers, cards, keywords, runes; every fight is `simulate()`.
2. A run is 3 acts and a finale, about 28 turns and 50 to 58 minutes. **Every turn is one ASCENT turn and one fight.**
3. **Every turn a Haul arrives: 4 loot cards, take 1, free.** Three are private; the **Handshake** is shared.
4. Both take the Handshake and it becomes a **Twin Link**: level II, firing both ways. **Your slot N and your partner's
   slot N are Twins**; every automatic cross effect lands on a Twin.
5. Loot comes as **Links**, **Grafts**, **Bursts** and **Cards**, each wearing a real keyword pill. Pair levels per
   keyword wake **Harmony**.
6. **Both boards:** loot that makes a minion, a spell or a trigger count for both of you until the next fight ends.
7. **The Shared Slot:** slot 7 is one slot for both boards. Its minion works on both boards and fights on both fronts.
8. **You start with no hero power.** You find up to three, from drops, the Haul and the Campfire, and level them up.
9. The two fights run on one step clock (**Tandem**). Win your front and your survivors **Charge** into your partner's.
10. **Enemies are a bespoke roster** with their own art. Nine bosses and six elites break ASCENT rules out loud.
11. **Bosses press on the Shop**, a turn ahead, with an Answer the pair can play together: Split the Rot, pay the tax,
    thaw the coils, shop for each other.
12. **Curses** sit on minions, Shops, heroes and hands; your partner can Take, Split or Cleanse them, and some turn good.
13. **Drops**: hero powers, runes and loot, plus a shared chance to win the enemy itself as a **boss card**.
14. **No damage caps.** Overkill is **Momentum**; bosses gain printed **Wrath** when you run ahead. A fallen player is a
    **Ghost** who still plays and can be Charged back.
15. Every cross effect is seen on both screens (source, travel, landing, chip). MVP: offline with a bot partner, a dev
    room, Lead-and-Follow online, then Tandem.

## Contents

1. Pitch and name
2. Pillars (fun first)
3. Core loop: one ASCENT turn per step
4. Run structure and pacing
5. Solo vs co-op split
6. Identity: a portrait, a starter Link, and no hero power
7. THE HAUL: the per-turn loot system
8. NEW: Both boards (12 entries)
9. NEW: The Shared Slot (full design and 6 entries)
10. Other co-op mechanics: Hand Off, Send Gold, Take, ally scope, Tandem, the Charge, Fusion, Momentum, Wrath
11. NEW: Curses (14)
12. NEW: Enemies have their own roster and art
13. Bosses: 9, plus 6 Juggernauts, with recruit pressure and bypasses
14. NEW: Drops and boss cards
15. NEW: Building your hero (20 findable hero powers)
16. Mode-only cards and keywords
17. The Presentation Bible (layout, grammar, feel rules, storyboards, trailer, assets)
18. Difficulty (Mayhem) and falling
19. New vocabulary (the honest list) and the First Road
20. Two narrated example runs
21. Highlight moments catalogue
22. Architecture mapping and risks
23. MVP vs full vision, with sizes and the art list
24. Open questions

Player-facing strings (in quotes, on cards) follow the owner's text rules: short plain sentences, no em dashes, never
"Oath" or "climb", ASCENT's displayed keyword names only (Shout, Echo, Ward, Flurry, Execute, Rise, Gilded ...; never
Battlecry, Deathrattle, Divine Shield). All numbers are first pass, to be measured by the bot driver and the dev-room
pairs (23).

---

## 1. Pitch and name

**Name: EXPEDITION.** (The full pitch is on page one.)

> Two heroes. Two boards. One Haul every turn. Grab the loot that wires your boards together, park your Drakko in the
> Shared Slot so both of you Shout twice, and watch your Beast's Echo bring your friend's Dragon back on the other
> half of the screen.

- **It is ASCENT.** Shop, Gold 3 rising to 10, tiers 1 to 6, triples, Gilded, Discover, Choose One, runes at the
  Runeforge, Shop spells, Rubies, Whispers, Equipment, Starform. A player who knows ASCENT knows how to play.
- **Every turn opens a Haul.** Four loot cards above the Shop. You take one. Most of them do not make *your* board
  bigger. They make your boards **talk**: your Echoes trigger on your partner's board, your Rallies make their minion
  attack, your dead come back on their side, your Taunt guards their carry.
- **Some loot makes a card count twice.** Shared Shout: the next minion you play works on both boards until the fight
  ends. Play Drakko and both of you Shout twice. Play Karwind and every Shout on either board feeds both Dragon boards.
- **One slot belongs to both of you.** Slot 7 is the **Shared Slot**. Put Echohorn there and it Rallies in both fights.
  Your partner can swap it out for their own card on their pick turn. It is the pair's carry, fed from two Shops.
- **Twins make it plannable.** Your slot 3 and your partner's slot 3 are Twins. Every automatic cross effect lands on
  a Twin. So board order becomes a co-op plan: "Put Karwind in slot 2, my Wolvie lives in slot 2."
- **Fights are linked.** Your fight and your partner's run side by side on one clock. A Link in your fight crosses the
  gap and lands in theirs a step later, with a bolt both of you see.
- **Bosses break the rules out loud.** A serpent with one body in two fights. A Tithe that steals the loot you passed
  on. A storm queen who cuts your Links, then takes damage from every Link that crosses. A mirror that copies both
  boards and Fuses them against you. A Gobbler that swallows your Shared minion.
- **It is an event, not a ladder.** Huge numbers, "LINK x31", overkill fireworks, Gilded copies raining into both
  hands. A strong pair is meant to feel unstoppable for a turn. The bosses are built to stop them anyway.

**The north-star moment.** The ribbon reads "Jormun bites Mike's slot 2 for 30 this fight." The Shared Slot holds
Mike's **Echohorn**, so it stands in slot 7 on both boards. Kevin's slot 2 is a Taunt Wolvie; its Twin is Mike's slot 2
carry. Kevin's Haul shows **Bodyguard**. He takes it. The Handshake is **Ferry** and both chips land on it:
"Handshake!". In the fight the head lunges at Mike's carry and Kevin's Wolvie steps through the gap to take the bite.
Wolvie dies, its Echo gives a Beast Rise, and Ferry drops it into Mike's slot 2. On Mike's front the Shared Echohorn
attacks; its **Rally** triggers the left-most Echo there, which is Kevin's ferried Grim: Mike's Beasts gain +8/+8. The
tail dies on Mike's side and the shared body drops to 1 Health in Kevin's fight, where the *other* copy of Echohorn
Rallies and finishes it. Both screens: "LINK x14". Nobody planned it in words. They planned it in slots and loot.

---

## 2. Pillars (fun first)

1. **It is still ASCENT, in ASCENT's words.** Every loot entry is data on an existing trigger, keyword or mechanic, or
   one of a short, named list of new co-op primitives (22.3). Every card names the real keyword it uses. The landing
   FX of every cross effect is the ASCENT FX players already know.
2. **Every turn has a loot moment that rewires the pair.** No turn ends without a pick. No entry is a small stat bump.
3. **Two boards, one machine.** The best loot connects a trigger on one board to a payoff on the other. The Twin rule
   makes that a plan, not a dice roll. The Shared Slot makes one card literally part of both boards.
4. **If it touches your partner, both of you see it.** Source, travel, landing, chip, live text. Always (section 17).
5. **The boss is the show, and the boss reads your loot.** Each boss breaks one rule loudly, presses on the recruit
   phase with a curse that only teamwork routes around, and has a weakness only the loot engine can hit.
6. **Every turn ends in a fight.** No service nodes. The map changes the fight and the loot, never skips them.
7. **Brakes only where the game would break.** Kept: printed fire caps on loop-prone Links, the Ping-pong guard, the
   7-slot board, 10-card hand, the Link limit with Melt, the phase gate, and a visible Wrath step. Cut: damage caps,
   wasted overkill, currencies, budgets, Roles.
8. **You build your hero.** No hero power at the start; you find up to three. Plus one starter Link. No Roles.
9. **Falling never benches you.** A Ghost still shops, still takes loot, still fights, and can be Charged back.
10. **Snappy at all times.** 160 fps on the prod build. One Pixi arena on screen. Bolts are pooled sprites on
    transform and opacity. The partner lane is memoized DOM.

---

## 3. Core loop: one ASCENT turn per step

### 3.1 One turn, beat by beat

| Beat | What happens | Who | Seconds |
|---|---|---|---|
| **Start of Turn** | Gold refills (3, +1 a turn, cap 10). Whispers, Equipment rebuild, Start of Turn triggers, queued Discovers and forges, all as in ASCENT. The boss intent (or door twist) for this fight appears on the ribbon with exact numbers. The Shared Slot's pick pill flips to this turn's picker. | each | 0 |
| **The Haul arrives** | Four loot cards slide into the Haul row above the Shop (7.3). Not a modal. You can shop at once. | each, one card shared | 0 |
| **Shop + pick** | Normal ASCENT shopping. Take one Haul card at any moment. It resolves at once, so it shapes this turn's Shop. | each, live | the standard clock (18 to 75 s) |
| **Channel** | Hand Off cards, ally-scope casts, Shared Slot swaps, pings on the Handshake. Shop-phase cross effects fire live, with bolts on both screens. | both | inside the Shop |
| **Lock** | End Turn locks, as in Versus (`faceOmen { deferFight: true }`). The first lock also locks the Shared Slot. End of Turn triggers fire, including cross End of Turn effects. | each | 0 |
| **Tandem fight** | Both fronts fight on one step clock on the server (10.3). Links cross. A finished winner Charges. | server, both screens | 15 to 45 |
| **Settle** | Damage, boss bars, Momentum, carry-backs (the Shared minion takes its gains from both fronts). A 2 s **recap** shows on both screens: "Kevin gave Mike +41/+33 and 2 Rise. Mike gave Kevin 3 Ward and 18 damage." | both | 2 |

### 3.2 What the pair does every turn

- **Reads the fight.** One intent, exact numbers, aimed at a front, a slot, a Link or the Shared Slot.
- **Reads the Haul.** Yours (your board), Pull (your partner's board, turned into your loot), the **Handshake** (the
  same card for both), Wild (a rarity step up).
- **Talks about one card.** "Handshake?" on the shared card. That is the per-turn conversation, and it is short.
- **Settles the Shared Slot.** One of you has the pick this turn. "Put Drakko in, I am playing four Shouts."
- **Arranges Twins.** Board order now matters across boards. The Twin guides at Start of Combat show the pairs.
- **Shops to the loot.** A pair that just took Echo Chamber starts buying Echo minions. That is the point.
- **Watches the machine run.** Two fights at once, bolts across the gap, a Charge when one side finishes early.

### 3.3 Why this suits two players

- ASCENT's Shop is private and simultaneous, so two people shop with zero waiting (Versus proves it).
- Auto-combat frees attention to watch the partner lane and the bolts between.
- The private row keeps solo agency. The Handshake gives one decision worth talking about, every turn, without letting
  the louder player steer both picks. The Shared Slot pick alternates, so neither player owns it.
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
20s), so every boss can be anchored to real wave-N boards (17.1). Tier 7 opens for the finale only (the Summit
precedent): the release valve for absurd power.

### 4.2 The map: two doors per step

No lane map. Each step shows **two doors** (three on the step after a boss phase). Both players tap a door (8 s).
Agreement goes at once. **A split vote alternates**: the first split of the run goes to the host, the next to the
guest, and so on. A pill on the door panel shows whose split is next.

The act boss portrait sits at the top of the door panel from turn 1, with its exam line. The panel reuses the Menu
backdrop and the card-frame pills for doors (no code-drawn paths).

### 4.3 Door types (every door is a fight plus a twist)

| Door | The fight | The loot twist | Reuses |
|---|---|---|---|
| **Brawl** | Two authored packs, one per front. | Normal Haul next turn. | authored boards (`AuthoredOmen` pattern with real cards) |
| **Juggernaut** (elite) | One elite split across both fronts, one shared bar, one turn (13.12). | **Pick 2** from the next Haul. | boss bar |
| **Forge Fight** | An easy Brawl. | Then a normal ASCENT Runeforge visit: Basic in Act 1, Epic in Act 2, a bonus Epic in Act 3. | Runeforge verbatim |
| **Rift Fight** | A Brawl under a rift-style rule on all four sides ("All minions have Flurry this fight."). | Next Haul is **all one keyword**, the rift's (Flurry rift: Rally loot). | `RIFTS`-style combat flags |
| **Vault** | A Vault Guardian per front: a big Health pool, no Attack, a timer of 12 steps. | Damage dealt scales the next Haul: under 50% a normal row, 50%+ a row of 6 with pick 2, 100% a row of 6 with pick 2 and the Wild at Legendary. | authored board |
| **Campfire** | A light Brawl. | After the fight each player picks one: **Rest** (heal 12), **Gild** a board minion (the Shared minion included), **Engrave** a minion (gains Engraved), or **Revive** a Ghost partner. | Gild, Engraved |
| **Mystery** | A random door from above, shown after the vote. | +1 rarity step on one slot of the next Haul. | |

**Anchors per act:** turn 1 is a Brawl. One Forge Fight in turns 3 to 5 in Acts 1 and 2 (so every player gets
ASCENT's Basic and Epic forge). One Campfire on the step before the boss. At least one Juggernaut door per act. The
First Road (19.2) fixes Act 1's doors on a pair's first run.

### 4.4 Boss turns

A boss is several turns. Each is a full ASCENT turn: Shop, Haul, lock, Tandem fight. A phase has a bar. Won fronts
damage the bar. A broken bar ends the phase; the next phase starts next turn, so **every phase gets a Shop and its
signature always fires in its first turn**. No damage caps. Overkill becomes Momentum (10.6).

### 4.5 Pacing model

| Part | Avg Shop | Avg Tandem fight | Overhead (Haul reveal, door vote, settle) | Per turn | Turns | Minutes |
|---|---|---|---|---|---|---|
| Act 1 | 30 s | 18 s | 10 s | ~58 s | 8 + boss | ~12 |
| Act 2 | 50 s | 28 s | 12 s | ~90 s | 8 + boss | ~16 |
| Act 3 | 60 s | 32 s | 12 s | ~104 s | 7 + boss | ~16 |
| Finale | 60 s | 40 s | 15 s | ~115 s | 4 to 5 | ~8 |
| **Run** | | | | | **~28** | **~52** |

**Valves.** Both locked ends the turn. Brawls play at 1.4x. A Charge leg against one enemy minion skips to its result.
The Haul never adds a modal: it lives inside the Shop clock. The Shared Slot pick never adds a modal either.

---

## 5. Solo vs co-op split

| Moment | Solo or together | Why |
|---|---|---|
| Door vote | Together (8 s) | One short joint call. Splits alternate. |
| Shop | **Solo, with a live channel** | Your Gold, refreshes, triples, tiers. You never click your partner's Shop. |
| Haul pick | **Solo row, one shared card** | Three private slots only you see. The Handshake is the same card in both rows, and both chips show on it live. |
| Shared Slot | **One picker a turn, alternating** | The picker decides. The other may fill it while empty, offer a swap, or take back their own card (9.3). |
| Board order | Solo, but read together | Twins make your order matter to your partner. Twin guides show at Start of Combat. |
| Hand Off, ally-scope casts, pings | Together | The narrow channel. |
| Lock | Solo | The first lock also locks the Shared Slot. Lock order matters to Vel. |
| Tandem fight | **Fought apart, watched together** | Each board fights its own front; Links and the Shared minion tie the fronts. |
| Charge, Fusion | Together | One shared board moment on both screens. |
| Campfire | Solo, except Revive | |
| Runes, Discovers | Solo, private until picked | As in ASCENT. |

**Attention target:** about 60% own Shop and fight, 25% Haul, Shared Slot and channel, 15% shared moments.

**Anti-alpha rules (real ones).**
- Your private Haul slots are **hidden from your partner until you take one**. They cannot steer what they cannot see.
- No control of the partner's Shop, Haul row or own six slots, ever. There is no Twin Table.
- The Shared Slot's pick **alternates every turn**. On your partner's pick turn, your only levers are an offer and
  taking back your own card. Neither player can farm it.
- One clock for both. Coaching costs your own Shop time.
- The Handshake is the only shared Haul card, and it only matters if **both** choose it. A lone pick still works.
- Bosses read both boards (Vel, the Tithe), so a passenger board loses fights the pair needs.

---

## 6. Identity: heroes and the starter Link

### 6.1 A portrait, and no hero power

- **A hero is a cosmetic portrait.** Portrait Select reuses Versus's Hero Select screen (20 s, any portrait you own),
  without power or Armor lines. **Everyone starts with no hero power** and the same numbers.
- **You build the hero during the run** (15): up to 3 hero powers, found from drops, the Haul (the turn 3 Wild is always
  one) and the Campfire, levelled I to III and swapped with Melt.
- **Ally scope on hero powers.** Any power that targets "a friendly minion" may target a minion on your partner's ally
  strip instead, for +1 Gold. The **Shared minion is friendly to both of you**, so it costs no extra. One generic
  primitive, not per-power code. The targeting arrow crosses onto the ally strip, and the effect plays on the partner's
  real card with a chip (17.4).
- No Hero Link text, no Roles, no companions. Identity comes from the powers you find plus one starter Link.

### 6.2 The starter Link

Turn 1's Haul row is special: **six starter Links**, one per starter keyword, each wearing its keyword pill. You take
one. It does three things:

| Starter keyword | Starter Link (7.8) |
|---|---|
| **Shout** | Chorus Line |
| **Echo** | Echo Chamber |
| **Taunt** | Lend a Shield |
| **Start of Combat** | Opening Volley |
| **Gold** | Joint Account |
| **Shop spells** | Spill Over |

- You get that Link at **level I**.
- Your **Yours** slot draws loot with that keyword pill 50% of the time all run.
- That keyword's **Harmony** needs one fewer pair level to wake (7.6).

You are now "the Echo player", and your partner knows what that means for the Handshake. Two players may pick the same
starter keyword: its Harmony then wakes very fast, at the cost of breadth.

### 6.3 Tribes and the pool

The pinned set's five tribes plus neutrals, as in any ASCENT run, and **one shared pool with doubled copies** (two
players draw from it). Overlap is good: two Beast boards can Hand Off Wolvies to triple, or triple through the Shared
Slot (9.6). **Link minions** (16.2), about 2 per tier, join the pool as mode-only cards, so co-op content also shows up
through ASCENT's own Shop.

### 6.4 Starting kit

**40 Health**, **10 Armor**, 3 Gold, **no hero power**, the starter Link pick, an empty Shared Slot, and the first
fight. No starter spells: the first Haul is the starter kit.

---
## 7. THE HAUL: the per-turn loot system

This is the centre of the mode. Every turn, in the Shop, with loot built to change how two boards play together.

### 7.1 The Twin rule (the one anchor)

**Your slot N and your partner's slot N are Twins.** Slots count left to right, 1 to 7, on the board as it stands
(in combat: as it stands at that step). If your partner's slot N is empty, the effect lands on their nearest minion to
the left, then to the right. The bolt always shows where it went. **Slot 7 is the Shared Slot (9): the Shared minion is
its own Twin**, so a cross effect from your slot 7 lands on the Shared minion's copy in your partner's fight.

Every automatic loot effect lands in exactly one of three places, and the card says which:

| Target word | Meaning | Example |
|---|---|---|
| **"its Twin"** / **"your Twin"** | the partner minion in the same slot as the source (or the target of your spell or Shout) | "When your minion dies, its Twin gains its Attack." |
| **"your partner's board"** / **"front"** | every partner minion, or an enemy on their front (normal ASCENT attack targeting: Taunt first, then random) | "Deal 8 damage to an enemy on your partner's front." |
| **"your partner"** | their hero: Gold, hand, Armor, Discovers, tier costs | "Your partner gains 1 Gold." |

There is no "left-most", "random friendly" or "left-most without Ward" on cross effects. A player-chosen target (a
spell, a hero power, Golden Gift) uses the targeting arrow and may pick any partner minion. ASCENT's own left-most and
right-most rules still apply on a board (Echohorn, Rune of Rallying, Market Tormentor read as printed).

**Why it matters.** A pair can plan: "My Ferry drops my dead into your slots. Keep slot 5 empty for it." "Your Tag In
makes my slot 1 attack. Put Karwind in slot 1." And the visibility law is easier to keep: every bolt goes straight
across, slot to slot, and the Twin guides (17.1) show those lines before the fight.

**Shop slots have Twins too.** Your Shop slot N and your partner's Shop slot N are Shop Twins (Market Share, 7.8 #36).

### 7.2 What loot is: four kinds

The kind is printed on the card's top pill (the existing card-frame pill). Its **keyword pill** (one, sometimes two)
sits where a minion's tribe pill sits, in that keyword's existing ASCENT colour.

| Kind | What it is | Lasts | Lives in | Built on |
|---|---|---|---|---|
| **Link** | A rule that wires a trigger on your board to a payoff on your partner's (or both ways). Levels I, II, III. | run | your **rune row**, after your runes (the rune-row component) | an effect subscription with an ally scope (22.3 D) |
| **Graft** | Attaches to one minion you choose. Its text joins the minion's text. One per minion. A Gilded copy keeps it. | while the minion lives | the minion | a granted effect on the instance |
| **Burst** | A one-shot. Resolves at once in the Shop, or banks for the next fight as a pill above your hero, exactly like a next-combat spell. | one turn | a banked cast pill | Shop spells, next-combat spells |
| **Card** | A mode-only minion or spell, straight to your hand (16.3). | until used | your hand | `CardDef` data |

**Levels.** Taking a Link you already own raises it one level (I to II to III). Levels print in the frame and live
text shows the current level's numbers. A level III Link offered again becomes its **Mythic echo**: the Haul swaps it
for a Mythic with the same keyword pill. Duplicates always do something (the ASCENT rune rule).

**Direction.** Every Link prints its direction as two portrait chips and an arrow: "Kevin to Mike", or "Both ways"
when it is a Twin Link. A Link fires only from its owner's board unless it is a Twin Link.

### 7.3 Cadence: the Haul row

- **When.** Every turn, at Start of Turn, after Gold refills and before any modal. Boss turns included. Turn 1 is the
  starter Link pick (6.2).
- **Where.** A row of 4 card frames above the Shop row, the Runeforge offer-row component shown inline. It slides in
  once (transform) and stays until you lock.
- **The four slots.**

  | Slot | Pill | Built from | Who sees it |
  |---|---|---|---|
  | 1 | **Yours** | your board, hand and Links (50% from your starter keyword). The turn after you lose your front it is a **Comeback** card instead (7.8). | you |
  | 2 | **Pull** | your **partner's** board: loot that turns their engine into your payoff, or yours into theirs. This is how a board is pulled toward its partner. | you |
  | 3 | **Handshake** | both boards: the pair's best joint fit. **The same card is in both rows.** | both, with live chips |
  | 4 | **Wild** | rarity +1 step; 50% ignores fit (a pivot or a dream); in a boss turn, the boss's themed list (13) | you |

- **Take one, free, any time in the Shop.** Click it. It resolves at once: a Link stamps into your rune row, a Card
  goes to hand, a Graft asks for a minion with the existing targeting arrow, a Burst resolves or banks. **Your partner
  sees what you took** the moment you take it (a stamp beat on your rune tile in their ally strip and a chip: "Kevin
  took Echo Chamber"). They never see the cards you passed.
- **The Handshake.** Both rows show it. Either player can ping it ("Handshake?"). If one of you takes it, it is a
  normal level I Link for that player. **If both take it in the same turn, it becomes a Twin Link: it enters at
  level II for both of you and fires both ways.** "Handshake!" plays on both screens with one chord. If the first
  taker already resolved it at level I, it upgrades in place.
- **"Both must take" cards.** A few Mythics say "Both must take." Each prints a plain alone-text in grey under the
  main text, so a lone pick is never wasted: "Alone: your first Start of Combat effect triggers twice."
- **Refresh (free once a turn, then 2 Gold).** Redraws your three private cards (Yours, Pull, Wild) from your boards
  **as they are right now**, the Shop's own verb. The first one fixes the lag between Start of Turn and what you just
  bought. The Handshake never refreshes. "Do I refresh my Shop or my Haul?" is a real ASCENT decision. Seeded by turn,
  seat and refresh count.
- **Skip.** Lock without taking a card and your next Haul has a 5th private card and its Wild is +1 step (max one
  bank). Shown as a "+1 card" pill on your Haul tab.
- **Pick 2** (Juggernaut win, a 100% Vault): take any two, the Handshake included.

### 7.4 How offers are generated from both boards

The server builds each Haul at Start of Turn with `fork(runSeed, 'haul', turn, seat, refresh)`. It is deterministic: a
replay shows the same Haul. Clients cannot fish for offers.

**Step 1. Tag profiles.** Every card, rune and loot entry carries tags, generated at build time from its effect
subscriptions and keywords (a small override file for edge cases). The tags are ASCENT's own keyword and mechanic
names:

| Tag group | Counted from |
|---|---|
| tribes | minions of each tribe (All-tribe counts for every tribe, as in runes) |
| triggers | Shout, Echo, Rally, Avenge, Rise, Rebirth, Start of Combat, End of Turn, Slaughter, Pummel, Overflow, Sell |
| keywords | Ward, Resilient Ward, Taunt, Flurry, Cleave, Execute, Stealth, Engraved, Consume |
| spells | Shop spells and Rubies cast last turn, Whisper sources, Spell Power |
| gold | Gold spent last turn, max-Gold raisers, Gold-spent watchers |
| shop | Starform present, Shop-buff minions |
| gild | Gilded minions, pairs (2 copies) and near-triples |
| always-on | minions whose text changes other effects (Drakko, Sylus, Chronos, Elderhorn, Karwind, King Oona, Delvey, Edward Keg-hands, Yazzus) and Aura sources. Feeds Both boards loot (8). |

A **board profile** is the tag count across the 7 board minions (Gilded counts twice; the Shared minion counts for
both boards), plus 1 per hand minion, plus 1 per Link level with that tag.

**Step 2. Each entry declares an anchor.** A **from** tag (the trigger it listens to) on the owner's board and a
**to** tag (what it pays into) on the partner's board, with a weight. Score = `from(owner) x to(partner) x weight`.
Bursts and Grafts score against one board.

**Step 3. Slot rules.**

| Slot | Rule |
|---|---|
| Yours | Weighted draw from entries whose **from** is in your top 4 tags. 50% restricted to your starter keyword. |
| Pull | Weighted draw from entries whose **to** is in your partner's top 4 tags and whose **from** you have at least 1 of, or **Pivot** (25%): a from-tag you have 0 of but your partner has 3+ of. |
| Handshake | The highest joint score among entries that work in both directions. If both boards share a top tag, it prefers that keyword (Harmony bait). In a boss turn it is 50% the boss's themed card. |
| Wild | Any entry one rarity step up. In a boss turn, 100% the boss's themed list. |

**Step 4. Guarantees.**
- **Fit floor:** at least one private card fits your board now.
- **Every row has a cross-board card** (the Handshake guarantees it).
- **No dead offers:** an entry whose from-tag is 0 on its owner's board is offered only as a Pivot.
- **No duplicates in one row.** An entry you own at level III is offered as its Mythic echo instead.
- **Anti-repeat:** an entry passed twice in a row is benched for 3 turns.
- **Turn 2** (thin boards) scores from the starter keyword and hero only.
- **Shared Slot nudge:** while the Shared Slot is empty from turn 4 on, one private slot a turn may offer a Shared
  Slot entry (9.8).

### 7.5 Rarity and escalation

Five rarities, shown by the existing frame gem colours. One rarity sting per card on reveal (one-shot sound).

| Rarity | Feel | Act 1 | Act 2 | Act 3 | Finale |
|---|---|---|---|---|---|
| **Basic** | a wire | 55% | 20% | 0 | 0 |
| **Rare** | a trigger crosses the gap | 35% | 40% | 30% | 0 |
| **Epic** | a tribe or keyword plays across both boards | 10% | 32% | 42% | 45% |
| **Legendary** | build-defining, "did that just happen" most fights | 0 | 8% | 24% | 45% |
| **Mythic** | rule-breaking. Boss Hauls, Act 3 Wild, Mythic echoes. | 0 | 0 | 4% | 10% |

**Steps** (each moves one slot one row up; at most +2 steps per slot per turn):
- **Victor's pick:** you won your front: next turn your Yours slot is +1 step.
- **Double Win:** both fronts won: next turn the Handshake is +1 step.
- **Comeback:** you lost your front: next turn your Yours slot is a **Comeback** card (a Burst, +1 step; 7.8 C1 to C4).
- **Momentum:** each 10 overkill past a boss bar gives one step on one slot for both players (max 2; 10.6).
- **Pity:** no Epic or better taken by you in 4 turns: your Wild is Epic.
- **Boss Hauls.** After a boss phase breaks, the next Haul has every slot Epic or better. After the act boss dies, a
  **Boss Haul**: every slot Legendary or better, and the Handshake is a Mythic.

**What escalates across acts (what loot does, not only rarity).**
- **Act 1: stats and keywords cross.** Start of Combat grants, Shop-phase Shout and spell sharing, Gold links, the
  first Both boards Bursts, the Shared Slot's first tenant.
- **Act 2: triggers cross live fights.** Echo Chamber, Tag In, Ferry, Shared Grave. Grafts become common. Shared Slot
  entries appear.
- **Act 3: systems merge.** Shared triples, merged counters, shared multipliers, Joined at the Hip, FUSION.
- **Basic and Rare numbers grow by act**, printed live: a Basic taken in Act 1 shows double numbers from Act 2 on. An
  early pick is never dead weight. Level it or Melt it.

### 7.6 Harmony (the combo layer, named by keyword)

Every loot entry wears one or two real keyword pills. **Harmony** counts the **pair's total Link levels** per keyword
(a level III Link counts 3; a Link with two pills counts for both). At 4, 8 and 12 levels the pair wakes that keyword's
Harmony I, II and III. The owner of the matching starter Link needs one fewer for step I. Rise Harmony counts Rise and
Rebirth Links; Ward Harmony counts Ward and Resilient Ward Links; Spell Harmony counts Shop spell, Ruby and Whisper
Links. Bursts, Grafts and Cards do not count (they do not last).

| Harmony | I (4 levels) | II (8) | III (12) |
|---|---|---|---|
| **Shout Harmony** | "Shouts on both boards that give stats give +1/+1 more." | "When you play a Shout minion whose Twin has a Shout, its Twin's Shout triggers too. Once a turn each." | "Every Shout on either board also triggers on its Twin." |
| **Echo Harmony** | "Echo minions on both boards have +2/+2 in combat." | "Echoes on both boards trigger an extra time, once per minion each combat." | "The first Echo on each front each combat also triggers on the other front." |
| **Rise Harmony** | "Rise minions on both boards return with +3/+3." | "The first minion to Rise on each front gains Ward." | "The first friendly minion to die on each front each combat has Rebirth." |
| **Avenge Harmony** | "Avenge on both boards needs 1 fewer death." | "The first Avenge on each front each combat triggers twice." | "Avenge on both boards counts deaths on both fronts." |
| **Taunt Harmony** | "Taunt minions on both boards have +0/+4." | "Taunt minions on both boards have +0/+8." | "When a Taunt minion dies, its Twin gains Taunt and its Health this combat." |
| **Ward Harmony** | "Start of Combat: both slot 1 minions gain Ward." | "When a Ward breaks, its Twin gains +3 Attack this combat." | "When a minion loses its Ward, its Twin gains Ward. Once per minion each combat." |
| **Rally Harmony** | "The first attack on each front each combat deals double damage." | "Rallies on both boards trigger once more, once per minion each combat." | "Rally minions on both boards have Flurry." |
| **Start of Combat Harmony** | "Start of Combat: both slot 1 minions gain +4/+4." | "The first Start of Combat effect on each front triggers twice." | "Start of Combat effects on both boards also resolve on the other front." |
| **Gold Harmony** | "You both gain 1 Gold at Start of Turn." | "Your first Shop Refresh each turn is free, for both of you." | "Gold either of you spends counts as Gold spent for both of you." |
| **Gild Harmony** | "Gilded minions on both boards have +3/+3." | "Triple Rewards Discover from two tiers above, for both of you." | "You only need 2 copies to Gild, both of you." (Rune of Twin Gilding) |
| **Spell Harmony** | "You both have +1/+1 Spell Power." | "The first spell each of you casts each turn casts twice." | "Spells cast in combat also cast on the other front." |

The **Harmony gauge** sits between the two Health slots (the Resolve-slot style). It shows the pair's top 6 keywords
as their own keyword pills, each with the count and the number to the next step ("Echo 6/8"). When a step wakes, a
one-shot sweep in that keyword's colour crosses both boards and the Harmony card slides into both rune rows (it takes
no Link space). The text on the card is always "Echo Harmony II", never a colour or element.

### 7.7 How picks interact: Twin Links, Combos, Melt

- **Twin Links** (Handshake taken by both) are level II and fire from both boards. They are worth more than two lone
  copies by construction: a lone pick is level I and fires one way; a Twin Link is level II and fires both ways.
- **Same Link, two owners.** If you each own Echo Chamber from different turns, both fire. Legal and loud.
- **Combos.** Some pairs of Links, owned by **different players**, light a named **Combo**: a bonus line on both
  players' Links. The first time it fires in a run, a banner names it on both screens. Combos are what a pair hunts in
  Act 2.

  | Combo | One player owns | The other owns | Bonus |
  |---|---|---|---|
  | **Haunted House** | Ferry | Echo Chamber | Ferried minions keep their Echo, and it triggers on both fronts. |
  | **Shield Wall** | Bodyguard | Lend a Shield | The guarding minion arrives with Ward. |
  | **Choir** | Chorus Line | Call and Answer | Shouts triggered by Chorus Line count as Shouts played for Call and Answer. |
  | **Thunderclap** | Tag In | Thunder Pact | A Twin that attacks from Tag In gains +4 Attack first. |
  | **Bucket Brigade** | Joint Account | Tier Draft | Gold from Joint Account counts as Gold spent for the receiver's cards. |
  | **Gem Rain** | Gemlink | Spill Over | Rubies cast on a Twin count as Ruby casts for the Twin's owner. |
  | **Night Shift** | Graveyard Shift | Shared Grave | Echoes triggered at End of Turn count toward Avenge next fight. |
  | **Two-Way Street** | Return to Sender | Return to Sender | Also gives the dying minion's Health. |
  | **Open Table** | Battle Hymn | Open Door | A minion that works on both boards from Battle Hymn may enter the Shared Slot for free this turn. |

- **The Link limit and Melt.** You hold **6 Links in Act 1, 9 in Act 2, 12 in Act 3 and the finale**, in the rune row
  after your runes. A level-up takes no space. When you are full, taking a new Link asks you to **Melt** one: the
  melted Link is gone and the new one **enters one level higher**. Melting is the thinning tool and it never feels
  like a loss. Runes keep their own count as in ASCENT. Grafts live on minions. Bursts are gone after use. So the Act 3
  screen holds one rune row of runes plus at most 12 Links, and pills on minions. That is the clutter ceiling.
- **The Ping-pong guard.** A cross effect may start another cross effect, but **no Link fires twice in the same step
  from the same source**, and **a chain stops after 3 crossings in one step**. Loop-prone Links also print their own
  caps ("Up to 5 times each combat"). The Tandem engine has a hard backstop of 200 crossings per fight that no legal
  build reaches. This is the only brake on combos.


### 7.8 The catalogue: 57 entries plus 4 Comeback cards (plus 12 Both boards in 8 and 6 Shared Slot in 9)

Format: **Name** (kind, rarity, keyword pill). Text at level I, then the level II and III changes. **Built on** names
the ASCENT mechanic. **Shown as** is the cross-board presentation, using these codes (full spec in 17):

- **BOLT**: a combat crossing. Source flash, a pooled bolt in the keyword's colour flies slot to slot, the target gets
  its normal ASCENT beat, name chip on both screens.
- **SHOP**: a Shop-phase crossing. Bolt from the source card to the ally strip tile on your screen; on your partner's
  screen it enters from their ally strip and lands on the real card.
- **CROSS**: a whole minion moves between fronts (card lifts, slides to the gap, fades through, summon beat).
- **SOC**: a cross Start of Combat cast, shown as a banked cast with the owner's name before the first attack.
- **COIN**: a coin hops between Gold pills or onto a button.
- **STAMP**: a permanent change: one-shot gold stamp on the card plus a line in its live text.
- **BOTH**: a source starts working on both boards (8.3).
- **TEXT**: live value on both boards (always present in addition to the above).

**Starters** (the turn 1 pick, 6.2): Shout *Chorus Line*, Echo *Echo Chamber*, Taunt *Lend a Shield*, Start of Combat
*Opening Volley*, Gold *Joint Account*, Shop spells *Spill Over*.

#### Shout

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 1 | **Chorus Line** (Link, Basic, Shout, starter) | "The first Shout you play each turn also triggers its Twin's Shout." II: first 2 Shouts. III: every Shout, once per Twin each turn. | Auctioneer's Pulse (trigger a Shout), aimed at the Twin | SHOP. Your Shout plays, a bolt crosses, the Twin's own Shout beat plays on your partner's board with "via Kevin". |
| 2 | **Call and Answer** (Link, Rare, Shout) | "When your partner plays a Shout minion, your next Shout this turn triggers twice." II: next 2. III: the rest of the turn. | trigger multiplier (`battlecry`, `factor`), turn scope | A Shout-coloured spark leaves Mike's played card and lands on Kevin's hand; Shout cards there show "x2 (Mike)" until used. |
| 3 | **Two Throats** (Link, Epic, Shout) | "Your Shout multipliers also apply to your partner's Shouts." II: and theirs to yours. III: +1 extra trigger on Shouts whose Twin is the same tribe. | `TriggerMultiplierDef` read across boards (Drakko, Orivax, Zyff) | A static Shout-coloured tether from Drakko to the ally strip while active; each multiplied Shout on Mike's board reads "x2 (Kevin's Drakko)". |
| 4 | **Echo of a Voice** (Graft, Rare, Shout / Echo) | "Graft. Echo: trigger its Twin's Shout." II (Handshake): "and this minion's own Shout." | Echo, Shout re-trigger in combat | BOLT from the dying minion; the Twin's Shout beat plays in the partner's fight. |
| 5 | **War Herald** (Link, Epic, Shout / Start of Combat) | "Start of Combat: trigger the Shout of your slot 1 minion on its Twin." II: slots 1 and 2. III: slots 1 to 3. | Shout re-trigger via the banked Start of Combat path | SOC beat on Kevin's front, BOLT to the Twin, the Shout FX on Mike's minion. |
| 6 | **Dragonsong** (Link, Rare, Shout) | "When a Shout gives your Dragon stats, its Twin gains the same if it is a Dragon." II: any tribe. III: twice. | Dragon Shout payoffs (Karwind) | SHOP or BOLT, the buff beat on the Twin. |
| 7 | **Megaphone** (Card spell, 1 Gold, Basic, Shout) | "Trigger a minion's Shout. It may be your partner's minion." | Pulse as a spell, ally scope | The targeting arrow crosses onto the ally strip; the Shout plays on the real card on Mike's screen. |

#### Echo

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 8 | **Echo Chamber** (Link, Basic, Echo, starter) | "When your minion's Echo triggers, its Twin's Echo triggers too. Up to 3 times each combat." II: up to 5. III: up to 7, and the Twin's Echo summons with +2/+2. | Echo re-trigger (Echohorn, Spots) aimed at the Twin | BOLT from the dying minion; the Twin's Echo pill flashes and its Echo beat plays. |
| 9 | **Graveyard Shift** (Link, Epic, Echo / End of Turn) | "End of Turn: trigger the Echo of your slot 1 minion and of its Twin." II: slots 1 and 2. III: 1 to 3. | Rune of the Reliquary (End of Turn Echo trigger) | SHOP at lock: two Echo beats, one per board, bolt between. |

#### Rise and Rebirth

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 10 | **Borrowed Breath** (Link, Rare, Rise) | "When your minion Rises, its Twin gains Rise this combat." II: and +3/+3. III: Rebirth instead of Rise. | Rise and Rebirth keyword grant mid-fight | BOLT; the Rise pill pops onto the Twin with "from Kevin". |
| 11 | **The Long Goodbye** (Graft, Epic, Rebirth) | "Graft. When this Rebirths, its Twin gains Rebirth." | Rebirth | BOLT, the Rebirth pill on the Twin. |
| 12 | **Last Rites** (Burst, Rare, Rise / Echo) | "Your 2 left-most Echo minions and their Twins gain Rise permanently." | Rise grant, permanent (recruit) | STAMP: four Rise pills pop in turn, alternating boards. |
| 13 | **Undertakers** (Link, Rare, Rise) | "Your Rise minions return with +3/+3 for each Rise minion on your partner's board. (Now +6/+6.)" II: +4/+4 each. III: and with Ward. | Rise, live scaler reading the partner board | TEXT on both boards; Mike's Rise minions show "Feeds Kevin's Undertakers". |

#### Avenge, deaths and Overflow

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 14 | **Ferry** (Link, Legendary, Avenge) | "The first 2 of your minions to die each combat are summoned at their Twin slots on your partner's front with 1 Health. They leave after the fight." II: first 3. III: with full Health. | combat-only summon (the R-RISE-06 combat-copy rule), Twin slot | CROSS. The dead card lifts as a translucent copy, slides into the gap, drops into the partner's slot with the summon beat and an owner pip. Full board: Overflow fires there, chip "No room on Mike's front". |
| 15 | **Return to Sender** (Link, Epic, Avenge) | "When your minion dies, its Twin gains its Attack this combat." II: and its Health. III: and its keywords. | friendly death event, combat-only buff | BOLT carrying the number ("+9"); buff beat on the Twin. |
| 16 | **Shared Grave** (Link, Epic, Avenge) | "Your Avenge counts deaths on your partner's front too." II: and their Avenge counts yours. III: each death counts twice. | Avenge counter read across fronts | A small wisp per death into the Avenge minion; its counter reads "Avenge (3): 1 left (2 from Mike)". |
| 17 | **The Other Side** (Link, Epic, Overflow) | "When a summon on your front has no room, it is summoned at its Twin slot on your partner's front." II: with +3/+3. III: and Overflow triggers fire on both fronts. | Overflow redirected cross-front | CROSS-lite: the summon silhouette slides across and lands; Overflow beat on both. |

#### Taunt and Ward

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 18 | **Lend a Shield** (Link, Basic, Taunt / Ward, starter) | "Start of Combat: each of your Taunt minions gives its Twin Ward." II: and Taunt. III: Resilient Ward instead. | Ward grant on the banked Start of Combat path | SOC: a Ward-coloured shield flies slot to slot; the Ward FX on the Twin. |
| 19 | **Bodyguard** (Burst, Epic, Taunt) | "Next combat: your slot 1 Taunt guards its Twin. The first 3 attacks aimed at its Twin hit it instead." Twin Link (Handshake): 5 attacks, and slot 2 too. | Taunt, attack redirect (NEW) | CROSS: a copy of the Taunt stands beside the Twin in the partner's arena. Each redirect draws the enemy's lunge across the gap on both screens; damage lands on the real minion in the guard's fight. |
| 20 | **Iron Twins** (Link, Epic, Taunt) | "When your Taunt minion and its Twin both have Taunt, damage to either is split evenly between them." II: and both have +0/+6. III: and both have Ward at Start of Combat. | cross-front damage split (NEW `sharedBody` lite) | A static tether between the two for the fight; each hit shows the split number on both. |
| 21 | **Shoulder to Shoulder** (Link, Rare, Taunt) | "Your Taunt minions' Twins have Taunt. When your Taunt dies, its Twin gains its Health this combat." II: and Attack. III: and Ward. | Taunt grant across fronts, death buff | Tether line at Start of Combat (opacity in), a BOLT on death. |
| 22 | **Engrave the Pair** (Burst, Epic, Engraved) | "Your slot 1 minion and its Twin gain Engraved." | Engraved keyword | STAMP: the etch FX on both cards. |
| 23 | **Armor Share** (Link, Rare, Armor) | "When you gain Armor, your partner gains the same." II: and their board gains +0/+1 per 2 Armor. III: both ways. | hero Armor (Rayse, Summit) | The Armor number floats from Kevin's portrait to Mike's. |
| 24 | **Aegis Lattice** (Link, Mythic, Resilient Ward) | "Every Ward on both boards is a Resilient Ward." | Resilient Ward | SOC: a one-shot lattice sweeps both arenas; each Ward gains its second ring. |

#### Rally

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 25 | **Tag In** (Link, Legendary, Rally) | "Rally: its Twin attacks immediately on its own front. Once per minion each combat." II: twice. III: and the Twin gains +3 Attack first. | Rally, "attacks immediately" (R-ORD-05), cross | BOLT, then the Twin lunges at once. "Kevin's Tag In: Mike's Karwind attacks." |
| 26 | **Thunder Pact** (Link, Epic, Rally) | "Your Rallies also trigger its Twin's Rally." II: and the Twin gains +2/+2 first. III: twice. | Rally re-trigger (Rune of Rallying), cross | BOLT, then the Twin's Rally beat. |
| 27 | **Mirror Strike** (Link, Legendary, Rally) | "When your slot 1 minion attacks, its Twin attacks too." II: slots 1 and 2. III: slots 1 to 3. | cross "attacks immediately" | A ring pip on each linked pair; when one lunges the other lunges on the next step with a short BOLT between. |
| 28 | **Crossfire** (Graft, Epic, Rally) | "Graft. Rally: deal damage equal to this minion's Attack to an enemy on your partner's front." | Rally, cross damage (NEW) | Projectile leaves through the gap on your screen and hits on theirs with the existing hit beat. "Kevin's Raptor: 14." |

#### Slaughter and Pummel

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 29 | **Slaughterhouse** (Link, Rare, Slaughter) | "When your minion kills an enemy, its Twin gains +2/+2 permanently. Up to 4 times each combat." II: +3/+3. III: and it triggers the Twin's Slaughter. | Slaughter, permanent gain (combat carry-back) | BOLT plus STAMP ("From Kevin: +6/+6 this run"). |
| 30 | **Shared Pummel** (Link, Rare, Pummel) | "Damage your Twins deal also fills your Pummel meters." II: both ways. III: both meters fill double. | Pummel (X), the lifetime damage meter | Damage on Mike's front sends a small arc into Kevin's meter; chip on the first tick each fight only. |
| 31 | **Overkill Express** (Link, Epic, Slaughter) | "When your minion kills an enemy with damage to spare, the extra hits an enemy on your partner's front." II: the extra is doubled. III: and the Twin gains it as Attack. | excess damage on a kill, cross damage | The extra number ("+11") flies through the gap and lands as a hit. |

#### Start of Combat

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 32 | **Opening Volley** (Link, Basic, Start of Combat, starter) | "Start of Combat: the Twin of your slot 1 minion attacks immediately." II: and gains +3 Attack first. III: slots 1 and 2. | "attacks immediately" (Rune of Forthcoming wording), cross | SOC, then the partner's minion lunges first with the chip "Kevin's Opening Volley". |
| 33 | **Storm Bridge** (Link, Epic, Start of Combat) | "Start of Combat: your Flurry and Cleave minions give their Twins Flurry and Cleave this combat." II: and Execute from Execute minions. III: and the Twins are Immune while attacking for their first attack. | keyword grants | SOC: keyword pills fly slot to slot. |

#### Gold

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 34 | **Joint Account** (Link, Basic, Gold, starter) | "When you spend 4 Gold, your partner gains 1 Gold. Up to 3 a turn." II: every 3. III: up to 4, and it counts as Gold spent for them. | Gold-spent watcher (Coinfire, Paymaster Pimm) | COIN from your Gold pill to the ally strip; on Mike's screen it lands in his pill with "+1 from Kevin". |
| 35 | **Tier Draft** (Link, Rare, Gold) | "When you tier up, your partner's next tier up costs 3 less." II: and they Discover a minion of their new tier when they do. III: both ways. | tier-up cost and discount | COIN arrow from Kevin's tier pip to Mike's upgrade button, which shows the new price "(Kevin)". |
| 36 | **Market Share** (Link, Epic, Gold) | "When a minion in your Shop gains stats, its Shop Twin in your partner's Shop gains the same. Up to 8 times a turn." II: both ways. III: and their Starform too. | Shop buffs (Contract Butcher, Market Tormentor) | Bolt to the ally strip's "Shop" chip on your screen; on Mike's screen it enters his Shop row at the same slot with the buff beat. |
| 37 | **Jackpot** (Burst, Rare, Gold) | "Your next Refresh, and your partner's next Refresh, show minions one tier above your shop tiers." Twin Link: next 2 each. | refresh pool rule (Tier 7 precedent) | SHOP: a one-shot gold rim on Mike's Refresh button and the chip "Kevin's Jackpot". |

#### Gild and triples

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 38 | **Golden Gift** (Burst, Legendary, Gild) | "Gild one of your partner's minions. You choose." | the Gild primitive (Indy, Auric Runemaster) | SHOP: a gold flare crosses; the Gild beat on Mike's real card. "Kevin Gilded your Grim." |
| 39 | **Triple Threat** (Link, Epic, Gild) | "When you make a triple, your partner Discovers a minion from one tier above their shop tier." II: both ways. III: two tiers above. | Triple Reward (Discover T+1) | Gold burst to Mike's portrait; his Discover opens with the header "Kevin's triple". |
| 40 | **Shared Triples** (Link, Mythic, Gild) | "Copies on both your boards and hands count together for triples. When one forms across both, each of you gets the Gilded copy." | triples, R-GILD-03 (board copies consumed first) | Copies slide from both boards to the centre, merge, and two Gilded cards fly to both hands. |

#### Shop spells, Rubies and Whispers

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 41 | **Spill Over** (Link, Basic, Shop spells, starter) | "Your targeted spells also cast on the target's Twin. Up to 3 a turn." II: up to 5. III: and Spell Power counts twice on the Twin. | targeted spell cast, Spell Power | SHOP: a second targeting line crosses to the Twin tile; the spell's own FX on Mike's real card. |
| 42 | **Gemlink** (Link, Rare, Rubies) | "Your Rubies also cast on the target's Twin. Kobold riders fire if the Twin is a Kobold." II: riders fire on any tribe. III: twice. | Rubies and their riders | SHOP in the Ruby's own colour. |
| 43 | **Power Grid** (Link, Epic, Shop spells) | "Your Spell Power is yours plus your partner's. (Now +3/+2.)" II: for both of you. | `spellPowerAtk/Hp` on the side state | TEXT on every spell in hand ("+3/+2, with Mike"); a line on the Harmony gauge. |
| 44 | **Twin Cast** (Link, Legendary, Shop spells) | "The first spell you cast from hand each turn casts again on its target's Twin." II: first 2. III: and they count as your partner's casts too. | cast multipliers from hand (Yazzus, Grimoire, R-MULT-06), cross target | The spell art flips across the screen and casts on Mike's minion. |
| 45 | **Spellstorm** (Link, Mythic, Shop spells) | "Spells cast in combat on either front also cast on the other front, on the Twin of their target." | in-combat casts (Dragonflame, Star Crash, Queen Morro) | The spell plays on one front, its art streaks across, it plays again on the other. |
| 46 | **Ale for Two** (Link, Rare, Shop spells) | "Dwarven Ales you cast on a minion also pour on its Twin." II: twice. III: and on your partner's Shop Twin too. | Dwarven Ales (Shop spells) | SHOP with the Ale's own colour. |
| 47 | **Whisper Network** (Link, Epic, Whispers) | "When you get a Whisper, your partner gets a copy." II: and its stats are permanent for them. III: two copies. | Whispers (Set 3 Dragons) | The existing Whisper grant beat in Mike's hand, card tagged "From Kevin". |

#### Starform (only in a Celestial set)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 48 | **Shared Sky** (Link, Epic, Starform) | "You share one Starform. Shop buffs from either of you feed it. Either of you can buy it." II: it costs 2 less. III: its Collapse also feeds your partner's Celestials. | the Starform pattern | The Starform sits pinned in both Shops; each feed shows a mote from the partner's side. |

#### Any keyword (Wild; Bursts and rule-benders)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| 49 | **Swap Meet** (Burst, Epic) | "Next combat: your slot 6 minion and its Twin swap fronts. Both gain +4/+4 permanently. They come home after." | cross move at Start of Combat (NEW `crossMove`) | CROSS: both leap into the gap at once and land in each other's arena; reverse at settle. |
| 50 | **Mirror Mirror** (Link, Epic) | "Start of Combat: summon a combat copy of your partner's highest-Attack minion on your front with half its stats." II: full stats. III: 2 copies. | Start of Combat summon, combat-only copy | A reflection of Mike's minion slides out of the ally lane into Kevin's arena. |
| 51 | **Kin of Two Kinds** (Link, Legendary) | "Your minions also count as your partner's two biggest tribes. (Now Beast and Dragon.)" Twin Link: for both of you. | tribe counting (All-tribe precedent) | STAMP: extra tribe pills on each of your minions; Mike's board shows "Kevin counts as yours". |
| 52 | **Field Promotion** (Burst, Rare) | "Your partner Discovers a minion from one tier above their shop tier. You get the two they did not pick." | Discover, Triple Reward tier rule | Mike's Discover opens with "Kevin's Field Promotion"; Kevin's hand receives the two with "Mike passed". |
| 53 | **Twilight Pact** (Link, Mythic, Start of Combat, Both must take) | "Both must take. Start of Combat effects on both boards trigger twice." Alone: "Your first Start of Combat effect each combat triggers twice." | Rune of Twilight (Start of Combat repeat) | STAMP on both rune rows; every Start of Combat cast in the fight shows "x2 Twilight Pact". |
| 54 | **Overdrive** (Burst, Mythic, Both must take) | "Both must take. Next combat both boards have double Attack. If you lose a front, it deals double damage to you." Alone: "Next combat your slot 1 minion has double Attack." | combat stat flag | SOC: a one-shot red flare over both arenas. |
| 55 | **FUSION** (Link, Mythic, Both must take) | "Both must take. Once per boss, either of you may press Fusion in the Shop. If both press, your Twins become one board at Start of Combat." Alone: "Once per boss: Start of Combat: your slot 1 minion gains its Twin's stats this combat." | the Fusion transform (10.5) | The Fusion sequence (17.6). |
| 56 | **Copycat** (Card minion 3/3, Rare, Shout) | "Shout: become a copy of its Twin, plus this card's 3/3." | copy (Xerox precedent), Twin target | SHOP: the Twin flashes on Mike's board; the copy unfolds on Kevin's with "Copy of Mike's Grim". |
| 57 | **Hivemind** (Link, Mythic, Avenge / Rally / Slaughter) | "Your two fronts count as one board for Avenge, Rally and Slaughter counts." | merged counters across fronts | Counters on both boards show the merged number with a two-chain icon. |

#### Comeback cards (only in your Yours slot, the turn after you lost your front)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| C1 | **Settle the Score** (Burst, Rare) | "Next combat: your minions have +1/+1 for each damage you took last fight. (Now +9/+9.)" | combat stat flag, live scaler | SOC with a red "Comeback" chip. |
| C2 | **Avenge Me** (Burst, Epic, Avenge) | "Next combat: when your first minion dies, your partner's board gains +4/+4." | friendly death trigger, cross buff | BOLT fanning to all partner tiles (one sprite per side, 17.3). |
| C3 | **Back for More** (Burst, Epic, Rebirth) | "Next combat: your 3 left-most minions have Rebirth." | Rebirth | SOC. |
| C4 | **Payback** (Burst, Legendary, Start of Combat) | "Next combat: Start of Combat: deal damage equal to the damage you took last fight, split among enemies on both fronts." | Start of Combat AoE | SOC AoE beat on Kevin's front, then a projectile spray crossing to Mike's front. |

**Coverage check.** Every starter keyword has a starter, a Rare, an Epic and a Legendary or Mythic. Every ASCENT
trigger and mechanic the owner named is a **Built on**, under its own name: Shout (1 to 7, 56), Echo (4, 8, 9, 12),
Rise and Rebirth (10 to 13, C3), Avenge (14 to 16, 57, C2), Overflow (17), Ward and Resilient Ward (18, 24), Taunt (18
to 21), Rally (25 to 28), Slaughter (29, 31), Pummel (30), Start of Combat (5, 32, 33, 53), End of Turn (9), Gold (34
to 37), Gild and triples (38 to 40), Engraved (22), Shop spells and Spell Power (41, 43 to 46), Rubies (42), Whispers
(47), Starform (48). Both boards (8) and the Shared Slot (9) add Aura, End of Turn, Gold-spent and Starform entries.
There are no flat "+1 Attack" entries: Basics are wires that grow by act and level.

### 7.9 Combos the system is built to produce

- **The Ferry (Echo + Rally + Avenge).** Kevin: Echo Beasts (Wolvie, Grim, Echohorn). Mike: Rally Beasts. *Ferry*
  drops Kevin's first dead at their Twin slots on Mike's front. The Shared Slot holds Echohorn, so it stands on both
  fronts: on Mike's front its Rally triggers the left-most Echo, which is the ferried Grim: +8/+8 to Mike's Beasts.
- **The Shout Cannon (Shout).** Drakko sits in the Shared Slot, so both boards Shout twice. *Chorus Line* fires
  Karwind's Twin's Shout on every play. "Whenever a Shout triggers, give your Dragons +4/+4" fires four times a play
  across two boards. *Shared Shout* on a played Orivax adds two more for one turn.
- **The Gold Engine (Gold + Rubies).** Mike's Dwarves spend; *Joint Account* feeds Kevin, and at level III counts as
  Gold spent; Coinfire in the Shared Slot hears both players' spending; Kevin's Kobolds cast Rubies; *Gemlink* fires
  them on Mike's Dwarves; *Shared Triples* turns two half-built boards into Gilds every turn.
- **The Wall and the Hammer (Taunt + Rally).** Kevin: Taunts in slots 1 and 2. *Shoulder to Shoulder* and
  *Bodyguard* guard Mike's slot 1 and 2 carries, while *Tag In* makes Kevin's Rally Taunts hand Mike's carries extra
  attacks.
- **The Hinge (Shared Slot + Rally).** *Hinge* in the Shared Slot Rallies on both fronts and buffs slot 6 on each
  (9.9). *Centrepiece* grows it with every Link level the pair owns. It is the pair's carry, and both Shops feed it.
- **The Star Pot (Starform + Gold, in a Celestial set).** *Shared Sky* plus Mike's Shop buffs and *Market Share*
  grow one Starform from both Shops. Kevin buys it on the boss turn.

---

## 8. NEW: Both boards (the "works on both boards for a turn" family)

Kevin's ask: "placing a card like Drakko to work on both boards for a turn". This family does exactly that, with one
plain rule that the Shared Slot (9) also uses.

### 8.1 The rule: "works on both boards"

A minion, spell or trigger that **works on both boards** does three things, and only these:

1. **Its own triggers resolve on both boards.** Its Shout, Echo, Rally, Start of Combat, End of Turn and Avenge resolve
   once on its own board and once on your partner's board, aimed as if it stood at its **Twin** slot there. A
   targeted Shout's second target is the Twin of the first. A spell lands on both boards: a targeted spell on its
   target's Twin.
2. **Its listening text hears both boards.** "Whenever a Shout triggers" (Karwind), "When you spend 5 Gold"
   (Coinfire), "When you summon a Beast in combat" (King Oona) hear events on either board, and act on **the board
   that woke it**. "Your" in its text means whichever of you it is acting for.
3. **Its always-on text covers both boards.** Drakko ("Your Shouts trigger twice"), Sylus, Chronos, Elderhorn, Orivax,
   Delvey, Edward Keg-hands, Yazzus, Queen Morro: both players get the effect. Multipliers combine exactly as ASCENT
   combines them today (`(1 + sum of extras) x product of factors`), so your partner's own Drakko and your Drakko
   working on both boards make their Shouts trigger four times, as two Drakkos on one board already do.

**Duration.** "Until your next fight ends": the rest of this Shop and the fight that ends it. A Both boards effect
started in combat lasts until that fight ends.

**Combat.** A minion that works on both boards is still one body on one front. Its own triggers resolve on its front,
then cross to your partner's front through the inbox and resolve there one step later, at its Twin slot (10.3). Its
always-on text applies to your partner's side for that fight (compiled into their side at lock, the same path as
Start of Combat crossings). With no Tandem yet (Phase 0a), the always-on part and the Shop part work; the crossing
part waits for Lead-and-Follow (23).

**After a lock.** If your partner has already locked, the Shop parts of a Both boards effect land on their board at
their Start of Combat as a combat-only banked cast ("Kevin's Closing Time: +4/+6"), never on a locked Shop.

**No double dipping.** A minion already working on both boards (the Shared minion, or a second Both boards card on
the same minion) gains nothing more. The pill just refreshes its duration.

### 8.2 The 12 entries

| # | Entry | Text | Built on | Example |
|---|---|---|---|---|
| B1 | **Shared Shout** (Burst, Rare, Shout) | "The next minion you play this turn works on both boards until your next fight ends." | the both-boards scope on one instance; trigger multipliers read across boards | Play Drakko: your partner's Shouts trigger twice this turn and next fight. Play Karwind: every Shout on either board gives that board's Dragons +4/+4. |
| B2 | **Open House** (Burst, Epic) | "Until your next fight ends, your 2 left-most minions work on both boards." | the same scope on two instances | Sylus and Elderhorn on the left: both boards' Echoes and Beast Rallies trigger an additional time. |
| B3 | **Battle Hymn** (Link, Legendary, Shout) | "The first minion you play each turn works on both boards until your next fight ends." II: first 2. III: first 3. | the scope as a run-long Link | Every turn becomes "which card do I play first?" |
| B4 | **Shared Banner** (Card spell, 2 Gold, Epic) | "Choose a minion. It works on both boards until your next fight ends. It may be your partner's minion." | ally scope plus the both-boards scope | Mike's Orivax already on his board now counts for Kevin's Shouts too. |
| B5 | **Rally for Two** (Burst, Rare, Rally) | "Next fight: your Rallies also trigger on your partner's front, as if the minion stood at its Twin slot." | Rally, resolved through the inbox | Kevin's Echohorn attacks: it triggers Kevin's left-most Echo, then Mike's left-most Echo one step later. |
| B6 | **Last Words for Two** (Burst, Rare, Echo) | "Next fight: your first 2 Echoes also trigger on your partner's front." | Echo, resolved through the inbox | Kevin's Grim dies: "Give all Friendly and summoned Beasts +8/+8" lands on Kevin's Beasts, then on Mike's. |
| B7 | **Opening Chord** (Burst, Rare, Start of Combat) | "Next fight: your minions' Start of Combat effects also resolve on your partner's front." | the banked Start of Combat path, cross | Kevin's Spots: "trigger your 2 left-most Echoes" also triggers Mike's 2 left-most Echoes. |
| B8 | **Double Dose** (Burst, Rare, Shop spells) | "The next spell you cast this turn also casts on your partner's board. A targeted spell lands on its target's Twin." | Shop spells, Rubies, Dwarven Ales, Whispers; ally scope | Kevin casts a Dwarven Ale on his slot 2: it pours on Mike's slot 2 too. An untargeted "give your Dwarves" spell gives both boards' Dwarves. |
| B9 | **Closing Time** (Burst, Epic, End of Turn) | "This turn, your End of Turn effects also resolve on your partner's board." | End of Turn, ally op on the team bus | Kevin's Kringle: "give your left and right-most Dwarves +1/+2. Repeat for every card you played" also buffs Mike's, with Kevin's count. |
| B10 | **Open Purse** (Burst, Rare, Gold) | "This turn, your Gold-spent minions also count the Gold your partner spends. They pay out on the board that spent it." | Gold-spent watchers (Coinfire, Paymaster Pimm) | Mike spends 5 Gold: Kevin's Coinfire gives Mike's Dwarves +2 Attack. |
| B11 | **Shared Aura** (Burst, Epic, Aura; Set 1 and Set 3) | "Until your next fight ends, your partner's Undead and Imps also gain your Undead Aura and Imp Aura." | Undead Aura, Imp Aura (R-AURA-02) on the partner's side state | Kevin's Undead Aura is +9/+6; Mike's Undead get it on top of their own for one fight. |
| B12 | **Starlit Shop** (Burst, Rare, Starform; Celestial set only) | "This turn, your Shop buffs also feed your partner's Starform." | the Starform pattern | Kevin's Contract Butcher Shout feeds both Starforms. |

### 8.3 Presentation (the BOTH code), entry by entry

Every Both boards effect follows the four parts of the visibility law (17), with one addition: a static
**"Both boards"** pill on the source while it is live, on both screens (on the real card for its owner, on the ally
strip tile for the partner). The pill pops in once (scale, opacity) and never animates after. At settle it fades once,
with the chip "Both boards ended".

| # | Source flash (owner's screen) | Travel | Landing (partner's screen) | Name chip (both screens) |
|---|---|---|---|---|
| B1 | The played minion's own play beat, a Shout-coloured rim, the "Both boards" pill pops | One bolt from the card to the gap; on Mike's screen it enters from the strip and settles on Kevin's tile | Each time it acts on Mike's board: a short bolt from Kevin's strip tile to the affected card, then that card's own beat (Shout pop with "x2", buff pop) | "Kevin's Drakko: your Shouts trigger twice" / "Drakko: working on Mike's board" |
| B2 | Both left-most minions flash in turn, pills pop | Two bolts, slot 1 and slot 2, straight across | Same as B1, per minion | "Kevin's Sylus and Elderhorn: both boards" |
| B3 | Like B1, plus a stamp on the Battle Hymn Link tile | As B1 | As B1 | "Kevin's Battle Hymn: Karwind works on both boards" |
| B4 | The targeting arrow (may cross onto the ally strip), then the target's rim and pill | As B1, from wherever the target sits | As B1 | "Kevin's Shared Banner: Mike's Orivax works on both boards" |
| B5 | A "Both boards" pill on each of Kevin's Rally minions at Start of Combat | Each Rally: the Rally beat on Kevin's front, a Rally-coloured bolt through the gap | The Rally's effect plays on Mike's front at the Twin slot, one step later, with its own beat | "Kevin's Echohorn (Rally for Two): Echo on Mike's Hound" |
| B6 | A counter "2 left" on the Burst pill above Kevin's hero | On each of the first 2 Echoes: an Echo-coloured bolt from the dying minion through the gap | The Echo's effect plays on Mike's front at the Twin slot (buff, summon, Rise pill) | "Kevin's Grim (Last Words for Two): Mike's Beasts +8/+8" |
| B7 | The banked Start of Combat cast on Kevin's front, shown with "x2 fronts" | One bolt per effect through the gap | The same Start of Combat beat on Mike's front, right after Kevin's | "Kevin's Spots (Opening Chord): 2 Echoes on Mike's front" |
| B8 | The spell's own cast FX on Kevin's target | A second targeting line crosses to the Twin tile on the strip | The spell's own FX on Mike's real card (or across Mike's board for an untargeted spell) | "Kevin's Double Dose: Pouring Ale on Mike's Brewer" |
| B9 | At Kevin's lock, each End of Turn beat plays on Kevin's board | One bolt per End of Turn effect | The same End of Turn beat on Mike's board (or a banked cast at Mike's Start of Combat if he locked first) | "Kevin's Kringle (Closing Time): Mike's Dwarves +3/+6" |
| B10 | A coin rim on Kevin's Gold-spent minion each time it pays | A coin hops from Mike's Gold pill to Kevin's minion tile, then a bolt back to Mike's board | The payout beat on Mike's Dwarves | "Kevin's Coinfire (Open Purse): Mike's Dwarves +2 Attack" |
| B11 | Kevin's Aura pill flashes once in the Aura colour | One bolt from Kevin's Aura pill to the strip | Mike's Undead show the added Aura in their live text; one buff pop per minion | "Kevin's Undead Aura: +9/+6 on your Undead this fight" |
| B12 | Each Shop buff Kevin makes plays as normal | A mote from the buffed card to the strip's Starform chip | The Starform's own gain beat in Mike's Shop | "Kevin's Starlit Shop: your Starform +2/+2" |

**Live text.** Every card affected on the partner's board says so: Mike's Shout cards in hand read "x2 (Kevin's
Drakko)", Mike's Undead read "Undead Aura +9/+6 (Kevin)". The source's own text gains a line: "Working on both boards
until the fight ends."

---

## 9. NEW: The Shared Slot

Kevin's ask: "a shared card slot that can be swapped in/out". Each pair has one, and it is called **the Shared Slot**.

### 9.1 What it is

- **Slot 7 is the Shared Slot, on both boards.** It is one slot holding one minion: one card, owned by one of you,
  standing in slot 7 on both boards at once. Your own minions fill slots 1 to 6. **The board is still 7 slots.**
- On your screen it is the slot at the end of your board nearest the gap (and nearest your partner's lane), so the
  Shared minion literally sits between the two boards.
- It is open from turn 1. While it is empty, each board fights with up to 6 minions plus any combat summons (a summon
  may fill slot 7 on its own front for that fight, as summons always do).
- Your 7th minion **is** the Shared minion. To use slot 7 at all, you share it.

### 9.2 The one rule

**The Shared minion works on both boards, all the time** (the rule in 8.1). And both boards treat it as their own:
it is a friendly minion, your right-most minion, and counts for your tribe counts, for both of you. Market Tormentor's
"right-most" and Kringle's "left and right-most" read it as printed.

### 9.3 Who decides: the pick, the swap, the lock

| Rule | Detail |
|---|---|
| **The pick alternates** | Each turn one player has the pick. The host has it on turn 1, the guest on turn 2, and so on. A pill under the slot says "Kevin picks" or "Mike picks". It never needs a vote. |
| **The picker may** | Place a minion from their own board or hand (free if the slot is empty). Swap the current minion for one of their own (**1 Gold**). Send the current minion home (free if it is their own, 1 Gold if it is their partner's). |
| **The other player may** | Fill the slot while it is empty (free). Take back their own minion at any time before the lock (free). **Offer** one of their minions: drag it onto the slot and the picker sees it with an Accept button; on Accept the swap happens and the offerer pays the 1 Gold. An offer lapses at the picker's lock. |
| **Placing from hand is playing** | It counts as playing the card. Its Shout triggers on both boards (8.1). Moving a minion from your board is not playing: no Shout. |
| **Where a swapped-out minion goes** | Back to its owner's board (slots 1 to 6), or to their hand if those six are full. |
| **Cooldown** | A minion that leaves the Shared Slot cannot go back in this turn. This stops any swap loop. |
| **Owner** | The player who put the minion in. An owner pip (portrait) sits on the card. Only the owner may sell it (the owner gets the Gold and its Sell triggers for them), Consume it, or reposition it. |
| **Lock-in** | **The Shared Slot locks when either of you locks.** After that it cannot change this turn, and both prepared sides carry the same minion. Buffs still land on the card after a lock; the locked player's copy gets them at Start of Combat as a banked cast. |
| **A Ghost** | still holds the pick on their turns and can be the owner. |

### 9.4 Combat: one copy on each front

- At Start of Combat **each front gets its own combat copy** of the Shared minion, at slot 7, with the card's current
  stats, keywords and Grafts. ASCENT already fights with combat copies of every minion, so this is the normal path.
- **Each copy fights only on its own front.** It attacks when slot 7's turn comes, takes its own damage, and can die on
  one front while the other copy lives.
- **Its own triggers fire per copy, on that copy's front.** Echohorn Rallies on each front where it attacks. Wolvie's
  Echo triggers on each front where it dies. A Start of Combat effect resolves on both fronts.
- **Each copy uses its own front's side state**: that player's Auras (Undead Aura, Imp Aura), Spell Power, Ruby
  boosts and rune flags (Rune of Fury, Rune of Twilight). Nothing stacks from the other side. This keeps combat sides
  symmetric and needs no new side state.
- **It is its own Twin.** A cross effect aimed at "its Twin" from either copy lands on the other copy.
- **Charge.** If your front wins and your copy is alive, it Charges with the rest. If the other copy still stands on
  the front it Charges into, the two rejoin: the standing copy gains the charging copy's current Attack and Health,
  with one beat, "Rejoined".
- **Fusion.** Slot 7's Twins are the same minion, so Fusion leaves it as one minion with its own stats (it does not
  double).
- **A Ghost's front.** The copy there has half Attack, like the rest of that board.

**The close alternative: one body.** The Shared minion could instead be one body in both fights, with one Health that
both fronts damage. It is thrilling but needs the Tandem engine's shared body (Phase 2), and it makes the pair's carry
fragile (focused from two sides). So it is not the default. It is a Mythic upgrade: **Joined at the Hip** (S1).

### 9.5 Buffs, gains and deaths

| Situation | Rule |
|---|---|
| **Shop buffs** | One card. Any buff from either player lands on it (Shouts, spells, Rubies, Dwarven Ales, hero powers, Equipment). Permanent buffs are permanent; Whisper stats are temporary as printed. Both players' buffs stack. |
| **Combat buffs** | A combat-only buff stays on the copy that got it, for that fight. |
| **Carry-back** | At settle, permanent gains from **both** fronts add to the card: Engraved stats, "permanently" gains, Slaughter gains, Pummel meter damage. Cards a copy earns go to the owner's hand. |
| **Pummel** | Each copy fills its own meter during the fight and can trigger Pummel on its front (each under the per-combat cap). At settle the card's meter gains the damage of both copies. |
| **Deaths** | Combat deaths are combat-only, as for every ASCENT minion: a copy that died is back on both boards next turn. A dying copy counts as one friendly death, on its own front only (Avenge). Rise and Rebirth work per copy (R-RISE-06: a combat Rise is a fresh copy for that fight). |

### 9.6 Gild and triples

- **Gild.** Golden Gift, Indy's Masterwork, Auric Runemaster's Shout and the Campfire's Gild all work on it as on any
  friendly minion, from either player. A Gilded Shared minion is Gilded on both boards and both copies are Gilded.
- **Triples.** The Shared minion counts as a **board copy for both players' triples** (board copies are used first,
  R-GILD-03). A triple that uses it puts the **Gilded copy straight back into the Shared Slot**, not into a hand. The
  player who made the triple becomes its owner. **Both players Discover a Triple Reward** (a minion from one tier above
  each player's own shop tier). The Gilded copy was not played, so its Shout does not trigger.
- On both screens: the copies fly in from both sides, merge in slot 7, the Gilded card lands, and both Discovers open
  with the header "Shared triple".

### 9.7 How it plays with Shout, Echo, Rally and always-on minions

| Shared minion | In the Shop | In combat |
|---|---|---|
| **Drakko** ("Your Shouts trigger twice.") | Both players' Shouts trigger twice, all turn. | Each front's combat Shouts trigger twice (each copy covers its own front). |
| **Karwind** ("Ward. Whenever a Shout triggers, give your Dragons +4/+4.") | Hears Shouts on both boards. Gives +4/+4 to the Dragons on the board where the Shout triggered. It is a Dragon on both boards, so it grows from both players' Shouts. | Each copy hears its own front; each has Ward. |
| **Echohorn** ("Rally: trigger your left-most Echo.") | Nothing. | Its copy Rallies on each front where it attacks, triggering that front's left-most Echo. |
| **Sylus** / **Elderhorn** | Both boards' Echoes (and Beast Rallies) trigger an additional time. | The same, per front. |
| **Chronos** ("Your End of Turn effects trigger twice.") | Both players' End of Turn effects trigger twice, each at their own lock. | Nothing. |
| **Kringle** (End of Turn: left and right-most Dwarves +1/+2, repeat per card played) | Triggers at each player's lock, with that player's count, on that player's board. It is the right-most Dwarf on both boards, so it buffs itself twice a turn. | Nothing. |
| **Coinfire** ("When you spend 5 Gold, give your Dwarves +2 Attack.") | Hears both players' spending; pays out on the board that spent. | Nothing. |
| **A Shout minion played into the slot** (Market Tormentor, Contract Butcher, Prospector) | Its Shout triggers on both boards: Market Tormentor gives the right-most Shop minion +8/+8 in both Shops; Prospector gives each of you a random Ruby. | Nothing more. |
| **Wolvie** ("Taunt. Echo: give a friendly Beast Rise.") | Nothing. | Taunt on both fronts. Its Echo triggers on each front where its copy dies. |

**Links and the Shared minion.** Links owned by either player treat it as their slot 7 minion. Because it is its own
Twin, Twin Links on slot 7 (Echo Chamber, Return to Sender, Tag In) feed it from both sides. A pair that builds around
it gets a **hub**: one card every Link touches.

### 9.8 Presentation on both screens

| Moment | Your screen | Partner's screen |
|---|---|---|
| **The slot** | Slot 7 at the end of your board nearest the gap, in a "Shared" card-frame pill variant with the owner pip. The pick pill underneath. | The same card at slot 7 of their board, same pill and pip. Your ally strip tile 7 shows it too, with the pill. |
| **Pick flips** (Start of Turn) | The pick pill flips once ("Mike picks"). | The same. |
| **Placing** | The card lifts from your board or hand and slides into slot 7 with the summon beat. A Shout from hand plays its Shout beat on your board. | The card enters from the ally strip and lands in their slot 7 with the summon beat. The same Shout beat plays on their board. Chip on both: "Kevin put Drakko in the Shared Slot". |
| **Swap** | The old card slides home to its owner (onto your board, or toward the strip if it is your partner's); the new one slides in. | The mirror of it. Chip on both: "Mike swapped Drakko for Karwind (1 Gold)". |
| **Offer** | (Offerer) An "Offered" pill on the offered card. | (Picker) The offered card hovers over slot 7, translucent, with the existing Accept button. |
| **Lock** | The slot takes the existing frozen tint once; the pill reads "Locked by Mike". | The same. |
| **It acts on a board** | When it acts on your board: a source flash on the Shared card and that effect's own beat on your minions. When it acts on your partner's board: a pulse on your strip tile 7. | The mirror. No travel bolt is needed in the Shop because the card is on both boards. Chip names the board: "Shared Karwind: Mike's Dragons +4/+4". |
| **Combat** | Your copy fights in your arena at slot 7. Its Twin guide at Start of Combat is drawn in gold. The lane shows the other copy with the "Shared" pill. | The mirror. |
| **Settle** | Gains from the partner's front fly from the lane tile into the Shared card with one stamp: "+6/+6 from Mike's fight". | The mirror. |
| **Triple** | Copies fly in from your board and from the strip; the Gilded card lands in slot 7; your Discover opens. | The mirror; their Discover opens. |

### 9.9 Loot built around the Shared Slot (6)

| # | Entry | Text | Built on | Shown as |
|---|---|---|---|---|
| S1 | **Joined at the Hip** (Link, Mythic, Both must take) | "Both must take. The Shared minion is one body in both fights. It has one Health. It attacks on both fronts. Damage on either front hits it." Alone: "Your front's copy of the Shared minion has Rebirth." | `sharedBody` (the Jormun primitive) | One Health bar spanning the slot 7 tile in your arena and in the lane; every hit on either front lowers both, with the number on both. |
| S2 | **Open Door** (Link, Rare) | "Swaps into the Shared Slot cost no Gold. A minion swapped out gains +2/+2 permanently." II: +3/+3. III: and it may go back in this turn. | the swap rule, a permanent buff | STAMP on the swapped-out card, on both screens. |
| S3 | **Centrepiece** (Graft, Epic; only on the Shared minion) | "Graft. Start of Combat: gain +1/+1 for each Link level you and your partner own. (Now 14: +14/+14.)" | Start of Combat buff, live scaler | SOC on both copies at once; live text on both screens. |
| S4 | **Second Chair** (Link, Legendary) | "Slot 6 is a Shared Slot too, for both of you." | a second Shared Slot under the same rules; its pick goes to the player without the slot 7 pick | A second "Shared" pill on slot 6 on both boards; chips name "Shared Slot 6". |
| S5 | **Common Cause** (Burst, Epic) | "Next fight: a buff on one copy of the Shared minion also lands on the other copy." | cross buff between the two copies | Each buff on one copy sends a short gold bolt through the gap to the other copy, which plays the buff beat. Chip: "Common Cause: +4/+4 on Mike's copy". |
| S6 | **Hinge** (Card minion 3/4, Tier 3, Rare; also a Link minion in the Shop pool) | "While in the Shared Slot: Rally: give its neighbour +2/+2 on this front and on your partner's front." | Rally, cross buff | Rally beat on its front; a bolt through the gap to slot 6 on the other front; buff beat there. |

**Bosses read the Shared Slot too** (13): the Gobbler King may swallow the Shared minion's copies, Vel copies it twice,
and the Linkbreaker's **Claim** intent turns one copy against you for a fight.

---

## 10. Other co-op mechanics

### 10.1 Hand Off, Send Gold and Take (the co-op verbs)

- **Hand Off.** Drag a card from your hand onto your partner's portrait. It lands in their hand with the card-to-hand
  beat and a bolt across the gap on both screens. **One free Hand Off a turn**; each extra costs 1 Gold. Minions, Shop
  spells, Rubies and Gifts can be sent. Whispers only with Whisper Network. **Sent minions count toward your partner's
  triple.** "I send you the third Wolvie" is the most common beat.
- **Send Gold.** Drag your Gold pill onto your partner's portrait: 1 Gold moves across with the coin hop. **Up to 3 a
  turn**, free. It is the plain answer to a boss tax (13).
- **Take.** Drag a Curse (11) from your partner's ally strip tile onto your own matching thing (a minion, your Shop
  chip, your portrait). It moves to you whole. 1 Gold, once per Curse a turn. Some Curses can also be **split** (11.4).
- No Hand Off, Send Gold or Take after your partner locks (their side is frozen for the fight). The drop is refused and
  nothing is spent: "Mike has locked."

### 10.2 The ally scope

Any targeted Shop spell, Ruby, Shout or hero power that targets "a friendly minion" may instead be dropped on a tile
of your partner's ally strip: **+1 Gold** for spells and hero powers, **free** for Shouts if you own a Shout Link. The
Shared minion is friendly to both of you and never costs the extra. It resolves on their real board at once, with the
normal FX on their screen and a bolt on both. Counters ("spells cast this turn") count for the caster. If the partner
has locked, the drop is refused. If the target leaves in the same instant, the cost refunds.

### 10.3 Tandem fights (the default format)

**Every fight is a Tandem fight.** Each board fights its own front, and **the two fights advance on one step clock**.

- **A step** is one attack and every trigger it causes, as `simulate` already resolves it.
- **Order.** Start of Combat resolves on the leading front, then the other, after cross Start of Combat casts from
  both players' Links are compiled in. Then steps alternate: lead step 1, other step 1, lead step 2, and so on. **The
  lead alternates every turn** (the Versus `firstSide` idea, one level up). The leading front shows a small "Leads" pill.
- **Crossings.** An effect aimed at the other front is put in that front's inbox, tagged with its source (seat,
  minion, Link id). A front drains its inbox at the start of its next step, before it attacks. So a crossing always
  lands **at most one step later**. That gap is when the bolt flies. Both boards effects (8) cross this way.
- **Symmetric.** The enemy side of one front can send to the enemy side of the other through the same inbox. Bosses
  use this. Nothing reads "player": a cross effect reads its owner's side through `stateOf(side)` as everything does.
- **A front ends.** The other front keeps stepping alone. Crossings into an ended front go to a Charge if one is coming
  (10.4), otherwise they fizzle with a visible chip: "Mike's fight is over."
- **One log, one clock.** The engine writes one merged log with a global step index; each client plays its own front
  and shows the partner front in the lane on the same clock.
- **Parity guard.** A Tandem fight with no cross effects must produce, per front, a log byte-identical to a plain
  `simulate` call on that front. That test guards the refactor (22.5).

### 10.4 The Charge (one rule for helping)

**When your front is won, your survivors Charge into your partner's front**, whether that fight is still running or
already lost.

**Into a running fight.**
- Chargers wait at the gap and enter the player side at the target front's next step boundary, **one per free slot,
  from the right end**. If the board is full, the rest wait and step in as slots open.
- They keep their **current stats and spent flags**: a broken Ward stays broken, a used Rise stays used, Execute
  already dropped stays dropped, Pummel meters as they stand. `socSpent` is set, so **Start of Combat never fires
  again** for a charger. Their **Charge:** text fires on arrival.
- **Attack order.** The arriving minions attack first, then the normal attack pointer resumes.
- A charging copy of the Shared minion **rejoins** the other copy if it still stands (9.4).

**Into a lost fight (the continuation leg).** If your partner's front was already lost when yours was won (or both
ended on the same step), the enemy survivors stay as they ended, and your chargers fight them in one more Tandem leg.
**The arriving board attacks first.**

**Outcome.** **Charge won:** the front is **Saved**. Your partner takes **no damage**. The boss bar takes the tiers of
the surviving chargers only. **Charge lost:** your partner takes the full damage. A Charge never chains back. On
screen: your survivors run off toward the gap, both clients cut to the partner's arena, and "CHARGE!" plays once.

**Why a sacrificial board does not pay.** A Saved front deals no boss damage of its own, its owner gets no Victor's
pick, and its owner's Yours slot is a Comeback only if the Charge was lost. The **sacrificial-board test** (23.6) must
prove a "one strong, one empty" pair breaks bars measurably slower than a median pair.

### 10.5 Fusion (the raid's climax)

**Fusion** happens in three places: the **FUSION** Mythic Link (once per boss, both press Fusion), the last phase of
**Vel** (forced), and the last crown of the **Seven-Crowned Engine** (forced).

- At Start of Combat each pair of Twins becomes one **Fused** minion. A slot with only one minion stays as it is. Slot
  7, the Shared minion, stays one minion. The result is one 7-slot board, one side.
- A Fused minion has **summed Attack and Health**, **every keyword from both**, **every trigger from both** (Echoes,
  Rallies, Avenge, Slaughter, Pummel meters), both tribes, Gilded if either half was. Owner pips show both portraits.
- The Fused side takes the **higher** of each side value (Spell Power, Ruby boosts, each Aura). Rune flags from both
  rune rows apply (duplicates stack as runes always do). Curses on either half stay on the Fused minion.
- **Fused reading.** On a Fused board "its Twin" reads "its neighbours". Every Link shows its Fused reading live.
- After the fight the Fused minions split. Permanent and Engraved gains carry back to **both** halves.
- Damage: a Fused win deals the higher shop tier plus the tiers of every surviving Fused minion. A Fused loss costs each
  player half the damage, rounded up.

The button is labelled **Fusion**, never "Fuse": ASCENT already uses Fuse for the lobby's Gold Fuse clock.

### 10.6 Momentum (overkill that pays)

Boss damage past a full phase bar is **Momentum**. Each 10 Momentum gives **both players +1 Gold** next turn and **one
rarity step** on one slot of each player's next Haul (max +3 Gold and +2 steps). "OVERKILL +23" shows over the bar.

### 10.7 Wrath (the one visible rubber band)

Each act has a **Link mark**: the pair's expected total Link levels at that act's boss (Act 1 8, Act 2 20, Act 3 32,
finale 40). **For every 4 levels above the mark, the boss gains one Wrath step**: each boss minion +15% Attack and
Health. The boss card shows it: "Wrath +2: you are 8 levels ahead." Below the mark there is no help and no penalty.

### 10.8 Joint calls and talk

- **Door vote** (4.2). **Fusion** button. **Swap Meet / Field Promotion:** the receiver's choice has a 10 s timer.
- **Emotes** as in Versus. **Pings** (right-click radial, a 3-second pill on the partner screen): on the Handshake
  "Handshake?", "Taking it", "Skip it"; on a Link "Feed this"; on a board slot "Twin here"; on the Shared Slot "Put it
  here", "Hold the slot"; on a Curse or boss telegraph **"Cover me"** and **"I've got it"**; on the lane "Watch this".
  **Peek** (hold Tab): the Versus spectator view of the partner's screen.

---

## 11. NEW: Curses

"Curse" has no existing meaning in ASCENT (no card, rune, keyword or rule uses it), so the name is kept.

### 11.1 What a Curse is

A **Curse** is a negative rule attached to one thing, shown in a violet curse pill with a number when it has one.

| Where | What it looks like | Example |
|---|---|---|
| **On a minion** | a curse pill on the card, in board, hand and combat | Rot 2: "Start of Turn: this loses 2/2." |
| **On a Shop** | a curse pill on your Shop row (and a chip on your ally strip tile for your partner) | Toll 2: "Your Refresh costs 2 more." |
| **On a hero** | a curse pill beside your portrait | Debt 2: "Start of Turn: lose 2 Gold." |
| **A card in hand** | a Curse card (curse frame) that takes a hand space | Bad Omen. |
| **A Shop card** | **Junk**, a Curse minion sitting in your Shop | Junk: a 1/1 for 1 Gold with no text. |

Every Curse prints three lines: what it does, its **Cleanse** (how it ends), and when it has one, its **Turns** line
(what it becomes if the pair handles it right).

### 11.2 How Curses are applied

- **Bosses and elites**, as their recruit pressure (13), always telegraphed a full Shop ahead.
- **Enemy units** with a curse trigger ("Echo: Curse the minion that killed this with Rot 1.").
- **Events**: some doors carry a Curse with a prize (a Vault whose chest is "Cursed: Rot 2 on your slot 1").
- **Risky loot.** Some Haul cards are one rarity step better than their slot and print **"Curse attached:"** with the
  price: "Legendary. Curse attached: Debt 2 on you." You see the Curse before you take it.

### 11.3 Duration and stacking

- A Curse lasts until it is cleansed, unless it prints a countdown ("3 turns"). The countdown ticks at Start of Turn.
- **The same Curse stacks its number** on one target (Rot 2 plus Rot 1 is Rot 3). Different Curses stack side by side.
- **Limits:** at most 3 Curses on a minion, 3 on a Shop, 3 on a hero, and Curse cards count toward the 10-card hand.
- A Gilded minion's Curses stay when it is Gilded. A triple's Gilded copy keeps the worst one of each kind.

### 11.4 How Curses spread

- **Spreads** is printed on some Curses: at End of Turn it **copies** to the same thing on your partner's side (a minion
  Curse goes to its Twin, a Shop Curse to their Shop, a hero Curse to them). A spread copy starts at 1, not at the full
  number. On both screens a violet wisp crosses the gap at End of Turn, one-shot.
- A Curse on the **Shared minion** is on both boards at once, so it hits both of you. It cannot spread further.
- Curses never spread during combat. A minion Curse on a combat copy carries back to the card.

### 11.5 How Curses end (co-op first)

| Way | Who | How |
|---|---|---|
| **The printed Cleanse** | either, as printed | Each Curse names its own answer. Many need your partner: "Cleanse: your partner's Shout targets it." |
| **Take** | the partner | 10.1: drag it onto your own matching thing. It moves whole. 1 Gold, once per Curse a turn. Good when your board can afford it or your Cleanse is easier. |
| **Split** | the partner | Curses with a number can be split instead of taken: each of you gets half, rounded up (Rot 3 becomes Rot 2 on yours and Rot 2 on theirs; Rot 2 becomes 1 and 1). A Curse at 1 cannot be split. 1 Gold. |
| **Burn it** | either | A **Shout** that targets a cursed minion lowers each Curse on it by 1 (any Shout, yours or your partner's through the ally scope). A **Ward** given to a cursed minion absorbs its next Curse instead of a hit (the Ward breaks). |
| **Buy it out** | either | **Junk** is cleansed by buying it. Your partner may clear one Junk from your Shop through the strip's Shop chip for 1 Gold. |
| **The Campfire** | the cursed player | A Campfire action, **Cleanse**, ends every Curse on you, your Shop and your board. |
| **Hero powers** | either | **Cleanser** (15) ends one Curse on either board. |

### 11.6 Curses that turn good

A Curse with a **Turns** line becomes something good when the pair meets the condition. The turn plays as a one-shot
on both screens: the violet pill flips gold, and the card's new text stamps in.

### 11.7 The Curses (14)

| # | Curse | On | Text | Cleanse | Turns |
|---|---|---|---|---|---|
| K1 | **Rot (X)** | minion | "Start of Turn: this loses X/X. Spreads." | a Shout on it lowers it by 1; Take; Split | **If Rot 1 sits on a minion and on its Twin at Start of Turn, both turn into "Start of Turn: gain +2/+2" for the run.** Splitting is the answer. |
| K2 | **Coiled** | minion | "Cannot be moved or sold. In combat it cannot attack in steps 1 to 3." | its Twin's owner plays a Shout minion this turn | **If its Twin attacks immediately (Tag In, Opening Volley) next fight, Coiled turns into "Attacks immediately" for that fight.** |
| K3 | **Supper** | minion | "End of Turn: the Gobbler eats this." (Gobbler King only) | it sits in the Shared Slot at lock, or you sell it | none (the Gobbler gives it back when he dies) |
| K4 | **Leech** | minion | "Half the permanent stats this gains go to the boss instead." | your partner gives it Ward | **If it gains 20 stats while Leeched, Leech turns into "Your partner's slot 1 gains half the stats this gains."** |
| K5 | **Brittle** | minion | "Its Ward breaks at Start of Combat. Its Rise and Rebirth do not work." | your partner gives it Ward through the ally scope (the second Ward holds) | none |
| K6 | **Doubt** | minion | "Its Shout and Echo resolve on the enemy's side." (Vel only) | its Twin is the same tribe at lock | **If its Twin is the same tribe and Gilded, Doubt turns into "Its Shout and Echo also resolve on its Twin."** |
| K7 | **Junk** | Shop card | "A 1/1 for 1 Gold. No text. Refresh and Freeze do not remove it." Bought, it becomes a Junk Curse card in hand (discard for 1 Gold). | buy it; or your partner clears it from your Shop through the strip (1 Gold) | **If the pair clears 3 Junk in one turn, the last one turns into a Gilded random minion of your top tribe, in your hand.** |
| K8 | **Toll (X)** | Shop | "Your Refresh costs X more." | Gold your partner sends you this turn pays it first (Send Gold) | none |
| K9 | **Scorched** / **Chilled** | Shop | "Minions you buy have -3 Attack." / "... -3 Health." (Aurex and Noctra) | none in the Shop | **If both of you buy a Dragon this turn, both turn: Scorched gives +3 Attack, Chilled +3 Health, this turn.** |
| K10 | **Gravity (X)** | Shop | "Your Shop has X fewer slots. The cards it would show appear in your partner's Shop instead, tagged with your name." | none; route around it (Hand Off) | none |
| K11 | **Debt (X)** | hero | "Start of Turn: lose X Gold. 3 turns." | your partner sends you X Gold in one turn | none |
| K12 | **Silence** | hero | "Your hero powers cannot be used." | your partner casts 2 spells this turn (the seal breaks for you) | **If your partner breaks it with a spell on your minion, your next hero power this turn is free.** |
| K13 | **Marked** | hero | "If your front loses, you take 5 more damage." | Take; or both fronts win | **If both fronts win while you are Marked, it turns: the boss bar takes 10 more damage.** |
| K14 | **Bad Omen** | card in hand | "Cannot be discarded. End of Turn: if this is in your hand, a random minion of yours loses 3/3." | Hand Off it | **If your partner casts it, it turns into "Give a minion +3/+3" as it resolves.** It is a 0-cost spell in their hand. |

### 11.8 Presentation

- **The curse frame and pill.** A violet curse pill (the existing keyword-pill component in its own colour) with the
  number. Curse cards and Junk use a curse frame variant (painted, art owed). Hover (data-tip) shows the three lines.
- **On your partner's screen.** Your cursed minions show the pill on their ally strip tile; your Shop and hero Curses
  show as pills on your strip's Shop chip and portrait. They always know what you carry.
- **Applying.** The boss's colour streaks from its portrait to the target, and the pill stamps on (one-shot).
- **Take.** The pill lifts off your partner's tile on your screen and flies through the gap to your own card; on their
  screen it lifts off the real card and leaves through the strip. Chip on both: "Mike took Rot from Kevin's Wolvie".
- **Split.** The pill cracks in two: one half stays, the other flies across. Both numbers tick.
- **Spread.** At End of Turn a thin violet wisp crosses the gap, one-shot, and the copy stamps on at 1.
- **Turns good.** The pill flips from violet to gold with a one-shot shine, and the card's new text stamps in. Chip on
  both: "Rot turned: +2/+2 each turn".

---

## 12. NEW: Enemies have their own roster and their own art

Owner direction: every enemy is a **bespoke unit with its own art**, so it reads at once as "not a card you shop
with". Enemy boards never reuse shoppable ASCENT cards. They still use ASCENT's real keywords and mechanics (Taunt,
Ward, Rise, Echo, Rally, Avenge, Slaughter, Consume, Stealth, Flurry ...), so they read naturally.

- Each enemy is a `token: true` `CardDef` on an authored enemy board with an enemy `CombatSideState`. Data only.
- **Enemy frame.** A painted enemy frame variant (art owed) and the boss colour pill; enemy units never show a tier gem
  or a price.
- Bosses and elites keep their named units (13). Brawl packs are themed by act.

### 12.1 The Act 1 roster (The Hollows): 15 units in 4 packs, plus the Vault

| Pack | Unit | Stats | Keywords and text |
|---|---|---|---|
| **Hollow Brood** | **Hollowling** | 2/3 | (no text) |
| | **Egg Sac** | 0/6 | "Taunt. Echo: summon two Hollowlings." |
| | **Brood Nurse** | 3/4 | "Avenge (2): give your Hollowlings +2/+2." |
| | **Hollow Spitter** | 4/2 | "Start of Combat: deal 2 damage to the enemy with the most Attack." |
| **Gobble Gang** | **Gobbling** | 3/2 | "Echo: give a friendly unit +2/+2." |
| | **Crumb Thief** | 2/2 | "Stealth. Slaughter: gain +2/+2." |
| | **Pot-Belly** | 2/8 | "Taunt. When this takes damage, gain +1 Attack." |
| | **Glutton Brute** | 5/5 | "Rally: Consume a friendly Gobbling." |
| **Thornback Bandits** | **Thorn Cutpurse** | 3/3 | "Flurry." |
| | **Briar Guard** | 1/7 | "Taunt. Ward." |
| | **Hexer** | 2/4 | "Echo: Curse the minion that killed this with Rot 1." |
| | **Bandit Chief** | 6/6 | "Rally: your units gain +1/+1." |
| **Lantern Moths** | **Glowmoth** | 1/1 | "Rise." |
| | **Moth Swarm** | 2/3 | "Echo: summon two Glowmoths." |
| | **Lamplighter** | 3/6 | "Ward. Avenge (3): give your units Rise." |
| **Vault** | **Vault Guardian** | 0/80 | "Cannot attack. Takes the timer of 12 steps." |

Brawls mix 3 to 6 units from one pack (two packs from turn 5), scaled by the act curve (13.1 anchoring).

### 12.2 Act 1 elites and bosses (units)

| Encounter | Units |
|---|---|
| **The Twin Sentinels** (elite) | Sentinel 4/18 "Taunt. Ward. If the other Sentinel dies, gain Resilient Ward."; Squire 2/4 |
| **Gob and Gobbo** (elite) | Gob 5/20 "Rally: summon a Goblin on the other front."; Goblin 3/3 |
| **Mother Hollow** (boss) | Mother Hollow; Hollow Half; (Hollowlings from the Brood pack) |
| **The Gobbler King** (boss) | The Gobbler King; (Gobblings from the Gobble Gang pack) |

**Act 1 art count: 22 enemy portraits** (15 pack units + Vault Guardian + Sentinel, Squire, Gob, Goblin + Mother
Hollow, Hollow Half, Gobbler King). Act 2 and Act 3 rosters follow the same shape (about 14 pack units each). **Full
run estimate: about 95 enemy portraits** (Act 1 22, Act 2 ~28 with its bosses and elites, Act 3 ~28, the finale ~17:
seven heads, the Pendulum, seven Limbs, the Titan and its crown). Placeholder silhouettes until the owner names files.

---

## 13. Bosses: 9, plus 6 Juggernauts

### 13.1 How bosses are built

A boss is an authored encounter of **bespoke enemy units** (12) with a full enemy `CombatSideState` per front (tier,
Auras, Spell Power, Ruby boosts, rune `questMods` flags). Combat sides are symmetric, so a boss can hold Rune of Fury
or Rune of Twilight exactly as a player does.

Each boss has: an **Exam** (the co-op skill it tests), **phase bars**, its **damage** (what a lost front costs), an
**intent cycle** shown a full Shop ahead with exact numbers, one **rule it breaks** in combat, **recruit pressure**
(below), a weakness the loot engine can hit, a **themed Wild list**, **drops** (14), and a **loss line** for the end
screen.

**Anchoring.** Each phase's front is built to the strength of the **median recorded lobby board of wave N** times an
uplift for Links (Act 1 x1.15, Act 2 x1.35, Act 3 x1.6, finale x2.0), measured and retuned by the bot driver. **Bars and
damage** (first pass): Act 1 bar 30, damage 7; Act 2 50 / 11; Act 3 70 / 15; finale 90 per crown (crown 3: 120) / 18.
**Enrage** from a phase's 4th turn: its units gain +6/+6 each turn and its damage doubles. No timeout loss.

### 13.2 Recruit pressure: the owner's rule

Owner direction: bosses **should** affect recruit phases, and the pair must be able to beat it **together**. So every
boss and several elites put pressure on the Shop, the Haul, a hero or a minion. Every pressure follows four rules:

1. **Telegraphed a full turn ahead**, with exact numbers, the affected player named, and a **suggested counter**.
2. **Asymmetric, with a built-in co-op bypass.** The curse on one player opens something on the other. Routing around
   it together (Hand Off, Send Gold, Take, the Shared Slot, Twin effects, buying for each other, swapping roles) is
   always better than the solo fallback, which always exists and is always worse.
3. **Never unanswerable** for a pair that talks. Budgets are printed ("Appetite 4 Gold this turn").
4. **A little scary.** It costs something real if ignored.

**Readability on both screens.** The intent card on the ribbon shows three lines: **what** ("Levy: Kevin's minions
cost 4 next turn"), **who** (the affected portrait glows once and wears the curse pill; on the partner's screen the
same pill sits on the strip portrait), and **Answer** ("Answer: Mike sends Gold. Gold sent to Kevin counts double.").
The affected player gets a one-tap **"Cover me"** ping prefilled with the answer; the partner gets **"I've got it"**.

### 13.3 The 14 bypass patterns (one per boss and elite that has pressure)

| # | Pattern | Boss or elite | The curse | The opening | Co-op bypass | Solo fallback (worse) |
|---|---|---|---|---|---|---|
| P1 | **Split it to turn it** (dilute) | Mother Hollow | Rot 2 on Kevin's best minion, and it Spreads | Rot 1 on a Twin pair turns good (K1) | Mike **Splits** it (1 Gold): Rot 1 and Rot 1 on the Twins. Next Start of Turn both turn into +2/+2 a turn. | Shouts on it (one Rot a Shout), or carry it. |
| P2 | **Safe in the Shared Slot** (a marked minion) | The Gobbler King | Supper on Kevin's best minion | Mike holds the Shared Slot pick | Mike's pick moves Kevin's marked carry into the Shared Slot (or Kevin offers it and Mike accepts). "He cannot eat what two boards hold." | Sell the carry for 1 Gold. |
| P3 | **The partner's Shout thaws you** (a frozen board) | Jormun | Coiled on Kevin's slots 1 and 2 | Mike's Shouts count | Mike plays a Shout minion this turn: Kevin's slot 1 and 2 Twins are Mike's, so both thaw (K2). | Pay 3 Gold per slot to uncoil. |
| P4 | **A tax the partner pays** | The Grand Tithe | Levy: Kevin's minions cost 4 | Gold Mike sends to Kevin counts double (up to 4) | Mike sends 2 Gold, Kevin gets 4, the tax is covered. | Buy one minion fewer. |
| P5 | **It inverts if you act together** | Aurex and Noctra | Scorched on Kevin's Shop, Chilled on Mike's | K9's Turns line | Both buy a Dragon this turn: both Shops flip to +3. "Buy a Dragon. Any Dragon." | Buy nothing, or eat -3. |
| P6 | **A seal only the partner breaks** | Voltara | Silence on Kevin's hero powers and his top Link | Mike's spells break it | Mike casts 2 spells; with one on Kevin's minion, Kevin's next power is free (K12). Split duties: "I break your seal, you hold Ward." | Fight without them. |
| P7 | **You shop for me** (mirrored Shop) | Vel | Mike's Shop row shows Kevin's Shop. A card bought by one vanishes from the other. Kevin's Shop is Silent: he cannot buy. | Mike buys Kevin's cards at 2 Gold | Mike buys what Kevin needs and Hands Off. Swap roles next turn. | Kevin rolls for Spells only. |
| P8 | **One Shop shrinks, the other grows** | The Hungering Star | Gravity 2 on Kevin's Shop | His lost cards appear in Mike's Shop, tagged "Kevin's" | Mike buys them and Hands Off (the Hand Off is free for tagged cards). | Kevin shops a 2-slot-smaller row. |
| P9 | **Buy out the Junk** | Gob and Gobbo (elite) | 3 Junk in Kevin's Shop | Mike clears Junk through the strip for 1 Gold each; each one cleared gives Mike's slot 1 +1/+1 | Mike clears 2, Kevin buys 1: 3 cleared in one turn, the last turns into a Gilded minion (K7). | Kevin buys Junk into his hand. |
| P10 | **Tier-up seesaw** | The Twin Sentinels (elite) | Kevin's tier up costs 3 more | When Mike tiers up this turn, Kevin's next tier up costs 3 less | Mike tiers up first; Kevin's surcharge cancels. | Kevin waits a turn. |
| P11 | **Cast it through me** (role swap) | Grubb the Spellhater (elite) | Kevin's spells cost 2 more | Spells Mike casts on Kevin's minions through the ally scope cost no extra and give +1/+1 more | Kevin Hands Off his spells; Mike casts them on Kevin's board. | Kevin pays 2 more per spell. |
| P12 | **Share the broken Link** | The Linkbreaker (elite) | Kevin's top Link is cut for the fight | The cut can be split | Mike Splits it: both players' top Links fire at half for the fight, instead of one at zero. | Fight without it. |
| P13 | **Your spending winds my clock back** | Colossus of Counts (elite) | Debt 3 on Kevin, and the Colossus's Countdown starts at 4 | Every 3 Gold Mike spends winds the Countdown back 1 | Mike spends big this turn; Kevin's Debt is paid by Send Gold. | Kevin loses 3 Gold a turn for 3 turns. |
| P14 | **Pass the crown** | The Seven-Crowned Engine | The Heavy Crown on Kevin: his Shop clock is 20 s shorter | Whoever wears it gets +3/+3 on slot 1 per turn worn | Mike **Takes** the crown on the turn Kevin needs time; they trade it back and forth. | Kevin locks early every turn. |

### 13.4 Act 1. MOTHER HOLLOW, THE SPLITTING QUEEN

*Exam: **share the load.** "Kill her halves together, and split what she plants in you."* Phases 30 / 30 / 30.
Damage 7. Teaches the Tandem clock and Split.

- **Recruit pressure: Brood Rot (P1).** Telegraph: "Next turn: Rot 2 on Kevin's Wolvie. It Spreads." Answer line:
  "Mike splits it. Rot 1 on both Twins turns good." Presentation: a violet egg cracks over Kevin's card; on Mike's
  screen the same pill sits on Kevin's strip tile with a ghost arrow to Mike's Twin.
- **Phase 1, The Swell.** Each front: Mother Hollow 6/30 Taunt, "Start of Combat: gain +2/+4 for each turn this phase
  has lasted. (Now +0/+0.)", and 2 Hollowlings. **Rule break: the Heartstring.** When one Hollow takes damage, half of
  it also hits the other, one step later.
- **Phase 2, The Split.** One Hollow Half per front: 10/24 Taunt. **Rule break: Sync or Swell.** When a Half dies, a
  3-step ring appears on the other. Kill it inside the ring and both stay dead ("SYNCED"); if not, the dead Half
  Rebirths.
- **Phase 3, Brood Flood.** Each front: 2 Halves 8/16 and 4 Hollowlings. **Rule break: Cross Brood.** Every enemy death
  on either front summons a Hollowling on the other front at the same slot.
- **Intent cycle:** Sharpen, Burn ("Start of Combat: 2 damage to each of Kevin's minions."), Brace, Hunger, Brood Rot.
- **Weakness:** Tag In, Mirror Strike and Opening Volley sync kills across fronts.
- **Themed Wild:** Opening Volley, Mirror Strike, **Heartstring** (Epic Link: "When your minion takes damage, its Twin
  gains that much Attack this combat. Up to 6 times each combat.").
- **Drops (14):** hero power **Cleanser**; mode rune **Rune of the Brood**; an ASCENT Basic rune; Heartstring; boss card
  **Mother Hollow**.
- **Loss line:** "Her Halves died 5 steps apart. Sync them."

### 13.5 Act 1. THE GOBBLER KING

*Exam: **protect each other's carry.** "He eats your Shop. Feed him something else."* Phases 30 / 30. Damage 7.

- **Recruit pressure: Appetite and Supper (P2).** Each End of Turn he eats Shop minions worth up to **Appetite 4 Gold**
  from each Shop, right-most first; the cards he will eat wear a "Gobbler eats this" pill a full Shop ahead. Freezing or
  buying protects them. **The opening:** each card he eats from Kevin's Shop makes its Shop Twin in Mike's Shop cost 1
  less. In phase 2 he also puts **Supper** on each player's best minion. Answer line: "Move it into the Shared Slot. He
  cannot eat what two boards hold."
- **Phase 1, The Feast.** Each front: Gobbler King 4/36, "Start of Combat: gain the stats of everything in his Belly.",
  and 3 Gobblings.
- **Phase 2, The Gulp.** At Start of Combat he swallows **a combat copy** of the highest-stats minion on each board,
  the Shared minion included (shown a Shop ahead: "He will swallow the Shared Karwind"). **Rule break: Burp.** When the
  King dies, his Belly spills onto the **other** front's player side as combat copies at +5/+5, Gilded.
- **Victory:** each player gets one of the eaten minions back as a real Gilded card in hand.
- **Intent cycle:** Feast ("Appetite +3 next turn."), Gulp, Belly Ache, Snack Break, Supper.
- **Weakness:** Bodyguard and Lend a Shield (a Warded bait loses Ward instead of being swallowed).
- **Themed Wild:** Golden Gift, Copycat, **Doggy Bag** (Rare Burst: "Next combat: if the King swallows your minion, he
  swallows its Twin's copy instead, and the Burp lands on your front.").
- **Drops:** hero power **Masterwork**; mode rune **Rune of the Belly**; an ASCENT Basic rune; Doggy Bag; boss card
  **The Gobbler King**.
- **Loss line:** "He ate your Shop slot 5 three turns in a row. Freeze it."

### 13.6 Act 2. JORMUN, THE TWO-ENDED SERPENT

*Exam: **thaw each other.** "Its head is in one fight. Its tail is in the other. It has one life."* Phases 50 / 50 / 50.
Damage 11.

- **Recruit pressure: Constrict (P3).** Telegraph: "Next turn: Coiled on Kevin's slots 1 and 2." Answer: "Mike plays a
  Shout minion. His Shouts thaw his Twins." Presentation: coils wrap the two cards (one-shot); Mike's strip shows the
  two tiles coiled with a Shout pill hint.
- **Phase 1, Head and Tail.** Head 15 Attack, Flurry, "Rally: attack again if it killed." Tail 6 Attack, Taunt, "Rally:
  summon a 4/4 Coil." **Rule break: One Body.** They share one Health pool of 120, one bar across both portraits.
- **Phase 2, The Turn.** **Rule break: Head swap** at Start of Combat (a long body slides through the gap, 1.2 s).
- **Phase 3, Ouroboros.** One unit in **both** fights at once (`sharedBody`). **Rule break: Shed.** Each time it is
  attacked in either fight, it summons a 4/4 Scale on the other front. Up to 10 Scales per front.
- **Hunt:** the hunted slot is shown a Shop ahead ("Jormun bites Mike's slot 2 for 30."). Either player may drag the
  hunt pip onto the other portrait; the newly hunted front's Head gains +5/+5.
- **Intent cycle:** Hunt, Coil, Molt ("Heals 20 on the body."), Venom ("The Head has Execute this fight."), Constrict.
- **Weakness:** Crossfire, Overkill Express: damage from one fight lands on the shared body.
- **Themed Wild:** Bodyguard, Return to Sender, **Fang and Rattle** (Epic Link: "When an enemy on either front is hit
  by a cross effect, it takes 2 more.").
- **Drops:** hero powers **Rally Cry** or **Reclaim**; mode rune **Rune of the Coil**; an ASCENT Epic rune; boss card
  **Jormun**.
- **Loss line:** "The body healed 40 from Molt. Burst it the turn before."

### 13.7 Act 2. THE GRAND TITHE

*Exam: **pay for each other.** "It takes what you leave behind. Then it takes what you kept."* Phases 50 / 50. Damage 11.

- **Recruit pressure: Levy (P4)** and **It eats the Haul**. Levy: "Next turn: Kevin's minions cost 4." Opening: Gold
  Mike sends Kevin counts double, up to 4. When the Shop ends, the Tithe also takes the highest-rarity Haul card
  neither of you took (Appetite 4 rarity, max 3 per phase) into its own Link row; its Links fire for its side. Answer:
  "Take the Handshake together, and Mike covers the Levy."
- **Phase 1, Collection.** Each front: The Tithe 8/40 and 4 Collectors 5/5.
- **Phase 2, Repossession.** At Start of Combat it borrows the Link from each player that fired most last fight. You
  fight your own loot. **Refund:** when the Tithe dies, every card it took comes back levelled up for the player who
  passed it, and every borrowed Link returns one level higher.
- **Intent cycle:** Levy, Audit, Lien ("If this front wins, you have 3 less Gold next turn."), Foreclose.
- **Themed Wild:** Joint Account, Market Share, **Tax Return** (Rare Burst: "When the Tithe takes a card this turn, you
  each gain 3 Gold next turn.").
- **Drops:** hero power **Goldspring**; mode rune **Rune of the Rebate**; an ASCENT Epic rune; Tax Return; boss card
  **The Grand Tithe**.
- **Loss line:** "It held your Swap Meet. You passed it on turn 14."

### 13.8 Act 2. AUREX AND NOCTRA, THE TWIN DRAGONS

*Exam: **move together.** "Two dragons. Two fronts. They will trade."* Phases 50 / 50 / 50. Damage 11.

- **Recruit pressure: Sun and Moon (P5).** Telegraph: "Next turn: Scorched on Kevin's Shop, Chilled on Mike's." Answer:
  "Both buy a Dragon. Both Shops flip to +3." Presentation: Kevin's Shop row takes a warm tint pill, Mike's a cold one;
  the moment both Dragons are bought, both pills flip gold at once on both screens with one chord.
- **Phase 1.** Front A: Aurex 12/40 Ward, "Start of Combat: give your units +3/+3", and 3 Sunscales. Front B: Noctra 14/36
  Flurry and 3 Moonscales. **Rule break: Mirrored Roars** (their Start of Combat and Rally effects also fire on the other
  front at the Twin slot).
- **Phase 2, The Trade.** **Mid-air Swap** on step 8: they switch fronts, keeping their damage taken.
- **Phase 3, Eclipse.** They merge into Eclipse 30/90 on the leading front; the other front must finish fast and
  **Charge** in.
- **Themed Wild:** Mirror Strike, Swap Meet, **Dragon's Pact** (Legendary, Both must take: "Your Dragons' Shouts
  trigger twice. Your partner's too." Alone: "Your first Dragon Shout each turn triggers twice.").
- **Drops:** hero powers **Shared Pulse** or **Empowering Vines**; mode rune **Rune of Sun and Moon**; an ASCENT Epic
  rune; boss card **Aurex and Noctra**.
- **Loss line:** "Eclipse lived because the other front lost. Charge into it."

### 13.9 Act 3. VOLTARA, THE STORM BETWEEN

*Exam: **split duties.** "She lives in your Links."* Phases 70 / 70 / 60. Damage 15.

- **Recruit pressure: Silence (P6).** Telegraph: "Next turn: Silence on Kevin. His Tag In is cut." Answer: "Mike casts 2
  spells. One on Kevin's minion makes his next hero power free." Presentation: a seal stamps over Kevin's hero power
  buttons and Link tile; on Mike's screen a "2 spells" counter sits on Kevin's strip portrait and ticks as he casts.
- **Phase 1, Static.** **Rule break: Sever.** Her signature cuts your two highest-level Links on the phase's first turn.
- **Phase 2, Lightning Rod.** "Each time a Link crosses between your fronts, it deals 2 damage to Voltara's bar."
- **Phase 3, Overload.** "Every Link fires twice. So do mine." Her Arcs copy every Rally Link the pair owns.
- **Themed Wild:** Twin Cast, Storm Bridge, **Grounding Rod** (Epic Link: "Your Links cannot be cut. Each cut aimed at
  you gives your board +4/+4 instead.").
- **Drops:** hero power **Arc**; mode rune **Rune of the Lightning Rod**; an ASCENT Epic rune; boss card **Voltara**.
- **Loss line:** "Phase 2 needed 35 crossings. You made 18."

### 13.10 Act 3. VEL, THE MIRROR UNWRITTEN

*Exam: **swap roles.** "You will fight your friend. Then you will fight yourselves."* Phases 70 / 70 / 60. Damage 15.

- **Recruit pressure: Mirror Shop (P7) and Doubt.** Telegraph: "Next turn: Mike's Shop shows Kevin's Shop. Kevin cannot
  buy." Answer: "Mike shops for Kevin. Tagged Hand Offs are free." Phase 2 adds **Doubt** on each player's best Shout
  or Echo minion (K6); the answer is a same-tribe Twin. Presentation: Mike's Shop row turns pale with Kevin's portrait
  pill; each card Mike buys for Kevin flies to the strip and lands in Kevin's hand on his screen.
- **Phase 1, The Swap.** Each front is a copy of the partner's board as it locks, Shared minion included. Lock order
  matters.
- **Phase 2, Turned Links.** Each front is a copy of your own board; Vel's copies of both players' Links fire into your
  partner's real fight.
- **Phase 3, Fused Reflection (forced Fusion).** You are Fused (10.5); Vel is your Fused board as you locked it.
- **Themed Wild:** Copycat, Kin of Two Kinds, **Unwrite** (Legendary Burst: "Next combat: the enemy copy of your slot 1
  minion starts dead.").
- **Drops:** hero power **Copy Machine**; mode rune **Rune of the Glass**; an ASCENT Epic rune; boss card **Vel**.
- **Loss line:** "Vel's copy of your cannon came through Swap Meet. Unwrite was offered on turn 21."

### 13.11 Act 3. THE HUNGERING STAR

*Exam: **route through each other.** "It grows in your Shop. Every buff you give, it eats."* Phases 70 / 70 / 60.
Damage 15. Built on the Starform pinning rule; works in any set.

- **Recruit pressure: Gravity (P8)** and the **Star Seed**. Gravity: "Next turn: Gravity 2 on Kevin's Shop." Opening:
  his lost cards show in Mike's Shop tagged "Kevin's", and their Hand Off is free. A boss Star Seed sits pinned in both
  Shops and eats every Shop buff either of you makes. It can be bought for 8 Gold minus 1 per Refresh: one partner
  buffs, the other buys. Answer: "Mike buys Kevin's cards. Kevin buys the Seed."
- **Phase 2, Supernova.** "Supernova in 3 turns: 40 damage split among each board." Each Seed bought pushes it back 1.
- **Phase 3, Event Horizon.** "Start of Combat: it pulls your slot 1 minion into itself. It fights for the Star, then
  comes home."
- **Themed Wild:** Market Share, Golden Gift, **Shared Orbit** (Epic Link: "When you buy a Star Seed, its stats are also
  given to your slot 1 minion's Twin.").
- **Drops:** hero power **Gravity Well**; mode rune **Rune of the Seed**; an ASCENT Epic rune; boss card **The Hungering
  Star**.
- **Loss line:** "The Seeds reached 60/60. One of you buffs, the other buys."

### 13.12 Juggernauts (elites, one turn, one shared bar, win = pick 2 and a drop)

| Juggernaut | Act | Each front | Twist | Recruit pressure | Drops |
|---|---|---|---|---|---|
| **The Twin Sentinels** | 1 | Sentinel 4/18, 2 Squires | "If one Sentinel dies, the other gains Resilient Ward." | Tier-up seesaw (P10) | **Aegis**; boss card **Sentinel Pair** |
| **Gob and Gobbo** | 1 | Gob 5/20, 3 Goblins | "Rally: summon a Goblin on the other front." | Junk (P9) | **Displace**; boss card **Gob and Gobbo** |
| **The Glasswing** | 2 | Glasswing 12/12 Stealth Execute, 2 Shards 4/6 Taunt | Ward on the carry, or many bodies. | none | **Blade Mastery**; boss card **Glasswing** |
| **Grubb the Spellhater** | 2 | Grubb 8/24, 3 guards 5/5 | "+2/+2 for each spell either of you cast this turn." | Cast it through me (P11) | **Spell Amplify**; boss card **Grubb** |
| **The Linkbreaker** | 3 | Breaker 14/40, 3 Severers 6/10 | "Each Severer cuts one of your Links for this fight. Kill it to restore the Link." **Claim** intent: "Next fight: the Shared minion's copy on Kevin's front fights for the enemy." | Share the broken Link (P12) | **Tether**; boss card **The Linkbreaker** |
| **Colossus of Counts** | 3 | Colossus 0/90 Taunt, 2 Gearguards 8/8 | "Countdown 4, ticks when attacked: at 0 it deals 30 split." | Your spending winds my clock back (P13) | **All Hands**; boss card **Colossus** |

### 13.13 The finale. THE SEVEN-CROWNED ENGINE

*Exam: **everything at once.** "Seven heads. Cut one and two grow. Only a Link burns the stump."* Three crowns. Damage
18. Tier 7 opens in the Shop for the finale.

- **Recruit pressure: the Heavy Crown (P14).** One player wears it each turn: their Shop clock is 20 s shorter, and
  they get +3/+3 on slot 1 for each turn worn. Either player may **Take** it from the other (free). Answer: "Pass it to
  whoever needs less time."
- **The heads.** Seven heads, one per ASCENT trigger, split 4 and 3 across the fronts: Echo Head 12/30 ("Echo: summon
  two Echo Heads 6/15."), Rally Head 14/26 Flurry ("Rally: the other heads gain +2 Attack."), Shout Head 10/30 ("Start of
  Combat: trigger every Start of Combat effect on its side again."), Ward Head 8/40 Resilient Ward ("When its Ward
  breaks, give a random head Ward."), Rise Head 12/24 Rise ("Rise: returns with full stats."), Avenge Head 10/30
  ("Avenge (2): the heads gain +4/+4."), Pummel Head 16/30 ("Pummel (30): deal 30 split among enemies.").
- **Rule break: Regrowth.** When a head dies, **two copies grow at its slot**, **unless it was killed by a cross
  effect** (a Link, a Graft, a charger, a Both boards effect, the Shared minion's copy): then it is **CAUTERISED** and
  stays dead.
- **Crown 1 (bar 90, Tandem):** all seven heads. **Crown 2 (bar 90):** the four heads with most kills return Gilded,
  plus **the Pendulum** 20/40, Immune while attacking, which takes every third step on both fronts. **Crown 3, ASCENDANT
  (bar 120, forced Fusion):** one board against the **Titan**: seven Limbs, one ASCENT keyword each, at most 60 damage
  per fight (printed **Immune past 60**).
- **Drops:** crowns 1 and 2 roll the **One Crown** boss card for crown 3; the end screen awards a cosmetic title.
- **Victory:** the end screen draws both players' Links wired together, the run's crossing count ("1,214 Links
  crossed"), the best Combo, the best LINK count, and each hero's finished power row.

---

## 14. NEW: Drops and boss cards

Owner direction: bosses and elites drop random loot, with a chance to drop **the enemy itself as a playable card**,
and drops include runes.

### 14.1 The drop roll

- **When:** a Juggernaut dies, a boss phase breaks (small drop), an act boss dies (big drop).
- **Seeded:** `fork(runSeed, 'drop', encounter, seat)` per player, plus `fork(runSeed, 'drop', encounter, 'pair')` for
  the shared roll. Deterministic, server-side, replayable.
- **Each player rolls their own drops** from the encounter's table: 1 from a Juggernaut, 1 from a phase break, 2 from an
  act boss. Your drops are yours; your partner sees what you got.
- **One shared roll for the boss card.** Juggernaut 15%, act boss 25% (Act 3: 35%), +5% per Mayhem level. **Pity:** if
  the pair has no boss card by the Act 2 boss, that boss drops its card for sure.

### 14.2 The drop table (per encounter)

| Drop | Weight | What it is |
|---|---|---|
| **Hero power** (themed) | 30% (an act boss's first drop is always one) | the encounter's hero power (15.4), as a hero power card |
| **Mode rune** (themed) | 20% | the encounter's own rune (14.4), straight into your rune row, free |
| **ASCENT rune** | 20% | a normal rune from the pinned set's pool (Basic in Act 1, Epic from Act 2), with the board-fit filter and duplicate rule |
| **Themed loot** | 20% | a card from the boss's themed Wild list |
| **Gold and rarity** | 10% | +3 Gold next turn and +1 step on your Handshake |

Rarity: each drop rolls a tier (Rare, Epic, Legendary) that sets its numbers where it has them (a Legendary hero power
card arrives at level II).

### 14.3 Boss cards (one for every boss and elite)

A boss card is the enemy as a playable minion. **It belongs to both of you and lives only in the Shared Slot.** It
arrives in the hand of the player with the Shared Slot pick next turn and can only be played into the Shared Slot (the
normal pick rules then apply). Either player may sell it; the Gold splits. It wears a "Boss" or "Elite" top pill and
the enemy's own art. Its effects are big on purpose and echo its fight.

| Boss card | Stats | Text |
|---|---|---|
| **Mother Hollow** | 6/14 | "Start of Combat: split into two Halves with half her stats, one on each side of slot 7. Echo: if both Halves died within 3 steps, return whole with Rebirth." |
| **The Gobbler King** | 4/10 | "End of Turn: eat the right-most minion in each of your Shops and gain its stats permanently. Echo: spit out a Gilded combat copy of everything he ate this game, split across both fronts (up to 6)." |
| **Jormun** | 10/30 | "This is one body in both fights. Rally: summon a 4/4 Scale on the other front." |
| **The Grand Tithe** | 5/20 | "Whenever either of you passes a Haul card, gain +3/+3 permanently. Start of Combat: your minions gain +1/+1 for each Link you two own." |
| **Aurex and Noctra** | 12/12 Dragon | "On your front: Start of Combat: give your minions +3/+3. On your partner's front: Flurry. On step 8, they trade places." |
| **Voltara** | 8/24 | "Whenever a Link crosses between your fronts, deal 2 damage to a random enemy on each front." |
| **Vel** | 1/1 | "Start of Combat: become a copy of the strongest minion on the other front, Grafts included." |
| **The Hungering Star** | 6/6 | "Whenever a Shop minion gains stats in either Shop, this gains the same permanently." |
| **One Crown** (finale) | 10/10 | "Echo: summon two copies of this with half its stats (up to 6 per front)." |
| **Sentinel Pair** | 4/12 | "Taunt. Ward. When one copy loses its Ward, the other copy gains Resilient Ward." |
| **Gob and Gobbo** | 5/10 | "Rally: summon a 3/3 Goblin on the other front." |
| **Glasswing** | 8/4 | "Stealth. Execute. Slaughter: gain Stealth again." |
| **Grubb** | 6/12 | "Whenever either of you casts a spell, gain +2/+2 permanently." |
| **The Linkbreaker** | 10/20 | "Start of Combat: enemies on both fronts lose Ward, Taunt and Rise." |
| **Colossus** | 0/60 | "Taunt. Countdown 4, ticks when attacked: at 0, deal 30 damage split among enemies on both fronts." |

### 14.4 Mode runes (one per boss; drops only)

| Rune | Text |
|---|---|
| **Rune of the Brood** | "Your first Curse each turn is Split for free." |
| **Rune of the Belly** | "End of Turn: your right-most minion gains the stats of the cheapest minion in your Shop." |
| **Rune of the Coil** | "Start of Combat: your slot 1 minion and its Twin gain +0/+6." |
| **Rune of the Rebate** | "When you send Gold, your partner gets 1 more. Once a turn." |
| **Rune of Sun and Moon** | "Start of Combat: if you and your partner have the same top tribe, both slot 1 minions gain +5/+5." |
| **Rune of the Lightning Rod** | "Your first Link to cross each combat fires twice." |
| **Rune of the Glass** | "Start of Combat: summon a 1/1 copy of your partner's slot 1 minion. It gains its keywords." |
| **Rune of the Seed** | "Your Shop's right-most minion gains +2/+2 each turn it stays." |

### 14.5 How a drop is presented

- **The burst.** The defeated enemy's portrait cracks and becomes a chest, using the existing account crate reveal
  (the anticipation shake, the charge, the burst, the reward rising out of the light), shown inline over the arena,
  not as a modal, at 1.4x speed.
- **The rarity reveal** uses the existing frame gem colours and one rarity sting each.
- **Your drops** rise in the centre of your screen; **your partner's** rise smaller over their lane, so you see them
  too ("Mike found: Rune of Fury").
- **A boss card** is a shared moment: both screens show one big reveal with the enemy's art turning into a card, the
  "Boss card!" banner and the announcer line; it then flies to the hand of the next picker.

---

## 15. NEW: Building your hero (you start with no hero power)

Owner direction: "building your hero through the game, like finding hero power(s) from playing, starting with none."

### 15.1 What a hero is at the start

- **A hero is a portrait.** You pick any hero portrait you own (the existing Hero Select screen, 20 s, without powers
  or Armor lines). It is cosmetic.
- **Everyone starts the same:** 40 Health, 10 Armor, 3 Gold, **no hero power**, the starter Link pick (6.2).
- The hero you **finish** with is the one you built: the end screen shows your power row as "your hero".

### 15.2 Slots, upgrades and swaps

| Rule | Detail |
|---|---|
| **Slots** | 3 hero power slots beside your portrait (the existing hero power button, repeated, as Equipment already adds a second slot). Slot 1 is open from turn 1. Slot 2 opens when the Act 1 boss dies, slot 3 when the Act 2 boss dies. |
| **Use** | Each power keeps its ASCENT rules: its Gold cost and its uses per turn. Passive powers just work. |
| **Upgrades** | Finding a power you already have raises it a level (I to III), the duplicate rule. Each level prints its numbers: lower cost, bigger number, or one more use. |
| **Swaps** | When your slots are full, a new power asks you to **Melt** one (the same verb as Links): the melted power is gone, and the new one **enters at level II**. |
| **First power** | Turn 3's Haul Wild is always a hero power card. So nobody plays more than two turns without one. |

### 15.3 Where powers come from

- **Drops** (14): every act boss's first drop, 30% of other drops.
- **The Haul:** the turn 3 Wild, and 10% of Wild slots after that.
- **The Campfire:** a new action, **Study**: Discover a hero power from three that fit your board.
- **Vaults** at 100% put a hero power in the 6-card row.

### 15.4 The 20 findable hero powers

ASCENT powers reuse their `HeroPowerKind` and numbers where they fit. Mode-only powers are marked NEW.

| # | Power | Text (level I) | Levels | Kind | Source |
|---|---|---|---|---|---|
| H1 | **Aegis** | "3 Gold: give a minion Ward, then your Warded minions gain +5 Attack. It may be your partner's minion." | II: 2 Gold. III: +8 Attack. | `grantWard` (Warden) | The Twin Sentinels |
| H2 | **Masterwork** | "Once: Gild a friendly minion. Recharges after you two spend 75 Gold." | II: 60 Gold. III: 45 Gold. | `gild` (Indy) | The Gobbler King |
| H3 | **Pulse** | "2 Gold: trigger a friendly minion's Shout. It may be your partner's minion." | II: 1 Gold. III: twice a turn. | `replayBattlecry` (Auctioneer) | Haul (turn 3 Wild pool), Campfire |
| H4 | **Undying** | "2 Gold: give a minion Rise next combat. It may be your partner's minion." | II: 1 Gold. III: Rebirth. | `grantReborn` (Lord of the Risen) | Haul, Campfire |
| H5 | **Goldspring** | "3 Gold: gain +1 max Gold permanently." | II: and your partner too. III: 2 Gold. | `gainMaxMana` (Nadja) | The Grand Tithe |
| H6 | **Reclaim** | "Start of Combat: destroy a marked minion and summon a copy. Its Echo triggers." | II: the copy has +3/+3. III: mark two. | `resummon` (Soren) | Jormun |
| H7 | **Copy Machine** | "Once: get an exact copy of a friendly minion. It may be your partner's minion." | II: twice a run. III: three times. | Xerox's power | Vel |
| H8 | **Soulkeeper** | "2 Gold: Discover a minion that died last combat, on either front." | II: 1 Gold. III: it is Gilded. | Underdweller's power | Haul, Campfire |
| H9 | **All Hands** | "3 Gold: trigger every End of Turn effect on your board now." | II: on both boards. III: 2 Gold. | `replayAllEndOfTurn` | Colossus of Counts |
| H10 | **Displace** | "1 Gold: swap a friendly minion with a random Shop minion." | II: you choose the Shop minion. III: free once a turn. | `displace` (Darah) | Gob and Gobbo |
| H11 | **Gildcrafter** | "3 Gold, 3 times a run: complete a triple from 2 copies." | II: 4 times. III: 2 Gold. | `gildcrafter` | Haul (Legendary Wild) |
| H12 | **Blade Mastery** | "Passive: your attacking minions have +3 Attack. Improves every 8 attacks." | II: +4. III: on both fronts. | Gorun's power | The Glasswing |
| H13 | **Empowering Vines** | "Passive: your combat summons have +2/+3 and Taunt." | II: +3/+4. III: your partner's too. | Rayse's power | Aurex and Noctra |
| H14 | **Spell Amplify** | "Passive: your stat spells give +1/+1 more. Improves every 10 spells cast." | II: +2/+2. III: your partner's too. | `spellAmplify` | Grubb the Spellhater |
| H15 | **Cleanser** (NEW) | "1 Gold: end one Curse on either board." | II: free once a turn. III: also gives the minion +2/+2. | NEW kind (Curse cleanse, ally scope) | Mother Hollow, Campfire |
| H16 | **Tether** (NEW, co-op) | "2 Gold: choose your minion. Its Twin gains its keywords until your next fight ends." | II: and its Attack. III: both ways. | NEW kind (keyword copy to Twin) | The Linkbreaker |
| H17 | **Rally Cry** (NEW, co-op) | "3 Gold: next fight, your slot 1 minion and its Twin Rally at Start of Combat." | II: slots 1 and 2. III: 2 Gold. | NEW, built on Rune of Rallying's path | Jormun |
| H18 | **Shared Pulse** (NEW, co-op) | "3 Gold: trigger a minion's Shout on your board and its Twin's Shout on your partner's." | II: 2 Gold. III: twice a turn. | `replayBattlecry` x2, cross | Aurex and Noctra |
| H19 | **Arc** (NEW, co-op) | "2 Gold: choose one of your Links. It fires twice next fight." | II: 1 Gold. III: two Links. | NEW kind (Link multiplier) | Voltara |
| H20 | **Gravity Well** (NEW, co-op) | "2 Gold: take a minion from your partner's Shop into your hand. They gain 2 Gold." | II: 1 Gold. III: they gain 3. | NEW kind (cross-Shop buy) | The Hungering Star |

Co-op powers (H1, H3, H4, H7, H15 to H20) are also the cleanest answers to recruit pressure: Cleanser ends a Curse on
your partner's board, Gravity Well routes around Gravity, Shared Pulse thaws Coiled minions on both boards.

---

## 16. Mode-only cards and keywords

These never enter normal ASCENT pools. Link minions join this mode's shared Shop pool; spells come through the Haul.

### 16.1 New keywords (2)

| Term | Kind | Rule (player text) | Engine |
|---|---|---|---|
| **Charge:** | trigger word | "Charge: when this crosses into your partner's fight." | arrival hook in the Tandem engine (NEW) |
| **Fused** | state | "Made of two Twins. Has both bodies, all keywords and all triggers." | Fusion transform (NEW) |

v2's **Assist:** and **Baton:** are gone: their cards now say it in plain text and with Echo.

### 16.2 Link minions in the shared Shop pool (15)

| Tier | Card | Text | Built on |
|---|---|---|---|
| 1 | **Pen Pal** 2/2 | "Shout: give its Twin +2/+1." | Shout, cross target |
| 1 | **Signal Kobold** 2/3 Kobold | "Shout: cast a Ruby on its Twin." | Shout, Rubies, ally scope |
| 2 | **Shield Mate** 2/4 | "Taunt. When its Twin attacks, gain Ward. Once per combat." | Taunt, Ward, partner attack watcher |
| 2 | **Courier Hound** 3/3 Beast | "Echo: your partner gets a copy of the last card they sold." | Echo, card to hand |
| 3 | **Echo Pair** 4/3 Beast | "Echo: its Twin gains this minion's Echo this combat." | Echo grant |
| 3 | **Brewmates** 3/5 Dwarf | "End of Turn: give its Twin +1/+1 for each card your partner played this turn. (Now +0/+0.)" | End of Turn, team watcher, live text |
| 3 | **Tag Team Imp** 4/4 Demon | "Rally: summon a 2/2 Imp at its Twin slot on your partner's front." | Rally, cross summon |
| 3 | **Hinge** 3/4 | "While in the Shared Slot: Rally: give its neighbour +2/+2 on this front and on your partner's front." | Rally, Shared Slot (9.9 S6) |
| 4 | **Bridgewyrm** 5/5 Dragon | "Shout: your partner's Dragons gain +2/+2." | Shout, Dragon synergy |
| 4 | **Lantern Twin** 5/4 | "Rise. Charge: give the minions you join +3/+3." | Rise, Charge |
| 4 | **Coinbound** 4/4 Dwarf | "When your partner spends 4 Gold, gain +2/+2. (Now 2 left.)" | Gold-spent watcher, live text |
| 5 | **Mirror Knight** 6/6 | "Start of Combat: copy its Twin's keywords." | Start of Combat keyword grant |
| 5 | **Herald of Two** 5/7 | "Start of Combat: give its Twin +2/+2 for each Link level you and your partner own. (Now 14: +28/+28.)" | Start of Combat, live scaler |
| 6 | **Storm Conduit** 7/7 | "Flurry. Whenever a Link crosses from your board, gain +1/+1 permanently. (Now +0/+0.)" | Link-crossing watcher |
| 6 | **Grand Duet** 10/10 | "Your Links' caps are 2 higher. Your partner's too." | Link layer |

Tier 7 (finale only): **The Linkmaker** 10/10, "Shout: level up one of your Links and one of your partner's."

### 16.3 Spells (7, Haul-only)

| Spell | Cost | Text |
|---|---|---|
| **Lifeline** | 1 | "Next combat: if your partner's front is lost before yours ends, your 2 left-most minions Charge at once." |
| **Gap Bolt** | 2 | "Next combat: Start of Combat: deal 8 damage to an enemy on your partner's front." |
| **Pass the Torch** | 0 | "Move a minion's Graft onto its Twin." |
| **Mirror Coin** | 1 | "Cast a copy of the last spell your partner cast this turn. (Now Pouring Ale.)" |
| **Tug of War** | 2 | "Swap a minion with its Twin until the end of next combat." |
| **Reunion** | 3 | "Your Ghost partner returns at 10 Health." (Only offered while your partner is a Ghost.) |
| **Shared Banner** | 2 | (8.2 B4) |

---

## 17. The Presentation Bible

Owner bar: "it must be built so incredibly well, that i could pitch this to blizzard and they would see the vision of
the mode." This section is the contract for how every mechanic looks, sounds and reads. **The law: nothing crosses
between boards without being seen on both screens.** Every cross effect has four parts, **source flash, travel,
landing, name chip**, plus **live text** on both boards. No exceptions, bosses included.

### 17.1 The screen (two-player view)

Everything below is existing ASCENT UI and painted art, rearranged. New painted pieces are marked (art owed).

**Shop phase (Kevin's screen; Mike's is the mirror, with Kevin in the lane).**

```
+--------------------------------------------------------------------------------------------+
| [boss ribbon: intent card | WHAT / WHO / ANSWER | Wrath pill]            [turn clock]  [Esc]|
+--------------------------------------------------------------------------------------------+
| HAUL ROW  [ Yours ][ Pull ][ HANDSHAKE (K)(M) ][ Wild ]   [Refresh]  [+1 card]            |
| SHOP ROW  [ m ][ m ][ m ][ m ][ m ]  [spell]   [Refresh][Freeze][Tier up]                 |
|                                                                                 |  ALLY   |
| YOUR BOARD  [1][2][3][4][5][6] ||[7 SHARED]|| <- the gold gap edge (painted)   |  STRIP  |
|             Twin guides on hover -------------------------------------------->  | Mike:   |
|                                   "Kevin picks" pill under slot 7                | 7 tiles |
| HAND  [ ][ ][ ][ ][ ]                                                            | Gold    |
|                                                                                 | hand  # |
| [portrait + Health/Armor] [power 1][power 2][power 3] [Equipment]               | Links   |
| [rune row: runes | Links I-III]   [Harmony gauge: Echo 6/8 | Shout 3/4 ...]     | Curses  |
| [Health: Kevin] [Health: Mike]                                                   | lock    |
+--------------------------------------------------------------------------------------------+
```

- **The ally strip** (right) is the lobby scouting-board component at reduced scale: Mike's 7 board tiles (tile 7 is
  the same Shared card), his Gold, hand count, lock state, Link tiles, hero power icons and Curse pills, plus a "Shop"
  chip for his Shop-level effects. Drag targets for Hand Off, Send Gold, Take and ally-scope casts live here.
- **The Shared Slot** is slot 7, at the end of your board touching the gap edge, in the "Shared" frame pill variant.
- **The Haul row** sits above the Shop row (the Runeforge offer-row component inline). The Handshake frame shows both
  portraits' chips live.

**Combat (Kevin's screen).**

```
+--------------------------------------------------------------------------------------------+
| [boss bar(s) across the top, one shared bar when the boss is one body]   [LINK x9]         |
+-----------------------------------------------------------------------+--------------------+
|                ENEMY FRONT (Kevin)                                    |  MINI ARENA (Mike) |
|      [e1][e2][e3][e4][e5][e6][e7]                                     |  enemy 7 tiles     |
|                                                                       |  (small lunges)    |
|      [1][2][3][4][5][6][7 SHARED copy]   ||gap||  bolts exit/enter -> |  Mike's 7 tiles    |
|                                                                       |  tile 7 = Shared   |
|  [Leads pill]   banked casts row (Start of Combat, "x2 fronts")       |  [Leads pill]      |
+-----------------------------------------------------------------------+--------------------+
| [portrait] [Curse pills] [chips stack: "Mike's Tag In: Karwind attacks"]   [recap after]   |
+--------------------------------------------------------------------------------------------+
```

- **One Pixi arena on screen, always.** The partner's fight is the DOM mini arena (memoized tiles, transform-only
  lunges). Peek (hold Tab) swaps in the Versus spectator view of the partner's real screen.
- **The gap** is a thin painted gold edge (art owed) between your arena and the lane. Player text never names it.

### 17.2 Visual grammar

**Colour: who it belongs to.**

| Colour | Means | Where |
|---|---|---|
| **Warm gold** | ally, the pair, "this is ours" | the gap edge, Shared Slot pill, Twin guides, Handshake chips, ally bolts' outer rim, CHARGE |
| **The keyword's own ASCENT colour** | what kind of effect | the bolt's core (an Echo bolt is the Echo colour, a Rally bolt the Rally colour), Harmony pills |
| **Red** | enemy | enemy frames, enemy crossings, lost-front damage |
| **Black and white** | boss | boss crossings, boss telegraphs, boss touches on the Shop |
| **Violet** | Curse | curse pills, curse frame, curse wisps when they spread or move |
| **Gold flip** | a Curse turned good, a level-up, a Gild | the one-shot shine that turns violet to gold |

**Shape: what kind of thing it is.**

| Shape | Means | Example |
|---|---|---|
| **Bolt** (a line with a head) | a buff, keyword or trigger crossing | Echo Chamber, Lend a Shield |
| **Projectile** (a round head, an impact) | damage crossing | Crossfire, Overkill Express |
| **Cross** (the whole card moves) | a minion changing fronts | Ferry, Charge, Swap Meet, boss swaps |
| **Coin** | Gold | Send Gold, Joint Account |
| **Stamp** | a permanent change | Slaughterhouse, Golden Gift, a hero power level-up |
| **Wisp** (thin, slow, violet) | a Curse moving | Spreads, Take, Split |
| **Seal** (a stamp over a button) | something locked or silenced | Silence, the Shared Slot lock |
| **Pill pop** | a lasting state starts | "Both boards", "Shared", curse pill, "Leads" |

### 17.3 Feel rules

- **Readability under chaos.**
  - **Max 12 live bolts** at once (pooled sprites). Past that, **bundling**: if more than 3 crossings would start inside
    250 ms they become one **Link Surge**: one thicker bolt per keyword (max 6), an "x7" counter on the target, one
    combined chip ("Kevin's Links: 7 effects on Mike's board"). Consequences still land at landing, with one buff pop per
    target.
  - **Priority** when beats collide (higher plays first, lower bundles or waits): boss rule breaks and phase breaks,
    then Curses landing, then the Charge, then the Shared Slot, then Links, then plain buffs.
  - **One chip stack**, max 3 visible, newest on top, 1.4 s each.
  - **Consequence at landing, never earlier.** A number never changes before its bolt arrives.
  - **Attribution grammar, one form:** `<Owner>'s <Source>: <what> on <whom>`. Your own name drops on your screen.
    "Kevin's Wolvie: Rise on Mike's Hound." "Vel's copy of Kevin's Echo Chamber: Echo on Mike's Grim."
- **The 160 fps bar.** Transform and opacity only. No looping paint animations (`box-shadow`, `filter`,
  `background`): a breathing glow is opacity on a `::before` over a static image (the `kwglow` pattern). No per-frame
  layout reads: gap and tile rects are cached once per fight (the `insertRectsRef` pattern). Lane tiles use the `Unit`
  memo pattern. Fan-outs draw one sprite per side, never one per tile. Measured on the prod build with an Act 3 fixture
  (30 crossings per step) and the finale's Regrowth: p95 and p99 frame time against 6.25 ms, frames over budget
  reported.
- **Sound grammar.** Every cross effect has one short cue, pitched by keyword family; bundles play one cue. Big moments
  use the announcer, under its once-per-event and cooldown rules. Nothing loops except music.

### 17.4 Storyboards (every mechanic)

Each storyboard: **Trigger**, **Own screen**, **Partner's screen**, **Animation and timing**, **Attribution**,
**Audio**, and **Reuse** (existing ASCENT pieces) vs NEW.

#### SB1. The Haul reveal and pick
- **Trigger:** Start of Turn, after Gold refills.
- **Own screen:** four frames slide down into the Haul row, left to right, 80 ms apart; each lands with its rarity gem
  lit. Taking one: the card lifts, flies to its home (rune row, hand, a minion with the targeting arrow, a banked pill)
  and stamps.
- **Partner's screen:** nothing on reveal (private). On your pick: your Link tile on their strip plays a stamp, chip
  "Kevin took Echo Chamber".
- **Animation:** slide-in 400 ms (transform), sting per card; pick flight 300 ms, stamp 200 ms.
- **Audio:** one rarity sting per card (crate stings, quieter); a soft "take" thunk.
- **Reuse:** Runeforge offer row, rarity gems, crate stings, stamp beat. **NEW:** `haulReveal`, `haulTake` beats.

#### SB2. The Handshake (both take it)
- **Trigger:** the second player takes the shared card in the same turn.
- **Own screen:** your portrait chip is already on the card; your partner's chip snaps on beside it (300 ms). The card
  flips from level I to II with a gold stamp, "Both ways" arrows appear on its tile, banner "Handshake!".
- **Partner's screen:** the mirror, same frame time (server-ordered).
- **Animation:** chip snap 300 ms, flip 250 ms, banner 1 s, all one-shot.
- **Attribution:** "Handshake! Ferry is a Twin Link."
- **Audio:** **the Handshake chord** (NEW): two notes, one per player, resolving into one. Announcer: "Handshake!"
- **Reuse:** stamp beat, banner, announcer. **NEW:** chord, chip snap.

#### SB3. A Twin Link firing (combat)
- **Trigger:** e.g. Kevin's Wolvie dies; Echo Chamber fires.
- **Own screen:** Wolvie's Echo beat plays; a keyword-colour rim flashes on it; a bolt leaves the card, runs to the gap
  and on into lane tile 2, which pulses and ticks its numbers.
- **Partner's screen:** a bolt enters through the gap edge and lands on Mike's real slot 2 Hound; the Hound plays its
  own Echo beat.
- **Animation:** `linkOut` 150 ms, travel 300 ms (one step), `linkIn` 250 ms. Landing at the target's next step.
- **Attribution:** Kevin's: "Echo Chamber: Mike's Hound". Mike's: "Kevin's Echo Chamber: Echo on your Hound".
- **Audio:** an Echo-family cue on leave, a softer one on land.
- **Reuse:** Echo beat, buff/summon beats, beat label pill. **NEW:** bolt sprite, `linkOut`/`linkIn`.

#### SB4. Both boards for a turn (the Drakko moment)
- **Trigger:** Kevin plays Drakko under Shared Shout.
- **Own screen:** Drakko's play beat; a Shout-colour rim; the **"Both boards"** pill pops onto it; one gold bolt runs
  from Drakko to the gap. Mike's Shout cards in Kevin's strip tile show nothing (Mike's hand is private).
- **Partner's screen:** a bolt enters from the strip and settles on Kevin's Drakko tile, which pops its "Both boards"
  pill. Every Shout card in Mike's hand gains "x2 (Kevin's Drakko)". When Mike plays a Shout: a short bolt from the
  Drakko tile to Mike's card, then his Shout plays twice with the "x2" badge.
- **Animation:** pill pop 200 ms, bolt 300 ms; per-Shout bolt 200 ms before the Shout beat.
- **Attribution:** "Kevin's Drakko: your Shouts trigger twice." End: "Both boards ended" (at settle).
- **Audio:** Drakko's own play sound plus a rising "share" shimmer (NEW, one-shot).
- **Reuse:** play beat, multiplier badge, Shout pop. **NEW:** "Both boards" pill, `bothBoards` beat.

#### SB5. The Shared Slot: swap in
- **Trigger:** the picker drags a minion into slot 7.
- **Own screen:** the card lifts and slides into slot 7 with the summon beat; the owner pip appears; a Shout from hand
  plays its Shout beat on your board.
- **Partner's screen:** the card enters from the strip, slides into their slot 7 with the summon beat, the same owner
  pip; the same Shout beat plays on their board (it works on both boards).
- **Animation:** slide 350 ms, summon 250 ms; the two screens are frame-synced by the team bus order.
- **Attribution:** "Kevin put Drakko in the Shared Slot."
- **Audio:** the existing play sound plus a low gold "door" tone (NEW).
- **Reuse:** summon beat, play beat. **NEW:** Shared frame pill, door tone.

#### SB6. The Shared Slot: swap out, offer, lock
- **Swap out:** the old card slides out of slot 7 toward its owner (onto their board, or into the strip on the other
  screen) 300 ms; the new card slides in 350 ms. Chip: "Mike swapped Drakko for Karwind (1 Gold)". A coin hops from
  the payer's Gold pill.
- **Offer:** on the picker's screen the offered card hovers over slot 7 at 60% opacity with Accept; on the offerer's an
  "Offered" pill. Accept plays the swap.
- **Lock:** the slot takes the frozen tint (one-shot 200 ms) and a seal stamp, pill "Locked by Mike", on both.
- **Audio:** existing sell/buy whoosh for the swap; the existing freeze sound for the lock.

#### SB7. The Shared Slot fighting on both fronts
- **Trigger:** Start of Combat.
- **Own screen:** the Twin guides draw; slot 7's guide is gold and runs into lane tile 7. Your copy fights in your
  arena; whenever the other copy acts on Mike's front, lane tile 7 pulses. A Rally on each front plays on each copy.
- **Partner's screen:** the mirror.
- **Settle:** gains from the partner's front fly from lane tile 7 into your Shared card with one stamp, "+6/+6 from
  Mike's fight" (400 ms).
- **Rejoined:** a charging copy slides into the standing copy; stats tick up; chip "Rejoined".
- **Audio:** none extra in the fight (the copies use their own sounds); a stamp tick at settle.

#### SB8. Hand Off
- **Trigger:** a card dropped on the partner's portrait.
- **Own screen:** the card shrinks and flies across the gap into the strip's hand count, which ticks +1 (350 ms).
- **Partner's screen:** the card enters from the strip and lands in hand with the card-to-hand beat, tagged "From
  Kevin".
- **Audio:** the existing card-to-hand sound, panned toward the partner.

#### SB9. Send Gold
- **Trigger:** the Gold pill dropped on the partner's portrait.
- **Own screen:** a coin hops from your Gold pill across the gap into the strip's Gold pill (250 ms per coin, 80 ms
  apart).
- **Partner's screen:** the coin drops into their Gold pill with "+1 from Kevin". Against a Levy the pill shows "x2" and
  two coins land.
- **Audio:** the existing coin clink, one per coin.

#### SB10. The Charge
- **Trigger:** your front is won while your partner's still fights (or was lost).
- **Own screen:** your survivors lift (scale 1.05) and run off toward the gap, 120 ms apart; the view cross-fades to the
  partner's arena (both clients now watch the same fight). The chargers burst in from the right end, the first one
  attacks at once.
- **Partner's screen:** the same cut; the chargers enter their arena.
- **Animation:** `chargeCut` 500 ms, `crossMinion` 600 ms, banner "CHARGE!" 900 ms.
- **Audio:** a war-horn stab (NEW) and the announcer "Charge!".
- **Reuse:** summon beat, banner, announcer. **NEW:** chargeCut, war-horn.

#### SB11. A boss recruit-phase telegraph
- **Trigger:** the turn before the pressure.
- **Own screen (affected):** the intent card on the ribbon flips over (300 ms) to **WHAT / WHO / ANSWER**; your portrait
  glows once in boss colour; the coming curse pill shows ghosted on its target with a "next turn" tag. A "Cover me"
  ping button sits on the intent card.
- **Partner's screen:** the same intent card, your portrait on their strip glows once, and their side of the ANSWER is
  highlighted ("Mike splits it"), with an "I've got it" ping button.
- **Audio:** a low boss drum (NEW), once.
- **Reuse:** intent ribbon, ping pills. **NEW:** three-line intent card.

#### SB12. A Curse landing
- **Trigger:** the turn starts (or a combat Echo applies one).
- **Own screen:** a black-and-white streak from the boss portrait to the target; the violet curse pill stamps on (200 ms)
  with its number.
- **Partner's screen:** the streak lands on your strip tile; the same pill appears on the tile.
- **Attribution:** "Mother Hollow: Rot 2 on Kevin's Wolvie."
- **Audio:** a dry crackle (NEW).

#### SB13. The co-op bypass: Take, Split, Cleanse
- **Take:** on the taker's screen the pill lifts off the partner's tile, a violet wisp runs through the gap, and it
  stamps onto the taker's card (500 ms). On the other screen it lifts off the real card and leaves through the strip.
  Chip: "Mike took Rot from Kevin's Wolvie".
- **Split:** the pill cracks in two (150 ms); one half stays, the other wisps across (400 ms); both numbers tick.
  Chip: "Mike split Rot: 1 and 1".
- **Cleanse (a Shout, Cleanser, the partner's Ward):** the source's own beat, then the pill dissolves upward (opacity,
  300 ms). Chip: "Mike's Shout: Rot 2 to 1 on Kevin's Wolvie."
- **Audio:** a wisp "zip" for Take and Split, a clean bell for a Cleanse.

#### SB14. Curses spreading and flipping
- **Spread (End of Turn):** a thin violet wisp crosses the gap (500 ms), the copy stamps on at 1. Chip: "Rot spread to
  Mike's Hound".
- **Flip (Turns good):** the pill flips violet to gold with a one-shot shine (400 ms), the card's new text stamps in,
  banner "TURNED" on both screens. Chip: "Rot turned: +2/+2 each turn".
- **Audio:** spread: a quiet hiss; flip: a bright rising two-note (NEW), announcer "Turned!".

#### SB15. Loot drops and the boss card reveal (rarity escalation)
- **Trigger:** an elite dies, a phase breaks, a boss dies.
- **Both screens:** the enemy portrait cracks and becomes a chest (the existing crate reveal, inline, 1.4x speed).
  Anticipation shake 600 ms; the light colour rises through the rarity ladder (Rare, Epic, Legendary) and stops at the
  result; the burst; the reward rises.
- **Own drops** rise in your centre; **the partner's** rise smaller over their lane ("Mike found: Rune of Fury").
- **Boss card:** if the shared roll hits, the chest freezes mid-shake, the sound cuts, the screen drains to the boss
  colour, then the enemy's own art fills the frame, the card frame builds around it, "BOSS CARD!" banner on both
  screens, and it flies to the next picker's hand. 2.2 s total.
- **Audio:** the crate's own sequence; the boss card adds the boss's theme sting and the announcer line.
- **Reuse:** the account crate reveal (owner-approved freeze-and-cut beat), rarity stings. **NEW:** boss card build.

#### SB16. Finding and upgrading a hero power
- **Find:** the hero power card flies to your portrait; an empty power slot opens (iris, 300 ms) and the icon drops in
  with a stamp. On the partner's screen your strip portrait gains the icon with a chip "Kevin learned Aegis".
- **Upgrade:** the icon stamps gold, its level pip goes I to II, its text and cost tick. Chip "Aegis II".
- **New slot opens** (after an act boss): the slot frame rises into place with a gold edge, once.
- **Melt:** the old icon cracks and fades; the new one drops in at II.
- **Audio:** a hero "learn" chord (NEW); upgrades reuse the rune level-up sound.

#### SB17. The Ghost and the revive
- **Fall:** your Health reaches 0; your board's frames pale (the Ghost frame variant crossfades in, 600 ms); "Ghost"
  pill on your portrait. On the partner's screen your strip pales the same way.
- **Revive (BACK!):** a Charge wins your Ghost front: gold light sweeps up your portrait, colour returns to your frames
  (600 ms), Health ticks to 12, banner "BACK!" on both screens.
- **Audio:** fall: music ducks one bar; revive: the announcer "Back!" and a swell.

#### SB18. Boss phase changes and the boss death
- **Phase break:** the bar shatters (one-shot sprites, 800 ms), the next bar lights; if overkill, "OVERKILL +23" rises
  over it and the Momentum pills fly to both Haul tabs. Banner names the new phase ("Phase 2: The Split").
- **Boss death:** slow-mo on the killing hit (the Choreographer's 0.5x for 600 ms), the boss's own death beat, then the
  drop chest (SB15). On both screens.
- **Audio:** phase: a boss roar plus the announcer; death: the boss's theme resolves.

#### SB19. Momentum and Wrath
- **Momentum:** each 10 overkill spawns one gold coin that arcs from the bar to both Haul tabs (one sprite per side),
  pills "+1 Gold" and "+1 step".
- **Wrath:** a single red step pill stamps onto the boss card at the start of its turn, "Wrath +2: you are 8 levels
  ahead". Never animated after.

#### SB20. The run victory
- The last Limb is CAUTERISED. Both arenas slow, the Titan's crown falls (one-shot), and the screen opens to the end
  card: both players' Link rows drawn wired together, each **hero's finished power row**, the crossing count rolling up
  ("1,214 Links crossed"), the best Combo, the best LINK count, the biggest boss card played. Music: the victory theme.

### 17.5 Choreographer beats (new kinds)

| Beat | Fires on | Plays | Length | Reuse |
|---|---|---|---|---|
| `linkOut` / `linkIn` | a crossing leaving / landing | flash + travel / travel + landing + chip | 150 / 250 ms | NEW (uses existing landing beats) |
| `linkSurge` | 4+ crossings inside 250 ms | bundled bolts + counter + chip | 350 ms | NEW |
| `bothBoards` | a Both boards effect starts or ends | pill pop, bolt | 300 ms | NEW |
| `sharedSlot` | place, swap, offer, lock, settle gains | SB5 to SB7 | 300 to 400 ms | NEW (summon beat reused) |
| `crossMinion` | a minion changing fronts | cross shape | 600 ms (1.2 s boss swaps) | NEW |
| `chargeCut` | a Charge begins | both clients cut | 500 ms | NEW |
| `twinGuides` | Start of Combat | guide lines | 600 ms, non-blocking | NEW |
| `curseLand` / `curseMove` / `curseTurn` | SB12 to SB14 | streak, wisp, flip | 200 to 500 ms | NEW |
| `bossTelegraph` | the turn before pressure | intent flip, glow | 300 ms | extends the intent ribbon |
| `drop` / `bossCard` | SB15 | crate reveal inline / boss card build | 1.6 s / 2.2 s | REUSE crate reveal |
| `heroPowerLearn` | SB16 | iris, stamp | 300 to 500 ms | NEW |
| `fuse` / `split` | Fusion | 17.6 | 1.2 s / 0.8 s | NEW |
| `phaseBreak` | a bar empties | shatter, next bar, announcer | 1.5 s | NEW |
| `haulReveal` / `haulTake` | SB1 | slide-in, stamp | 600 / 300 ms | NEW |
| `recap` | settle | what each gave the other | 2 s, dismissable | NEW |

Every beat gets a presentation policy entry, as every new effect factory already must.

### 17.6 The Fusion sequence

1. "FUSION" across both screens (one-shot text). 2. The lane grows down into the arena while your board slides up
(transform). Twins meet slot by slot, 100 ms apart, each with a flash and both owner pips. 3. One Fused board in one
arena: **both clients show the same fight from the same side.** 4. After the fight the Fused minions split with a
reverse flash and each half flies home.

### 17.7 Live card text on both boards

On every surface (Shop, board, hand, Haul, Discover, combat), via the `cardText.ts` helpers into both `liveCardText`
and `Unit.tsx`, in the same PR as each effect:
- **The source Link or Graft:** level, current numbers, count. "Echo Chamber II: fired 3 of 5 this combat."
- **Scalers that read the partner:** "Undertakers: +3/+3 for each Rise minion on Mike's board. (Now +6/+6.)"
- **Both boards:** affected cards say whose effect they carry ("x2 (Kevin's Drakko)").
- **The Shared minion:** "Shared. Owner: Mike. Works on both boards."
- **Curses:** their number and Cleanse; a countdown when they have one.
- **The target:** the **Linked** pill with the incoming total: "+6/+6, Rise from Kevin".
- Doc Bot's live-text tripwire extends to loot, Curse and hero power defs.

### 17.8 The 60-second trailer (shot by shot)

| Time | Shot | On screen | Sound |
|---|---|---|---|
| 0:00 | Black. Two hands on two mice, two desks. | Title card: "Two heroes. Two boards." | A heartbeat drum. |
| 0:04 | The Haul slides down on both screens at once. | Four glowing frames; the Handshake card with two empty chip slots. | Rarity stings. |
| 0:08 | Both chips snap on the Handshake. | "Handshake!" | The two-note chord resolving. |
| 0:11 | Kevin drags Drakko into the Shared Slot. | On Mike's screen it slides into his slot 7 too. "Both boards" pill. | The gold door tone. |
| 0:15 | Mike plays a Dragon. | His Shout fires twice; Karwind's +4/+4 lands on both boards. | Shout pops, doubled. |
| 0:19 | The boss ribbon flips: "Next turn: Rot 2 on Kevin's Wolvie." | The violet pill stamps on. Mike pings "I've got it". | A low boss drum. |
| 0:23 | Mike splits it. | The pill cracks; half wisps across the gap. Next turn both flip gold: "TURNED". | Zip, then the bright two-note. |
| 0:28 | Combat, split screen: Kevin's arena and Mike's lane. | A bolt crosses the gap: Kevin's Echo lands on Mike's Hound. | Echo cue. |
| 0:31 | Jormun's body stretches across both fights. | One Health bar across both portraits. | A serpent hiss. |
| 0:34 | Ferry: Kevin's dead Wolvie drops into Mike's slot 2. | CROSS shape through the gap. | A whoosh. |
| 0:37 | The Shared Echohorn Rallies on both fronts at once. | Two Rallies, Grim's +8/+8 on Mike's Beasts. "LINK x14". | Counter pops. |
| 0:41 | Kevin's front wins. "CHARGE!" | His survivors run off and burst into Mike's arena. | War horn. |
| 0:45 | The serpent dies. Slow motion. | The portrait cracks into a chest. The light rises through Rare, Epic, Legendary, then freezes. | The sound cuts. |
| 0:49 | "BOSS CARD!" | Jormun's art becomes a card and flies to Mike's hand. | Boss theme sting. |
| 0:52 | A hero power slot irises open on Kevin's portrait. | "Kevin learned Rally Cry." His row now has three powers. | The learn chord. |
| 0:55 | FUSION: the two boards slide into one. | Twins merge slot by slot. | Rising swell. |
| 0:58 | End card. | "EXPEDITION. Co-op ASCENT." | The victory theme's last hit. |

### 17.9 The presentation asset list

**FX defs and sprites (Pixi).**

| Asset | New or reuse |
|---|---|
| Bolt sprite (one texture, tinted per keyword), bolt head variants for keyword pills | NEW (pooled) |
| Projectile sprite | REUSE existing projectile/hit FX |
| Cross shape (card lift + slide + fade) | NEW motion on existing card sprites |
| Coin hop | REUSE existing coin sprite |
| Stamp | REUSE `cardbuff` / stamp beat |
| Curse wisp, curse streak | NEW |
| Seal stamp | NEW (painted seal icon) |
| Link Surge thick bolt + counter | NEW |
| Bar shatter | NEW (one-shot) |
| Chest / crate reveal | REUSE the account crate reveal |
| Boss card build | NEW (on existing card frame) |
| Hero power iris | NEW |
| Fusion slide and merge | NEW |
| Keyword landing beats (Echo, Shout, Rally, Ward, Rise, summon, hit) | REUSE |

**Painted pieces (art owed; placeholders until the owner names files).** The gold gap edge; the Haul row backing; the
"Shared" frame pill variant; the enemy frame; the curse frame and curse pill icon; the Boss / Elite card frame pills;
the Ghost pale frame; Vel's pale frame; the boss-colour frame; the seal icon; act backdrops; door art; boss portraits.

**Sounds.** NEW: Handshake chord, Both boards shimmer, Shared Slot door tone, war horn, boss telegraph drum, curse
crackle, wisp zip, cleanse bell, turned two-note, hero power learn chord, per-boss theme stings. REUSE: rarity
stings, coin clink, card-to-hand, buy/sell whoosh, freeze, rune level-up, every keyword's combat sound, the announcer
(new lines: Handshake, Charge, Back, Turned, Boss card, Fusion, Synced, Burp, Refund, Cauterised).

**Choreographer:** the beats in 17.5, each with a presentation policy entry.

---

## 18. Difficulty (Mayhem) and falling

### 18.1 Health and damage

**40 Health** plus **10 Armor** each. Armor absorbs first. A lost front costs the boss's or pack's damage (Brawls use
the lobby formula, capped at 5 / 10 / 15 by act). A boss victory heals each player half their missing Health. Campfire
Rest heals 12.

### 18.2 Mayhem (the ladder, wilder as well as harder)

| Level | The bosses get | The pair gets |
|---|---|---|
| 0 | As written. | As written. |
| 1 | Bosses start with one themed Haul card in their own Link row. | The Wild is +1 rarity step. |
| 2 | Bars +15%. | The Handshake is +1 rarity step. |
| 3 | One intent number shows "?" until both lock. | Tier 7 opens in Act 3. |
| 4 | Enrage from a phase's 3rd turn. | +2 Link space. |
| 5 | Each boss uses its recruit pressure twice per phase. | Juggernaut wins give pick 3. |
| 6 | Brawl packs carry one rune flag. | Boss card chance +10%. |
| 7 | Damage +50%. | Melt raises two levels. |
| 8 | Ghosts cannot be Charged back. | Every Haul has 5 private cards. |

### 18.3 Falling: the Ghost

At 0 Health a player becomes a **Ghost**. A Ghost is not out.

- **Still plays.** The Ghost shops, Hands Off, Sends Gold, takes a Haul card every turn, keeps the Shared Slot pick on
  their turns, and their Links stay live.
- **Ghost board.** It fights its front at half Attack. It deals no boss damage. A lost Ghost front costs the living
  partner nothing.
- **The gift slot.** The Ghost's Haul gains a 5th card: a Burst that only helps the living partner ("Your partner's
  slot 1 minion gains Rebirth this combat.").

**Ways back.** 1. **Charged back:** the living partner's Charge wins the Ghost's front: back at 12 Health ("BACK!").
2. **Give up your loot:** the living partner skips their Haul pick 2 turns in a row: back at 15. 3. **Two won Ghost
fronts in a row:** back at 10. 4. **Campfire Revive:** back at 15. 5. **Boss victory:** back at 15. **Reunion** (16.3):
back at 10.

The run ends when both players are Ghosts at the end of a fight.

### 18.4 Losing well

- Every boss shows its next move in numbers, and every death traces to a fight both players watched.
- The end screen shows the **loss line**, the best Combo, the highest LINK count, the best Overkill, and the answers the
  pair passed: "You passed Unwrite on turn 21." "Rot spread 4 times. Split it."
- A coach line the first time each format appears: Tandem ("Your fights run side by side."), Charge ("Win first, then
  go help."), Curses ("Your partner can take it or split it."), the Shared Slot ("Slot 7 is on both boards.").

---

## 19. New vocabulary (the honest list) and the First Road

### 19.1 The New vocabulary table

Audited against the live game (`packages/content`, `heroes.ts`, `docs/GAME-RULES.md`, `ui/src/terms.ts`) on
2026-10-17. Everything not listed here is an existing ASCENT word used with its existing meaning (Shout, Echo, Rise,
Rebirth, Avenge, Ward, Resilient Ward, Taunt, Rally, Slaughter, Pummel, Overflow, Start of Combat, End of Turn, Flurry,
Cleave, Execute, Stealth, Immune, Engraved, Consume, Sell, Gild, Gilded, triple, Triple Reward, Discover, Choose One,
Rubies, Whispers, Starform, Collapse, Shop spells, Dwarven Ales, Spell Power, Undead Aura, Imp Aura, Gold, Armor,
Health, Refresh, Freeze, tier up, hero power, rune, Runeforge, rift, Equipment, Amplified).

| # | Term | What it is | Why ASCENT has nothing for it | Collision check |
|---|---|---|---|---|
| 1 | **Haul** | the 4-card loot row each turn | the Runeforge is a scheduled forge visit with a price; the Haul is free, every turn, built from two boards | none |
| 2 | **Yours / Pull / Wild** (slot pills), **Comeback** | the Haul's private slot labels | new row, new slots | none |
| 3 | **Handshake** | the shared Haul card; both take it for a Twin Link | nothing shared exists between runs | none |
| 4 | **Link** | run-long cross-board loot, levels I to III | runes are one-board and bought | none |
| 5 | **Graft** | loot text on one minion | **Attach** is a minion merging into a minion; reusing it would mislead | none |
| 6 | **Burst** | a one-shot loot card | it behaves like a free Shop or next-combat spell, but it is taken, not bought or held | none |
| 7 | **Twin** | your slot N and your partner's slot N | there is no partner today | mild: Rune of Twin Gilding, Twinning (Set 4). Different meaning, plain word |
| 8 | **Shared Slot** / **Shared** | slot 7 on both boards | nothing is on two boards today | none ("Shared" appears only in card names like Shared Spirit) |
| 9 | **front** | each board's fight | there is only one fight today | none |
| 10 | **Melt** | full Links or hero powers: drop one, the new one enters a level higher | no limit like it exists | none |
| 11 | **Harmony** | pair levels per keyword wake a bonus ("Echo Harmony II") | new combo layer. Not "Resonance": Rune of Resonance (live) and the Resonance spell exist | none. **Cut candidate** if the doc must shrink |
| 12 | **Combo** | a named bonus for two Links owned by different players | new | none. **Cut candidate** |
| 13 | **Charge** / **Charge:** | win your front, then cross over to help | no cross-fight help today | **mild:** Equipment has "charges". Kept on the owner's say; a rename would be **Rush** |
| 14 | **Fusion** / **Fused** | Twins merged into one board | new | the button never says "Fuse": the lobby's **Gold Fuse** and the card **Fuse Aldrin** exist |
| 15 | **Ghost** | the fallen player state | no fallen state that still plays | none (Ferry was renamed so Ghost means one thing) |
| 16 | **Momentum** | overkill pays Gold and rarity | new | none |
| 17 | **Wrath** | the boss grows when you are ahead | new | none |
| 18 | **Mayhem** | the difficulty ladder | new | none |
| 19 | **Curse**, **Cleanse**, **Junk** | the Curse system (11) | nothing negative is attached to cards today | none (checked) |
| 20 | **Send Gold**, **Take**, **Split** | co-op verbs | no partner today | plain words |
| 21 | **Boss card** / **Elite card** (pills) | an enemy as a playable card | new | "Trophy" was avoided: Trophy Stalker and Trophy Den exist |
| 22 | **Both boards** (pill) | the Both boards state | new | plain words |
| 23 | Door names: **Brawl, Juggernaut, Forge Fight, Rift Fight, Vault, Campfire, Mystery** | map doors | new map | "Vault" is in rune names (Rune of the Vault); proper noun only |
| 24 | Boss intents: **Sharpen, Brace, Brood, Burn, Hunt, Countdown, Sever, Steal, Mirror, Claim** | one-word intent labels | the legacy threat telegraphs are not live | none |

**Internal only (never player-facing):** Tandem, Lead-and-Follow, the inbox, the Ping-pong guard, Link Surge.

**Removed since v2:** Thread, Ember, Bone, Steel, Storm, Star (as a Thread), Spark Thread, Resonance, Rack, Refit,
Reroll, Hoard, Grudge, Hit, Storm Front, Link Ledger, Assist:, Baton:, Ghost Relay.

### 19.2 The First Road (a pair's first run)

| Turn | Teaches |
|---|---|
| 1 | Haul, Link (the starter pick), Twin (guides and a coach line) |
| 2 | the Shared Slot (the host has the pick and a Shout minion in hand) |
| 3 | Handshake (forced to a strong fit), the first hero power (the Wild) |
| 4 | Burst, Both boards (a Shared Shout in the Yours slot) |
| 5 | Charge (a Juggernaut door with a scripted early win), the first drop |
| 6 | the first Harmony step |
| 7 | the first Curse (a small Rot, with the Split answer prefilled on the intent card) |
| Act 1 boss | Momentum, recruit pressure with a bypass, a boss card chance |
| Act 2 | Graft, Melt, Wrath, Send Gold against a tax |
| Act 3 | Fusion |

---

## 20. Two narrated example runs

### Run 1: "The Ferry" (Mayhem 0, Set 2, a win, 54 minutes)

**Kevin** picks the Lord of the Risen portrait and the **Echo** starter (*Echo Chamber I*); he goes Beasts. **Mike**
picks the Auctioneer portrait and the **Shout** starter (*Chorus Line I*); he goes Dragons. Neither has a hero power.

**Act 1, The Hollows.**

| Turn | Door | Picks | Shared Slot | Hero powers | Why |
|---|---|---|---|---|---|
| 2 | Brawl (Hollow Brood) | Kevin Jackpot. Mike Megaphone. | Host Kevin picks: his Wolvie goes in. | none | Jackpot's partner Refresh finds Mike a Tier 3 Dragon. |
| 3 | Brawl (Gobble Gang) | **Both take Ferry: Handshake!** Wild: Kevin **Pulse**, Mike **Undying** (the turn 3 Wild). | Mike picks: he leaves Wolvie. | Kevin Pulse I, Mike Undying I | Ferry is a Twin Link. Kevin moves Wolvie's partner Grim to slot 2 under Mike's Karwind. |
| 4 | Forge Fight | Kevin **Echo of a Voice** on Grim. Mike Thunder Pact. | Kevin picks: **Echohorn** in, Wolvie home. | | Echohorn now Rallies on both fronts. |
| 5 | **Juggernaut: The Twin Sentinels** | Kevin Opening Volley. Mike Call and Answer. | | | Recruit pressure: Kevin's tier up costs 3 more. **Mike tiers up first**; the seesaw cancels Kevin's surcharge. Kevin wins on step 9 and **Charges**. Drops: Kevin rolls **Aegis**; the shared roll misses the boss card. |
| 6 | Rift Fight (Flurry) | Pick 2: Kevin Echo Chamber II and Return to Sender. Mike **Shared Shout**. | | Kevin: Pulse, Aegis (slot 1 is full, he Melts Pulse: Aegis enters at II) | Echo Harmony I wakes (Kevin's starter needs 3). |
| 7 | Campfire | Kevin Gilds Grim. Mike **Studies**: Discovers **Shared Pulse**. | | Mike Melts Undying for Shared Pulse II | |
| 8 to 10 | **Mother Hollow** | Boss Wild: Heartstring, Mirror Strike | | | see below |

**The boss.** The ribbon flips: "Next turn: Rot 2 on Kevin's Grim. It Spreads. Answer: Mike splits it." Mike pings
"I've got it". Turn 8 opens with the violet pill on Grim; Mike drags it from Kevin's strip tile and **Splits** it for
1 Gold: Rot 1 on Grim and Rot 1 on Mike's slot 2 Karwind, its Twin. At Start of Turn 9 both pills flip gold:
**TURNED**: both gain +2/+2 every turn for the rest of the run. Phase 1 breaks in one turn on 9 Momentum. Phase 2 is the
lesson: Kevin's Half dies on step 6 and the ring spins on Mike's Half at 9 Health. The Shared Echohorn Rallies on Mike's
front, triggers the left-most Echo there, which is Kevin's ferried Hawkus; Tag In makes Mike's slot 1 attack at once:
"SYNCED", LINK x11. The queen falls with **OVERKILL +22**. Drops: Kevin **Cleanser**, Mike **Rune of the Brood**; the
shared roll hits: **BOSS CARD! Mother Hollow** flies to Kevin's hand (his pick is next). Slot 2 of each hero power row
opens. The Boss Haul's Mythic Handshake is **Twilight Pact**; both take it without a word.

**Act 2, The Gilt Deep.** Kevin plays Mother Hollow into the Shared Slot; Echohorn goes home. Turn 12, Vault (100%):
Kevin takes **Shared Grave** and levels **Ferry** to III; Mike takes **Two Throats**. Mike plays Drakko under his
Shared Shout: "Kevin's Shouts trigger twice" pops on Kevin's hand for the turn, and Kevin's Pulse (gone, Melted) is not
missed: Mike's **Shared Pulse** triggers Kevin's Karwind Twin and his own. **Haunted House** forms (Ferry plus Mike's
Pull-picked Echo Chamber).

**Jormun (turns 15 to 17).** Recruit pressure: "Next turn: Coiled on Kevin's slots 1 and 2. Answer: Mike plays a Shout
minion." Mike buys a Bridgewyrm he does not need and plays it: both Coiled pills on Kevin's board dissolve. The hunt
moves to Kevin; One Body breaks in one fight. In phase 3 Mother Hollow, in the Shared Slot, splits into two Halves on
both fronts and Rebirths whole on both when they die within 3 steps: LINK x31. Drops: Mike **Rally Cry**, Kevin a Basic
ASCENT rune; the shared roll misses.

**Act 3.** Vel. Recruit pressure: "Next turn: Mike's Shop shows Kevin's. Kevin cannot buy. Answer: Mike shops for
Kevin." Mike buys Kevin's third Wolvie at 2 Gold and Hands Off for free: Kevin triples. Phase 3, the forced Fusion:
Kevin's Gilded Grim and Mike's Karwind are Twins in slot 2 and become one Fused 61/58; Twilight Pact doubles every
Start of Combat. **LINK x44.** Drops: Kevin **Copy Machine** into his new slot 3.

**Finale.** Kevin wears the Heavy Crown on the turn Mike needs time, then Mike Takes it back. The last Limb is
**CAUTERISED** by a Return to Sender reading inside the Fused board. The end screen shows the two heroes they built:
**Kevin: Aegis II, Cleanser, Copy Machine. Mike: Shared Pulse II, Rally Cry, Goldspring.** "1,214 Links crossed."

**Why it worked:** they split the Rot instead of fighting it, used the Shared Slot as a hub for Echohorn and then for
Mother Hollow, and answered every recruit pressure out loud on the turn before it landed.

---

### Run 2: "Tax Season" (Mayhem 2, Set 2, a loss with a lesson, 46 minutes)

**Kevin:** the Gorun portrait, starter **Start of Combat** (*Opening Volley I*), goes Demons (Shop buffs). **Mike:** the
Warden portrait, starter **Taunt** (*Lend a Shield I*), goes Kobolds (Rubies).

**Act 1.** Turn 3's Wild gives Kevin **Displace** and Mike **Aegis**. The Shared Slot holds Kevin's **Market Tormentor**:
its Shout fired on both boards when he played it, so both right-most Shop minions got +8/+8. **Gob and Gobbo** (turn 5)
floods Kevin's Shop with 3 Junk. Mike clears two through the strip for 1 Gold each (his slot 1 gains +2/+2), Kevin buys
the third: 3 cleared in one turn, and the last turns into a Gilded Prospector in Kevin's hand. Drop: **BOSS CARD! Gob
and Gobbo**, to Mike's hand.

The **Gobbler King**: Appetite pills sit on Kevin's Shop slots 5 and 6 every turn, and each card he eats makes its Shop
Twin cheaper in Mike's Shop, so Mike buys the Demons Kevin loses and Hands them over. Phase 2 puts **Supper** on Mike's
Gilded Geode Guardian. It is Kevin's pick turn. Kevin sends Tormentor home and moves Mike's Guardian into the Shared
Slot: "He cannot eat what two boards hold." The **BURP** later spills a Gilded copy of the Shared Guardian onto Kevin's
front. Drops: Kevin **Masterwork**, Mike **Rune of the Belly**.

**Act 2.** Kevin grafts **Crossfire** onto his Imp lord; Mike takes **Bodyguard** as a Handshake Kevin joins. **The Grand
Tithe**: "Next turn: Levy, Kevin's minions cost 4. Answer: Mike sends Gold, it counts double." Mike sends 2, Kevin gets
4, and buys his Tier 5 Demon on time. The lesson comes anyway: twice the Handshake was a Gold card neither wanted, so
the Tithe took **Swap Meet** and **Joint Account**. In phase 2 it borrows Kevin's Crossfire and shoots it into Mike's
fight. Mike falls to 0 and becomes a Ghost. Turn 17: Mike's gift slot gives Kevin's slot 1 Rebirth; Kevin wins on step
11 and **CHARGES**: **BACK!** Mike returns at 12. The Tithe dies, the **REFUND** levels both stolen cards, and Kevin
rolls **Goldspring**.

**Act 3, Vel.** Here they die. Doubt lands on Kevin's Crossfire Imp ("Its Shout and Echo resolve on the enemy's side.
Cleanse: its Twin is the same tribe at lock."). Mike's slot 2 is a Kobold; Mike has no Demon to put there and says so
too late. Vel's copy of Swap Meet sends its copy of Kevin's Imp into Mike's slot 6 at Start of Combat. Both fronts lose.

**The end screen:** "Doubt sat on your cannon for 2 turns. A Demon in Mike's slot 2 cleanses it. Unwrite was offered
on turn 21." Their heroes: **Kevin: Displace, Masterwork, Goldspring. Mike: Aegis II, Tether.**

**The lesson:** a pair whose engine is one huge cross-board threat is exactly what Vel turns around. The answer was in
the telegraph: the Cleanse needed a same-tribe Twin, and only Mike could make it.

---

## 21. Highlight moments catalogue

1. **Handshake!** Both chips snap onto the shared card in the same second.
2. **The first bolt.** Your Echo fires and a bolt crosses to your partner's slot 2. "Was that you?"
3. **The Drakko moment.** Your Drakko works on both boards and your partner's Shouts double.
4. **The Shared carry.** Two Shops feed one Echohorn, and it Rallies in both fights.
5. **Saved by the Shared Slot.** The Gobbler marks your carry; your partner's pick moves it into slot 7.
6. **TURNED.** You split the Rot, and next turn both halves flip gold.
7. **Mike's got the tax.** Two coins become four and the Levy is paid.
8. **Shop for me.** Vel silences your Shop; your partner buys your third Wolvie and you triple.
9. **SYNCED.** Mother Hollow's Halves die within the ring, one in each fight.
10. **BURP.** The Gobbler King spits your partner's swallowed carry out onto your front, Gilded.
11. **One Body.** A Crossfire shot in your partner's fight kills the serpent's head in yours.
12. **REFUND.** The Tithe dies and every card it stole comes back levelled up.
13. **Lightning Rod.** A screen of bolts breaks Voltara's bar in one fight.
14. **CHARGE!** Your survivors run off and burst into your partner's arena.
15. **BACK!** A Charge wins your Ghost partner's fight.
16. **BOSS CARD!** The chest freezes, the sound cuts, and the boss becomes your card.
17. **Your hero, built.** A third power slot irises open.
18. **FUSION.** The arenas slide together and your Twins become one minion.
19. **LINK x20.** The counter turns gold.
20. **CAUTERISED.** A head dies to a crossing and stays dead.
21. **OVERKILL +40.** A bar shatters with a number bigger than the bar.
22. **The recap.** "Kevin gave Mike +212/+190 this run." Read out loud.

---

## 22. Architecture mapping and risks

### 22.1 Reused as-is

| Need | Existing piece |
|---|---|
| Rooms, seats, ready gate, portrait select, clock, lock, pause, reconnect, spectators, emotes, Peek | Versus |
| Shop, economy, tiers, triples, Gilded, Discover, Choose One, Whispers, Equipment, Starform, Rubies | `packages/sim` |
| A single fight (each front, a Charge leg, a Fused fight) | `simulate()` |
| Enemy units and boards with Auras, Spell Power, rune flags | `token: true` cards + enemy `CombatSideState` |
| Runes and the Runeforge, rune drops | `RUNES`, `EPIC_RUNES`, the forge flow, the duplicate rule |
| Hero power kinds | `HeroPowerKind` branches (`grantWard`, `gild`, `replayBattlecry`, `grantReborn`, `gainMaxMana`, `resummon`, `displace`, `gildcrafter`, `replayAllEndOfTurn`, `spellAmplify` ...) |
| Haul row frames, Link row | the Runeforge offer row, the rune row |
| Drop reveal | the account crate reveal |
| Shop-resident boss object (Star Seed) | the Starform pinning rule |
| Live text | `cardText.ts` helpers into `liveCardText` and `Unit.tsx` |
| Ally lane | the lobby scouting-board component |

### 22.2 Extended

- **Hero powers become a list.** `RunState` holds up to 3 powers with levels instead of one hero's `power`. Each keeps
  its `kind`, cost and uses. A hot file (`state.ts`, `reducer.ts`): serialize with other work.
- **Trigger multipliers** gain a partner scope (Two Throats, Both boards) and a phase scope on `TriggerMultiplierDef`.
- **"Attacks immediately"** gains a cross form (Opening Volley, Tag In, Mirror Strike).
- **`CombatConfig`:** `frontLead`, `injections` (Lead-and-Follow), `fusedFrom` metadata.
- **Versus server resolve:** two fronts, Charge legs, Fusion, the Shared minion's copies, drops.

### 22.3 New primitives and systems

**A. The Tandem engine (XL).** A steppable `simulate` (`init`, `step`, `drainInbox`, `isOver`) and a `simulateTandem`
driver: alternating fronts, inbox routing, a merged log, the Ping-pong guard and the 200 backstop. New `CombatEvent`
kinds (`linkOut`, `linkIn`, `crossMove`, `chargeIn`, `curseApply`) are a shared-boundary change: agree first.

**B. Lead-and-Follow (M).** The lead front runs plain `simulate`; its crossings are injected into the other front.

**C. The continuation rule (S).** Charge legs carry stats and spent flags; the arriving board attacks first.

**D. Ally scope and the both-boards scope (M).** `scope: 'twin' | 'partnerBoard' | 'partnerFront' | 'partner' | 'both'`
on subscriptions and targeted effects, plus a timed **both-boards** flag on an instance (8.1: own triggers resolve on
both boards; listening hears both and acts where woken; always-on covers both).

**E. The team state and team bus (M).** A server `TeamState`: doors, boss bars, Momentum, Wrath, Harmony counts, Ghost
state, Haul seeds and picks, **the Shared minion** (one `BoardMinion` mirrored into slot 7 of both `RunState`s), Curses
on Shops and heroes, drops, and the **sequenced bus** of cross-board Shop actions (Hand Off, Send Gold, Take, Split,
ally casts, Shared Slot place/swap/offer/lock, Shop-phase Links). Each client applies ops in server order.

**F. The Haul (M).** Server-side generator; `LootDef { id, kind, rarity, keywords[], levels[], anchor, scope, fireCap?,
bothMustTake?, aloneText?, curseAttached?, fusedReading, themedFor? }`.

**G. Cross primitives (L together).** `crossSummon`, `crossDamage`, `crossRedirect`, `crossMove`, `sharedBody`,
`Charge:`, `sever`, `claim`.

**H. Fusion (M).** `fuseBoards` before, `splitCarry` after.

**I. Curses (M).** `CurseDef { id, on: 'minion'|'shop'|'hero'|'hand'|'shopCard', number?, countdown?, spreads?, effect,
cleanse, turns? }`, zod-validated data. Minion Curses ride the instance (and its combat copy, with carry-back); Shop and
hero Curses ride `TeamState`; Spreads runs at End of Turn on the bus.

**J. Bosses, elites and the enemy roster (L).** Bespoke `token: true` units; phase machine, intent cycles with the
three-line telegraph, recruit pressure as data (curse + opening + answer), Appetite budgets, the boss Link row, board
copies, Regrowth with a cross-tag cauterise check, the Star Seed, Wrath.

**K. Drops (S to M).** Seeded tables per encounter, the shared boss card roll with pity, mode runes as `QuestReward`
data, boss cards as `CardDef`s gated to the Shared Slot.

**L. Presentation (L).** Section 17.

### 22.4 Determinism and seeds

`fork(runSeed, 'haul', turn, seat, refresh)`; `fork(runSeed, 'fight', turn)`; `fork(runSeed, 'doors', step)`;
`fork(runSeed, 'drop', encounter, seat | 'pair')`. Picks, Hand Offs, Gold sends, Curse moves and Shared Slot ops are
sequenced team ops. A run replays from runSeed, both action logs and the bus.

### 22.5 Risks

| Risk | Mitigation |
|---|---|
| **Steppable `simulate`** (~6.7k lines, one loop) | Lead-and-Follow ships first; the stepped front must match plain `simulate` byte for byte across the golden suite. |
| **Degenerate loops** | Ping-pong guard, printed caps, 200 backstop, a 10k-fight fuzz test. |
| **Snowball** | Accepted, fun first. Wrath, the Refund cap, the Momentum cap, the phase gate. Target win rate at Mayhem 0: 55 to 65%. |
| **Shared Slot abuse** | Swap cost, the once-out cooldown, the first-lock rule, owner-only sell. Measured by the bot driver. |
| **Recruit pressure feels unfair** | Telegraphed a turn ahead with an Answer line; every pressure has a solo fallback; dev-room pairs rate each one. |
| **Hero powers as a list** | A hot-file change to `RunState`; one migration, serialized. Existing kinds unchanged. |
| **Sacrificial board** | A Saved front deals no damage of its own; the sacrificial-board test. |
| **Readability** | The Twin anchor, bundling, priority, the chip stack, the vocabulary cut (19). |
| **Live text load** | Helpers ship with each primitive; Doc Bot covers loot, Curse and hero power defs. |
| **Perf** | 17.3; profile the worst Act 3 fixture on the prod build before Phase 2 ships. |
| **Art volume** | ~95 enemy portraits, 20 hero power icons, 14 curse icons. Placeholder silhouettes; the owner names files before any wiring. |

---

## 23. MVP vs full vision, with sizes

### 23.1 Phase 0a: "First Haul" offline, bot partner (L)

- One act (The Hollows): the 4 Act 1 packs, the Vault, **The Twin Sentinels** and **Gob and Gobbo**, and the **Gobbler
  King** (phases 1 and 2, with Appetite and Supper). Two separate `simulate` calls: nothing crosses inside a fight yet.
- **The Shared Slot** (copies per front; carry-back from both results): it needs no Tandem.
- The Haul with **20 entries** that need no in-fight crossing (Shop-phase Links, Start of Combat crossings compiled at
  lock, partner-reading scalers, Bursts) plus **7 Both boards** entries that work without crossing (B1 to B4, B8 to
  B10).
- **Hero powers:** start with none; 3 slots; the turn 3 Wild; 8 powers (Aegis, Masterwork, Pulse, Undying, Goldspring,
  Soulkeeper, Displace, Cleanser).
- **Curses:** Rot, Supper, Junk, Toll, Debt; Take, Split, Cleanse.
- **Drops** with the boss card roll (Gobbler King, Sentinel Pair, Gob and Gobbo).
- The Twin rule, Harmony, levels, the Handshake, the ally strip, Shop bolts, chips, live text, the storyboards that
  apply (SB1, SB2, SB4 to SB9, SB11 to SB16).
- **Question:** is a per-turn co-op loot draft with Twins, a Shared Slot and answerable boss pressure fun on its own?

### 23.2 Phase 0b: dev room with real pairs (M)

The same content host-resolved; **6+ real pairs**; logging of every pick, Handshake, Shared Slot op, Curse move and
answered telegraph. **Question:** do the Handshake and the boss Answers create talk without an alpha?

### 23.3 Phase 1: "Lead and Follow" online (L)

Server resolve of Lead-and-Follow plus the continuation rule; the Charge, Ghosts; Acts 1 and 2 (Mother Hollow, the full
Gobbler King, Jormun, the Grand Tithe, Aurex and Noctra; four Juggernauts); 40 loot entries, all 12 Both boards, 6
Combos, Momentum, Wrath, 14 hero powers, 10 Curses.

### 23.4 Phase 2: "Tandem" (XL)

The steppable `simulate` behind the parity test; Act 3 (Voltara, Vel with Fusion, the Hungering Star; the Linkbreaker
and the Colossus); Joined at the Hip; all 57 entries, 8 Combos, 20 hero powers, 14 Curses.

### 23.5 Phase 3: "Crowned" (M each)

The Seven-Crowned Engine, Mayhem 1 to 8, Tier 7 Linkmaker, set packs for Set 3 and Set 4.

### 23.6 Measurement harness (S to M, alongside Phase 0a)

The bot driver and its bar (90% of the median human snapshot at turns 7, 12, 17); the sacrificial-board test; the fuzz
test; win rate per Mayhem level; Shared Slot usage; recruit-pressure answer rate (how often the pair answers each
telegraph, and the cost when they do not).

### 23.7 Sizes at a glance

| Piece | Size |
|---|---|
| Haul generator + loot defs + levels + Melt | M |
| Ally scope + both-boards scope | M |
| Team state + bus + Shared Slot + server validation | M |
| Curses | M |
| Hero power list + 6 new kinds | M |
| Drops + boss cards + mode runes | S to M |
| Lead-and-Follow + continuation | M |
| Tandem engine | XL |
| Cross primitives | L |
| Fusion | M |
| Bosses (9) + Juggernauts (6) + enemy roster (~95 units) | L |
| Presentation Bible (17) | L |
| Bot partner + harness | S to M |

### 23.8 Art list (placeholders first; the owner names files before any wiring)

| Group | MVP (Phase 0a) | Full run |
|---|---|---|
| **Bespoke enemy portraits** | 21: 15 Act 1 pack units, Vault Guardian, Sentinel, Squire, Gob, Goblin, the Gobbler King (Mother Hollow and Hollow Half follow in Phase 1, for 22 in Act 1) | ~95 |
| **Boss cards** | 3 (Gobbler King, Sentinel Pair, Gob and Gobbo). They reuse the enemy's painting in the card frame: no new paintings, a crop each | 15 |
| **Hero power icons** | 8 (Aegis, Masterwork, Pulse, Undying, Goldspring, Soulkeeper, Displace, Cleanser; the first 7 may reuse their heroes' existing power icons) | 20 (14 reused where an ASCENT hero icon exists, 6 new) |
| **Curse icons** | 5 (Rot, Supper, Junk, Toll, Debt) | 14 |
| **Mode rune icons** | 1 (Rune of the Belly) | 8 |
| **Painted UI pieces** | gold gap edge, Haul row backing, Shared frame pill, enemy frame, curse frame, Boss / Elite pills, seal icon | plus the Ghost frame, Vel's frame, boss-colour frame, act backdrops, door art, 9 boss portraits |
| **Sounds** | Handshake chord, door tone, curse crackle, wisp zip, cleanse bell, turned two-note, learn chord, boss drum | plus war horn, Both boards shimmer, 9 boss stings, new announcer lines |

---

## 24. Open questions (short)

1. **Tandem engine:** is a steppable refactor of `simulate` acceptable behind the byte-identical parity test? If not,
   Lead-and-Follow becomes the shipped mode.
2. **The Shared Slot pick alternates every turn.** Or should the player with the Shared minion in the slot keep control
   until it is swapped?
3. **The Shared minion fights as a copy on each front** (one body only through Joined at the Hip). Agree?
4. **Harmony and Combos:** keep both, or cut one to shrink the vocabulary (19.1 marks both as cut candidates)?
5. **Charge** collides mildly with Equipment "charges". Keep it, or rename the help move **Rush**?
6. **Hero = cosmetic portrait.** Or should each portrait carry a small starting lean (one free Haul Refresh, +2 Armor)?
7. **Boss card chance** 15% elite, 25% boss, a pity by the Act 2 boss. Right feel?
8. **Health 40** plus 10 Armor, or the lobby's 30?
