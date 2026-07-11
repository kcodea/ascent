# Combat timing audit

Lines up **three clocks** that run during a combat replay and finds where they fight:

1. **Beat hold** — how long the moment on screen lingers before the next moment shows.
   Source: [`choreo/choreoConfig.ts`](../packages/ui/src/choreo/choreoConfig.ts) +
   [`choreo/clock.ts`](../packages/ui/src/choreo/clock.ts) (`holdMs`).
2. **Animation length** — how long the FX that plays *inside* that moment actually takes
   (CSS in [`styles.css`](../packages/ui/src/styles.css), Pixi in
   [`pixiFx.ts`](../packages/ui/src/pixiFx.ts), GSAP lunge in
   [`lungeConfig.ts`](../packages/ui/src/lungeConfig.ts) + [`choreo/engine.ts`](../packages/ui/src/choreo/engine.ts)).
3. **Ordering** — which moment follows which, from
   [`combat-ordering.md`](./combat-ordering.md).

**The clash rule:** when an animation is longer than the *hold that follows it*, the next beat
starts mid-animation — the effect looks cut off / rushed, and if the next beat is a lunge, GSAP
can jump it (the "vanishing lunge", separately band-aided by `lagSmoothing`).

All figures at the shipped defaults **`speed = 1.5`, `combatSpeed = 1×`** unless noted.
`hold = beatDelay(type) × 1.5` except the three **overlap** kinds (`summon`/`reborn`/`improve`),
which ride the preceding FX at a flat `overlapMs = 240`, and `attack`, whose advance is driven by
the GSAP lunge's contact anchor (not a hold).

---

## Master table

| Moment (kind) | Enter-hold @1.5 | Longest blocking anim | Margin | Verdict |
|---|--:|--:|--:|---|
| **attackExchange** | 530 (870 after a hit) | windup 470 + strike 130–440 → contact; settle 340 | n/a — self-advances at contact | ✅ welded to contact |
| **damage** | contact-anchored (690 standalone) | struck 340 + spark 300 + hpflash 450; float 1500* | ✅ | ✅ float lingers by design |
| **shieldPop** | 690 | bubble grow 260 / shard burst ~400 | +290 | ✅ |
| **poisonTick** | 750 | poisonpop 700 + **mist 800** | **−50** | ⚠️ mist tail clipped |
| **death** (plain) | 600 | dyingcollapse/pop 420 | +180 | ✅ |
| **death → summon** (Deathrattle) | 240 **+ lead 380/720** | skull 320+130+dissolve 150 → ~600, embers ~800 | +0…+320 | ✅ fixed by `DR_SUMMON_LEAD` |
| **death → buff / improve** (Deathrattle/Avenge) | **210 / 240** | skull pop-in **320–450**; buffpulse 600 | **−110 … −390** | 🔴 consequence lands before the skull reads |
| **scCast** | 1080 | sccast 700 | +380 | ✅ |
| **summon** (standalone) | 240 (overlap) | summonexpand 340 + summonpop 420 | −180 | ⚠️ pop bleeds into next beat (rides FX, mostly ok) |
| **buffWave** (standalone) | **210** | buffpulse 600; **tendril travel 350–780 + flash 430–700 + motes →1180** | **−390 … −970** | 🔴 beat gone long before the buff visibly lands |
| **reborn** | 240 (overlap) | summonexpand 400 + **risepop 700**; re-form glow **@+460** | **−460** | 🟠 risen body + glow outlive the beat |
| **improve** | 240 (overlap) | buffpulse 600 | −360 | 🟠 aura pulse bleeds into next beat |
| **rally** | 1080 | sccast 700 + flare 500 | +380 | ✅ |
| **toHand** | 1230 | tohandfly 1150 | +80 | ✅ (tight) |
| **maxGold** | 840 | goldpulse 620 | +220 | ✅ |
| **hpGrant** | 0 | (silent) | — | ✅ silent by design |

\* floats (`floatMs 1500`, `deathFloatMs 1000`) are additive overlays on their own expiry timer —
they *intentionally* outlive the beat and don't block, so they're not counted as clashes.

---

## The clashes, ranked

