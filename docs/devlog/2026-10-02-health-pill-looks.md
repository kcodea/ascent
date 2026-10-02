# 2026-10-02: Health + Shop Tier pills: three new looks behind a DEV switch

Owner ask: "can you fix these pills for me? they are very outdated and ugly." (the dark brown, thick dull-gold
health pill under a hero portrait, and the Shop Tier pill added in #1915).

## What changed

- **One switch, every pill.** `healthPillConfig.ts` stamps `data-hp-look` on `<html>`; `healthPills.css` paints
  each look off it. Covered: your own Health (`.statusbar .hero .hpbox`), the opponent's Health + Armor
  (`.combatopp-hp`, `.combatopp-armor`) and Shop Tier (`.combatopp-tier`) in combat, and the Gauntlet foe's round /
  loss-cap pills (`.gauntletfoe-meta`, `.gauntletfoe-cap`), which wear the same pill. The lobby rail rows, match
  details and the legacy `.oppframe` were left alone.
- **Looks.** `classic` (the old pill, kept for before/after), `slate` (A: Aegis tooltip family, slate glass, light
  hairline with a gold top edge, white numbers, blue shield chip), `gem` (B: amethyst plate with a thin gold
  gradient edge and gold end studs, cut-gem heart, steel armor chip, Shop Tier number in the cream/gold Tier
  plaque), `minimal` (C: borderless, opaque soft gradient, bigger white numbers, armor after a hairline divider).
- **DEV tuner.** Dev menu > "Health pills" (one select). DEV persists the pick in `localStorage['ascent.hpPillLook']`;
  production always uses `DEFAULTS.look` (provisionally `slate` until the owner picks; bake by editing it, then the
  unchosen looks can be deleted from the CSS).
- **Markup.** New icons `heartPill` (the heart + a facet and a gloss layer each look can show or hide) and `armor`
  (a solid two-tone shield). The armor spans now carry the shield and a `.hp-armplus` "+" (Classic shows the "+",
  the new looks show the shield). The Shop Tier label is wrapped in `.combatopp-tier-l`. Text content is unchanged
  ("+15", "Shop Tier 1"), so the existing tests hold. Props stay primitive; nothing new re-renders.

## Proof it moves nothing

Each look keeps every pill's old box HEIGHT (the opponent's Health pill sits in a centred column, so a taller pill
would shift the portrait): the 1px-border looks hand the lost 1px back to the padding, and Minimal's bigger numbers
keep the old line box (font up, line-height down). Rects at 1920x1080 and 1366x768, Classic vs each look: the
opponent portrait, name, and both Health pills keep identical y/height; your portrait and hero power box are
identical. The pills themselves are wider (the shield chip), and they stay centred on the same x. One side effect:
the invisible `.combatopp` wrapper box widens with the Health pill (its centre does not move), exactly as it
already did whenever armor appeared or vanished. Runes, rune slots and the Buffs panel anchor to its centre.

## Performance

Static paint only: no animation, no `filter`, no `backdrop-filter`. The existing one-shot hit-shake is untouched.
