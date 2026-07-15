# Combat event ordering

The exact order the deterministic simulator emits events — the sequence `simulate()` writes
into the log and the UI replays beat by beat. **Source of truth:**
[`packages/core/src/combat/simulate.ts`](../packages/core/src/combat/simulate.ts) —
`performAttack`, `killOrReborn`, `applyDamage`, `flushImmediateAttacks`, `summonMinion`.

Combat is a pure function; the UI only replays this log and **never computes an outcome**. Where the
replay deliberately re-orders events for readability (e.g. deferred clash buffs), that's a
presentation layer on top of this log — noted inline below.

> **The one rule that governs everything:** a clash is **simultaneous — all damage applies before any
> death resolves.**

---

## 1. Event vocabulary

Twenty event types. Recruit-phase effects (Battlecry, buff-on-summon, Consume) are baked into stats
**before** combat and emit none of these.

| Group | Event | Meaning |
|---|---|---|
| **Action** | `attack` | A minion swings. Carries `swing` (0/1 for Flurry). |
| | `sc` | Start-of-Combat cast (with `cast:true`) or mid-combat narration (spell-power gain, "Echo"). |
| | `rally` | Deathsayer's Rally fires another unit's Echo. |
| **Damage** | `dmg` | A hit lands. Carries `amount` + `remainingHp`. |
| | `poison` | Toxin destroys the target (HP → 0). |
| | `venomLost` | A Venomous body spent its Toxin. |
| **Defense** | `shield` | A Ward absorbs the hit — no `dmg` follows. |
| | `shieldUp` | A unit gains a Ward. |
| **Death & return** | `death` | A body falls. `rise:true` marks a Rise's first death (shown, not counted as a kill). |
| | `reborn` | A Rise body returns at base Attack / 1 HP. |
| | `ascend` | Mid-combat transform (Tara → Taragosa). |
| **Board** | `summon` | A token/minion enters. Carries its snapshot + `index`. |
| | `toHand` | A combat effect adds a card to your hand (Arcane Weaver). |
| **Stats & keywords** | `buff` | A stat gain (`+atk/+hp`). |
| | `improve` | A summon-aura strengthens (Kennelmaster). |
| | `hpGrant` | Sergeant's live HP-grant total. |
| | `maxGold` | Soulsman's Avenge raises max Gold. |
| | `keyword` | A keyword is granted (Mumi → Rise). |
| | `keywordLost` | A keyword is stripped (Tauntbreaker). |
| | `reveal` | A Stealth minion attacked, losing Stealth. |

---

## 2. The combat, top to bottom

The once-per-fight spine. Each stage runs to completion before the next. Every effect within a stage
opens its own **resolution step** (`nextStep()`) — the unit the UI groups events into on-screen
"moments."

0. **Setup.** Boards are captured; recruit-phase effects are already baked into stats (no events).
   Combat-time effects are registered on every minion.
1. **The Reclaimer pre-pass.** Any marked player minion is destroyed now — its Deathrattle fires
   (tokens may overflow a full board) — and the exact body is queued to reclaim its slot later.
   `flushResummons()` rejoins it at once if there's room.
2. **Start of Combat.** Quest marks & buffs first (Blood Trail / Deep Hunger marks, Rulebreaker's
   Crown, Umbral Energy, Contract Rewrite), then Taurus's `scEngraveAll` priority pass, then the main
   casts:
   - **Player minions left→right, then enemy left→right** — each `sc` / `dmg` / `summon` / `buff` its
     own step.
   - Shared Circuit, then Echoing Coop fires every player Echo once (no death).
3. **First attacker.** More living minions goes first; a tie is broken by the seeded RNG.
   *Pre-emptive Assault* overrides — the player strikes first, period.
4. **Opening immediate strikes.** Bloodlust-marked minions queue an out-of-turn swing →
   `flushImmediateAttacks()` (also drains any Whelp summoned during SoC / Reclaimer) →
   `flushAscensions()`.
5. **Attack rotation.** Sides alternate; each cycles its board left→right *by identity* (a 0-Attack
   minion is skipped). Per turn:
   - `performAttack()` — the exchange (see §3)
   - `flushImmediateAttacks()` — Whelps & other out-of-turn strikes
   - `flushResummons()` — a Reclaimer body reclaims a freed slot
   - `flushAscensions()` — a unit over its threshold transforms (`ascend`)
