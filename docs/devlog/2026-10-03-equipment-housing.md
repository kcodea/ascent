# 2026-10-03: the Equipment housing, rebuilt in CSS (three looks + Classic)

Owner ask 2026-10-03: "branch off an rebuild the equipment housing from scratch. make it more modern/sleek/cozy and
fit our aesthetic. note that it needs to be able to fit all names etc for the equipment".

## What changed

- The Equipment slot (StatusBar) no longer needs the riveted bronze bitmap frame. A new switch, `data-eq-look` on
  `<html>` (`equipLookConfig.ts`, DEV picker in the 🧪 Equipment Slot panel as "Equipment housing"), picks one of:
  - **Classic**: the old `frames/equipment-frame.webp` frame, kept for before / after.
  - **A. Gem socket (production default)**: a soft rounded-square socket with the Gem plate gold edge, an inner
    bevel and a static sheen over the art, a Gem plate name pill eclipsing its foot, the Gold coin and a charge chip
    on its top corners.
  - **B. Halo**: a round socket with a thin gold rim and a soft outer ring, a name tag under it.
  - **C. Tablet**: one small card, art on top, name in its bottom band.
- All three paint from the shared `--ui-*` theme tokens (`equipSlot.css`), so the 🎨 UI Theme tuner recolours them.
  The only literals are black / white shading and the two state colours the charge number always had
  (`--eq-boost` green, `--eq-amp` blue).
- The charge number is now a chip: green with the shared bonus pool, blue while Amplified, muted at 0. The Amplified
  glow itself is still only the owner's Pixi `amplified-slot` loop (selected + Amplified + charged), unchanged.
- The ready / armed glow is the same static-shadow-with-breathing-opacity layer, reshaped to hug each socket.

## Names

The plate is a fixed width (150u; 140u in Tablet) and the name auto-shrinks (`EquipNamePlate.tsx`, one layout read per
name change, re-run once when the web font lands) to no less than 0.78 of its 12.5u base, with an ellipsis only as a
last resort. Measured in Chrome over all 17 Equipment at 1920x1080 and 1366x768, in all four looks: **no name needs to
shrink and none clips**. The longest, Calibration Wrench (18 characters), uses 94% of the plate; then Deathfibrillator
and Magnifying Glass (16). `equipHousing.test.tsx` holds every name to a conservative width budget at the floor size.

## Fix on the way: the Thymepiece readout was back under the name

The clock-window readout ("-1 Gold · 6s") is ruled to sit ABOVE the slot and move nothing (owner 2026-09-22). The
Ancients stylesheet's `.statusbar .heropanel .hplabel { position: relative }` out-ranked it, so it had dropped back
into flow under the name and lifted the whole slot by 14px while a window was open. Re-pinned in `equipSlot.css`,
in every look.

## Layout

The button keeps its 128u box and the name plate keeps the old plate's height, so the slot's centre (its anchor) never
moves. Rect check at 1920x1080 and 1366x768, before (main) vs after (Gem socket), with the same 11 states: 316
elements outside the slot, only difference the Refresh button's animated sheen bar; hero, hero power, Health box and
StatusBar identical; the Equipment button identical in every state except Thymepiece, which now matches the rest
(the fix above). The slot box itself is a little wider (the fixed plate), which moves nothing.

## Left in place

`apps/web/public/frames/equipment-frame.webp` is now drawn only by the Classic look (StatusBar renders the `<img>` only then).
Delete it with Classic once the owner has compared. The selector rail and the tooltip are unchanged.
