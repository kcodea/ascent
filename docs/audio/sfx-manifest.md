# ASCENT — Sound-Effects Manifest

> **Generated file.** The tables below the marker are (re)built by `npm run sfx:manifest` from the real
> card / hero / spell data. **Edit only the `Creative brief` and `Status` columns** — they're preserved
> across regenerations. `Filename` and `Trigger` are authoritative and will be overwritten. Everything
> ABOVE the marker is hand-authored and never touched by the generator.

## How the audio system works

`packages/ui/src/sfx.ts` is a Web-Audio sound bank: named cues, each an mp3 sample with a synth fallback,
routed through a master limiter + mute bus, with per-clip volumes (dev SFX mixer) and dedupe throttles on
combat cues. Samples are globbed from `audio/*.mp3` and `audio/cards/*.mp3` and keyed by path-minus-`.mp3`.

**Layering model.** A generic *bed* always plays for an action (landing, cast, death, summon); the per-card
clip layers on top when present. Every per-card / per-hero clip is **optional** — a missing file is silent,
never an error. So this manifest can be filled in gradually, one sound at a time.

## Naming conventions (the filename *is* the contract)

| Sound | File | Fires when | Wired today? |
|---|---|---|---|
| Minion **play** | `audio/cards/<id>.mp3` | minion played to board (over landing bed) | ✅ yes (`sfx.cardVoice`) |
| Minion **death** | `audio/cards/<id>.death.mp3` | that minion dies in combat | ⚠️ needs hook |
| Card **effect** | `audio/cards/<id>.effect.mp3` | signature effect procs (Battlecry in shop, or Deathrattle / Start-of-Combat / trigger in combat) | ⚠️ needs hook |
| Spell **unique cast** | `audio/cards/<id>.mp3` | spell cast (over default bed) | ✅ yes (spells use `cardVoice`) |
| Spell **default bed** | `audio/castspell.mp3` | any spell cast | ✅ wired on `feat/spellcast-sfx` |
| Hero **select** | `audio/heroes/<id>.mp3` | hero picked in Hero Select | ⚠️ needs hook |
| Hero **power** | `audio/heroes/<id>.power.mp3` | that hero's power activates | ⚠️ needs hook |

Dotted variants (`<id>.death.mp3`) live in `cards/` and already match the `cards/*.mp3` glob — `sampleName()`
strips only the trailing `.mp3`, so the key becomes `cards/<id>.death`. The `heroes/` folder is a new glob.

Status legend: `⬜` to record · `🎙️` recorded (file in tree) · `✅` recorded + wired · `➖` N/A (vanilla card, no effect to proc).

## Wiring plan (the hooks that don't exist yet — built in a follow-up PR)

Each hook is additive and guarded by "clip present?", so it stays silent until you drop the asset.

1. **Spell default bed** — route `sfx.castSpell()` to a real `spellcast` sample (keep the synth fallback).
   *File:* `packages/ui/src/sfx.ts`. Per-spell unique clips already fire via `cardVoice` in `store.ts`.
2. **Minion death (per-card)** — in `playMomentSfx` (`packages/ui/src/choreo/channels/sfx.ts`), on a
   non-Rise `death` event, also play `cards/<cardId>.death.mp3`. The dead unit's uid is `e.target`; map it
   to a cardId via the replay's `cardIds` map (`packages/ui/src/useCombatReplay.ts:391`), which must be
   threaded into the channel.
3. **Card effect (per-card)** — one clip, two proc sites:
   - *Combat:* at the `sfx.triggerPulse()` sites (`useCombatReplay.ts:572,752`), also fire
     `cards/<cardId>.effect.mp3` for the effect's source uid (via `cardIds`), deduped like the pulse.
   - *Shop:* in `store.ts`'s `play` case (the block that already inspects `onPlay` effects for a `tokenId`),
     fire `cards/<cardId>.effect.mp3` when the played card has any `onPlay` effect.
4. **Hero select** — `packages/ui/src/HeroSelect.tsx:53` (`pickHero(id)` onClick): play `heroes/<id>.mp3`.
5. **Hero power** — `packages/ui/src/StatusBar.tsx:176` (currently `sfx.pulse()`): branch to
   `heroes/<heroId>.power.mp3` when present, else the generic pulse. Needs the active hero's id in scope.
6. **Loader** — add `./audio/heroes/*.mp3` to the `import.meta.glob` set in `sfx.ts`; add `sampleVol`
   defaults for the new categories.

<!-- GENERATED BELOW — edit the Creative brief + Status columns only; Filename/Trigger are regenerated. -->

### System / UI (28)

| Filename | Trigger | Creative brief | Status |
|---|---|---|---|
| `buy1.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `buy2.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `cardlanding.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `cardtouch.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `clickthock.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `combatStart.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `deny.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `discover.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `divineshieldbreak.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `freezetavern.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `inspect.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `pulse.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `rebornshatter.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `rebornsummon.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `reordercard.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `roll.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `sell1.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `sell2.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `sell3.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `sell4.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `skullburst.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `smack.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `summon.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `taunt.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `tavernupgrade.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `triggerglow.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `triggerpulse.mp3` | Existing UI / system cue | (shipped) | ✅ |
| `unfreezetavern.mp3` | Existing UI / system cue | (shipped) | ✅ |

### Heroes (48)

| Filename | Trigger | Creative brief | Status |
|---|---|---|---|
| `heroes/baggerben.mp3` | Bagger Ben selected in Hero Select | Bagger Ben — hero select cue. | ⬜ |
| `heroes/baggerben.power.mp3` | Bagger Ben's power "Bag It" activates | Bag It — hero power cue. | ⬜ |
| `heroes/cassen.mp3` | Cassen selected in Hero Select | Cassen — hero select cue. | ⬜ |
| `heroes/cassen.power.mp3` | Cassen's power "Collision" activates | Collision — hero power cue. | ⬜ |
| `heroes/chaos.mp3` | Chaos selected in Hero Select | Chaos — hero select cue. | ⬜ |
| `heroes/chaos.power.mp3` | Chaos's power "Chaos Bond" activates | Chaos Bond — hero power cue. | ⬜ |
| `heroes/chronoshero.mp3` | Chronos selected in Hero Select | Chronos — hero select cue. | ⬜ |
| `heroes/chronoshero.power.mp3` | Chronos's power "Encore" activates | Encore — hero power cue. | ⬜ |
| `heroes/coran.mp3` | Coran selected in Hero Select | Coran — hero select cue. | ⬜ |
| `heroes/coran.power.mp3` | Coran's power "Pathfinder" activates | Pathfinder — hero power cue. | ⬜ |
| `heroes/darah.mp3` | Darah selected in Hero Select | Darah — hero select cue. | ⬜ |
| `heroes/darah.power.mp3` | Darah's power "Displace" activates | Displace — hero power cue. | ⬜ |
| `heroes/discodan.mp3` | Disco Dan selected in Hero Select | Disco Dan — hero select cue. | ⬜ |
| `heroes/discodan.power.mp3` | Disco Dan's power "Setlist" activates | Setlist — hero power cue. | ⬜ |
| `heroes/djinn.mp3` | Djinn selected in Hero Select | Djinn — hero select cue. | ⬜ |
| `heroes/djinn.power.mp3` | Djinn's power "Cadence" activates | Cadence — hero power cue. | ⬜ |
| `heroes/drakko.mp3` | Drakko selected in Hero Select | Drakko — hero select cue. | ⬜ |
| `heroes/drakko.power.mp3` | Drakko's power "Drumline" activates | Drumline — hero power cue. | ⬜ |
| `heroes/fi.mp3` | Fi selected in Hero Select | Fi — hero select cue. | ⬜ |
| `heroes/fi.power.mp3` | Fi's power "Errand" activates | Errand — hero power cue. | ⬜ |
| `heroes/gildmaster.mp3` | Gildmaster selected in Hero Select | Gildmaster — hero select cue. | ⬜ |
| `heroes/gildmaster.power.mp3` | Gildmaster's power "Golden Gild" activates | Golden Gild — hero power cue. | ⬜ |
| `heroes/herald.mp3` | Herald selected in Hero Select | Herald — hero select cue. | ⬜ |
| `heroes/herald.power.mp3` | Herald's power "Proclaim" activates | Proclaim — hero power cue. | ⬜ |
| `heroes/hermithank.mp3` | Tradesman selected in Hero Select | Tradesman — hero select cue. | ⬜ |
| `heroes/hermithank.power.mp3` | Tradesman's power "Frugal" activates | Frugal — hero power cue. | ⬜ |
| `heroes/indy.mp3` | Indy selected in Hero Select | Indy — hero select cue. | ⬜ |
| `heroes/indy.power.mp3` | Indy's power "Gild" activates | Gild — hero power cue. | ⬜ |
| `heroes/jenkins.mp3` | Jenkins selected in Hero Select | Jenkins — hero select cue. | ⬜ |
| `heroes/jenkins.power.mp3` | Jenkins's power "Dynamite Dig" activates | Dynamite Dig — hero power cue. | ⬜ |
| `heroes/myra.mp3` | Myra selected in Hero Select | Myra — hero select cue. | ⬜ |
| `heroes/myra.power.mp3` | Myra's power "Pulse" activates | Pulse — hero power cue. | ⬜ |
| `heroes/nadja.mp3` | Nadja selected in Hero Select | Nadja — hero select cue. | ⬜ |
| `heroes/nadja.power.mp3` | Nadja's power "Gold Font" activates | Gold Font — hero power cue. | ⬜ |
| `heroes/risen.mp3` | Lord of the Risen selected in Hero Select | Lord of the Risen — hero select cue. | ⬜ |
| `heroes/risen.power.mp3` | Lord of the Risen's power "Rise Again" activates | Rise Again — hero power cue. | ⬜ |
| `heroes/robin.mp3` | Robin selected in Hero Select | Robin — hero select cue. | ⬜ |
| `heroes/robin.power.mp3` | Robin's power "Spoils" activates | Spoils — hero power cue. | ⬜ |
| `heroes/rohan.mp3` | Yirin selected in Hero Select | Yirin — hero select cue. | ⬜ |
| `heroes/rohan.power.mp3` | Yirin's power "Attunement" activates | Attunement — hero power cue. | ⬜ |
| `heroes/runeguard.mp3` | Runeguard selected in Hero Select | Runeguard — hero select cue. | ⬜ |
| `heroes/runeguard.power.mp3` | Runeguard's power "Defend the Forge" activates | Defend the Forge — hero power cue. | ⬜ |
| `heroes/runesmith.mp3` | Runesmith selected in Hero Select | Runesmith — hero select cue. | ⬜ |
| `heroes/runesmith.power.mp3` | Runesmith's power "Runeforge" activates | Runeforge — hero power cue. | ⬜ |
| `heroes/soren.mp3` | Soren selected in Hero Select | Soren — hero select cue. | ⬜ |
| `heroes/soren.power.mp3` | Soren's power "Reclaim" activates | Reclaim — hero power cue. | ⬜ |
| `heroes/warden.mp3` | Warden selected in Hero Select | Warden — hero select cue. | ⬜ |
| `heroes/warden.power.mp3` | Warden's power "Aegis" activates | Aegis — hero power cue. | ⬜ |

