import {
  BUBBLE_LEVELS, BUBBLE_LEVEL_SUFFIXES, HERO_BUBBLE_DEFAULTS, HERO_BUBBLE_RANGES, bubblePlan, getHeroBubbleConfig, heroBubbleStore,
  type BubbleLevelSuffix,
} from './heroBubble/heroBubbleConfig';
import { playHeroBubble } from './heroBubble/heroBubble';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the BUBBLE POP hero attack (a Rare; owner ask 2026-09-29). Two groups of per-tier dials: Small (shared
 * tiers I-II: one bubble) and Big (III-IV and every knockout: a stream of little ones, then one big bubble with a splash
 * ring). The Play buttons run the real runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6). Small still plays here.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): from here the bubbles play Big.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20). Big (a knockout always plays Big).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Blow'],
  heroPuff: ['Puff', '×', 'How much the hero swells as it blows the bubble.', 'Blow'],
  heroPushPx: ['Push', 'px', 'How far the hero nudges toward the target as the bubble leaves.', 'Blow'],
  lift: ['Float', '×', 'How high a bubble floats on its way over (a fraction of the distance).', 'Bubble'],
  filmSpin: ['Film swirl', undefined, 'How fast the film\'s colours turn (radians per ms).', 'Bubble'],
  sheenAlpha: ['Sheen', 'opacity', 'The bubble\'s reflections.', 'Bubble'],
  dropSpeed: ['Droplet speed', undefined, 'px/s. How hard the pop flings droplets off the rim.', 'Pop'],
  dropGravity: ['Droplet gravity', undefined, 'px/s². How fast the droplets fall.', 'Pop'],
  floatPx: ['Face float', 'px', 'How far the engulfed face floats up inside the bubble.', 'Camera and portraits'],
  knockPx: ['Pop drop', 'px', 'How far the struck portrait drops on the pop.', 'Camera and portraits'],
  squash: ['Boing', '×', 'How much the struck portrait squashes and springs back on the pop.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the pop shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the pop.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxBlowGain: ['blow: gain', undefined, 'A soft shimmer as the bubble is blown.', 'Sound: blow'],
  sfxBlowRate: ['blow: pitch', '×', 'Pitch of the shimmer.', 'Sound: blow'],
  sfxBlipGain: ['blip: gain', undefined, 'The little blip of each stream bubble (climbs per blip) and under the pop.', 'Sound: blip'],
  sfxBlipRate: ['blip: pitch', '×', 'Pitch of the first blip.', 'Sound: blip'],
  sfxStretchGain: ['stretch: gain', undefined, 'The film straining round the face before the pop.', 'Sound: stretch'],
  sfxStretchRate: ['stretch: pitch', '×', 'Pitch of the strain.', 'Sound: stretch'],
  sfxPopGain: ['pop: gain', undefined, 'THE pop.', 'Sound: pop'],
  sfxPopRate: ['pop: pitch', '×', 'Pitch of the pop (higher = smaller, brighter).', 'Sound: pop'],
  sfxSplashGain: ['splash: gain', undefined, 'Big: the splash under the pop.', 'Sound: splash'],
  sfxSplashRate: ['splash: pitch', '×', 'Pitch of the splash.', 'Sound: splash'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the bubbles play (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<BubbleLevelSuffix, RareLevelSpec> = {
  BlowMs: ['Blow', 'ms', 'The bubble swelling at the hand before it leaves.'],
  DriftMs: ['Drift', 'ms', 'The bubble floating over (at 1600 px; lower = faster).'],
  Wobble: ['Wobble', '×', 'How much the bubble wobbles (squash one way, stretch the other).'],
  Stream: ['Stream', undefined, 'Little bubbles blown first, each blipping on the face (0 = none).'],
  StreamGapMs: ['Stream gap', 'ms', 'The gap between the little bubbles.'],
  StreamMs: ['Stream drift', 'ms', 'How long a little bubble takes to float over.'],
  BubbleSize: ['Bubble size', '×', 'The bubble\'s radius in flight, in portrait radii.'],
  EngulfSize: ['Engulf size', '×', 'How big it swells round the face, in portrait radii.'],
  EngulfMs: ['Engulf', 'ms', 'The swell round the face.'],
  HoldMs: ['Strain', 'ms', 'How long the film strains before it pops.'],
  Drops: ['Droplets', undefined, 'Droplets flung off the rim by the pop.'],
  Tinies: ['Tiny bubbles', undefined, 'The fizz of tiny bubbles the pop leaves.'],
  Splash: ['Splash ring', '×', 'The splash ring racing out from the pop (0 = none).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the pop.'],
  Zoom: ['Push in', '×', 'How far the view pushes in while the bubble is blown.'],
  Punch: ['Pop punch', '×', 'Extra push on the pop before the view settles.'],
  SettleMs: ['Settle', 'ms', 'Hold after the pop before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herobubble', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Bubble (Rare)',
  store: heroBubbleStore,
  defaults: HERO_BUBBLE_DEFAULTS,
  ranges: HERO_BUBBLE_RANGES,
  globals: GLOBALS,
  levels: BUBBLE_LEVELS,
  levelNames: { small: 'Small (tiers I-II)', big: 'Big (tiers III-IV, knockouts)' },
  suffixes: BUBBLE_LEVEL_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorFilm', 'Film', 'A tint over the bubble\'s iridescent film (white = as painted).'],
    ['colorPink', 'Pink', 'Droplets, tiny bubbles and the echo of the splash ring.'],
    ['colorMint', 'Mint', 'Droplets and tiny bubbles.'],
    ['colorLilac', 'Lilac', 'The bubble\'s glow, droplets and tiny bubbles.'],
    ['colorSky', 'Sky', 'Droplets, tiny bubbles and the splash ring.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU blow.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY blow.'],
  ],
  clipOf: {
    'Sound: blow': 'sfxBlowClip', 'Sound: blip': 'sfxBlipClip', 'Sound: stretch': 'sfxStretchClip', 'Sound: pop': 'sfxPopClip', 'Sound: splash': 'sfxSplashClip',
  },
  note: () => {
    const c = getHeroBubbleConfig();
    const p = bubblePlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${p.level}${p.stream.length ? ` · ${p.stream.length} little bubbles` : ''} · pop ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroBubble(o),
  verb: 'blows a bubble at',
  smallHint: 'Small, one bubble drifts over, engulfs the face and pops.',
  bigHint: 'Big, a stream of little bubbles, then a big one that pops with a splash ring.',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBubble?: unknown }).__heroBubble = { demo: built.demo };
}

export function HeroBubbleTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
