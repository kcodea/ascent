# Consume FX (shop phase) — shake + taffy-stretch + pull + energy bands — design

**Date:** 2026-08-16
**Owner:** Mike (presentation)
**Branch:** `feat/consume-fx`

## Goal

Replace the shop-phase consume visual (today: a "ghost Fred" swirls into the eater Demon) with a richer effect:
the eaten minion **shakes**, **stretches like taffy** toward the unit consuming it, and is **pulled in and
vanishes**, while a **Pixi workshop effect** plays **energy bands pulling toward the eater** — the two halves
synced.

**Coverage (owner ruling 2026-08-16, from a full eat-mechanic audit): EVERY shop eat, via the two shared
signals, and nothing else.** Hooking `fodderEatenSeq` + `shopEatenSeq` covers all shop eat mechanics with zero
per-card work, because they all funnel through `consumeShopMinion` (offer eats) or the Fodder-eat pushers
(`consumeTavernFodder` / `adjacentConsumeFodder` / `feastConsume`):
- **Shop-offer eaters** (`shopEatenSeq`): Cinder Clerk, Appetite Agent, Chipper, Bob Blart (+ Rune of Blart),
  Malphas (Feast), Baal, Gemgorge Fiend, Cupcakes.
- **Fodder eaters** (`fodderEatenSeq`): the tavern auto-eat (any Demon eats Fodder entering the tavern), The
  Godfodder, Herald of the Apocalypse, Abyssal Feeder, Feasting Bogrot, the Consume spell.

## The trigger (reuse what exists)

The shop consume already fires through `fodderEatenSeq` / `shopEatenSeq` watchers in `Recruit.tsx`, and the
current `fodderAnim` state carries, per eaten minion: its rect (`x0,y0,w,h`), effective stats
(`attack,health`), and the **`eaterUid`**. This effect **replaces** the `fodderAnim` swirl rendering, keyed off
the same signal — no new sim signal, no new trigger site. A consume can eat several minions in one action; each
gets its own ghost (lightly staggered).

**Two channels, both covered.** `fodderEatenSeq` is a board **Fodder** eat; `shopEatenSeq` is a Set-2 **shop-
offer** eat — every shop-minion consume routes through the shared `consumeShopMinion` helper
(`recruit.ts` ~6561), which pushes a `shopEaten` entry (`{ uid, eaterUid, cardId, attack, health, gainA, gainH }`)
and bumps `shopEatenSeq`. So cards like **Bob Blart** (`consumeShopRightmost`, End of Turn), Hellrider,
Feastmaster Vhal, etc. are all handled by the same trigger — no per-card wiring. Two consequences the effect
must handle:
- **Cross-zone pull.** A shop-offer eat starts in the **tavern row** and is pulled to the eater on the **board**
  — a longer, diagonal vector than a board Fodder eat. The geometry is identical (offer center → eater center);
  the taffy/pull just has to read well over the greater distance.
- **End-of-Turn timing.** Bob Blart (and other EoT eaters) fire during the **EoT beat sequence**, not a mid-turn
  action. The existing watcher already routes EoT-beat eats (its `eotEatKey` path); the effect plays there too,
  on the beat.

## Architecture — one geometry, one clock

For each eaten minion the watcher measures two screen points — the eaten card's **center** and the eater's
**center** (from `eaterUid`'s DOM node) — and hands that vector to both halves. All new code is presentation-
layer (`packages/ui/**`); no engine/content/core changes.

### 1. Pixi energy bands (workshop-authored)
`playDef('consume-bands', { source: eatenCenter, target: eaterCenter, camera })` — a **source→target** def (same
shape as the ale ribbons), so the bands pull toward the eater. The wiring fires a **fixed def id**
(`consume-bands`); no new binding-kind machinery. Mike authors + tunes the def in the FX workshop. Its
`duration` is the shared master length `D` (below).

### 2. The minion ghost (GSAP)
The eaten card is removed from state the instant it is consumed, so its card unmounts — the effect animates a
**detached clone** at the card's last rect (the existing ghost pattern; a clone can distort freely without
fighting React/layout). A single GSAP timeline tweens the clone:
- **shake** — rapid low-amplitude x/y jitter (unsettled),
- **taffy-stretch** — anisotropic scale rotated to aim at the eater: elongate along the eaten→eater vector, thin
  across it,
- **pull** — translate along the vector into the eater,
- **vanish** — fade + collapse as it arrives.
The clone shows the eaten minion's **effective stats** (attack/health), gated by a tuner toggle (see below).

