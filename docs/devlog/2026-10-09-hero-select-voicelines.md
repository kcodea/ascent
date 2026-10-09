# 2026-10-09 — Hero select voicelines for every hero

All 59 playable heroes now speak when picked in Hero Select. The owner recorded 10 of them by hand (unchanged);
the other 49 were generated with ElevenLabs.

- **Casting:** each hero got one community voice from the ElevenLabs Voice Library, picked by the owner from 3+
  candidates per hero on the Announcer Script Desk tracker (Review tab). Library voices cost no custom-voice slot.
  Each is in `packages/tools/vo-lines.json` as `hero-<heroId>` with `dest: packages/ui/src/audio/heroes`, and its
  line under `lines` with `id: <heroId>`.
- **Wiring:** none needed. `sfx.heroSelect` already plays `audio/heroes/<heroId>.mp3` (import.meta.glob), so an
  approved clip is live after a dev-server restart.
- **Loudness (owner ask):** the hero lines are levelled to the owner's own recordings, not to the card clips. The
  10 hand recordings measured −29.7 to −16.7 LUFS, averaging **−22.8 LUFS** (`HERO_SELECT_LUFS` in
  `sfx-normalize.lib.ts`). All 59 select lines (the 10 recordings AND the 49 generated ones, from their raw takes so
  nothing was compressed twice) went through the card chain (gentle compressor + two-pass loudnorm, −1 dBTP) at that
  target, and now sit at −23.3 to −22.9 LUFS. `normalizeFile` takes the target as an optional second argument (card
  clips still default to −20). `gorun.power.mp3` is a hero-POWER cue, not a select line, and was left alone.
  `sfx:normalize` still only touches `audio/fx/vo-*`, so it never rewrites hero files.
- **Re-doing a line:** delete `audio/heroes/<heroId>.mp3`, edit the line or voice in `vo-lines.json`, then
  `npm run vo:generate -- --only <heroId>` and `npm run vo:approve -- <heroId> <take>` (approve refuses to
  overwrite, so the delete is required), then `normalizeFile(<file>, HERO_SELECT_LUFS)`.
