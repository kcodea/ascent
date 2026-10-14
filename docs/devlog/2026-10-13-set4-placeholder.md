# 2026-10-13: Set 4 placeholder, the Whisper mechanic, the self-damage Beasts

Owner handoff 2026-10-13. Set 4 is a DISABLED scaffold (like Set 3 was started): selectable in the Scene Builder's set
picker, never the active set. No patch note (the set is not live).

## Art

Owner 2026-10-13: "art for set 4 minions here: C:\Game Assets\Ascent Art\Set 4 Minions". `wire-art.ts` gained a
`set-4 minions` job (dirs `Beasts`, `Dragons`; the `nothing` folder is not a dir) and `npm run art:wire -- --only="set-4
minions" --apply` wired the eight name-matched masters (512 px webp, the standard pipeline). Reported, not wired:
`Dragons/Dahknis.png` (no card by that name) and `Beasts/0dee7ea6-....png` (unattributed). The two Whispers (Tome,
Runebind) have no art yet and stay in the art-pending list.

## Set 4

- `packages/content/src/cards/set4/` (`index.ts`, `dragons.ts`, `beasts.ts`, `whispers.ts`), registered as
  `SETS.set4` (`enabled: false`, tribes `['dragon', 'beast']`, `own` = the eight minions in declaration order).
- `SetId` grew `'set4'`; the rune/quest `sets` unions and the schema enums grew with it (nothing is gated to set 4 yet).
- The two Whispers (`w4_tome`, `w4_runebind`) are Gift-class granted spells: in `ALL_CARDS` (appended last), in no set.
- Pinned by `packages/sim/src/set4.test.ts` (roster order, stats, disabled, never the active set).

## The Whisper mechanic (R-WHISPER-01, R-WHISPER-02)

- `CardDef.whisper` marks a Whisper (with `gift: true` + `giftMulticast`). A granter carries
  `{ on: 'startOfTurn', do: 'grantWhisper', params: { cardId } }`: the shared Start-of-Turn dispatcher hands a fresh
  copy over each turn (its own SoT beat), and the reducer's minion play reads the same marker to grant one the moment
  the minion is played from hand (`grantWhispersOnPlay`). A Gilded granter's copy carries `whisperMult: 2`.
- End of Turn: `vanishWhispers` removes every uncast Whisper right after the End-of-Turn triggers (before Re-Pete).
- Cast: a dedicated reducer branch casts through `castSpell` once per cast (`giftCastCount`, so Yazzus repeats it),
  under `withWhisperMult`. Each cast counts as a spell cast (`noteSpellCast`, the Gift rules: never copy food), reaches
  the target's `spellCastOnThis` reactors (Tamby) and Whisp's echo. Spellhide never banks a Whisper.
