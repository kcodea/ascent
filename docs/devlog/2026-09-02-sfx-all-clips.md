# 2026-09-02 — the SFX mixing desk shows every clip (per-clip channel faders + the missing gaps)

## The ask

Owner: overhaul the SFX mixing board later, but first "make sure that whatever we use for sound, always has all
sound effects in it — there must be tons that are missing." Chose one fader per clip (all 83), auto-derived
from the files so it stays complete as clips are added.

## What was actually missing

At the **category** level the board was nearly complete (60 categories). The real gaps:

- **`ceremony`** (the hero-select stingers — `asiansong`, `ceremonyrevealsound`, `woosh1`, `woosh2`) played
  under a category with **no fader at all**, riding the generic `ui`/0.6 fallback.
- **`auctioneerhp`** and **`runeselect`** were named clips also routed to the `ui` fallback with no fader.
- Every other "tons missing" was at the **clip** level: bundle categories hid many distinct sounds under one
  slider — `attack` (5: windup, TallyTravel, AttackPillAdd, tallyimpact, tallycounter), `heroSelect` (~11 hero
  VO clips), `cardVoice`/`cardEffect`/`cardDeath`, `buy`/`sell`/`smack` variants, and the equipment clips
  (already per-clip since 2026-08-31 — the pattern this generalizes).

## What shipped

- **`audio/clipFamily.ts`** (pure, no Web Audio): `familyOf(clip)` maps every committed clip to its mixer
  category (directory rules for heroes/cards/ceremony, the equipment map, numbered-variant bases, a small
  irregular table for the renamed ones, else 1:1), plus an optional `CLIP_LABEL` for pretty names. A new
  **completeness test** (`clipFamily.test.ts`) reads the audio tree and fails if any clip resolves to a
  non-category — so a newly-dropped `.mp3` can never silently go missing again. It can't catch a clip pointed
  at the WRONG group (only an ear can), but "missing entirely" is now impossible.
- **`config.ts`**: added `ceremony`, `auctioneerhp`, `runeselect` categories, each seeded at the **0.6 they
  already played at**, so the mix is unchanged. Buses: ceremony + auctioneer on `hero`, rune-select on `ui` —
  inert today (every bus is gain 1, no comp), so this only changes where they GROUP on the desk, not the sound.
- **`sfx.ts`**: routed the two `ui`-fallback clips to their own categories; added the per-clip desk API
  (`clipNames`, `clipGain`, `setClipGain`, `previewClip`). `previewClip` plays one exact clip via
  `familyOf`.
- **`SfxMixer.tsx`**: under each **multi-clip** category, a compact channel fader per clip (▶ · fader · number ·
  name), auto-derived from the audio glob so new files appear with no code. A **1-clip** category keeps just its
  group fader (that fader already moves its one sound). Each channel is a **multiplier on the group** fader
  (1 = untouched → the mix is preserved exactly; the config stays sparse, storing only moved clips).

This is the foundation for the coming mixing-desk overhaul, not the overhaul itself: the data model is
unchanged (categories + a per-clip `clips` multiplier that already existed), only now every sound is visible
and individually tunable.

## Verified

95 audio tests green (85 per-clip home checks + config + scenes), typecheck (web) + lint clean. Live: dev desk
lists every clip; owner to confirm the mix by ear.
