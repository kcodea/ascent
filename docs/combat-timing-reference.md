# Combat timing reference

Every timing that governs a combat beat, every keyword's cost, and what each **interaction** totals end to end.

> **Assumptions:** `combatSpeed = 1×`, choreo `speed = 1.5` (shipped defaults). Beat **holds divide by
> `combatSpeed`**; **CSS/Pixi FX durations do not** (a known clash — see roadmap). Strike duration is
> distance-scaled, so "contact" varies; tables use a typical adjacent-slot swing.
>
> Sources of truth: `CombatEvent` union (`packages/core/src/types.ts`), `choreoConfig.ts` `DEFAULTS`,
> `lungeConfig.ts` `DEFAULTS`, `.unit.dying*` in `styles.css`, lead constants in `useCombatReplay.ts`,
> `compile.ts` grouping rules.

## 1. The three mechanisms

Mixing these up is the usual source of confusion:

1. **The attack beat is ENGINE-driven.** It ends at the lunge's `contact` position, *not* by the clock.
2. **Every other beat is CLOCK-driven:** `beatDelay(next.primary.type) × 1.5`, plus `attackGap` (220ms) when an
   impact is followed by an attack. Overlap kinds (`summon`/`reborn`/`improve`) use a flat `overlapMs` 240ms.
3. **Leads are ADDED on top** (`d += lead`), not max'd with the hold. A 1150ms lead really does add 1150ms.

**Grouping matters as much as duration** (`compile.ts`):
- `RESULT_TYPES` = `dmg, shield, shieldUp, poison, venomLost, death, keyword` — a contiguous run **collapses into
  ONE moment**. This is why a Ward break, a Venom kill, and a death are all *free*: they ride the impact beat.
- Runs of `buff` collapse into one `buffWave`.
- `buff, rally, summon, reveal, improve` following an **attack** are **absorbed into its wind-up** (no own beat).

## 2. The lunge (attack beat — ends at contact)

| Phase | ms | Notes |
|---|---:|---|
| Wind-up | 700 | `windupDur` |
| Rally / absorbed-buff pause | +440 | only if a Rally fires or on-attack buffs are absorbed |
| Strike | 130–440 | `distance ÷ 1100px/s`, clamped; adjacent ≈ 180–260 |
| Smack lead | −5 | impact fires just before the strike lands |
| **Contact — beat ends** | **≈875** | plain; **≈1315** with a Rally |
| Settle | 340 | plays **after** contact, fire-and-forget — does **not** extend the beat |

## 3. Every event type → its beat cost

| Event | Moment kind | Grouping | `beatDelay` | Hold @1× |
|---|---|---|---:|---:|
| `attack` | attackExchange | absorbs windup flashes | *engine* | **≈875** (to contact) |
| `dmg` | damage | **collapses** (RESULT) | 460 | 690 |
| `shield` (Ward break) | shieldPop | **collapses** (RESULT) | 460 | *free* — rides impact |
| `shieldUp` (Ward gain) | shieldPop | **collapses** (RESULT) | 460 | *free* — rides impact |
| `poison` (Toxin kill) | poisonTick | **collapses** (RESULT) | 500 | *free* — rides impact |
| `venomLost` | poisonTick | **collapses** (RESULT) | 500 | *free* — rides impact |
| `death` | death / riseDeath | **collapses** (RESULT) | 400 † | *free* — rides impact |
| `keyword` (gained) | keyword | **collapses** (RESULT) | *none* → 300 | *free* — rides impact |
| `keywordLost` | keywordLost | own beat | *none* → 300 | 450 |
| `summon` | summon | own beat, **overlap** | 440 | **240** |
| `reborn` | reborn | own beat, **overlap** | 640 | **240** |
| `improve` | improve | own beat, **overlap** | 520 | **240** |
| `buff` | buffWave | run collapses | 140 | **210** |
| `sc` (Start of Combat) | scCast | own beat | 720 | 1080 |
| `rally` | rally | own beat | 720 | 1080 |
| `toHand` | toHand | own beat | 820 | 1230 |
| `maxGold` | maxGold | own beat | 560 | 840 |
| `ascend` | ascend | own beat | *none* → 300 | 450 ‡ |
| `hpGrant` | hpGrant | own beat | **0** | **0** |
| `spellProgress` | spellProgress | own beat | *none* → 300 | 450 |
| `questTrigger` | *(unmapped)* → damage | own beat | *none* → 300 | 450 |
| `questComplete` | *(unmapped)* → damage | own beat | *none* → 300 | 450 |
| `reveal` (Stealth breaks) | reveal | **absorbed** into windup | *none* → 300 | *free* |

