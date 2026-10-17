# PLUNDER: a four-player PvEvP knockout mode (concept)

> **Status:** concept only, nothing built. Written 2026-10-17 for Kevin's ask (verbatim, in order):
> *"what about a pvevp mode? like with pve rounds leading up to player fights, ideally in real time similar to vs.
> like a 4 player knockout mode, kinda like TFT meets our vs. mode?"*, then *"we could make loot specific to the
> mode, too. like unique minions or mechanics that are only in that mode"*, then *"can you deeply scope this out
> first? like concept the entire mode, put together example runs and how it would ebb and flow, what kind of
> loot/mechanics/cards, what are the exciting moments, what makes it less competitive and more of a pure fun mode
> that varies round to round? what if there are no heroes in this mode but you learn abilities throughout somehow
> or something? use our architecture but get creative on how this could break the formula"*.
>
> Every number in this doc is a **starting dial** for headless tuning, not a ruling. Every name is a placeholder
> unless Kevin keeps it. Player-facing text follows the house style: short sentences, no em dashes, never "Oath"
> or "climb". Grounded against `main` at `1d9886108` (2026-10-17).

---

## Contents

1. Pitch
2. Pillars
3. Breaking the formula: identity without heroes
4. Round structure and pacing
5. PvE content: camps, elites, bosses, the Raid
6. Loot and mode-only content
7. Player interaction beyond combat
8. Less competitive, more fun
9. Example runs
10. Exciting moments catalogue
11. Architecture mapping
12. MVP vs full vision
13. Open questions for Kevin

---

## 1. Pitch

**Working name: PLUNDER.** Alternates: *Warpath*, *Raid Night*.

Four friends drop into one room. Nobody picks a hero. Between every duel there is something to kill: a rat nest,
a coven of witches, a storm dragon, and late in the night a burning titan that all four of you fight at once. Every
monster you beat drops loot, and the loot is how you become someone. Beat the Storm Wyrm and you can **learn Chain
Lightning** from it. Kill its hatchling and you keep the hatchling. Learn three Storm techniques and you take up the
**Stormcaller's Mantle**. By round 10 nobody at the table is playing the same game: one player is a gold-drunk pirate
who pays you to fight him, one is a graveyard that will not stay dead, one is throwing lightning at Start of Combat.
Then you fight each other, two duels at a time, until one is left standing.

**Why it is not Ranked.** Ranked is an eight-seat asynchronous ladder: a measured, comparable skill test where a
snapshot's board strength is a percentile and placement moves your medal. Plunder throws that away on purpose:
the dice are loud, the loot is uneven, and the point is the story, not the measurement.

**Why it is not Versus.** Versus is a clean, real-time 1v1 with a shared pool and hearts: two people, one fight a
round, a pure duel. Plunder keeps everything Versus proved (synced clocks, one server resolve, spectators, emotes,
the room) and adds the two things a duel cannot have: **monsters** (rounds with no opponent, where everyone races the
same threat) and **a table** (four people, a leader to gang up on, a Haunt in the stands who still gets a say).

---

## 2. Pillars

1. **The loot is the story.** You do not choose an identity in a menu; you earn it from what you killed. When the
   match ends, your end screen should read like a sentence: *"Learned Chain Lightning from Vexis, took the
   Stormcaller's Mantle, landed the Kill Shot on Kragg."*
2. **Every round is different.** No two consecutive rounds play alike: a camp, a duel, an elite, the Treasure
   Wheel, a boss, a vote, a raid. The route is shown in advance so players can plan, and the encounter deck, the
   bosses, the twists and the loot are reseeded every match.
3. **Big swings, short nights.** 16 to 22 minutes a match. Variance is a feature: a 25% Mimic chest, a Swap Meet, a
   Death's Door comeback. Nobody should leave a match without one "did that just happen?" moment.
4. **Nobody is out of it.** The player in last gets the first pick, the leader wears a Bounty, the knocked-out get a
   second chance, and the eliminated become Haunts who keep playing from the stands.
5. **Built from what we already have.** Learned abilities are Equipment and runes. Bosses are authored foes. Rooms
   are Versus rooms. The server resolve is the Versus resolver run more times. New content is data; new engine
   primitives are few and named (section 11).

---

## 3. Breaking the formula: identity without heroes

Kevin's prompt: *"what if there are no heroes in this mode but you learn abilities throughout somehow"*. Four
candidate identity systems below, each mapped to the engine, then a recommendation.

### Grounding: what the engine already gives us

- **Hero powers are a closed enum** (`HeroPowerKind` in `packages/sim/src/heroes.ts`, ~60 kinds), each a bespoke
  reducer branch. They are not data. Building dozens of learnable abilities as new hero-power kinds would be
  expensive and would fight the engine.
- **Equipment is already a data-driven, player-owned active ability** (`packages/content/src/equipment.ts`):
  Gold cost, `targetMode: 'none' | 'friendly'`, an `effectId` recruit factory with params, a Gilded variant, its
  own charge per turn, a shared bonus-charge pool, Amplified, and an `equipmentCastSpell` path that casts a real
  Shop spell. **Rune-owned Equipment** (`RunState.runeEquipment`, `grantRuneEquipment`) is held for the whole run
  with no body behind it. That is exactly "an active ability you learned".
- **Runes are a data-driven passive** (`RuneDef` + `QuestReward` in `packages/core/src/types.ts`), with combat
  passives carried as `QuestCombatMods` on the combat side, so they are symmetric and snapshot-safe. The
  `grantRune` reward kind can hand a rune outside the forge. That is exactly "a passive you learned".
- **Ancients** (`packages/sim/src/ancients.ts`) prove the "meter fills, then a run-defining awakening Discover"
  loop, with a ceremony and a hero-power-slot transformation.
- **Next-combat spells** cast at Start of Combat for either side (R-NEXTCOMBAT-01..03), so a Shop-phase active can
  have a combat payoff without a combat-time UI.
- **Gauntlet and tutorial seats** already run with a placeholder hero (`heroId: 'aster'`, flat 15 Armor), so a
  "no hero" seat is a solved shape.

### Option A: Boss Lore (learn from what you defeat)

Each boss and elite carries two **Lore** cards, abilities themed on that monster. Beat it and you choose one to learn.
Lose and you learn nothing, though its chest still pays by damage dealt (section 5).

- **Mechanics:** a Lore is an Equipment definition (active) or a rune definition (passive), granted through a new
  Equipment `sourceKind: 'lore'` or `grantRune`.
- **Strength:** the most story per pick. "I learned this from that boss" is exactly the pillar.
- **Weakness:** your identity is gated by which bosses the match rolled, and a player who loses PvE early is
  identity-starved.

### Option B: The Spellbook draft (a page every round)

After every round, everyone drafts one Lore card from three. You hold up to five; a sixth replaces one.

- **Mechanics:** the same Equipment/rune hosts; the draft is a Start-of-Turn Discover.
- **Strength:** constant progression, nobody starves.
- **Weakness:** drafting every round is noise. It turns abilities into a second shop and dilutes the monster link.

### Option C: Sigil Alchemy (components that combine)

Monsters drop **Sigils** (Flame, Frost, Storm, Wild, Shade, Coin), like TFT components. A lone Sigil is a small
passive. Two Sigils fuse into a named ability by recipe: Flame + Storm is Firestorm, Shade + Wild is Evergreen Dead.
Six Sigils make 21 recipes.

- **Mechanics:** a Sigil is a rune with a `school` tag; a fusion is a reducer action that removes two and grants the
  recipe's Lore. The Runeforge UI (4 offers, buy one) can display the recipes you can currently make.
- **Strength:** the deepest build-around and the most "breaks the formula" system. Theorycrafting fuel.
- **Weakness:** 21 recipes is a lot of content and text, and the recipe table is a knowledge wall for a party mode.

### Option D: The Mantle (a class that emerges)

No choices at all: every piece of loot carries a School tag, and when one School reaches three, you awaken its
**Mantle**, a class passive in the hero-power slot.

- **Mechanics:** the Ancients awakening, keyed off a school count instead of a refresh meter.
- **Strength:** zero friction, a big ceremony moment, "I became a Gravecaller" is a great beat.
- **Weakness:** alone, it is passive. Nothing to *do*.

### Recommendation: Lore and Mantle (A as the source, rank-ups for depth, D as the capstone, C-lite later)

**No heroes.** Every seat is the **Wanderer**: a hidden technical hero def (`wanderer`, 40 Health, 0 Armor, power
kind `mantle`) so every hero-shaped code path still has a hero to read. The hero portrait shows the player's
profile picture (the Versus player card already does this), until a Mantle awakens.

**Three kinds of identity, three existing UI slots:**

| Slot (existing UI) | Holds | Limit | Engine host |
| --- | --- | --- | --- |
| Hero-power slot | Your **Mantle** (empty until it awakens) | 1 | New `HeroPowerKind 'mantle'`, passive, Ancients-style awakening |
| Equipment slot (the second power slot, free switching) | Your active **Lore** | 3 Lore total, active or passive | Equipment with `sourceKind: 'lore'` |
| Rune row | Your passive **Lore** and your **Relics** | 3 Lore (shared limit above) + up to 6 Relics | Runes via `grantRune` |

**The Lore rules:**

1. **The Spark.** Round 1 opens on a Discover of three **Spark** Lore (Rank I basics, three different Schools). You
   start with one Lore slot open.
2. **Slots open with the big fights.** Slot 2 opens at the first Elite (round 4), slot 3 at Boss I (round 8), win or
   lose. From then on a Lore pick ranks up or replaces. Losing never closes a slot.
3. **Learning.** Beating a boss: choose 1 of its 2 Lore. Beating an elite: choose 1 of 3 Lore of its School. The
   Treasure Wheel and the Bazaar can carry Lore scrolls.
4. **Ranks.** Learning a Lore you already know ranks it up: I, then II, then III. Rank III is the Gilded frame and
   gets a twist, not just bigger numbers. (Equipment already has a Gilded variant; ranks generalise
   `params` / `gildedParams` into a per-rank params list.)
5. **A full book.** Learning a fourth Lore replaces one. The replaced Lore becomes a **Faded Page** Trinket
   (1 Gold, *"Get 3 Gold."*), so a swap never feels like a pure loss.
6. **Schools.** Every Lore and Relic carries one School: **Flame, Frost, Storm, Wild, Shade, Coin.** (Not "Ember":
   Embers is the old display name for Gold.)

**The Mantle rules:**

