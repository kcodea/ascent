# 2026-08-21 — Midas' missing triple pip, and a ceremony that finally scales

Three owner reports, two of them the same root cause.

## The shop never told Midas he could Gild

Midas' Touch Gilds at **2** copies, not 3. The reducer knew that (`checkTriples` computes
`need = runeTwinGilding || midasTouch ? 2 : 3`), but the shop's "buying this completes a triple" highlight
hardcoded *"you already hold 2"* — a threshold of 3. So a Midas player holding one copy saw no pip on the
duplicate sitting in their shop that would have Gilded on the spot. Same blind spot applied to Rune of Twin
Gilding.

Both now read one exported `gildCopiesNeeded(run)`; the shop lights an offer at `need - 1`.

## The ceremony only ever fit one resolution

`destinationRect` sized the centred portrait as `clamp(0.28 × viewport width, 360, 520)` — which **clamps to a
constant 520px on any screen wider than ~1857px** — while every tuned offset around it (name plate, ring,
button) stayed in raw pixels. Meanwhile the rest of the UI multiplies every authored size by the global
`--scale` (the 16:9 stage height ÷ 1440, set in Game.tsx). The ceremony was the one thing not doing that, so it
only held together at the resolution it was dialed at.

Now everything — the destination, the ring, the hero-art nudges, and every `--hsc-*` offset and font size in
CSS — is **reference px × the stage scale**. Measured across 1366×768, 1600×900, 1920×1080, 2560×1440,
3440×1440 and the dev viewport, the portrait occupies a constant **44.2% of the stage** at every one, and a
live check at two window sizes found all five layout values (name font, plate top, plate width, button top,
ring diameter) landing within 0.1px of the predicted ratio.

An ultrawide is now sized by its HEIGHT, like the board — 3440×1440 and 2560×1440 produce the same portrait.

## Practice was off-screen for a different reason

The destination took its aspect from the SOURCE card. Practice's dense roster card is ~2.7:1 against the big
card's ~1.31:1, so the destination came out more than twice as tall and the portrait sat off the top of the
screen. But the ceremony *always presents a big card* — the clone re-renders the big-card markup whatever it
flew from — so the aspect is now the fixed `CEREMONY_ASPECT`. Practice and Play produce identical destinations
at every resolution.

While verifying this, the browser pane's timer throttling exposed a related fragility: the portrait's bounds
are measured off the clone, and a dropped-frames or coalesced-timer case can run the transform beat before the
travel has visually happened, measuring the card at its old position and size. The measurement now waits on
the travel animation's own `finished` promise instead of assuming the beat ordering holds.

## Verification

- `ceremonyScale.test.ts` (18 cases) — Practice/Play parity at six resolutions, constant share of stage, linear
  scaling, ultrawide sized by height, degenerate-viewport safety.
- `gildThreshold.test.ts` (6 cases) — the threshold for a normal run, Midas, Twin Gilding, both together
  (cannot stack to 1), an unknown hero, and the shop's `need - 1` relationship.
- The pre-existing geometry suite was updated: four of its assertions pinned the old viewport-fraction
  behaviour and the source-derived aspect, both of which were the bugs.
- Gates: typecheck ✅ · lint 0 errors ✅ · **6493 tests / 396 files** ✅ · build:web ✅

## Note for the owner

Tuner values are now **reference px at the 1440 stage**, so on the dev viewport (scale 0.818) the ceremony is
pixel-identical to before — the 636 reference was picked so that 636 × 0.818 = the old clamped 520. On a
different monitor it will now be proportional to the board rather than a fixed size, which may read slightly
larger or smaller than what you dialed. If so, one number (the 636 reference in `destinationRect`) rescales the
entire composition without disturbing any of the tuned offsets.