† **`death: 400` is dead config.** `death` is in `RESULT_TYPES`, so it collapses into the preceding damage
moment whose `primary` is `dmg` — `beatDelay('death')` never fires on an ordinary combat death.
‡ `KIND_TO_KEY` maps `ascend → improve` (520), but `holdMs` keys on the **raw event type**, so that mapping is
dead code and `ascend` silently takes the 300 fallback.

**Seven event types have no configured hold** and silently use the 300 → 450ms fallback: `keyword`,
`keywordLost`, `ascend`, `reveal`, `spellProgress`, `questTrigger`, `questComplete`.

## 4. Every keyword → what it costs

| Keyword | Combat effect | Timing cost |
|---|---|---|
| **W** Windfury | `swings = 2` — emits **two `attack` events** | **2 full lunge cycles** (~3090ms for two plain swings) |
| **R** Reborn / Rise | death (`rise:true`) → `reborn` | +240 hold **+1150 lead** (attacker) / +800 (defender) |
| **DS** Ward | `shield` on break, `shieldUp` on gain | **free** — collapses into the impact moment |
| **V** Toxin | `poison` + `venomLost` | **free** — collapses into the impact moment |
| **C** Cleave | one attack, **multiple `dmg`** in one clash | **free** — all dmg collapses into one moment |
| **T** Taunt | targeting only | **none** |
| **IMM** Immune | no damage taken | **none** (no events) |
| **ST** Stealth | `reveal` on attack | **free** — absorbed into the wind-up |
| **RL** Rally | holds the wind-up, fires the pulse | **+440** to contact (+1080 if a separate `rally` beat) |
| **CR** Critical Strike | `crit` flag on the attack | **0 schedule cost**; FX outlive the beat (see §7) |
| **SL** Slaughter | on-kill trigger → emits buff/summon/… | cost = whatever consequence beats it emits |
| **SC** Start of Combat | `sc` beat | 1080 per cast |
| **M** Magnetic | recruit-phase weld | none in combat |
| **CN/FD** Consume / Fodder | recruit-phase | none in combat |
| **Avenge** | not an event — an `avenge:true` **stamp** on emitted events | cost = the consequence beats it emits; `deferAvengeAfterSummons` reorders them after summons |
| **Deathrattle / Echo** | `onDeath` → summon **or** buff **or** … | **depends entirely on the consequence** — see §6 |

## 5. Death animations (CSS — not speed-scaled)

| Variant | Class | Timeline | Ends |
|---|---|---|---:|
| Defender / plain | `dying` | collapse + pop `0 → 320` | **320** |
| Rise body | `dying rising` | fade `0 → 320` | **320** |
| Rise attacker (pulled home) | `dying rising returning` | fade `300 → 620` | **620** |
| Deathrattle | `dying dr` | fade `0 → 320`, slot @380 | **700** |
| Deathrattle attacker | `dying dr returning` | fade `600 → 920`, slot `720 → 1040` | **1040** |
| Plain attacker (pulled home) | `dying returning` | fade `360 → 680`, slot `480 → 800` | **800** |
| Pull-home slide | *(GSAP)* | delay 100 + dur 240 | lands **340** |

**Death FX (Pixi) — these are what the leads actually cover, not the fade:**

| FX | Duration | Fires |
|---|---:|---|
| Rise spirit burst (`burstDeathAuras` shards) | **420–780** (`420 + rnd×360`) | at landing (+340 for an attacker) |
| Deathrattle skull (pop 320 + hold + poof) | ≈600 (embers ≈800) | at landing |
| Ward shatter (`shatterAt`) | 140 flash + 420–780 shards | on the break, rides the impact |

