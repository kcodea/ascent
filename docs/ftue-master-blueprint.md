> ## Repo addendum — read this first (added 2026-08-17, Phase 0)
>
> This is the owner's FTUE blueprint, **copied verbatim** into the repo as the FTUE source of truth. The body
> below is unedited — corrections live here in this addendum rather than being rewritten into the author's
> prose, so the original intent stays legible and the drift is explicit.
>
> **1. Vocabulary drift — "Resolve" is now "Health".** The hero's life total was renamed on 2026-08-17
> (display-only; the state field is still `resolve`). The body of this document says **Resolve** throughout —
> in learning objective 5, the Foundation Panel 1 player-facing copy, the economy table, the first-seen
> mechanic matrix, and elsewhere. **Every player-facing string quoted below must be authored as "Health".**
> The `data-tutorial-anchor="resolve"` anchor id is correct as written: anchor ids are internal, matching the
> display-only split recorded in [`GAME-RULES.md`](GAME-RULES.md).
>
> **2. Superseded docs are now marked.** [`tutorial-curriculum-map.md`](tutorial-curriculum-map.md) and
> [`tutorial-and-trials-spec.md`](tutorial-and-trials-spec.md) carry supersession notices as of this commit
> (§Phase 0). They remain in the repo for their non-FTUE content and history.
>
> **3. The presentation contract is less risky than §10.6 implies.** A spike found the semantic signals it
> asks for largely already exist. See [`ftue-spike-presentation-contract.md`](ftue-spike-presentation-contract.md)
> — read it before Phase 1, because it changes what needs building.
>
> **4. Open design work hiding in a sentence.** §6.8 requires three Basic Rune branches that are affordable,
> each produce a visible combat event, and converge to Turn 7 — but says "the exact live Rune IDs must be
> approved against current content." That is unbuilt design, not authoring, and it gates Phase 3.
>
> **5. Content coupling accepted.** Pinning to a `contentRevision` with CI failing on drift means the twelve
> minions this course uses become frozen balance surface: retuning any of them becomes a tutorial
> re-authoring task. That trade is deliberate — noting it so it is not rediscovered as a surprise.
>
> **6. Per-frame anchor reads need a distinction §8.4/§13 do not draw.** Pixi world transforms are already
> computed each frame, so reading them is near-free. DOM anchors are NOT: CLAUDE.md's performance north star
> bans per-frame `getBoundingClientRect`. The registry must cache DOM rects per interaction and only poll Pixi.

# Ascent First-Time Player Experience: Master Blueprint and Implementation Handoff

**Status:** Authoritative product and implementation scope for the first-time player experience.

**Audience:** Product, design, engineering, UI/UX, QA, analytics, content, audio, and FX.

**Scope:** First launch, the universal Learn Ascent course, optional tribe primers, graduation, and support during
the player's first real lobby.

**Deferred:** Tactical Trials, expert puzzles, daily challenges, advanced sequencing tests, and mastery grades.
Those systems should remain pinned until the universal tutorial and tribe-primer framework have shipped and been
validated with new players.

This document consolidates and supersedes the following FTUE documents where they conflict:

- `new-player-experience-blueprint.md`
- `ascent-ftue-playable-scenario-spec.md`
- The FTUE sections of `tutorial-curriculum-map.md`
- The FTUE sections of `tutorial-and-trials-spec.md`

The Tactical Trials handoff remains a future reference, but is not part of this delivery plan.

---

## 1. Executive Decision

Ascent should not ask a first-time player to select a tribe before teaching the game.

The recommended experience has three layers:

1. **Learn Ascent:** one strongly recommended, skippable, 12-round universal tutorial.
2. **Tribe Primers:** five optional six-round courses, selected from a Learn hub after the universal course.
3. **First Real Lobby Support:** small one-time hints that help knowledge transfer without scripting the run.

The first-launch Learn button enters Learn Ascent directly. It does not open a tribe picker.

After Learn Ascent is completed or skipped, the permanent Learn hub contains:

- Learn Ascent: replay or resume the universal course.
- Tribe Primers: choose any available tribe.
- Glossary and Compendium links.
- Tactical Trials: hidden or marked Coming Later until separately approved.

### Why this is better than five full starter tutorials

- A new player does not yet understand what choosing a tribe means.
- Five full tutorials would repeat basic controls and feel like required homework.
- Every duplicated tutorial multiplies balance-patch, economy, combat-fixture, localization, and QA work.
- One coherent course produces a shared vocabulary for every later lesson.
- Short tribe primers can spend their time on identity and engines instead of reteaching how to buy a card.
- The structure scales when sets or tribe combinations rotate.

### Course lengths

| Course | Shape | Target duration | Guidance |
|---|---|---:|---|
| Learn Ascent | Full 12-round lobby | 15-20 minutes | Turns 1-10 guided; Turns 11-12 lightly coached |
| Tribe Primer | Prepared Turn 5 through Turn 10 | 8-12 minutes | Four guided turns; two application turns |
| First real lobby | Normal game | Normal | Dismissible one-time hints only |

The ten-round FTUE remains useful as an implementation milestone, but it should not remain a separate public
course configuration. The finished product should ship the 12-round version.

---

## 2. Product Goals

After Learn Ascent, a player should understand:

1. A run alternates between Shop and automatic combat phases.
2. Gold buys persistent improvements to a seven-minion warband.
3. Minions move from Shop to hand to board.
4. Position and attack order matter.
5. Resolve is health for the run; zero Resolve eliminates a player.
6. Refreshing trades Gold for new options.
7. Freezing preserves the current Shop.
8. Selling creates space and returns Gold.
9. Shop upgrades sacrifice immediate tempo to unlock stronger tiers.
10. Three copies Gild into a stronger card.
11. Shout, Rally, Echo, End of Turn, and Start of Combat happen at different times.
12. Hero powers change how a run is played and may require activation or a target.
13. Basic and Epic Runes are paid, run-long rules that should connect to the current build.
14. The lobby rail shows the next opponent, results, Resolve, and eliminations.
15. Inspection, the Compendium, and the Glossary answer card and keyword questions.
16. A player can independently improve a board and end a turn without waiting for an instruction.

After a tribe primer, a player should additionally be able to:

- State the tribe's basic fantasy in one sentence.
- Recognize two or three cards that form a functional engine.
- Identify at least one Rune that supports that engine.
- Position and sequence the engine through one representative combat.
- Improve the build for two turns without a prescribed purchase.

### Success is transfer, not tutorial completion

The real measure is whether the player can begin and continue a normal lobby. Completion rate alone is not a
valid success metric.

---

## 3. Non-Goals

Learn Ascent does not teach:

- Quests.
- Rifts.
- Scouting and deep opponent counterplay.
- Every keyword.
- Detailed damage math.
- Tier 7 acquisition paths.
- Advanced cross-tribe builds.
- Exact probability or Shop-pool math.
- Tactical puzzle solving.
- Optimal play.

Tribe primers do not teach every line within a tribe. Each primer teaches one representative engine and exposes
one nearby alternative. Advanced lines belong in future Tactical Trials or normal play.

---

## 4. Product Principles

### 4.1 Use the real game

Tutorial actions use the normal reducer, combat simulator, content definitions, presentation system, beats, FX,
audio, lobby damage, Runeforge, Gilding, and post-game screen.

The scenario controls inputs:

- Hero.
- Shops.
- Opponent Omen boards.
- Seeds.
- Lobby pairings and non-player results.
- Coaching and action gates.

It must not fake outputs, directly assign combat wins, inject post-combat damage, or replace real effects.

### 4.2 Teach one concept at a time

Each prompt introduces at most one new rule and one action. A tutorial message should explain why the action is
useful, not merely identify the control.

### 4.3 Let the player perform the action

The player personally buys, plays, targets, reorders, sells, refreshes, freezes, upgrades, Gilds, uses a hero
power, forges Runes, and ends turns.

### 4.4 Use constraints before popups

Scripted Shops and carefully chosen Gold totals should make the lesson's useful action attractive. Hard gates
exist only when an irreversible action would invalidate the lesson.

### 4.5 Protect presentation ownership

Tutorial coaching waits for semantic presentation completion. It never replaces Mike's FX, changes Beat Lab
timings, or advances through arbitrary timeouts while an effect is still playing.

### 4.6 Do not contaminate live systems

Tutorial runs never affect:

- Rating.
- Career or match history.
- Opponent snapshots.
- Balance telemetry.
- Achievements or dailies unless explicitly approved later.
- Leaderboards.

---

## 5. First-Launch and Learn-Hub Experience

## 5.1 First launch

For a profile with neither completion nor skip state, show a focused welcome panel over the title screen.

Primary action:

**Learn Ascent**  
`Build a warband, forge Runes, and win a guided lobby.`

Secondary action:

**Play Now**  
`Skip the tutorial for now. You can return from Learn.`

Do not require account creation, a player name, mode selection, or hero selection first.

The tutorial is strongly recommended but skippable. Skipping records a skip state; it does not mark completion.

