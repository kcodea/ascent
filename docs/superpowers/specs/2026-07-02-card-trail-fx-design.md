# Card Trail FX + Dev Tuning Menu — Design

**Date:** 2026-07-02 · **Owner:** Mike (UI) · **Status:** approved pending user review

## Goal

1. A subtle **wind-whoosh trail** behind a card while it is dragged, and behind the attacker
   during a combat lunge.
2. A **gold divine-shield variant** of the trail that *replaces* the base trail whenever the
   moving card currently has Divine Shield — both while dragging and while attacking in combat.
3. A **Trail tuner** panel (same pattern as the Lunge tuner), and consolidation of ALL dev
   tuners under a single **Dev Tuning Menu** button.

## Non-goals

- No trail on other movements (reposition slides, hand fan, shop refresh, summons).
- No changes to game rules, sim, or content packages — this is presentation only.
- No new render technology: everything rides the existing PixiJS FX overlay.

## 1. Trail emitter (`packages/ui/src/pixiFx.ts`)

New public method on `FxController`:

```ts
trail(x, y, dx, dy, gold: boolean): void
```

- `(x, y)` = current card center (viewport px); `(dx, dy)` = movement since the last emit
  (used only for direction/orientation).
- Spawns 1–2 pooled wisp particles per call at the card's trailing edge, oriented along the
  motion vector, with:
  - velocity slightly *opposite* the motion (they get left behind) + small perpendicular
    jitter/drift — the "displaced air" read;
  - shrink + fade over a short life (~300 ms, tunable);
  - **base (wind):** new `makeWispTexture` — a horizontally elongated, heavily feathered soft
    streak; pale cream-white tint (~`0xf5efe0`), `normal` blend, low peak alpha (~0.3) so it
    stays subtle on the Sunward cream board.
  - **gold (divine shield):** same wisps tinted shield-rim gold (`0xffe9a8` family), `add`
    blend, slightly higher alpha, plus an occasional tiny `sparkTex` mote — mimics the
    bubble's glassy gold glint. Replaces (never layers on) the base trail.
- Reads `getTrailConfig()` at call time (live-tunable). Uses the existing pooled-sprite
  `spawn()` machinery — zero DOM paint cost, compositor-only.

## 2. Trail config (`packages/ui/src/trailConfig.ts`)

Clone of the `lungeConfig.ts` pattern: typed config + `DEFAULTS`, localStorage persistence
(`ascent.trail`), `getTrailConfig` / `setTrailValue` / `resetTrailConfig`, `TRAIL_RANGES`
slider bounds, `TRAIL_KEYS`. Dials:

| key | meaning | default (starting dial) |
|---|---|---|
| `emitSpacing` | px of travel between emits | 14 |
| `lifeMs` | wisp lifetime (ms) | 300 |
| `size` | wisp fromScale | 1.0 |
| `alpha` | base peak alpha | 0.3 |
| `stretch` | streak elongation multiplier | 1.0 |
| `drift` | lateral jitter speed (px/s) | 30 |
| `goldAlpha` | gold-variant peak alpha | 0.45 |
| `sparkChance` | gold: chance of a bonus spark mote per emit | 0.25 |

## 3. Drag hookup (`packages/ui/src/Recruit.tsx`)

In the existing rAF-throttled `onMove` drag handler (~line 1143): keep a "last emit point"
ref; when accumulated travel ≥ `emitSpacing`, call `pixiFx.trail(cx, cy, dx, dy, gold)` with
the card's center and movement delta. `gold` = the dragged card has Divine Shield — the same
knowledge that already flips the shield bubble to mini mode. No new layout reads (the handler
already has the pointer position and the card's size).

## 4. Combat hookup (`packages/ui/src/useCombatReplay.ts`)

`playAttackLunge` gains a `gold: boolean` param (caller at ~line 667 knows the attacker's
current Divine Shield state from the replay frame). The GSAP timeline gets an `onUpdate` that:

- measures the attacker's **resting rect once** at lunge start (one `getBoundingClientRect`,
  same as today's defender measure — NOT per frame);
- derives the current center as rest-center + `gsap.getProperty(attacker, 'x'/'y')`;
- distance-gates emission exactly like the drag (same `emitSpacing`);
- emits only during **windup + strike** (skip the slow elastic settle — gate on
  `tl.time() <= windupDur + strikeDur`).

## 5. Trail tuner (`packages/ui/src/TrailTuner.tsx`)

Same shape as `LungeTuner.tsx`: slider per `TRAIL_KEYS` entry with label, live value, Copy
values / Reset buttons, `useDraggablePanel('trail')`. Changes apply to the next wisps emitted
(config is read at emit time). Panel-only component (see §6) — no floating toggle button.

## 6. Dev Tuning Menu (`packages/ui/src/DevMenu.tsx`)

Replaces the six individual floating tuner buttons + the Test FX button in `Game.tsx`:

- One 🛠️ button (bottom corner, near the existing dev cluster) toggles a compact menu:
  **SFX · Lunge · Taunt · Drag · Flip · Shield · Trail · Test FX**.
- Each tuner entry toggles that tuner's panel open/closed (checkmark state in the menu).
  Test FX stays a one-shot action (`pixiFx.test()`).
- The six existing tuner components (`SfxMixer`, `LungeTuner`, `TauntTuner`, `DragTuner`,
  `FlipTuner`, `ShieldTuner`) are refactored to **panel-only**: their own toggle button +
  `open` state move out; they render the panel when mounted and receive nothing new (DevMenu
  mounts/unmounts them). Sliders, config files, draggable-panel behavior unchanged.
- `Game.tsx` dev block collapses to `{import.meta.env.DEV && <DevMenu />}`.
- CSS: reuse the `sfxmix` panel styles; new small styles for the menu list; the orphaned
  per-button styles (`lunge-btn`, `fxtest-btn`, etc.) are removed or repurposed for the menu.

## Performance

- Pooled sprites on the existing GPU overlay; worst case during a fast drag ≈ 10–20 live
  wisps — negligible next to existing bursts (impact spawns 22+).
- No per-frame layout reads added anywhere (drag reuses pointer coords; combat interpolates
  from one up-front measure).
- Verify by eye in the prod build (`npm run build:web` + preview) per `docs/performance.md`.

## Testing / verification

- `npm run typecheck && npm run lint && npm test && npm run build:web` green.
- Live verification: drag a plain card (wind trail), drag a Divine Shield card (gold trail,
  no wind trail), watch a combat with a shielded attacker (gold lunge trail) and an
  unshielded one (wind lunge trail); confirm no trail during the settle.
- Dev menu: every tuner opens/closes from the menu; old floating buttons gone; Test FX fires.
- Trails must NOT emit in production differently than dev (config defaults ship in
  `trailConfig.ts`; the tuner itself is dev-only).
