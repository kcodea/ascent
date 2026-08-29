### feat(ui): Runeforge Look tuner + a day of owner default bakes

**🛠 Runeforge Look** (`runeforgeLookConfig.ts` + `RuneforgeLookTuner.tsx`, sibling of the Backdrop tuner):
~30 knobs covering every element of the forge overlay — banner plaque (x/y/scale/colors/title size), gold
pill, cards row (name/kicker/text-box colors + sizes, cost coin, art medallion), footer buttons, the
minimize toggle — with EPIC color twins where `.forge-epic` already recolors, and shared geometry between
variants. Defaults extracted from the shipped CSS so an untouched tuner is pixel-identical; every var has a
styles.css fallback mirroring DEFAULTS (prod paints with no JS). The forge shares `.disc-*` classes with
Discover — all overrides are scoped through `.forge-*` compounds, and the shared `translateX(-50%)`
centering on `.disc-banner`/`.disc-toggle` is re-stated (not clobbered) in the scoped rules. Two derived
gradients ship as `shade()`-computed defaults, and the kicker color is now two flat knobs (basic/epic)
whose defaults equal the old `color-mix` formula's output — it no longer auto-follows the card accent.

**Banner font**: RUNEFORGE / EPIC RUNEFORGE wears the title font (`var(--title-font)` — Cinzel Decorative
600), same mechanism as the curtain announcements; the curtain's foe NAME went back to the UI face (owner
call — only announcement labels wear the display font).

**Foe rune nudges**: the ⚔️ Hero Duel tuner gained per-slot Rune 1/2/3 X+Y, applied via the independent
`translate` property so the badges' transform-based trigger bounce composes with the nudge instead of
stomping it.

**Owner bakes** (defaults + CSS fallback mirrors, all design-unit pinned): gold pill 1.69× @ 408/423; duel
panel portrait X 208, name plate 0.65×/+23, rune row −148/−19.
