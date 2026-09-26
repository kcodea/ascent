# 2026-09-26 — Ancient awakening: nine bloom styles for every hero

Owner: "they do not all need to be crazy specific, can be generic if there isnt a fantastic fit. id prefer clean
animation than generic bubbly mobile looking iphone effects." Then: "build all 9 styles on a branch and tell me which
heroes have each." Follows `2026-09-26-ancient-hero-bloom.md` (the default + the four approved heroes).

**Model.** A hero's entry in `packages/ui/src/ancients/ancientHeroThemes.ts` is now five colours + a SIGNATURE:
`{ label, style, knobs }`. `style` is one of nine reusable styles or three one-off accents (`BLOOM_STYLES`); `knobs`
are a few optional per-hero tweaks (`BloomKnobs`). Every one of the 59 heroes in `HEROES` has an entry;
`DEFAULT_THEMED_HEROES` (empty) is where a hero would go to wear the default on purpose. `label` is the hero's display
name (a test pins it to `HEROES`).

**Code.** `ancientHeroBloom.ts` turns a signature into markup (`bloomMarkup`: the medallion's entrance, its in/out
layers and the accent layers + parts) and into motion (`playHeroBloom`). The new `AncientBloom.tsx` renders the
medallion from that markup (the gate used to inline it), including the small SVG marks (dial ticks, jagged ring,
glyphs, vines, arcs, crown). Static paint is in `ancients.css` under "THE BLOOM STYLES". `.tint` marks a hero on a
style whose approved owner keeps the hard-coded paint, so it wears the same shapes in its own colours.

**The styles and who has them.**

| Style | What it does | Heroes (knobs) |
| --- | --- | --- |
| A Coin strike | Crisp diagonal sheen, thin rim flash, sharp glints | Indy (baked gold), Nadja (a coin rises), Robin, Rascal, Tradesman, Frantic Frank (price-tag slash), Midas (two sheens), Juggler (three coins arc over), Braum, Harlan, Fibbsy (gem glint) |
| B Card fan | 1 to 3 thin card outlines fan out behind the medallion | Disco Dan (3), Brackus (1 tall), Fi (2), Coran (2), Tiff (3 + sheen), Kindness (1), Merrin (3), Albus (3), Ayse (2) |
| C Strike rings | Thin shock rings pulse out | Auctioneer (her three pulses + gavel thump), Drakko (3 drumbeats), Jensen (one sharp blast), Foreman Flint (blast + anvil sparks), Aevor (2 drumbeats, jagged lightning-thin), Gorun (2 drumbeats + blade glint) |
| D Spirit rise | Thin rising wisps + a soft Rise halo | Lord of the Risen (baked aqua), Soren, Underdweller, Cindara (embers) |
| E Clock dial | A thin tick ring turns a notch and clicks | Djinni, Cassen, Chronos, Gambler (lands on a pip), Pete |
| F Glass shell | A clear shell forms and catches one shine | Warden (baked ward glass + seal), Yirin (mirror silver), Emerald Warden, Keshi the Protector (small crown) |
| G Rune etch | A pen of light etches a ring of glyphs | Chaos (flicker), Runesmith, Guardian (double ring), Quillen (a line of script over the top) |
| H Echo copy | A faint copy slides out and merges back | Gildmaster (a pair parts left and right + sheen), Re-Pete (2), Gorr (3 quick), Xerox (crisp photocopy snap), Hunch, Flash (motion streak), Membrance, Mimic (2) |
| I Swap arcs | Two thin arcs trade places | Darah, Emissary, Odelle (three points), Sable (tether) |
| Collapse (one-off, under C) | A thin ring collapses onto the rim | Devourer, Void |
| Vines (one-off, under G) | Thin vine segments grow up both sides | Rayse |
| Star glint (one-off, under A) | One clean four-point glint | Aster, the Guide |

Every new-style hero uses the clean `settle` entrance (fade + a soft 0.7 to 1.03 to 1 settle, no bounce). The approved
four keep theirs (`gild`, `seal`, `thump`, `rise`).

**Colours.** The 55 new palettes start from the owner's colour idea per hero, checked against the portrait art
(sampled dominant hues). Each is a mid-tone curtain centre, a near-black edge in the same hue, a seam that is the title
glow mixed 70% toward white, a bright title glow and a near-black backdrop. Albus and Odelle's centres were darkened a
step so the gold title still reads.

**The approved four are unchanged.** Same markup (pinned by a test), same keyframes and timings, same animation count.
Frame comparison in headless Chrome (seeded `Math.random`, all animations frozen at 300 / 600 / 800 / 1000 / 1300 /
1700 ms after the eruption, before vs after): mean pixel difference 0.000 to 0.002, and the only differences above 24
levels (2 pixels) sit at 300 ms, which is the Pixi stardust (not frozen by the harness).

**Tuner.** The ✦ Ancients panel's per-hero groups and "▶ Play as …" buttons are replaced by one "Hero theme" group:
a Hero dropdown (all heroes + Default, each labelled with its style letter), a Style preview dropdown (Auto or any of
the twelve), and the SELECTED hero's five colour pickers. "▶ Play selected hero" plays it. Both pickers are tuner-only
config (`tunerHero`, `tunerStyle`); the game never reads them. `playGateDemo(mode, hero, style)` takes the preview.

**Perf.** Every part is static paint; only transform / opacity move, in one-shot WAAPI clamped inside eruption + title
hold. No layout reads (every part is sized in % of the medallion). Measured on the dev server in headless Chrome
(Guardian, the heaviest: 77 gate animations): one gate `getBoundingClientRect` (`hpBox`, at the trigger), no infinite
animations, animated properties opacity / transform plus the existing clip-path bloom and omen stroke-dashoffset.
Warm runs: max frame 12 to 13 ms (default hero 8 ms). The first awakening in a fresh browser has one 37 to 42 ms frame
at the eruption for every hero, the default included, so it is warm-up, not the styles. The glyphs' drop-shadow was
dropped anyway to keep the heaviest style lean.

**Tests.** `ancientHeroThemes.test.ts`: every hero in `HEROES` resolves to a theme with a valid style, labels match
display names, every style is used, the approved four's signatures and markup are pinned, and `playHeroBloom` runs
every hero AND every style previewed on every hero through a fake DOM built from the markup: one shot each, transform /
opacity keyframes only, and everything done before the title hold ends. `ancientsConfig.test.ts` pins the four
approved themes in the new shape.

Judgement calls to check: Gildmaster's "splits into a pair" is H (two gold copies part and merge) plus a sheen;
Cassen's "a seal ticks" is the plain dial; the card fan's cards peek above the medallion rather than circle it.
