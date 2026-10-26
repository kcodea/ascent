# 2026-10-26: iPhone drops text-shadow under paint-order (R-WEBKIT-SHADOW-01)

**Report:** tester Lemon on a phone, Netlify build a9afafa5a: "the return to shop is missing the glow on the lettering".

**Comparison.** The previous live build was `ascent-web-d3402d64c.zip` (packed 2026-10-21). Both prod zips were
unpacked and walked offline (title, hero select, shop, first fight, End Combat, the return trip) as an iPhone Home
Screen app in Playwright WebKit (852 x 393 @3x) and in desktop Chrome (1920 x 1080). Capture scripts are not in the
repo; `scripts/phone-webkit.mjs` has the same setup.

**Cause.** `.wipevs-label` / `.wipevs-name` set `paint-order: stroke fill`, which is inherited. The return trip's
title (`.wipevista .wipevista-title`, #2266) and the gate poster's lettering use those classes, draw no stroke, and
carry a text-shadow. **WebKit paints no text-shadow at all when paint-order is not `normal`.** The computed style
is correct, so only a render shows it. On desktop Chrome the glow was always there. On iPhone it never drew. Tested in
WebKit: `stroke fill` drops the shadow, while `normal`, `fill stroke` and a `filter: drop-shadow` keep it.

**Fix.** Both rules set `paint-order: normal`. With no stroke, the two orders draw the same, so nothing else changes
anywhere. `webkitTextShadow.test.ts` pins both rules. It also lists every older rule that pairs a stroke-under-fill
with a text-shadow and fails on any new one.

**Still open (older, not regressions):** these lose their shadow or glow on iPhone today: the damage tallies
(`.dform-chip/merge/hero b`), the hero blast numbers (`.hblast-total-n`, `.hblast-hit`), the plate tribe label, the
spell and Ruby power floats, the compact drawer tribe, and the Collection skin tiles. Each still needs its own iPhone
look (for example a `filter: drop-shadow` on WebKit only, or a stroke drawn over the fill), and that needs an owner call.