## 5.2 Permanent Learn hub

After the first-launch decision, expose a permanent Learn destination.

Recommended hierarchy:

1. **Learn Ascent** - Resume, Start, Completed, or Replay.
2. **Tribe Primers** - A grid of available tribes with progress.
3. **Glossary** - Keyword reference.
4. **Compendium** - Card reference.

Do not show Tactical Trials in the initial launch unless a disabled Coming Later tile is useful for roadmap
communication. It must not compete with the core learning path.

## 5.3 Tribe selection

The tribe picker belongs inside Tribe Primers, not at the first Learn Ascent entry.

Each tribe tile shows:

- Tribe portrait and name.
- One-sentence fantasy.
- Course duration.
- Not Started, In Progress, or Complete.
- The line taught by the primer.
- The content set/version if multiple set versions later exist.

Players may take primers in any order. Completing all primers is not required to play normal modes.

## 5.4 Opening rules foundation

The first experience begins with a short rules foundation before the player sees a normal Shop. This is not a
scrolling rulebook. It is a sequence of four focused panels followed by one interactive board-order
demonstration. Each panel contains one idea, one image or live UI focus, and no more than two short sentences.

### Foundation panel 1: The climb

**Title:** Be the Last Standing

**Text:** `Eight players enter the lobby. Win combats to damage opponents and be the last player with Resolve.`

**Focus:** The full lobby rail, then the player's Resolve badge, then the next-opponent highlight.

The rail animates from eight active seats to a brief illustrative state with one seat crossed out, then returns
to the real tutorial state. This preview is presentation-only and must not mutate the scenario.

### Foundation panel 2: The round loop

**Title:** Build, Then Battle

**Text:** `Each round has a Shop phase and an automatic combat. Spend Gold to prepare before you press End Turn.`

**Focus:** Shop band -> Gold -> warband -> End Turn -> combat half of the phase indicator.

Show a two-step phase strip:

```text
SHOP: buy, play, sell, cast, position
  -> END TURN
COMBAT: your warband fights automatically
  -> NEXT SHOP
```

Do not imply that combat can be directly controlled.

### Foundation panel 3: The warband

**Title:** Build Your Warband

**Text:** `Bought minions enter your hand. Play up to seven minions, and move them freely during the Shop phase.`

**Focus:** One Shop card -> an empty hand slot -> all seven warband slots.

Use ghost movement only for this explanation. No card is actually bought or played until the player performs
the real Turn 1 actions.

### Foundation panel 4: Combat order

**Title:** Position Changes Combat

**Text:** `Your minions normally take turns attacking from left to right. Effects can trigger before, during, or after those attacks.`

**Focus:** Warband slots illuminate 1 through 7 from left to right. A thin arrow travels across the row once.

The expanded Why text, available but not forced, is:

`The side with more living minions attacks first. Ties are random. Some effects grant immediate attacks or change the normal order.`

This wording is intentionally accurate to the simulator:

- The side with more living minions attacks first; a tie uses seeded randomness.
- Each side's normal attack cursor cycles left to right by minion identity and skips minions that cannot attack.
- Start-of-Combat effects resolve player left to right, then enemy left to right.
- Immediate attacks can interrupt the normal rotation.
- The beginner lesson teaches the normal pattern. Exceptions are explained only when the player encounters one.

### Interactive order demonstration

Before opening Turn 1's Shop, place three temporary, non-gameplay silhouettes in warband slots 1, 2, and 3.
Ask the player to move the highlighted silhouette from slot 3 to slot 1. Animate attack-order numbers changing
from `1, 2, 3` to the new order.

**Prompt:** `Drag this minion to the front. Your left-most minion normally attacks first for your side.`

**Completion:** The silhouette occupies slot 1.

**Debrief:** `Good. Position is part of your strategy, and you can change it freely before combat.`

Remove all silhouettes and begin the real lobby. This exercise teaches movement without risking the first
Shop state.

### Information deliberately withheld

Do not explain every keyword, damage formula, Gilding rule, Rune tier, Shop tier, or combat exception here.
Those concepts receive first-use lessons when they become actionable. The player should enter Turn 1 knowing:

1. The goal is to outlast seven opponents.
2. Resolve is life.
3. Shop preparation is controlled; combat is automatic.
4. The warband has seven ordered slots.
5. Normal attacks progress left to right.
6. Card text and position can change what happens.

---

## 6. Learn Ascent: Universal 12-Round Course

## 6.1 Course identity

The universal course uses a coherent Beast Echo build as its teaching vehicle, but it is not branded as the Beast
Primer. It is the Learn Ascent course.

This package works because it makes triggered combat behavior visible:

- Void Panther and T-Rex leave bodies through Echo.
- Wolvie improves a future summoned Beast.
- Echohorn demonstrates that board order can select an effect.
- Dawnclaw and Sea Urchin demonstrate adjacency and cross-keyword interaction.
- Beardsley makes the summon payoff visually obvious.

The Beast Primer should therefore teach the neighboring Wild Hunt/Rally line rather than simply replaying the
same Echo script.

## 6.2 Tutorial hero

Use a tutorial-only hero so roster balance changes cannot break the course.

**Aster, the Guide**  
Hero Power: **Preparation**  
`Give a friendly minion +1/+1. Recharges every other turn.`

Preparation is active and targeted. The course requires the player to activate and drag/select the power on
Turns 1, 3, 8, and 10 where available. Exact recharge behavior must be validated through the real hero-power
system.

Aster never appears in normal hero offers.

## 6.3 Content ownership

Use real shipped player cards, spells, and Runes pinned to a tutorial content revision. Do not create fake player
cards merely to stabilize the script.

Exceptions:

- Aster is tutorial-only.
- Enemy bodies use the existing `omen` token.

CI must fail if a pinned card's ID, tier, cost, classification, relevant text, or Rune behavior changes. A
designer then retunes the course and increments `contentRevision`.

## 6.4 Scenario rules

| Rule | Value |
|---|---|
| Mode | `tutorial_lobby` |
| Set | Set 2 pinned to `contentRevision` for the first release |
| Seats | 8 |
| Rounds | 12 |
| Guided rounds | 1-10 |
| Autonomy rounds | 11-12 |
| Timer | Disabled |
| Gold, prices, upgrades | Normal unless the scenario explicitly provisions a starting state |
| Player Resolve | 30 |
| Combat RNG | Fixed seed per round |
| Basic Runeforge | Normal Turn 6 timing |
| Epic Runeforge | Normal Turn 9 timing |
| Quests and Rifts | Disabled |
| Save and Continue | Enabled at step boundaries |
| Rating/history/upload | Disabled |

## 6.5 Omen-only combat course

Every enemy minion in every FTUE and tribe-primer combat uses the existing `omen` definition:

- Name: Omen Minion.
- No text.
- No effects.
- No keywords.
- Neutral token excluded from normal pools.

Only Attack, Health, and number of bodies may change.

The lobby still presents named opponent seats, portraits, Resolve, history, damage, and eliminations. The board
does not ask the player to parse an enemy engine. Combat is a stage on which the player's effects can be read.

Omen curves are fixture-tuned per course and branch. Do not add Taunt or other rules to repair a fixture. Adjust
stats, count, board order, or seed.

### 6.5.1 Lobby seats and elimination arc

| Seat | Display name | Course role |
|---:|---|---|
| 1 | Player / Aster | Learner |
| 2 | Rook | First easy combat and first player-caused elimination |
| 3 | Vale | Controlled-loss lesson and later rematch |
| 4 | Mira | First Echo observation |
| 5 | Flint | Refresh/freeze package test |
| 6 | Ibis | Gilded package test |
| 7 | Nox | Rune payoff and late rival |
| 8 | Crown | Epic Rune payoff |

Non-player pairing results are authored records, but every player combat runs normally. Eliminations must appear
through the normal rail treatment and eliminated rows remain readable.

### 6.5.2 Starting Omen curve

| Round | Opponent | Ordered Omen stats |
|---:|---|---|
| 1 | Rook | 1/3 |
| 2 | Vale | 5/7 |
| 3 | Mira | 2/5 |
| 4 | Flint | 4/6; 3/4 |
| 5 | Ibis | 8/10; 3/3; 3/3 |
| 6 | Nox | Five 3/4 bodies |
| 7 | Rook | 10/12; 5/5; 5/5; 4/6; 2/4 |
| 8 | Vale | 12/14; 6/7; 6/7; 3/8 |
| 9 | Crown | 16/20; 8/8; 8/8; 6/10; 4/7 |
| 10 | Nox | 20/24; 11/11; 11/11; 9/12; 5/10; 4/6 |
| 11 | Remaining rival | Six fixture-tuned bodies |
| 12 | Final rival | Seven fixture-tuned bodies |

These numbers are migration targets from the prior scripted boards. Fixture tests may change them before ship.
The invariant is the instructional outcome and readable friendly trigger sequence, not the original arithmetic.

## 6.6 Exact guided economy

