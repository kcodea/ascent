# 2026-11-17 — Hero Select showcase layout goes live

The showcase layout from [2026-11-16](2026-11-16-hero-select-showcase.md) is now what players get (owner: "Yes, go live"). It was a DEV-only trial, off by default; `heroShowcaseFlag.ts` now reads as on in every production build.

**Who still gets the three banners.**

- The touch UI (a touch device on a scaled stage: phones and small tablets). The showcase has no phone layout yet, so `heroShowcaseOn()` is false while `touchUi().on`, in production too. The hook also listens to `onTouchUiChange`, so a rotation or resize that turns the touch UI on or off swaps the layout.
- A DEV client that turned it off (the DEV menu entry "Hero Select: showcase layout", or `?heroshowcase=0`), to compare the two. Production has no way off.

**Unchanged.** Any offer of more than six heroes keeps the whole-roster grid (Practice "All heroes", Gauntlet, Sandbox). Its redesign is a separate project that goes live later. Practice's Beginner offer (three starters) uses the showcase; a test now pins that.

**Tests.** `heroSelectPh.test.tsx` covers the banner layout, so it now turns the showcase off in its setup. `heroShowcaseFlag.test.ts` pins on-by-default, always-on in production, and the touch UI exception.

**Known gaps carried over.** No phone layout. The forced-jump retry (a Versus timeout arriving before the lazy body loads) still has no test.
