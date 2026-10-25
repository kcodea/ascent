# Versus Duos (2v2 tag-team): scope

Status: SCOPE ONLY (owner 2026-10-25: "Don't build it yet but scope it. I want to add more bespoke duo mechanics too,
like a shared slot that activates a card on both sides etc."). Nothing below is built. Every OPEN DETAIL carries a
recommended default for the owner to accept or change.

## The owner's design (2026-10-25)

- **Fights: tag-team**, like Hearthstone Battlegrounds Duos. One combat per round, team vs team. Your board fights
  first; when it is wiped, your teammate's board steps in against whatever survived on the other side.
- **Health: shared team hearts.** A team loses when it hits zero.
- **Passing: yes.** Drag a card from your hand or board onto your teammate's portrait to give it to them.
- **Size: exactly 2v2.** 4 players, 2 teams, the current 4-seat room and server. Unrated, like Group.

Standing rules that bind it: combat sides 1:1 symmetric; reuse existing UI (rail, Resolve slot, gates, hero select,
clock); cross-phase by default; real-time by default; live card text; no em dashes / "Oath" / "climb" in player text;
no `title=`; gauntlet cursor only; >160 fps; every ruling gets an oracle rule.

## 1. How it maps onto the Versus Group infra (#2280 / #2285 / #2286)

| Piece | Group today | Duos |
| --- | --- | --- |
| Room options | `{ v:1, mode: 'duel' \| 'group', modifiers }` (`sim/versus/options.ts`) | add `mode: 'duos'`; `VERSUS_MODE_SEATS.duos = { min: 4, max: 4 }`; SQL whitelist (`versus_set_options`) gains the code. Old stored objects keep their meaning (no version bump). |
| Seats | p1..p4, 3-4 seated to start | exactly 4. **Teams by seat pair: p1+p2 (left of the VS mark) vs p3+p4 (right).** The `.vsgroup` layout already places them that way (`versus.css` 303-306); drag-to-seat already exists, so "picking a team" is "picking a seat". |
| Pairing | `versusGroupPairings` round robin, Copy for 3 alive | none: it is always team A vs team B. No Copy, no ghost pairing. |
| Combat | one `simulate()` per fight, `versusGroupCombatSeed(match, round, fight)` | ONE `simulate()` per round with a reserve board per side (section 2), seed `versusGroupCombatSeed(match, round, 0)`; chair alternates per round as today (`firstSide`). |
| Hearts | 7 per player, loser of a fight -1 | **7 per team** (default), the losing team -1, a draw costs nobody. Stored on both seats of the team (same number) so the rail and the projection read it unchanged. |
| Knockout / stands | a seat at 0 goes out, the trigger moves it to the stands | both seats of a team go out together; the existing knockout-stands trigger works per seat, so it moves both. Placement: 1st / 2nd team; both members share it. |
| versus-resolve | `finalize_group`, `parity_group` | new `finalize_duos` + `parity_duos` actions (or a `mode` branch inside `finalize_group`; recommend separate actions so group bytes cannot move). |
| Tables | `versus_group_*` | reuse `versus_group_*` with a `mode` column on the match (seats, submissions, rounds, fights, spectator frames all fit: one fight row per round). New: `versus_duos_passes` and (if the shared slot ships) `versus_duos_team_state`. |
| Client projection | `versusGroupView.ts` projects the match onto the 1v1 row (`p1` = me, `p2` = this round's foe) | the same projection, foe = the enemy team's first board; plus a `teammate` field. The 1v1 store paths stay untouched. |
| Rail | `versusGroupLobby` builds a display lobby | four rows: you, your teammate (adjacent), then the enemy pair; hearts are the team's. `RunLobby.forcedOpponent` names the enemy team's first board. |
| Spectators | fight picker grouped by fight | one fight: the picker lists the four players; switching inside the fight keeps the moment (already supported). |
| XP | 125 / 80 / 50 / 50 | recommend 125 / 125 for the winning team, 50 / 50 for the losers (open detail 11). |

## 2. The tag-team combat model in core

### Shape

Keep the `simulate(player, enemy, rng, cards, playerState, enemyState, config)` signature. Add one optional config
field (shared boundary: `packages/core/src/types.ts`, coordinate before landing):

```ts
interface CombatReserve { board: BoardMinion[]; state: CombatSideState }
interface CombatConfig { /* ...existing... */ reserve?: Partial<Record<Side, CombatReserve>> }
```

With `reserve` absent, no new code path runs, so every 1v1, group, lobby and replay fight is byte-identical (proof: the
golden + determinism suites, `sideSymmetry.test.ts`, and `npm run versus:parity` 31/31 unchanged).

### Running it

1. A side is a list of **members** `[active, reserve?]`. `stateOf(side)` returns the ACTIVE member's
   `CombatSideState` (it is already a closure over a mutable binding, so this is a pointer swap, not a rewrite).
2. Every minion instance carries `member: 0 | 1`. Everything the fight carries back (Engraved gains, `ShoutCarry`,
   hand grants, `wildHuntGrown`, Whisper improves, damage meters, quest progress) is attributed by member, so each
   teammate's run gets back only what its own minions did. `CombatResult` gains `members?: Record<Side, [carry0, carry1]>`;
   the existing top-level fields stay member 0's for old callers.
3. **Step-in moment.** At the existing settle point (`settleBetweenAttacks` then `flushAscensions`), if a side has no
   living minion, no pending summon, and an unspent reserve: emit `tagIn`, instantiate the reserve board into that
   side (uids from a disjoint namespace, e.g. `r0`, `r1`, so member 0's uids, and therefore every existing log, never
   shift), swap `stateOf`, arm that member's quest/rune mods, then run its Start of Combat pass (open detail 3) on the
   live enemy survivors. The attack turn pointer is unchanged (if it was the wiped side's turn, the newcomer attacks
   next); the newcomer's attacker pointer starts at its leftmost.
4. **Both wiped at once** (Cleave, a board-wide spray): both reserves step in, in `SIDES` order (the existing
   `firstSide` tie-break), so the fight stays deterministic and its mirror stays the mirror.
5. **End.** The fight ends when a side has no living minion and no reserve left. Outcome as today. A team whose
   first board wins never shows its reserve (it still sits in `initial` for the replay and the recap).
6. **RNG.** The reserve draws from the fight's one stream from the step-in onward. No `fork()` at fight start
   (that would shift the main stream). Deterministic because the step-in point is a deterministic function of the log.
7. **Iteration guard.** The existing guard applies to the whole fight; raise its cap for reserve fights only (twice
   the bodies), so 1v1 bytes cannot move.

### Symmetry

Every step above runs identically for `player` and `enemy`. New mirror test: `A1+A2 vs B1+B2` as player must equal
`B1+B2 vs A1+A2` with `firstSide: 'enemy'`, up to the side swap, for a fixture set that covers single wipes, double
wipes, Rise / Rebirth / Echo on the last body, and a first board that wins outright.

### Event vocabulary (shared boundary: the `CombatEvent` union)

- `tagIn { side, member, minions }`: the reserve enters; `minions` is the entering board as summoned (the
  Choreographer renders it like a summon wave).
- Optional `boardFallen { side, member }`, emitted just before `tagIn` (gives the UI a clean beat to clear the fallen
  board and swap portraits even when the step-in is instant). Recommend shipping it: one more beat is cheaper than
  inferring it.
- Bespoke duo mechanics (section 5) add their own events when chosen (`sharedSlotFight`, `teamAvenge`, ...); none are
  needed for the base mode.

`initial` gains `reserve?: Record<Side, Minion[]>` so replay v2 and the Fight Recap can show both boards. Old replays
have no field and play as before.

### Damage / hearts

Hearts, not damage: the losing team loses 1 (Versus never uses Resolve or Armor; `playerDamage` keeps computing for
the record but nothing reads it). See open detail 4 for the alternative.

### Presentation (Choreographer / UI)

- The combat scene's hero portrait on each side shows the ACTIVE member. On `boardFallen` the fallen board's last
  slots fade; on `tagIn` the portrait swaps (a one-shot transform/opacity cross-fade, no looping paint) and the
  newcomers drop in through the existing summon beat, from the portrait.
- The teammate's portrait waits beside yours (reuse the 1v1 floating opponent hero block for the teammate, below your
  own; no new chrome). It lights when its board steps in.
- Perf: never more than 14 bodies on screen, but two extra boards of art per fight. Decode all four boards' art in
  the shop-to-combat transition so the step-in never decodes mid-fight; `Unit` stays memoized; the reserve's units
  mount at `tagIn` (measure: `npm run perf` plus a DevTools trace of a step-in against the 160 fps bar).

## 3. Passing

### Data model

- A **pass packet**: `{ matchId, round, from, to, seq, card }`, where `card` is the canonical card instance as it
  sits in the sender's run (`cardId`, stats, granted keywords, enchantments, golden, per-instance counters such as
  spell progress), validated by the same whitelist as a locked side's minions (`preparedSideError`).