### Spells (45)

| Filename | Trigger | Creative brief | Status |
|---|---|---|---|
| `cards/anomalyreactor.mp3` | Spell cast — unique clip over the default bed | Anomaly Reactor — spell cast cue (~0.4s). | ⬜ |
| `cards/apples.mp3` | Spell cast — unique clip over the default bed | Apples — spell cast cue (~0.4s). | ⬜ |
| `cards/aresmar.mp3` | Spell cast — unique clip over the default bed | Eyes of Aresmar — spell cast cue (~0.4s). | ⬜ |
| `cards/bloodlust.mp3` | Spell cast — unique clip over the default bed | Bloodlust — spell cast cue (~0.4s). | ⬜ |
| `cards/bulwark.mp3` | Spell cast — unique clip over the default bed | Bulwark — spell cast cue (~0.4s). | ⬜ |
| `cards/chronostaff.mp3` | Spell cast — unique clip over the default bed | Chrono Staff — spell cast cue (~0.4s). | ⬜ |
| `cards/consume.mp3` | Spell cast — unique clip over the default bed | Consume — spell cast cue (~0.4s). | ⬜ |
| `cards/corpseboard.mp3` | Spell cast — unique clip over the default bed | Corpse Board — spell cast cue (~0.4s). | ⬜ |
| `cards/depositbox.mp3` | Spell cast — unique clip over the default bed | Safety Deposit Box — spell cast cue (~0.4s). | ⬜ |
| `cards/devour.mp3` | Spell cast — unique clip over the default bed | Channeling the Devourer — spell cast cue (~0.4s). | ⬜ |
| `cards/displacement.mp3` | Spell cast — unique clip over the default bed | Displacement — spell cast cue (~0.4s). | ⬜ |
| `cards/emberpouch.mp3` | Spell cast — unique clip over the default bed | Gold Pouch — spell cast cue (~0.4s). | ⬜ |
| `cards/feedalpha.mp3` | Spell cast — unique clip over the default bed | Feed the Alpha — spell cast cue (~0.4s). | ⬜ |
| `cards/fleetingvigor.mp3` | Spell cast — unique clip over the default bed | Fleeting Vigor — spell cast cue (~0.4s). | ⬜ |
| `cards/foddertreatment.mp3` | Spell cast — unique clip over the default bed | Fodder Treatment — spell cast cue (~0.4s). | ⬜ |
| `cards/fronttoback.mp3` | Spell cast — unique clip over the default bed | Front to Back — spell cast cue (~0.4s). | ⬜ |
| `cards/goldcrafter.mp3` | Spell cast — unique clip over the default bed | Goldcrafter — spell cast cue (~0.4s). | ⬜ |
| `cards/goldentouch.mp3` | Spell cast — unique clip over the default bed | Golden Touch — spell cast cue (~0.4s). | ⬜ |
| `cards/growth.mp3` | Spell cast — unique clip over the default bed | Growth — spell cast cue (~0.4s). | ⬜ |
| `cards/helpwanted.mp3` | Spell cast — unique clip over the default bed | Help Wanted — spell cast cue (~0.4s). | ⬜ |
| `cards/implosion.mp3` | Spell cast — unique clip over the default bed | Implosion — spell cast cue (~0.4s). | ⬜ |
| `cards/keyfindings.mp3` | Spell cast — unique clip over the default bed | Key Findings — spell cast cue (~0.4s). | ⬜ |
| `cards/lanternlight.mp3` | Spell cast — unique clip over the default bed | Lantern Light — spell cast cue (~0.4s). | ⬜ |
| `cards/lanternofsouls.mp3` | Spell cast — unique clip over the default bed | Lantern of Souls — spell cast cue (~0.4s). | ⬜ |
| `cards/lasso.mp3` | Spell cast — unique clip over the default bed | Lasso — spell cast cue (~0.4s). | ⬜ |
| `cards/manafont.mp3` | Spell cast — unique clip over the default bed | Gold Font — spell cast cue (~0.4s). | ⬜ |
| `cards/mend.mp3` | Spell cast — unique clip over the default bed | Mend — spell cast cue (~0.4s). | ⬜ |
| `cards/ossuaryrite.mp3` | Spell cast — unique clip over the default bed | Ossuary Rite — spell cast cue (~0.4s). | ⬜ |
| `cards/patchjob.mp3` | Spell cast — unique clip over the default bed | Patch Job — spell cast cue (~0.4s). | ⬜ |
| `cards/perfectvision.mp3` | Spell cast — unique clip over the default bed | Perfect Vision — spell cast cue (~0.4s). | ⬜ |
| `cards/preemptive.mp3` | Spell cast — unique clip over the default bed | Pre-emptive Assault — spell cast cue (~0.4s). | ⬜ |
| `cards/rallyoffensive.mp3` | Spell cast — unique clip over the default bed | Rallying Offensive — spell cast cue (~0.4s). | ⬜ |
| `cards/refreshtexts.mp3` | Spell cast — unique clip over the default bed | Refreshing Texts — spell cast cue (~0.4s). | ⬜ |
| `cards/resonance.mp3` | Spell cast — unique clip over the default bed | Resonance — spell cast cue (~0.4s). | ⬜ |
| `cards/shatter.mp3` | Spell cast — unique clip over the default bed | Shatter — spell cast cue (~0.4s). | ⬜ |
| `cards/sparkplug.mp3` | Spell cast — unique clip over the default bed | Spark Plug — spell cast cue (~0.4s). | ⬜ |
| `cards/spellcart.mp3` | Spell cast — unique clip over the default bed | Spell Cart — spell cast cue (~0.4s). | ⬜ |
| `cards/spiritfire.mp3` | Spell cast — unique clip over the default bed | Spirit Fire — spell cast cue (~0.4s). | ⬜ |
| `cards/sprout.mp3` | Spell cast — unique clip over the default bed | Sprout — spell cast cue (~0.4s). | ⬜ |
| `cards/staffofguel.mp3` | Spell cast — unique clip over the default bed | Staff of Guel — spell cast cue (~0.4s). | ⬜ |
| `cards/summonstone.mp3` | Spell cast — unique clip over the default bed | Summon Stone — spell cast cue (~0.4s). | ⬜ |
| `cards/tribeportal.mp3` | Spell cast — unique clip over the default bed | Tribe Portal — spell cast cue (~0.4s). | ⬜ |
| `cards/tribeschoice.mp3` | Spell cast — unique clip over the default bed | Tribes Choice — spell cast cue (~0.4s). | ⬜ |
| `cards/undeadarmy.mp3` | Spell cast — unique clip over the default bed | Undead Army — spell cast cue (~0.4s). | ⬜ |
| `castspell.mp3` | Default bed under every spell cast | Generic spell whoosh (~0.3s). | ⬜ |

### Neutral (69)

