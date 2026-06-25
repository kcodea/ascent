# ASCENT — SFX & animation event inventory

The complete map of every sound the game makes (and every notable event that is still **silent**), so new
audio can be sourced against a single list. Audio lives in `packages/ui/src/sfx.ts`; sourced clips are mp3
files in `packages/ui/src/audio/`.

## How audio works (read this first)

- **Two kinds of sound.** Every effect is either a tiny **synthesized** Web-Audio blip (oscillator + gain
  envelope, generated on the fly) or a **sourced** mp3 sample decoded to an AudioBuffer. A sourced sound
  always keeps its synth as a **fallback**: `playSample('<name>', vol)` returns `false` until the buffer is
  decoded (or if the file is missing), and the caller falls through to the blip. So the game is never silent
  while a clip loads.
- **To add/replace a sourced clip:** drop `name.mp3` into `packages/ui/src/audio/` (lowercase — the lookup
  and the itch Linux host are case-sensitive) and make sure the event calls `playSample('name', …)`. A new
  file needs a **dev-server restart** (the file list is an eager `import.meta.glob`, not hot-reloaded).
- **Per-clip volume.** Each sourced clip has a tunable gain in `SAMPLE_VOL_DEFAULTS` (sfx.ts), adjustable
  live with the **DEV SFX mixer** (🔊 button, bottom-left — slider + ▶ preview per clip + "Copy values" to
  paste the dialed-in numbers back as the shipped defaults). Persisted to `localStorage['ascent.sfxvol']`.
- **Master volume + mute** (Settings → Audio) scale/silence every sound; both persist (`ascent.vol`,
  `ascent.muted`). One sound per notable event per beat.
- **Warm-up.** The audio context + sample decode kick off on the **first user gesture** anywhere (pointer or
  key), so the first real action's clip is ready (no silent first-buy).
- **Combat is a beat replay** (`useCombatReplay.ts`): each beat shows for `DELAY × SPEED` (SPEED = **1.5**),
  then the next. The attack **lunge** is a separate GSAP motion overlapping the beat clock, and the impact
  `hit`/`smack` is fired **frame-accurately from the lunge timeline** (lands on contact), not off the clock.

---

## 1. Current SFX bank — every key in `sfx.ts`

**Sourced** = a real mp3 is wired (file listed). **Synth** = procedurally generated placeholder, no file yet
(these are the prime candidates for sourcing — see §3). Default vol is the sourced-clip gain in
`SAMPLE_VOL_DEFAULTS`.