| Turn | Start Gold | Required spending | End Gold | Shop tier at end |
|---:|---:|---|---:|---:|
| 1 | 3 | Buy Packstrider: 3 | 0 | 1 |
| 2 | 4 | Upgrade to Tier 2: 4 | 0 | 2 |
| 3 | 5 | Sell Packstrider: +1; buy Void Panther: 3; buy T-Rex: 3 | 0 | 2 |
| 4 | 6 | Refresh: 1; buy Void Panther: 3; buy Growth: 2 | 0 | 2 |
| 5 | 7 | Buy frozen T-Rex: 3; buy Void Panther: 3 | 1 | 2 |
| 6 | 8 | Forge Basic Rune: authored cost; buy Wolvie: 3 | Branch-dependent | 2 |
| 7 | 9 | Upgrade to Tier 3: 2; refresh: 1; Echohorn: 3; Growth: 2 | 1 | 3 |
| 8 | 10 | Upgrade to Tier 4: 7; refresh: 1; freeze Sea Urchin | 2 | 4 |
| 9 | 10 | Forge Rune of Dawnclaw: 5; buy frozen Sea Urchin: 3 | 2 | 4 |
| 10 | 10 | Sell one T-Rex: +1; Beardsley: 3; Pre-emptive Assault: 3 | 5 | 4 |
| 11 | Normal | Player choice | Unconstrained | Normal |
| 12 | Normal | Player choice | Unconstrained | Normal |

An automated reducer walkthrough, not prose, is the source of truth for affordability.

### 6.6.1 Scripted Shop manifest

| Turn / roll | Minion offers | Spell offer | Intended lesson |
|---|---|---|---|
| 1 initial | Packstrider, Cinder Clerk, Chipwick Prospector | None | Buy Packstrider |
| 2 initial | Cinder Clerk, Candleback Bulwark, Embermouth Whelp | None | Ignore tempo and upgrade |
| 3 initial | Void Panther, T-Rex, Pouchpincher | None | Sell Packstrider; buy both Echo Beasts |
| 4 initial | Candleback Bulwark, Ashscribe Whelp, Cinder Clerk | Bulwark | Recognize a weak Shop for the plan |
| 4 refresh 1 | Void Panther, T-Rex, Chipwick Prospector | Growth | Buy Panther and Growth; freeze T-Rex |
| 5 frozen/top-up | Frozen T-Rex, Void Panther, Pouchpincher | Growth | Buy T-Rex and third Panther; resolve Gild |
| 6 initial | Wolvie, Candleback Bulwark, Embermouth Whelp | Bulwark | Forge a Basic Rune; buy Wolvie |
| 7 initial | T-Rex, Pouchpincher, Contract Butcher | Bulwark | Upgrade before refreshing |
| 7 refresh 1 | Echohorn, Runic Beetle, Chipwick Prospector | Growth | Buy Echohorn and Growth |
| 8 initial | Runic Beetle, Echohorn, Pouchpincher | Bulwark | Upgrade instead of buying another middle piece |
| 8 refresh 1 | Sea Urchin, Dawnclaw, Beardsley | Pre-emptive Assault | Freeze Sea Urchin; preview future bridge |
| 9 frozen/top-up | Frozen Sea Urchin, Runic Beetle, Beardsley | Pre-emptive Assault | Forge Dawnclaw Rune; buy Sea Urchin |
| 10 initial | Beardsley, Armadiyo, Bullseye | Pre-emptive Assault | Replace a T-Rex; prepare to attack first |

Unused Shop slots contain stable low-synergy legal cards. Exact offer UIDs and queue position are serialized in
the course checkpoint. Turns 11-12 use recovery-capable seeded queues rather than one exact manifest.

### 6.6.2 Formation invariants

By the end of Turn 10:

- Gilded Void Panther is the left-most Echo selected by Echohorn.
- Dawnclaw is adjacent to Sea Urchin.
- Beardsley is present.
- Exactly one plain T-Rex remains.
- The board contains seven minions.

Turns 11-12 may alter the board. Completion requires a legal board and final victory, not preservation of every
Turn 10 card.

## 6.7 Round-by-round course

| Round | Player actions | Lesson | Combat requirement |
|---:|---|---|---|
| Lobby | Inspect self and next-opponent rail rows | Resolve, seats, next opponent, Shop/combat loop | No combat |
| 1 | Buy and play Packstrider; inspect it; use Preparation; End Turn | Buy -> hand -> board; active hero power; Rally | Rally visibly triggers; player wins |
| 2 | Upgrade to Tier 2 instead of buying | Leveling sacrifices tempo and unlocks pieces | Player safely loses to one Omen and sees Resolve fall |
| 3 | Sell Packstrider; buy Panther and T-Rex; position; use Preparation | Selling, packages, board order, Echo | Panther Echo summons Cubs; player wins |
| 4 | Reject weak Shop; refresh; buy Panther and Growth; cast; freeze T-Rex | Refresh, Shop spells, freeze | At least one friendly Echo is readable |
| 5 | Buy frozen T-Rex and third Panther; resolve Gild; restore order | Freeze persistence and Gilding | Gilded Panther Echo is obvious |
| 6 | Compare and buy one of three Basic Runes; buy Wolvie | Runes cost Gold and support an existing plan | Selected Rune visibly changes the combat |
| 7 | Upgrade to Tier 3; refresh; buy Echohorn and Growth; position Echohorn | Engine pieces and left-most selection | Echohorn triggers left-most Echo; first elimination occurs |
| 8 | Upgrade to Tier 4; refresh; preserve Sea Urchin; use Preparation | A second investment unlocks a payoff | Player wins; rail shows elimination progression |
| 9 | Forge Rune of Dawnclaw; buy Sea Urchin; place Dawnclaw adjacent | Epic Runes, adjacency, full-board capacity | Dawnclaw Start-of-Combat Echo triggers Sea Urchin's Shout |
| 10 | Sell a replaceable T-Rex; buy Beardsley; cast attack-first spell | Replacing a good card, finishing an engine | Full guided engine produces a readable win |
| 11 | Improve the board from a seeded but unrestricted Shop | Apply the loop without an answer marker | Several friendly triggers occur; rival survives or takes damage |
| 12 | Make any legal final improvements and End Turn | Independent play and graduation | Real final elimination and lobby victory |

### 6.7.1 Teaching transaction used by every lesson

Every taught concept follows the same six-part transaction. Consistency is important: players should quickly
learn how the tutorial itself communicates.

1. **Orient:** Dim unrelated UI and identify the relevant object.
2. **Name:** State the mechanic or action in plain language.
3. **Predict:** Tell the player what will happen, without resolving it for them.
4. **Act or watch:** The player performs the action, or combat reaches the trigger naturally.
5. **Resolve:** Release the mask while the existing card FX and Beat choreography play.
6. **Confirm:** Briefly focus the result and connect cause to outcome.

Tutorial text must never cover the source card, target card, changing stats, summon slot, or existing FX. The
mask may pause before an authored transaction starts and after it completes. It must not freeze, replace, or
retime the middle of Mike's authored FX.

### 6.7.2 Exact pre-lobby and lobby sequence

1. Play the four opening foundation panels from Section 5.4.
2. Complete the temporary three-slot order demonstration.
3. Reveal the eight-seat lobby rail.
4. Spotlight the player's row and Resolve.
   - `This is you. Lose combat and your Resolve falls. Reach zero and you are eliminated.`
5. Spotlight the highlighted opponent row.
   - `This is your next opponent. You will prepare without seeing their exact board.`
6. Allow hover/tap inspection of every row, but only the self and next-opponent rows advance the lesson.
7. Spotlight the Shop/combat phase strip.
   - `Prepare in the Shop, press End Turn, then watch the fight.`
8. Open Turn 1's Shop.

The player should reach the first actionable Shop within 75 seconds on a normal reading pace. A returning
player may skip the opening foundation and begin at Turn 1.

### 6.7.3 Round 1: buy, play, hero power, Rally

**Shop entry**

1. Spotlight Gold. `Gold is spent in the Shop and refills each round.`
2. Spotlight Packstrider. `Buy Packstrider. Bought minions move to your hand.`
3. Permit only Packstrider as the first purchase. After purchase, move focus to the real hand card.
4. Spotlight the left-most warband slot. `Play Packstrider here.`
5. After it lands, open its inspector and focus the Rally keyword.

**First-use Rally lesson**

**Title:** Rally

**Definition:** `Rally triggers when this minion attacks, before damage is dealt.`

**Prediction:** `Packstrider will gain Attack for each Beast you control, then strike.`

6. Spotlight Preparation and its valid target. `Hero Powers are unique abilities. Use Preparation on Packstrider.`
7. Spotlight End Turn. `You are ready. End Turn to begin automatic combat.`

**Combat focus**

- At combat start, show order marker `1` above Packstrider and `1` above the enemy Omen only long enough to
  establish who can act.
