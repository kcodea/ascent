# Combat events & trigger order

Reference for `@game/core`'s combat event log — the score-authoring source of truth for the
Combat Choreographer (`docs/superpowers/specs/2026-07-06-combat-choreographer-design.md`). The UI
never computes outcomes; it replays this log (`CombatResult.events`) on its own clock. This doc is
factual/terse by design — a reference, not prose. Verify against source before relying on it for a
new phase: `packages/core/src/types.ts` (the `CombatEvent` union, ~line 455) and
`packages/core/src/combat/simulate.ts` (the resolution loop).

## 1. Event vocabulary (19 types)

All events are stamped `{ ...payload, step?: number }` (§4). Grouped by family.

### Actions (things a minion *does*)

| type | payload | meaning |
|---|---|---|
| `sc` | `source, text, cast?: true` | Start-of-Combat narration. `cast: true` = a genuine SoC damage cast (UI plays zap + bolt + flash); absent = mid-combat narration only (spell-power gain, etc. — log + trigger pulse, no bolt). |
| `attack` | `attacker, defender, swing` | One swing of an attack (`swing` = 0 first hit, 1 = Windfury's second). The wind-up; its own moment. |
| `summon` | `minion: MinionSnapshot, side, index, source?` | A minion enters play (token, Deathrattle spawn, resummon). `source` = the uid it summoned near, if any. |
| `rally` | `source, target` | Deathsayer's Rally fires `target`'s Deathrattle out of the normal death path. |

### Impact results (consequences of an action — collapse into one "impact" beat)

| type | payload | meaning |
|---|---|---|
| `dmg` | `target, amount, remainingHp` | A damage instance actually landed (post-Immune/Shield checks). |
| `shield` | `target` | A Divine Shield absorbed a hit and popped. |
| `shieldUp` | `target` | A fresh Divine Shield was granted (e.g. Solaris Fang's Avenge, right before an out-of-turn strike). |
| `poison` | `target` | A Venomous hit destroyed its target (health forced to 0). |
| `venomLost` | `target` | The poisoner's Venomous keyword spent/dropped after a proc. |
| `death` | `target, side, rise?: true` | A minion died. `side` lets the UI count enemy kills without uid-matching. `rise: true` marks a Rise's FIRST death — shown (slot vacates) but NOT counted as a kill (it returns). |
| `reborn` | `target, hp, attack, keywords, after?` | A Rise minion returns at base Attack + 1 Health, granted keywords shed. `after` = the uid it re-slots to the RIGHT of (when its own Deathrattle summoned into its old slot). |
| `reveal` | `target` | A Stealth minion attacked and lost Stealth (revealed = now targetable). |
| `keyword` | `target, keyword, source?` | A combat effect grants a keyword mid-fight (Mumi → Rise, Ryme-replayed keyword Battlecries). Rides in the RESULT family so it never splits an impact run mid-death-cascade. |
| `ascend` | `target, into` | Mid-combat transform (Tara → Taragosa, Spirit Pup → Spirit Worgen) — keeps current stats/buffs, swaps identity + effects + keywords. |

### Board/economy changes (carried-back effects, telegraphed live)

| type | payload | meaning |
|---|---|---|
| `buff` | `target, attack, health, source` | A stat grant to one minion. A contiguous RUN of these collapses into one beat (a multi-target buff/aura lands at once). |
| `improve` | `target, amount` | Kennelmaster's Avenge strengthens its own summon-aura bonus. |
| `maxGold` | `target, side, amount` | Soulsman's Avenge permanently raises max Gold. |
| `toHand` | `cardId, side, source?` | A combat effect adds a specific card to the hand (Arcane Weaver, Ryme-replayed Discover, generated spell/minion) — resolved to the real card during the fight, not silently at settle. |
| `hpGrant` | `target, amount` | Sergeant: live HP-grant amount after each Attack-gain improvement (so the tooltip/telegraph shows the current accrued number). |

*(19 types total across the three tables above: Actions — sc, attack, summon, rally (4); Impact
results — dmg, shield, shieldUp, poison, venomLost, death, reborn, reveal, keyword, ascend (10);
Board/meta — buff, improve, maxGold, toHand, hpGrant (5). This line is just the tally; the tables
above are the authoritative per-type payload/meaning.)*

## 2. Combat lifecycle (trigger order, top to bottom)

Source: `simulate()` in `packages/core/src/combat/simulate.ts`. Section comments there cite the
handoff's **A.3** combat-resolution rules; step numbers below reference those comments.

1. **Setup.** Instantiate both boards from `BoardMinion[]` (clone — never mutate a shared `CardDef`),
   apply run-wide auras (Undead/Imp aggregate auras + per-card enchants) to the player's starting
   minions, register every minion's effect handlers on the `CombatBus`.
2. **The Reclaimer's marked-minion destruction.** Any player minion flagged `resummon` is destroyed
   FIRST — its Deathrattle fires now (may overflow the board) — and an exact copy is queued to
   reclaim its slot the next time the board has room (never mid-summon-cascade; its own tokens win
   the immediate scramble). `flushResummons()` runs right after — a non-full board gets it back
   immediately, a full board makes it wait.
3. **Start-of-Combat casts (A.3 step 1).** Player minions left→right first, then the enemy's (an
   enemy Taurus engraves its line too — captured boards' SoC effects are live). Effects reading
   player run-state self-gate (an enemy snapshot has no run state).
4. **First-attacker rule (A.3 step 2).** More living minions goes first; tie → seeded RNG coin flip.
   **Pre-emptive Assault** overrides the whole rule: the player always strikes first (no tie roll
   consumed).
5. **Pre-loop flushes.** `flushImmediateAttacks()` (Whelps summoned during SoC/Reclaimer strike
   before round 1) then `flushAscensions()` (a SoC buff/cast can already push Tara/Spirit Pup over
   an ascend threshold — transform before the loop starts).
6. **The alternating attack loop.** Sides alternate; each side cycles its own minions left→right by
   *identity* (not list index — a dead minion stays in the array, re-indexing would skip a
   neighbour). Per attack:
   - `performAttack` resolves the exchange (§3).
   - **Flush order after every attack, always in this sequence:** `flushImmediateAttacks()` (Whelps
     spawned by this attack's death cascade strike immediately, out of turn order — bounded by
     `IMMEDIATE_ATTACK_GUARD`, since a Whelp kill can chain into another Whelp) → `flushResummons()`
     (a Reclaimer body waiting in the wings reclaims a slot freed by this attack's deaths, never
     interleaved mid-cascade) → `flushAscensions()` (a threshold crossed this attack transforms now,
     between actions).
   - A minion that Reborns off a retaliation keeps its place in the rotation (attacks again next for
     its side) rather than going to the back.
   - Loop ends when one side has zero living minions, or the `ITERATION_GUARD` (300) is hit (→ draw).
7. **Outcome (A.3 step 8).** `win` / `lose` / `draw` from final survivor counts; both-empty is a draw.
8. **Loss damage (A.3 step 9).** On a loss: the enemy's tavern tier + the sum of surviving enemy
   minions' tiers (token/unknown counts as tier 1) — capped per-round by the run loop.
9. **Carry-back tallies.** Per-instance state persisted to the run board (summon-bonus improvements,
   HP-grant accrual, ascend progress, Engraved/overflow perma-buffs, hand grants, spell power, card
   buffs, Fodder grants, deferred economy Battlecries, max-Gold gain, free rolls, spells cast, Undead
   buy-Attack/aura gain, Imp/Fodder aura gain) — assembled into the returned `CombatResult`.

## 3. The exchange micro-order (`performAttack`, per swing)

One call = one swing (Windfury = 2 swings, each its own step — see §4). Order:

1. **Reveal.** If the attacker has Stealth, it's lost now (becomes targetable) — emits `reveal`.
2. **Target chosen.** Random among living, non-Stealthed defenders; Taunts first if any exist.
   No legal target → the swing is skipped.
3. **`attack` emitted** (the wind-up), then `onAttack` fires on the bus — Rally + other on-attack
   effects (Better Bot's Mech rally-buff, Rallying Offensive's double-fire, etc.).
4. **PHASE 1 — simultaneous damage application** (owner ruling 2026-07-02): every hit of the clash
   *applies* before any death resolves. In order:
   - **Cleave** neighbours (if attacker has Cleave) take the attacker's damage.
   - **Main hit**: the target takes the attacker's damage. Its counter-attack value is snapshotted
     BEFORE this lands (retaliation uses the pre-clash body).
   - **Retaliation**: the attacker takes the target's (snapshotted) counter-damage.
   - Each hit's vocabulary, in `applyDamage`: Divine Shield check (pops → `shield`, blocks even
     Venomous, early-return) → HP debit + `dmg` → `onDamaged` bus notify (Gryphon) → if the hit was
     Venomous, force health to 0 + emit `poison`, then the poisoner's own Venomous keyword drops
     (`venomLost`). A 0-damage hit is a total non-event (no Shield pop, no Venomous proc, no watcher).
5. **PHASE 2 — deaths resolve in damage order** (cleave victims → target → attacker): each body left
   at ≤0 HP runs `killOrReborn` now — Deathrattle/Rise included — so a mutual kill sees the FULL
   post-exchange board before either rattle fires. Per death, see §3a below.
6. **On-kill rewards, after ALL deaths in the clash.** Every kill in the clash procs the killer's
   on-kill effects (cleave splash and a defender felling its attacker both count — owner ruling
   2026-07-03), emitted in damage order. A dead killer's own handlers self-suppress.
7. **Gnasher-style re-attack.** Keyed to the MAIN target's kill only (not cleave/mutual): if the
   attacker has `reAttackOnKill` and is still alive, `performAttack` recurses (bounded by
   `REATTACK_GUARD`).

### 3a. Per-death resolution (`killOrReborn`)

- **Not Reborn-available:** flag dead, emit `death` → count enemy-death tally / player-Deathrattle
  tally → `onDeath` bus emit (Deathrattles + death-watchers) → Sylus the Reaper re-procs the dying
  minion's own Deathrattle extra times → Avenge tally + `avenge` bus emit.
- **Reborn-available (Rise):** emit `death` with `rise: true` (the body genuinely vacates its slot
  first) → the unit's own Deathrattle/on-death effects fire (`fireOwnDeathrattles`, Sylus re-procs
  apply here too) → **board-cap gate**: if the side is already at 7 living, the Rise does NOT
  return — it stays dead for real, counts as a true death/Avenge tick, no second `death` event. Else
  the body resets to base Attack (×2 if golden) / 1 Health, sheds combat buffs + granted keywords,
  re-applies run-wide auras, re-slots to the right of whatever its own Deathrattle summoned into its
  old slot, and emits `reborn`.

