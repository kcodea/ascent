# Generator: sound effects + Voice Design (the unit-sounds pipeline)

**2026-09-27.** The owner wants per-unit sounds at scale: humanoid units say a short line, beast-like units grunt or
growl, and each tribe gets a small cast of voices (about 5 archetypes) instead of one voice per unit. Dwarves go first.

- `vo-lines.json` gains `sfx` (a text prompt becomes a sound through ElevenLabs sound-generation) and `designs` (Voice
  Design descriptions). Lines may override their voice's `dest`. Clip ids now allow card ids (`dw_orin.death`).
- `npm run vo:generate` plans lines and sfx together. The dry run prints characters for lines and seconds for sfx.
  `vo:approve` knows that card clips need no wiring.
- New `npm run vo:design`: previews each description into `vo-drafts/voices/`. `save <key> <N>` keeps one as a
  permanent voice and writes it into `voices`.
- The five Dwarf cast descriptions are committed under `designs`. The tracker ("Announcer Script Desk") got a
  **Unit sounds** tab with the cast and a row for every Dwarf clip: 18 talkers and 12 grunters, plus death sounds.
- Card clips reuse the existing `audio/cards/<id>[.death|.effect].mp3` convention, so nothing in `packages/ui` changed.
- No credits were spent building this. Generation waits for the owner's go-ahead.
