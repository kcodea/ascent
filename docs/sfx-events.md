# ASCENT — SFX & animation event inventory

A reference for sourcing new sound effects. Lists every event/animation, its **on-screen length**, and whether
it **currently has SFX**. Most SFX are still tiny synthesized Web-Audio blips (`packages/ui/src/sfx.ts`),
placeholders to be replaced — **except sourced clips now wired**: `sell` (one of `sell1–4` at random) and the
combat `hit`/impact (`smack`), loaded from `packages/ui/src/audio/*.mp3` (decoded to AudioBuffers; the synth is
the fallback until decode completes). To add more: drop an mp3 in `audio/` and call `playSample('<name>')` at
the event site (synth fallback optional). Muting + a **master volume** (Settings → Audio slider, persisted to
`ascent.vol`, scales every sound) both persist; one sound per notable event per beat. The combat `hit`/smack is
fired frame-accurately from the attack lunge's GSAP timeline (so it lands on contact), not from the beat clock.

Combat plays as a **beat replay** (`packages/ui/src/useCombatReplay.ts`): each beat is an action (or a run of
result events) shown for a fixed length, then the next beat. Durations below are the beat length = base `DELAY` ×
`SPEED` (SPEED = **1.5**). The attack LUNGE is a separate GSAP motion that overlaps the beat clock.

---

## 1. Current SFX bank (`sfx.ts`) — 18 sounds, all synthesized placeholders