- The moment you hold **three things of one School** (Lore and Relics both count), its **Mantle awakens**: the Shop
  pauses for the awakening ceremony (the Ancients' ceremony), the hero-power slot fills, and the hero portrait takes
  the Mantle's frame. One Mantle per match, never replaced.
- A Mantle is a passive class bonus **plus** "+1 Rank to every Lore of this School" (a Rank III Lore of your Mantle's
  School stays Rank III but gains its Mantle line).
- The six Mantles: **Pyromancer** (Flame), **Frostwarden** (Frost), **Stormcaller** (Storm), **Wildheart** (Wild),
  **Gravecaller** (Shade), **Corsair** (Coin). Text in section 6.6.

**Fusion (full vision, C-lite).** At the **Sigil Forge** (the Runeforge screen, round 12 in the full route), you may
fuse two Lore you know into a recipe Lore, freeing a slot. Ship six recipes, not 21 (section 6.6).

**Why this one.** It hits the pillar directly (Lore comes from monsters), it gives every player a pick every few
rounds without a second shop, the Mantle is a free ceremony moment that needs no input, and it is buildable almost
entirely on Equipment and runes. Options B and full C stay on the shelf as twist rounds: a "Spellbook Night" Omen
(section 4.6) can turn on B for one match.

**How actives behave in a real-time match.** Each active Lore has its own charge once per turn (the Equipment rule)
and some carry a **cooldown in turns** (a new Equipment field, `cooldownTurns`, shown as the countdown number in the
slot, the Gambler-dice lock pattern). Combat payoffs ride next-combat spells, so a Lore used in the Shop shows its
mark on the board and casts at Start of Combat for the side that owns it. Jumpstart Jules's bonus Equipment charge
feeds Lore too, because Lore is Equipment: an emergent synergy for free.

---

## 4. Round structure and pacing

### 4.1 The table

- **4 seats**, real time, one room. Empty seats are filled by recorded Plunder runs or bots (section 11.6).
- **40 Health each, no Armor** (no heroes means no hero Armor). Health is real: healing and Health-touching cards
  work as printed.
- **Economy is the normal game's**: 3 Gold, +1 a round, cap 10; minion 3, sell 1, refresh 1; tiers 1 to 6; the
  shared finite pool. Loot adds Gold on top, usually as "next turn" Gold.
- **The route is public.** The round header carries a pill with this round's type and the next two
  (`Duel`, `Boss next`). No new chrome: the existing Round header and its pill style.

### 4.2 The standard route (18 rounds plus overtime)

| Round | Type | What happens | Loss costs |
| --- | --- | --- | --- |
| 1 | **Camp** (PvE) | Spark pick, then a weak camp. Everyone fights the same camp at once. | 2 |
| 2 | **Camp** | A second camp from the Act I deck. | 2 |
| 3 | **Duel** (PvP) | First player fights. Two duels at once. | cap 5 |
| 4 | **Elite** (PvE) | Elite from the deck. Win: 1 of 3 Lore of its School, or a Relic. Lore slot 2 opens. | 4 |
| 5 | **Duel** | | cap 5 |
| 6 | **Treasure Wheel**, then **Duel** | The Wheel: a shared ring of loot, lowest Health picks first. | cap 8 |
| 7 | **Duel** | | cap 8 |
| 8 | **Boss I** (PvE) | 1 of 3 early bosses, seeded per match. Win: learn 1 of 2 Lore + its Trophy. Chest by damage. Lore slot 3 opens. | 6 |
| 9 | **Duel** | | cap 8 |
| 10 | **Twist** (vote), then **Duel** | Everyone votes 1 of 3 twists; Haunts vote too. | cap 12 |
| 11 | **Duel** | | cap 12 |
| 12 | **Treasure Wheel**, then **Elite** | Full vision: the Sigil Forge opens here too. | 4 |
| 13 | **Duel** | | cap 12 |
| 14 | **Boss II** (PvE) | 1 of 3 late bosses. Its Lore ranks up or replaces. | 6 |
| 15 | **Duel** | | cap 16 |
| 16 | **The Raid** | Everyone alive fights the same Raid boss; damage is pooled; never costs Health. | 0 |
| 17+ | **Duel** every round | **Doom**: every loss costs 2 more per round past 16 (R17 +2, R18 +4, ...). Every 4th round (R20, R24) is an **Abyss** PvE. | uncapped + Doom; Abyss 10 |

**Duel damage** is the engine's own formula (the winner's tavern tier plus the tiers of its surviving minions,
`simulate.ts`), under the route's cap table (`LobbyRules.lossCaps`, the mechanism Gauntlet already uses). **PvE
damage** is a flat amount on a loss, never the formula, so a monster cannot one-shot a player.

**Tuning targets** (for the headless sim, section 11.10): first knockout around round 10 to 12, the match decided
between round 16 and 20, under 5% of matches reaching round 24.

### 4.3 Pairing

- **4 alive:** two duels per PvP round, paired by the existing `pairRunLobby` logic (deterministic, avoids an
  immediate rematch).
- **3 alive:** one duel plus a **bye**. The bye fights a **ghost**: the latest eliminated seat's board from the round
  it fell (the existing ghost rule, including "a ghost is never a rematch"). In Plunder, that ghost belongs to its
  Haunt (section 7.5), who may Hex it.
- **2 alive:** one duel a round, the Final.
- **PvE rounds:** every living seat fights its own copy of the same encounter. Same board for everyone, a different
  fight seed per seat, so the comparison "who cleared it" is fair and fun to compare.

### 4.4 The clock

Versus uses the standard ramp (`standardTurnSeconds`: 21 s on round 1, 60 s by round 10, 92 s by round 15). Four
players waiting on the slowest of four would drag that to 30 minutes, so Plunder runs its own shorter table (still
one server deadline, still no Gold Fuse):

| Rounds | Shop seconds |
| --- | --- |
| 1 to 3 | 25 |
| 4 to 8 | 35 |
| 9 to 13 | 45 |
| 14+ | 55 |

A round ends when all living players lock or the deadline passes. The combat cap is **60 s** (Versus uses 90 s); a
player who is back early sees "Players ready 3/4" on the End Turn gem (the Versus pill with a bigger number).

**Length math (worst case, nobody locks early):** shop 735 s across 18 rounds, fights about 25 s each (camps are
short, bosses long) for 450 s, the two Wheels and the vote about 90 s. **About 21 minutes.** Typical, with early
locks: 16 to 19 minutes.

### 4.5 Elimination and spectating