## 4. Step tags — how they map onto this order

`simulate()` stamps every emitted event with `step` (a monotonically increasing counter local to one
combat). `nextStep()` is called at every atomic resolution boundary; **the compiler may MERGE
consecutive steps into one presentation moment, but must never SPLIT one step apart** — this is the
law any future grouping rule (`GroupingRules` in `packages/ui/src/choreo/compile.ts`) must respect.

One step boundary per:

- **An exchange's wind-up + Phase 1** (the `attack` emit through the simultaneous damage application)
  — each Windfury swing and each re-attack (Gnasher) opens its own new step.
- **Each victim's death resolution** (`killOrReborn`'s entry) — separate from the exchange that dealt
  the killing blow.
- **A Rise's rattle effects** — its own step, after the `death(rise: true)` emit and before the body
  returns.
- **A Rise's body returning** (`reborn` emit) — its own step, after the rattle's summons have landed.
- **On-kill rewards** — one step for the whole clash's on-kill batch, after every death in that clash
  has resolved (not per-victim).
- **A Start-of-Combat cast** — each minion's SoC effect gets its own step.
- **An out-of-turn strike** (Whelp attack-on-summon, a queued shield-then-strike) — each drained
  entry from the queue opens a fresh step (a Solaris shield grant and its paired strike are two
  steps, never merged into the death resolution that queued them).
- **A resummon re-entering** (The Reclaimer) — each reclaimed body is its own step.
- **A mid-combat ascension** (`ascend`) — its own step, applied at the next clean beat.

Untagged events (`step === undefined`) occur only in legacy saved replays or synthetic test
fixtures — never in fresh sim output. The compiler treats each untagged event as its OWN group (no
sim-declared simultaneity to lean on), per the "untagged events are each their own group" safety
rule in `compileMoments`'s `stepGroups`.
