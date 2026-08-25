# 2026-08-24 — Load-screen: owner-tuned defaults + a clean 3s bar fill

Owner baked the ⏳ Load Screen tuner values as the shipped defaults, and asked the fake progress bar to fill
**smoothly over 3s** and then hand off to the menu **~0.5s** later (the real preload keeps running behind it —
the bar is intentionally cosmetic, not tied to art progress).

**Defaults baked** in BOTH sources of truth (`loadScreenConfig.ts` DEFAULTS *and* the `apps/web/index.html`
CSS `var(--ls-*, fallback)` values — production never sets the vars, so it renders the fallbacks). Changes:
`iconSize 300→570`, `barWidth 340→413`, `barHeight 6→8`, `barBottom 12→22.5vh`, `gradCenter #1b1b1d→#24468a`,
`gradEdge #000000→#0a1730`, `gradSize 75→60`, `gradPosY 42→50` (`gradPosX` unchanged at 50). The icon and
bar-width fallbacks keep their responsive `min(…px, vw, vh)` wrappers — only the px cap moves to the new
default, matching the existing convention.

**Timing.** The bar fill CSS transition went `3500ms → 3000ms` (`#bootsplash.is-in #bootsplash-bar > i`).
`Boot.tsx`'s `MIN_SPLASH_MS` stays `3500`, so the sequence is now: fill over 3s → sit full ~0.5s → the
existing 900ms dissolve into the menu. Total on-screen time is unchanged (~3.5s min); only the split moved,
per the owner's ask. The bar was already a pure CSS `scaleX` transition (compositor-only, not driven by real
progress), so it was already smooth — this just gives it the explicit 3s + 0.5s beat.

The two new gradient hex values (`#24468a` / `#0a1730`) are the owner's tuned load-screen colours — flagged by
the impeccable design hook as outside the palette, kept as an intentional owner choice (they came verbatim
from the tuner paste).

Verified: `typecheck:web` + `build:web` green; grep confirms no stale old values remain in the two source
files. Visual timing left for the owner to eyeball on a real boot (the headless preview can't reliably clock a
3.5s splash sequence).