- **Death's Door** (once per player per match, only while 3 or more are alive): the first time you would be knocked
  out, you are not. Next round you skip your normal round and fight **the Reaper's Toll**, a PvE board scaled to the
  round. Win and you return at **10 Health** with the **Second Wind** Relic (*"After you lose a fight, give your
  minions +1/+1."*). Lose and you are out. The announcer calls it for the whole table.
- **Knocked out:** you become a **Haunt** (section 7.5). You stay in the room with the Versus spectator screen,
  switch between living players with 1 to 4, keep your emotes, and each round you cast one Haunting.
- **Placement** (1st to 4th) is shown at the end with the awards (section 8.4). It feeds nothing: no rank, no MMR.

### 4.6 Event rounds and twists

**The Treasure Wheel** (rounds 6 and 12, before the shop). A ring of 5 items is revealed: minions with Infusions,
Relics, Lore scrolls, a Trophy on round 12. Players pick one each, in order of **lowest Health first** (ties: the
match seed), 8 seconds per pick, a random pick on timeout. Four players, five items: the leader always leaves one
on the table, and everyone sees what the leader passed on. Presentation: the Discover overlay showing all five
cards, a portrait ring on each taken card, and the "Players ready" pill naming whose pick it is.

**The Twist vote** (round 10, and every 5th round in overtime). Three twists from the deck are offered as Discover
cards; every living player and every Haunt votes (a Haunt counts as half a vote). Most votes wins; a tie goes to
the twist the last-place player voted for. The twist modifies that round's shop and fight only. The deck:

| Twist | Effect for this round |
| --- | --- |
| **Bazaar** | A shared market of 4 lots opens beside your shop. Sealed bids in Gold, highest wins, pays the second-highest bid plus 1. Section 7.1. |
| **Chaos Shop** | Every Shop minion arrives **Mutated** (a random Infusion and +1/+1). Refreshes are free for the first 10 seconds. |
| **Blood Moon** | Duel damage is doubled. The winner of each duel heals 5. |
| **Swap Meet** | At lock, give one minion from your board to the player on your left. No pick: a random one. |
| **Gold Rush** | Every refresh is free. The shop clock is 20 seconds. |
| **Heist Night** | Every minion in every duel has **Loot (1 Gold)**. Bounties pay double. |
| **Treasure Goblin** | A 1/12 Treasure Goblin with **Taunt** and **Loot (8 Gold)** joins the far right of every board. Kill theirs. |
| **Fog of War** | No scouting this round. You see your opponent when the fight starts. |

**Omens** (full vision). One per match, rolled at the start, shown on the room card, pinned to the match like a rift
(`RunState.rift` pattern): *Rich Veins* (Loot drops +1 Gold), *Spellbook Night* (Option B: a Lore draft after every
PvE round), *Long Night* (route extended, 50 Health), *Monster Mash* (camps become elites), *Twin Bosses* (round 8
and 14 are both bosses from the late pool), *Glass Cannons* (all minions +2 Attack, PvE costs double).

---

## 5. PvE content: camps, elites, bosses, the Raid

### 5.1 Principles

- **PvE is a gradient, not a coin flip.** Monsters carry **Loot** (a new keyword, section 6.1): kill one, bank its
  Loot, even if you lose the fight. Bosses pay a chest by **damage dealt**. A player who loses a boss fight still
  walks away with something, so a weak player is never shut out of the loot loop.
- **Same encounter for everyone.** The comparison is the fun: four screens, one Storm Wyrm, and the stands can watch
  who cracked it.
- **Bosses are authored foes**, the Gauntlet's shape: a board per round, a tier, run buffs, optional runes. Boss
  mechanics are ordinary minion effects on a `token: true` boss card, so the engine resolves them symmetrically and
  the server bundle runs them unchanged.
- **Scaling is by round, never by player strength.** Fixed boards per round keep it fair and seed-exact. The chest
  thresholds do the rubber-banding.

### 5.2 Camps (Act I, rounds 1 and 2)

| Camp | Board | Personality | Loot |
| --- | --- | --- | --- |
| **Ratling Nest** | 3 Ratlings 1/1 | Pure tutorial. Shows the Loot pill. | Each Ratling: Loot (1 Gold) |
| **Mudgrub Burrow** | 2 Mudgrubs 1/3 Taunt, Grub Queen 2/4 *"Echo: summon two 1/1 Grubs."* | Teaches Taunt walls and Echo. | Queen: Loot (a Trinket) |
| **Brigand Ambush** | Cutpurse 2/1 Stealth, Lookout 2/3, Smuggler 3/4 | Introduces the mode tribe you can buy later. | Smuggler: Loot (2 Gold) |
| **Wisp Circle** | 4 Wisps 1/2 *"Echo: give a random enemy minion -1 Attack."* | Death by a thousand cuts. | Each Wisp: Loot (1 Gold) |

Win a camp: Gold from its Loot plus a **Bronze chest** (2 Gold next turn, or a Trinket: Choose One).

### 5.3 Elites (rounds 4 and 12)

Round 12 versions have about 2.2 times the stats and one more body.

| Elite | Board (round 4) | Mechanic | Teaches (choose 1 of 3) |
| --- | --- | --- | --- |
| **The Iron Sentinel** | Sentinel 3/14, **Taunt, Resilient Ward** + 2 Rivets 2/2 | *"When this loses its Ward, give the other Rivets Ward."* A shield-cracking puzzle. | Frost Lore |
| **Hexwitch Coven** | 3 Hexwitches 3/3 | *"Start of Combat: give the highest-Attack enemy minion -2 Attack."* Three of them stack on your carry. | Shade Lore |
| **Cinder Swarm** | 6 Cinder Imps 1/1 | *"Echo: deal 1 damage to a random enemy minion."* Wide boards melt. | Flame Lore |
| **The Brigand Crew** | Cutthroat Captain 4/5 + 3 Cutpurses 2/1 Stealth | Captain: *"Rally: steal 2 Attack from the minion this attacks."* | Coin Lore |

Win an elite: the Lore pick (or a Relic instead, player's choice) and a **Silver chest** (Discover a Relic).

### 5.4 Bosses

A boss fight is a full board: the **boss minion** (huge, with two or three mechanics) and a **court**. Round 8 bosses
come from the early pool, round 14 from the late pool, one each, seeded per match.

**Chests by damage** (the share of the boss minion's Health you removed; read from the fight's event log, see
section 11.4):

| Damage to the boss | Chest |
| --- | --- |
| under 25% | Bronze: 2 Gold next turn, or a Trinket |
| 25% to 74% | Silver: Discover a Relic |
| 75% or more (not killed) | Gold: Discover a Relic (4 options) + an Infusion |
| **Killed** | Gold chest + **the boss's Trophy** + **learn 1 of its 2 Lore** |

A win requires killing the boss and its court. A player who kills the boss but loses to its court still takes the
Trophy and the Lore (the kill is what counts), and still pays the 6 Health for the loss.

#### Early pool (round 8)

**Grizzlemaw, the Den Mother** (Wild)
- Board: Grizzlemaw **8/40** + 2 Cubs 2/2.
- **Litter:** *"The first 3 times this takes damage, summon a 2/2 Cub."*
- **Enrage:** *"At half Health, gain +6 Attack and Taunt."*
- Personality: a wall that keeps pupping. Wide, cleaving boards eat the Cubs; burst boards hit Enrage and regret it.
- Lore: **Call the Litter**, **Overgrowth**. Trophy: **Grizzlemaw's Firstborn**.

**Vexis, the Storm Wyrm** (Storm)
- Board: Vexis **10/32 Flurry** + 2 Storm Drakes 3/3.
- **Overcharge:** *"Every 3rd attack this makes deals 2 damage to ALL enemy minions."* Live text: *"(next in 2)"*.
- **Lightning Rod:** *"Has Immune while a Storm Drake lives."*
- Personality: kill the Drakes first or nothing touches her. Ward boards laugh at Overcharge.
- Lore: **Chain Lightning**, **Tailwind**. Trophy: **Stormscale Hatchling**.

**Mother Lode, the Gilded Golem** (Coin)
- Board: Mother Lode **6/30** with **three Resilient Wards' worth** of plating + 3 Gold Nuggets 0/4 Taunt
  *"Loot (2 Gold)."*
- **Plated:** *"Has Ward that takes 6 hits to break."* (Resilient Ward generalised to N hits.)
- **Jackpot:** *"Echo: whoever killed this gets 10 Gold."* (Loot, but big.)
- Personality: a piñata. Low threat, absurd payout. Venom and Execute do nothing until the plating is gone.
- Lore: **Midas Strike**, **Compound Interest**. Trophy: **Golemling of the Lode**.

#### Late pool (round 14)

**Morrowmist, the Drowned Queen** (Frost)
- Board: Morrowmist **14/60** + 3 Drowned Courtiers 5/5 **Rise**.
- **Undertow:** *"Start of Combat: move the highest-Attack enemy minion to the far right."*
- **High Tide:** *"Whenever a friendly minion Rises, give it +3/+3."*
- Personality: your carry is shoved to the back, and her court keeps coming back bigger.
- Lore: **Frost Nova**, **Undertow**. Trophy: **Drowned Courtier**.

**The Hollow King** (Shade)
- Board: The Hollow King **12/50 Rebirth** + 4 Hollow Squires 4/4.
- **Crown of Bones:** *"Whenever a friendly minion dies, this gains its Attack."*
- **Rebirth:** comes back once with his full current body, stolen Attack included.
- Personality: kill the King first, or kill everything else and face a 30 Attack rebirth. A genuine sequencing
  puzzle in an auto-battler, solved through Taunt, positioning and Lore.
- Lore: **Raise the Fallen**, **Soul Tithe**. Trophy: **Crown of the Hollow King**.

**The Ringmaster** (wildcard)
- Board: The Ringmaster **9/45** + Juggler 4/6 + Strongman 8/8 + Clown Car 2/2 *"Echo: summon three 1/1 Clowns."*
- **Showtime:** *"Start of Combat: swap the Attack and Health of every enemy minion."*
- **Encore:** *"At half Health, swap them back."*
- Personality: chaos. Tall-Health boards suddenly hit like trucks; glass cannons crumble. The stands love it.
- Lore: one random Lore of **any** School (Rank II), plus **Grand Finale**. Trophy: **Juggling Imp**.

### 5.5 The Raid (round 16)

All living players fight the **same Raid boss in parallel**, each on their own screen, and **damage is pooled**.
The shared Raid bar (an existing progress-bar primitive, `transform: scaleX` only) fills as each fight's damage
events play out on every client.

- **Cleared** (pooled damage reaches the Raid's Health): everyone who fought gets a **Raid chest** (Discover a
  Trophy from the full Trophy list). The **Kill Shot** (the player whose damage crossed the line, by event time) gets
  the Raid's own Trophy.
- **Not cleared:** everyone gets a Gold chest instead.
- The Raid never costs Health. It is the one co-operative beat in a knockout mode, and it lands exactly when the table
  is down to two or three and tension is highest.

| Raid boss | Raid Health | Board (per player) | Mechanic |
| --- | --- | --- | --- |
| **Kragg the Ever-Burning** (Flame) | 130 x players alive | Kragg 12/200 + 2 Magma Hounds 6/6 | *"Rally: deal 1 damage to all enemy minions."* *"At 66% and 33% Health, summon a Magma Hound."* |
| **The Leviathan** (Frost) | 120 x players alive | Leviathan 0/180 Taunt + 4 Tentacles 5/8 | *"Has no Attack. Whenever a Tentacle dies, summon a Tentacle."* (up to 6 times) |

Kill Shot Trophies: **Heart of Kragg**, **Leviathan's Eye** (section 6.3).

### 5.6 The Reaper's Toll and the Abyss

- **The Reaper's Toll** (Death's Door): the Reaper 4/4 *"Rebirth. Start of Combat: gain +3/+3 for every round
  played."* plus a court scaled to the round (round 12: Reaper 40/40 with 3 Shades 6/6). Brutal on purpose; it is a
  second chance, not a free one.
- **The Abyss** (overtime, every 4th round past 16): every living player fights the same Abyss board, which grows
  +20% each visit. A loss costs **10**. With two players left, the Abyss can decide the match without them ever
  touching each other, which is a great "the house wins" moment.

### 5.7 How PvE punishes and rewards

| Outcome | Punish | Reward |
| --- | --- | --- |
| Camp loss | 2 Health | Loot from whatever you killed |
| Elite loss | 4 Health | Loot only. No Lore. |
| Boss loss | 6 Health | Chest by damage. Lore slot still opens. |
| Boss kill | none | Gold chest, Trophy, Lore |
| Raid | never | Raid chest or Gold chest, Kill Shot Trophy |
| Abyss loss | 10 Health | none |

---

## 6. Loot and mode-only content

All mode-only cards live in the Plunder set's own directory and never appear in Ranked, Practice or Versus (section
11.1). In the tables, **Reuse** names an existing primitive; **NEW** names one this mode would add.

### 6.1 The Loot keyword (the mode's signature mechanic)

> **Loot (X):** *When this dies, whoever killed it gets X.*

- X is Gold (banked for next turn), a Trinket, a Relic pick or a card. A Loot pill on the portrait shows X (the
  existing keyword pill style). Kills mid-fight pay mid-fight (R-REALTIME-01): the Gold float and coin sound on the
  kill, a Trinket going to hand live through the existing live `toHand` path.
- **Symmetric** (R-SYMMETRY-01): your Loot minions pay your opponent when they die. A Smuggler is free Gold for you,
  and a juicy target for them.
- **Cross-phase** (R-PHASE-01): a Loot minion you destroy in the Shop (Consume, Soul Tithe) pays you.
- Engine: NEW `lootDrop` onDeath factory that writes to a per-side carry-back (`CombatResult.loot` for each side),
  landed by the reducer at settle (Gold next turn, Trinkets already in hand). "Whoever killed it" uses the killer's
  side, the same attribution the on-kill/Slaughter path already tracks.

### 6.2 The mode tribe: Brigands (6 minions, buyable in Plunder only)