- Value (`whisperValue`, the one formula the cast and every text read): printed +A/+H, plus one printed step per
  `perSpells` spells cast this game (Tome; `spellsCast + rubyCasts`, retroactive), plus the run-wide
  `whisperImprove[id]` (Runebind: +2/+2 per cast x the cast's multiplier, every copy). Read-then-improve.
- Temporary stats: `applyWhisperBuff` is a normal Shop buff ALSO recorded on `BoardCard.whisperBuffs`;
  `expireWhisperBuffs` strips stats + the ledger share at the next turn flip, before anything reads the board
  (Attack >= 0, Health >= 1). A triple merges the kept copies' marks. `keepWhisperBuffs` is the seam for a future
  "keeps Whisper stats" card.
- Tamby (`whisperCastOnThisCopy`, per-instance `whisperCopiedThisTurn` latch) and Whisp (`whisperEchoOnDragon`, a
  passive marker read in `castSpell`, guarded by `WHISP_ECHOING`).

## The self-damage Beasts (R-WOUND-01)

- Arena bodies (one implementation, both phases): `shoutWoundSelfMendTribe` (Hawg), `deathrattleWoundMendTribe`
  (Eatah), `onTribeDamagedBuffSelf` (Apua), `onTribeDamagedBuffRandomTribe` (Alan).
- New arena verbs: `woundAll(t, damage, health)` (combat: `damageDeferred` under `withWound`, `buff`, deferred
  death check; Shop: Health loss, `fireShopDamaged`, permanent Health buff + the hit's FX record) and `tick(fn)`
  (combat: `ctx.wave`; Shop: a fresh hit wave + mend wave on the buff-FX records), so repeats land one after another.
- `fireShopDamaged` is the Shop twin of combat's `onDamaged` emit, now also called by the Shop `damageAll`
  (Blaster) and `shopSprayExceptTribe` (Fel Spikes, Gasket). Only effects with a Shop body answer, so nothing older
  moved (Gryphon / Target Dummy stay combat-only).
- Combat watchers ignore a body at 0 Health unless a wound is resolving (`woundActive`), so a 1-Health Beast answers
  its own self-hit but a lethal attack is not undone by Apua's own gain.

## FX

- `fx/defs/beast-damage-dealt.json` and `beast-self-damage.json`: the owner's Workbench export
  (`set4-beast-damage-fx.json`), values verbatim, omitted filter blocks filled with Workbench defaults through
  `coerceDef`. The two clips they name (`audio/fx/splatty-impact.wav`, `whoosh-03.mp3`) were imported through the
  Workbench in the primary checkout and were not in git; copied in unchanged.
- `bindings.json`: `b4_hawg.damage` = `beast-self-damage`; `b4_eatah.damage` = `beast-damage-dealt`, `fanOut:
  'struck'`, `launchOnDeath` (Fel Spikes' delivery). In the Shop, a hit is a `BuffFxEvent` with `damage` set;
  `Recruit.tsx` plays the dealer's bound `damage` def for it on its wave. Buffs use the stock tendrils.

## UI

- A Whisper in hand wears `whispercard` (static `opacity: 0.84`) and the word "Whisper" above it with "Fades at End of
  Turn" (the On Loan marker's box and type, static paint, nothing loops). Its kind line reads "Whisper" (Gift medallion).
- Live text: the Whisper in hand (`whisperLiveText`, x its multiplier, countdown), Galas / Tolan (`whisperGranterText`)
  on the shop / board / hand / Discover chain and in combat (`Unit.tsx`, player side), and the hover preview.
- Glossary pill "Whisper" + two Rules wiki entries.

## Judgement calls (flagged for the owner)

1. Whisper targets: "a friendly minion" (the owner wrote "a minion"; a temporary grant needs a real body to expire
   from, and a Shop offer cannot carry the mark).
2. "Spells cast this game" for Tome = every spell of every kind (`spellsCast + rubyCasts`, Vaultkeeper's umbrella).
3. A Whisper takes no spell power (the Gift rule).
4. Gilded: Galas's Tome x2 value; Tolan x2 value AND improve; Tamby 2 copies; Whisp casts twice; Hawg and Eatah repeat
   the whole effect (two ticks, so the watchers answer twice); Apua +2/+2; Alan +2/+4.
5. Alan's text reads "another friendly Beast" (R-TARGET-03: no card picks itself).
6. Whisper token text adds "until your next turn" so the card says its stats are temporary.
7. Whisp's echo cast and each Yazzus repeat count as spell casts (the Mirrorwing "full re-cast" ruling).
8. Gangplank-style "a card was added to your hand" watchers hear every Whisper grant (it is a card arriving).
9. Shop self-damage ignores Ward (matching the existing Shop `damageAll`); combat Ward absorbs it.
10. Set 4 holds no Shop spells and no neutrals yet, so its Scene Builder shop is the eight minions only.

## Verification

`npm run typecheck`, `lint`, `test`, `build:web`; `beats:audit` (every new key classified); live in the Scene
Builder on port 5194 (Set 4 picked, Galas played: Tome in hand with the Whisper look, cast on Galas: 4/2; End Turn:
Tome vanished, the fight, back in the Shop: Galas 3/1 again and a fresh Tome from Galas's Start-of-Turn beat; Hawg
played beside Apua and Alan: the hit record on its wave, Alan's reaction on the hit, the Health on the mend wave).

## Owner review round (2026-10-13, same PR)

- **Whisper cards**: the plain SPELL medallion and colour (was the Gift crystal); the kind line still reads
  "Whisper". The "Whisper / Fades at End of Turn" label above the card is gone.
- **Whisper art**: `Whispers/Tome.png` and `Whispers/Runebind.png` wired through a new `whispers` job in `wire-art.ts`
  (spells folder, 512 px webp; the masters carry no alpha).
- **Ethereal treatment** (static + one-shot only): the card at 0.88 opacity, the art drained cold and pale (a static
  filter on the art image), a static moonlight wash over the art (`.art::after`, screen-blended gradient) with a cool
  rim of light, and ONE shimmer band across the art on arrival (`whispershimmer`, transform + opacity, runs once).
- **Live green readable**: Galas / Tolan now print "**Whisper:** Give a friendly minion +X/+X ..." (the owner's
  wording; the Whisper's name shows on the hover preview), and the live value is the plain green `{{…}}` marker,
  never nested in bold (a bold span wears the keyword glow, which washed the green out). The Whisper look is only on
  Whisper cards (`whispercard` keys off the def), never on minion text.
- **Self-damage beats** (owner: "the hits should go out first on its own beat, then the buffs following the hits should
  roll out after"): the arena verb is now `woundAll(targets, damage, health, alsoMend?)`. Combat: one wave for every hit
  (`damageDeferred`, the `onDamaged` emits HELD by the new `CombatContext.woundHits`), then each held reaction (Apua,
  Alan) on its own wave, then each body's +Health on its own wave, then Hawg's Health for the others, then the deferred
  death checks. The Shop mirrors it as buff-FX waves (hit, reaction per hit, Health per body). In the Shop the hit
  record withholds the damage on the target's Health badge (`holdStat`, cue origin) and rolls it back up on the
  schedule of that target's own +Health, so the number visibly drops, holds, then rises. Pinned by the two
  "R-WOUND-01 beat order" tests in `set4.test.ts`. Mirrors the per-fire tick approach of #2074 without importing it.

## Whisper colour identity (owner 2026-10-14: "can we make them even more distinct?")

Directions chosen by the owner: own colour identity + keep in hand (no new frame art, no float, no particles, no
tray). The whole Whisper card shifts to one spectral hue through STATIC layers: the painted spell frame (through the
frame's own `--frame-tone` hook, so its drop shadow and shadow copy are untouched) and the hand plate are re-tinted,
the Spell medallion is tinted to match, the name and the kind line take the hue's light ink, and a rim of the hue
glows on the frame and plate. The moonlight wash and the one arrival shimmer are kept in the hue; the card-wide
translucency was dropped (it muddied the colour and the text). The tint is `sepia(1)` then `hue-rotate` from sepia's
hue to the target, so one number re-colours art painted in any colour.

ONE switch: `:root { --whisper-hue: 178; }` in `styles.css` (178 spectral teal, the live default; 272 ghost violet;
140 pale spirit-green). Static only; the arrival shimmer is the only animation (transform + opacity, once).

## Whisper art at full colour + hover ripple; Set 3 neutral spells in Set 4 (owner 2026-10-14)

- **Art unfaded**: the Whisper art window shows Tome / Runebind at full colour (the pale drain and the moonlight
  wash are gone). The teal identity stays on the frame, plate, crystal, name, kind line and edge glow.
- **Hover ripple**: on mouse ENTER a Whisper card's art plays one spectral ripple, two rings of the Whisper hue
  scaling from the centre and fading over 0.7 s (transform + opacity only, static gradient paint). `whisperRipple`
  in `Card.tsx` adds the `wripple` class and removes it on `animationend`; it will not restart while running or
  within 400 ms of the last start. No layout read, no timer, nothing runs unless a Whisper is hovered. Measured
  (dev build, forced style resolve included): one hover-enter costs 0.8 ms p50 / 1.3 ms max on the main thread
  (a plain spell card: 0.1 / 0.2 ms), well inside the 6.25 ms frame.
- **Spells for comparison**: Set 4 now draws Set 3's generic neutral Shop spells by reference
  (`SET4_SHARED_SPELL_IDS` in `sets.ts`, same defs, Set 3 unchanged), 44 spells, appended after the minions. Left out:
  the Dwarven Ales (`wo_*`, Rush Order, On the House), the Ruby / Kobold spells (Ruby Shipment, Facetwright,
  Veinstorm, Ruby Transfer), the Undead pair (Lantern of Souls, Undead Army), the Celestial / Starform spells (Star
  Crash, Accretion) and the Spirit spell (Crescendo). The Scene Builder reads "Set 4 · 8 minions · 44 spells".

## Aligned with #2074's reaction ticks (2026-10-14)

After #2074 merged, the combat self-damage step puts the hits AND their held reactions in ONE wave (hits first), so
the replay's hit-reaction split (`hitReactionStart` / `reactionTicks`) gives the hits their own beat and plays each
reaction fire as its own tick on the shared stride (`REACTION_TICK_MS` 160 ms, chain capped at 1.6 s). Apua and Alan
are `ownBeat` reactions for that split. The +Health is one later wave. In the Shop, a self-damage action paces its
waves on `reactionTickStrideMs`. Pinned by `packages/ui/src/choreo/set4WoundBeats.test.ts`.

## Eatah in combat: no row reflow, clean beat order (owner 2026-10-14, R-RISE-ROW-01)

Owner: "eatah is doing really janky stuff in combat ... it janks the board around when it rises". Reproduced with
Hawg | Eatah | Apua | Alan against a sandbag (`packages/ui/src/choreographer/eatahRiseRow.test.ts`). The beat schedule
was already in the right ENGINE order (death, Echo hits, reactions, +Health, Rise; R-WOUND-01 and "Echo first, then the
Rise"). The jank was the ROW: the replay keeps a dead body only on beats where it is still dealing damage, so after the
Rise death the dead Eatah left the row on the clash-reaction beat (Apua / Alan answering the lethal hit), came back as a
ghost for its Echo hits and their reaction ticks, left again on the +Health beat, and reappeared on the Rise: the
survivors slid left and right three times. Fix (presentation only): `computeFrame` holds a ghost in the slot of any
body whose Rise death has a `reborn` LATER in the log, from that death until the return; a Rise that finds no room holds
nothing. Beat order now reads: death, the clash reactions, Echo hits, reaction ticks (the #2074 stride), +Health
(twice each, Gilded), Rise, and every frame in between keeps Hawg | (Eatah) | Apua | Alan. The row test fails on the old
code (the row closed at the first beat after the death).

## Whisper painted plate replaces the hue tint (owner 2026-10-14: "use this as the whisper frame instead")

The owner's painted blue-violet frame (`C:\Game Assets\Ascent Art\whisperFrame.png`, 951x1478 RGBA) is a hand PLATE:
its aspect (0.643) and body geometry match `cardplate*.webp` (800x1244), confirmed with a 50% overlay against
`cardplate-neutral.webp` (rims, side clasps, inner window and bottom gem coincide). Shipped as
`apps/web/public/frames/cardplate-whisper.webp` (494x768, alpha kept, webp q88), and `Card.tsx` picks it as the plate
src (`WHISPER_PLATE_SRC`) for any Whisper card. The Whisper look is now read off the DEF (`whisperLook = whisperKey ||
def.whisper`), so the Compendium, Scene Builder and cast previews wear it too, not only a hand instance.

Removed: the whole CSS hue tint (`--wh-filter` sepia + hue-rotate on the plate, the arch frame via `--frame-tone`, and
the Spell medallion, plus the rim drop-shadows). The arch frame and the Spell crystal now render exactly as on a Shop
spell. Kept: full-colour art, the one arrival shimmer and the one-shot hover ripple. The accents (name ink, the
"Whisper" kind line, the art rim, shimmer, ripple) moved from teal 178 to blue-violet `--whisper-hue: 250`, so they
sit with the painted plate instead of clashing with it.