| Filename | Trigger | Creative brief | Status |
|---|---|---|---|
| `cards/arenaheckler.death.mp3` | Dies in combat (over the death bed) | Arena Heckler — death cue (~0.4s). | ⬜ |
| `cards/arenaheckler.effect.mp3` | Start-of-Combat procs (shop or combat) | Arena Heckler — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/arenaheckler.mp3` | Played to the board (over the landing bed) | Arena Heckler — play cue (~0.4s). | ⬜ |
| `cards/blackbelt.death.mp3` | Dies in combat (over the death bed) | Black Belt Brian — death cue (~0.4s). | ⬜ |
| `cards/blackbelt.effect.mp3` | Battlecry procs (shop or combat) | Black Belt Brian — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/blackbelt.mp3` | Played to the board (over the landing bed) | Black Belt Brian — play cue (~0.4s). | ⬜ |
| `cards/blaster.death.mp3` | Dies in combat (over the death bed) | Blaster — death cue (~0.4s). | ⬜ |
| `cards/blaster.effect.mp3` | Deathrattle procs (shop or combat) | Blaster — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/blaster.mp3` | Played to the board (over the landing bed) | Blaster — play cue (~0.4s). | ⬜ |
| `cards/broker.death.mp3` | Dies in combat (over the death bed) | Brightwing Broker — death cue (~0.4s). | ⬜ |
| `cards/broker.effect.mp3` | on-buy procs (shop or combat) | Brightwing Broker — on-buy proc cue (~0.4s). | ⬜ |
| `cards/broker.mp3` | Played to the board (over the landing bed) | Brightwing Broker — play cue (~0.4s). | ⬜ |
| `cards/buddy.death.mp3` | Dies in combat (over the death bed) | Buddy Buddy — death cue (~0.4s). | ⬜ |
| `cards/buddy.effect.mp3` | Battlecry procs (shop or combat) | Buddy Buddy — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/buddy.mp3` | Played to the board (over the landing bed) | Buddy Buddy — play cue (~0.4s). | ⬜ |
| `cards/chronos.death.mp3` | Dies in combat (over the death bed) | Chronos — death cue (~0.4s). | ⬜ |
| `cards/chronos.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/chronos.mp3` | Played to the board (over the landing bed) | Chronos — play cue (~0.4s). | ⬜ |
| `cards/drummer.death.mp3` | Dies in combat (over the death bed) | Drakko the Drummer — death cue (~0.4s). | ⬜ |
| `cards/drummer.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/drummer.mp3` | Played to the board (over the landing bed) | Drakko the Drummer — play cue (~0.4s). | ⬜ |
| `cards/guel.death.mp3` | Dies in combat (over the death bed) | Archmagus Guel — death cue (~0.4s). | ⬜ |
| `cards/guel.effect.mp3` | spellCast procs (shop or combat) | Archmagus Guel — spellCast proc cue (~0.4s). | ⬜ |
| `cards/guel.mp3` | Played to the board (over the landing bed) | Archmagus Guel — play cue (~0.4s). | ⬜ |
| `cards/hoarder.death.mp3` | Dies in combat (over the death bed) | Hoarder — death cue (~0.4s). | ⬜ |
| `cards/hoarder.effect.mp3` | Battlecry procs (shop or combat) | Hoarder — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/hoarder.mp3` | Played to the board (over the landing bed) | Hoarder — play cue (~0.4s). | ⬜ |
| `cards/jenkins.death.mp3` | Dies in combat (over the death bed) | Jenkins & Fi — death cue (~0.4s). | ⬜ |
| `cards/jenkins.effect.mp3` | Deathrattle procs (shop or combat) | Jenkins & Fi — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/jenkins.mp3` | Played to the board (over the landing bed) | Jenkins & Fi — play cue (~0.4s). | ⬜ |
| `cards/joker.death.mp3` | Dies in combat (over the death bed) | Mysterious Joker — death cue (~0.4s). | ⬜ |
| `cards/joker.effect.mp3` | Battlecry procs (shop or combat) | Mysterious Joker — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/joker.mp3` | Played to the board (over the landing bed) | Mysterious Joker — play cue (~0.4s). | ⬜ |
| `cards/monk.death.mp3` | Dies in combat (over the death bed) | Flowing Monk — death cue (~0.4s). | ⬜ |
| `cards/monk.effect.mp3` | summonOverflow procs (shop or combat) | Flowing Monk — summonOverflow proc cue (~0.4s). | ⬜ |
| `cards/monk.mp3` | Played to the board (over the landing bed) | Flowing Monk — play cue (~0.4s). | ⬜ |
| `cards/nimbus.death.mp3` | Dies in combat (over the death bed) | Nimbus — death cue (~0.4s). | ⬜ |
| `cards/nimbus.effect.mp3` | Battlecry procs (shop or combat) | Nimbus — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/nimbus.mp3` | Played to the board (over the landing bed) | Nimbus — play cue (~0.4s). | ⬜ |
| `cards/ropewrangler.death.mp3` | Dies in combat (over the death bed) | Rope Wrangler — death cue (~0.4s). | ⬜ |
| `cards/ropewrangler.effect.mp3` | endOfTurn procs (shop or combat) | Rope Wrangler — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/ropewrangler.mp3` | Played to the board (over the landing bed) | Rope Wrangler — play cue (~0.4s). | ⬜ |
| `cards/sandbag.death.mp3` | Dies in combat (over the death bed) | Target Dummy — death cue (~0.4s). | ⬜ |
| `cards/sandbag.effect.mp3` | onDamaged procs (shop or combat) | Target Dummy — onDamaged proc cue (~0.4s). | ⬜ |
| `cards/sandbag.mp3` | Played to the board (over the landing bed) | Target Dummy — play cue (~0.4s). | ⬜ |
| `cards/spellappraiser.death.mp3` | Dies in combat (over the death bed) | Spell Appraiser — death cue (~0.4s). | ⬜ |
| `cards/spellappraiser.effect.mp3` | avenge procs (shop or combat) | Spell Appraiser — avenge proc cue (~0.4s). | ⬜ |
| `cards/spellappraiser.mp3` | Played to the board (over the landing bed) | Spell Appraiser — play cue (~0.4s). | ⬜ |
| `cards/stewardofspells.death.mp3` | Dies in combat (over the death bed) | Steward of Spells — death cue (~0.4s). | ⬜ |
| `cards/stewardofspells.effect.mp3` | endOfTurn procs (shop or combat) | Steward of Spells — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/stewardofspells.mp3` | Played to the board (over the landing bed) | Steward of Spells — play cue (~0.4s). | ⬜ |
| `cards/sylus.death.mp3` | Dies in combat (over the death bed) | Sylus the Reaper — death cue (~0.4s). | ⬜ |
| `cards/sylus.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/sylus.mp3` | Played to the board (over the landing bed) | Sylus the Reaper — play cue (~0.4s). | ⬜ |
| `cards/tauntbreaker.death.mp3` | Dies in combat (over the death bed) | Tauntbreaker — death cue (~0.4s). | ⬜ |
| `cards/tauntbreaker.effect.mp3` | onAttack procs (shop or combat) | Tauntbreaker — onAttack proc cue (~0.4s). | ⬜ |
| `cards/tauntbreaker.mp3` | Played to the board (over the landing bed) | Tauntbreaker — play cue (~0.4s). | ⬜ |
| `cards/taurus.death.mp3` | Dies in combat (over the death bed) | Taurus — death cue (~0.4s). | ⬜ |
| `cards/taurus.effect.mp3` | Start-of-Combat procs (shop or combat) | Taurus — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/taurus.mp3` | Played to the board (over the landing bed) | Taurus — play cue (~0.4s). | ⬜ |
| `cards/venom.death.mp3` | Dies in combat (over the death bed) | Venom — death cue (~0.4s). | ⬜ |
| `cards/venom.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/venom.mp3` | Played to the board (over the landing bed) | Venom — play cue (~0.4s). | ⬜ |
| `cards/wayfinder.death.mp3` | Dies in combat (over the death bed) | Wayfinder — death cue (~0.4s). | ⬜ |
| `cards/wayfinder.effect.mp3` | Battlecry procs (shop or combat) | Wayfinder — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/wayfinder.mp3` | Played to the board (over the landing bed) | Wayfinder — play cue (~0.4s). | ⬜ |
| `cards/yazzus.death.mp3` | Dies in combat (over the death bed) | Yazzus — death cue (~0.4s). | ⬜ |
| `cards/yazzus.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/yazzus.mp3` | Played to the board (over the landing bed) | Yazzus — play cue (~0.4s). | ⬜ |

### Beasts (63)

