# 2026-09-26 — Ancient awakening: per-hero bloom (default + Indy gold)

Owner: "customize every hero's ancient trigger animation slightly... have their color associated and maybe
something else really simple... use the same transition style as the recruit -> combat -> recruit circle setup
with the hero power art in the center of it", then "let's just make a default one for now and also make 1 hero
based on for indy just as a test, who's should be goldish". Confirmed plan: the "An Ancient Awakens" curtain
wears the hero's colours and blooms as a circle out of the hero power, with the power art in the middle. The title
stays, and the two-beat card reveal follows.

**Data.** `packages/ui/src/ancients/ancientHeroThemes.ts` holds a theme table with five colours per hero:
curtain centre, curtain edge, seam ring, title glow and backdrop tint. `default` is the owner-baked teal
(`#247067` / `#0a0618` / `#fff1bd` / `#9effd5` / `#060d0f`), so every hero without an entry looks exactly as it
did. `indy` is gold: `#c08a2c` centre to a `#150a03` umber edge, seam `#fff0c4`, title glow `#ffc85a`, backdrop
`#100a04`. `resolveAncientHeroTheme(heroId, cfg)` picks the hero's entry, or the default for any other hero.
To add a hero, give it one entry and add its id to `THEMED_HEROES`.

**Config + tuner.** The default theme keeps the plain `curtainInner`… keys, so the owner's saved tuner values
still apply. Themed heroes are tuned under `<hero>Theme<Field>` keys (for example `indyThemeCurtainInner`). The
✦ Ancients tuner shows a "Hero theme: Default (every other hero)" group and a "Hero theme: Indy" group, each with
five colour pickers. It also has "▶ Play as Indy" and "▶ Play as default" demos, which play the full awakening
in that theme and with that hero's power art, whatever the run's hero is.

**Gate.** `AncientGate` already bloomed its curtain as the wipe's aspect-stretched ellipse from the hero-power
button. Now:
- The theme feeds the CSS vars.
- A themed hero also recolours the seam ring's fringe (`--anc-front-in/out`) and the wipeFx stardust
  (`heroMotePalette`). An unthemed hero keeps the baked violet/teal fringe and violet/gold/teal motes.
- The hero-power dust burst takes the theme's curtain centre.
- The curtain carries a round medallion (`.anc-gate-medal`) showing the power's art. `hpBox` reads the art from
  the button's `.hpb-art` in the same single read that measures the button when the awakening starts, so
  grant, suit and commission variants carry through. The medallion enters as a one-shot scale/opacity WAAPI
  during the eruption. It is a child of the curtain, so the clip blooms it in.
- The title sits under the medallion in a centred stack. Its font size is capped at `6.4vw` so it never clips
  on a phone.
- The omen, the reveal, the per-Ancient landing dust and the close are unchanged.

**Perf.** Measured in headless Chrome during a real-speed awakening: the gate makes one `getBoundingClientRect`
call (`hpBox`, at the trigger), no gate animation has infinite iterations, and every new motion is
transform/opacity. The curtain's clip-path bloom is the same sanctioned one-shot as before.

Tests: `ancientsConfig.test.ts` pins the default and Indy theme values. The new `ancientHeroThemes.test.ts`
checks that an unknown hero falls back to the default and that Indy resolves to gold.
