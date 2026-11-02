/**
 * The `fx/` sound clips named straight from CODE rather than from an FX def: the Discover and Ancients entrances, the
 * crate, the lobby reveal, and the hero-attack styles. A phone decodes them ahead of a fight (audio/clipIndex.ts,
 * R-TOUCH-AUDIO-QUALITY-01) because nothing else says they will play.
 *
 * Split in two (R-AUDIO-PREWARM-ATTACKS-01, 2026-11-02): `CODE_FX_CLIPS` are the SHARED ones (named outside a
 * `hero<Style>/` folder), always decoded ahead; `ATTACK_FX_CLIPS` are each hero-attack style's own (named inside its
 * `hero<Style>/` folder), decoded ahead only for the styles actually in play (yours and your current opponent's).
 *
 * A committed SNAPSHOT of a scan of `packages/ui/src` (every `'fx/<slug>'` literal in a non-test .ts/.tsx file whose
 * clip is in `audio/fx/`). `codeClips.test.ts` re-runs the scan and fails, printing the lists, when this drifts.
 */
export const CODE_FX_CLIPS: readonly string[] = [
  'fx/alexis_gaming_cam-woosh-long-cartoon-370386',
  'fx/djartmusic-christmas-sparkle-whoosh-1-275404',
  'fx/metal-woosh',
  'fx/soumages-magic-spell-333896',
  'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
  'fx/stereogenicstudio-swish-swoosh-woosh-sfx-39-357160',
  'fx/triple-impact',
  'fx/universfield-cinematic-swoosh-impact-454392',
  'fx/universfield-ground-impact-352053',
  'fx/waking-rift',
  'fx/whoosh-03',
];

/** Each hero-attack style's own clips (the style is the `hero<Style>/` folder name, lower-cased). */
export const ATTACK_FX_CLIPS: Readonly<Record<string, readonly string[]>> = {
  arcana: [
    'fx/blue-impact-hit',
    'fx/djartmusic-christmas-sparkle-whoosh-1-275404',
    'fx/oona-powerup',
    'fx/triple-impact',
  ],
  backstab: [
    'fx/metal-woosh',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
    'fx/universfield-whip-snap-242215',
  ],
  banana: [
    'fx/djartmusic-christmas-sparkle-whoosh-1-275404',
    'fx/heavy-rock-impact',
    'fx/metal-woosh',
    'fx/oona-launch',
    'fx/oona-powerup',
    'fx/oona-splat',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
  ],
  baseball: [
    'fx/baseball-bonk',
    'fx/baseball-brawl',
    'fx/baseball-charge',
    'fx/baseball-crack',
    'fx/baseball-fall',
    'fx/baseball-glove',
    'fx/baseball-out',
    'fx/bball-dribble',
    'fx/bball-ooh',
    'fx/cheering',
    'fx/heavy-rock-impact',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
  ],
  basketball: [
    'fx/bball-dribble',
    'fx/bball-ooh',
    'fx/bball-rim',
    'fx/bball-squeak',
    'fx/bball-swish',
    'fx/bball-whistle',
    'fx/cheering',
    'fx/heavy-rock-impact',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
  ],
  beast: [
    'fx/dragon-growl',
    'fx/dragon-growl-2',
    'fx/heavy-rock-impact',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
    'fx/universfield-whip-snap-242215',
    'fx/voidpanthergrowl',
  ],
  blades: [
    'fx/metal-woosh',
    'fx/triple-impact',
    'fx/universfield-cinematic-swoosh-impact-454392',
    'fx/universfield-whip-snap-242215',
  ],
  blast: [
    'fx/blue-impact-hit',
    'fx/oona-launch',
    'fx/oona-powerup',
    'fx/triple-impact',
    'fx/universfield-cinematic-swoosh-impact-454392',
  ],
  bleed: [
    'fx/metal-woosh',
    'fx/oona-splat',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
    'fx/universfield-cinematic-swoosh-impact-454392',
    'fx/universfield-whip-snap-242215',
  ],
  boomerang: [
    'fx/metal-woosh',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
  ],
  bubble: [
    'fx/oona-splat',
  ],
  bullettime: [
    'fx/blue-impact-hit',
    'fx/djartmusic-christmas-sparkle-whoosh-1-275404',
    'fx/universfield-cinematic-swoosh-impact-454392',
  ],
  cards: [
    'fx/djartmusic-christmas-sparkle-whoosh-1-275404',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
    'fx/universfield-whip-snap-242215',
  ],
  coin: [
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
    'fx/universfield-whip-snap-242215',
  ],
  enraged: [
    'fx/dragon-growl',
    'fx/heavy-rock-impact',
    'fx/oona-powerup',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
    'fx/triple-impact',
    'fx/universfield-ground-impact-352053',
  ],
  fire: [
    'fx/blue-impact-hit',
    'fx/oona-powerup',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
    'fx/triple-impact',
    'fx/universfield-cinematic-swoosh-impact-454392',
    'fx/universfield-ground-impact-352053',
  ],
  frost: [
    'fx/blue-impact-hit',
    'fx/djartmusic-christmas-sparkle-whoosh-1-275404',
    'fx/metal-woosh',
    'fx/universfield-cinematic-swoosh-impact-454392',
  ],
  holy: [
    'fx/blue-impact-hit',
    'fx/djartmusic-christmas-sparkle-whoosh-1-275404',
    'fx/metal-woosh',
    'fx/universfield-cinematic-swoosh-impact-454392',
  ],
  poison: [
    'fx/oona-splat',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
    'fx/universfield-whip-snap-242215',
  ],
  quake: [
    'fx/heavy-rock-impact',
    'fx/triple-impact',
    'fx/universfield-ground-impact-352053',
  ],
  soccer: [
    'fx/bball-rim',
    'fx/heavy-rock-impact',
    'fx/soccer-crowd-ooh',
    'fx/soccer-goal-roar',
    'fx/soccer-golazo',
    'fx/soccer-kick',
    'fx/soccer-net',
    'fx/soccer-whistle',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
  ],
  stitch: [
    'fx/blue-impact-hit',
    'fx/heavy-rock-impact',
    'fx/metal-woosh',
    'fx/oona-powerup',
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
    'fx/triple-impact',
    'fx/universfield-whip-snap-242215',
  ],
  storm: [
    'fx/blue-impact-hit',
    'fx/heavy-rock-impact',
  ],
  undead: [
    'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3',
    'fx/universfield-cinematic-swoosh-impact-454392',
    'fx/universfield-ground-impact-352053',
    'fx/voidpanthergrowl',
    'fx/waking-rift',
  ],
};