## 6. Deathrattle: summon vs buff — completely different costs

A Deathrattle's cost depends entirely on *what it does*. `deathConsequenceLead` covers all three consequences:

| DR consequence | Hold | Lead | Total after contact |
|---|---:|---:|---:|
| Summons a token (attacker) | 240 | **+1150** | **1390** |
| Summons a token (defender) | 240 | +800 | 1040 |
| **Buffs allies** (attacker) | 210 | +1050 * | 1260 |
| **Buffs allies** (defender) | 210 | **+500** | **710** |

\* via `PULL_HOME_HOLD_DR`, which keys off the dying attacker having *any* `onDeath` effect — not off the
consequence type, so it already dominated `DR_BUFF_LEAD` for attackers.

`DR_BUFF_LEAD` (500) exists because the buff case is the **inverse** of the other two: instead of holding a
consequence back so the death reads first, it makes the beat long enough for its own FX. The base `buffWave`
hold is only 210ms, but a dead buffer is `sourceless` (`isDeathrattleBufferCard`) so its FX is a **descend**:

| Buff FX | ms |
|---|---:|
| **Descend** (dead source → `sourceless`) `dropMs` | **340** (+180 retract) |
| Tendril (live source) `travelMs` | 350 / 430 / 620 / 780 (per preset) |
| Stat-badge flash after landing | +360 |
| **DR buff total read (descend path)** | **≈700** |