6. **Outcome.** Loops until a side has no minion that can attack. Result = win / lose / draw; loss
   damage = the opponent's tier + the summed tiers of their survivors; run carry-backs settle.

---

## 3. The attack exchange — `performAttack()`

> **The rule:** the clash is **simultaneous, in two phases.** **Phase 1** applies every hit — cleave,
> main, retaliation — with **no death resolved**. Only then does **Phase 2** resolve deaths, in damage
> order. So a unit trading into a Deathrattle body takes its counter-damage *with* the kill, never
> after the rattle's summons.

Opens a new step. If the attacker has Stealth it drops → `reveal`. Then, **per swing** (Flurry runs the
whole thing twice, each swing its own step):

### Swing — the wind-up

1. The swing fires → `attack`.
2. **On-attack effects** resolve — the `onAttack` bus (Rally, Crypt Drake, Raptor, Taragosa) plus
   player Rally re-procs (Law of Teeth…), Better Bot's mech buff, Perfect Core's spell grant. None
   change this swing's damage number. → `buff` · `rally` · `summon` · `toHand`.

### Phase 1 — apply all damage (no death resolves yet)

3. **Cleave neighbours** (if Cleave) — each neighbour of the target takes the attacker's Attack.
4. **Main hit** — the target takes the attacker's Attack.
5. **Retaliation** — the attacker takes the target's *snapshot* Attack. Skipped if the attacker is
   attack-immune (Bounty Bot, or a Bloodlust swing).
6. **Each hit, in turn, resolves as:**
   - Immune → nothing; **or**
   - Divine Shield present → `shield` (absorb, blocks Toxin), no `dmg`; **or**
   - `dmg` → `onDamaged` bus (Target Dummy gains Attack here) → if Venomous & the hit landed:
     `poison` + `venomLost` on the poisoner.

   > **Presentation note.** `onDamaged` buffs (Target Dummy) fire mid-Phase-1, but the replay slides
   > that `buff` to the tail of the clash so it never splits the two damage numbers
   > (`deferClashBuffs` in `useCombatReplay.ts`). The sim log order is unchanged.

### Phase 2 — resolve deaths (damage order: cleave → target → attacker)

Each fallen body runs `killOrReborn` as its own step. Two paths:

7. **Rise** (the body has Reborn available):
   `death` (`rise:true`) → *(step)* Deathrattle → `summon` → *(step)* `reborn`.
   The body vacates its slot first, the rattle's summons fill it, then it returns at base Attack / 1 HP
   to the **right** of those summons. If the side is already at 7 living, the Rise fails → it stays a
   true death.
