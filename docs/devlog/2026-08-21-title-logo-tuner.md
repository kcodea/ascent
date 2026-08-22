# 2026-08-21 — New title mark + a full Title Logo tuner (font, glows, float)

Replaced the diamond crest beside the main-menu **ASCENT** wordmark with the owner's peak mark
(`Reference Art/Ascent Menu.svg`, inlined as `TitleMark` in `Title.tsx`; the Continue-button crest is
unchanged), then built a live **🏔️ Title Logo** dev tuner (Dev menu → Stage & Layout) for the whole lockup.
Everything routes through `titleConfig.ts` → `--title-*` CSS vars (dev-persisted; prod renders the baked
DEFAULTS; styles.css fallbacks mirror them), the standard config-module + `TunerPanel` pattern.

Controls, grouped:

- **Placement** — mark size, text gap, and whole-logo X/Y.
- **Font** — a **Quick pick** dropdown of curated title Google Fonts, plus a **Custom font** text field that
  loads *any* Google Font family by name. Google Fonts is already the game's font system (`index.html` links
  Outfit/Sora/…), so a pick just injects that family's stylesheet once — curated names use known-good weight
  queries; a typed name is requested by family alone so the request can't 400 on a missing weight.
- **Text glow** and **Mark glow** — independent size/strength/colour. Each composes N stacked shadows into a
  var (text-shadow for the wordmark, drop-shadow filters for the mark), appended after the base shadows with a
  transparent no-op when strength is 0 (a shadow list can't hold `none`).
- **Float** — a compositor-only transform bob with a **Sync bob** toggle: synced animates the whole
  `.titlelogo` as one (`titlefloat`, whose keyframes fold in the X/Y offset); separate leaves the group static
  and bobs the mark + wordmark on their own amp/speed (`titlebob`, each reading its own `--bob-amp`).

**Shipped defaults (owner-tuned):** mark 108px, gap 42px, x 1 / y −18, Outfit, no text glow, a soft gold mark
glow (4px ×1, `#bc9749`), and a **separate** float — the mark bobs small + quick (2px / 2.6s), the wordmark
larger + slower (4px / 4.5s).

Presentation only. Verified: typecheck ✅, build:web ✅, tests ✅ (lint's only errors are the pre-existing
untracked vendored `modern-screenshot.umd.js` bundles, absent in CI). The impeccable font hook flags the
Google-Fonts URL strings in `titleConfig.ts` — expected for the font-picker feature, left as-is.