- Immediately before Packstrider's first normal attack, briefly hold and focus Packstrider's Rally keyword.
- Release the hold. Let the real Rally beat and stat FX play.
- After the transaction completes, focus Packstrider's changed Attack for up to 1.2 seconds.
- Show: `Rally resolved before the attack. Its new Attack applies to this strike.`
- Let the attack and win resolve normally.

The player must see one uninterrupted Rally animation. Do not pause between the buff landing and attack impact.

### 6.7.4 Round 2: Shop tiers, investment, and Resolve

1. Focus the upgrade button, current tier, and preview of the next tier.
2. `Higher Shop tiers unlock stronger cards. Upgrading costs this round's Gold, so you may be weaker now.`
3. Require the real upgrade action. Animate the tier change through the normal UI.
4. Soft-focus the unbought Shop cards. `You cannot buy everything. Investing now can create a stronger build later.`
5. Require End Turn.

**Combat and loss lesson**

- Do not announce that the fixture is a forced loss.
- Allow combat to resolve without coaching overlays.
- After damage and Resolve FX finish, focus the player's Resolve delta.
- `You lost Resolve, but the run continues. One loss can be worth an important upgrade.`
- Focus the lobby rail and the still-active player row.

This is the only authored loss. It should feel safe, legible, and strategically justified.

### 6.7.5 Round 3: sell, rebuild, position, and Echo

1. Focus Packstrider and the sell zone. `Sell Packstrider to recover 1 Gold and change direction.`
2. After the sale completes, focus Void Panther and T-Rex together.
   - `These cards share a plan: both leave more Beasts behind when they die.`
3. Buy both through normal actions.
4. Require Void Panther in the left-most slot and T-Rex to its right.
5. Show attack-order numbers over the two cards.
   - `Your normal attack order follows the row from left to right. Put Void Panther first so its Echo can open space early.`
6. Allow free repositioning until the formation predicate is satisfied.
7. Use Preparation when charged, then End Turn.

**First-use Echo lesson**

**Title:** Echo

**Definition:** `Echo triggers when this minion dies.`

**Prediction:** `When Void Panther dies, it summons two Taunt Cubs into the combat.`

During combat:

- On Void Panther's lethal damage, hold before the death transaction.
- Focus the dying card and its Echo icon. Do not obscure Health reaching zero.
- Release the hold and let death, Echo, and summon FX play as one authored chain.
- After the Cubs settle, focus the source's former slot and the new bodies.
- `The Panther is gone, but its Echo left two defenders. Combat summons normally disappear after combat.`

Do not explain simultaneous damage, death ordering, or board-cap overflow yet.

### 6.7.6 Round 4: evaluate, refresh, cast, and freeze

1. Briefly group-focus the initial Shop. `This Shop does not improve your Echo plan.`
2. Focus refresh. `Refresh replaces the current offers for 1 Gold.`
3. Require one refresh.
4. Focus the new Void Panther and Growth separately.
5. Buy Void Panther.
6. Buy Growth and focus the spell in hand.
   - `Shop spells are cast from your hand. They create value without taking a warband slot.`
7. Require Growth to be cast and wait for every buff beat to finish.
8. Focus T-Rex in the Shop and Freeze.
   - `Freeze keeps the current Shop for next round.`
9. Require Freeze, then End Turn.

The combat has no new full-screen lesson. Echo receives only a small keyword pulse on its first trigger as a
memory check.

### 6.7.7 Round 5: frozen offers and Gilding

1. On Shop entry, focus the preserved T-Rex. `Frozen cards stayed exactly where you left them.`
2. Buy T-Rex and the third Void Panther.
3. When the third copy is acquired, allow the normal Gild ceremony to play with no tutorial layer over it.
4. After the ceremony, focus the Gilded card and its expanded text.
   - `Three copies combine into one Gilded minion. It keeps the combined power and has a stronger effect.`
5. Require the Gilded Void Panther to remain left-most among cards with Echo.
   - `Keep your strongest Echo left-most. A later card will trigger the left-most Echo.`

The last line is an intentional forward reference. Do not name Echohorn yet.

### 6.7.8 Round 6: Basic Runes and build direction

1. Enter the real Basic Runeforge and spotlight all three offers together.
2. `Runes change the rules of your run. They cost Gold, so choose one that supports what your board already does.`
3. Let the player inspect all offers without advancing.
4. On each offer, show one board-specific connection sentence, not a generic rating.
5. Allow any validated branch. Do not label one choice Correct.
6. After purchase, pin the Rune badge briefly beside the board area.
   - `This Rune is active for the rest of the run.`
7. Buy and position Wolvie.
8. Before combat, show a one-line prediction tailored to the selected Rune.
9. During combat, the first Rune activation receives a source badge focus, then its normal Beat/FX transaction.
10. Confirm the changed result after the FX completes.

The Rune lesson is complete only after the player sees it alter a real event, not when the purchase closes.

### 6.7.9 Round 7: engine card and selected triggers

1. Require Tier 3 upgrade and one refresh with abbreviated coaching.
2. Focus Echohorn and the current Echo cards.
   - `Echohorn's Rally triggers your left-most Echo without killing it.`
3. Show a live connector from Echohorn to the Gilded Void Panther only when the formation is valid.
4. If another Echo is left-most, show where the connector would go and allow the player to correct it.
5. Buy Growth, cast it, and End Turn.

**Combat chain explanation**

- Before Echohorn attacks, focus Echohorn: `Rally begins here.`
- Let its Rally beat play.
- Follow the real event relationship with a brief connector to Void Panther: `It selected your left-most Echo.`
- Let the Echo and summons resolve without interruption.
- After the chain, show: `One attack caused Rally -> Echo -> summons. Position created the chain.`

After the win, focus the defeated opponent's Resolve and rail row while normal elimination FX play.
`An opponent reached zero Resolve and is out. Seven opponents are now six.`

### 6.7.10 Round 8: second upgrade and planning ahead

1. Require Tier 4 upgrade and one refresh.
2. Focus Sea Urchin and Dawnclaw in the Shop without requiring a purchase.
3. `Sea Urchin has a Shout. Dawnclaw can trigger an adjacent Shout through its Echo.`
4. Focus Freeze and require preserving Sea Urchin.
5. Use Preparation when available.

This is a preview, not a complete Shout lesson. The player has not played a Shout yet, so do not mark
`keyword_shout` complete.

### 6.7.11 Round 9: Shout, Epic Rune, adjacency, and Start of Combat

1. Enter the Epic Runeforge.
2. Focus Rune of Dawnclaw and its created card/effect relationship.
   - `Epic Runes can create entirely new build lines. This one lets Dawnclaw use its Echo at Start of Combat.`
3. Allow alternatives to be inspected, then require the authored Rune for this lesson.
4. Buy the frozen Sea Urchin and play it with an open adjacent slot reserved for Dawnclaw.

**First-use Shout lesson**

**Title:** Shout

**Definition:** `Shout triggers when you play this minion from your hand.`

**Prediction:** `Playing Sea Urchin lets you Discover a Beast immediately.`

5. Resolve Sea Urchin's real Discover flow. Explain Discover only if its profile lesson is incomplete:
   - `Discover shows three choices. Choose one card to keep.`
6. Place the Dawnclaw granted by the Rune adjacent to Sea Urchin.
7. Focus both cards and the adjacency seam between them.
   - `Adjacent means directly beside. Dawnclaw's Echo will choose this Shout.`

**First-use Start of Combat lesson**

**Title:** Start of Combat

**Definition:** `Start-of-Combat effects resolve before normal attacks. Your minions resolve from left to right.`

**Prediction:** `Rune of Dawnclaw triggers Dawnclaw's Echo, which triggers Sea Urchin's Shout again.`

During combat, display a compact causal trail above the cards as each real transaction completes:

```text
Rune of Dawnclaw
  -> Dawnclaw Echo
  -> adjacent Sea Urchin Shout
```

Only the active node is bright. Existing FX remain unobscured. Collapse the trail when the Shout result is
settled.

### 6.7.12 Round 10: replacement, capacity, and finished engine

1. Focus the full board and hand/Shop card that cannot yet be played.
   - `A full warband forces a choice. Replace a weaker piece to make room for a stronger payoff.`
2. Require selling one replaceable T-Rex.
3. Buy and play Beardsley.
4. Buy and cast Pre-emptive Assault.
   - `Some effects change normal combat order. This spell makes your side attack first next combat.`
5. Briefly review the finished engine with three grouped labels:
   - **Summoners:** Void Panther and T-Rex.
   - **Triggers:** Echohorn and Dawnclaw.
   - **Payoff:** Beardsley.
6. End Turn and let the full engine resolve with minimal coaching.
7. After combat, show a concise recap assembled from observed events:
   - number of Rallies triggered;
   - number of Echoes triggered;
   - number of minions summoned;
   - Rune activations.

This recap describes what happened. It must not expose simulator internals or imply that larger counts are
always better.

### 6.7.13 Rounds 11-12: supervised independence

