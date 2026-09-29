import {
  BOOMERANG_LEVELS, BOOMERANG_LEVEL_SUFFIXES, HERO_BOOMERANG_DEFAULTS, HERO_BOOMERANG_RANGES, boomerangPlan,
  getHeroBoomerangConfig, heroBoomerangStore, type BoomerangLevelSuffix,
} from './heroBoomerang/heroBoomerangConfig';
import { playHeroBoomerang } from './heroBoomerang/heroBoomerang';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the BOOMERANG hero attack (a Rare; owner ask 2026-09-29). Two groups of per-tier dials: Small (shared
 * tiers I-II: one boomerang) and Big (III-IV and every knockout: two on crossing paths). The Play buttons run the real
 * runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6). Small still plays here.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): from here two boomerangs fly (Big).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20). Big (a knockout always plays Big).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroWindPx: ['Wind back', 'px', 'How far the hero leans back as it winds up the throw.', 'Ready'],
  heroThrowPx: ['Throw snap', 'px', 'How far the hero snaps toward the target on each throw.', 'Ready'],
  catchPop: ['Catch pop', '×', 'How much the hero swells as it catches a boomerang.', 'Ready'],
  catchMs: ['Catch tuck', 'ms', 'How long a caught boomerang takes to tuck away (and the ring at the hand).', 'Ready'],
  boomPx: ['Boomerang size', 'px', 'The boomerang\'s span (the per-tier size multiplies it).', 'Boomerang'],
  trailMs: ['Trail length', 'ms', 'How much of its flight the teal trail spans (0 = no trail).', 'Boomerang'],
  trailWidth: ['Trail width', 'px', 'How thick the teal trail is.', 'Boomerang'],
  whirl: ['Whirl blur', 'opacity', 'The faint spin smear round the boomerang when it is fastest.', 'Boomerang'],
  thwackSize: ['Thwack size', '×', 'The impact star, ring and chips on every thwack.', 'Thwack'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back on the impact.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the impact.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxThrowGain: ['throw: gain', undefined, 'The swish of each throw.', 'Sound: throw'],
  sfxThrowRate: ['throw: pitch', '×', 'Pitch of the swish.', 'Sound: throw'],
  sfxWhirlGain: ['whirl: gain', undefined, 'The woosh as it swings wide, and again as it swings home.', 'Sound: whirl'],
  sfxWhirlRate: ['whirl: pitch', '×', 'Pitch of the woosh.', 'Sound: whirl'],
  sfxThwackGain: ['thwack: gain', undefined, 'The THWACK on the face.', 'Sound: thwack'],
  sfxThwackRate: ['thwack: pitch', '×', 'Pitch of the thwack.', 'Sound: thwack'],
  sfxKnockGain: ['knock: gain', undefined, 'A woody knock under the thwack.', 'Sound: knock'],
  sfxKnockRate: ['knock: pitch', '×', 'Pitch of the knock.', 'Sound: knock'],
  sfxCatchGain: ['catch: gain', undefined, 'The slap of the catch.', 'Sound: catch'],
  sfxCatchRate: ['catch: pitch', '×', 'Pitch of the catch.', 'Sound: catch'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the boomerang plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<BoomerangLevelSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The hero winding up. The view pushes in over this.'],
  OutMs: ['Out', 'ms', 'The flight out to the thwack (at 1600 px; lower = faster).'],
  BackMs: ['Back', 'ms', 'The swing home to the catch.'],
  Bulge: ['Curve', '×', 'How wide the loop swings, as a fraction of the distance.'],
  Count: ['Boomerangs', undefined, 'One, or two on crossing paths.'],
  StaggerMs: ['Stagger', 'ms', 'Two: the gap between the throws (and so the two thwacks).'],
  Size: ['Size', '×', 'The boomerang size multiplier for this tier.'],
  SpinHz: ['Spin', undefined, 'Turns per second in flight.'],
  Chips: ['Wood chips', undefined, 'Splinters knocked off by the last thwack.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last catch before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'heroboomerang', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Boomerang (Rare)',
  store: heroBoomerangStore,
  defaults: HERO_BOOMERANG_DEFAULTS,
  ranges: HERO_BOOMERANG_RANGES,
  globals: GLOBALS,
  levels: BOOMERANG_LEVELS,
  levelNames: { small: 'Small (tiers I-II)', big: 'Big (tiers III-IV, knockouts)' },
  suffixes: BOOMERANG_LEVEL_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorWood', 'Wood', 'The boomerang\'s body, the chips and the dust.'],
    ['colorGrain', 'Grain', 'The darker wood of some chips.'],
    ['colorTeal', 'Teal', 'The inlay, the trail, the glow, the rings.'],
    ['colorTealDeep', 'Deep teal', 'The deeper teal in the wide outer glow of the trail.'],
    ['colorFlash', 'Flash', 'The impact star and the catch glint.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU throw.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY throw.'],
  ],
  clipOf: {
    'Sound: throw': 'sfxThrowClip', 'Sound: whirl': 'sfxWhirlClip', 'Sound: thwack': 'sfxThwackClip', 'Sound: knock': 'sfxKnockClip',
    'Sound: catch': 'sfxCatchClip',
  },
  note: () => {
    const c = getHeroBoomerangConfig();
    const p = boomerangPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${p.level} · ${p.throws.length} boomerang${p.throws.length === 1 ? '' : 's'} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroBoomerang(o),
  verb: 'throws a boomerang at',
  smallHint: 'Small, one boomerang out, thwack, and caught.',
  bigHint: 'Big, two on crossing paths, a double thwack, both caught.',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBoomerang?: unknown }).__heroBoomerang = { demo: built.demo };
}

export function HeroBoomerangTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
