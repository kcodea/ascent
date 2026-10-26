# 2026-10-26: Outlined text keeps its glow on iPhone (R-WEBKIT-SHADOW-01, part 2)

**Owner:** "yes, build the iPhone-friendly versions". This follows `2026-10-26-webkit-text-shadow.md`, which fixed the
return trip title and the gate poster and listed the older text that still lost its glow on iPhone.

**The problem.** The damage numbers, plate and drawer tribe labels, spell / Ruby power floats and Collection skin tile
lines draw an outline under the fill (`-webkit-text-stroke` + `paint-order: stroke fill`) and a `text-shadow`. WebKit
(every iPhone browser, and Safari) draws no text-shadow on text whose paint-order is not normal. There is also a
second WebKit difference: when it does draw a shadow on stroked text, the shadow comes from the letter shapes only, so
the shadow sits under the outline. Chromium paints outline, then the letters' shadows ON TOP of the outline, then the
letters. That is why the stroke looks tinted by the glow on desktop.

**The technique** (`webkitText.ts`, styles.css "OUTLINED TEXT WITH A GLOW ON WEBKIT"):
- `installWebKitText()` (apps/web main.tsx) sets `html[data-webkit-text]` on WebKit only. The test is AppleWebKit in
  the user agent and no Chrome / Chromium / Edg / OPR / SamsungBrowser / Android token. iPhone Chrome (CriOS) and
  desktop Safari count as WebKit.
- Each label carries `data-wkt` (a copy of its text; `setGlowText` keeps them in step for the JS-built numbers). Its
  rule writes the stroke and shadow through `--wk-stroke` / `--wk-ts`. Chromium computes the same values, so nothing
  changes there.
- On WebKit: `::before` draws the outline alone, `::after` draws the shadows alone (no stroke, transparent fill,
  paint-order normal, so WebKit draws them), both at z -1 inside the label (isolation). The label on top draws its
  letters only. A multi-part label (Beast / Dragon, icons in the drawer line) carries `data-wkt` on each word, so the
  icons and separators keep their places.
- It is static paint inside the label. The floats and damage numbers still animate transform / opacity only.

**Proof** (scratchpad `visual-regress/iphone-glows/`):
- **Harness:** every item with the real built CSS, in WebKit before and after and in desktop Chrome. The WebKit "after"
  matches Chrome.
- **Desktop, harness:** Chrome before vs after is pixel-identical at 1300x700, 1920x1080 and 2560x1080.
- **Desktop, in game:** a seeded run (same hero, same shop) differs only on the hero power's animated ready ring.
- **iPhone, in game:** a WebKit sweep finds no element left with paint-order + shadow, and the damage numbers glow in
  combat.

**Gotcha for next time:** `-webkit-text-fill-color: transparent` + a stroke still loses the shadow under a stroke in
WebKit, and a `filter: drop-shadow` chain compounds (each shadow also shadows the previous one). The two-pseudo split
is what matches Chrome.