| Card | Tier | Stats | Text | Engine |
| --- | --- | --- | --- | --- |
| **Cutpurse** | 1 | 2/1 | **Slaughter:** get **1 Gold** next turn. | Reuse: Slaughter + next-turn Gold (Robin's `sellGold` bank) |
| **Lookout** | 2 | 2/3 | **Shout:** Discover a **Trinket**. | Reuse: `discover` over the Trinket pool |
| **Smuggler** | 3 | 3/4 | **End of Turn:** get **1 Gold** next turn. **Loot (2 Gold).** | Reuse: EoT gold; NEW: Loot |
| **Fence** | 3 | 3/3 | When you play a **Trinket**, give your Brigands **+2/+2**. | Reuse: `spellCast` filtered to `gift` spells |
| **Cutthroat Captain** | 5 | 5/6 | **Rally:** steal **2 Attack** from the minion this attacks. | NEW: `rallyStealAttack` (combat-only, symmetric) |
| **The Hoardmaster** | 6 | 7/9 | **Start of Combat:** give every enemy minion **Loot (1 Gold)**. Your Loot pays double. (Now: **2 Gold** each.) | NEW: grant Loot; live text for the doubled value |

Gilded versions double the numbers (Hoardmaster: Loot (2 Gold), paying 4). Brigands need a new `Tribe` member
(`'brigand'`); the union is the shared boundary in `packages/core/src/types.ts`, so this is a coordinated change,
the same one every new tribe has made.

**Creep-only tokens** (never buyable, appear in camps and can be won from them): Ratling 1/1, Mudgrub 1/3 Taunt, Grub
Queen 2/4, Wisp 1/2, Cinder Imp 1/1, Hexwitch 3/3, Rivet 2/2, Treasure Goblin 1/12, Mimic 4/4. After a camp win,
**Capture**: the Bronze chest's Choose One gains a third branch, *"Get a copy of a minion from this camp."*

### 6.3 Boss Trophies (unique minions, `token: true`)

| Trophy | From | Tier | Stats | Text |
| --- | --- | --- | --- | --- |
| **Grizzlemaw's Firstborn** | Grizzlemaw | 3 | 4/5 Beast | **Taunt. Avenge (2):** summon a **2/2 Cub**. |
| **Stormscale Hatchling** | Vexis | 4 | 3/6 Dragon | **Flurry. Rally:** deal **2** damage to a random enemy minion. |
| **Golemling of the Lode** | Mother Lode | 4 | 2/8 Mech | **Resilient Ward.** When this loses a Ward, get **1 Gold** next turn. |
| **Drowned Courtier** | Morrowmist | 5 | 5/5 Undead | **Rise. Start of Combat:** give the highest-Attack enemy minion **-3 Attack**. |
| **Crown of the Hollow King** | Hollow King | 6 | 6/6 Undead | Whenever a friendly minion dies, this gains its Attack. |
| **Juggling Imp** | Ringmaster | 5 | 4/4 Demon | **Start of Combat:** swap the Attack and Health of a random enemy minion. |
| **Heart of Kragg** | Kragg (Kill Shot) | 6 | 8/8 neutral | **Start of Combat:** deal **1** damage to all enemy minions. Repeat for every Flame Lore you know. (Now: **3 times**.) |
| **Leviathan's Eye** | Leviathan (Kill Shot) | 6 | 2/12 neutral | **Taunt.** Whenever this is attacked, summon a **2/4 Tentacle**. |

Trophies can be tripled only with themselves (a Trophy is rare enough that a triple is a highlight-reel moment). Every
Trophy is built from existing primitives (Avenge summon, Rally damage, Ward-break trigger, SoC debuff, on-friendly-
death gain, the Hollow King's gain-on-death), except the Juggling Imp's stat swap (NEW, shared with the Ringmaster).

### 6.4 Relics (passives in the rune row)

Relics are runes in a `PLUNDER_RELICS` array that no Runeforge reads, granted through `grantRune`.

| Relic | School | Text | Engine |
| --- | --- | --- | --- |
| **Lucky Horseshoe** | Coin | Your Loot drops give **1 more Gold**. | NEW reward kind (reads the Loot carry) |
| **Bounty Hunter's Badge** | Coin | Beating the player with the Crown pays you **4 more Gold**. | NEW (match bounty hook) |
| **Wanderer's Boots** | Coin | You see **1 more option** in every Discover and every loot pick. | Reuse: Discover option count |
| **Bloodied Banner** | Wild | After you lose a fight, give your minions **+1/+1**. | Reuse: post-combat permanent buff |
| **Glutton's Pouch** | Wild | **End of Turn:** give a random friendly minion **+1/+1** for every Trinket in your hand. (Now: **+3/+3**.) | Reuse: EoT buff + hand count; live text |
| **Crown of Thorns** | Flame | **Start of Combat:** deal **1** damage to all enemy minions for every 10 Health you are missing. (Now: **2**.) | NEW: reads the seat's Health (on the combat side) |
| **War Drum of the Wilds** | Storm | Your **Rally** minions have **+2 Attack**. | Reuse: tribe/keyword aura pattern |
| **Storm Rod** | Storm | Your Start of Combat damage deals **+1** for every Storm Lore you know. (Now: **+2**.) | NEW small mod |
| **Frozen Heart** | Frost | Your **Ward** minions have **+3 Health**. | Reuse: aura pattern |
| **Ghost Lantern** | Shade | Your minions that **Rise** come back with **+2/+2**. | Reuse: the onRise buff path |
| **Ferryman's Coin** | Shade | At **Death's Door**, the Reaper has half its stats. | NEW (Death's Door hook) |
| **Second Wind** | Wild | After you lose a fight, give your minions **+1/+1**. Only from Death's Door. | Reuse (as Bloodied Banner) |

### 6.5 Trinkets (one-use hand spells, `gift: true`)

Trinkets are Gift-class hand spells: they never enter the Shop pool, sit in the 10-card hand, and are cast like any
hand spell. The ones that touch other players are marked; they only ever touch **your current opponent** (whose
prepared side the fight already has) or go through a visible **match effect** (section 7).

| Trinket | Cost | Text | Touches | Engine |
| --- | --- | --- | --- | --- |
| **Smoke Bomb** | 1 | **Next combat:** your minions have **Stealth** until they attack. | you | Reuse: next-combat spell + Stealth |
| **Molotov** | 1 | **Next combat:** deal **3** damage to the two leftmost enemy minions at Start of Combat. | your opponent's board | Reuse: next-combat SoC damage |
| **Elixir of Giants** | 2 | Give a minion **+6/+6** for the next combat. | you | Reuse: combat-only buff |
| **Pickpocket** | 0 | **Next combat:** get a copy of a random spell in your opponent's hand. | your opponent (copy, never steal) | NEW: reads the enemy side's `handSpellIds` |
| **Treasure Map** | 1 | Your next PvE fight drops **double Loot**. | you | NEW flag on the Loot carry |
| **Bounty Poster** | 0 | Put a **Bounty** on another player. The next player to beat them gets **5 Gold**. | another player | NEW match effect |
| **Haunted Coin** | 0 | Give this to another player. They get **2 Gold** now. At their next Start of Turn, you get **3 Gold**. | another player (positive sum) | NEW match effect |
| **Pact of Coin** | 0 | Choose another player. If you both win this round, you each get **3 Gold**. | another player (positive sum) | NEW match effect |
| **Mimic Chest** | 2 | Discover a **Relic**. One time in four it bites: get a **4/4 Mimic** with **Taunt** and **Loot (3 Gold)** instead. | you | Reuse: Discover; seeded roll |
| **Faded Page** | 1 | Get **3 Gold**. | you | Reuse: `gainGold` |

### 6.6 Lore (the learned abilities)

Ranks print the current rank's numbers only (live text rule); the table lists all three for design.

| Lore | School | Type | Rank I | Rank II | Rank III (twist) | Source | Engine |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Firebolt** | Flame | Active, 1 Gold | **Next combat:** at Start of Combat, deal **3** damage to a random enemy minion. | **5** damage | **5** damage, **twice** | Spark, Cinder Swarm | Equipment casting a next-combat spell |
| **Kindle** | Flame | Passive | Whenever a friendly minion dies, deal **1** damage to a random enemy minion. | **2** | **2**, and a kill by Kindle repeats it | Cinder Swarm, Kragg | Rune + `QuestCombatMods` (Blood Trail shape) |
| **Molten Core** | Flame | Active, free, cooldown 3 turns | Give a friendly minion **+4 Attack** and **"Rally: deal 2 damage to all enemy minions"** for the next combat. | +6 Attack | permanent, cooldown 4 | Kragg Raid chest | NEW: Equipment `cooldownTurns`; granted Rally (exists) |
| **Ice Block** | Frost | Active, 1 Gold, friendly | Give a friendly minion **Ward** for the next combat. | **Resilient Ward** | Resilient Ward, **permanent** | Spark, Iron Sentinel | Reuse: Warden's grant-Ward path |
| **Frost Nova** | Frost | Active, 2 Gold | **Next combat:** give all enemy minions **-1 Attack** (to a minimum of 1). | **-2** | **-3**, and they lose **Flurry** | Morrowmist, Iron Sentinel | Reuse: next-combat spell; debuff primitive |
| **Undertow** | Frost | Passive | **Start of Combat:** move the highest-Attack enemy minion to the far right. | also gives it **-2 Attack** | moves the **two** highest | Morrowmist | NEW: SoC reposition (shared with the boss) |
| **Tailwind** | Storm | Passive | Your leftmost minion has **Flurry**. | two leftmost | they also **attack immediately** | Spark, Vexis | Reuse: granted Flurry; "attacks immediately" (R-ORD-05) |
| **Chain Lightning** | Storm | Active, 2 Gold | **Next combat:** at Start of Combat, deal **4** damage to a random enemy minion, then **3**, **2** and **1** to others. | starts at **5** | starts at **6**, and a kill extends the chain by one | Vexis | Reuse: next-combat SoC damage; NEW chained-target param |
| **Static Field** | Storm | Passive | Every **4th** attack your minions make deals **2** damage to all enemy minions. (Next in **3**.) | every **3rd** | every **3rd**, **3** damage | Vexis court, Storm elites | NEW: side-wide attack counter (the boss's Overcharge) |
| **Overgrowth** | Wild | Passive | **End of Turn:** give your lowest-Health minion **+2/+2**. | **+3/+3** | **+3/+3** to lowest-Health **and** highest-Attack | Spark, Grizzlemaw | Reuse: recurring EoT entry (Ancient Time's pattern) |
| **Call the Litter** | Wild | Active, 2 Gold | Get a **2/2 Cub** with **Taunt**. | **3/3** Cub | **3/3** Cub with **Avenge (2): summon a Cub** | Grizzlemaw | Reuse: `battlecryGetHandSpell`-style token grant |
| **Raise the Fallen** | Shade | Passive | The first friendly minion to die each combat **Rises**. | first **two** | the first gets **Rebirth** instead | Hollow King | Reuse: Rise grant (Lord of the Risen) |
| **Soul Tithe** | Shade | Active, free, friendly | Destroy a friendly minion. Give its stats to a random other friendly minion. Get **1 Gold**. | **2 Gold** | also triggers its **Echo** | Spark, Hollow King | Reuse: the `devour` hero power's body; Echo via `asEcho` |
| **Hex** | Shade | Active, 1 Gold | **Next combat:** the highest-Attack enemy minion loses **Ward** and **Taunt**. | also **-3 Attack** | hits the **two** highest | Hexwitch Coven | Reuse: next-combat spell; keyword strip |
| **Lucky Find** | Coin | Passive | Your first refresh each turn is **free**. | first **two** | and the first refresh each turn has a minion from one tier higher | Spark | Reuse: refresh discount; Pete's `contraband` |
| **Midas Strike** | Coin | Active, 3 Gold, friendly, once per game | Make a friendly minion **Gilded**. | twice per game | 3 times, cost 2 | Mother Lode | Reuse: the `gild` hero power body |
| **Compound Interest** | Coin | Passive | When you win a PvE fight, get **2 Gold** next turn. | **3** | **3**, and a **Coin** Trinket | Mother Lode, Brigand Crew | NEW: PvE-win hook |
| **Grand Finale** | wildcard | Active, free, once per game | **Next combat:** at Start of Combat, every friendly minion **attacks immediately**, left to right. | | | Ringmaster | Reuse: "attacks immediately"; next-combat spell |

**The Mantles** (hero-power slot, passive):

| Mantle | Awakens on | Text |
| --- | --- | --- |
| **Pyromancer** | 3 Flame | Your Flame damage deals **+1**. When an enemy minion dies to Flame damage, deal **1** damage to another. |
| **Frostwarden** | 3 Frost | **Start of Combat:** the leftmost enemy minion has **0 Attack** until it is attacked. |
| **Stormcaller** | 3 Storm | Your minions with **Flurry** have **+2 Attack**. Your chains jump **2** more times. |
| **Wildheart** | 3 Wild | Your **End of Turn** buffs from Lore and Relics trigger **twice**. |
| **Gravecaller** | 3 Shade | Your minions that **Rise** come back with full Health. |
| **Corsair** | 3 Coin | Your **Loot** drops pay double. Bounties you claim pay double. |

**Fusion recipes** (full vision, at the Sigil Forge; each frees a slot):

| Fuse | Into | Text |
| --- | --- | --- |
| Firebolt + Chain Lightning | **Firestorm** | **Next combat:** at Start of Combat, deal **3** damage to 4 random enemy minions. Each one that dies deals **2** to its neighbours. |
| Frost Nova + Tailwind | **Blizzard** | **Next combat:** enemy minions lose **Flurry** and have **-2 Attack**. Your leftmost two have **Flurry**. |
| Raise the Fallen + Overgrowth | **Evergreen Dead** | The first two friendly minions to die each combat **Rise** with the stats Overgrowth gave them. |
| Soul Tithe + Midas Strike | **Golden Sacrifice** | Destroy a friendly minion. Make a random other friendly minion **Gilded**. |
| Kindle + Static Field | **Wildfire** | Whenever a friendly minion dies or makes its 3rd attack, deal **2** damage to all enemy minions. |
| Lucky Find + Compound Interest | **Dragon's Hoard** | Your first refresh each turn is free. When you win any fight, get **2 Gold** next turn. |

### 6.7 Infusions and mutated cards

An **Infusion** is a School ability grafted onto one minion for the rest of the match. It shows on the portrait
medallion through the existing granted-trigger system (`grantedEffects`, `MinionSnapshot.grantedTriggers`,
R-MEDAL-GRANTED-01), and the card text gains one line with an "Infused" pill.

| Infusion | Adds |
| --- | --- |
| Flame | **Rally:** deal **1** damage to a random enemy minion. |
| Frost | **Ward.** |
| Storm | **Flurry.** |
| Wild | **End of Turn:** gain **+1/+1**. |
| Shade | **Rise.** |
| Coin | **Slaughter:** get **1 Gold** next turn. |

Worked examples on real cards:

- **Infused Blaster (Shade):** *"Taunt. Rise. Echo: deal 3 damage to ALL minions."* The Echo fires twice. A board
  wipe that comes back for a second wipe.
- **Infused Matriarch (Storm):** *"Flurry. When you cast a spell, give your minions +3 Health."* A 12-Health
  double-swinger.
- **Infused Rising Pup (Flame):** *"Taunt. Rise. Rally: deal 1 damage to a random enemy minion."* The best Tier 1
  pickup in the mode.
- **Infused Jumpstart Jules (Coin):** *"Start of Turn: gain an Equipment charge. Slaughter: get 1 Gold next turn."*
  Because Lore is Equipment, Jules's bonus charge lets you cast a Lore twice a turn. Players will find this.

**Mutated** (the Chaos Shop twist): a Shop minion that arrives with a random Infusion and +1/+1, and a green
"Mutated" pill. Buy it and it stays Mutated. **Feral** (an Omen variant): double Attack, half Health, same text.

### 6.8 Chests and loot tables

| Chest | Contents |
| --- | --- |
| Bronze | **Choose One:** 2 Gold next turn; or Discover a Trinket; (camps) or Capture a camp minion. |
| Silver | Discover a Relic (3). |
| Gold | Discover a Relic (4) + a random Infusion on a minion of your choice. |
| Raid | Discover a Trophy (3) from every Trophy. |

**Underdog's Due:** the player with the lowest Health sees one more option in every chest (stacks with Wanderer's
Boots). Loot rolls are seeded per seat and per round (section 11.5), never `Math.random`.

---

## 7. Player interaction beyond combat

Rule of thumb for every interaction: **visible, bounded, and never stops someone from playing.** No "skip their
turn", no "destroy their best minion", no hidden damage. A sabotage is always a small, telegraphed tax, and the
biggest interactions are positive-sum.

### 7.1 The Bazaar (twist round)

- Four lots beside the shop: e.g. a Relic, a Lore scroll, a Trophy, a Mutated Tier 5 minion.
- **Sealed bids** in Gold during the shop phase (bid on as many lots as you like). Gold you bid is held, so bidding
  big means shopping small this turn.
- At lock: highest bid wins and pays the second-highest bid plus 1 (a Vickrey auction, so honest bidding is right).
  Ties go to the lowest Health. Losing bids are refunded as next-turn Gold.
- The reveal is a beat: all four bids appear on the lot at once. *"Bea bid 9 for a Relic. Cass bid 1."*
- Server-owned: bids go up with the locked side; the server settles.

### 7.2 The Crown (bounty on the leader)

- At the start of every duel round, the player with the most Health wears the **Crown** (a pill on their plate;
  ties: no Crown).
- Beating the Crown pays **4 Gold** next turn and a **Trinket**. The Crown itself pays nothing extra to wear.
- It turns the leader into a target everyone wants to draw, without letting anyone gang up mechanically.

### 7.3 Player-targeted Trinkets

**Bounty Poster**, **Haunted Coin** and **Pact of Coin** (section 6.5) are the only out-of-combat effects that name
another player, and two of the three are positive-sum. Each lands as a **match effect**: a server row, shown on the
target's plate with the caster's portrait, and announced (*"Dev put a Bounty on Alex."*).

### 7.4 The Twist vote

Everyone, Haunts included, votes; the vote reveal is a beat. Voting is a soft negotiation: the leader wants Gold
Rush, the player in last wants Blood Moon. Emotes carry the table talk.

### 7.5 Haunts (the eliminated keep playing)

When you are knocked out you become a **Haunt** and stay in the room with the spectator screen.

- **Each shop phase, a Haunt gets a Discover of 3 Hauntings** and casts one on any living player. Half are Boons,
  half are mild Hexes:

| Haunting | Kind | Effect on the target's next round |
| --- | --- | --- |
| **Blessing** | Boon | Give their lowest-Health minion **+3/+3** permanently. |
| **Lucky Charm** | Boon | Their next refresh is free. |
| **Whisper of Gold** | Boon | They get **2 Gold** next turn. |
| **Rattle** | Hex | Their next refresh costs **2**. |
| **Fog** | Hex | Their next Shop has **one fewer** minion. |
| **Chill** | Hex | **Next combat:** their leftmost minion has **-2 Attack**. |

- **Limits:** one Haunting per Haunt per round; a player can be Hexed at most once per round; Hauntings never deal
  Health damage.
- **Your ghost is yours.** When a living player draws your ghost on a bye, you may Hex your own ghost's opponent for
  free. If your ghost wins, you earn **Revenge**.
- **Back a champion.** Once, a Haunt can pledge to a living player. If that player wins the match, the Haunt earns
  the **Kingmaker** award (and the XP bonus).
- Engine: Hauntings are match effects (section 11.7), applied at the next Shop open or as next-combat marks on the
  target's prepared side.

### 7.6 Emotes and the table

The Versus emote seam carries four seats plus the stands (spectator emotes exist, R-SPECTATE-EMOTE-01). Add mode
emotes as cosmetics later: *"Nice loot."*, *"Worth it."*, *"Run."*

---

## 8. Less competitive, more fun

### 8.1 What makes it a party mode

- **Unranked forever:** no rank, no MMR, no snapshot upload into the ranked pool. XP and achievements like Versus.
- **Loud variance on purpose:** the encounter deck, Mimic chests, the Ringmaster, Swap Meet, Treasure Goblins, the
  Twist vote, Omens. Skill still wins more often than not, but a weaker player wins often enough to keep coming back.
- **Short matches:** 16 to 22 minutes, with something new on screen every round.

### 8.2 Comeback and rubber-banding

| Mechanic | Who it helps | How |
| --- | --- | --- |
| **Underdog's Due** | lowest Health | +1 option in every chest |
| **Treasure Wheel order** | lowest Health | picks first |
| **The Crown** | everyone but the leader | 4 Gold + Trinket for beating the leader |
| **Bazaar ties** | lowest Health | wins ties |
| **Twist ties** | last place | breaks the tie |
| **Chests by damage** | weak PvE boards | still get Bronze or Silver |
| **Death's Door** | anyone, once | a second chance at 10 Health |
| **Crown of Thorns, Bloodied Banner** | whoever holds them | scale with being behind |
| **Haunts** | the eliminated | still play, still score awards |

What is deliberately **not** rubber-banded: duel outcomes and damage. Fights stay fair; only the loot leans.

### 8.3 Keeping a losing player engaged

- Every PvE round is a fresh shot at loot regardless of standing.
- The Raid lets a player at 5 Health land the Kill Shot and the best Trophy in the game.
- Death's Door turns "I'm out" into the most watched fight of the night.
- Haunts keep a voice: hexes, boons, votes, ghost revenge, Kingmaker.

### 8.4 Party scoring: awards at the end

The end screen (reusing the Versus "Previous match stats" room panel plus the end-of-game placement reveal) shows
placement 1st to 4th, then **awards**, each a title-style banner with the player's portrait. Every award is computed
from the round rows and event logs (deterministic, no voting):

| Award | For |
| --- | --- |
| **Champion** | 1st place |
| **Kill Shot** | landed the Raid's final blow |
| **Giant Slayer** | killed the most bosses |
| **Hoarder** | most Gold from Loot |
| **Heist of the Night** | biggest single Bazaar win (value minus price) or the most Bounty Gold |
| **Biggest Hit** | the single largest damage instance in any fight |
| **Tall Order** | the largest minion seen all match |
| **Comeback Kid** | won at Death's Door, or finished higher than their Health rank at round 10 |
| **Kingmaker** | a Haunt whose champion won |
| **Revenge** | a Haunt whose ghost won a fight |
| **The Mantle** | first to awaken a Mantle |

Each award grants a little XP (+10), so the 4th-place player with three awards leaves happy. Achievements later:
*"Learn from every boss"*, *"Win at Death's Door"*, *"Triple a Trophy"*.

---

## 9. Example runs

Four players each, all on the standard route. Health after each round in brackets where it matters.

### Run 1: "Storm Night" (four friends, Omen: Rich Veins, Loot +1 Gold)

- **R1 Spark.** Alex takes **Tailwind** (Storm), Bea **Overgrowth** (Wild), Cass **Lucky Find** (Coin), Dev
  **Firebolt** (Flame). Ratling Nest: Dev's Firebolt kills a Ratling before the fight starts, a 2 Gold pop on round 1.
  Everyone clears it.
- **R2 Mudgrub Burrow.** Bea's Overgrowth Taunt wall walks it. Alex loses to the Grub Queen's Echo (38), but he
  killed the Queen before her Grubs finished him, so her Loot hands him a **Molotov** Trinket anyway.
- **R3 Duels.** Alex beats Cass with a Tier 2 board. Dev beats Bea.
- **R4 Elite: Cinder Swarm.** Six imps pinging on death shred Bea's wide board (36). Dev wins and learns **Kindle**.
  Alex wins and, instead of Lore, takes **War Drum of the Wilds**. He wants Storm.
- **R5 to R7.** Duels trade evenly. On the R6 Wheel, Cass (lowest at 31) picks first and grabs an **Infused Rising Pup
  (Flame)**; Alex, leading, is left the Mimic Chest nobody wanted. It bites: a 4/4 Mimic with **Loot (3 Gold)**. The
  room laughs. The Mimic goes in his Taunt slot and pays Cass 3 Gold two rounds later.
- **R8 Boss I: Vexis, the Storm Wyrm.** The stands flip between four screens. Bea and Cass never kill the Drakes and
  Vexis stays Immune: Bronze chests. Dev kills the Drakes, gets Vexis to 30%, Silver chest. Alex's Tailwind Flurry
  minion with War Drum kills both Drakes in its first two swings, and his board finishes Vexis through her second
  Overcharge. **Kill.** He learns
  **Chain Lightning** and takes the **Stormscale Hatchling**. At the start of round 9 that is his third Storm piece
  (Tailwind, War Drum, Chain Lightning): **the Stormcaller's Mantle awakens**, the shop pauses, the ceremony plays, his
  portrait takes the Mantle frame. His chains now jump twice more.
- **R9.** Alex's Chain Lightning opens the duel with 4, 3, 2, 1 before anyone attacks. Bea loses (24).
- **R10 Twist vote:** Bazaar, Swap Meet, Blood Moon. Swap Meet wins 3 to 1 (Alex voted against). Bea hands Alex a
  Ratling token. Alex's random pick hands Cass his Hatchling. Cass's emote: *"Worth it."*
- **R11.** Without the Hatchling, Alex leans on the Mantle he woke on round 9 (below) and wins on chains alone.
- **R12 Elite: Hexwitch Coven.** Dev, at 12 Health, sees four options (Underdog's Due) and takes **Crown of Thorns**.
- **R13.** Dev loses to Alex and hits 0. **Death's Door.** The announcer calls it.
- **R14.** Everyone else fights the Hollow King; Dev fights the **Reaper's Toll** alone, and every spectator switches to
  him. Crown of Thorns is missing 40 Health: 4 damage to every enemy at Start of Combat, then Kindle chains off the
  deaths. He wins with one minion at 1 Health and returns at 10 with **Second Wind**.
- **R15.** Bea is knocked out by Cass and becomes a Haunt. She backs Dev.
- **R16 The Raid: Kragg.** Alex, Cass and Dev fight Kragg; Bea casts **Blessing** on Dev. The Raid needs 390 (130 x 3). The bar
  fills: Alex's chains do 170, Cass 80, and in the last two seconds of Dev's fight his Crown of Thorns and Kindle tick it
  over 390.
  **Cleared. Kill Shot: Dev.** He takes the **Heart of Kragg**, which repeats once per Flame Lore he knows.
- **R17 to R19.** Cass falls to Alex on R18. The Final is Alex against Dev. Doom adds +6 by R19. Alex's Stormcaller
  chain opens for 6, 5, 4, 3, 2, 1, plus two jumps. Dev's Heart of Kragg pings twice. Alex wins with two minions left.
- **Awards:** Alex **Champion**, **Giant Slayer**, **The Mantle**. Dev **Kill Shot**, **Comeback Kid**. Cass **Tall
  Order** (the Hatchling, swapped to her, grew to 31/40). Bea's champion came 2nd, so no Kingmaker, but she takes
  **Biggest Hit** from a round 9 Blaster. 19 minutes.

### Run 2: "The Heist" (three friends and one recorded fill-in, Omen: none)

Cass, Bea and Alex queue; the fourth seat fills with a recorded Plunder run, *"Mira's run"*, served round by round.

- **R1 Spark.** Cass takes **Lucky Find** and decides, out loud, that she is going pirate.
- **R2 Brigand Ambush.** Cass kills the Smuggler for 2 Gold, then buys a **Smuggler** of her own on round 3.
- **R3 to R5.** Cass loses two duels on purpose-ish, rolling with free refreshes for Brigands: Cutpurse, Fence,
  Lookout. Her Lookout's Shout finds **Pickpocket**. Against Bea in R5 it copies Bea's held **Clue**, a free spell
  that keeps paying. Cass (31).
- **R6 Wheel.** Cass, lowest, picks first: **Lucky Horseshoe**.
- **R8 Boss I: Mother Lode.** Everyone loves this draw. The plating takes six hits; Cass's Cutpurses with
  Stealth chip it while the Nuggets pay 2 Gold each. Bea kills Mother Lode and gets the **10 Gold Jackpot**, plus
  **Midas Strike**. Cass learns nothing but pockets 9 Gold of Loot (Horseshoe included) and a Silver chest.
- **R9.** Bea's wifi drops. The 15-second grace runs out and the **bot pilot** takes her seat (her plate reads Auto):
  it buys sensibly, locks, and her board fights Alex. She is back on round 10 to a board she recognises.
- **R10 Twist: Bazaar.** Lots: Crown of Thorns, a Rank II **Compound Interest** scroll, the **Golemling of the Lode**
  Trophy, a Mutated Tier 5. Bea bids 9 on the Trophy. Cass bids 1 on everything and 6 on Compound Interest. The reveal:
  Cass wins Compound Interest at 2 (Alex bid 1) and the Golemling at 1, because nobody else bid on it after Bea's
  9 went to the Mutated minion. **Heist of the Night** is decided right there.
- **R11.** Cass's third Coin piece: **the Corsair's Mantle**. Loot pays double.
- **R12 Elite: The Brigand Crew.** Cass learns **Compound Interest** again (Rank III): every PvE win now pays 3 Gold
  and a Coin. Mira's recorded board, which had been strong all match, loses the elite.
- **R13.** Alex posts a **Bounty Poster** on Cass, now the Crown. Mira's recorded seat beats Cass and "collects" it: Gold
  paid to a recording does nothing, so the Bounty simply evaporates. Alex had not planned on that.
- **R14 Boss II: The Ringmaster.** Showtime swaps every stat. Cass's 2/8 Golemling becomes an 8/2 and kills the
  Strongman. She kills the Ringmaster and takes the **Juggling Imp**.
- **R15.** Alex is knocked out by Mira's seat. He hexes Cass with **Rattle**, then backs Bea.
- **R16 Raid: The Leviathan.** Tentacles everywhere. Not cleared (pooled 330 of 360). Gold chests all round; Cass
  takes an Infusion on her Smuggler.
- **R17.** Cass buys **The Hoardmaster**. Start of Combat: every enemy minion has Loot, and as a Corsair it pays 4
  Gold each. She kills six of Bea's minions and banks 24 Gold for next turn.
- **R18.** Cass spends 34 Gold: Tier 6, two refreshes, a triple, a Gilded Hoardmaster. Bea falls; Mira's seat falls
  on R19.
- **Awards:** Cass **Champion**, **Hoarder** (71 Gold from Loot), **Heist of the Night**. Bea **Giant Slayer**.
  Alex **Revenge** (his ghost beat Mira's seat on a bye). 20 minutes.

### Run 3: "Graveyard Shift" (four friends, Omen: Twin Bosses)

Twin Bosses: rounds 8 and 14 are both drawn from the late pool. Everyone knows it from the room card and builds for it.

- **R1 Spark.** Dev takes **Soul Tithe** (Shade). Alex **Ice Block**. Bea **Firebolt**. Cass **Tailwind**.
- **R1 to R4.** Dev Tithes his Tier 1 minions into one big body each turn, grabbing 1 Gold every time. R4 Hexwitch
  Coven: Dev wins and learns **Hex**. Bea, all-in on economy, loses the elite (31).
- **R6 Wheel.** Bea picks first and takes an **Infused Blaster (Shade)**: Rise plus a board-wipe Echo. She now has
  a reason to go Shade too.
- **R8 Boss I: The Hollow King** (early, because of the Omen). A brutal round-8 boss at its late stats, toned to
  80%. Three players lose to the Rebirth, two of them at under 25% (Bronze). Dev's Hex strips the King's court Taunt,
  his Tithe-fed 18/18 kills the King first, and the King's Rebirth returns with only his own Attack. **Kill.**
  Dev learns **Raise the Fallen** and takes the **Crown of the Hollow King**. Dev's Shade count hits 3: **the
  Gravecaller's Mantle awakens** on round 9, the earliest Mantle of the night.
- **R9.** Cass is down to 14 after the boss and an R9 loss to Dev.
- **R10 Twist: Chaos Shop.** Every Shop minion arrives Mutated. Alex rolls into a Mutated Revenant with Frost (Ward)
  and freezes on it; Bea buys three Mutated minions in 10 seconds of free refreshes.
- **R11.** Cass is knocked out early by Bea's double Blaster wipe. Death's Door: the Reaper is at round-12 strength
  and Cass loses. She becomes the first Haunt. She backs Alex.
- **R12 to R13.** With three alive, the bye rotates; Cass Hexes her own ghost's opponent each time. On R13 her ghost
  (her R11 board plus a **Chill**) beats Bea. **Revenge.**
- **R14 Boss II: Morrowmist.** Undertow shoves Dev's 30-Attack Crown of the Hollow King to the back; her court Rises
  at +3/+3. Alex kills her through Ice Block Resilient Ward stalls. Alex learns **Frost Nova**.
- **R16 Raid: Kragg.** Dev, Alex and Bea clear it (Kill Shot: Bea, a Firebolt Rank III). Bea takes **Heart of Kragg**.
- **R17 to R19.** Bea falls to Dev on R18. The Final is Dev against Alex, and the two boards stall: Dev's dead keep
  rising, Alex's Wards keep holding. Two draws in a row, Doom rising.
- **R20: the Abyss.** Both fight the same Abyss. Alex's Frost Nova and Ward wall survive it. Dev's Gravecaller army
  rises three times and still runs out. **Dev takes 10 and is out. The Abyss decided it.** The stands erupt.
- **Awards:** Alex **Champion**. Dev **The Mantle**, **Giant Slayer**, **Tall Order** (Crown of the Hollow King at
  41/6). Bea **Kill Shot**. Cass **Revenge**, **Kingmaker** (her champion won). 22 minutes.

What the three runs show: three Mantles, three different relationships with PvE (farm it, rob it, sequence it), a
fill-in seat that played like a person, a disconnect that cost nothing, and three different finishes (a clean final,
an economy snowball, the house winning).

---

## 10. Exciting moments catalogue

The moments the design deliberately manufactures, and the system that makes each one:

| Moment | Made by |
| --- | --- |
| **The Kill Shot**: the Raid bar crossing the line in the last second of someone's fight | Pooled Raid damage, live bar on every screen |
| **Learning from the boss you just killed** | Boss Lore, the Learn pick |
| **The Mantle awakens** mid-shop | School count, the Ancients ceremony |
| **Death's Door**: a 1-Health player fighting the Reaper while the whole room watches | Death's Door, spectator switching |
| **The Bazaar reveal**: four bids flipping at once | Sealed-bid lots |
| **The Mimic bites** | 25% Mimic Chest |
| **Swap Meet betrayal**: your random gift was your best minion | Swap Meet twist |
| **Showtime**: the Ringmaster swaps every stat | Boss mechanic |
| **Rebirth with stolen Attack**: the Hollow King comes back at 30 Attack | Boss mechanic, Rebirth |
| **The Jackpot**: Mother Lode pays 10 Gold | Loot on a boss |
| **Loot raining**: a Corsair Hoardmaster farming an opponent's whole board | Loot keyword, Corsair Mantle |
| **Ghost revenge**: a Haunt's ghost knocks out a living player | Haunts, ghost byes |
| **Kingmaker**: the stands' pledge pays off | Haunt pledge |
| **The Abyss decides the Final** | Overtime Abyss rounds |
| **The leader passes on the Wheel**: everyone sees what they left | Wheel order, 5 items for 4 |
| **A Trophy triple** | Trophy-only triples, Wheel and Raid chests |
| **Chain Lightning before the first swing** | Next-combat Lore at Start of Combat |
| **The Treasure Goblin escape**: you could not kill it, they could | Twist |

---

## 11. Architecture mapping

### 11.1 Content: the Plunder set

- New directory `packages/content/src/cards/plunder/`: `brigands.ts`, `creeps.ts` (tokens), `bosses.ts` (tokens),
  `trophies.ts` (tokens), `trinkets.ts` (`gift: true` hand spells), `lore.ts` (Equipment definitions plus the
  passive-Lore rune defs), `relics.ts` (`PLUNDER_RELICS`, never in `RUNES` / `EPIC_RUNES`), `encounters.ts` (camps,
  elites, bosses, raid, Reaper, Abyss as `GauntletRound`-shaped rows: board, tier, buffs, runes), `loot.ts` (chest and
  Wheel tables, weights).
- A set entry `plunder` in `sets.ts`: `inherits` the base pool Kevin picks (open question), `own: [...PLUNDER_BRIGANDS]`.
  It stays `enabled: false` forever, because `activeSet()` is first-enabled-wins; the mode **pins it explicitly** at
  run creation (`createRun(..., setId)` already takes a set id, as `createGauntletRun` does). `card-sets.md` gains one
  paragraph: "a mode set is never enabled; its mode pins it".
- `poolOf` in `plunder` mode drops cards that read things the mode lacks: hero-power multipliers (Rune of Empowerment's
  `requiresDoublePower`), Pre-emptive Assault (as Versus), anything Armor-only. Same mechanism as the Versus
  exclusion.
- Every new card and Lore needs live text on both chains (`liveCardText` and `Unit.tsx`): Static Field's counter,
  Crown of Thorns's damage, Heart of Kragg's repeats, the Hoardmaster's doubled Loot, every Lore's rank.

### 11.2 Sim: `packages/sim/src/plunder/`

Mirrors `packages/sim/src/versus/`, bundle-safe modules marked:

| Module | Job | Bundle |
| --- | --- | --- |
| `route.ts` | The match's round types from the route table, Omen and seed | yes |
| `encounters.ts` | Build a PvE `PreparedCombatSide` from an encounter row (the authored-seat path Gauntlet uses) | yes |
| `pairing.ts` | Duel pairs and the bye/ghost over 4 seats (wraps `pairRunLobby` rules) | yes |
| `combat.ts` | Resolve every fight of a round: up to 4 PvE or 2 PvP + 1 ghost, one `simulate()` each | yes |
| `match.ts` | Pure match state: Health, damage, caps, Doom, Crown, Death's Door, eliminations, placement | yes |
| `loot.ts` | Chest and Wheel offers from `mixSeed(matchSeed, round, seat, TAG.LOOT)` | yes |
| `matchEffects.ts` | Bounty, Haunted Coin, Pact, Hauntings: ordered, deterministic application | yes |
| `run.ts` | `createPlunderRun` (Wanderer, 40 Health, pinned set), timeout policy, catch-up | no |
| `lore.ts` | Learn, rank, replace, fuse; Mantle awakening | no |
| `finalize.ts` + `server.ts` | The server handler and the bundle entry | yes |

- `RunMode` gains `'plunder'`. `RunState` gains a small `plunder` block: known Lore `{ id, rank }[]`, Mantle id,
  School counts, pending loot picks, Death's Door used. Everything else (Equipment, runes, hand, board) is the run's
  ordinary state.
- **Isolation, as Versus:** never `ascent.save`, never the ranked rank queue, never the opponent-pool upload, never a
  replay draft in the ranked slot. A `plunderIsolation.test.ts` like `versusIsolation.test.ts`.

### 11.3 The ability system

- **Active Lore = Equipment** with `sourceKind: 'lore'`, held for the match (the rune-owned Equipment lifecycle:
  re-granted at every Start-of-Turn rebuild, no body). New fields: `ranks: params[]` (generalising
  `params` / `gildedParams`) and `cooldownTurns`. The second power slot already supports several Equipment with free
  switching; three Lore fit.
- **Passive Lore and Relics = runes** granted by `grantRune`, so combat passives ride `QuestCombatMods` and
  snapshots carry them for free (fill-ins fight with their Lore).
- **Mantle = a new `HeroPowerKind 'mantle'`** on the Wanderer: passive, empty until awakened, its effect a rune-style
  reward plus a rank bump read by `lore.ts`. Excluded from Mimic / Void / Power Shifter pools (`UNDISCOVERABLE_KINDS`).

### 11.4 PvE resolution and boss chests

- An encounter is built server-side and client-side from bundled content, so the server **never trusts a client's
  PvE board**.
- Chest tier needs "damage dealt to the boss minion". Two options: derive it from the event log (sum of damage events
  whose target is the boss uid; pure and already deterministic), or add a small result field
  (`CombatResult.bossDamage`). Recommend the result field: it is cheaper to read, and the server and both clients read
  one number.
- Raid pooling and the Kill Shot need per-fight damage **timelines** (event time of each damage event to the boss).
  The client already has the event log; the server computes the Kill Shot from the four logs at commit.

### 11.5 Determinism and seeds

- One match seed, server-owned. Every random thing forks from it: the route Omen and encounter deck
  (`mixSeed(seed, 0, TAG.PLUNDER_ROUTE)`), each fight (`versusCombatSeed` generalised with the seat pair), each loot
  offer (`mixSeed(seed, round, seat, TAG.LOOT)`), twist decks, Mimic rolls. No `Math.random` anywhere.
- **Private offers stay private:** loot offers live in a per-seat private row (the `versus_seat_private` pattern, which
  already hides hero offers), so nobody can precompute another seat's chest.

### 11.6 Rooms, seats and fill-ins

- **Rooms:** clone the Versus tables as an additive `plunder_*` set (`rooms`, `members`, `matches`,
  `seat_private`, `submissions`, `rounds`, `spectator_frames`, `match_effects`), seats `p1` to `p4`. Changing the
  Versus tables in place would break the "additive migrations only" rule and risk a live mode. The RPC and Realtime
  patterns, the room cards, drag-to-seat (R-VERSUS-DRAG-SEAT-01), the gate crystal and the 30 s window back to Open
  are reused as they are.
- **Fill-ins (empty seats at Start):** the host may start with 2 or 3 people. Each empty seat is filled by:
  1. a **recorded Plunder run** from a mode-only pool table (`plunder_runs`, never mixed with the ranked pool),
     served by round number with the same integrity rules as the lobby (R-LOBBY-07, R-LOBBY-SERVE-01: whole runs,
     round N is that run's round-N board, empty rounds serve empty). The recording stores each round's
     `PreparedCombatSide`, which already contains the run's Lore combat mods, Relics, Trophies, Infusions and
     next-combat marks, so the fill-in **carries its loot by construction**. It fights PvE rounds with its
     round-N board against this match's encounter; its Health is this match's. Shop-phase Hauntings on a fill-in are
     shown but do nothing; combat Hexes apply to its side.
  2. a **bot seat** (the sim's greedy bot, `packages/sim/src/bots`) when the pool has no eligible run. Bot policy
     for Lore and loot picks starts at "random legal" and improves later.
- **Recording:** every human seat's prepared side per round uploads to `plunder_runs` at match end (unranked pool,
  so trust posture can stay "client-authored", like Versus).

### 11.7 Real time, server resolve and match effects

- **The round state machine** is Versus's (`open, sealed_gate, shop, resolving, combat, complete`) with three
  additions: `event` (the Wheel picks and the Twist vote, short server-timed phases), `loot` folded into the next
  shop's Start-of-Turn modal queue (`openNextStartOfTurnModal`), and the bye/ghost.
- **Finalize** generalises `versus/finalize.ts`: read up to four final sides, build the round's PvE or ghost sides,
  run each fight once (`resolvePlunderRound`), apply `match.ts` (damage, eliminations, Death's Door, Crown), roll the
  next loot offers, write one idempotent round row. CPU is trivial: four `simulate()` calls.
- **Match effects** (Bounties, Haunted Coin, Pacts, Hauntings, Swap Meet gifts, Bazaar wins) are server rows with a
  `round`, `from`, `to`, `kind`. They reach the run through one new reducer action, `applyMatchEffects { effects }`,
  dispatched at each Shop open in a fixed order (by row id). The run stays deterministic: the effects are inputs, like
  a Versus `landCombat { fight }`.
- **The bundle:** a `plunder-resolve` Edge Function (or a `mode` switch inside `versus-resolve`; recommend a separate
  function so a Plunder content deploy never risks Versus parity). Same content-revision check, same parity fixtures
  (`plunder:parity`, Node source vs bundle, byte for byte).
- **Disconnects:** a four-player table cannot pause for one person. Plunder grants **one 15 s pause per player per
  match**; after that, or after the pause, the **bot pilot** plays the absent seat (shop included, not just the last
  board), its plate marked Auto. Coming back reclaims the seat at the next shop. Three fully missed rounds forfeit
  (the Versus rule). The bot pilot is the same bot that fills empty seats.

### 11.8 Spectators

- The Versus spectator screen already switches players instantly with cached views; Plunder extends 1 / 2 to 1 to 4
  and adds a "Raid" view (the four Raid fights' bar plus whichever fight is selected). Haunts are spectators with a
  Haunt bar (their Haunting Discover and the pledge button) on the existing spectator HUD positions.
- The no-cost rule holds: a player's client publishes nothing while nobody watches it.

### 11.9 UI reuse checklist (owner rule: reuse existing game UI)

| Need | Existing component |
| --- | --- |
| Room with 4 seats | Versus room cards, drag-to-seat, gate crystal (needs a 4-seat painted backdrop, see art) |
| Seats and Health | The lobby seat rail (built for 8, shows 4 fine) |
| Current opponent or boss | The Versus opponent hero block; the Gauntlet's authored opponent name and portrait |
| Round type | The Round header and its pill |
| Lore actives | The Equipment slot, its switcher, charges, cooldown number |
| Mantle | The hero-power slot, the Ancients awakening ceremony |
| Relics, passive Lore | The rune row badges |
| Lore picks, chests, Wheel, Twist vote, Hauntings | The Discover overlay (and Choose One for Bronze chests) |
| Bazaar | Shop row cards with a bid control on the Gem plate style (`.vsplate`) |
| Raid bar | An existing progress bar, `transform` only |
| Ready count | The End Turn gem's "Players ready N/4" pill |
| Awards | The end-of-game placement reveal and title banners |

### 11.10 Performance and tuning

- **160 fps rule:** nothing new loops on paint properties. The Raid bar animates `transform: scaleX`. Loot pops use
  the existing Gold float and coin cue. Boss fights with many summons (Grizzlemaw, Leviathan) must be profiled in the
  prod build against the 6.25 ms budget before shipping, the same way a big Echo board is.
- **Headless tuning:** four bot seats can play whole Plunder matches in Node (the balance seat runner already plays
  lobbies). Tune boss boards to targets: camps about 85% won, elites about 60%, bosses about 40% killed and 90% at
  least Bronze, the Raid cleared about 55% of the time, match length per section 4.2.

### 11.11 New primitives and systems vs reuse

| New | Size | Notes |
| --- | --- | --- |
| `Loot (X)` keyword, `lootDrop` factory, `CombatResult.loot` carry per side | M | The signature mechanic; symmetric, cross-phase |
| `onHealthThreshold` trigger (Enrage, Raid phases) | M | New trigger family: registry, schema, presentation policy |
| Side-wide attack counter (Overcharge, Static Field) | S | |
| Conditional Immune (Lightning Rod) | S | |
| `rallyStealAttack` | S | Combat-only |
| SoC reposition (Undertow) | S | |
| Stat swap (Showtime, Juggling Imp) | S | |
| Ward with N hits (Plated) | S | Generalises Resilient Ward |
| `copyEnemyHandSpell` (Pickpocket) | S | Reads the enemy side's `handSpellIds` |
| Equipment `sourceKind: 'lore'`, `ranks`, `cooldownTurns` | M | |
| `HeroPowerKind 'mantle'` + awakening | M | Ancients pattern |
| Infusion tag on `grantedEffects` | S | Medallion already reads granted triggers |
| `applyMatchEffects` reducer action | M | |
| `CombatResult.bossDamage` (+ damage timeline for the Raid) | S | |
| Plunder route, encounters, loot, match state | M | Pure, bundle-safe |
| 4-seat rooms, server resolve, event phases | L | Additive SQL, new Edge Function |
| Bot pilot for disconnects and fill-ins | M | Bot exists; needs Lore/loot pick policy |

| Reused unchanged | |
| --- | --- |
| `simulate()`, the symmetric combat side, snapshots | every fight |
| Equipment, rune-owned Equipment, runes, `grantRune` | Lore and Relics |
| Next-combat spells | active Lore payoffs, Trinkets |
| Gifts / hand spells | Trinkets |
| Discover, Choose One, Start-of-Turn modal queue | every pick |
| Authored seats, `GauntletRound` shape, run buffs | every PvE board |
| Lobby pairing, ghosts, loss caps | duels |
| Versus rooms, clocks, locks, candidates, timeout policy, spectate, emotes | the real-time shell |
| Lobby recorded-run serving | fill-ins |

### 11.12 Risks

1. **Waiting on the slowest of four.** Mitigated by the shorter clock, the 60 s combat cap and early locks; measure
   live. If it still drags, fights can auto-skip to the result for a player who is back.
2. **A 4-way real-time state machine** has more failure modes than 1v1 (one seat resolving while another reconnects).
   The idempotent finalize and the reconcile-on-reconnect discipline carry over; the Versus PGlite match test should be
   cloned for four clients before any UI work.
3. **Balance blowouts** from stacked loot (a Corsair Hoardmaster, a Wildheart double End of Turn). Acceptable in a party
   mode up to a point; the headless sim should flag any combo with an over 70% match win rate.
4. **Content volume and live text.** ~60 new defs, each needing correct live text on both chains. Ship in tranches;
   run `npm run text:audit` per tranche.
5. **Mode-only content leaking** into Ranked through `CARD_INDEX` (global by design) or a Discover pool. Pool tests
   per mode, like the Versus Pre-emptive Assault exclusion test.
6. **Shared hot files:** a new tribe and new combat fields touch `packages/core/src/types.ts`; the reducer gains
   `applyMatchEffects`. Coordinate as the ownership map says.
7. **Trust.** Client-authored prepared sides are fine unranked. If Plunder ever gets stakes, it needs the action-log
   verification Versus deferred.

---

## 12. MVP vs full vision

### Phase 0: "Plunder Practice", offline, vs 3 seats (prove the fun, no server work) (size M to L)

A Practice-style local match: the player plus three seats (bots, or recorded runs from Practice), run through the
existing `RunLobby` with `seatCount: 4`, PvE rounds served as authored boards to every seat, the Plunder route. This
tests the loop (does PvE between duels feel good, does loot tell a story, is the length right) before spending a
line on real-time infrastructure.

| In | Size |
| --- | --- |
| Route (fixed, no Omens), 4 camps, 2 elites, 3 early bosses as both Boss I and Boss II (late stats) | M |
| Loot keyword, chests (Bronze/Silver/Gold), boss chests by damage | M |
| Lore: Spark, learn, rank up, replace; 12 Lore (2 per School) | M |
| 8 Relics, 6 Trinkets (self or opponent only), 6 Brigands, 3 Trophies | M |
| The Crown, Underdog's Due, the Treasure Wheel (bots pick at random) | S |
| End awards (6 of them) | S |
| Placeholder art everywhere | S |

**Out of Phase 0:** real time, Mantle, Fusion, Twists, Bazaar, Haunts, Death's Door, the Raid, cross-player
Trinkets, Omens.

### Phase 1: real-time Plunder (4 seats online) (size L)

4-seat rooms and tables, `plunder-resolve`, the parity fixture, the 4-client PGlite match test, synced clocks, the bot
pilot for disconnects, bot fill-ins, spectators 1 to 4. Content as Phase 0 plus the late boss pool.

### Phase 2: the table game (size M to L)

Death's Door, Haunts (Hauntings, ghost ownership, pledge), the Twist vote with 4 twists (Blood Moon, Swap Meet, Gold
Rush, Chaos Shop), the Bazaar, cross-player Trinkets (Bounty Poster, Haunted Coin, Pact of Coin), recorded fill-ins
(`plunder_runs`).

### Phase 3: the full night (size L)

The Mantle and its ceremony, the Raid (Kragg, Leviathan) with the live bar and Kill Shot, the Sigil Forge and six
fusions, Omens, the remaining twists, the remaining Lore (to ~18) and Relics (to ~12), achievements, mode emotes.

### Art (placeholder-first)

| Asset | Placeholder | Final art ask |
| --- | --- | --- |
| Creeps (9 tokens) | existing minion art of a similar creature | 9 card arts |
| Bosses (6 + 2 Raid + Reaper) | existing big minion art in the boss frame | 9 card arts, 9 portraits for the opponent block |
| Trophies (8) | the boss's placeholder | 8 card arts |
| Brigands (6) | existing neutral art | 6 card arts |
| Lore (18) and Relics (12) | existing rune art by School | ~30 icons |
| Trinkets (10) | existing spell art | 10 spell arts |
| Mantles (6) | the player's profile picture with an existing frame cosmetic | 6 Mantle portraits or frames |
| 4-seat room | the Versus room layout over the menu backdrop | one painted 4-seat room (no code-drawn props) |
| Mode tile | an existing mode tile style | one painted tile |

Per the art rules, nothing is wired until Kevin names the files.

---

## 13. Open questions for Kevin

1. **Prototype first?** Phase 0 offline against bots before any real-time work (recommended), or straight to 4 online?
2. **No heroes at all?** Lore and Mantle replace heroes entirely (recommended), or keep a hero pick and add Lore on top?
3. **Health or hearts?** 40 Health with the duel damage formula (recommended), or Versus-style hearts?
4. **Haunt Hexes:** allow the mild Hexes, or Boons only?
5. **Brigands:** buyable in the Plunder shop (recommended), or loot-only?
6. **Base pool:** which set does Plunder inherit (the live set, Set 3, or a curated mix)?
7. **Overtime:** Doom plus Abyss rounds (recommended), or a hard round cap with a Health tiebreak?
8. **Rewards:** XP and achievements only (like Versus), or mode-exclusive cosmetics (Mantle frames, titles)?
9. **Name:** Plunder, Warpath, Raid Night, or another?