| Filename | Trigger | Creative brief | Status |
|---|---|---|---|
| `cards/alley.death.mp3` | Dies in combat (over the death bed) | Pennycat — death cue (~0.4s). | ⬜ |
| `cards/alley.effect.mp3` | Battlecry procs (shop or combat) | Pennycat — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/alley.mp3` | Played to the board (over the landing bed) | Pennycat — play cue (~0.4s). | 🎙️ |
| `cards/babycub.death.mp3` | Dies in combat (over the death bed) | Baby Cub — death cue (~0.4s). | ⬜ |
| `cards/babycub.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/babycub.mp3` | Played to the board (over the landing bed) | Baby Cub — play cue (~0.4s). | ⬜ |
| `cards/badgington.death.mp3` | Dies in combat (over the death bed) | Badgington — death cue (~0.4s). | ⬜ |
| `cards/badgington.effect.mp3` | onAttack procs (shop or combat) | Badgington — onAttack proc cue (~0.4s). | ⬜ |
| `cards/badgington.mp3` | Played to the board (over the landing bed) | Badgington — play cue (~0.4s). | ⬜ |
| `cards/beetle.death.mp3` | Dies in combat (over the death bed) | Runic Beetle — death cue (~0.4s). | ⬜ |
| `cards/beetle.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/beetle.mp3` | Played to the board (over the landing bed) | Runic Beetle — play cue (~0.4s). | ⬜ |
| `cards/gnash.death.mp3` | Dies in combat (over the death bed) | Gnasher, the Overrun — death cue (~0.4s). | ⬜ |
| `cards/gnash.effect.mp3` | on-kill procs (shop or combat) | Gnasher, the Overrun — on-kill proc cue (~0.4s). | ⬜ |
| `cards/gnash.mp3` | Played to the board (over the landing bed) | Gnasher, the Overrun — play cue (~0.4s). | ⬜ |
| `cards/grim.death.mp3` | Dies in combat (over the death bed) | Grim — death cue (~0.4s). | ⬜ |
| `cards/grim.effect.mp3` | Deathrattle procs (shop or combat) | Grim — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/grim.mp3` | Played to the board (over the landing bed) | Grim — play cue (~0.4s). | ⬜ |
| `cards/gryphon.death.mp3` | Dies in combat (over the death bed) | Gryphon — death cue (~0.4s). | ⬜ |
| `cards/gryphon.effect.mp3` | onDamaged procs (shop or combat) | Gryphon — onDamaged proc cue (~0.4s). | ⬜ |
| `cards/gryphon.mp3` | Played to the board (over the landing bed) | Gryphon — play cue (~0.4s). | ⬜ |
| `cards/kennel.death.mp3` | Dies in combat (over the death bed) | Kennelmaster — death cue (~0.4s). | ⬜ |
| `cards/kennel.effect.mp3` | Start-of-Combat procs (shop or combat) | Kennelmaster — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/kennel.mp3` | Played to the board (over the landing bed) | Kennelmaster — play cue (~0.4s). | ⬜ |
| `cards/mamabear.death.mp3` | Dies in combat (over the death bed) | Den Mother — death cue (~0.4s). | ⬜ |
| `cards/mamabear.effect.mp3` | on-summon procs (shop or combat) | Den Mother — on-summon proc cue (~0.4s). | ⬜ |
| `cards/mamabear.mp3` | Played to the board (over the landing bed) | Den Mother — play cue (~0.4s). | ⬜ |
| `cards/manasaber.death.mp3` | Dies in combat (over the death bed) | Void Panther — death cue (~0.4s). | ⬜ |
| `cards/manasaber.effect.mp3` | Deathrattle procs (shop or combat) | Void Panther — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/manasaber.mp3` | Played to the board (over the landing bed) | Void Panther — play cue (~0.4s). | ⬜ |
| `cards/mirrorrhino.death.mp3` | Dies in combat (over the death bed) | Mirrorhide Rhino — death cue (~0.4s). | ⬜ |
| `cards/mirrorrhino.effect.mp3` | Start-of-Combat procs (shop or combat) | Mirrorhide Rhino — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/mirrorrhino.mp3` | Played to the board (over the landing bed) | Mirrorhide Rhino — play cue (~0.4s). | ⬜ |
| `cards/pack.death.mp3` | Dies in combat (over the death bed) | Mama Pup — death cue (~0.4s). | ⬜ |
| `cards/pack.effect.mp3` | Deathrattle procs (shop or combat) | Mama Pup — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/pack.mp3` | Played to the board (over the landing bed) | Mama Pup — play cue (~0.4s). | ⬜ |
| `cards/packleader.death.mp3` | Dies in combat (over the death bed) | Pack Leader — death cue (~0.4s). | ⬜ |
| `cards/packleader.effect.mp3` | Start-of-Combat procs (shop or combat) | Pack Leader — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/packleader.mp3` | Played to the board (over the landing bed) | Pack Leader — play cue (~0.4s). | ⬜ |
| `cards/philippe.death.mp3` | Dies in combat (over the death bed) | Philippe — death cue (~0.4s). | ⬜ |
| `cards/philippe.effect.mp3` | onAttack procs (shop or combat) | Philippe — onAttack proc cue (~0.4s). | ⬜ |
| `cards/philippe.mp3` | Played to the board (over the landing bed) | Philippe — play cue (~0.4s). | ⬜ |
| `cards/raptor.death.mp3` | Dies in combat (over the death bed) | Raptor — death cue (~0.4s). | ⬜ |
| `cards/raptor.effect.mp3` | onAttack procs (shop or combat) | Raptor — onAttack proc cue (~0.4s). | ⬜ |
| `cards/raptor.mp3` | Played to the board (over the landing bed) | Raptor — play cue (~0.4s). | ⬜ |
| `cards/seaurchin.death.mp3` | Dies in combat (over the death bed) | Sea Urchin — death cue (~0.4s). | ⬜ |
| `cards/seaurchin.effect.mp3` | Battlecry procs (shop or combat) | Sea Urchin — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/seaurchin.mp3` | Played to the board (over the landing bed) | Sea Urchin — play cue (~0.4s). | ⬜ |
| `cards/shaper.death.mp3` | Dies in combat (over the death bed) | Wildwood Shaper — death cue (~0.4s). | ⬜ |
| `cards/shaper.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/shaper.mp3` | Played to the board (over the landing bed) | Wildwood Shaper — play cue (~0.4s). | ⬜ |
| `cards/solaris.death.mp3` | Dies in combat (over the death bed) | Solaris Fang — death cue (~0.4s). | ⬜ |
| `cards/solaris.effect.mp3` | onAttack procs (shop or combat) | Solaris Fang — onAttack proc cue (~0.4s). | ⬜ |
| `cards/solaris.mp3` | Played to the board (over the landing bed) | Solaris Fang — play cue (~0.4s). | ⬜ |
| `cards/spiritpup.death.mp3` | Dies in combat (over the death bed) | Spirit Pup — death cue (~0.4s). | ⬜ |
| `cards/spiritpup.effect.mp3` | spellCast procs (shop or combat) | Spirit Pup — spellCast proc cue (~0.4s). | ⬜ |
| `cards/spiritpup.mp3` | Played to the board (over the landing bed) | Spirit Pup — play cue (~0.4s). | ⬜ |
| `cards/sporebat.death.mp3` | Dies in combat (over the death bed) | Sporebat — death cue (~0.4s). | ⬜ |
| `cards/sporebat.effect.mp3` | Deathrattle procs (shop or combat) | Sporebat — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/sporebat.mp3` | Played to the board (over the landing bed) | Sporebat — play cue (~0.4s). | ⬜ |
| `cards/squirlscout.death.mp3` | Dies in combat (over the death bed) | Squirl Scout — death cue (~0.4s). | ⬜ |
| `cards/squirlscout.effect.mp3` | Battlecry procs (shop or combat) | Squirl Scout — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/squirlscout.mp3` | Played to the board (over the landing bed) | Squirl Scout — play cue (~0.4s). | ⬜ |

### Dragons (54)