### 🔴 1. Standalone buff waves — the beat is gone before the buff lands
`buffWave` holds **210 ms**, but its own presentation runs far longer:
- `buffpulse` CSS = **600 ms**,
- the buff **tendril travels 350–780 ms** (demon/undead = 780) *before* the strike, and the
  **stat-reveal `statFlash` fires at `travelMs`** — i.e. up to **780 ms after** the beat already
  advanced.

So a start-of-combat or Deathrattle buff wave advances to the next moment while its tendril is
still in flight; the +N stat change then flips on screen on top of an unrelated later beat (often
mid-lunge). This is the strongest "rushed / disconnected" offender. The 1/3 cadence cut
(420→140) was deliberate for the *pulse*, but the **tendril travel + stat-reveal were never
folded into the hold**, so the reveal detached from its beat.

### 🔴 2. Deathrattle/Avenge consequences that aren't summons get **no read-lead**
`DR_SUMMON_LEAD` holds a Deathrattle **summon** back until the skull pops + poofs (380 ms
defender / 720 ms attacker). But a Deathrattle that **buffs** (`death → buff`, 210 ms) or an
Avenge that **improves an aura** (`death → improve`, 240 ms) has **no lead** — the consequence
pulses at 210–240 ms while the skull is still popping in (`DR_POP_MS 320`, poof at ~450). The
skull reads as an afterthought. The fix is the same shape as the summon lead, generalized to any
death-triggered consequence.

### 🟠 3. Overlap-kind visuals outlive their 240 ms ride (`reborn`, `improve`, standalone `summon`)
The three overlap kinds start 240 ms after the preceding FX so the chain plays "in tandem" — but
their *own* animations are 400–700 ms (`risepop 700`, re-form glow **@+460**, `buffpulse 600`,
`summonpop 420`). Because they're fire-and-forget on their own layers this rarely tears, but the
tail visibly bleeds into the next beat — contributes to the general "too fast" feel, especially
`reborn` (700 ms body pop + a glow that starts *after* the next beat has already begun).

### ⚠️ 4. `poisonTick` mist tail clipped by 50 ms
`mist` = 800 ms vs a 750 ms hold. Marginal; one dial nudge (hold → 540 base, or mist → 0.75 s).

---

## Systemic amplifier — CSS ignores the speed slider

Three of the clocks scale differently with the player's in-combat **speed slider** (`combatSpeed`):

| Clock | Scales with `combatSpeed`? |
|---|---|
| Beat holds (`clock.ts`) | **÷ combatSpeed** (shrink as you speed up) |
| GSAP lunge + Pixi FX | **× combatSpeed** (shrink too — passed through) |
| **CSS animations** (`styles.css`) | **No** — fixed seconds |

So every margin in the table is computed at 1×. At **combatSpeed 2×** the holds halve but the CSS
`buffpulse`/`risepop`/`poisonpop`/`struck` stay put — so **every clash roughly doubles** and new
ones appear (`struck 340` vs a `damage` hold that's now ~345). This is the amplifier behind
"skips are worse when I speed combat up." A general fix is to drive the combat CSS animation
durations off a `--combat-speed` CSS variable (or GSAP-drive them) so all three clocks move
together.

---

## Suggested fix order

1. **Fold tendril travel + stat-reveal into the buff beat** (clash 1) — either hold `buffWave`
   until the tendril strikes, or shorten the tendril, so the +N lands *inside* its beat.
2. **Generalize `DR_SUMMON_LEAD` → `deathConsequenceLead`** (clash 2) — lead buffs/improves/maxGold
   the same way summons are led, so the skull always reads first.
3. **Let CSS combat animations scale with `combatSpeed`** (systemic) — removes the "worse at speed"
   amplifier in one shot; makes the 1× dials hold at every speed.
4. **Trim the overlap-kind tails** (clash 3) — e.g. shorten `risepop`/`buffpulse`, or give
   `reborn` a small dedicated lead like summons.
5. **Nudge the poison mist** (clash 4) — trivial.

Numbers here are **source-derived** (authoritative for the dials as shipped). The
"feels rushed" → offender mapping (which clash the player actually notices) should be confirmed
live in a focused tab per [`ascent-chrome-verify-fx`], but clashes 1 and 2 are structural and
worth fixing regardless of perception.
