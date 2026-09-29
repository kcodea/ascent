# Card clips normalized to one loudness

**2026-09-29.** The owner found the card voicelines uneven even after turning them down ("some voices are a bit softer,
some are much louder, so a general 10% still doesnt work perfectly"). Measured in the browser: card clips spanned
about 37 dB (−42 to −6 LUFS). Creature sound effects came out loud; many TTS lines came out quiet.

- `ffmpeg-static` added as a root dev dependency (no system ffmpeg on the owner's machine).
- `npm run sfx:normalize`: compress (3:1 above −24 dB), then two-pass `loudnorm` to −20 LUFS / −1 dBTP, one linear gain
  per clip. Idempotent via `packages/ui/src/audio/fx/normalized.json` (content hashes).
- `vo:approve` normalizes each card clip it approves.
- All 328 existing `vo-*` clips normalized: now −24.9 to −19.5 LUFS (median −20.5). The few under target are very
  short clips held down by the true-peak ceiling.
- Next: re-tune the binding gains (On Play 0.3, On Death 0.1) by ear, since death clips were louder before
  and now sit level with play clips.