| key | where it fires | character (current) |
|---|---|---|
| `buy` | buy a minion; Discover pick | square blip up |
| `deny` | rejected action (can't afford / full / timer up) | descending dissonant buzz |
| `play` | play a card to the board; cast a spell | triangle down-slide |
| `sell` | sell a board minion | **sourced** — random of `sell1–4`.mp3 |
| `roll` | refresh / freeze the tavern | 3-step square sweep |
| `upgrade` | Tavern Up | rising triad |
| `temper` | use the Hero Power | bright two-note ping |
| `tick` | each of the last 5 turn-timer seconds | short square click |
| `combatStart` | End Turn → Face the Omen | low sawtooth down-slide |
| `attack` | each attack swing (per hit) | sawtooth down-slide |
| `hit` | damage lands (combat impact) | **sourced** — `smack`.mp3 |
| `death` | a minion dies | low sine drop |
| `shield` | a Divine Shield is **gained** (shieldUp) | sine up-slide shimmer |
| `buff` | a combat buff lands | two-note triangle |
| `proc` | an End-of-Turn effect fires (per proc) | triangle shimmer |
| `triple` | a golden is formed | rising 4-note arpeggio |
| `win` | combat won (verdict) | major 4-note arpeggio |
| `lose` | combat lost (verdict) | minor descending arpeggio |

---

## 2. Combat events (the beat replay)

### Has SFX

| event | length | animation | SFX |
|---|---|---|---|
| **attack (windup + strike)** | beat **510 ms**; lunge: **windup 200 ms → strike 130 ms → defender knockback ~200 ms → settle 550 ms** | attacker leans back, snaps forward, defender recoils, elastic settle | `attack` (once per swing — Windfury = 2) |
| **damage lands (dmg)** | 690 ms | target `struck` recoil + floating `−N` | `hit` |
| **gain Divine Shield (shieldUp)** | 690 ms | `shieldgain` flash + floating `◇` | `shield` |
| **buff** | 630 ms | `buffed` flash + floating `+A/+H` | `buff` |
| **death** | 600 ms | `dying` death-pop + board shake (hit-stop) | `death` |
| **verdict** | on replay end | board win/lose state | `win` / `lose` |
| **combat intro** | 480 ms (shop closes → enemies arrive) | shop slides away, enemy team arrives | `combatStart` (fired at End Turn) |

### NO SFX (silent today)

| event | length | animation | note |
|---|---|---|---|
| **Start-of-Combat cast (sc)** | **1080 ms** | caster `sccast` pulse + projectile bolts to targets | e.g. Ember Whelp, Blaster — a cast/zap sound would help |
| **summon** | 660 ms | `summoned` pop-in | tokens, Deathrattle summons, Reborn-adjacent |
| **Divine Shield BREAK (shield)** | 690 ms | `shatter` flash | distinct from gaining a shield; a glass-break would read great |
| **poison kill** | 750 ms | `poisoned` + big `☠` bloom | Venomous |
| **Venomous spent (venomLost)** | 750 ms | `venomspent` flash | the venom drops off after its hit |
| **reborn** | 960 ms | `reborn` ring | a minion returns to life |
| **improve** | 780 ms | `buffed` flash + `✦` | Kennelmaster aura climbing mid-fight |
| **rally** | 1080 ms | source pulse + target `flare` + `☠` | Deathsayer triggering a Deathrattle |
| **toHand** | 1230 ms | card flies to your hand | Arcane Weaver → Spirit Fire |
| **reveal (Stealth lost)** | 450 ms (default) | minion becomes targetable | |

---

## 3. Recruit / shop actions — all have SFX (fired on dispatch, `store.ts`)

| action | SFX | visible animation + length |
|---|---|---|
| buy a minion | `buy` | card pops into hand (cardpop) |
| play a minion | `play` | card lands on board |
| cast a spell | `play` | spell spark at target (~600 ms); Yazzus replays the spark per cast |
| sell a minion | `sell` | card leaves + gold glow |
| refresh / freeze | `roll` | shop cards swap |
| Tavern Up | `upgrade` | tier number bumps |
| Hero Power | `temper` | targeted buff flash, etc. |
| Discover pick | `buy` | pick resolves into hand |
| End Turn → Omen | `combatStart` | shop closes (480 ms) |
| rejected action | `deny` | (no animation) |
| golden formed (triple) | `triple` | golden combine |
| timer last 5 s | `tick` (×1/sec) | countdown ring pulses |
| End-of-Turn proc | `proc` (per proc) | proc flourish + stat climb, **930 ms/proc** (760 beat + 170 gap), ×Chronos repeats |

---

## 4. Recruit-phase animations with **NO SFX** (silent — candidates for new sounds)

| animation | length | trigger |
|---|---|---|
| **stat buff flash** (green) | 700 ms | any recruit buff lands on a card |
| **+X/+X buff float** | ~1450 ms | any recruit buff (spell, hero power, Guel, etc.) |
| **Fodder consume swirl** | ~2300 ms (hold, then swirl into the Demon; +X/+X float at ~1450 ms) | a Demon eats tavern Fodder — **an "eat/chomp" sound is a notable gap** |
| **Magnetic weld** (slide + crackle) | ~280 ms slide + ~120 ms settle | a Magnetic minion merges into a Mech — **a "clamp/magnet" sound is a notable gap** |
| **Battlecry flourish** | 760 ms | a played minion's Battlecry fires |
| **Karwind flame flash** | 520 ms | Karwind flame-buffs Dragons |
| **Devour bolt** (stat projectile) | ~560 ms arc + 600 ms spark | Channeling the Devourer |
| **Ritualist shop wash** (purple) | one-shot | Ritualist's End-of-Turn Fodder buff |
| **End-of-Turn banner** | 850 ms | the turn ends (entering combat) |
| **dust puff** | 620 ms | clicking the empty board (purely tactile) |

---

## 5. Suggested priority gaps (events that read as "missing a sound")

1. **Divine Shield break** (`shield`) — currently silent; only *gaining* a shield has audio.
2. **Start-of-Combat cast** (`sc`) — the opening zaps (Ember Whelp / Blaster) are silent.
3. **Poison kill** — the big `☠` bloom deserves a hiss/dissolve.
4. **Reborn** — a "phoenix" return cue.
5. **Fodder consume** (recruit) — an eat/chomp; very visible, very silent.
6. **Magnetic weld** (recruit) — a metallic clamp.
7. **summon / toHand / rally / improve** — minor, but each is a distinct beat with no audio.

> Mapping: each row in §2/§3 names the `sfx.*` key (or "NO SFX"). To wire a sourced clip, replace the
> synthesized function in `packages/ui/src/sfx.ts` (or add a new key + call it at the listed site). The
> combat-beat SFX are dispatched in `useCombatReplay.ts` (the "sfx per beat" effect); recruit actions in
> `store.ts`; the EOT proc + timer tick in `Recruit.tsx`.
