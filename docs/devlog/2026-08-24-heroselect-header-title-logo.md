# 2026-08-24 — Hero-select header + main-menu logo default refresh

Two owner-asked title/lockup tweaks (same shared `AscentLogo`, so bundled):

**Hero select.** The ASCENT lockup now sits at the TOP of the screen and is 30% smaller (mark 92→64px, word
60→42px), with a **"Select Your Hero"** prompt directly above the portraits. `.heroselect` became a two-row
grid (`grid-template-rows: auto 1fr`) and the lockup moved OUT of `.hsbox` so it pins to the top row while the
picker centres in the rest; the logo now carries its own `--hs-zoom` for scale parity. The Practice browse
grid's logo rules were re-scoped from `.hsbox:has(...)` to `.heroselect:has(...)` since the logo left `.hsbox`.
New `.hsprompt` label (uppercase, tracked). Files: `HeroSelect.tsx`, `styles.css`.

**Main-menu Title logo.** Owner re-tuned the 🏔️ Title Logo tuner and baked it: `markSize 200→180`,
`gap 0→13`, `x −95→−66`, `y −4→−38` (font/colour/glow/float unchanged). Mirrored into `titleConfig.ts`
DEFAULTS **and** the styles.css `--title-*` fallbacks (the pre-JS / no-JS paint), per that module's contract.

**Patch note:** added a `Menu Polish` entry to `patchNotes.ts` (both are in-game UI changes).

Verified: typecheck ✅, lint 0 errors ✅, build:web ✅. Owner-tuned + signed off live at 1×.
