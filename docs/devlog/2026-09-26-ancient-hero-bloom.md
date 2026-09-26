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

## Follow-up: signatures for every Ancient hero (Indy, the Warden, the Auctioneer, Lord of the Risen)

Owner: "i want to do the bespoke animation + hero power symbol animation for the ancient hero blooms. go ahead and
expand 1751 to all heroes with ancient synergy now". After a first pass the owner reviewed it live: "wardens needs
work. indys is terrible. auctioneer and lord are great". Indy was redone from scratch and the Warden reworked. Then:
"can you make the risen ribbons look thinner and less like ovals? i want them to be more like an aura ... try and
re-use the rise style animation", so Risen now wears the in-game Rise aura. The Auctioneer is unchanged from the
approved pass.

**Data.** Each themed hero's entry in `ancientHeroThemes.ts` now carries a `label` (for the tuner), an `accent` (one
signature flourish round the medallion) and a `medal` (the medallion's own entrance). `resolveAncientHeroSignature`
returns them, or `null` for the default, which keeps the generic scale/fade entrance and no accent. The motion for
each kind lives in the new `ancientHeroBloom.ts` (`playHeroBloom`), and the static paint for its layers lives in
`ancients.css`. To add a hero, give it one entry (colours + label + accent + medal) and add its id to `THEMED_HEROES`.

| Hero | Colours (centre / edge / seam / title glow / backdrop) | Accent | Medallion |
| --- | --- | --- | --- |
| Indy (`indy`) | `#a0620f` / `#0d0501` / `#fff3cf` / `#ffcf66` / `#0f0803`: rich amber gold | `glints`: five sharp four-point gold glints on the rim, fired in turn as the sheen passes | `gild`: settles, then STRUCK GOLD: one crisp diagonal gold sheen across the art and a thin gold rim that flashes |
| The Warden (`warden`) | `#4a87bb` / `#050d1c` / `#eaf8ff` / `#9fe0ff` / `#050b14`: clear ice / steel blue | `shell`: the in-game WARD GLASS (fill, sheen, white-hot rim, honeycomb, the `styles.css` values) forms round the medallion, one crisp shine crosses the glass, then it rests | `seal`: snaps in (a touch large, a small snap-back) as the shell seals |
| The Auctioneer (`myra`) | `#7b2887` / `#12031a` / `#ffe6a3` / `#ffc95c` / `#0d0512`: royal purple with a gold title glow | `rings`: three gavel-strike shock rings pulse out from the impact, like a Shout | `thump`: comes down from above, squashes, rebounds, settles, with a gold strike ring off the rim |
| Lord of the Risen (`risen`) | `#5d8f7b` / `#030a08` / `#eafff5` / `#b9ffe2` / `#060c0a`: pale ghostly jade (greyer and greener than the default teal) | `wisps`: the in-game Rise aura's thin wisps (the card's `rebornwisp` motion), fourteen soft pre-blurred streaks rising off the rim behind the medallion | `rise`: rises up from below while the Rise DOME (the card's `.reborn-dome` ring) gathers round its rim in one breath, then rests under the title |

**Rules held.** Every part is a static-painted layer, and only its transform and opacity animate, in one-shot WAAPI.
Nothing loops. The Warden's shine is an `::after` animated through WAAPI's `pseudoElement`. Every accent part is a
box the size of the medallion with its mark drawn at the centre, so the motion's `translate(%)` scales with the
medallion and there is no layout read. Every animation is clamped to finish inside eruption + title hold, so the
cinematic is no longer. A unit test fakes the wrapper and checks each hero's animation count, `iterations: 1`, and
`delay + duration <= eruptionMs + titleHoldMs`.

**Tuner.** The ✦ Ancients tuner now has theme groups for Indy, The Warden, The Auctioneer and Lord of the Risen,
each with five colour pickers, plus "▶ Play as …" buttons for each of the four and "▶ Play as default".

**Measured.** Headless Chrome on the dev server, one real-speed awakening per hero (Indy, Warden, Auctioneer, Risen
and a default hero). Each run made one gate `getBoundingClientRect` call (`hpBox`, at the trigger). No gate
animation had infinite iterations. The animated properties were clip-path (the curtain's sanctioned one-shot),
opacity, transform and stroke-dashoffset (the omen's one-shot cracks, unchanged). No run had more than two frames
over 20 ms, which matches the default hero's run and headless dev-build noise.
