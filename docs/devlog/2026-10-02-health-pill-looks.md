# 2026-10-02: HUD pills in the Gem plate look (health, names, labels, timer, combat buttons, hero select)

Owner asks, in order: "can you fix these pills for me? they are very outdated and ugly." (the dark brown, thick
dull-gold health pill and the Shop Tier pill from #1915). Three looks were built behind a DEV switch; the owner
picked B: "gem plate looks good". Then: "can you update the name pill and timer a well while we're here? the name
pill's aesthetic should probably also cover the freeze and shop tier pills", the hero-select screen ("the pills
should be fixed/changed here too", including the zoomed pick view), and "fix the skip and summary pills while
we're here".

## What changed

- **One switch.** `healthPillConfig.ts` stamps `data-hp-look` on `<html>`; `healthPills.css` paints every look off
  it. Production ships `gem`. DEV picks it in the dev menu's "HUD pills" panel (persisted in
  `localStorage['ascent.hpPillLook']`): `classic` (the old pills, for before/after), `slate` (A), `gem` (B,
  shipped), `minimal` (C). Slate and Minimal only restyle the health family and can be deleted once nobody needs
  to compare.
- **Shared classes, one source of truth.**
  - `.hudpill-hp`: your Health (`.hpbox`), the opponent's (`.combatopp-hp`), the hero-select card's (`.hchp`, the
    same markup in `HeroSelect` and the `HeroSelectCeremony` clone), the Gauntlet foe's round / loss-cap pills.
  - `.hudpill-arm`: the armor chip (`.armval`, `.combatopp-armor`, `.hcarmor`). It now carries a shield icon and a
    `.hp-armplus` "+"; Classic shows the "+", the new looks show the shield. Text content is unchanged.
  - `.hudpill-name`: your hero name (`.heroname`), the opponent's (`.combatopp-name`, also the Gauntlet foe), the
    hero-select names (`.hcname`), the shop's "Tier N" (`.tvb-tierpill`) and "Freeze" (`.frz-pill`) labels, the
    title-screen account name (`.titlename` and its edit field), the mode cards (`.mcname`), the Career hero name
    (`.cv2-heroname`) and the Gauntlet stage tag (`.gslot-tag`, with its locked / cleared / draft variants).
  - Also restyled by element: the opponent's Shop Tier pill, the turn timer (`.statstrip`), and the combat controls
    (`.combatsummary`, `.combathud-skip`, the End Combat pill `.etbwrap.ready .etb-tip`).
- **Gem plate.** An amethyst gradient plate inside a thin gold gradient edge with an inner hairline; light cream
  text. Health pills add a cut-gem heart (`heartPill` icon, with facet + gloss layers), a steel armor chip, and
  gold end studs; the Shop Tier number sits in the cream-and-gold Tier plaque; the Tier label's words are gold.
  The timer's clock is a new `timerClock` icon (owner: "can you fix the clock in the timer? it looks kinda ugly"): a
  gold rim with a highlight, a dark face, cream ticks and hands. Classic keeps the old glyph (both render, CSS shows
  one). Low time stays a static red tint, and the gold clock warms to red with it. Gem also rounds the lone time
  cell's corners, which the strip's first/last-child corner rules left square (the low-time tint poked out). The combat
  buttons keep their icons (gold), get a brighter plate and edge on hover, and Skip keeps its press lip.
- **Left alone:** the lobby rail rows, match details, the legacy `.oppframe`, and the hero-select difficulty tags
  (they read fine on the new pills). The Combat Controls tuner still owns those buttons' position, size and
  radius; its colour pickers now only apply under Classic. The End Combat label is a tooltip element under #1916's
  shared-tooltip test, so its Gem selector is registered in `tooltipRegistry.ts` `PAINT_EXCEPTIONS` next to the
  existing `.etbwrap.ready .etb-tip` exception.

## Proof it moves nothing

Rects compared Classic vs Gem at 1920x1080 and 1366x768 on the title screen, hero select (grid and mid-ceremony),
the shop with the opponent preview, combat with Skip, and the settled screen with Summary:

- Name pill, Tier and Freeze labels, timer, Skip, Round label, Summary, End Combat pill, hero-select cards and
  every portrait: identical x / y / width / height.
- Health pills (yours, the opponent's, hero select): identical y and height, same centre; wider by the shield chip.
  Each 1px-edge look hands the lost 1px back to the padding; name pills keep their 2px border (now the gradient).
- Opponent Shop Tier pill: height pinned to the Classic pill's, so the Buffs arrow under it does not move.
- The invisible `.combatopp` wrapper widens with the Health pill around the same centre, exactly as it already did
  whenever armor appeared. Runes, rune slots and the Buffs panel anchor to that centre.
- Hero names on the title and hero-select screens differ between runs (random handles / heroes), so their widths
  differ in the raw comparison; their y / height match.

## Performance

Static paint only: no animation, no `filter`, no `backdrop-filter`, no new transitions. The one-shot hit-shake and
the existing fade-ins are untouched. The timer re-renders every second exactly as before (no prop changes).
