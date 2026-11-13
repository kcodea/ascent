import {
  HERO_STARS_DEFAULTS, HERO_STARS_RANGES, STARS_LEVELS, STARS_TIER_SUFFIXES, getHeroStarsConfig, heroStarsStore, starsPlan, type StarsTierSuffix,
} from './heroStars/heroStarsConfig';
import { playHeroStars } from './heroStars/heroStars';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the WRITTEN IN THE STARS hero attack (Ancient; dev-only, no cosmetic yet): constellations. Four groups
 * of per-tier dials (I the arrow; II the bow; III the hunter; IV the medallion and the falling star), the stars and
 * lines, the figures, the shot, the colours and one clip / gain / pitch row per sound cue. The Play buttons at the top
 * play all four looks in either direction.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the bow.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the hunter.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): written in the stars (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Sky'],
  twinkle: ['Twinkle', '×', 'How much the small stars of the sky twinkle (0 = steady).', 'Sky'],
  skyHoldMs: ['Sky hold', 'ms', 'After the blow, how long before the night starts to fade (IV holds a little longer).', 'Sky'],
  starPx: ['Star size', 'px', 'A constellation star\'s four-point glint (each star has its own size on top).', 'Constellation'],
  lineWidth: ['Line width', 'px', 'How wide a constellation line glows.', 'Constellation'],
  ghostAlpha: ['III ghost', 'opacity', 'III: the faint body that fills in between the hunter\'s lines.', 'Constellation'],
  hunterSize: ['III hunter height', '×', 'III: the hunter\'s height in striking portrait radii (capped at half the screen).', 'Constellation'],
  medallionSize: ['IV medallion', '×', 'IV: the medallion\'s radius as a fraction of the screen height.', 'Constellation'],
  portraitAlpha: ['IV portrait', 'opacity', 'IV: the striking hero\'s own portrait inside the medallion.', 'Constellation'],
  fallLen: ['IV fall', '×', 'IV: how far the comet falls when there is sky above the struck hero, in struck portrait radii (else it arcs over the whole sky).', 'Shot'],
  swell: ['IV swell', '×', 'IV: how far the plucked star swells before it falls.', 'Shot'],
  hush: ['IV hush', '×', 'IV: how far every other star dims while the plucked star swells.', 'Shot'],
  cometSize: ['IV comet', '×', 'IV: the comet\'s head, in struck portrait radii across.', 'Shot'],
  skyFlash: ['Sky flash', 'opacity', 'The flash over the whole sky on the blow (IV in full, the lower looks a part of it).', 'Shot'],
  scatterMs: ['IV scatter after', 'ms', 'IV: after the blow, when the constellation\'s lines break into falling sparks.', 'Shot'],
  sparkFallMs: ['IV sparks drift', 'ms', 'IV: how long the falling sparks drift before they go out.', 'Shot'],
  arrowPx: ['Arrow least length', 'px', 'The arrow of starlight is as long as the arrow in its constellation, never shorter than this.', 'Shot'],
  trailWidth: ['Tail width', 'px', 'The luminous tail behind the arrow, at I (wider on the higher looks; the comet\'s follows its own size).', 'Shot'],
  trailLingerMs: ['Tail linger', 'ms', 'How long the line of light hangs along the shot\'s path after the blow (I and II half of it).', 'Shot'],
  impactSize: ['Nova size', '×', 'The nova of stardust on the blow (it grows with the tier).', 'Shot'],
  heroLiftPx: ['Hero lift', 'px', 'How far the striking hero rises, leans and rocks with its constellation.', 'Camera and portraits'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked on the blow.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the blow.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the blow.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxSkyGain: ['sky: gain', undefined, 'The shimmer swelling in as the night arrives.', 'Sound: sky'],
  sfxSkyRate: ['sky: pitch', '×', 'Pitch of the swell.', 'Sound: sky'],
  sfxTickGain: ['tick: gain', undefined, 'The tick as a line reaches a star (every second star on III and IV). It climbs in pitch through the trace.', 'Sound: tick'],
  sfxTickRate: ['tick: pitch', '×', 'Pitch of the tick at the middle of the trace.', 'Sound: tick'],
  sfxLooseGain: ['loose: gain', undefined, 'I to III: the snap of the string as the arrow leaves.', 'Sound: loose'],
  sfxLooseRate: ['loose: pitch', '×', 'Pitch of the loose.', 'Sound: loose'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'I to III: the airy pass of the arrow.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxWhooshStartMs: ['whoosh: start at', 'ms', 'Where in the whoosh clip to start (skips its slow start).', 'Sound: whoosh'],
  sfxFallGain: ['fall: gain', undefined, 'IV: the falling star and its landing.', 'Sound: fall'],
  sfxFallRate: ['fall: pitch', '×', 'Pitch of the falling star.', 'Sound: fall'],
  sfxFallHitMs: ['fall: landing at', 'ms', 'Where in the falling star clip the landing begins (the descent plays before it, timed to end on the blow).', 'Sound: fall'],
  sfxHitGain: ['fall: arrow landing gain', undefined, 'I to III: the landing part of the falling star clip, under the arrow\'s blow.', 'Sound: fall'],
  sfxHitRate: ['fall: arrow landing pitch', '×', 'Pitch of the arrow\'s landing.', 'Sound: fall'],
  sfxRiseGain: ['rise: gain', undefined, 'The rising swell under the draw of the bow (II, III) and under IV\'s star as it swells.', 'Sound: rise'],
  sfxRiseRate: ['rise: pitch', '×', 'Pitch of the rise.', 'Sound: rise'],
  sfxBoomGain: ['boom: gain', undefined, 'The low body under the blow: IV the whole deep boom, the arrows its first moment, quieter and higher.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom at IV.', 'Sound: boom'],
  sfxThrumGain: ['thrum: gain', undefined, 'I to III: the deep thrum of the bowstring under its snap.', 'Sound: thrum'],
  sfxThrumRate: ['thrum: pitch', '×', 'Pitch of the thrum.', 'Sound: thrum'],
  sfxBloomGain: ['fall: sky bloom', undefined, 'IV: the sky shimmer blooming again under the landing (the stars answering).', 'Sound: fall'],
  sfxTailMix: ['reverb tail', undefined, 'How much reverb rings after the landing.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<StarsTierSuffix, RareLevelSpec> = {
  SkyMs: ['Sky arrives', 'ms', 'The night fading in before the first star lights.'],
  StepMs: ['Line', 'ms', 'How long each line takes to reach its next star (I has 3 steps, II 8, III 12, IV 18).'],
  AliveMs: ['Come alive', 'ms', 'The finished figure brightening (III: its ghost body fills in).'],
  DrawMs: ['Draw', 'ms', 'I: the arrow pulls back. II, III: the bow draws. IV: the arm reaches and the star is plucked.'],
  HoldMs: ['Hold', 'ms', 'The full draw held before the loose.'],
  FlyMs: ['Flight', 'ms', 'The arrow\'s flight (at 1600 px). IV: the star\'s fall.'],
  Size: ['Size', '×', 'The figure\'s size multiplier for this tier.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the blow.'],
  Zoom: ['Push in', '×', 'How far the view pushes in while the figure is traced.'],
  Punch: ['Impact punch', '×', 'Extra push on the blow.'],
  SettleMs: ['Settle', 'ms', 'After the blow before the sequence ends (the night fades over it).'],
  Dim: ['Board dim', 'opacity', 'How far the board dims (the two heroes stay lit).'],
  Veil: ['Night veil', 'opacity', 'The blue-black veil over everything.'],
  SkyStars: ['Sky stars', undefined, 'How many small stars fill the sky.'],
};

const built = rareTunerSpec({
  id: 'herostars', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Written in the Stars (Ancient)',
  store: heroStarsStore,
  defaults: HERO_STARS_DEFAULTS,
  ranges: HERO_STARS_RANGES,
  globals: GLOBALS,
  levels: STARS_LEVELS,
  levelNames: { t1: 'Tier I (the arrow)', t2: 'Tier II (the bow)', t3: 'Tier III (the hunter)', t4: 'Tier IV (written in the stars)' },
  suffixes: STARS_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorStar', 'Starlight', 'The stars, the arrow, the stardust.'],
    ['colorGold', 'White gold', 'The arrow\'s own stars, the falling star, the warm specks of stardust.'],
    ['colorLine', 'Line', 'The constellation lines, the halos, the soft rings.'],
    ['colorSky', 'Night', 'The veil over the board.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: sky': 'sfxSkyClip', 'Sound: tick': 'sfxTickClip', 'Sound: loose': 'sfxLooseClip', 'Sound: whoosh': 'sfxWhooshClip', 'Sound: fall': 'sfxFallClip', 'Sound: rise': 'sfxRiseClip', 'Sound: boom': 'sfxBoomClip', 'Sound: thrum': 'sfxThrumClip',
  },
  note: () => {
    const c = getHeroStarsConfig();
    const p = starsPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.kind} · traced ${Math.round(p.tracedAt - p.chargeAt)} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroStars(o),
  verb: 'draws a constellation over',
  smallHint: 'three stars link into an arrow that looses itself.',
  bigHint: 'the medallion and the comet.',
  tierHints: [
    'three stars light in a row and link into an arrow, which brightens and looses itself into the struck portrait.',
    'eight stars link into a bow with a nocked arrow; the bow draws, holds and looses.',
    'an archer is traced star by star, a ghost body fills in, and the hunter draws and shoots a long line of light.',
    'the striking hero\'s own portrait is written as a medallion of stars; its arm plucks a star, the star swells while the sky holds its breath, and falls as a comet into a nova of stardust; the lines scatter into falling sparks.',
  ],
  knockoutHint: 'IV remixed: the ring of stardust goes prismatic, a bigger shake and the KO sting.',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroStars?: unknown }).__heroStars = { demo: built.demo };
}

export function HeroStarsTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
