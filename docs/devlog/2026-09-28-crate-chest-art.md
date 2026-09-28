# 2026-09-28: the crate is the owner's two-layer treasure chest

Owner ask (2026-09-28): "added new chest pngs here: C:\Game Assets\Ascent Art\Collection Stuff can you wire this up to
work". Follow-up to the crate opening (#1784). Oracle R-PROG-COLLECTION-03.

## The art

- Masters: `chest_bottom.png` (1254x1254, the body) and `chest_top.png` (1174x359, the lid), out of the repo.
- Built into `apps/web/public/collection/crate_body.webp` (840x457) and `crate_lid.webp` (819x238): each cropped to its
  opaque box plus a few px, both scaled by the SAME factor (840 / 1187), webp q92 with full alpha (the UI-art
  convention, as `frames/`). 62 KB + 41 KB.
- Geometry measured from the masters' alpha (`chestModel.ts` `CHEST_ART`, in cropped-master px): the rim's top edge
  (y 41 of the crop), the lock spike's centre line (x 594) and the lid's notch bottom-centre (578.5, 336). The spike at
  the rim is 56 px wide and the notch at the lid's bottom edge 57 px, so at a scale of exactly 1 the notch slots over
  the spike; the lid overlaps the rim by 3 px so no gap shows at rest. Checked by eye at 0.25x (close-up crops).
- The keyhole's LIGHT MASK is cut from the body art at load (dark pixels in the keyhole's box -> white), so the
  keyhole fills with light in its own shape.

## What changed

- `chestModel.ts` (new): the chest's geometry for the art AND for the painted fallback, one shape the scene reads;
  `loadChestImages` loads both layers or neither (either failing = the painted chest whole).
- `crateScene.ts`: the chest is two sprites placed by the model. New light layers (all additive, tinted, painted once):
  the seam bar + a halo over the lid's bottom edge, the keyhole mask + glow, an additive copy of the body for its
  flashes, the open body's glow. The cracks overlay and the gem are gone.
  - Anticipation: the lid jumps on each pulse on its own spring (a small random tilt, a little bounce on landing);
    the jumps and the seam light grow with the pressure.
  - Burst: the lid launches (tuned speed, spin, gravity) and fades on its way down; a light column pours out of the
    rim; shards and splinters fly off the rim; the body stays whole on the pedestal.
  - Legendary: the lid pops on the first burst, the body flashes white on the second (with the coins).
  - Reveal: the open body glows under the plate; the plate (DOM) now rises out of the chest and hangs above it; the
    crate's name banner bows out once the plate is up.
- Tuner (Crate opening -> Chest group): lid x / y / size, lid jump, lid launch sideways / up, spin, gravity, seam
  light y / width / strength, keyhole light, open chest glow, chest (body) size. `crateArt` stays as a one-picture
  override.
- The DOM crate no longer flashes while Pixi is starting (it stands in only if Pixi FAILS).

## Wanted from the owner (would lift it further)

- An OPEN-BODY layer (the inside back wall and floor of the chest, or at least the top of the open box seen from
  above): today the open body's top edge is the closed rim, so "open" is carried by the light alone.
- Optionally a separate glow mask of the seam and the keyhole (white on transparent), so the light could follow the
  exact edge of the lid rather than a soft bar.