- Sender: a reducer action `passCard(uid)` removes the card from hand/board and records `passedOut` in the run's
  action log. Receiver: `receivePass(packet)` adds it to hand and records `passedIn`. Both are in each run's log, so
  a restore or replay reproduces them exactly (the run never reads the network on replay).
- Transport: a `versus_duos_pass` RPC inserts into `versus_duos_passes`; the receiver reads it on its reconcile
  (and on the realtime channel the spectator frames already use, for latency). Exactly-once by `(match, round, from,
  seq)`.

### Server validation

Same team, same round, the round's shop still open (before both locks; the 250 ms grace rule as for locks), the
sender is still in, a per-turn rate cap, packet shape valid. The server cannot see run state (Versus runs are client
side, as today), so it trusts the card body exactly as it trusts a locked board today; it checks shape and bounds.

### What transfers (recommended)

- **Minions**: everything the instance carries (stats including permanent buffs, keywords, enchantments, Gilded,
  attached Attachments). It lands in hand. Its Shout fires when the receiver plays it (it is played from hand, so
  this is the normal rule, not a special case). A card buffed in hand keeps the buff (R-HAND-02).
- **Spells**: yes, as cards in hand. A Whisper keeps its "temporary" rule (it still expires at the receiver's End of
  Turn).
- **Not passable**: runes, Equipment, quests, the Starform token, hero power.
- **Triples**: the receiver's normal triple check runs when the card lands (a passed third copy gilds for the
  receiver). A Gilded card passes as Gilded.
