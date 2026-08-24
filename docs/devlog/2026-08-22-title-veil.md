# 2026-08-22 — Title-screen navy veil + tuner

Owner ask: a dark navy gradient over the main menu that fades to nothing so the floating-city art stays bright,
with **bowed** (curved) edges, sitting behind the logo/menu, plus a tuner for colour + intensity.

**What shipped (UI only).** The old static "dark left vignette" on `.titlescreen::before` (two flat linear
gradients) is replaced by a tunable **elliptical radial** veil: a transparent core over the city (centre-right)
ramping to navy at the edges, so the dark→clear boundary *bows* instead of running straight. It stays on
`::before` at z-index 1 — above the background art, below the menu/account/version at z-index 2 — so no new DOM
element was needed.

**Tuner.** New dev **Title Veil** panel (🌒), built on the shared schema-driven `TunerPanel` exactly like
`boardEdgeConfig`/`BoardEdgeTuner`:
- `titleVeilConfig.ts` — DEFAULTS + `applyTitleVeilVars()` (folds `col` + `intensity` into `--tv-col` and its
  0-alpha twin `--tv-col-0`, and sets `--tv-cx/cy/rx/ry/clear/edge`) + dev-only localStorage persistence + the
  `SPEC`. Registered in `tunerAll.ts` (reset-all) and `DevMenu.tsx`.
- Knobs: **Veil colour**, **Intensity**, plus the bow shape — core centre X/Y, core width/height (the ellipse),
  bright-hold and full-dark-reach stops.
- Applied on title mount in `Title.tsx` (alongside `applyTitleVars`); DEFAULTS mirrored into the styles.css
  `:root` `--tv-*` block as the pre-JS / no-JS paint.

**Owner-baked defaults** (2026-08-22): `col #0a1730`, intensity 1, core 57%/45%, rx 26% / ry 130%, clear 35%,
edge 160% — a tall narrow bright column over the city with deep navy sides.

**Judgment call flagged:** the bow is a single elliptical radial, which darkens all four edges symmetrically
about the core. Asymmetric bows (e.g. a deeper band on the menu side than the right) would need a mask /
multi-layer approach — deferred unless asked.

Verified: typecheck ✅, lint 0 errors ✅, build:web ✅. Live-tuned and signed off by the owner at 1×.