At the start of Round 11, remove the action arrow, hard gates, and answer-specific prompts.

**Round 11 prompt:** `Improve the engine in your own way. You can buy, sell, cast, refresh, reposition, or upgrade.`

**Round 12 prompt:** `Prepare for the final opponent, then win the lobby.`

Contextual first-use lessons still fire if the player encounters a universal mechanic that has never been
explained. They use a compact explanation and never prescribe a strategic choice. No entirely new required
mechanic should be seeded during these rounds.

### 6.7.14 First-seen mechanic matrix

| Concept | First full lesson | Trigger sentence | Result sentence |
|---|---:|---|---|
| Rally | 1 | Triggers when this minion attacks, before damage | The Rally changed the attack before it landed |
| Shop tier | 2 | Higher tiers unlock stronger cards | The investment cost tempo but expanded future offers |
| Resolve | 2 | Losing combat lowers Resolve | You remain active until Resolve reaches zero |
| Echo | 3 | Triggers when this minion dies | The dead minion left value behind |
| Shop spell | 4 | Cast from hand and uses no warband slot | The spell changed the board immediately |
| Freeze | 4 | Keeps current offers for next round | The preserved card returned next Shop |
| Gilded | 5 | Three copies combine into a stronger card | One board slot now holds the upgraded effect |
| Basic Rune | 6 | A purchased run-wide rule modifier | The Rune changed an existing board event |
| Elimination | 7 | Zero Resolve removes a lobby seat | The rail records the eliminated opponent |
| Shout | 9 | Triggers when played from hand | The effect resolved in the Shop immediately |
| Discover | 9 | Choose one of three generated options | The selected card enters the appropriate destination |
| Start of Combat | 9 | Resolves before attacks, player left to right | The chain completed before normal attack rotation |
| Full board | 10 | Seven minions is the maximum | Selling created room for a better engine piece |
| Attack-first override | 10 | Some effects change normal attack order | The player's side received the first normal attack |

End-of-Turn is a universal glossary lesson and contextual first-use lesson, but it is not forced into this Echo
course solely to check a curriculum box. If a future pinned card adds an End-of-Turn effect, use:

`End of Turn triggers after you finish shopping, before combat begins. Your minions resolve from left to right.`

This avoids adding an unrelated card to an otherwise coherent beginner build.

## 6.8 Basic Rune branch

Turn 6 offers three legal, affordable Runes representing understandable choices:

- A direct Echo payoff.
- A Beast summon payoff.
- A defensive or resurrection payoff.

The exact live Rune IDs must be approved against current content. Every branch must:

- Be affordable from the exact economy state.
- Produce at least one visible event in combat.
- Converge to the Turn 7 Shop state.
- Complete every later fixture through Turn 12.

Do not force one Basic Rune. This is the course's first meaningful strategic choice.

Turn 9 may require Rune of Dawnclaw because that lesson specifically teaches a unique build-altering Epic Rune.
The alternatives remain inspectable and explain why the course is demonstrating Dawnclaw.

## 6.9 Autonomy rounds

Turns 11-12 are not puzzles and do not have a single correct purchase.

Rules:

- No hard action gates except preventing an illegal or unrecoverable scenario exit.
- Seed at least one meaningful upgrade, one reasonable alternative, one spell, and ordinary filler.
- Allow refresh, freeze, sell, buy, cast, reposition, upgrade, and hero power normally.
- Show only: `Improve your warband and defeat the remaining Omens.`
- Offer a category-level hint after 20 seconds of inactivity.
- Accept a range of final boards.
- Validate the final Omen fixture against representative reasonable boards, not only one canonical board.

Suggested hint levels:

1. `Look for a stronger payoff, a useful spell, or a card that improves your triggers.`
2. Highlight two reasonable Shop options without selecting one.
3. Explain one connection to the current board.

## 6.10 Graduation

Round 12 must end through the normal systems:

1. Combat resolves in the simulator.
2. The opponent takes real damage.
3. Resolve counts down to zero.
4. The opponent row receives the normal elimination and placement treatment.
5. The player becomes the sole active seat.
6. The rail displays the normal winner treatment.
7. The game opens the normal post-game victory screen.

The post-game screen shows the final board, Runes, record, and lobby outcome. Add a tutorial recap panel without
replacing the normal screen:

- You invested in higher Shop tiers.
- You assembled and improved a coherent engine.
- You Gilded a minion.
- You positioned triggered effects deliberately.
- You forged Runes that supported the build.
- You finished two rounds without prescribed actions.

Primary action: **Play Your First Lobby**.

Secondary actions: **Choose a Tribe Primer**, **Replay**, and **Return to Title**.

---

## 7. Tribe Primers

## 7.1 Purpose

Tribe Primers bridge the gap between knowing controls and recognizing a build. They are optional, replayable,
and selected by the player.

They are not five copies of Learn Ascent.

## 7.2 Six-round structure

Each primer begins from a prepared but believable Turn 5 state:

- Shop Tier 2.
- A small early board representing the tribe.
- Normal Turn 5 Gold.
- No hidden permanent buffs that the player cannot inspect.
- An authored lobby rail and Omen course.

The primer then plays real Turns 5-10:

| Turn | Guidance | Purpose |
|---:|---|---|
| 5 | Guided | Identify the tribe's resource or trigger and assemble a two-card foundation |
| 6 | Guided | Forge a Basic Rune that supports the line |
| 7 | Guided | Upgrade the Shop and acquire the first engine payoff |
| 8 | Guided choice | Choose between tempo and scaling or between two adjacent line pieces |
| 9 | Light guidance | Forge an Epic Rune and complete the representative engine |
| 10 | Autonomous | Improve freely, fight the final Omen board, and graduate |

This preserves real Basic and Epic Rune timing while avoiding four redundant early rounds.

## 7.3 Universal lessons are not repeated

If Learn Ascent is complete, primers abbreviate buy, sell, refresh, freeze, and upgrade coaching. Full focus masks
appear only for a tribe-specific interaction the player has not seen.

If Learn Ascent was skipped, the primer may display lightweight control reminders, but it does not become a
second universal tutorial.

## 7.4 Five initial primers

The exact cards and Runes require a content-authoring pass, but the learning targets should be:

| Tribe | Representative primer line | What the player learns |
|---|---|---|
| Beast | Wild Hunt / Rally attacks | Attack triggers, repeated attacks, combat scaling, and positioning a Rally engine |
| Dragon | Shouts plus Shop-spell sequencing | Play order, remembering the first spell, triggering Shouts, and recycling value |
| Demon | Imps or Shop Consume | Choose one primary line per primer version; teach summons or converting Shop stats, not both at once |
| Kobold | Rubies | Generate, improve, and place Rubies; distinguish Rubies from Shop spells |
| Dwarf | Ales plus Shop-spell economy | Spending loops, Ale triggers, Shop-spell value, and avoiding wasteful APM |

The Beast primer intentionally avoids duplicating the Echo line already used by Learn Ascent.

If Celestials replace one of these tribes in the active five, their primer should teach Alignment and Orbit with
only two or three cards before introducing any APM loop.

## 7.5 Primer content requirements

Every primer manifest defines:

- Tribe and set ID.
- One-sentence fantasy.
- Pinned card, spell, token, and Rune revisions.
- Prepared Turn 5 state.
- Six Shop queues and recovery queues.
- Basic and Epic Rune offers.
- Omen boards and combat seeds.
- Four guided lesson predicates.
- Two application/completion predicates.
- Final board invariants where required.
- Post-course recap.

Every primer must have at least two acceptable Turn 10 boards. A primer that only works through one exact click
sequence has become a Tactical Trial and must be redesigned.

## 7.6 Set rotation strategy

For beta, pin primers to Set 2 and its content revision.

Long term:

- Key primers by `tribeId`, `setId`, and `courseVersion`.
- Keep a course available only while all pinned content can be loaded safely.
- A rotating lobby may select the primer version matching that lobby's card package.
- Reuse universal lesson flags across every version.
- Never silently substitute cards after a balance or set update.

---

## 8. Coaching and UI System

## 8.1 Focus mask

The first required use of a basic action receives:

- A 65-75% dimmer over unrelated UI.
- A feathered cutout with 12-18 px breathing room.
- A visible outline that does not rely on color alone.
- A short anchored coach panel.
- A source-to-destination connector for drag actions.
- Pointer pass-through for allowed live targets.
- Input-adaptive action wording.

Do not draw a fake control above the real UI.

### 8.1.1 Focus modes

The focus system supports four deliberately different modes:

| Mode | Purpose | Pauses play? | Example |
|---|---|---:|---|
| Orient | Identify an area or rule | Yes, outside active FX | Gold, lobby rail, seven warband slots |
| Action | Ask the player to use a live control | No; gates invalid actions | Buy Packstrider, press upgrade |
| Predict | Identify an upcoming source and result | Brief pre-transaction hold | Rally will buff before the attack |
| Confirm | Point to the result after presentation settles | Brief post-transaction hold | Cubs summoned; Resolve decreased |

