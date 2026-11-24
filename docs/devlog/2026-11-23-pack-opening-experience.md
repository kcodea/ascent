# 2026-11-23 — Pack opening experience (dev-only, tuned by the owner)

Branch `feat/pack-opening`. Spec: `docs/superpowers/specs/2026-11-23-pack-opening-design.md`; the owner's tuned
prototype: `docs/superpowers/specs/2026-11-23-pack-opening-prototype.html`.

## What shipped

- **A tactile pack opening** under `packages/ui/src/progression/packOpening/`: the player tears the top strip off the
  sealed pack (peel, fibre catch, pinch twist), slides the sleeve off the card stack, zooms into the stack, and flips
  the cards one at a time (edge-on flip handoff), with a tray and a summary at the end. A Quick open path auto-plays
  the whole thing, and Reveal all flips the rest.
- **Pack Lab**: a DevMenu panel with sample packs (including `mixed-dupes`) and live sliders for every feel number. It
  cancels its sample timers and keeps the run's look between samples.
- **Rarity medallions** on the card backs and faces (`ascent_rarity_ancient.webp` is the Ancient rarity's icon).
  `ascent_rarity_secret.webp` also ships, unused: a Secret medallion supplied for later.
- **The owner's card plate** (`packs/cosmetic-card-plate.webp`) frames every pack card, the Pixi backs and the DOM
  faces alike. The face lands at the back's size, a little larger in the revealed pile on the right; the draw pile
  slides left as it zooms.
- **Rarity glows**: each pack glows in its rarity (a rarity pack in its own colour, otherwise its guaranteed floor),
  and each card back and revealed face glows in the card's rarity. Common and Rare are steady, Epic pulses gently,
  Legendary and Ancient pulse strongly. The pulse animates opacity only over static glow art. Pack glow and card glow
  each have a slider in the Pack Lab.
- **Pack wrapper art per rarity** (`packs/<rarity>-pack.webp`, from the owner's five rarity wrappers), plus the owner's
  Secret wrapper as a themed "Secret Pack" look (Secret is not a rarity yet; it glows at an Ancient floor for now). Each PNG is cut on one template, 600x900 with the tear line on row 100:
  strip and body are scaled separately so the crimped edges stay whole and every tear line lines up. The pack is 300x450
  at base size, with the tear strip in the top 50. Category and themed packs keep the placeholder painting.
- **Surface gloss**: a light band slides over the pack as it moves, with gloss strength and sharpness sliders. A
  per-pack shine mask can be added later for a holographic or pearlescent foil.
- **Mouse tilt on the sealed pack**, driven by the same drag-dive numbers as a dragged card in game (`getDragFeel()`),
  scaled by a Pack tilt slider. The pack settles flat and stays still once you start opening it. Grabbing works on
  the corner as drawn, and the hand stays under the finger while the tilt settles.

- **The big-pull moment** (`bigPull.ts`): when a Legendary or Ancient card flips, a light burst (additive bloom plus
  slowly turning god rays, behind the landing face), a short one-shot shake of the theatre, the chest's tier-burst
  sound, and a hold before the next flip (clicks during it are ignored, Reveal all waits it out). Ancient is bigger and
  longer. Pack Lab sliders: Big pull burst, shake and hold. Reduced motion keeps the sound and the hold only.
- **Holographic / pearlescent sheen**: Epic and up. On the pack, a small custom Pixi shader over the strip and body
  (shares their geometry, so it peels and tilts with them) samples a pastel rainbow whose offset follows the tilt,
  cursor and peel, multiplied by a per-wrapper greyscale shine mask (`packs/<id>-pack-shine.webp`, generated from the
  art by `scripts/pack-shine-masks.cjs`; a hand-painted mask can replace any of them). On the card faces, a blended
  rainbow layer that sweeps once when a face lands and again in the summary row, and follows the pointer on hover
  (transform only, no looping animation). Strength by tier, scaled by the Pack Lab's Holo slider.

## Dev-only

Nothing outside the DevMenu mounts the opener, and the DevMenu itself is dev-only, so a prod build cannot reach it.
The chest opener is untouched. No player-facing change, so no `patchNotes.ts` entry.

## Result contract

`packages/progression/src/packs.ts` (dependency-free, parsed at the boundary): `PackOpenResult` is the pack opened
(`PackLook`), 1..5 `PackCard`s in reveal order with the single guaranteed card always LAST, and an optional Aether
balance after duplicate refunds. The UI requests the result at the pop (the moment the strip tears off). A failed
request resets the opening to sealed, so the pack is not consumed in the UI. The opener only ever sees the parsed value.

## Owner's tuned defaults (`packFxConfig.ts`, from the prototype verbatim)

peelAngle 0.4, edgeTowardCamera 139, slackBeforeTear 0.92, edgeFollowsHand 0.1, maxTearSpeed 18, fibreCatch 0.7,
pinchTwist 0.65, tearsStraightUp 0.15, highlight 0.65, perspective 1780, volume 0.45, sleeveGrip 80,
sleeveFollows 0.36, sleeveRimDrag 1, sleeveFingerPinch 0.08, sleeveLetGo 295, stackZoom 0.3, quickOpenMs 1000.
Pixel values were tuned at a 300-wide pack (the prototype was 300x476; the wrapper art makes it 300x450) and scale with the
rendered width. Overrides persist to localStorage
(`ascent.packFeel.v1`), clamped per key to the knob ranges, with junk falling back to the default.

## Performance

The Pack Lab is not in a prod build, so the capture ran on the dev server (slower than prod, so a conservative test),
in the browser pane emulating 1920x1080. One full scripted opening of the `mixed-dupes` sample (Quick open, zoom,
Reveal all, summary): 3595 ms total, 1266 animation frames, 0 long tasks over 50 ms, 0 frame gaps over 34 ms. The
hand-dragged tear was not measured by script; the owner's feel check covers it.

## Left to the pack-economy project (spec section 12)

- The server rolls packs and answers in the `PackOpenResult` shape.
- Add `packs.ts` to `SHARED_ARTIFACTS`.
- Pricing.
- What the Secret medallion is for.
- Decide whether to gate `packFeel` persistence out of player builds.
- Wrapper art for category and themed packs (the five rarity wrappers and the card plate have landed).
- A holographic or pearlescent foil sheen (gloss plus a per-pack shine mask).
