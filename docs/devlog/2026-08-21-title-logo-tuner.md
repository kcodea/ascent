# 2026-08-21 — New title mark + a full Title Logo tuner (font, glows, float)

Replaced the diamond crest beside the main-menu **ASCENT** wordmark with the owner's brand logo (`TitleMark` in
`Title.tsx`; the Continue-button crest is unchanged) and built a live **🏔️ Title Logo** dev tuner (Dev menu →
Stage & Layout) for the whole lockup. The shipped logo is the fantasy raster art — the provided
`Reference Art/Ascent Logo Fantasy.svg` was a 1254×1254 PNG in an SVG wrapper, extracted to
`frames/title-logo.png` and rendered as an `<img>` (an earlier vector peak was tried first). Because the logo
is a bitmap the Mark-colour picker is inert on it (kept for a future vector mark); its size, glow and float
still apply.
Everything routes through `titleConfig.ts` → `--title-*` CSS vars (dev-persisted; prod renders the baked
DEFAULTS; styles.css fallbacks mirror them), the standard config-module + `TunerPanel` pattern.

Controls, grouped:

- **Placement** — mark size, text gap, and whole-logo X/Y.
- **Font** — a **Quick pick** dropdown of curated title Google Fonts, a **Custom font** text field that loads
  *any* Google Font family by name, and a **Weight** slider (100→900). Google Fonts is already the game's font
  system (`index.html` links Outfit/Sora/…); a pick injects the chosen family AT the chosen weight once, so a
  variant like *Lato Thin 100* actually loads (a family-only request would only ship the regular). Requesting a
  weight a face lacks 400s and simply falls back — the cost of arbitrary weights on arbitrary fonts.
- **Colour** — the mark fill (the peak SVG uses `fill: currentColor` so `--title-mark-color` drives it) and the
  wordmark text colour, independently.
- **Text glow** and **Mark glow** — independent size/strength/colour. Each composes N stacked shadows into a
  var (text-shadow for the wordmark, drop-shadow filters for the mark), appended after the base shadows with a
  transparent no-op when strength is 0 (a shadow list can't hold `none`).
- **Float** — a compositor-only transform bob with a **Sync bob** toggle: synced animates the whole
  `.titlelogo` as one (`titlefloat`, whose keyframes fold in the X/Y offset); separate leaves the group static
  and bobs the mark + wordmark on their own amp/speed (`titlebob`, each reading its own `--bob-amp`).

**Shipped defaults (owner-tuned):** the logo large (200px) and pulled left over the wordmark (gap 0, x −95 /
y −4); **Cinzel Decorative 600** in white (added to `index.html`'s Google-Fonts `<link>` so it preloads); a soft
dark text glow (`#5c4e4e`, 11px ×2) and a dark halo on the logo (`#0b0f1e`, 8px ×1); and a **separate** float —
logo 5px / 5.2s, wordmark 4.5px / 5.2s.

Presentation only. Verified: typecheck ✅, build:web ✅, tests ✅ (lint's only errors are the pre-existing
untracked vendored `modern-screenshot.umd.js` bundles, absent in CI). The impeccable font hook flags the
Google-Fonts URL strings in `titleConfig.ts` — expected for the font-picker feature, left as-is.