The tutorial must not use a blocking modal to explain a live combat effect while the effect is moving. Use
Predict before the Beat transaction and Confirm after its completion signal.

### 8.1.2 Visual construction

The focus mask is a single full-screen layer with multiple optional cutouts. It must support:

- One primary cutout and up to three secondary cutouts.
- Rounded card-shaped, circular badge, rectangular control, and freeform grouped-area geometry.
- Animated movement between anchors without flashing the whole screen.
- A source-to-target connector with arrow direction.
- A numbered left-to-right order overlay.
- A causal-trail overlay for multi-effect chains.
- Safe placement that avoids the active card, target, damage numbers, generated cards, and coach panel.
- A high-contrast mode that uses borders and patterns rather than hue alone.

The default dimmer is 70%. Combat uses 55-60% so the board remains readable. Never dim authored particles
independently of their source card; the entire game layer sits behind the mask uniformly.

### 8.1.3 Focus lifecycle

```text
resolve semantic anchors
  -> wait for stable layout
  -> enter mask (150-220 ms)
  -> show title and explanation
  -> enable allowed action OR release pre-transaction hold
  -> hide coach copy before authored FX begins
  -> await presentation transaction completion
  -> show result focus (600-1200 ms or player advance)
  -> exit mask
```

If an anchor moves, transforms, dies, or is replaced, the system follows the semantic entity or intentionally
switches to the declared result anchor. It must never retain a cutout over an empty screen coordinate.

### 8.1.4 Combat observation controls

Full first-use combat lessons may slow the lead-in to 0.75x and hold at a declared safe boundary. The effect
itself returns to normal authored speed unless an existing accessibility setting changes global playback.

Allowed safe holds:

- Before a normal attack begins.
- Before a death transaction begins.
- Before Start-of-Combat processing begins.
- After a complete presentation transaction settles.

Forbidden holds:

- Between a Rally stat gain and its attack impact.
- Between death and its Echo summons when those belong to one authored transaction.
- Mid-Gild ceremony.
- While a custom FX completion promise is unresolved.
- By inserting arbitrary delays into simulation or Beat Lab configuration.

The player may replay the most recent tutorial explanation after combat through a small `What happened?`
button. This reopens the text and event summary; it does not replay or resimulate combat.

## 8.2 First-use lesson registry

Track lesson completion at the profile level so tribe primers do not reteach universal interactions.

Core keys include:

- `inspect_card`
- `buy_minion`
- `play_minion`
- `use_hero_power`
- `end_turn`
- `tavern_up`
- `sell_minion`
- `reorder_minion`
- `refresh_shop`
- `buy_spell`
- `cast_spell`
- `freeze_shop`
- `gild_minion`
- `forge_basic_rune`
- `read_resolve_loss`
- `read_elimination`
- `forge_epic_rune`
- `replace_on_full_board`
- `read_post_game`

Mechanic keys include:

- `keyword_shout`
- `keyword_rally`
- `keyword_echo`
- `keyword_start_of_combat`
- `keyword_end_of_turn`
- `keyword_avenge`
- `keyword_slaughter`
- `keyword_ward`
- `keyword_taunt`
- `keyword_flurry`
- `keyword_rise`
- `keyword_choose_one`
- `keyword_critical_strike`
- `keyword_toxin`
- `keyword_orbit`
- `alignment_dawn_dusk`
- `resource_ruby`
- `resource_dwarven_ale`
- `action_consume_shop`

Tribe primers add course-specific keys such as `cast_ruby`, `consume_shop_minion`, or `trigger_ale`.

### 8.2.1 Lesson depth

Each lesson flag can be in one of three states rather than only seen/unseen:

| State | Meaning | Presentation |
|---|---|---|
| New | Player has not encountered the concept | Full Orient -> Predict -> Resolve -> Confirm lesson |
| Introduced | Explanation shown, successful example not yet observed | Compact reminder on next valid trigger |
| Demonstrated | Player observed or performed the mechanic successfully | Keyword pulse or no coaching |

Profile persistence stores `demonstrated`; active course state may store `introduced` until a valid event is
observed. Merely opening a Glossary entry does not mark a mechanic demonstrated.

### 8.2.2 Lesson definition

```ts
type TutorialLessonDefinition = {
  id: string;
  concept: string;
  title: string;
  definition: string;
  prediction?: string;
  result?: string;
  sourceAnchors: TutorialAnchorRef[];
  resultAnchors?: TutorialAnchorRef[];
  presentationBoundary?: 'beforeAttack' | 'beforeDeath' | 'beforeStartOfCombat' | 'afterTransaction';
  completion: TutorialPredicate;
  repeatPresentation: 'none' | 'keywordPulse' | 'compactReminder';
  glossaryEntryId?: string;
};
```

Definitions describe rules. Course steps describe what to do in the current situation. Keep them separate so
the same Rally lesson can be reused in a Beast primer, contextual hint, or future set.

### 8.2.3 First-seen policy

- Teach a keyword when the player can immediately see or use it, not when it first appears unread in the Shop.
- Previewing a future synergy may name a keyword but does not complete its lesson.
- If multiple new mechanics would trigger in one chain, explain the first source before combat and reveal each
  new downstream mechanic only at its safe boundary.
- Never fire more than one full mechanic lesson during a single uninterrupted combat transaction.
- Queue remaining explanations for the next safe boundary or post-combat debrief.
- Utility keywords such as Taunt and Ward receive shorter lessons than engine keywords such as Rally or Echo.
- A mechanic that is absent from the core course is taught contextually in its first primer or normal lobby.

## 8.3 Prompt rules

- Title: 2-5 words.
- Primary instruction: target 18 words, maximum 28.
- Optional Why explanation: maximum 35 words.
- Never introduce more than one new rule and one action at once.
- Avoid internal terms such as reducer, proc flag, snapshot, or beat.
- Do not put permanent instructions over the Shop during free play.
- Do not advance while an authored presentation transaction is unfinished.

Use three copy layers consistently:

- **Definition:** the stable rule, such as `Rally triggers when this minion attacks, before damage.`
- **Situation:** why it matters now, such as `Packstrider will gain Attack before striking.`
- **Instruction:** the player's next action, such as `Place Packstrider in the left-most slot.`

Do not combine all three into one paragraph. Definition appears in the mechanic panel, situation in optional Why
copy, and instruction beside the live target.

Required text behavior:

- Every keyword is visually styled exactly as it is on cards.
- A keyword name is clickable/tappable to open its Glossary entry after the first explanation.
- Numbers use the current state, never hard-coded prose, when they can vary by branch.
- Directional words use the player's perspective: left-most and right-most as displayed.
- `Before damage`, `when played`, `when it dies`, and `before attacks` are preferred timing phrases.
- Avoid `proc`, `fires`, and `activates` in beginner copy when `triggers` is accurate.
- Do not say a choice is best; say what connection it makes.

## 8.4 Stable anchors

Use a target registry, not visual selectors or coordinates.

```tsx
data-tutorial-anchor="gold"
data-tutorial-anchor="shop-tier"
data-tutorial-anchor="upgrade"
data-tutorial-anchor="refresh"
data-tutorial-anchor="freeze"
data-tutorial-anchor="end-turn"
data-tutorial-anchor="hero-power"
data-tutorial-anchor="warband"
data-tutorial-anchor="hand"
data-tutorial-anchor="lobby-self"
data-tutorial-anchor="lobby-next-opponent"
data-tutorial-anchor="combat-log"
data-tutorial-anchor="procs-tab"
data-tutorial-anchor="phase-strip"
data-tutorial-anchor="resolve"
data-tutorial-anchor="shop-card:{uid}"
data-tutorial-anchor="hand-card:{uid}"
data-tutorial-anchor="board-card:{uid}"
data-tutorial-anchor="card-keyword:{uid}:{keyword}"
data-tutorial-anchor="card-stat:{uid}:attack"
data-tutorial-anchor="card-stat:{uid}:health"
data-tutorial-anchor="board-slot:{index}"
data-tutorial-anchor="rune-offer:{runeId}"
data-tutorial-anchor="rune-badge:{runeId}"
data-tutorial-anchor="lobby-seat:{seatId}"
```

Cards are targeted by UID or definition ID from scenario state.

Anchors must expose bounds through a registry independent of DOM structure. Pixi card views register world
bounds every frame while visible; DOM controls register `getBoundingClientRect()` through the same interface.
The focus layer consumes normalized screen-space rectangles. Course content never imports Pixi containers or
queries CSS classes directly.

## 8.5 Input adaptation

Scenario steps describe intent: `buyCard`, `playCardAt`, `sellCard`, `castSpellOn`, or `activateHeroPower`.

A presentation adapter renders:

- Mouse wording.
- Touch wording.
- Keyboard/controller wording where supported.

Completion never depends on a pointer event. It depends on the resulting game state or semantic action history.

---

## 9. Gating, Hints, and Recovery

## 9.1 Gate strengths