| Filename | Trigger | Creative brief | Status |
|---|---|---|---|
| `cards/bane.death.mp3` | Dies in combat (over the death bed) | Bane — death cue (~0.4s). | ⬜ |
| `cards/bane.effect.mp3` | battlecryTriggered procs (shop or combat) | Bane — battlecryTriggered proc cue (~0.4s). | ⬜ |
| `cards/bane.mp3` | Played to the board (over the landing bed) | Bane — play cue (~0.4s). | ⬜ |
| `cards/bronzewarden.death.mp3` | Dies in combat (over the death bed) | Guardian Drake — death cue (~0.4s). | ⬜ |
| `cards/bronzewarden.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/bronzewarden.mp3` | Played to the board (over the landing bed) | Guardian Drake — play cue (~0.4s). | ⬜ |
| `cards/broodmother.death.mp3` | Dies in combat (over the death bed) | Violet Whelpmother — death cue (~0.4s). | ⬜ |
| `cards/broodmother.effect.mp3` | Deathrattle procs (shop or combat) | Violet Whelpmother — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/broodmother.mp3` | Played to the board (over the landing bed) | Violet Whelpmother — play cue (~0.4s). | ⬜ |
| `cards/cinder.death.mp3` | Dies in combat (over the death bed) | Cinderwing Matron — death cue (~0.4s). | ⬜ |
| `cards/cinder.effect.mp3` | Battlecry procs (shop or combat) | Cinderwing Matron — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/cinder.mp3` | Played to the board (over the landing bed) | Cinderwing Matron — play cue (~0.4s). | ⬜ |
| `cards/cleric.death.mp3` | Dies in combat (over the death bed) | Hoard Cleric — death cue (~0.4s). | ⬜ |
| `cards/cleric.effect.mp3` | Battlecry procs (shop or combat) | Hoard Cleric — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/cleric.mp3` | Played to the board (over the landing bed) | Hoard Cleric — play cue (~0.4s). | ⬜ |
| `cards/cryptdrake.death.mp3` | Dies in combat (over the death bed) | Crypt Drake — death cue (~0.4s). | ⬜ |
| `cards/cryptdrake.effect.mp3` | onAttack procs (shop or combat) | Crypt Drake — onAttack proc cue (~0.4s). | ⬜ |
| `cards/cryptdrake.mp3` | Played to the board (over the landing bed) | Crypt Drake — play cue (~0.4s). | ⬜ |
| `cards/frontdrake.death.mp3` | Dies in combat (over the death bed) | Bard — death cue (~0.4s). | ⬜ |
| `cards/frontdrake.effect.mp3` | endOfTurn procs (shop or combat) | Bard — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/frontdrake.mp3` | Played to the board (over the landing bed) | Bard — play cue (~0.4s). | ⬜ |
| `cards/havendrake.death.mp3` | Dies in combat (over the death bed) | Haven Drake — death cue (~0.4s). | ⬜ |
| `cards/havendrake.effect.mp3` | Battlecry procs (shop or combat) | Haven Drake — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/havendrake.mp3` | Played to the board (over the landing bed) | Haven Drake — play cue (~0.4s). | ⬜ |
| `cards/hoardbreaker.death.mp3` | Dies in combat (over the death bed) | Hoardbreaker Drake — death cue (~0.4s). | ⬜ |
| `cards/hoardbreaker.effect.mp3` | on-kill procs (shop or combat) | Hoardbreaker Drake — on-kill proc cue (~0.4s). | ⬜ |
| `cards/hoardbreaker.mp3` | Played to the board (over the landing bed) | Hoardbreaker Drake — play cue (~0.4s). | ⬜ |
| `cards/hunter.death.mp3` | Dies in combat (over the death bed) | Hunter — death cue (~0.4s). | ⬜ |
| `cards/hunter.effect.mp3` | onGainAttack procs (shop or combat) | Hunter — onGainAttack proc cue (~0.4s). | ⬜ |
| `cards/hunter.mp3` | Played to the board (over the landing bed) | Hunter — play cue (~0.4s). | ⬜ |
| `cards/karwind.death.mp3` | Dies in combat (over the death bed) | Karwind — death cue (~0.4s). | ⬜ |
| `cards/karwind.effect.mp3` | battlecryTriggered procs (shop or combat) | Karwind — battlecryTriggered proc cue (~0.4s). | ⬜ |
| `cards/karwind.mp3` | Played to the board (over the landing bed) | Karwind — play cue (~0.4s). | ⬜ |
| `cards/runescale.death.mp3` | Dies in combat (over the death bed) | Runescale Drake — death cue (~0.4s). | ⬜ |
| `cards/runescale.effect.mp3` | Start-of-Combat procs (shop or combat) | Runescale Drake — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/runescale.mp3` | Played to the board (over the landing bed) | Runescale Drake — play cue (~0.4s). | ⬜ |
| `cards/stuntdrake.death.mp3` | Dies in combat (over the death bed) | Obsidian Drake — death cue (~0.4s). | ⬜ |
| `cards/stuntdrake.effect.mp3` | avenge procs (shop or combat) | Obsidian Drake — avenge proc cue (~0.4s). | ⬜ |
| `cards/stuntdrake.mp3` | Played to the board (over the landing bed) | Obsidian Drake — play cue (~0.4s). | ⬜ |
| `cards/supporter.death.mp3` | Dies in combat (over the death bed) | Supporter — death cue (~0.4s). | ⬜ |
| `cards/supporter.effect.mp3` | onAttack procs (shop or combat) | Supporter — onAttack proc cue (~0.4s). | ⬜ |
| `cards/supporter.mp3` | Played to the board (over the landing bed) | Supporter — play cue (~0.4s). | ⬜ |
| `cards/tara.death.mp3` | Dies in combat (over the death bed) | Tara — death cue (~0.4s). | ⬜ |
| `cards/tara.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/tara.mp3` | Played to the board (over the landing bed) | Tara — play cue (~0.4s). | ⬜ |
| `cards/twilightwhelp.death.mp3` | Dies in combat (over the death bed) | Violet Whelp — death cue (~0.4s). | ⬜ |
| `cards/twilightwhelp.effect.mp3` | Deathrattle procs (shop or combat) | Violet Whelp — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/twilightwhelp.mp3` | Played to the board (over the landing bed) | Violet Whelp — play cue (~0.4s). | ⬜ |
| `cards/vineweaver.death.mp3` | Dies in combat (over the death bed) | Vineweaver Drake — death cue (~0.4s). | ⬜ |
| `cards/vineweaver.effect.mp3` | endOfTurn procs (shop or combat) | Vineweaver Drake — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/vineweaver.mp3` | Played to the board (over the landing bed) | Vineweaver Drake — play cue (~0.4s). | ⬜ |
| `cards/weaver.death.mp3` | Dies in combat (over the death bed) | Arcane Weaver — death cue (~0.4s). | ⬜ |
| `cards/weaver.effect.mp3` | avenge procs (shop or combat) | Arcane Weaver — avenge proc cue (~0.4s). | ⬜ |
| `cards/weaver.mp3` | Played to the board (over the landing bed) | Arcane Weaver — play cue (~0.4s). | ⬜ |

### Undead (60)

| Filename | Trigger | Creative brief | Status |
|---|---|---|---|
| `cards/cryptscribe.death.mp3` | Dies in combat (over the death bed) | Crypt Scribe — death cue (~0.4s). | ⬜ |
| `cards/cryptscribe.effect.mp3` | endOfTurn procs (shop or combat) | Crypt Scribe — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/cryptscribe.mp3` | Played to the board (over the landing bed) | Crypt Scribe — play cue (~0.4s). | ⬜ |
| `cards/deathlesshand.death.mp3` | Dies in combat (over the death bed) | Footman Captain — death cue (~0.4s). | ⬜ |
| `cards/deathlesshand.effect.mp3` | Deathrattle procs (shop or combat) | Footman Captain — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/deathlesshand.mp3` | Played to the board (over the landing bed) | Footman Captain — play cue (~0.4s). | ⬜ |
| `cards/deathsayer.death.mp3` | Dies in combat (over the death bed) | Deathsayer — death cue (~0.4s). | ⬜ |
| `cards/deathsayer.effect.mp3` | onAttack procs (shop or combat) | Deathsayer — onAttack proc cue (~0.4s). | ⬜ |
| `cards/deathsayer.mp3` | Played to the board (over the landing bed) | Deathsayer — play cue (~0.4s). | ⬜ |
| `cards/deathswarmer.death.mp3` | Dies in combat (over the death bed) | Deathswarmer — death cue (~0.4s). | ⬜ |
| `cards/deathswarmer.effect.mp3` | Battlecry procs (shop or combat) | Deathswarmer — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/deathswarmer.mp3` | Played to the board (over the landing bed) | Deathswarmer — play cue (~0.4s). | ⬜ |
| `cards/forsakenweaver.death.mp3` | Dies in combat (over the death bed) | Forsaken Mage — death cue (~0.4s). | ⬜ |
| `cards/forsakenweaver.effect.mp3` | spellCast procs (shop or combat) | Forsaken Mage — spellCast proc cue (~0.4s). | ⬜ |
| `cards/forsakenweaver.mp3` | Played to the board (over the landing bed) | Forsaken Mage — play cue (~0.4s). | ⬜ |
| `cards/graverobber.death.mp3` | Dies in combat (over the death bed) | Graverobber — death cue (~0.4s). | ⬜ |
| `cards/graverobber.effect.mp3` | Battlecry procs (shop or combat) | Graverobber — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/graverobber.mp3` | Played to the board (over the landing bed) | Graverobber — play cue (~0.4s). | ⬜ |
| `cards/gravewarden.death.mp3` | Dies in combat (over the death bed) | Gravewarden — death cue (~0.4s). | ⬜ |
| `cards/gravewarden.effect.mp3` | Start-of-Combat procs (shop or combat) | Gravewarden — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/gravewarden.mp3` | Played to the board (over the landing bed) | Gravewarden — play cue (~0.4s). | ⬜ |
| `cards/karthus.death.mp3` | Dies in combat (over the death bed) | Karthus — death cue (~0.4s). | ⬜ |
| `cards/karthus.effect.mp3` | on-kill procs (shop or combat) | Karthus — on-kill proc cue (~0.4s). | ⬜ |
| `cards/karthus.mp3` | Played to the board (over the landing bed) | Karthus — play cue (~0.4s). | ⬜ |
| `cards/knit.death.mp3` | Dies in combat (over the death bed) | Spear Warden — death cue (~0.4s). | ⬜ |
| `cards/knit.effect.mp3` | Deathrattle procs (shop or combat) | Spear Warden — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/knit.mp3` | Played to the board (over the landing bed) | Spear Warden — play cue (~0.4s). | ⬜ |
| `cards/mumi.death.mp3` | Dies in combat (over the death bed) | Mumi — death cue (~0.4s). | ⬜ |
| `cards/mumi.effect.mp3` | Deathrattle procs (shop or combat) | Mumi — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/mumi.mp3` | Played to the board (over the landing bed) | Mumi — play cue (~0.4s). | ⬜ |
| `cards/pillager.death.mp3` | Dies in combat (over the death bed) | Pillager — death cue (~0.4s). | ⬜ |
| `cards/pillager.effect.mp3` | Deathrattle procs (shop or combat) | Pillager — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/pillager.mp3` | Played to the board (over the landing bed) | Pillager — play cue (~0.4s). | ⬜ |
| `cards/profgreg.death.mp3` | Dies in combat (over the death bed) | Professor Greg — death cue (~0.4s). | ⬜ |
| `cards/profgreg.effect.mp3` | avenge procs (shop or combat) | Professor Greg — avenge proc cue (~0.4s). | ⬜ |
| `cards/profgreg.mp3` | Played to the board (over the landing bed) | Professor Greg — play cue (~0.4s). | ⬜ |
| `cards/ryme.death.mp3` | Dies in combat (over the death bed) | Ryme — death cue (~0.4s). | ⬜ |
| `cards/ryme.effect.mp3` | Deathrattle procs (shop or combat) | Ryme — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/ryme.mp3` | Played to the board (over the landing bed) | Ryme — play cue (~0.4s). | ⬜ |
| `cards/sergeant.death.mp3` | Dies in combat (over the death bed) | Sergeant — death cue (~0.4s). | ⬜ |
| `cards/sergeant.effect.mp3` | Deathrattle procs (shop or combat) | Sergeant — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/sergeant.mp3` | Played to the board (over the landing bed) | Sergeant — play cue (~0.4s). | ⬜ |
| `cards/soulsman.death.mp3` | Dies in combat (over the death bed) | Soulsman — death cue (~0.4s). | ⬜ |
| `cards/soulsman.effect.mp3` | avenge procs (shop or combat) | Soulsman — avenge proc cue (~0.4s). | ⬜ |
| `cards/soulsman.mp3` | Played to the board (over the landing bed) | Soulsman — play cue (~0.4s). | ⬜ |
| `cards/spore.death.mp3` | Dies in combat (over the death bed) | Sporeling — death cue (~0.4s). | ⬜ |
| `cards/spore.effect.mp3` | Deathrattle procs (shop or combat) | Sporeling — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/spore.mp3` | Played to the board (over the landing bed) | Sporeling — play cue (~0.4s). | ⬜ |
| `cards/steadfast.death.mp3` | Dies in combat (over the death bed) | Steadfast Champion — death cue (~0.4s). | ⬜ |
| `cards/steadfast.effect.mp3` | avenge procs (shop or combat) | Steadfast Champion — avenge proc cue (~0.4s). | ⬜ |
| `cards/steadfast.mp3` | Played to the board (over the landing bed) | Steadfast Champion — play cue (~0.4s). | ⬜ |
| `cards/thunderingabomination.death.mp3` | Dies in combat (over the death bed) | Cratering Hulk — death cue (~0.4s). | ⬜ |
| `cards/thunderingabomination.effect.mp3` | on-summon procs (shop or combat) | Cratering Hulk — on-summon proc cue (~0.4s). | ⬜ |
| `cards/thunderingabomination.mp3` | Played to the board (over the landing bed) | Cratering Hulk — play cue (~0.4s). | ⬜ |
| `cards/watcher.death.mp3` | Dies in combat (over the death bed) | Watcher — death cue (~0.4s). | ⬜ |
| `cards/watcher.effect.mp3` | onAttack procs (shop or combat) | Watcher — onAttack proc cue (~0.4s). | ⬜ |
| `cards/watcher.mp3` | Played to the board (over the landing bed) | Watcher — play cue (~0.4s). | ⬜ |
| `cards/wolvesden.death.mp3` | Dies in combat (over the death bed) | Wolves Den — death cue (~0.4s). | ⬜ |
| `cards/wolvesden.effect.mp3` | Deathrattle procs (shop or combat) | Wolves Den — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/wolvesden.mp3` | Played to the board (over the landing bed) | Wolves Den — play cue (~0.4s). | ⬜ |

