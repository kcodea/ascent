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
| Spell **default bed** | `audio/spellcast.mp3` | any spell cast | ⚠️ replace synth `castSpell()` |
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