| Gate | Behavior | Use |
|---|---|---|
| Observe | No action is disabled; wait for a predicate | Inspection, lobby rail, combat observation |
| Soft | Alternate actions work but do not advance; show a nudge | Repositioning and harmless exploration |
| Hard | Reject an irreversible lesson-breaking action with a reason | Selling a required card or spending reserved Rune Gold |

Hard gates must explain the plan. Never silently ignore input.

## 9.2 Recovery

Every step declares one recovery strategy:

- Continue with the valid alternate state.
- Restore a required offer or Gold at the next safe boundary.
- Restore the current turn checkpoint.
- Restore the current chapter checkpoint.

Never require a full tutorial restart for an ordinary mistake.

Save after every completed step. Save:

- Exact run state.
- Course and content version.
- Step ID.
- Shop queue cursor and current instances.
- Opponent/Omen board and combat seed.
- Completed coaching keys.

If a future version is incompatible, offer restart from the nearest safe chapter rather than loading corrupt
state.

---

## 10. Technical Architecture

## 10.1 Course catalog

```ts
type TutorialCourseKind = 'core' | 'tribe';

type TutorialCourseDefinition = {
  id: string;
  kind: TutorialCourseKind;
  version: number;
  contentRevision: string;
  setId: string;
  tribeId?: string;
  title: string;
  summary: string;
  heroId: string;
  initialRunPatch: Partial<RunState>;
  turns: TutorialTurnDefinition[];
  completion: TutorialCompletionDefinition;
  prerequisite?: TutorialPrerequisite;
};
```

Do not hard-code Beast behavior into the tutorial runtime. Beast cards belong to the core course manifest.

## 10.2 Turn and step definitions

```ts
type TutorialTurnDefinition = {
  turn: number;
  opponentSeatId: string;
  combatSeed: string;
  shopQueue: ScriptedShop[];
  recoveryShops?: ScriptedShop[];
  omenBoard: TutorialOmenInstance[];
  otherPairingResults: TutorialPairingResult[];
  steps: TutorialStep[];
  expectedCheckpoint?: TutorialCheckpoint;
};

type TutorialStep = {
  id: string;
  phase: 'lobby' | 'shop' | 'runeforge' | 'combat' | 'debrief' | 'postgame';
  title?: string;
  body: string;
  why?: string;
  anchors: TutorialAnchorRef[];
  focusMode?: 'orient' | 'action' | 'predict' | 'confirm';
  lessonId?: string;
  connector?: TutorialConnectorDefinition;
  safeHold?: TutorialPresentationBoundary;
  resultAnchors?: TutorialAnchorRef[];
  gate: 'observe' | 'soft' | 'hard';
  allowedActionKinds?: Action['type'][];
  completion: TutorialPredicate;
  recovery?: TutorialRecovery;
  analyticsTag: string;
};
```

```ts
type TutorialAnchorRef =
  | { kind: 'ui'; id: string }
  | { kind: 'card'; zone: 'shop' | 'hand' | 'board'; uid: string }
  | { kind: 'cardKeyword'; uid: string; keyword: string }
  | { kind: 'cardStat'; uid: string; stat: 'attack' | 'health' }
  | { kind: 'boardSlot'; index: number }
  | { kind: 'lobbySeat'; seatId: string }
  | { kind: 'rune'; runeId: string };

type TutorialConnectorDefinition = {
  from: TutorialAnchorRef;
  to: TutorialAnchorRef;
  label?: string;
  style: 'drag' | 'causal' | 'adjacent' | 'order';
};

type TutorialPresentationBoundary =
  | { kind: 'beforeAttack'; sourceUid: string }
  | { kind: 'beforeDeath'; sourceUid: string }
  | { kind: 'beforeStartOfCombat' }
  | { kind: 'afterTransaction'; transactionId: string };
```

Course content may refer to scenario aliases such as `tutorial.packstrider` during authoring. The provider
resolves aliases to stable runtime UIDs before the step becomes active.

## 10.3 Runtime flow

```text
Player input
  -> tutorial gate
  -> normal dispatch
  -> normal reducer
  -> observe before/action/after and semantic events
  -> normal presentation and authored FX
  -> presentation-complete signal where required
  -> satisfy or retain tutorial step
```

Centralize tutorial differences in:

- Course provisioning.
- Shop provider.
- Omen board provider.
- Action gates.
- Save/profile state.
- Rating/history/upload boundaries.
- Coaching UI.

Do not scatter `if tutorial` branches through card effects or combat logic.

## 10.4 Scripted Shop provider

The normal Shop generator accepts a provider interface. Tutorial courses supply offers by course version, turn,
and refresh count.

Requirements:

- Buying and refreshing use normal costs.
- Freeze preserves real offer instances.
- Tutorial instances do not alter shared Shop pools.
- Recovery queues exist for lightly guided and autonomous sections.
- Save/Continue restores queue cursor and offer UIDs.

## 10.5 Omen provider

```ts
type TutorialOmenInstance = {
  attack: number;
  health: number;
};
```

The provider materializes normal `omen` instances with exactly those stats. The schema deliberately has no card
ID, keywords, effects, attachments, tribe, or targeting fields.

## 10.6 Presentation integration

Steps may wait for semantic events such as:

```ts
tutorialPresentation.complete('heroPower:first')
tutorialPresentation.complete('gild:first')
tutorialPresentation.complete('echo:first')
tutorialPresentation.complete('rune:first')
tutorialPresentation.complete('elimination:first')
tutorialPresentation.complete('postgame:shown')
```

The tutorial observes Beat Lab timing. It does not write timing overrides.

Presentation integration requires three additional read-only signals:

```ts
tutorialPresentation.safeBoundary({ kind: 'beforeAttack', sourceUid })
tutorialPresentation.transactionStarted({ id, sourceUid, family })
tutorialPresentation.transactionCompleted({ id, sourceUid, family, resultUids })
```

The tutorial may request a hold only at `safeBoundary`. The replay/choreographer owns when that boundary is
available. A hold token is automatically released on skip, course exit, timeout recovery, or missing anchor.

Custom FX remain authoritative:

- Tutorial code never writes Beat Lab values.
- Tutorial code never shortens a custom FX promise.
- Tutorial code never replaces source/target particles with its own educational animation.
- Focus copy hides before `transactionStarted` unless the effect was authored to tolerate an overlay.
- Confirmation waits for `transactionCompleted`, not a guessed timeout.
- Beat Lab timing remains viewable and editable through its existing workflow.

This separation protects Mike's FX work while giving the tutorial reliable places to explain cause and result.

## 10.7 Profile and progress model

```ts
type TutorialCourseProgress = {
  courseId: string;
  courseVersion: number;
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
  lastStepId?: string;
  startedAt?: string;
  completedAt?: string;
};

type TutorialProfile = {
  version: number;
  courses: Record<string, TutorialCourseProgress>;
  lessonFlags: string[];
  contextualHintsSeen: string[];
};
```

Use authenticated profile persistence when available and local persistence as an offline/anonymous fallback.
Completion is explicit; never infer it from match history.

---

## 11. First Real Lobby Support

The first normal lobby should feel recognizably similar while immediately communicating that scripting is over.

One-time hints:

- Hero select: mark at least two mechanically simple heroes Recommended; advanced heroes remain selectable.
- First Shop: `This run is not scripted. Build from what you find.`
- First opponent hover: explain that opponent information now supports counterplay.
- First unfamiliar keyword: point to inspection and Glossary.
- First Basic and Epic Runeforge: remind the player that Runes are permanent and paid.
- First loss: explain Resolve loss and recovery.
- First full board: remind the player that improvement may require replacing a minion.

Hints are dismissible and stored per profile.

---

## 12. Analytics and Evaluation

Track a minimal, privacy-appropriate funnel:

- First-launch prompt shown.
- Learn Ascent started, resumed, skipped, abandoned, and completed.
- Step reached and time per step.
- Invalid gated actions per step.
- Hint level requested.
- Turn/chapter restores.
- Glossary and inspection use.
- Basic Rune selected.
- Autonomy-round actions and idle time.
- Tribe primer selected, started, and completed.
- First real lobby started.
- First real lobby reaches Turns 3, 6, 9, and completion.

Do not feed tutorial outcomes into balance dashboards.

Observed playtest questions:

1. Can the player describe the Shop -> build -> fight loop?
2. Can they explain why upgrading the Shop can be worth losing tempo?
3. Can they distinguish Shout, Rally, Echo, and End of Turn?
4. Can they explain what their Rune changed?
5. Can they improve the board during Turns 11-12 without waiting for instructions?
6. Can they begin a normal lobby without freezing from choice overload?
7. After a primer, can they recognize that tribe's basic engine in a real Shop?

---

## 13. Accessibility, UX, and Performance

