> ⚠️ **HISTORICAL SNAPSHOT — DO NOT USE AS CURRENT RULES.** Archived 2026-07-15. This describes an earlier version of ASCENT (wave-20 course, small tribes, the old counter matrix). For current rules see [docs/GAME-RULES.md](../../GAME-RULES.md); for current content counts see [docs/CONTENT.md](../../CONTENT.md).

# ASCENT — Balance Handoff

**Snapshot date:** 2026-06-22 · **Purpose:** a self-contained brief for a *separate* balancing
conversation. Everything needed to reason about ASCENT's balance — the full roster, the counter
matrix, the economy curve, and the empirical signal from the headless balance runner — is below. No
prior context required.

---

## 0. How to read this (what's locked vs tunable)

- **LOCKED — balance *truth*:** the **tribe↔threat counter matrix** (§3). Each tribe is *supposed* to
  beat the threats it "answers" more than the ones it doesn't. Balance changes must serve the matrix,
  not re-litigate it.
- **DIALS — tunable:** stat numbers, card text values, economy/curve constants, pool depth. These are
  starting dials tuned *toward* the matrix.
- **Empirical signal** comes from `npm run balance` (the headless runner, §6). **Read its caveat:** it
  bakes a *mono-tribe* board at *base stats* — no triples, no Hero Power, no cross-tribe glue, no spells,
  no multi-turn snowball. So **absolute win% runs low**; it's the *relative* answered-vs-other signal
  that validates the matrix. Full-run comp strength (the "OP build" question) is **not** measured by the
  runner today — that analysis (§7) is grounded in the card data's scaling engines and flagged as design
  inference where it isn't empirical.

---

## 1. Game shape (context)

Single-player roguelike auto-battler. Each wave: **shop → build a 7-slot board → fight a threat-typed
enemy board**. Survive the climb. Bounded engine (6 tiers, gold cap 10, board 7). Threat is telegraphed
before each shop.

## 2. Economy & curve constants (`config.ts`)

| Constant | Value | Notes |
|---|---|---|
| Start / per-wave / cap Embers (gold) | 3 / +1 / **10** | One buy = 3. Opens on a 1-minion board. |
| Resolve (HP) | 30 | Same for **all** heroes today (no divergence yet). |
| Max wave (win) | 20 | Bounded climb, not endless. |
| Minion cost / sell / refresh | 3 / 1 / 1 | |
| Board / hand max | 7 / 10 | |
| Tier upgrade cost (→2..→6) | 5 / 7 / 8 / **11** / **10** | Note: **T6 is cheaper than T5.** Discount −1 per wave not upgrading. |
| Enemy curve | +1 width / 6 waves; stats ×(1 + wave·0.16) | On-ramp scales 30%→100% over waves 1–7. |
| Pool copies per tier (T1..T6) | 10 / 9 / 8 / 7 / 6 / 6 | Finite shared pool; selling/rerolling returns copies. |

## 3. Threats & the counter matrix (LOCKED truth)

Five threat archetypes. Each is **answered by exactly 2 tribes**; each tribe **answers exactly 2
threats** — a balanced web.

| Threat | What it is | Punishes | Answered by |
|---|---|---|---|
| **Venom Swarm** | 5–7 small bodies, several **Venomous** (one touch kills your biggest) | single big carries; low body count | **Mech, Demon** |
| **Ironwall** | 2–3 enormous **Taunt + Divine Shield** walls | wide chip; low burst | **Undead, Dragon** |
| **Horde** | 6–7 medium bodies, very wide | slow/tall boards; few attackers | **Beast, Dragon** |
| **Glass Cannon** | 1–2 giant-Attack minions, fragile | passive boards that get one-shot | **Undead, Mech** |
| **Undying** | 4–5 **Reborn** bodies that keep coming back | tempo boards that can't close | **Beast, Demon** |

Enemy templates (current dials): Venom `5–7×1–2 (V)` · Iron `2–3×6–9 (T/DS)` · Horde `6–7×2–3` ·
Glass `2×8–12` · Undying `4–5×2–3 (R)`. All scaled by the wave curve above.

---

## 4. Tribe rosters & mechanics

