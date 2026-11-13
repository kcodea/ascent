# The Flurry beam (2026-11-13)

Owner: "we should probably make a flurry beam huh", then "ok saved flurry-beam", then "i want it to be a woosh of air
and multiple airy swings of a sword or dagger".

- **Flurry joins the generic keyword launcher** (`fx/keywordBeam.ts`, `KEYWORD_BEAMS.W`), so a spell (pointer or hero
  portrait), a hero power and a rune send it with no further wiring. The launcher gained two options for the minion
  case: a per-card `def` (the card's own bound beam) and a lazy `from`, read as the beam leaves.
- **Runic Beetle's Flurry option.** A new binding kind, `flurryGiven`, bound to `flurry-beam`. Like his Rise option
  the grant is a mid-turn play, read off the board (`playedFlurryGrants`). The beam leaves Beetle and his +3 Attack
  buff tendril is dropped on that minion. This path goes through the generic launcher, not a copy of
  `riseGivenLaunch.ts`: only one card gives Flurry, and only in the Shop.
- **The held swirl.** `fx/flurryHold.ts` hides the Flurry rings on the card until the beam lands.
- **Combat.** No card gives another minion Flurry in combat. A rune-given Flurry is matched only when the grant names
  no source, because a body that gives ITSELF Flurry at Start of Combat names itself.
- **Sounds.** ElevenLabs sound generation, eleven takes over four prompts. Defaults picked by envelope: the whoosh that
  peaks 100 ms in for the launch, and the take with several separate swings for the landing. Both at 0.8 with a 7%
  pitch jitter. The owner auditions the rest.
- `flurry-beam` uses the custom image `fx/defs/art/slash.png`, committed with the def.