### Mechs (57)

| Filename | Trigger | Creative brief | Status |
|---|---|---|---|
| `cards/aeonguard.death.mp3` | Dies in combat (over the death bed) | Aeon Guard — death cue (~0.4s). | ⬜ |
| `cards/aeonguard.effect.mp3` | endOfTurn procs (shop or combat) | Aeon Guard — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/aeonguard.mp3` | Played to the board (over the landing bed) | Aeon Guard — play cue (~0.4s). | ⬜ |
| `cards/banksly.death.mp3` | Dies in combat (over the death bed) | Banksly — death cue (~0.4s). | ⬜ |
| `cards/banksly.effect.mp3` | goldSpent procs (shop or combat) | Banksly — goldSpent proc cue (~0.4s). | ⬜ |
| `cards/banksly.mp3` | Played to the board (over the landing bed) | Banksly — play cue (~0.4s). | ⬜ |
| `cards/beatboxer.death.mp3` | Dies in combat (over the death bed) | Beatbot — death cue (~0.4s). | ⬜ |
| `cards/beatboxer.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/beatboxer.mp3` | Played to the board (over the landing bed) | Beatbot — play cue (~0.4s). | ⬜ |
| `cards/betterbot.death.mp3` | Dies in combat (over the death bed) | Better Bot — death cue (~0.4s). | ⬜ |
| `cards/betterbot.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/betterbot.mp3` | Played to the board (over the landing bed) | Better Bot — play cue (~0.4s). | ⬜ |
| `cards/bountybot.death.mp3` | Dies in combat (over the death bed) | Bounty Bot — death cue (~0.4s). | ⬜ |
| `cards/bountybot.effect.mp3` | on-kill procs (shop or combat) | Bounty Bot — on-kill proc cue (~0.4s). | ⬜ |
| `cards/bountybot.mp3` | Played to the board (over the landing bed) | Bounty Bot — play cue (~0.4s). | ⬜ |
| `cards/cling.death.mp3` | Dies in combat (over the death bed) | Cling Drone — death cue (~0.4s). | ⬜ |
| `cards/cling.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/cling.mp3` | Played to the board (over the landing bed) | Cling Drone — play cue (~0.4s). | ⬜ |
| `cards/combinator.death.mp3` | Dies in combat (over the death bed) | Combinator — death cue (~0.4s). | ⬜ |
| `cards/combinator.effect.mp3` | endOfTurn procs (shop or combat) | Combinator — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/combinator.mp3` | Played to the board (over the landing bed) | Combinator — play cue (~0.4s). | ⬜ |
| `cards/drone.death.mp3` | Dies in combat (over the death bed) | Warding Drone — death cue (~0.4s). | ⬜ |
| `cards/drone.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/drone.mp3` | Played to the board (over the landing bed) | Warding Drone — play cue (~0.4s). | ⬜ |
| `cards/fieldmechanic.death.mp3` | Dies in combat (over the death bed) | Field Mechanic — death cue (~0.4s). | ⬜ |
| `cards/fieldmechanic.effect.mp3` | Battlecry procs (shop or combat) | Field Mechanic — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/fieldmechanic.mp3` | Played to the board (over the landing bed) | Field Mechanic — play cue (~0.4s). | ⬜ |
| `cards/jouster.death.mp3` | Dies in combat (over the death bed) | Mechanical Jouster — death cue (~0.4s). | ⬜ |
| `cards/jouster.effect.mp3` | onAttack procs (shop or combat) | Mechanical Jouster — onAttack proc cue (~0.4s). | ⬜ |
| `cards/jouster.mp3` | Played to the board (over the landing bed) | Mechanical Jouster — play cue (~0.4s). | ⬜ |
| `cards/junk.death.mp3` | Dies in combat (over the death bed) | Junkyard Titan — death cue (~0.4s). | ⬜ |
| `cards/junk.effect.mp3` | Deathrattle procs (shop or combat) | Junkyard Titan — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/junk.mp3` | Played to the board (over the landing bed) | Junkyard Titan — play cue (~0.4s). | ⬜ |
| `cards/moe.death.mp3` | Dies in combat (over the death bed) | Moe — death cue (~0.4s). | ⬜ |
| `cards/moe.effect.mp3` | on-kill procs (shop or combat) | Moe — on-kill proc cue (~0.4s). | ⬜ |
| `cards/moe.mp3` | Played to the board (over the landing bed) | Moe — play cue (~0.4s). | ⬜ |
| `cards/moneybot.death.mp3` | Dies in combat (over the death bed) | Money Bot — death cue (~0.4s). | ⬜ |
| `cards/moneybot.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/moneybot.mp3` | Played to the board (over the landing bed) | Money Bot — play cue (~0.4s). | ⬜ |
| `cards/moneymaker.death.mp3` | Dies in combat (over the death bed) | Money Maker — death cue (~0.4s). | ⬜ |
| `cards/moneymaker.effect.mp3` | endOfTurn procs (shop or combat) | Money Maker — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/moneymaker.mp3` | Played to the board (over the landing bed) | Money Maker — play cue (~0.4s). | ⬜ |
| `cards/nanon.death.mp3` | Dies in combat (over the death bed) | Nanon — death cue (~0.4s). | ⬜ |
| `cards/nanon.effect.mp3` | Deathrattle procs (shop or combat) | Nanon — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/nanon.mp3` | Played to the board (over the landing bed) | Nanon — play cue (~0.4s). | ⬜ |
| `cards/scrapherald.death.mp3` | Dies in combat (over the death bed) | Attachment Mechanic — death cue (~0.4s). | ⬜ |
| `cards/scrapherald.effect.mp3` | Battlecry procs (shop or combat) | Attachment Mechanic — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/scrapherald.mp3` | Played to the board (over the landing bed) | Attachment Mechanic — play cue (~0.4s). | ⬜ |
| `cards/selfless.death.mp3` | Dies in combat (over the death bed) | Selfless Sentinel — death cue (~0.4s). | ⬜ |
| `cards/selfless.effect.mp3` | Deathrattle procs (shop or combat) | Selfless Sentinel — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/selfless.mp3` | Played to the board (over the landing bed) | Selfless Sentinel — play cue (~0.4s). | ⬜ |
| `cards/sparkcapacitor.death.mp3` | Dies in combat (over the death bed) | Spark Capacitor — death cue (~0.4s). | ⬜ |
| `cards/sparkcapacitor.effect.mp3` | avenge procs (shop or combat) | Spark Capacitor — avenge proc cue (~0.4s). | ⬜ |
| `cards/sparkcapacitor.mp3` | Played to the board (over the landing bed) | Spark Capacitor — play cue (~0.4s). | ⬜ |
| `cards/speedy.death.mp3` | Dies in combat (over the death bed) | Speedy — death cue (~0.4s). | ⬜ |
| `cards/speedy.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/speedy.mp3` | Played to the board (over the landing bed) | Speedy — play cue (~0.4s). | ⬜ |

### Demons (51)