Counts below are **buyable** minions. **All six tribes are ~half the design target of 13–15 minions
each** — see §7 "content gaps." `*` = dual-type. Keywords: T=Taunt, DS=Divine Shield, V=Venomous,
R=Reborn, M=Magnetic, EG=Engraved (keeps combat-gained stats), CN=Consume, RL=Rally, FD=Fodder,
SC=Start-of-Combat.

### Beasts — token swarm + buff-on-summon + Cleave (answers Horde, Undying)
| Card | Tier | Stat | Role |
|---|---|---|---|
| Alleycat | 1 | 1/1 | Battlecry: summon a 1/1 Stray |
| Mama Pup | 2 | 2/2 | Deathrattle: summon two 1/1 Pups |
| Kennelmaster | 2 | 2/3 | Each Beast summoned gains +1/+1; Avenge(3): improve this |
| Wildwood Shaper | 2 | 2/3 | Choose One: Beasts +1/+1 **or** summon two Strays |
| Spirit Pup `*`beast/dragon | 5 | 4/6 | Cast 10 spells on board → transform to Spirit Worgen |
| Gnasher, the Overrun | 6 | 6/6 EG | On kill: attack again + gain +5/+5 (Engraved) |
| Grim | 6 | 7/1 | Deathrattle: Beasts +1/+1 per Deathrattle triggered this game |

**Curve gap: no Tier 3 or Tier 4.** 7 cards.

### Dragons — Battlecry stat-stacking + Start-of-Combat AoE (answers Ironwall, Horde)
| Card | Tier | Stat | Role |
|---|---|---|---|
| Ember Whelp | 1 | 2/1 SC | Start of Combat: 1 dmg to leftmost enemy |
| Hoard Cleric | 3 | 3/4 | Battlecry: **your Dragons +2/+3** |
| Arcane Weaver | 4 | 3/4 | Deathrattle: add a Spirit Fire to hand |
| Cinderwing Matron | 4 | 5/5 | Battlecry: your spells +1 Health |
| Karwind | 6 | 2/12 | Whenever a Battlecry triggers: **Dragons +1/+2** |
| Bane `*`dragon/demon | 6 | **12/12** | After a Battlecry triggers: Fodder +1/+1 run-wide |

**Curve gap: no Tier 2 or Tier 5.** 6 cards. **Highest raw power by far** (see §6).

### Undead — Venomous + Deathrattle value (answers Ironwall, Glass Cannon)
| Card | Tier | Stat | Role |
|---|---|---|---|
| Sporeling | 1 | 1/2 | Deathrattle: all friends +1 Atk **or** +1 Hp (random) |
| Grave Knit | 2 | 3/2 | When a Grave Knit dies in combat, **all** Grave Knits +3/+2 permanently |
| Skullblade | 3 | 5/1 | Deathrattle: your spells +1 Attack (rest of run) |
| Deathsayer | 4 | 3/5 RL | Rally: before it attacks, trigger your leftmost Deathrattle |
| Toxin Tender | 5 | 3/1 | Battlecry: give a friendly Undead **Venomous** |

**Smallest tribe — only 5 cards, no Tier 6.** Venomous comes from **one** card (Toxin Tender), to **one**
target, and **drops off after its first proc.** (Lantern of Souls + Skullblade are spell-side support.)

### Mechs — Divine-Shield walls + Magnetic + shield-break (answers Venom Swarm, Glass Cannon)
| Card | Tier | Stat | Role |
|---|---|---|---|
| Spare Part Drone | 1 | 2/1 DS | Vanilla shield body |
| Cling Drone | 2 | 2/2 M | Each Cling magnetized → your Cling Drones +1/+1 |
| Selfless Sentinel | 2 | 2/1 | Deathrattle: give a friend a Divine Shield |
| Money Bot | 3 | 3/3 M | While on board: **+1 max mana/turn** (economy) |
| Junkyard Titan | 4 | 4/4 | Deathrattle: add a random Magnetic to hand |
| Combinator | 5 | 6/7 | End of Turn: magnetize a Cling onto a friendly Mech |
| Beatboxer | 6 | 8/8 | Whenever a Magnetic attaches elsewhere, **copy it onto this** |

Cleanest curve (T1–T6). 7 cards. Self-reinforcing magnetize loop + economy.