→ `210 + 500 = 710ms` now covers the descend landing **and** its badge flash. Before the lead, the beat tore
down at 210ms — mid-descend — which dropped the `statHold` entries early, so the target's numbers **snapped**
to their new values instead of landing with the FX (the roadmap's "buff-tendril stat snap").

**Still open:** a buff wave from a *living* source (not a Deathrattle) takes the **tendril** path at up to
780ms + 360ms flash and gets **no lead** — only the 210ms base hold. That case is unchanged here.

## 7. FX that outlive their beat

| FX | Duration | Its beat | Overhang |
|---|---:|---:|---:|
| Crit text | **1520** | rides contact | **~650ms past the next beat** |
| Crit ring / card flash / shake | 380 / 470 / 280 | rides contact | fits |
| Damage float | 1500 | 690–870 | ~630–810 |
| Death float | 1000 | 690–870 | ~130–310 |
| Buff tendril + flash (living source) | 700–1140 | 210 | **490–930** |
| Buff descend + flash (Deathrattle) | ≈700 | 710 | *covered* |
| Reborn `risepop` | 700 | 240 (overlap) | 460 |
| Summon `summonpop` | 340 | 240 (overlap) | 100 |
| Lunge settle | 340 | ends at contact | 340 (by design) |
| DR skull (pop + poof) | ≈600 (embers 800) | covered by the 1150 lead | fits |

## 8. Interactions, end to end

Wind-up start → next beat start. **Bold** = dominant cost.

| # | Interaction | →contact | Hold | Lead | Consequence | **Total** |
|---|---|---:|---:|---:|---:|---:|
| 1 | Swing, nobody dies | 875 | 670 | — | — | **1545** |
| 2 | Swing, **defender** dies (plain) | 875 | 670 | — | — | **1545** |
| 3 | Ward break (no death) | 875 | 670 | — | — | **1545** |
| 4 | Toxin kill / Cleave multi-kill | 875 | 670 | — | — | **1545** |
| 5 | Swing, **attacker** dies (plain) | 875 | 670 | **+850** | — | **2395** |
| 6 | Mutual kill (both plain) | 875 | 670 | **+850** | — | **2395** |
| 7 | Attacker dies, DR summons nothing | 875 | 670 | **+1050** | — | **2595** |
| 8 | **Defender** DR → **buff** allies | 875 | 210 | **+500** | 450 | **2035** |
| 9 | **Attacker** DR → **buff** allies | 875 | 210 | +1050 | 450 | **2585** |
| 10 | Defender DR/Echo → **summon** | 875 | 240 | +800 | 450 | **2365** |
| 11 | **Attacker** DR/Echo → **summon** | 875 | 240 | **+1150** | 450 | **2715** |
| 12 | Defender dies → **Reborn** | 875 | 240 | +800 | 450 | **2365** |
| 13 | **Attacker** dies → **Reborn** | 875 | 240 | **+1150** | 450 | **2715** |
| 14 | **Windfury**, no deaths | 875×2 | 670×2 | — | — | **3090** |
| 15 | **Windfury**, kills on 2nd swing | 875×2 | 670×2 | — | — | **3090** |
| 16 | Swing with a **Rally** | 1315 | 670 | — | — | **1985** |
| 17 | **Avenge** → buff payoff | — | 210 | — | — | **+210** |
| 18 | **Avenge** → summon payoff | — | 240 | — | 450 | **+690** |
| 19 | Each **extra** summoned token | — | 240 | — | — | **+240** |
| 20 | Start-of-Combat cast (per beat) | — | 1080 | — | — | **1080** |
| 21 | Stealth attacker (reveal) | 875 | 670 | — | — | **1545** (reveal free) |
| 22 | Keyword granted mid-combat | — | *free* | — | — | **0** (collapses) |
| 23 | Keyword **stripped** (Tauntbreaker) | — | 450 | — | — | **450** |
| 24 | `ascend` transform | — | 450 | — | — | **450** |
| 25 | `hpGrant` (Sergeant) | — | **0** | — | — | **0** ⚠ |
| 26 | Quest trigger / complete | — | 450 | — | — | **450** |
| 27 | Card to hand (Arcane Weaver) | — | 1230 | — | — | **1230** |
| 28 | Final beat | — | 900 | floor 950/1150 | — | **900–1150** |

### Worked example — attacker attacks, dies, Echo summons 2 tokens

```
   0 ── wind-up ─────────────────────────────── 700
 700 ── strike ──────────────────────────────── 875   ← CONTACT: damage + death land, beat advances
 875 ── [pull-home 340 · skull ≈600 · fade 600→920 · slot 720→1040]
        hold 240 + DR lead 1150 = 1390 ─────── 2265   ← token 1 (summonpop 340)
2265 ── overlap 240 ─────────────────────────── 2505   ← token 2
2505 ── hold → next attack 450 ─────────────── 2955   ← next swing
```
**≈3.0s.** (No `attackGap` here: it's only added when a *result* moment precedes an attack, and the moment on
screen is a `summon`.) A Windfury version of the same trade would add another ~1545ms.

## 9. Where the fat is

1. **The 1150/800 leads are NOT fat — leave them.** They look oversized against the death *fade* (620ms), but
   they're covering the **death FX**, which runs much longer: `burstDeathAuras` shatter shards live
   `420 + random×360` = **420–780ms**, and the Deathrattle skull ≈600ms (embers ≈800ms), both starting only
   once the body *lands* (+340ms for an attacker). Real slack is only ~240–270ms in all four cases, and the
   shard life is randomized — trimming would clip the longest-lived debris on some deaths. This is the opposite
   of `PULL_HOME_HOLD`, where the delay sat *after* everything had already finished.
2. **Windfury doubles everything** — two full 1545ms cycles. Nothing is shared between the swings.
3. **`attackGap` 220 + attack lead 450 = 670ms** after every impact (was 340 + 529.5 = 869.5 — trimmed
   2026-07-19 for the "dead time between units attacking"). A defender death (320ms) still leaves ~350ms of
   quiet, and the attacker's elastic **settle** (340ms, fire-and-forget after contact) now fills most of it.
   Further cuts risk the next wind-up starting while the previous attacker is still settling — that reads as
   overlap, not snappiness. Tune against the settle, not against zero.
4. ~~Buff Deathrattles are the inverse problem~~ — **fixed** by `DR_BUFF_LEAD` (500). Still open for a buff
   wave from a **living** source, which takes the tendril path (up to 780ms + 360ms flash) on a 210ms hold.
5. **`hpGrant` holds 0ms** and **7 event types** silently use the 300ms fallback (§3).
6. **Crit text runs 1520ms** and outlives its beat by ~650ms.
