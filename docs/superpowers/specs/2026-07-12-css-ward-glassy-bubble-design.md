# CSS Ward (glassy bubble) — design

**Date:** 2026-07-12
**Status:** approved (pending spec review)
**Area:** presentation only (`packages/ui`) — no sim / event-log / core changes
**Supersedes:** PR #346 (the contact-timed Pixi break) — the persistent Pixi ward bubble it patched is being retired here.

## Problem

The Ward (Divine Shield) signifier is a **persistent Pixi bubble** rendered on a separate canvas
(`.pixifx-under`) that chases the card by re-measuring its rectangle every animation frame
(`Recruit.tsx` `syncShields` → `makeTrack` → `pixiFx.setShield`). Chasing a moving DOM element from a
separate layer is inherently fragile, and it produces three defects the owner reported:

1. **Won't die on contact.** During combat `syncShields()` runs every frame and *re-registers* a bubble
   for any card still carrying the `.dscard` marker — so removing the bubble at the hit is undone the next
   frame, until the sim's `divineShield` flag flips and React drops the class. The Ward lingers past the
   visual hit, then pops mid-recoil **disjointed from the unit**.
2. **Shrinks/vanishes on drag.** A dragged card's bubble is deliberately shrunk to a "mini" trailing
   sparkle (`setShield(..., mini=true)`), so the Ward no longer reads as *on the card*.
3. **Trails during the lunge.** Per-frame rect measurement lags the GSAP transform.

All three are symptoms of one architectural choice: *a separate layer tracking the DOM*. A CSS layer that
lives **inside the card** is glued to it for free — it inherits the drag translate and the lunge's GSAP
transform automatically, and it appears/persists/vanishes exactly with the `.ds`/`.dscard` class the sim
already drives. No tracking, no re-registration race, no drag hack.

## Approach

Retire the persistent Pixi ward **bubble**; render the persistent Ward in **CSS on the card**. Keep Pixi
only for the fire-and-forget **flourishes** it's good at: the gold **shatter burst** on break, and the
**yellow drag/drop sparkles**. Ward only — Reborn's blue aura stays on Pixi (out of scope; same fragility,
easy follow-up).

### Components

**1. Preview rig — `apps/web/public/fx/ward-css-preview.html`** *(look-first; build + iterate before wiring)*
A game-styled card (cream board, `.archbox`) with the CSS ward layered over it, plus dials for the pieces
that sell a glassy dome: radial base tint + alpha, a bright top-biased **highlight**, a **rim/edge** light,
overall **inset vs. outset** balance, and a slow **breathing** pulse (opacity-only). Live CSS export
(copy-paste into the game). This rig is where the "approximate the glassy bubble" work happens — we iterate
here until it reads like today's shader bubble, then bake the final CSS in. (Matches how pulse/descend/
tendril looks were tuned — no look is wired into the game until the owner signs off on the rig.)

**2. CSS ward layer — on `.card.dscard`** (`styles.css`)
The tuned CSS lives on a layer inside the card (a dedicated child el or `::before`/`::after`, mirroring how
`.venomcard` builds its keyword glow). Because it's part of the card DOM it rides drag + lunge transforms
natively and shows/persists/vanishes with the sim's class. **Compositor-only:** static gradients/shadows;
only `opacity` animates (the breathing `::before`, the `kwglow` pattern) — no per-frame paint props.

**3. Retire the persistent Pixi ward bubble** (`Recruit.tsx` `syncShields`, `pixiFx.ts`)
Stop registering the `'shield'` kind on the Pixi canvas in `syncShields` (PASS 1 + the drag branch + PASS
2/4 clears). Reborn (`'reborn'`) and everything else stay on Pixi untouched. The `makeTrack` combat tracker
no longer needs to run for shield. Dead shield-only branches in `pixiFx.setShield`/`breakShield` are left in
place if still used by Reborn; only the shield *registration* is removed.

**4. Break = class-drop (automatic) + shatter burst** (`useCombatReplay.ts`, `pixiFx.ts`)
The CSS ward vanishes on its own when the sim clears `divineShield` (React drops `.dscard`). On an **attack**
that's at the advance ≈ contact — so it disappears at the hit with no extra wiring. We keep the Pixi **gold
shatter burst** as the punctuation, fired at that moment:
- Attack: reuse the `onImpactAuras`-at-contact hook (from #346), but it now fires **only the shatter burst**,
  positioned by the card's rect (there's no bubble to read coords from). Add a `pixiFx.shatterAt(cx, cy, w,
  h, kind)` entry (or have `breakShield` accept an explicit rect) since the burst can no longer read the
  retired bubble's stored coords.
- Non-attack break (SC / poison / damage moment): fire the same burst at the unit's rect at its moment
  (the existing generic `auraBreak` path, re-pointed to `shatterAt`).

**5. Keep the yellow drag/drop sparkles** (`Recruit.tsx` drag lifecycle, `pixiFx.ts`)
Preserve the sparkle flourish, decoupled from the (now-retired) persistent bubble and driven by the drag
lifecycle instead:
- **On drop/placement** of a warded card → the inward-rushing coalesce sparkles + flash (today's
  `shieldPop`), repackaged as a standalone `pixiFx.wardPlaceSparkle(cx, cy, w, h)`.
- **While dragging** a warded card → a subtle trailing sparkle (today's "mini" flourish), reduced to a light
  particle trail rather than a shrunk shader dome. The persistent CSS ward still shows on the card during the
  drag, so this is additive sparkle, not the signifier.

*(Assumption flagged: "the yellow sparkles" = the mini drag-trail + the drop coalesce. If the owner meant
only one of them, we trim on the rig / during wiring.)*

## Non-goals / scope

- Reborn and Taunt are untouched (Taunt is already CSS; Reborn stays Pixi).
- No sim, event-log, `core`, `content`, or `sim` changes. The `shield`/`shieldUp` events and `.ds`/`.dscard`
  classes already exist and are the contract we bind to.
- Not trying to pixel-match the shader; "approximate the glassy bubble" in CSS is explicitly good enough.

## Verification

- **Look:** signed off on the preview rig before wiring.
- **Persistence:** live in a focused Chrome tab — a warded card shows the ward at rest, **keeps it while
  dragged** (glued to the card) with the yellow sparkles, and **keeps it through the attack lunge**.
- **Break-at-contact:** the ward vanishes at the hit (not mid-recoil) and the gold shatter fires there.
- **Non-attack break:** SC/poison that pops a ward still shatters at the unit.
- **Gates:** `typecheck · lint · test · build:web` green; add/adjust tests for the retired shield path and
  the new `shatterAt` / drag-sparkle entry points.

## Open questions

- Exact sparkle set to keep (see the flagged assumption in Component 5).
- Whether to keep the CSS ward visible *during* the shatter or hide it a beat early — decide on the live check.