### 3. The sync — a GSAP timeline as conductor
One GSAP timeline of duration `D` owns the moment. At **t=0** it (a) fires the `playDef` for the bands via a
timeline callback, and (b) starts the clone's shake→stretch→pull→vanish tween. Both use `D` as their length —
`D` is a shared constant that **matches the authored def's `duration`**. Same start tick + same end + same vector
→ the two read as one effect. (Pixi canvas and CSS/DOM run on separate rAF layers, so they are not frame-locked;
for a ~600–900ms one-shot, matched start + duration + vector is visually synced. GSAP coordinates the *starts*;
the def then runs its own authored clock to length `D`.) Optional timeline labels (shake-in / stretch-peak /
snap) let the def's band arrival be authored onto the clone's snap.

## Where the code lives

A dedicated module **`packages/ui/src/fx/consumeGhost.ts`** (mirrors `plateDissolve.ts`): exports
`playConsumeGhost(eatenRect, stats, eaterCenter, cfg)` which builds the detached clone on `<body>`, runs the
GSAP timeline, fires the `playDef`, and cleans up. `Recruit.tsx`'s consume watcher shrinks to: measure the two
points, then call it (replacing the `fodderAnim` render). Keeping the DOM/clone/GSAP/Pixi glue in one focused
module keeps `Recruit.tsx` from growing another bespoke block.

## Dev tuner (feel + the stat toggle)

A small dev-tuner panel (like the existing FX tuner panels registered in `DevMenu`) drives the ghost's feel,
serialized to a config object the module reads:
- **shake** intensity + frequency,
- **stretch** factor (how far it taffies) + how much it thins across,
- **pull** curve/easing + how far into the eater it travels,
- **duration** `D` (kept in step with the authored def),
- **show eaten stats** — a boolean toggle (default **on**) so Mike can see the ghost with/without its stats and
  decide.
Starting values ship as the config defaults; the tuner writes live over HMR, same as the other FX tuners.

## Testing

- **Pure geometry helper** — factor the taffy transform math (vector → rotation + anisotropic scale + translate
  at a given progress `t`) into a pure function and unit-test it: a known eaten-center/eater-center pair at
  `t=0` (rest), mid (peak stretch aimed along the vector), and `t=1` (collapsed at the eater). This is the
  load-bearing math; the GSAP/DOM wiring around it is verified live.
- **Config defaults / toggle** — a small test that the config object exposes the documented dials + the
  stat-visibility default.
- **Live (owner):** the actual shake/stretch/pull feel + the Pixi band sync are a workshop/in-shop live check
  (canvas + DOM, not unit-testable). Consume a fodder minion with a Demon; confirm the ghost shakes, stretches
  toward and snaps into the eater as the bands arrive, and the stat toggle shows/hides the numbers.
- **Full gates:** `typecheck` + `lint` + full `npm test` + `build:web` green (run the FULL `npm test` — the
  `fx/directCalls.test.ts` guard lives outside `choreo/`; firing `playDef('consume-bands', …)` from a new call
  site means updating `DIRECT_CALL_SITES` if it is a literal id).

## Scope / out of scope (YAGNI)

- **In:** shop-phase consume (`fodderEaten`/`shopEaten`), replacing `fodderAnim`; the `consume-bands` authored
  def (placeholder wired first, Mike authors the real look); the ghost module; the dev tuner. This covers all
  Group A + B eaters listed under Goal.
- **Out (owner ruling 2026-08-16, from the eat-mechanic audit):**
  - **Combat consumes** — there is **no `CN` combat event** (`CN` is the Consume keyword badge, not a
    `CombatEvent`); in-combat eats emit plain `death`/`buff`, and there is no active board-eat-a-minion combat
    card today (only stat-gains like Abhorrent Horror). Covering combat would need a NEW `CombatEvent` variant +
    combat-clock sync — deferred until a real combat eat ships.
  - **The two "devour" orphans** — `spellDevour` (Channeling the Devourer, its own `devourFx` projectile) and
    `orbitDevourArriver` (Constellation Broker / Orrery, which emits no consume signal at all). Real eats, but
    each on a separate path; left on their current look for now, revisit as a follow-up.
  - **Not eats** (confirmed excluded — a stat-copy / sell / destroy / reaction, not a minion eaten into a unit):
    Hellrider (`endOfTurnGainRightmostShopStats`, the offer stays), Fodder Treatment / Feed the Alpha (sells),
    Closed Casket / Graverobber (destroy-for-value), Avarice Incarnate / Ashen Broodlord (reactions to someone
    else's eat), and the Endless Appetite / Transfusion rune fan-outs (stat-only, no body to animate).
  - Per-eater-card customization of the def (one shared consume look); no new bindable moment kind.
