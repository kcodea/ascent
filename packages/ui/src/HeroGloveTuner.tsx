import {
  GLOVE_LEVELS, GLOVE_LEVEL_SUFFIXES, HERO_GLOVE_DEFAULTS, HERO_GLOVE_RANGES, glovePlan,
  getHeroGloveConfig, heroGloveStore, type GloveLevelSuffix,
} from './heroGlove/heroGloveConfig';
import { playHeroGlove } from './heroGlove/heroGlove';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the SUCKER PUNCH hero attack (style id `glove`, a Rare; built 2026-11-12): a boxing glove on a coil
 * spring. Two groups of per-tier dials: Small (shared tiers I-II: one bop) and Big (III-IV and every knockout: a wind
 * up, an overshoot, a sway and a second, harder bop). The Play buttons run the real runner between the two real
 * portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6). Small still plays here.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): from here the glove winds up and bops twice (Big).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20). Big (a knockout always plays Big).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroWindPx: ['Lean back', 'px', 'How far the hero leans back as the glove winds up.', 'Ready'],
  heroKickPx: ['Recoil', 'px', 'How far the hero is kicked back as the spring lets go.', 'Ready'],
  homePop: ['Home bump', '×', 'How much the hero swells as the glove thumps home.', 'Ready'],
  closeMs: ['Hatch shut', 'ms', 'How long the hatch takes to shut once the glove is home.', 'Ready'],
  glovePx: ['Glove size', 'px', 'The length of the glove (the per-tier size multiplies it).', 'Glove and spring'],
  hatchPx: ['Hatch size', 'px', 'The riveted hatch on the edge of the striking portrait.', 'Glove and spring'],
  springPitch: ['Coil spacing', 'px', 'The gap between the turns of the spring at full stretch (smaller = more turns).', 'Glove and spring'],
  springWidth: ['Coil width', 'px', 'The widest the coil gets (half its width) when it is squeezed.', 'Glove and spring'],
  springThick: ['Wire thickness', 'px', 'How thick the wire of the spring is.', 'Glove and spring'],
  gloveSquash: ['Glove squash', '×', 'How much the glove squashes on a bop.', 'Bop'],
  bopSize: ['Bop size', '×', 'The impact star, ring and flung stars on every bop.', 'Bop'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back on the impact.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the impact.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxPopGain: ['pop: gain', undefined, 'The hatch popping open.', 'Sound: pop'],
  sfxPopRate: ['pop: pitch', '×', 'Pitch of the pop.', 'Sound: pop'],
  sfxBoingGain: ['boing: gain', undefined, 'The spring letting go (and again, softer and higher, as it overshoots).', 'Sound: boing'],
  sfxBoingRate: ['boing: pitch', '×', 'Pitch of the boing.', 'Sound: boing'],
  sfxPunchGain: ['punch: gain', undefined, 'The padded thud of every bop.', 'Sound: punch'],
  sfxPunchRate: ['punch: pitch', '×', 'Pitch of the thud.', 'Sound: punch'],
  sfxRetractGain: ['retract: gain', undefined, 'The swish as the coil hauls the glove home.', 'Sound: retract'],
  sfxRetractRate: ['retract: pitch', '×', 'Pitch of the swish.', 'Sound: retract'],
  sfxHomeGain: ['home: gain', undefined, 'The clunk as the glove lands back in the hatch.', 'Sound: home'],
  sfxHomeRate: ['home: pitch', '×', 'Pitch of the clunk.', 'Sound: home'],
  sfxSpringGain: ['spring: gain', undefined, 'The steel coil twanging under the boing (pitched well down).', 'Sound: spring'],
  sfxSpringRate: ['spring: pitch', '×', 'Pitch of the twang.', 'Sound: spring'],
  sfxRatchetGain: ['ratchet: gain', undefined, 'The click of the hatch catch letting go.', 'Sound: ratchet'],
  sfxRatchetRate: ['ratchet: pitch', '×', 'Pitch of the click.', 'Sound: ratchet'],
  sfxBodyGain: ['body: gain', undefined, 'The low thump under every bop (fullest under the last) and under the glove landing home.', 'Sound: body'],
  sfxBodyRate: ['body: pitch', '×', 'Pitch of the thump.', 'Sound: body'],
  sfxRecoilGain: ['recoil: gain', undefined, 'The coil squeezing shut as it hauls the glove home.', 'Sound: recoil'],
  sfxRecoilRate: ['recoil: pitch', '×', 'Pitch of the squeeze.', 'Sound: recoil'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the punch plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<GloveLevelSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The hatch pops, the glove peeks out and winds up. The view pushes in over this.'],
  OutMs: ['Out', 'ms', 'The punch out to the first bop (at 1600 px; lower = faster).'],
  WobbleMs: ['Wobble', 'ms', 'Overshoot, sway and rebound between the first bop and the second (0 = one bop only).'],
  HoldMs: ['Hold', 'ms', 'How long the glove bobs on the face after the last bop before it starts home.'],
  BackMs: ['Back', 'ms', 'The retract into the hatch.'],
  Wind: ['Wind up', '×', 'How far the glove squeezes back against the coil before it fires (0 = none).'],
  Over: ['Overshoot', '×', 'How far past the first bop it flies, in portrait radii.'],
  Sway: ['Sway', '×', 'How wide the spring sways side to side, in portrait radii.'],
  Size: ['Size', '×', 'The glove size multiplier for this tier.'],
  Stars: ['Circling stars', undefined, 'Stars left circling the struck head after the last bop.'],
  StarsMs: ['Stars time', 'ms', 'How long they circle.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  SettleMs: ['Settle', 'ms', 'Hold after everything is put away before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'heroglove', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Sucker Punch (spring glove, Rare)',
  store: heroGloveStore,
  defaults: HERO_GLOVE_DEFAULTS,
  ranges: HERO_GLOVE_RANGES,
  globals: GLOBALS,
  levels: GLOVE_LEVELS,
  levelNames: { small: 'Small (tiers I-II)', big: 'Big (tiers III-IV, knockouts)' },
  suffixes: GLOVE_LEVEL_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorGlove', 'Glove', 'The leather of the boxing glove.'],
    ['colorTrim', 'Laces and shine', 'The laces, the piping round the cuff and the glossy highlights.'],
    ['colorSpring', 'Spring', 'The steel of the coil.'],
    ['colorHatch', 'Hatch', 'The riveted ring the glove springs from.'],
    ['colorStar', 'Stars', 'The impact star of a bop and the little stars.'],
    ['colorFlash', 'Flash', 'The white heart of the bop.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU punch.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY punch.'],
  ],
  clipOf: {
    'Sound: pop': 'sfxPopClip', 'Sound: boing': 'sfxBoingClip', 'Sound: punch': 'sfxPunchClip', 'Sound: retract': 'sfxRetractClip',
    'Sound: home': 'sfxHomeClip', 'Sound: spring': 'sfxSpringClip', 'Sound: ratchet': 'sfxRatchetClip', 'Sound: body': 'sfxBodyClip', 'Sound: recoil': 'sfxRecoilClip',
  },
  note: () => {
    const c = getHeroGloveConfig();
    const p = glovePlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${p.level} · ${p.hits.length + 1} bop${p.hits.length ? 's' : ''} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroGlove(o),
  verb: 'springs a boxing glove at',
  smallHint: 'Small, the glove boings out, one bop, and back in.',
  bigHint: 'Big, a wind up, a bop, an overshoot and a sway, a second harder bop, circling stars.',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroGlove?: unknown }).__heroGlove = { demo: built.demo };
}

export function HeroGloveTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