| key | fires when | sourced? | file(s) | vol | synth character |
|---|---|---|---|---|---|
| `buy` | buy a minion; Discover pick resolves | **sourced** | `buy1`,`buy2` (random) | 0.50 | square blip up |
| `sell` | sell a board minion | **sourced** | `sell1`–`sell4` (random) | 0.51 | square down-blip |
| `play` (cardlanding) | a **minion** lands on the board | **sourced** | `cardlanding` | 0.156 | triangle down-slide |
| `upgrade` | Tavern Up | **sourced** ✨new | `tavernupgrade` | 0.50 | rising triad |
| `freeze` | Freeze the tavern | **sourced** | `freezetavern` | 0.50 | 3-step square sweep up |
| `unfreeze` | Unfreeze the tavern (toggle off) | **sourced** | `unfreezetavern` | 0.50 | 3-step square sweep down |
| `reorder` | reposition a warband / shop card | **sourced** | `reordercard` | 0.225 | short square tick |
| `discover` | a Discover choice opens | **sourced** | `discover` | 0.50 | triangle shimmer chord |
| `taunt` | a friendly minion is **granted** Taunt | **sourced** | `taunt` | 0.50 | square thunk |
| `deny` | rejected action (can't afford / full / timer up) | **sourced** | `deny` | 0.50 | descending dissonant buzz |
| `inspect` | right-click a minion → enlarged overlay | **sourced** | `inspect` | 0.50 | soft sine ping |
| `pulse` | choose a hero; press the Hero-Power button | **sourced** | `pulse` | 0.50 | sine up-ping |
| `hit` (smack) | damage lands in combat (impact) | **sourced** | `smack` | 0.156 | square thud |
| `castSpell` | a **spell** is cast (vs a minion landing) | synth | — | — | triangle down-slide |
| `roll` | refresh / reroll the tavern | **sourced** | `roll` | 0.50 | (synth 3-step sweep fallback) |
| `tick` | each of the last 5 turn-timer seconds | synth | — | — | short square click |
| `proc` | an End-of-Turn effect fires (per proc) | synth | — | — | triangle shimmer |
| `triple` | a golden is formed | synth | — | — | rising 4-note arpeggio |
| `maxGold` | Soulsman's Avenge raises max Gold (combat) | synth | — | — | rising coin shimmer |
| `combatStart` | End Turn → Face the Omen | synth | — | — | low sawtooth down-slide |
| `attack` | each attack swing (per hit; Windfury = 2) | synth | — | — | sawtooth down-slide |
| `death` | a minion dies | synth | — | — | low sine drop |
| `shield` | a Divine Shield is **gained** (shieldUp) | synth | — | — | sine up-slide shimmer |
| `buff` | a combat buff lands | synth | — | — | two-note triangle |
| `win` | combat won (verdict) | synth | — | — | major 4-note arpeggio |
| `lose` | combat lost (verdict) | synth | — | — | minor descending arpeggio |
| `temper` | *(legacy — unused; `pulse` replaced it as the Hero-Power cue)* | synth | — | — | bright two-note ping |

**Sourced files on disk (17):** `buy1` `buy2` · `sell1` `sell2` `sell3` `sell4` · `cardlanding` ·
`tavernupgrade` · `freezetavern` · `unfreezetavern` · `reordercard` · `discover` · `taunt` · `deny` ·
`inspect` · `pulse` · `smack`.

---

## 2. Where each sound fires (trigger sites)

- **Recruit / shop actions** (`store.ts` → `actionSfx`, fired on dispatch): `buy`, `sell`, `play`/`castSpell`
  (minion vs spell), `roll`, `freeze`/`unfreeze` (toggle), `reorder` (reposition / reorderShop), `upgrade`,
  `discover` (on the action that opens a Discover), `taunt` (board minion gains Taunt), `triple` (golden
  formed), `deny` (any rejected buy/play/roll/upgrade), `combatStart` (faceOmen). Discover **pick** plays
  `buy`. Inspect (`inspectCard`) plays `inspect`.
- **Hero Power button** (`StatusBar.tsx`) and **hero choose** (`HeroSelect.tsx`): `pulse`.
- **Timer** (`Recruit.tsx`): `tick` (last 5 s). **End-of-Turn procs** (`Recruit.tsx`): `proc` per proc.
- **Combat beat replay** (`useCombatReplay.ts`): `attack` (on `attack`), `hit` (on `dmg`, and frame-accurate
  from the lunge), `death` (on `death`), `shield` (on `shieldUp`), `buff` (on `buff`), `win`/`lose` (verdict).

---

## 3. Potential sourced clips — **synth keys that want a real sample**

These already have a trigger + a synth placeholder; sourcing them is just dropping an mp3 and swapping the
call to `playSample(...)` (with the synth as fallback). Rough priority:

1. **`castSpell`** — spells currently share the minion-landing feel; a distinct "whoosh/cast" reads great
   (and is very frequent).
2. **`death`** — every combat has deaths; a real "thud/crumble" lands hard.
3. **`attack`** — the swing itself (paired with the existing `smack` impact).
4. **`triple`** — the golden combine is a celebration moment; a real sparkle/chime sells it.
5. **`win` / `lose`** — the verdict stingers; a short fanfare / sad-trombone beats the synth arpeggios.
6. **`shield`** — Divine Shield gained (a metallic "ting").
7. **`buff`** — a combat stat buff lands.
8. **`proc`** — the End-of-Turn shimmer (heard a lot during the EOT sequence).
9. **`combatStart`** — the "Face the Omen" transition (a war-horn/drum hit).
10. **`tick`** — the final-5-seconds countdown click.

---

## 4. Silent events — **no `sfx.*` key at all** (new sounds, new wiring)

### Combat beats with no audio (`useCombatReplay.ts`)

| event | length | animation | note |
|---|---|---|---|
| **Start-of-Combat cast (sc)** | **1080 ms** | caster `sccast` pulse + projectile bolts | Ember Whelp / Blaster opening zaps — a cast/zap would help |
| **summon** | 660 ms | `summoned` pop-in | tokens, Deathrattle summons |
| **Divine Shield BREAK (shield)** | 690 ms | `shatter` flash | distinct from *gaining* a shield — a glass-break would read great |
| **poison kill** | 750 ms | `poisoned` + big `☠` bloom | Venomous — a hiss/dissolve |
| **Venomous spent (venomLost)** | 750 ms | `venomspent` flash | venom drops off after its hit |
| **reborn** | 960 ms | `reborn` ring | a "phoenix" return cue |
| **improve** | 780 ms | `buffed` flash + `✦` | Kennelmaster aura climbing mid-fight |
| **rally** | 1080 ms | source pulse + target `flare` + `☠` | Deathsayer triggering a Deathrattle |
| **toHand** | 1230 ms | card flies to your hand | Arcane Weaver → Spirit Fire |
| **reveal (Stealth lost)** | 450 ms | minion becomes targetable | minor |

### Recruit-phase animations with no audio

| animation | length | trigger |
|---|---|---|
| **stat buff flash** (green) | 700 ms | any recruit buff lands on a card |
| **+X/+X buff float** | ~1450 ms | any recruit buff (spell, hero power, Guel, …) |
| **Fodder consume swirl** | ~2300 ms | a Demon eats tavern Fodder — **an "eat/chomp" is a notable gap** |
| **Magnetic weld** (slide + crackle) | ~280 ms + ~120 ms settle | a Magnetic minion merges into a Mech — **a "clamp/magnet" is a notable gap** |
| **Battlecry flourish** | 760 ms | a played minion's Battlecry fires |
| **Karwind flame flash** | 520 ms | Karwind flame-buffs Dragons |
| **Devour bolt** (stat projectile) | ~560 ms arc + 600 ms spark | Channeling the Devourer |
| **Ritualist shop wash** (purple) | one-shot | Ritualist's End-of-Turn Fodder buff |
| **End-of-Turn banner** | 850 ms | the turn ends (entering combat) |
| **dust puff** | 620 ms | clicking the empty board (purely tactile) |

---

## 5. Top "missing sound" gaps (silent events worth a clip)

1. **Divine Shield break** — only *gaining* a shield has audio; the shatter is silent.
2. **Start-of-Combat cast (`sc`)** — the opening zaps (Ember Whelp / Blaster).
3. **Fodder consume** (recruit) — an eat/chomp; very visible, very silent.
4. **Magnetic weld** (recruit) — a metallic clamp.
5. **Poison kill** — the big `☠` bloom wants a hiss/dissolve.
6. **Reborn** — a "phoenix" return cue.
7. **summon / toHand / rally / improve** — minor, but each is a distinct beat with no audio.

> To wire a sourced clip: add `name.mp3` to `packages/ui/src/audio/` and either swap a §1 synth key to
> `playSample('name', sampleVol.name)` (keep the synth as fallback) or, for a §4 silent event, add a new
> `sfx.<key>` and call it at the listed site. Combat beats are dispatched in `useCombatReplay.ts`; recruit
> actions in `store.ts`; the EOT proc + timer tick in `Recruit.tsx`; the Hero-Power cue in `StatusBar.tsx`.
> Register a new sourced key in `SAMPLE_VOL_DEFAULTS` + `SFX_PREVIEW` so it appears in the dev mixer.
