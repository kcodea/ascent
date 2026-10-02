# 2026-10-02 - Tooltips wear the Gem plate + one UI Theme for tooltips and HUD pills (6 themes)

Owner ask: "style of all the pills and everything looks great - wondering if we should be more uniform with the
tooltips now as well, like sync up the color schemes. can you make the tooltips match our hud pill designs now, and
then add 6 different color themes in the tuner for me to try out to see what looks best. this should control all of
them at once"

Builds on the Gem plate HUD pills (#1919).

## What changed

- **`packages/ui/src/uiTheme.css`** (new, imported by `Game.tsx` before `tooltips.css`): ONE set of colour tokens,
  `--ui-*` on `:root` (plate gradient stops, filigree edge stops, inner ring, text / muted / title / highlight,
  chip bg / edge / text, divider, icon tint, heart, steel armor, the turn clock's rim and face, the low-time warning
  colours, the button hover plate + edge, Skip's press lip, the stud outline) plus composites (`--ui-plate`,
  `--ui-edge`, `--ui-hover-plate`, `--ui-hover-edge`, `--ui-stud`, `--ui-armor`). This block is the baked theme
  production plays (Gem Gold).
- **Tooltips** (`tooltips.css`): the `--atip-*` colour tokens are now aliases of `--ui-*`, and the panel paints the
  plate gradient inside the metallic filigree edge (a gradient under transparent borders, so every border keeps its
  old width: 1px sides, 2px top). Inner ring + top sheen like the pills. Sizes untouched (the owner's baked
  `--atip-*` size dials are unchanged).
- **HUD pills** (`healthPills.css`, the Gem rules): every colour reads the tokens: Health + the cut-gem heart, the
  steel Armor chip, the filigree studs, name pills, Tier / Freeze labels, the turn timer and its gold clock (the
  clock's SVG colours are now overridden from CSS, low-time tints included), Skip / Summary / End Combat with their
  hover plate and Skip's press lip.
- **🎨 UI Theme tuner** (DEV): one dropdown, six themes (Gem Gold, Royal Sapphire, Obsidian Ember, Amethyst, Verdant,
  Frost Silver), applied live by writing the `--ui-*` properties inline on `:root` (no React re-render). A pinned
  sample shows a tooltip, a name pill, a Health + Armor pill and a button together. DEV localStorage
  (`ascent.uiTheme`), Reset, and "Copy values" gives the bake-ready `:root` block. Registered in `tunerAll.ts`.
- **Replaced the old "UI Theme" tuner** (#938, 2026-08: ten glass presets over the `--gl-*` vars, reaching the
  account panel and the HUD plaques). Its module and panel are rewritten under the same name and panel id; its
  storage key `ascent.uitheme` is cleared at load. The `--gl-*` vars had no remaining writer, so every
  `var(--gl-x, fallback)` in `styles.css` was inlined to its fallback, which is exactly what production already
  rendered (the old module only ever ran from the DEV menu). Nothing reads `--gl-*` any more.

## Guard (`tooltipStyle.test.ts`, extended)

- `tooltips.css` and every `[data-hp-look="gem"]` rule in `healthPills.css` may carry no literal colour, only the
  tokens. Allowed: pure black / white shading (`rgba(0,0,0,a)`, `rgba(255,255,255,a)`, `#fff`), and the state
  colours listed in `GEM_COLOUR_EXCEPTIONS` (`tooltipRegistry.ts`): the cream Tier plaque on the opponent's Shop
  Tier number, the locked / coming-soon grey and cleared green Gauntlet / mode tags, the Rift mode's tier colour.
  The Classic / Slate / Minimal looks behind the HUD pills switch are alternatives and are not themed.
- uiTheme.css's `:root` block must equal `UI_THEMES[DEFAULT_THEME]` token for token.
- Every theme must keep text readable on all three plate stops (WCAG): body and title >= 7, highlight / muted /
  warning >= 4.5, chip text >= 7, armor number >= 4.5. Worst-case ratios per theme:

  | Theme | body | title | highlight | muted | warn | chip | armor |
  |---|---|---|---|---|---|---|---|
  | Gem Gold | 11.7 | 9.7 | 7.5 | 7.0 | 6.7 | 16.1 | 8.6 |
  | Royal Sapphire | 10.1 | 8.3 | 7.5 | 5.8 | 6.0 | 16.3 | 8.6 |
  | Obsidian Ember | 12.8 | 8.5 | 6.7 | 6.5 | 7.3 | 16.4 | 8.6 |
  | Amethyst | 10.1 | 7.6 | 6.1 | 6.1 | 6.0 | 16.0 | 8.6 |
  | Verdant | 9.8 | 8.0 | 7.8 | 5.8 | 5.6 | 16.1 | 8.6 |
  | Frost Silver | 8.8 | 7.8 | 6.1 | 4.7 | 5.0 | 16.5 | 9.7 |

## Verification

- Rects (1920x1080, Playwright): your Health pill, the timer, the Tier and Freeze labels, the Gold pill, the
  hero-select name and Health pills, and five open tooltips (hero power, Tier, Freeze, Gold, Refresh) are
  byte-identical before (the #1919 head) and after, and identical across all six themes.
- Performance: static paint only; nothing animates; a theme switch is ~40 custom property writes on `:root`.

## To bake the owner's pick

Set `DEFAULT_THEME` in `uiThemeConfig.ts`, paste the tuner's "Copy values" block over the token block in
uiTheme.css; the parity test confirms the pair.
