import {
  HERO_STARS_DEFAULTS, HERO_STARS_RANGES, STARS_FIGURES3, STARS_FIGURES4, STARS_KIND_NAMES, STARS_LAUNCHES, STARS_LAUNCH_NAMES, STARS_LEVELS, STARS_TIER_SUFFIXES,
  getHeroStarsConfig, heroStarsStore, starsPlan, starsVariant, type StarsTierSuffix,
} from './heroStars/heroStarsConfig';
import { playHeroStars } from './heroStars/heroStars';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the WRITTEN IN THE STARS hero attack (attack_stars, Ancient): constellations. Four groups
 * of per-tier dials (Tier 1 the arrow; Tier 2 the bow; Tier 3 the hunter, the wolf or the serpent; Tier 4 written in
 * the stars, the wheel, the giant or the nova), three Variation rows that force each variation (where Tiers 1 and 2 are
 * traced, Tier 3's figure, Tier 4's finisher; Random rolls it per blow like a real fight), the stars and lines, the
 * figures, the shot, the colours and one clip / gain / pitch row per sound cue. The Play buttons at the top play all
 * four tiers in either direction.
 */
let previewRoll = 0;
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier 2 from', undefined, 'Shared damage Tier 2 (6): the bow.', 'Damage tiers'],
  tier3At: ['Tier 3 from', undefined, 'Shared damage Tier 3 (12): the hunter, the wolf or the serpent.', 'Damage tiers'],
  tier4At: ['Tier 4 from', undefined, 'Shared damage Tier 4 (20): written in the stars, the wheel, the giant or the nova (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Sky'],
  twinkle: ['Twinkle', '×', 'How much the small stars of the sky twinkle (0 = steady).', 'Sky'],
  skyHoldMs: ['Sky hold', 'ms', 'After the blow, how long before the night starts to fade (Tier 4 holds a little longer).', 'Sky'],
  starPx: ['Star size', 'px', 'A constellation star\'s four-point glint (each star has its own size on top).', 'Constellation'],
  lineWidth: ['Line width', 'px', 'How wide a constellation line glows.', 'Constellation'],
  ghostAlpha: ['Ghost body', 'opacity', 'Tier 3 hunter and Tier 4 giant: the faint body that fills in between the lines.', 'Constellation'],
  hunterSize: ['Tier 3 hunter height', '×', 'Tier 3 hunter: its height in striking portrait radii (capped at half the screen).', 'Constellation'],
  medallionSize: ['Tier 4 medallion', '×', 'Tier 4, written in the stars: the medallion\'s radius as a fraction of the screen height.', 'Constellation'],
  portraitAlpha: ['Tier 4 portrait', 'opacity', 'Tier 4, written in the stars: the striking hero\'s own portrait inside the medallion.', 'Constellation'],
  fallLen: ['Tier 4 fall', '×', 'Tier 4, written in the stars: how far the comet falls when there is sky above the struck hero, in struck portrait radii (else it arcs over the whole sky).', 'Shot'],
  swell: ['Tier 4 swell', '×', 'Tier 4: how far the charging star (the plucked star, the wheel\'s marker, the giant\'s fist, the nova\'s heart) swells before it lets go.', 'Shot'],
  hush: ['Tier 4 hush', '×', 'Tier 4: how far every other star dims while the charging star swells.', 'Shot'],
  cometSize: ['Tier 4 comet', '×', 'Tier 4: the comet\'s head, in struck portrait radii across (the nova\'s is a little smaller).', 'Shot'],
  skyFlash: ['Sky flash', 'opacity', 'The flash over the whole sky on the blow (Tier 4 in full, the lower tiers a part of it).', 'Shot'],
  scatterMs: ['Tier 4 scatter after', 'ms', 'Tier 4: after the blow, when the constellation\'s lines break into falling sparks.', 'Shot'],
  sparkFallMs: ['Tier 4 sparks drift', 'ms', 'Tier 4: how long the falling sparks drift before they go out.', 'Shot'],
  arrowPx: ['Arrow least length', 'px', 'The arrow of starlight is as long as the arrow in its constellation, never shorter than this.', 'Shot'],
  trailWidth: ['Tail width', 'px', 'The luminous tail behind the arrow, at Tier 1 (wider on the higher tiers; the comet, the beam and the fist follow their own size).', 'Shot'],
  trailLingerMs: ['Tail linger', 'ms', 'How long the line of light hangs along the shot\'s path after the blow (Tiers 1 and 2 half of it; the beam longer).', 'Shot'],
  impactSize: ['Nova size', '×', 'The nova of stardust on the blow (it grows with the tier).', 'Shot'],
  heroLiftPx: ['Hero lift', 'px', 'How far the striking hero rises, leans and rocks with its constellation.', 'Camera and portraits'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked on the blow.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the blow.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the blow.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxSkyGain: ['sky: gain', undefined, 'The shimmer swelling in as the night arrives.', 'Sound: sky'],
  sfxSkyRate: ['sky: pitch', '×', 'Pitch of the swell.', 'Sound: sky'],
  sfxTickGain: ['tick: gain', undefined, 'The tick as a line reaches a star (every second star on Tiers 3 and 4). It climbs in pitch through the trace. Also the wheel\'s ratchet.', 'Sound: tick'],
  sfxTickRate: ['tick: pitch', '×', 'Pitch of the tick at the middle of the trace.', 'Sound: tick'],
  sfxLooseGain: ['loose: gain', undefined, 'Tiers 1 to 3: the snap of the string as the arrow leaves (each launch place has its own pitch).', 'Sound: loose'],
  sfxLooseRate: ['loose: pitch', '×', 'Pitch of the loose.', 'Sound: loose'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The airy pass of the arrow (longer across the open sky); slowed and heavy under the comet, the leap and the fist.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxWhooshStartMs: ['whoosh: start at', 'ms', 'Where in the whoosh clip to start (skips its slow start).', 'Sound: whoosh'],
  sfxFallGain: ['fall: gain', undefined, 'Tier 4: the falling star and its landing (also under an arrow shot from high above).', 'Sound: fall'],
  sfxFallRate: ['fall: pitch', '×', 'Pitch of the falling star.', 'Sound: fall'],
  sfxFallHitMs: ['fall: landing at', 'ms', 'Where in the falling star clip the landing begins (the descent plays before it, timed to end on the blow).', 'Sound: fall'],
  sfxHitGain: ['fall: arrow landing gain', undefined, 'Tiers 1 to 3: the landing part of the falling star clip, under the blow.', 'Sound: fall'],
  sfxHitRate: ['fall: arrow landing pitch', '×', 'Pitch of the arrow\'s landing.', 'Sound: fall'],
  sfxRiseGain: ['rise: gain', undefined, 'The rising swell under the draw of the bow (Tiers 2, 3), the wolf\'s crouch, and Tier 4\'s charging star.', 'Sound: rise'],
  sfxRiseRate: ['rise: pitch', '×', 'Pitch of the rise.', 'Sound: rise'],
  sfxBoomGain: ['boom: gain', undefined, 'The low body under the blow: Tier 4 the whole deep boom, the lower tiers its first moment, quieter and higher. Also the wheel\'s lock.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom at Tier 4.', 'Sound: boom'],
  sfxThrumGain: ['thrum: gain', undefined, 'The deep thrum of the bowstring under its snap; lower under the wolf\'s spring, the giant\'s swing and the nova\'s drop.', 'Sound: thrum'],
  sfxThrumRate: ['thrum: pitch', '×', 'Pitch of the thrum.', 'Sound: thrum'],
  sfxBloomGain: ['fall: sky bloom', undefined, 'Tier 4: the sky shimmer blooming again under the landing (the stars answering).', 'Sound: fall'],
  sfxHowlGain: ['howl: gain', undefined, 'Tier 3 wolf: its ghostly howl as it comes alive.', 'Sound: howl'],
  sfxHowlRate: ['howl: pitch', '×', 'Pitch of the howl.', 'Sound: howl'],
  sfxHissGain: ['hiss: gain', undefined, 'Tier 3 serpent: the hiss as it coils, and its sharp end on the strike.', 'Sound: hiss'],
  sfxHissRate: ['hiss: pitch', '×', 'Pitch of the hiss.', 'Sound: hiss'],
  sfxGrindGain: ['grind: gain', undefined, 'Tier 4 wheel: the stone wheel turning, dying away into its lock.', 'Sound: grind'],
  sfxGrindRate: ['grind: pitch', '×', 'Pitch of the grind.', 'Sound: grind'],
  sfxBeamGain: ['beam: gain', undefined, 'Tier 4 wheel: the beam it fires.', 'Sound: beam'],
  sfxBeamRate: ['beam: pitch', '×', 'Pitch of the beam.', 'Sound: beam'],
  sfxRumbleGain: ['rumble: gain', undefined, 'Tier 4 giant: the deep rumble as it rises from its feet up.', 'Sound: rumble'],
  sfxRumbleRate: ['rumble: pitch', '×', 'Pitch of the rumble.', 'Sound: rumble'],
  sfxImplodeGain: ['implode: gain', undefined, 'Tier 4 nova: the sky drawn into one point (ends as the point lets go).', 'Sound: implode'],
  sfxImplodeRate: ['implode: pitch', '×', 'Pitch of the implosion.', 'Sound: implode'],
  sfxTailMix: ['reverb tail', undefined, 'How much reverb rings after the landing.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<StarsTierSuffix, RareLevelSpec> = {
  SkyMs: ['Sky arrives', 'ms', 'The night fading in before the first star lights.'],
  StepMs: ['Line', 'ms', 'How long each line takes to reach its next star (Tier 1 has 3 steps, Tier 2 8, Tier 3 12, Tier 4 18).'],
  AliveMs: ['Come alive', 'ms', 'The finished figure brightening (the hunter\'s ghost body fills in; the wolf howls).'],
  DrawMs: ['Draw', 'ms', 'Tier 1: the arrow pulls back. Tiers 2, 3: the bow draws, the wolf crouches, the serpent coils. Tier 4: the arm reaches, the wheel turns, the fist goes up, the sky is drawn in.'],
  HoldMs: ['Hold', 'ms', 'The full draw held before the loose (Tier 4: the held breath; the wheel turns into its lock in the first half).'],
  FlyMs: ['Flight', 'ms', 'The shot\'s flight (at 1600 px). The wolf\'s leap takes longer, the serpent\'s strike, the beam, the fist and the nova\'s drop less.'],
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
  levelNames: { t1: 'Tier 1 (the arrow)', t2: 'Tier 2 (the bow)', t3: 'Tier 3 (hunter, wolf, serpent)', t4: 'Tier 4 (written, wheel, giant, nova)' },
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
    'Sound: howl': 'sfxHowlClip', 'Sound: hiss': 'sfxHissClip', 'Sound: grind': 'sfxGrindClip', 'Sound: beam': 'sfxBeamClip', 'Sound: rumble': 'sfxRumbleClip', 'Sound: implode': 'sfxImplodeClip',
  },
  note: () => {
    const c = getHeroStarsConfig();
    const p = starsPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600, variant: starsVariant(previewRoll, c) }, c);
    return `dev · Tier ${p.tier} · ${p.kind}${p.tier <= 2 ? ` (${p.launch})` : ''} · traced ${Math.round(p.tracedAt - p.chargeAt)} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  // A fresh roll per preview (a real fight rolls from the run seed and the round, so a replay rolls the same).
  play: (o) => playHeroStars({ ...o, rollSeed: o.rollSeed ?? (previewRoll = (previewRoll + 1) % 3000) }),
  verb: 'draws a constellation over',
  smallHint: 'three stars link into an arrow that looses itself.',
  bigHint: 'one of four finishers.',
  tierHints: [
    'Tier 1: three stars link into an arrow, which brightens and looses itself into the struck portrait. Traced in one of five places (Variation: launch).',
    'Tier 2: eight stars link into a bow with a nocked arrow; the bow draws, holds and looses. Traced in one of five places (Variation: launch).',
    'Tier 3: the hunter draws and shoots, the wolf leaps and pounces, or the serpent coils and strikes (Variation: Tier 3).',
    'Tier 4: written in the stars (the medallion plucks a star that falls as a comet), the wheel (it turns, locks and fires a beam), the giant (it rises and brings its fist down) or the nova (the whole sky falls into one point that drops and explodes) (Variation: Tier 4).',
  ],
  knockoutHint: 'Tier 4 remixed: the ring of stardust goes prismatic, a bigger shake and the KO sting.',
});

// THE VARIATION overrides (DEV): Random (rolled per blow) or force one, placed right under the Attack style row.
const opt = (list: readonly string[], name: (x: string) => string): Record<string, string> =>
  Object.fromEntries([['', 'Random (rolled per fight)'], ...list.map((x, i) => [String(i + 1), `${i + 1}: ${name(x)}`])]);
built.spec.controls.splice(1, 0, {
  key: 'launch', label: 'Variation: launch', kind: 'select', options: ['', ...STARS_LAUNCHES.map((_, i) => String(i + 1))], group: 'Style', min: 0, max: 0, step: 0,
  optionLabels: opt(STARS_LAUNCHES, (x) => STARS_LAUNCH_NAMES[x as keyof typeof STARS_LAUNCH_NAMES]),
  hint: 'Tiers 1 and 2: where the arrow or the bow is traced and shoots from. Random = what real fights do (the same fight always rolls the same).',
}, {
  key: 'figure3', label: 'Variation: Tier 3', kind: 'select', options: ['', ...STARS_FIGURES3.map((_, i) => String(i + 1))], group: 'Style', min: 0, max: 0, step: 0,
  optionLabels: opt(STARS_FIGURES3, (x) => STARS_KIND_NAMES[x as keyof typeof STARS_KIND_NAMES]),
  hint: 'Tier 3 (shared damage Tier 3): the hunter, the wolf or the serpent. Random = what real fights do.',
}, {
  key: 'figure4', label: 'Variation: Tier 4', kind: 'select', options: ['', ...STARS_FIGURES4.map((_, i) => String(i + 1))], group: 'Style', min: 0, max: 0, step: 0,
  optionLabels: opt(STARS_FIGURES4, (x) => STARS_KIND_NAMES[x as keyof typeof STARS_KIND_NAMES]),
  hint: 'Tier 4 (shared damage Tier 4 and every knockout): written in the stars, the wheel, the giant or the nova. Random = what real fights do.',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroStars?: unknown }).__heroStars = { demo: built.demo, store: heroStarsStore };
}

export function HeroStarsTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
