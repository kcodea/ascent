/**
 * The `fx/` sound clips named straight from CODE rather than from an FX def: the hero-attack styles' tuner defaults,
 * the Discover and Ancients entrances, King Oona's banana, and so on. A phone decodes them ahead of a fight
 * (audio/clipIndex.ts, R-TOUCH-AUDIO-QUALITY-01) because nothing else says they will play.
 *
 * A committed SNAPSHOT of a scan of `packages/ui/src` (every `'fx/<slug>'` literal in a non-test .ts/.tsx file whose
 * clip is in `audio/fx/`). `codeClips.test.ts` re-runs the scan and fails, printing the list, when this drifts.
 */
export const CODE_FX_CLIPS: readonly string[] = [
  'fx/alexis_gaming_cam-woosh-long-cartoon-370386',
  'fx/bball-dribble',
  'fx/bball-ooh',
  'fx/bball-rim',
  'fx/bball-squeak',
  'fx/bball-swish',
  'fx/bball-whistle',
  'fx/blue-impact-hit',
  'fx/cheering',
  'fx/djartmusic-christmas-sparkle-whoosh-1-275404',
  'fx/dragon-growl',
  'fx/dragon-growl-2',
  'fx/heavy-rock-impact',
  'fx/metal-woosh',
  'fx/oona-launch',
  'fx/oona-powerup',
  'fx/oona-splat',
  'fx/soumages-magic-spell-333896',
  'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
  'fx/stereogenicstudio-swish-swoosh-woosh-sfx-39-357160',
  'fx/triple-impact',
  'fx/universfield-cinematic-swoosh-impact-454392',
  'fx/universfield-ground-impact-352053',
  'fx/universfield-whip-snap-242215',
  'fx/voidpanthergrowl',
  'fx/waking-rift',
  'fx/whoosh-03',
];
