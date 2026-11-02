# 2026-11-01 · A new look for Amplified Equipment ("Charged")

Owner ask 2026-11-01: redo the Amplified Equipment effect ("Design a new one"). Branch `feat/amplified-fx-variants`.

## How we got here (three rounds of owner feedback)

1. Pixi drafts (twin echo rings, twin orbiting comets, a rune halo): "they are all pretty meh".
2. Lightning drafts (rim crackle, corona, twin snap X): "Don't like it. It should be somewhat gentle and not over the
   top, just needs to say 'this is amplified' but not a crazy signal".
3. Gentle drafts (breathing halo, halo + rim sheen): "need a bit more to it than this".
4. **Charged** (halo + out-of-phase second ring + rim glint + rising motes): "looks good". Shipped as the only look.
   No DEV switch: the owner picked one.

## What

- **The look is CSS, not Pixi.** StatusBar mounts `.eq-amp-set` on the Equipment slot (styled in the new
  `amplifiedSlot.css`) under the unchanged show rule: the SELECTED Equipment will Amplify AND has a charge AND it is
  the Shop AND nothing covers the slot (run-state or UI-store overlays). Layers:
  - a blue halo (crisp 3u rim + wide spill, the tally's `#7fc4ff`) breathing 30% to 100% opacity over 3.6 s;
  - a thin second ring 9u outside the frame, breathing half a cycle out of phase (the quiet "double");
  - a glint that travels the frame's rim once every 4.8 s, clipped to the rim by a static mask (never over the art);
  - 8 soft motes rising off the sides and top, drifting outward and fading (5.6 s, staggered).
  It sits at z4 inside the slot so it reads above the gold READY call (z1 / z3) without touching the art.
- **The release** (`amplified-release`, new Pixi def): two soft blue rings leave the slot 240 ms apart, one per
  trigger. `useAmplifiedReleaseFx` (in `useAmplifiedSlotFx.ts`) fires it when a fresh `use` cue arrives on the
  `equipFxSeq` channel for the Equipment that WAS Amplified on the previous render. Never on mount, once per press,
  never for an unamplified use or for the Amplification ending without a use.
- **Retired:** the looping `amplified-slot` Pixi play (PR #1633) and its hook. The def file stays in the library,
  unplayed (dropped from `directCalls.ts` / the uid exemptions).

## Notes

- Perf rule: every keyframe in `amplifiedSlot.css` animates `opacity` / `transform` only (pinned by
  `useAmplifiedSlotFx.test.tsx`, which parses the sheet). It is its own sheet because `equipHousing.test.tsx` holds
  `equipSlot.css` to "nothing animates".
- Measured (dev build, headless Chrome, 1920x1080, idle shop, 4 s windows, look on vs off): main-thread task time
  1.19-1.21 ms/frame on vs 1.29 off (noise), paint events 1926-1928 vs 1908-1924 (no extra paints), style recalcs one
  per frame either way, layouts 4 either way. The old Pixi loop cost ~0.66 ms/frame and ~3,700 live particles.
- Phone screenshots use the shipped phone zoom (the 2:1 phone layout behind `phonelayout` has no Equipment slot rule;
  pre-existing, not touched here).