| Filename | Trigger | Creative brief | Status |
|---|---|---|---|
| `cards/abhorrenthorror.death.mp3` | Dies in combat (over the death bed) | Abhorrent Horror — death cue (~0.4s). | ⬜ |
| `cards/abhorrenthorror.effect.mp3` | Start-of-Combat procs (shop or combat) | Abhorrent Horror — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/abhorrenthorror.mp3` | Played to the board (over the landing bed) | Abhorrent Horror — play cue (~0.4s). | ⬜ |
| `cards/abyssalfeeder.death.mp3` | Dies in combat (over the death bed) | Abyssal Feeder — death cue (~0.4s). | ⬜ |
| `cards/abyssalfeeder.effect.mp3` | endOfTurn procs (shop or combat) | Abyssal Feeder — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/abyssalfeeder.mp3` | Played to the board (over the landing bed) | Abyssal Feeder — play cue (~0.4s). | ⬜ |
| `cards/acid.death.mp3` | Dies in combat (over the death bed) | Korok, the Hungerer — death cue (~0.4s). | ⬜ |
| `cards/acid.effect.mp3` | goldSpent procs (shop or combat) | Korok, the Hungerer — goldSpent proc cue (~0.4s). | ⬜ |
| `cards/acid.mp3` | Played to the board (over the landing bed) | Korok, the Hungerer — play cue (~0.4s). | ⬜ |
| `cards/bloodbinder.death.mp3` | Dies in combat (over the death bed) | Bloodbinder — death cue (~0.4s). | ⬜ |
| `cards/bloodbinder.effect.mp3` | onAttack procs (shop or combat) | Bloodbinder — onAttack proc cue (~0.4s). | ⬜ |
| `cards/bloodbinder.mp3` | Played to the board (over the landing bed) | Bloodbinder — play cue (~0.4s). | ⬜ |
| `cards/brood.death.mp3` | Dies in combat (over the death bed) | Brood Matron — death cue (~0.4s). | ⬜ |
| `cards/brood.effect.mp3` | Deathrattle procs (shop or combat) | Brood Matron — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/brood.mp3` | Played to the board (over the landing bed) | Brood Matron — play cue (~0.4s). | ⬜ |
| `cards/burialimp.death.mp3` | Dies in combat (over the death bed) | Burial Imp — death cue (~0.4s). | ⬜ |
| `cards/burialimp.effect.mp3` | Deathrattle procs (shop or combat) | Burial Imp — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/burialimp.mp3` | Played to the board (over the landing bed) | Burial Imp — play cue (~0.4s). | ⬜ |
| `cards/feed.death.mp3` | Dies in combat (over the death bed) | Soulfeeder — death cue (~0.4s). | ⬜ |
| `cards/feed.effect.mp3` | Battlecry procs (shop or combat) | Soulfeeder — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/feed.mp3` | Played to the board (over the landing bed) | Soulfeeder — play cue (~0.4s). | ⬜ |
| `cards/godfodder.death.mp3` | Dies in combat (over the death bed) | The Godfodder — death cue (~0.4s). | ⬜ |
| `cards/godfodder.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/godfodder.mp3` | Played to the board (over the landing bed) | The Godfodder — play cue (~0.4s). | ⬜ |
| `cards/heckbinder.death.mp3` | Dies in combat (over the death bed) | Heckbinder — death cue (~0.4s). | ⬜ |
| `cards/heckbinder.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/heckbinder.mp3` | Played to the board (over the landing bed) | Heckbinder — play cue (~0.4s). | ⬜ |
| `cards/impala.death.mp3` | Dies in combat (over the death bed) | Commander Impala — death cue (~0.4s). | ⬜ |
| `cards/impala.effect.mp3` | on-kill procs (shop or combat) | Commander Impala — on-kill proc cue (~0.4s). | ⬜ |
| `cards/impala.mp3` | Played to the board (over the landing bed) | Commander Impala — play cue (~0.4s). | ⬜ |
| `cards/impking.death.mp3` | Dies in combat (over the death bed) | Imp King — death cue (~0.4s). | ⬜ |
| `cards/impking.effect.mp3` | Deathrattle procs (shop or combat) | Imp King — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/impking.mp3` | Played to the board (over the landing bed) | Imp King — play cue (~0.4s). | ⬜ |
| `cards/impoverseer.death.mp3` | Dies in combat (over the death bed) | Imp Overseer — death cue (~0.4s). | ⬜ |
| `cards/impoverseer.effect.mp3` | Battlecry procs (shop or combat) | Imp Overseer — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/impoverseer.mp3` | Played to the board (over the landing bed) | Imp Overseer — play cue (~0.4s). | ⬜ |
| `cards/maw.death.mp3` | Dies in combat (over the death bed) | Maw of the Pit — death cue (~0.4s). | ⬜ |
| `cards/maw.effect.mp3` | endOfTurn procs (shop or combat) | Maw of the Pit — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/maw.mp3` | Played to the board (over the landing bed) | Maw of the Pit — play cue (~0.4s). | ⬜ |
| `cards/pitsupplier.death.mp3` | Dies in combat (over the death bed) | Pit Supplier — death cue (~0.4s). | ⬜ |
| `cards/pitsupplier.effect.mp3` | avenge procs (shop or combat) | Pit Supplier — avenge proc cue (~0.4s). | ⬜ |
| `cards/pitsupplier.mp3` | Played to the board (over the landing bed) | Pit Supplier — play cue (~0.4s). | ⬜ |
| `cards/ritualist.death.mp3` | Dies in combat (over the death bed) | Ritualist — death cue (~0.4s). | ⬜ |
| `cards/ritualist.effect.mp3` | endOfTurn procs (shop or combat) | Ritualist — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/ritualist.mp3` | Played to the board (over the landing bed) | Ritualist — play cue (~0.4s). | ⬜ |
| `cards/swordbored.death.mp3` | Dies in combat (over the death bed) | Sword and Bored — death cue (~0.4s). | ⬜ |
| `cards/swordbored.effect.mp3` | on-kill procs (shop or combat) | Sword and Bored — on-kill proc cue (~0.4s). | ⬜ |
| `cards/swordbored.mp3` | Played to the board (over the landing bed) | Sword and Bored — play cue (~0.4s). | ⬜ |
| `cards/trickster.death.mp3` | Dies in combat (over the death bed) | Trickster — death cue (~0.4s). | ⬜ |
| `cards/trickster.effect.mp3` | Deathrattle procs (shop or combat) | Trickster — Deathrattle proc cue (~0.4s). | ⬜ |
| `cards/trickster.mp3` | Played to the board (over the landing bed) | Trickster — play cue (~0.4s). | ⬜ |

### Tokens (102)

| Filename | Trigger | Creative brief | Status |
|---|---|---|---|
| `cards/bonetaxer.death.mp3` | Dies in combat (over the death bed) | Bone Taxer — death cue (~0.4s). | ⬜ |
| `cards/bonetaxer.effect.mp3` | avenge procs (shop or combat) | Bone Taxer — avenge proc cue (~0.4s). | ⬜ |
| `cards/bonetaxer.mp3` | Played to the board (over the landing bed) | Bone Taxer — play cue (~0.4s). | ⬜ |
| `cards/chimerus.death.mp3` | Dies in combat (over the death bed) | Chimerus — death cue (~0.4s). | ⬜ |
| `cards/chimerus.effect.mp3` | onAttack procs (shop or combat) | Chimerus — onAttack proc cue (~0.4s). | ⬜ |
| `cards/chimerus.mp3` | Played to the board (over the landing bed) | Chimerus — play cue (~0.4s). | ⬜ |
| `cards/chorusengine.death.mp3` | Dies in combat (over the death bed) | Chorus Engine — death cue (~0.4s). | ⬜ |
| `cards/chorusengine.effect.mp3` | onAttack procs (shop or combat) | Chorus Engine — onAttack proc cue (~0.4s). | ⬜ |
| `cards/chorusengine.mp3` | Played to the board (over the landing bed) | Chorus Engine — play cue (~0.4s). | ⬜ |
| `cards/contractimp.death.mp3` | Dies in combat (over the death bed) | Contract Imp — death cue (~0.4s). | ⬜ |
| `cards/contractimp.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/contractimp.mp3` | Played to the board (over the landing bed) | Contract Imp — play cue (~0.4s). | ⬜ |
| `cards/cryptbroker.death.mp3` | Dies in combat (over the death bed) | Crypt Broker — death cue (~0.4s). | ⬜ |
| `cards/cryptbroker.effect.mp3` | Battlecry procs (shop or combat) | Crypt Broker — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/cryptbroker.mp3` | Played to the board (over the landing bed) | Crypt Broker — play cue (~0.4s). | ⬜ |
| `cards/cryptwolf.death.mp3` | Dies in combat (over the death bed) | Crypt Wolf — death cue (~0.4s). | ⬜ |
| `cards/cryptwolf.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/cryptwolf.mp3` | Played to the board (over the landing bed) | Crypt Wolf — play cue (~0.4s). | ⬜ |
| `cards/discoverspell.death.mp3` | Dies in combat (over the death bed) | Triple Reward — death cue (~0.4s). | ⬜ |
| `cards/discoverspell.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/discoverspell.mp3` | Played to the board (over the landing bed) | Triple Reward — play cue (~0.4s). | ⬜ |
| `cards/echowarden.death.mp3` | Dies in combat (over the death bed) | Echo Warden — death cue (~0.4s). | ⬜ |
| `cards/echowarden.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/echowarden.mp3` | Played to the board (over the landing bed) | Echo Warden — play cue (~0.4s). | ⬜ |
| `cards/feastingbogrot.death.mp3` | Dies in combat (over the death bed) | Feasting Bogrot — death cue (~0.4s). | ⬜ |
| `cards/feastingbogrot.effect.mp3` | endOfTurn procs (shop or combat) | Feasting Bogrot — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/feastingbogrot.mp3` | Played to the board (over the landing bed) | Feasting Bogrot — play cue (~0.4s). | ⬜ |
| `cards/footman.death.mp3` | Dies in combat (over the death bed) | Footman — death cue (~0.4s). | ⬜ |
| `cards/footman.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/footman.mp3` | Played to the board (over the landing bed) | Footman — play cue (~0.4s). | ⬜ |
| `cards/fred.death.mp3` | Dies in combat (over the death bed) | Fred — death cue (~0.4s). | ⬜ |
| `cards/fred.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/fred.mp3` | Played to the board (over the landing bed) | Fred — play cue (~0.4s). | ⬜ |
| `cards/gravebody.death.mp3` | Dies in combat (over the death bed) | Grave Body — death cue (~0.4s). | ⬜ |
| `cards/gravebody.effect.mp3` | Start-of-Combat procs (shop or combat) | Grave Body — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/gravebody.mp3` | Played to the board (over the landing bed) | Grave Body — play cue (~0.4s). | ⬜ |
| `cards/gravetwin.death.mp3` | Dies in combat (over the death bed) | Gravetwin — death cue (~0.4s). | ⬜ |
| `cards/gravetwin.effect.mp3` | Battlecry procs (shop or combat) | Gravetwin — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/gravetwin.mp3` | Played to the board (over the landing bed) | Gravetwin — play cue (~0.4s). | ⬜ |
| `cards/heraldapoc.death.mp3` | Dies in combat (over the death bed) | Herald of the Apocalypse — death cue (~0.4s). | ⬜ |
| `cards/heraldapoc.effect.mp3` | Battlecry procs (shop or combat) | Herald of the Apocalypse — Battlecry proc cue (~0.4s). | ⬜ |
| `cards/heraldapoc.mp3` | Played to the board (over the landing bed) | Herald of the Apocalypse — play cue (~0.4s). | ⬜ |
| `cards/hoardwhelp.death.mp3` | Dies in combat (over the death bed) | Hoard Whelp — death cue (~0.4s). | ⬜ |
| `cards/hoardwhelp.effect.mp3` | on-sell procs (shop or combat) | Hoard Whelp — on-sell proc cue (~0.4s). | ⬜ |
| `cards/hoardwhelp.mp3` | Played to the board (over the landing bed) | Hoard Whelp — play cue (~0.4s). | ⬜ |
| `cards/impscrap.death.mp3` | Dies in combat (over the death bed) | Imp — death cue (~0.4s). | ⬜ |
| `cards/impscrap.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/impscrap.mp3` | Played to the board (over the landing bed) | Imp — play cue (~0.4s). | ⬜ |
| `cards/lazarus.death.mp3` | Dies in combat (over the death bed) | Lazarus — death cue (~0.4s). | ⬜ |
| `cards/lazarus.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/lazarus.mp3` | Played to the board (over the landing bed) | Lazarus — play cue (~0.4s). | ⬜ |
| `cards/nanobot.death.mp3` | Dies in combat (over the death bed) | Nanobot — death cue (~0.4s). | ⬜ |
| `cards/nanobot.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/nanobot.mp3` | Played to the board (over the landing bed) | Nanobot — play cue (~0.4s). | ⬜ |
| `cards/perfectcore.death.mp3` | Dies in combat (over the death bed) | Perfect Core — death cue (~0.4s). | ⬜ |
| `cards/perfectcore.effect.mp3` | onAttack procs (shop or combat) | Perfect Core — onAttack proc cue (~0.4s). | ⬜ |
| `cards/perfectcore.mp3` | Played to the board (over the landing bed) | Perfect Core — play cue (~0.4s). | ⬜ |
| `cards/pup.death.mp3` | Dies in combat (over the death bed) | Pup — death cue (~0.4s). | ⬜ |
| `cards/pup.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/pup.mp3` | Played to the board (over the landing bed) | Pup — play cue (~0.4s). | ⬜ |
| `cards/reconfiguredcombinator.death.mp3` | Dies in combat (over the death bed) | Reconfigured Combinator — death cue (~0.4s). | ⬜ |
| `cards/reconfiguredcombinator.effect.mp3` | battlecryTriggered procs (shop or combat) | Reconfigured Combinator — battlecryTriggered proc cue (~0.4s). | ⬜ |
| `cards/reconfiguredcombinator.mp3` | Played to the board (over the landing bed) | Reconfigured Combinator — play cue (~0.4s). | ⬜ |
| `cards/runmaw.death.mp3` | Dies in combat (over the death bed) | Run Maw — death cue (~0.4s). | ⬜ |
| `cards/runmaw.effect.mp3` | Start-of-Combat procs (shop or combat) | Run Maw — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/runmaw.mp3` | Played to the board (over the landing bed) | Run Maw — play cue (~0.4s). | ⬜ |
| `cards/sabercub.death.mp3` | Dies in combat (over the death bed) | Void Cub — death cue (~0.4s). | ⬜ |
| `cards/sabercub.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/sabercub.mp3` | Played to the board (over the landing bed) | Void Cub — play cue (~0.4s). | ⬜ |
| `cards/scrapvendor.death.mp3` | Dies in combat (over the death bed) | Scrap Vendor — death cue (~0.4s). | ⬜ |
| `cards/scrapvendor.effect.mp3` | endOfTurn procs (shop or combat) | Scrap Vendor — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/scrapvendor.mp3` | Played to the board (over the landing bed) | Scrap Vendor — play cue (~0.4s). | ⬜ |
| `cards/skybound.death.mp3` | Dies in combat (over the death bed) | Skybound Archivist — death cue (~0.4s). | ⬜ |
| `cards/skybound.effect.mp3` | endOfTurn procs (shop or combat) | Skybound Archivist — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/skybound.mp3` | Played to the board (over the landing bed) | Skybound Archivist — play cue (~0.4s). | ⬜ |
| `cards/spiritworgen.death.mp3` | Dies in combat (over the death bed) | Spirit Worgen — death cue (~0.4s). | ⬜ |
| `cards/spiritworgen.effect.mp3` | endOfTurn procs (shop or combat) | Spirit Worgen — endOfTurn proc cue (~0.4s). | ⬜ |
| `cards/spiritworgen.mp3` | Played to the board (over the landing bed) | Spirit Worgen — play cue (~0.4s). | ⬜ |
| `cards/stray.death.mp3` | Dies in combat (over the death bed) | Stray — death cue (~0.4s). | ⬜ |
| `cards/stray.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/stray.mp3` | Played to the board (over the landing bed) | Stray — play cue (~0.4s). | 🎙️ |
| `cards/symbioticattachment.death.mp3` | Dies in combat (over the death bed) | Chaos Attachment — death cue (~0.4s). | ⬜ |
| `cards/symbioticattachment.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/symbioticattachment.mp3` | Played to the board (over the landing bed) | Chaos Attachment — play cue (~0.4s). | ⬜ |
| `cards/taragosa.death.mp3` | Dies in combat (over the death bed) | Taragosa — death cue (~0.4s). | ⬜ |
| `cards/taragosa.effect.mp3` | onAttack procs (shop or combat) | Taragosa — onAttack proc cue (~0.4s). | ⬜ |
| `cards/taragosa.mp3` | Played to the board (over the landing bed) | Taragosa — play cue (~0.4s). | ⬜ |
| `cards/taragosaheir.death.mp3` | Dies in combat (over the death bed) | Taragosa's Heir — death cue (~0.4s). | ⬜ |
| `cards/taragosaheir.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/taragosaheir.mp3` | Played to the board (over the landing bed) | Taragosa's Heir — play cue (~0.4s). | ⬜ |
| `cards/taurustruth.death.mp3` | Dies in combat (over the death bed) | Taurus the Truth Bringer — death cue (~0.4s). | ⬜ |
| `cards/taurustruth.effect.mp3` | Start-of-Combat procs (shop or combat) | Taurus the Truth Bringer — Start-of-Combat proc cue (~0.4s). | ⬜ |
| `cards/taurustruth.mp3` | Played to the board (over the landing bed) | Taurus the Truth Bringer — play cue (~0.4s). | ⬜ |
| `cards/trailforager.death.mp3` | Dies in combat (over the death bed) | Trail Forager — death cue (~0.4s). | ⬜ |
| `cards/trailforager.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/trailforager.mp3` | Played to the board (over the landing bed) | Trail Forager — play cue (~0.4s). | ⬜ |
| `cards/trophystalker.death.mp3` | Dies in combat (over the death bed) | Trophy Stalker — death cue (~0.4s). | ⬜ |
| `cards/trophystalker.effect.mp3` | onAttack procs (shop or combat) | Trophy Stalker — onAttack proc cue (~0.4s). | ⬜ |
| `cards/trophystalker.mp3` | Played to the board (over the landing bed) | Trophy Stalker — play cue (~0.4s). | ⬜ |
| `cards/whelpling.death.mp3` | Dies in combat (over the death bed) | Whelp — death cue (~0.4s). | ⬜ |
| `cards/whelpling.effect.mp3` | Vanilla — no effect to proc | (vanilla — no clip needed) | ➖ |
| `cards/whelpling.mp3` | Played to the board (over the landing bed) | Whelp — play cue (~0.4s). | ⬜ |