### Demons — Consume Fodder to feed a carry (answers Venom Swarm, Undying)
| Card | Tier | Stat | Role |
|---|---|---|---|
| Fred (token) | 1 | 1/1 FD | The Fodder token — not rollable; enters via Soulfeeder/Maw |
| Soulfeeder | 1 | 2/2 | Battlecry: add Fodder to your next tavern |
| Voracious Imp | 2 | 2/2 CN | Eats Fodder for **2×** stats |
| Brood Matron | 3 | 3/3 | Each time a friend dies, summon a 1/1 Imp |
| Heckbinder `*`demon/mech | 4 | 3/3 M | Magnetize onto a friendly Mech **or** Demon |
| Maw of the Pit | 4 | 4/5 T | End of Turn: add a Fodder to your next tavern |
| Ritualist | 5 | 2/5 | End of Turn: **all Fodder +1/+1** wherever it is |
| Corrupted Lifebinder | 6 | 1/1 | Battlecry: bind to a friendly Demon; mirrors its stat gains |

7 buyable + Fodder token. Engine needs **setup turns** (queue Fodder → eat it).

---

## 5. Neutral glue, spells, heroes

### Neutral minions (16) — cross-tribe value & "global modifiers"
| Card | Tier | Stat | Role |
|---|---|---|---|
| Target Dummy | 1 | 0/4 T | Wall |
| Hoarder | 1 | 1/1 | Sells for +1 mana per turn held (economy) |
| Brightwing Broker | 2 | 2/3 | Every minion you buy gets +1/+1 |
| Echo Warden | 3 | 2/4 | In combat, your summon effects summon 1 more copy |
| Buddy Buddy | 3 | 3/4 | Battlecry: add a random Tier 1 to hand |
| Venom | 3 | 1/1 V | A Venomous body (the only repeatable Venomous source outside Undead) |
| Archmagus Guel | 4 | 2/3 | After a tavern spell: 2 other friends +1/+1 |
| Flowing Monk | 4 | 1/4 | Summon-overflow → a random friend +3/+3 **Engraved (permanent)** |
| Blaster | 4 | 6/3 T | Deathrattle: 3 dmg to ALL minions (yours too) |
| Drakko the Drummer | 5 | 2/4 | **Battlecries fire 1 more time** (doesn't stack) |
| Sylus the Reaper | 5 | 4/5 | **Deathrattles proc 1 more time** (stacks additively) |
| Chronos | 5 | 1/6 | **End-of-Turn effects trigger 1 more time** (doesn't stack) |
| Black Belt Brian | 5 | 3/5 | Battlecry: Discover a spell |
| Jenkins & Fi | 5 | 3/2 | Deathrattle: destroy the minion that killed this |
| Yazzus | 6 | 6/8 | **Your spells cast twice** (doesn't stack) |
| Taurus the Ancient | 6 | 6/8 | Start of Combat: Engrave the minion to its left (keeps combat gains) |

### Spells (19) — one offered per shop, bought into hand, cast (no board slot)
Spell power (from Skullblade / Cinderwing / Rohan) folds onto stat-granting spells.

| Spell | Tier | Cost | Effect |
|---|---|---|---|
| Mana Pouch | 1 | 1 | Gain 1 mana |
| Bulwark | 1 | 1 | +0/+1 and Taunt to a friend |
| Sprout | 1 | 3 | Discover a Tier 1 minion |
| Summon Stone | 1 | 2 | Get a random Tier 1 minion |
| Spirit Fire | 2 | 2 | **+4/+4** to a friend (scales w/ spell power) |
| Tribes Choice | 2 | 2 | Get a random minion of the target's tribe (≤ tavern tier) |
| Refreshing Texts | 2 | 1 | Gain 2 free rerolls |
| Mana Font | 2 | 3 | +1 max mana permanently |
| Mend | 2 | 4 | Heal hero 5 |
| Shatter | 3 | 1 | +2/+4 and toggle Taunt (any target) |
| Staff of Guel | 3 | 2 | **Every minion you buy +2/+2** rest of game (now also enchants Fodder) |
| Lasso | 3 | 2 | Steal a random minion from the tavern (free) |
| Growth | 4 | 2 | **+3/+4 to ALL your minions** (scales w/ spell power) |
| Front to Back | 4 | 1 | +2/+2, **+2/+2 more per Front to Back cast this run** |
| Help Wanted | 4 | 3 | Discover a Battlecry minion |
| Lantern of Souls | 4 | 2 | Your **Undead +3 Attack everywhere** rest of run |
| Channeling the Devourer | 5 | 3 | Devour a friend → a random other friend inherits its stats |
| Eyes of Aresmar | 6 | 5 | **Make a Tier ≤4 minion Golden** (a free triple) |
| Undead Army | 4 | 4 | Get 2 copies of a random Undead |

### Heroes (9) — all 30 Resolve today
| Hero | Power | Type | Effect |
|---|---|---|---|
| Warden | Fortify | active | Give a minion +Tier/+Tier (grows as you tavern up) |
| Indy | Gild | once/game | Make a friendly minion Golden |
| Myra | Pulse | active, unlock w3 | Re-trigger a friendly Battlecry |
| Soren | Reclaim | active | Mark a minion → destroyed at combat start (procs Deathrattle) + resummoned |
| Rohan | Attunement | **passive** | Spells gain +1/+1, rising +1 every 3 waves |
| Djinn | Cadence | active | Re-trigger a friendly End-of-Turn effect |
| Nadja | Mana Font | active, cost 3 | Spend 3 mana → +1 max mana permanently |
| Cassen | Collision | **passive** | After 5 enemy kills, get a minion of your most common tribe |
| Drakko | Drumline | **passive** quest | Buy 5 Battlecry minions → get Drakko the Drummer (battlecry doubler) |

---

## 6. Empirical results — `npm run balance` (mono-tribe, base stats)

Mono-tribe baked boards vs each threat, waves [4,7,10,13] × 40 seeds. `✓` = a counter-matrix "answers"
pairing (should read high).

```
tribe     Venom  Ironwa  Horde  Glass  Undyin
beast      36%     4%   ✓26%    3%   ✓34%
dragon     40%   ✓22%   ✓26%   21%    40%
undead     26%   ✓ 1%    25%   ✓ 3%    24%
mech     ✓ 35%    12%    25%   ✓20%    31%
demon    ✓ 29%     1%    25%    0%   ✓25%
neutral    24%     0%    20%     0%    10%
```

**Board power Σ(atk+hp) of the baked 7-board:** dragon **78** ≫ mech 53 > beast 46 > demon 38 >
undead 34 > neutral 31.

**Counter-matrix adherence — avg win% on answered threats vs the rest:**
| Tribe | Answered | Other | Verdict |
|---|---|---|---|
| beast | 30% | 14% | ✅ holds |
| mech | 28% | 23% | ✅ holds |
| demon | 27% | 9% | ✅ holds |
| dragon | 24% | 34% | ❌ **inverted** — loses *more* to its own answers; just generically strong |
| undead | 2% | 25% | ❌ **inverted** — near-zero on the exact threats it should counter |

Matrix holds for **3/5** tribes with a measurable signal. The two failures are the headline balance work.

---

## 7. Balance analysis

> Empirical where it cites the runner; **design inference** (flagged) for full-run comp strength, which
> the runner doesn't measure.

### 7a. Too strong / likely OP (design inference — these are compounding *run-long* engines)
1. **Dragon raw-stat Battlecry stacking.** *Empirical:* power 78, and dragon wins ~40% even vs threats
   it doesn't answer — its counter identity is washed out by sheer stats. *Drivers:* Hoard Cleric
   (+2/+3 to **all** Dragons), Karwind (+1/+2 to all Dragons **per Battlecry trigger**), Bane (a 12/12
   body), all multiplied by **Drakko** (Battlecries fire +1) and **Myra** (replay a Battlecry). A
   Battlecry-dense dragon board snowballs faster than anything. **Prime power-down candidate.**
2. **Mech Magnetic snowball + economy.** Cling (+1/+1 per magnetize) → Beatboxer (copies every
   magnetize) → Combinator (welds a Cling **every turn**), on Divine-Shield bodies, funded by Money Bot
   (+1 mana/turn). Self-reinforcing and economy-positive — the highest *ceiling* engine. (Long flagged
   "Mech dominant.")
3. **Demon Fodder snowball.** Under-represented by the runner (one-shot bake; the engine needs setup
   turns). Soulfeeder/Maw queue Fodder → Voracious Imp eats it 2× → Ritualist pumps **all** Fodder
   +1/+1/turn → Lifebinder mirrors the carry. With **Staff of Guel now also enchanting Fodder**, the
   carry's per-turn growth just went up — worth a fresh look.
4. **Cross-tribe value engines (tribe-agnostic).** The neutral "doublers" (Drakko/Sylus/Chronos/Yazzus/
   Echo) + Taurus (Engrave) + Flowing Monk (overflow → **permanent** +3/+3) + the **spell-power loop**
   (Skullblade/Cinderwing/Rohan amplifying Spirit Fire/Growth/Front-to-Back) let you build a top board
   with little tribe identity. E.g. Sylus + Grim = a huge board-wide Deathrattle buff; Yazzus + Guel +
   Spirit Fire = burst. Watch that these don't *out-scale* every tribe's own engine.

### 7b. Too weak
1. **Undead — the biggest problem.** *Empirical:* 1% vs Ironwall, 3% vs Glass Cannon — the **two threats
   it is the designated answer to.** Causes: (a) smallest pool (5 cards, no T6); (b) its answer mechanic
   (Venomous) is supplied by exactly **one** card (Toxin Tender), to **one** minion, and **drops after
   one proc** — useless against 2–3 Ironwall walls or 2 Glass cannons; (c) lowest-but-one board power
   (34). Lantern of Souls / Skullblade are spell-side patches, not a tribe fix. Undead currently does
   **not** fulfill its matrix role.
2. **Neutral-only boards.** 0% vs Iron/Glass. Expected (glue, not a comp) — but it shows that without a
   tribe engine, raw bodies fold to walls and cannons.
3. **Beast mid-game.** Holds the matrix, but the **T3/T4 gap** means the swarm can stall before its T5/T6
   payoffs come online.

### 7c. The single biggest matrix hole: Ironwall & Glass Cannon answers don't land
Across the whole table, **almost everyone is near-zero vs Ironwall and Glass Cannon** — only Dragon
(raw stats: 22/21) and Mech (shields: —/20) cope. Yet the matrix says **Undead + Dragon** answer Iron
and **Undead + Mech** answer Glass. Undead fails both. So the "tall wall / big burst" threats are
**over-tuned relative to the tools most tribes actually have**, and the *intended* answer (Venomous
spread, Divine Shields, big bodies) is under-supplied. Fixing this is likely the highest-leverage move:
either soften the Iron/Glass templates, or massively widen Venomous/destroy access (esp. for Undead).

### 7d. Content gaps (pool depth & curve)
Design target is **13–15 minions per tribe**; current reality:
| Tribe | Buyable count | Curve holes |
|---|---|---|
| Beast | 7 | **no T3, no T4** |
| Dragon | 6 | **no T2, no T5** |
| Undead | **5** | **no T6**; thin everywhere |
| Mech | 7 | (clean T1–T6) |
| Demon | 7 | no early non-Fodder carry besides Imp |
| Neutral | 16 + 19 spells | — |

Consequence: shop consistency is low — you rarely draw a clean tribe board, which **pushes players
toward neutral-glue / cross-tribe value builds over tribe identity** (reinforcing 7a.4). Filling curve
holes may matter *more* than re-tuning numbers right now.

### 7e. Specific tuning candidates (dials, not mandates)
- **Hoard Cleric** +2/+3-to-all-Dragons → the main dragon stat-balloon; consider +2/+2 or "+2/+3 to two
  Dragons."
- **Karwind** 2/12, +1/+2 per Battlecry trigger → compounds hardest with Drakko/Myra.
- **Bane** 12/12 → a huge vanilla body inflating dragon power; consider lower base stats.
- **Mech: Beatboxer + Combinator** → the magnetize-copy loop is the highest-ceiling engine; watch the
  per-turn Combinator welds with Beatboxer copies.
- **Undead: Toxin Tender / Venom access** → give Undead a second/repeatable Venomous source, or buff base
  stats, so the tribe can actually answer Iron/Glass. (Plus new cards to reach 13–15 and a T6.)
- **Grim (7/1) + Sylus** → Deathrattle-tally buff × Deathrattle-doubler can be enormous; sanity-check the
  ceiling.
- **Flowing Monk** overflow → **permanent** +3/+3 (Engraved) is repeatable with token swarms; strong.
- **Tier costs:** T5 (11) > T6 (10) is inverted — intended? It makes T6 oddly cheap to reach last.

### 7f. Hero & spell notes (inference)
- **Strong heroes:** Rohan (passive, scaling spell power → the spell-power engine), Drakko (free Drummer
  → Battlecry doubling, esp. dragons), Nadja (max-mana → tempo/scaling), Soren (Reclaim → Deathrattle
  value). **Situational:** Indy (one gild), Myra (w3 unlock), Djinn (needs End-of-Turn minions), Cassen
  (needs to win fights to bank kills). **All 30 Resolve** — no per-hero HP divergence yet (flagged in
  code as planned).
- **Strong spells:** Spirit Fire (+4/+4 for 2), Growth (+3/+4 all for 2), Front to Back (escalates),
  Eyes of Aresmar (a 5-cost free triple), Staff of Guel (run-long +2/+2 on every buy). The **spell-power
  loop** that amplifies the first three is the cross-tribe powerhouse to watch.

---

## 8. Open questions for the balance conversation
1. **Iron/Glass answers:** soften the two "tall/burst" templates, or widen Venomous/Divine-Shield/destroy
   access (especially for Undead) so the matrix's designated answers actually land?
2. **Dragon:** trim raw stats (Cleric/Karwind/Bane) so its identity (Iron/Horde counter) shows instead of
   generic dominance — without gutting the Battlecry fantasy?
3. **Content before numbers:** fill curve gaps (Beast T3/4, Dragon T2/5, Undead everything + a T6) toward
   13–15/tribe *first*, since thin pools distort both play and the runner?
4. **Cross-tribe modifier stacking:** are the neutral doublers + spell-power + Engrave + overflow washing
   out tribe identity? Should some be tribe-locked or toned down?
5. **Heroes:** when HP diverges from a flat 30, which powers need a Resolve handicap/bonus? Which of the
   weaker powers (Indy, Djinn, Cassen) need a buff?
6. **Runner upgrade:** the runner only measures the *matrix* on mono-tribe base boards. Should we build a
   *full-run* comp simulator (triples + heroes + spells + multi-turn snowball) to actually measure OP
   builds, instead of inferring them?

---

## 9. Owner's direction & priorities (2026-06-22)

The designer's own top-of-mind targets, mapped to the analysis above.

**Status — balance patch v1 shipped (2026-06-22):** items **1, 2, 4 are done** — Yazzus is targeted-only,
Corrupted Lifebinder is removed (with its mirror system), and the run is now a **15-round win**. Items
**3 (T1–4 relevance)** and **5 (decision diversity)** remain — the deeper design pass.

1. **Yazzus → "targeted spells cast 2 times", not ALL spells.** Today it doubles *everything* incl.
   economy/utility/discover (Mana Pouch, Refreshing Texts, Sprout…), which is degenerate. Restricting to
   *targeted* (buff) spells keeps the combat fantasy without doubling econ/value. Directly reins in the
   cross-tribe spell engine flagged in **§7a.4**.
2. **Corrupted Lifebinder → remove or massively rework.** The "mirror a linked Demon" payoff is swingy
   and narrow, and the linked-mirror system (`syncLifebinders` + combat mirror) is fragile. A removal
   candidate (also simplifies the engine).
3. **T1–4 cards need love — "basically pointless past turn 9."** Early cards should stay relevant late
   (scaling payoffs, recombination, triples), not just fall off. Ties to **§7b.3 / §7d** (curve gaps) and
   the decision-diversity problem (5) — if early cards stayed live, more openings would remain viable.
4. **Curve too aggressive; endgame drags — target ~15 rounds (tentative), down from 20.** Dials:
   `CONFIG.maxWave` (20), `curve.statScalePerWave` (0.16), the wave-1→7 on-ramp. (Also revisit the
   inverted tier-up cost: T5 = 11 > T6 = 10, **§2**.)
5. **Not enough interesting decisions.** The fun/crafty lines exist but are too **obvious and abundant**,
   so alternate lines feel pointless — the *how/why* of reaching a destination build needs more tension.
   Owner notes this is *partly* the thin minion pool (in progress). Compounds with **§7a.4** (cross-tribe
   value engines wash out tribe identity) and **§7d** (low pool → low shop variance → same builds).

*Read alongside §7 — items 1, 2, 5 are the "rein in the dominant/obvious engines" thread; items 3, 4 are
the "fix pacing so the whole roster and more openings stay relevant" thread.*

---

*Generated from the live card data (`packages/content/src/cards/*`, `packages/sim/src/{heroes,threats,
config}.ts`) + the `npm run balance` runner output on 2026-06-22; §9 added from the owner's notes.*