- Instructions cannot rely on color alone.
- Spotlight outlines remain visible at all supported UI scales.
- Text supports localization expansion.
- No instruction disappears solely on a short timer.
- Settings, audio, and reduced motion remain available.
- Reduced motion simplifies coaching transitions without skipping informational states.
- Required actions support every input method supported by the underlying game.
- The overlay may observe resize but must not perform unbounded per-frame layout reads.
- No idle particle system or animation loop is introduced solely for tutorial coaching.
- Prompt placement is verified at desktop, laptop, ultrawide, and minimum supported resolutions.
- Combat pauses occur only after complete presentation transactions.

---

## 14. Validation and Tests

## 14.1 Content validation

- Every referenced hero, card, spell, token, and Rune exists.
- Pinned behavior matches `contentRevision`.
- Every primer's tribe content is available in its pinned set.
- `omen` remains textless, effectless, keywordless, and excluded from normal pools.
- Drift failures identify the exact changed field.

## 14.2 Reducer walkthroughs

- Every required action is legal.
- Gold and upgrade costs match real configuration.
- Freeze, Gild, hero-power recharge, Rune purchase, and full-board replacement resolve normally.
- All Basic Rune branches converge.
- Autonomous actions cannot deadlock completion.

## 14.3 Combat fixtures

For every round and branch:

- Combat terminates deterministically.
- Required friendly events occur.
- Intended win/loss and Resolve state occur through normal rules.
- Omen boards contain no forbidden fields.
- Round 12 and each primer finale eliminate the final opponent normally.

Test more than one reasonable autonomy board. The final fixture must not only accept the canonical guided board.

Add semantic teaching assertions for the core combat lessons:

- Round 1 emits a Rally transaction before Packstrider's damage event.
- Round 3 emits Void Panther death -> Echo -> two summon results.
- Round 7 records Echohorn Rally selecting the left-most eligible Echo.
- Round 9 records Start of Combat -> Dawnclaw Echo -> adjacent Sea Urchin Shout.
- Round 10's attack-first override changes the first-attacker decision through normal rules.
- Every expected presentation transaction reaches completion and releases any tutorial hold.

## 14.4 UI integration

Use Playwright to verify:

- Every stable anchor exists.
- Prompts do not cover source or destination.
- Spotlight cutouts pass through input correctly.
- Multi-cutout focus follows moving Pixi cards without stale screen coordinates.
- Left-to-right order markers match current board positions.
- Source-to-target connectors identify the real source and result entity.
- First-use lessons move from New -> Introduced -> Demonstrated only after the semantic result occurs.
- Previewing Shout on Round 8 does not suppress the full Shout lesson on Round 9.
- Full mechanic explanations appear once per profile and compact reminders remain available.
- Combat focus hides before custom FX begins and returns only after transaction completion.
- Skip, exit, and recovery always release presentation holds.
- Invalid hard-gated actions explain why.
- Mouse, touch, and supported keyboard/controller paths complete the course.
- Save/Continue restores exact state and coaching progress.
- Combat coaching waits for authored presentation completion.
- Eliminated players remain visible on the rail.
- The normal post-game screen appears before graduation copy.
- Tutorial results do not appear in rating, history, upload, achievements, or balance data.

## 14.5 Regression and performance

- Normal lobby, Practice, Rift, replay, Runeforge, and Shop behavior remain unchanged.
- Tutorial content never leaks into normal pools.
- Mike's FX and Beat Lab values remain authoritative.
- Overlay target observation does not add measurable Shop-phase jank.
- Course loading does not retain prior course assets or event listeners.

---

## 15. Rollout Plan

## Phase 0: Lock the product contract

- Approve this document as the FTUE source of truth.
- Mark older FTUE docs superseded rather than maintaining competing instructions.
- Lock 12 rounds, Omen-only opponents, Aster, live pinned player cards, and separate tribe primers.

## Phase 1: Foundation vertical slice

Build:

- Tutorial profile persistence.
- Learn hub shell.
- `tutorial_lobby` origin.
- Declarative course/step registry.
- Scripted Shop and Omen providers.
- Action gating and observation.
- Spotlight/anchor system.
- Four-panel opening rules foundation and temporary board-order demonstration.
- First-use lesson registry with New, Introduced, and Demonstrated states.
- Focus lifecycle with safe pre-transaction holds and post-transaction confirmation.
- Pixi and DOM anchors normalized through one screen-space registry.
- Round 1 buy, play, hero power, End Turn, and deterministic Omen combat.
- Round 1 Rally prediction, authored FX observation, and result confirmation.
- Save, resume, skip, and restore.

This proves the difficult architecture before authoring all content. The vertical slice is not accepted until a
new player can correctly answer, without prompting: what the lobby goal is, what End Turn does, which minion
normally attacks first, and when Rally triggers.

## Phase 2: Learn Ascent Turns 1-5

- Shop, hand, board, inspection, active hero power.
- Shop upgrade and controlled loss.
- Sell, position, Echo.
- Refresh, Shop spell, freeze.
- Gilding.
- First-use scripts for Resolve, Echo, Shop spells, Freeze, and Gilding.

Run observed first-time playtests before continuing. Fix comprehension and overlay ergonomics early.

## Phase 3: Learn Ascent Turns 6-10

- Basic Rune branch.
- Echohorn engine.
- Lobby elimination.
- Second Shop upgrade.
- Epic Rune of Dawnclaw.
- Full-board replacement.
- First-use scripts for Runes, elimination, Shout, Discover, Start of Combat, adjacency, and attack-first.

Complete branch and content-drift tests.

## Phase 4: Autonomy and graduation

- Turns 11-12 unrestricted Shop queues.
- Hint ladder.
- Representative-board combat fixtures.
- Normal rail victory and post-game transition.
- First real lobby hints and Recommended heroes.

Ship Learn Ascent to private testing before building all five primers.

## Phase 5: Primer framework pilot

Build one non-Beast primer first, preferably Kobold or Dwarf because its identity differs clearly from the core
Echo course.

Validate:

- Prepared Turn 5 entry is understandable.
- Existing universal lesson flags suppress repetition.
- Rune timing feels natural.
- Six rounds are sufficient for comprehension and application.
- Course authoring is mostly data, not bespoke UI code.

## Phase 6: Remaining tribe primers

Author the remaining four active tribe courses. Test each independently and test Learn-hub progress behavior.

## Phase 7: Public beta evaluation

- Compare tutorial completers, skippers, and primer users.
- Measure first-lobby continuation rather than only tutorial completion.
- Adjust pacing, not core game behavior, to repair comprehension.
- Decide whether any primer should be recommended based on the player's first hero or set selection.

## Deferred Phase: Tactical Trials

Only after Learn Ascent and tribe primers are stable should the Tactical Trials blueprint be reopened. Trials can
reuse the scenario, predicate, checkpoint, hint, and presentation infrastructure built here, but are a separate
product with failure states, par solutions, and advanced interaction goals.

---

## 16. Definition of Done

The FTUE system is beta-ready when:

1. A fresh player can start Learn Ascent immediately without account, mode, hero, or tribe selection.
2. Learn Ascent runs for 12 rounds: ten guided and two autonomous.
3. Every combat uses only effectless, textless, keywordless Omen Minions.
4. Every required action uses real gameplay systems.
5. The player personally performs every universal game verb.
6. Turns 11-12 can be completed through multiple reasonable decision lines.
7. Victory appears through the normal lobby rail and post-game screen.
8. Save, resume, restore, replay, and skip work reliably.
9. Tutorial state never affects competitive or balance systems.
10. Beat Lab and authored FX timings remain untouched and authoritative.
11. The Learn hub separates the universal course from selectable tribe primers.
12. One data-driven primer can be authored without new tutorial UI code.
13. All five active tribe primers are available or have an explicit staged release state.
14. First-time playtests show players can begin a normal lobby without waiting for directions.
15. Content drift and combat fixture tests fail loudly when balance changes invalidate a course.
16. The opening foundation teaches lobby goal, Shop/combat loop, seven slots, and normal left-to-right order.
17. Rally, Echo, Shout, Start of Combat, and other encountered mechanics receive accurate first-use lessons.
18. Focus masks never obscure the source, result, changing stats, or authored FX they are explaining.
19. Tutorial combat holds occur only at choreographer-approved safe boundaries and always release safely.
20. A lesson is marked demonstrated only after its gameplay result is observed, not after text is dismissed.

---

## 17. Final Recommendation

Build and validate one universal tutorial first. Do not put a tribe-selection decision in front of a new player.

Then expose tribe selection as optional continued learning:

```text
First launch
  -> Learn Ascent
      -> 10 guided rounds
      -> 2 autonomy rounds
      -> normal victory/post-game screen
      -> Play First Lobby or Choose a Tribe Primer

Learn hub
  -> Learn Ascent (resume/replay)
  -> Tribe Primers
      -> choose one of the active tribes
      -> six-round prepared mini-run
  -> Glossary / Compendium

Later
  -> Tactical Trials
```

This gives Ascent a gentle first hour without flattening the game's depth. The universal course teaches how to
play; tribe primers teach what to build; future Tactical Trials can teach how engines combine and how experts
sequence them.
