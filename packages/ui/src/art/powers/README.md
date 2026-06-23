# Hero-power button art

Drop a square PNG named by the **hero id** here — e.g. `warden.png`, `cassen.png`, `rohan.png` — and it
renders in that hero's power button (the circle on the right of the hero frame), replacing the placeholder
glyph. Then run `npm run optimize-art` (it downscales to ≤512px WebP and removes the PNG; the master stays
out-of-repo).

- **Size:** 512×512 (or a larger master — the optimizer caps it at 512). The button displays at ~100px
  (≈200px on retina), so 512 is plenty.
- **Shape:** the button is a **circle** (`object-fit: cover`), so use a **square** image with the subject
  **centred** and a little margin — the corners get clipped by the circle.
- **Background:** transparent.

Hero ids: `warden`, `cassen`, `drakko`, `rohan`, `myra`, `nadja`, `indy`, `soren`, `djinn` (see `packages/sim/src/heroes.ts`).
