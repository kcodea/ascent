# 2026-09-24: Repeat runes cast as the rune, and the rune cast flourish

Owner ask, verbatim:

> yeah the runes that repeat casts should use the rune-cast visual. can we do anything to add a bit of flair to
> this? like some sort of short flash/pixi effect/make it smoother and cleaner with a bit of a 'magic' element to
> it? nothing crazy. spin up a concept and open a server on the branch for me to play with.

Follows #1676 (`2026-09-24-growth-effect.md`), which gave rune casts the spell's own effect from the rune's node but
left the runes that repeat the PLAYER's cast on the player's path.

## Repeat runes are rune casts now (sim)

- `runeExtraCasts(state, def, card)` (recruit.ts) splits `spellCasts` back into the player's share and each repeat
  rune's, in order: Rune of Hoardflame / Dragon Breath (`runeSpellDouble`), the Bottomless Cask (its share of
  `aleExtraCasts`, one per copy; the rest is the Bottomless Cellar quest's), Shared Pour, and the Astral Draft's
  stamped `extraCasts`. Attribution is sequential (each rune's share is what turning it on adds), so the shares
  sum to the extras even under another multiplier. `spellCasts` itself is unchanged (it is `spellCastsWithout`
  with nothing excluded).
- `castWithRuneRepeats(casts, extras, one)` runs the player's casts first, then each rune's share under
  `withCastActor({ kind: 'rune', id })`. Used at the reducer's spell cast sites (board target, Shop offer,
  untargeted) and the Choose One spell resolver. Gameplay is identical: same count, same order, same targets.
- Distillation's echo onto your edges and Shared Reflection's spread onto adjacent Dragons run under their rune as
  the cast actor. Their SPELL echoes no longer record a `bounceFx` hop: the rune is the source, and a hop plus a
  trail from the rune would be two travels into one body. A RUBY echoed by Distillation / Redirection keeps its hop
  (Rubies speak the Ruby language). `bounceFx.test.ts` was updated for this.
- `recordActorCast` emits its `spellResolved` consequence only inside a trigger scope. The player's play opens none,
  so a repeat rune's cast there would have been an orphan consequence (caught by the Doc Bot beat-conservation
  test); the per-action `castFx` record is the whole signal in that case, and the Shop watcher plays it.
- Not switched: a MINION's multiplied cast (Mage-Pup's loops multiply by `spellCasts`; the extras stay the minion's),
  a Discover spell's extra Discovers (no cast visual to route), and Ruby echoes.

## UI: the player keeps the player's visuals

- `ownCastCount` (Recruit.tsx): the release-point burst repeats only for the player's own resolutions (the ×N badge
  still shows the whole count).
- The Ale volley's claim filter skips `sourceRuneId` buffs, so a Shared Pour Ale on the same minions still plays its
  own rune volley from the node.

## The rune cast flourish

`fx/runeCastFlourish.ts`, fired ONCE per rune cast in every phase, bound spell or not:

| Layer | What | Where | Timing (defaults) |
|---|---|---|---|
| Badge pulse | Web Animations `transform: scale` swell, one-shot | the rune's `.runebadge` | peak +14% at 30%, 360 ms |
| `rune-cast-flourish` def | glyph flash (4 soft circles), sigil ring (shockwave r 62), 10 diamond sparks off a ring | the node | 0-560 ms |
| `rune-cast-mote` def | thin comet ribbon + dust emitter along a gentle bow, arrival sparkle + ring | node to where the spell's single effect lands | 280 ms flight, arrival at 270 |

- A spell whose own effect plays once (Growth) gets the mote, and the effect waits for it (`moteMs`).
- A spell whose visuals already travel from the node (a stock trail, an Ale volley, Dragonflame) gets no mote; its
  trails leave `leadMs` (110) after the flash (`playRuneCastBuffFx`).
- Two casts by one rune in one moment (Recurrence's "twice") are staggered by `repeatMs` (110, under the 120 ms
  sound gap, so a doubled bound spell still rings once).
- Entry points: `playRecordedCastFx` (Shop and legacy End of Turn records), the `spellCast` presenter (authoritative
  End of Turn), `playCombatSpellCastFx` (combat `sc.rune`, player side). One helper, `playRuneSpellCastFx`.
- Off (`runeFlourishOn` = 0) is exactly the #1676 look: nothing extra plays and nothing is delayed.

Palette is the rune badge's cool arcane blue (`#1f3a8a` / `#4f7dff` / `#a6ccff` / white), additive.

### Tuner

Cast Preview tuner (dev menu, Buffs & Auras, Cast Preview), group "Rune cast flourish": Flourish on/off, Badge
pulse, Badge pulse length, Glyph flash size, Mote travel, Mote size, Trail release delay, Repeat-cast gap.
"▶ Preview test" now also fires a flourish from the first rune on the rail (mote to the viewport centre);
"▶ Flourish only" fires just that. With no rune on screen it plays at a stand-in spot beside the panel.

## Performance

Measured on the dev build (port 5285, 240 Hz display): the perf HUD attributes 0.1 ms per frame to
"Rune Cast Flourish fx/frame", worst call 0.3 ms; the `fx:tick` span (whole FX runtime, flourish + mote live) peaked
at 0.2 ms, avg 0.12 ms. Five flourish + mote pairs 250 ms apart left rAF deltas unchanged (avg 4.25 ms, p95 4.3 ms,
worst 8.4 ms, same as idle). No looping paint: the badge pulse is transform-only and one-shot; one node measure
per cast, none per frame.

## Tests

- `packages/sim/src/runeRepeatCastActor.test.ts`: the split (Shared Pour, Hoardflame under Ancient Runes, the Cask
  vs the Cellar quest), and each repeat rune records the rune as actor with tagged buffs while the player's cast
  records nothing (Shared Pour, Astral Draft, Hoardflame, Distillation, Shared Reflection); Shared Pour's board
  matches a plain Nimbus "casts twice".
- `packages/ui/src/fx/runeCastFlourish.test.ts`: layers, knobs, off, once per rune cast in Shop / End of Turn /
  combat, Growth waits for the mote, trails wait for the lead.
- `packages/ui/src/castPreviewConfig.test.ts`: the knobs round-trip (write, clamp, persist, reload, reset).

## Oracle

R-PHASE-01 (foundation) amended with the owner quote: repeat runes are rune casts; every rune cast flourishes.

## Open for the owner

- The concept values are untuned; the Mote is deliberately thin. Tune in the panel, then bake with Copy values.
- Distillation / Shared Reflection's spell hop (offer or Mirrorwing to the edge) is replaced by the rune's travel.
  Say if you want the hop back alongside it.
- A minion's multiplied cast (a Mage-Pup casting Hoardflame with Rune of Hoardflame) keeps its extras on the minion.