8. **True death:**
   `death` → `onDeath` bus (Deathrattle) → `summon` · `buff` → Echo doublers (Sylus, Funeral Engine)
   re-fire the rattle → `avenge` bus → Bone Throne / Pit Without End / Empty Graves may trigger.

   > **Presentation note.** Every event an `avenge` handler emits is stamped `avenge:true` (presentation
   > metadata, like `step` — zero effect on resolution). The replay holds those Avenge payoff beats until
   > AFTER the death cascade's summons deploy (`deferAvengeAfterSummons` in `useCombatReplay.ts`): otherwise a
   > multi-death clash (the Avenge lands on death #2, before death #3's summon) or a deferred attack-on-summon
   > token (the Whelp summons at the post-cascade flush) shows the payoff before the token pops in. The sim log
   > order is unchanged; the reorder only hops an Avenge event past summons + other-unit events, so the folded
   > frame is identical.

### On-kill (own step, after every Phase-2 death)

9. **Slaughter fires — but only where `killer === attacker`.** Each victim in damage order: the
   attacker's own kills (main + cleave) proc `onKill`; a *defender felling its attacker* does not.
   Includes the Slaughter quest tally, Law of Teeth / Author's Hand re-fires, and Feeding Line queuing
   the next Beast's out-of-turn strike.

### After the exchange — the three flushes

10. **`flushImmediateAttacks()`** — drains the out-of-turn strike queue. Chains via a guard, so a
    granted attack that slaughters can grant the next. Two kinds of queued item:
    - **A deferred attack-on-summon token** (Whelp): `summon` → `attack` → `dmg` …. The token's
      *whole* summon defers here (owner ruling 2026-07-10), so the entire clash's deaths + Deathrattles
      resolve first, then the token summons **and** strikes as one discrete beat — never interleaved
      with the other units' deaths. Multi-token rattles run each in turn (summon + strike before the
      next lands, so the board-cap "room after the first attacked" logic still holds). Consequence: the
      token is off-board for the rest of the cascade, so a same-clash Deathrattle can't buff it before
      it exists — which also keeps the buff/summon event order consistent for the replay's frame fold.
    - **A queued strike** (Bloodlust, Solaris Fang's Avenge — `shieldUp` then strike, Feeding Line).

11. **`flushResummons()`** — a Reclaimer body reclaims a slot freed this exchange.
12. **`flushAscensions()`** — a unit that crossed its threshold transforms → `ascend`.

---

## 4. Where each mechanic lands

| Mechanic | Trigger | Events, in order | Timing rule |
|---|---|---|---|
| **Divine Shield** (Ward · `DS`) | Takes a hit while shielded | `shield` | Absorbs the *first* instance — no `dmg` — and blocks Toxin. Phase 1. |
| **Venomous** (Toxin · `V`) | Its damage lands (unshielded) | `dmg` → `poison` → `venomLost` | Sets HP to 0 in Phase 1; the death resolves in Phase 2. |
| **Cleave** (`C`) | A Cleave minion attacks | `dmg` × neighbours | Splash hits both neighbours in Phase 1, before any death resolves. |
| **Windfury** (Flurry · `W`) | A Flurry minion attacks | `attack` × 2 | The whole exchange runs twice; each swing its own step. 2nd only if it survives the 1st. |
| **Reborn** (Rise · `R`) | First death | `death` → `summon` → `reborn` | Die → Deathrattle → return at base Attack / 1 HP, to the *right* of what it summoned. Fails at 7 living. |
| **Deathrattle** (Echo · `onDeath`) | True death (or a Rise's death) | `death` → `summon` · `buff` | Fires *before* a Rise body returns. Echo doublers (Sylus) re-fire it in place. |
| **Attack-on-summon** (Whelp · `attackOnSummon`) | Summoned by a Deathrattle | `summon` → `attack` | **Deferred:** the *whole* summon + strike land together at the flush, after the cascade — off-board meanwhile (see §3.10). |
| **On-kill** (Slaughter · `onKill`) | Fells a body while attacking | `summon` · `buff` · `toHand` | After *all* Phase-2 deaths. Only when `killer === attacker` — a defender's retaliation kill doesn't count. |
| **Stealth** (`ST`) | Attacks for the first time | `reveal` | Lost the instant it swings, before the `attack` lands. |
| **On-damaged buff** (Target Dummy · `onDamaged`) | Takes a hit | `dmg` → `buff` | Phase 1. The replay slides the `buff` to the clash's tail so it never splits the damage. |
| **Immediate attacks** (Bloodlust · Solaris · Feeding Line) | Queued out-of-turn | `shieldUp`? → `attack` | All share the `pendingAttackOnSummon` queue, drained by `flushImmediateAttacks`. |
| **Start of Combat** (`startOfCombat`) | Fight begins | `sc` → `dmg` · `summon` · `buff` | Player left→right, then enemy left→right. Taurus's engrave pass runs first. |

---

## 5. Load-bearing rules

- **Two-phase simultaneity.** Every hit of a clash applies in Phase 1 before *any* death resolves in
  Phase 2. A mutual kill counts both bodies down before either Deathrattle fires.
- **Deaths in damage order.** Phase 2 resolves victims as `cleave neighbours → target → attacker` —
  the order they were struck.
- **Every effect is its own step.** Each death, cast, and reward opens a `nextStep()`. The replay
  groups events sharing a step into one on-screen "moment."
- **Rise = die → rattle → return.** A Reborn body genuinely leaves its slot, its Deathrattle fills the
  gap, then it re-inserts to the right of those summons — at base Attack, 1 HP.
- **Recruit effects don't emit.** Battlecry, buff-on-summon, and Consume bake into stats during the
  shop phase. Combat only replays combat-time effects.
- **Attack-on-summon defers.** A Whelp's whole summon + strike waits for `flushImmediateAttacks` after
  the cascade — so it's off-board for same-clash buffs, and its `summon` never interleaves with the
  other units' deaths.
- **Immediate attacks share one queue.** Whelps, Bloodlust, Solaris Avenge, and Feeding Line all route
  through `pendingAttackOnSummon` → `flushImmediateAttacks`, out of turn order.