- **Live text**: a passed scaling card re-reads the RECEIVER's run (its tallies, auras), because that is now its
  run. The card text updates on arrival (cardText helpers already read the owning run).
- Full hand: the pass is refused before it leaves (the sender's drag springs back, the deny buzz).

## 4. Phased plan with difficulty

| Phase | Scope | Difficulty |
| --- | --- | --- |
| 1. Engine + server | `reserve` in `simulate` + member attribution + `tagIn`/`boardFallen` + mirror tests; `mode: 'duos'` options; `resolveVersusDuosRound`; `finalize_duos`/`parity_duos`; migration (mode column, team hearts, passes table, pass RPC); parity extended with duos cases | **Hard.** `simulate.ts` is 7,247 lines with per-side state everywhere; member attribution of carry-backs is the risky part. The server side is medium (Group did the heavy lifting). |
| 2. Room + in-game UI | 4-seat duos room (teams = seat pairs), team hearts on the rail, teammate block, step-in choreography, the pass drag (hand/board to the teammate's portrait), receive animation, teammate's live board view (reuse the spectator frame stream: your teammate is a watcher of you) | **Medium-hard.** Reuse is high; the pass drag + live teammate view are new flows. |
| 3. Live test + edges | 4 Claudebot accounts live; disconnects (open detail 10), pass races at the lock, step-in replays, spectators, XP | **Medium.** Group's phase-3 harness (`perfBench` handles, CDP autopilot) carries over. |
| 4. Bespoke duo mechanics | the chosen v1 set (section 5) | Shared slot **hard**; the others small to medium. |

## 5. Bespoke duo mechanics

Each uses existing mechanics by their existing names. Every cross-board effect is animated (a beam or a fly from
one board/portrait to the other), and both teammates and spectators see it.

### 5.1 The Shared Slot (owner's idea)

- **Rule.** Each team has ONE Shared slot, shown at the end of BOTH teammates' boards. The minion in it counts as on
  both boards in the shop: its auras, its End of Turn, its "when you play / cast / buy" triggers fire for either
  teammate's events, and "your minions" buffs from either teammate hit it.
- **Example turn.** Kevin puts a Conductor (aura: your Shouts give +1/+1 more) in the Shared slot. Mike plays two
  Shout minions that turn and gets the bonus too; Kevin's End of Turn spell "give your minions +2/+2" also grows it.
- **Physical body in combat.** One instance (a team-owned card). In tag-team combat it fights with the board that
  goes FIRST, taking one of that board's 7 slots (its rightmost). If that board is full it fights with the second
  board instead; if both are full it sits out (its shop effects still counted). It never fights twice.
- **Buffs.** Shop buffs from either teammate are permanent on it. Combat gains are combat-only unless Engraved; an
  Engraved shared minion carries its gains back to the shared card.
- **Deaths.** Combat is a copy as always: dying in the fight changes nothing in the shop. Its Echo fires for the
  board it fought with.
- **Gilded / triples.** It counts as on the board for both teammates' triple checks (R-GILD-03 "board copies first").
  If either teammate completes a triple with it, the Gilded card goes to THAT teammate's hand and the slot empties.
- **Who swaps it and when.** Either teammate, during the shop, by dragging a board minion into the slot (an occupied
  slot swaps: the old card goes to the swapper's hand). Changes go through the server in order (a version number);
  the second of two simultaneous moves is refused and springs back, the same as a taken seat. Locked once either
  teammate has pressed End Turn (recommend; open detail 13).
- **Why it creates decisions.** Which card is worth sharing (an aura beats a big body), who feeds it, and which board
  it fights on (fight order now decides where it goes).
- **Presentation.** The slot is the existing board slot frame, repeated at the end of both boards (no new prop). When
  a teammate's effect touches it, the effect plays on both screens; when it is moved, it flies between the boards.
- **Engine cost: L.** Cross-run shared state (both runs read one team-owned card), server-ordered writes, every
  "on board" iterator must include it in the shop, reducer + snapshot + replay support.
- **Risks.** Snowball (fed by two economies; consider "Shop buffs from your teammate give half"); determinism (each
  run must log the shared card's value at each read, or replays drift: the log must carry the server-ordered
  updates); symmetry (both teams get one, combat is unaffected beyond which board it joins); perf (re-render of both
  boards on each update: keep the slot a memoized `Unit`).

### 5.2 Team Avenge

- **Rule.** Avenge (X) counts friendly deaths across BOTH of your team's boards in the fight. A newcomer's Avenge
  counter starts at the number of team deaths so far.
- **Example.** Kevin's board of five small Echo minions dies first; Mike steps in with an Avenge (4) Dwarf that
  triggers on arrival, then again at the next 4.
- **Decisions.** "Who is the sacrifice board?" Teams plan a wide, dying opener for a strong closer.
- **Presentation.** On `tagIn`, each Avenge counter ticks up from the fallen board with a short fly per counted death
  (one-shot).
- **Cost: S.** A per-side counter that survives the step-in. **Risks:** Avenge cards get stronger in Duos only;
  symmetric and deterministic by construction.

### 5.3 Gold Tip

- **Rule.** Once per turn you may drag 1 Gold from your Gold onto your teammate's portrait. They get it at once.
- **Example.** Mike has 9 Gold and needs 10 to reach Tier 5; Kevin, rolling for a triple, tips 1.
- **Decisions.** Pure team economy: who tempos, who scales.
- **Presentation.** The existing Gold float + coin sound, flying to the portrait.
- **Cost: S-M** (rides the pass packet infra). **Risks:** low snowball (1 per turn); needs a cap so a team cannot
  funnel everything into one player.

### 5.4 Hand-off

- **Rule.** When your board falls, the last minion that died gives the stats it gained in this fight to the first
  minion of your teammate's board as it steps in (combat-only, as every combat buff).
- **Example.** Kevin's Rally grower reached +14/+14 before it fell; Mike's leftmost Taunt steps in with +14/+14.
- **Decisions.** Order matters: put the grower first and the best receiver leftmost on the second board.
- **Presentation.** A beam from the fallen body's slot to the newcomer's slot during the `tagIn` beat.
- **Cost: M.** Track per-instance combat gains (Engraved already measures them). **Risks:** snowball in long fights;
  symmetric.

### 5.5 Shared Starform

- **Rule.** A team with Celestials has ONE Starform token, in both teammates' Shops; both feed it, either may cash it
  in (Consume or Collapse), and it is then gone for both.
- **Example.** Mike feeds it with three Shop buffs, Kevin's Devotee Collapses it on his board for the payoff.
- **Decisions.** Who cashes, and when.
- **Presentation.** The existing starform-pull FX, drawn on both screens.
- **Cost: M** (reuses the Shared slot's server-ordered team state). **Risks:** Celestials are stronger in Duos; a
  race on cash-in (server order decides).

### 5.6 Lend Equipment

- **Rule.** Once per turn you may use your teammate's Equipment on your own board, spending their charge.
- **Example.** Mike holds Titan Hammer but has no target this turn; Kevin uses its charge.
- **Decisions.** Who spends the charge each turn.
- **Presentation.** The teammate's Equipment slot shows on your hero block, dimmed when spent.
- **Cost: M.** Cross-run charge state. **Risks:** low.

### 5.7 Team Runeforge

- **Rule.** On a Runeforge turn the team gets ONE extra shared pick: a 3-rune Discover both teammates see; the first
  to pick takes it, the other gets the rest of the offer's best fit next Runeforge.
- **Decisions.** Discuss who needs it.
- **Cost: M.** **Risks:** rune balance assumes one player; first-pick race (server order).

### 5.8 Twin Bond

- **Rule.** At End of Turn, if you and your teammate both have a minion with the same name on board, both copies gain
  +1/+1.
- **Decisions.** Coordinate buys so copies split across boards instead of tripling.
- **Presentation.** A one-shot thread between the two portraits, then the buff pop on both copies.
- **Cost: S-M.** **Risks:** fights against tripling; mostly a small bonus.

### 5.9 Duet spells

- **Rule.** New Shop spells, Duo only, that both teammates pay for half the cost, and that hit both boards (e.g.
  "Duet: give both boards' minions +1/+1").
- **Decisions.** Both must agree to spend.
- **Cost: M-L** (a two-party confirm across clients). **Risks:** new content, and a pool-membership question for
  non-Duo modes.

### 5.10 Cross-board Shop spells

- **Rule.** A Shop spell that targets a friendly minion may target a minion on your teammate's board.
- **Decisions.** The richest one: "buff my carry for me".
- **Cost: L.** A spell cast in one run that mutates the other run (server relay + both logs). **Risks:**
  determinism (the receiving run must apply the cast at a defined point), cheating surface.

### Ranking (value per cost)

1. **Shared Slot** (owner's idea; the signature mechanic; L)
2. **Team Avenge** (makes tag-team order matter; S)
3. **Gold Tip** (cheap, constant team decisions; S-M)
4. Hand-off (M)
5. Shared Starform (M, cheap once the Shared slot exists)
6. Lend Equipment (M)
7. Twin Bond (S-M)
8. Team Runeforge (M)
9. Duet spells (M-L)
10. Cross-board Shop spells (L)

**Recommended v1:** the Shared Slot, Team Avenge and Gold Tip. One headline, one combat-side, one shop-side; Gold Tip
reuses the pass infra and Team Avenge is a counter. Hand-off and Shared Starform are the natural v2 (Shared Starform is
nearly free once the Shared slot's team state exists).

## 6. OPEN DETAILS (recommended default in bold)

1. **Team hearts:** **7 per team** (one fight a round, so a match is as long as 1v1). Alternative 10.
2. **Who fights first:** **alternate each round (seat order), and either teammate may flip it during the shop**
   (server-ordered, last change wins, locked at the first End Turn). Alternative: the board with fewer minions first.
3. **Second board's Start of Combat and hero effects when it steps in:** **yes, they fire on step-in** against the
   current survivors (real-time + cross-phase defaults). Same for its next-combat spells and quest/rune mods.
4. **Damage formula:** **hearts, 1 per lost fight** (Versus never uses damage). Alternative: lose 2 hearts when the
   winner still has its FIRST board standing.
5. **Attack order at step-in:** **the turn pointer continues** (if it was the wiped side's turn, the newcomer
   attacks next), the newcomer starts from its leftmost.
6. **Pass limits:** **free, unlimited, but each card once per turn** (no passing straight back), refused with a full
   hand, closed at your own End Turn.
7. **What can be passed:** **minions and spells** (with stats, enchantments, Gilded); not runes, Equipment, the
   Starform, quests.
8. **Teams in the room:** **seat pairs, p1+p2 vs p3+p4** (left vs right of the VS mark), chosen by dragging to a
   seat. No host assignment.
9. **Gold and shops:** **separate** (each has their own run, Gold, tier, shop), as in HS Duos.
10. **Teammate disconnects:** **as Group:** the 30 s pause, then auto (their last locked board fights in their
    slot); three auto rounds in a row = the TEAM is out. The connected teammate keeps playing; passes to an absent
    teammate are refused.
11. **XP:** **125 / 125 winners, 50 / 50 losers.**
12. **Seeing your teammate's board:** **yes, live**, by hovering/pinning their rail row (it reuses the spectator frame
    stream: your teammate counts as a watcher of you, so publishing turns on only in Duos).
13. **Shared Slot lock:** **changes allowed until either teammate presses End Turn.**
14. **Concede:** **one teammate's concede = the team is out** (a 1-player team cannot continue a 2-board mode
    cleanly). Alternative: the other plays on with a single board.
15. **Modifiers (Freedom / Summit):** **allowed**, pinned per run as today.
