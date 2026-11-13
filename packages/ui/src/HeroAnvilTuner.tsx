import {
  ANVIL_LEVELS, ANVIL_LEVEL_SUFFIXES, HERO_ANVIL_DEFAULTS, HERO_ANVIL_RANGES, anvilPlan, getHeroAnvilConfig, heroAnvilStore,
  type AnvilLevelSuffix,
} from './heroAnvil/heroAnvilConfig';
import { playHeroAnvil } from './heroAnvil/heroAnvil';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for LOOK OUT BELOW (style id `anvil`, a Rare hero attack): a shadow grows on the struck portrait, an anvil
 * (Small) or an upright piano (Big) drops out of the sky and squashes it flat, and it pops back like an accordion. Two
 * groups of per-tier dials: Small (shared tiers I-II) and Big (III-IV, and every knockout). The Play buttons run the
 * real runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6). Small (the anvil) still plays here.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): from here the piano plays.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20). Big (a knockout always plays Big).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the striking hero.', 'Cue'],
  heroHopPx: ['Hop', 'px', 'How high the striking hero hops as its spark goes up.', 'Cue'],
  pullMax: ['Duck (most)', '×', 'A struck portrait against the top of the screen ducks under the shadow to give the drop room: the most it sinks, in radii.', 'Drop'],
  fallRoom: ['Fall on show', '×', 'How much of the fall must show above the ducked portrait, in object heights.', 'Drop'],
  shadowAlpha: ['Shadow', 'opacity', 'How dark the shadow on the struck portrait gets just before the landing.', 'Drop'],
  popHz: ['Spring speed', undefined, 'Accordion bounces per second as the portrait pops back.', 'Pop back'],
  popTauMs: ['Spring decay', 'ms', 'How fast the accordion bounces die away (lower = fewer overshoots).', 'Pop back'],
  tipMs: ['Tip off', 'ms', 'How long the tossed object is drawn as it falls away and fades.', 'Pop back'],
  tipSpeed: ['Toss', undefined, 'px/s. How hard the pop tosses the object off the portrait.', 'Pop back'],
  tipGravity: ['Toss gravity', undefined, 'px/s². How fast the tossed object falls.', 'Pop back'],
  keySpeed: ['Key speed', undefined, 'px/s. Big: how hard the piano keys are thrown.', 'Piano keys'],
  keyGravity: ['Key gravity', undefined, 'px/s². Big: how fast the piano keys fall (they bounce twice).', 'Piano keys'],
  shakeMs: ['Shake length', 'ms', 'How long the landing shake takes to die away.', 'Camera'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the pop.', 'Camera'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera'],
  sfxCueGain: ['cue: gain', undefined, 'The small swish of the spark the striking hero sends up.', 'Sound: cue'],
  sfxCueRate: ['cue: pitch', '×', 'Pitch of the swish.', 'Sound: cue'],
  sfxWhistleGain: ['whistle: gain', undefined, 'The falling slide whistle (it plays for exactly the fall).', 'Sound: whistle'],
  sfxWhistleRate: ['whistle: pitch', '×', 'Pitch of the whistle for the anvil (the piano plays it lower and longer).', 'Sound: whistle'],
  sfxClangGain: ['clang: gain', undefined, 'Small: the iron anvil landing.', 'Sound: clang'],
  sfxClangRate: ['clang: pitch', '×', 'Pitch of the clang.', 'Sound: clang'],
  sfxPianoGain: ['piano: gain', undefined, 'Big: the piano crash.', 'Sound: piano'],
  sfxPianoRate: ['piano: pitch', '×', 'Pitch of the crash.', 'Sound: piano'],
  sfxThudGain: ['thud: gain', undefined, 'The deep ground thud under the landing (fuller and lower under the piano).', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thump.', 'Sound: thud'],
  sfxPopGain: ['pop: gain', undefined, 'The swish of the portrait springing back.', 'Sound: pop'],
  sfxPopRate: ['pop: pitch', '×', 'Pitch of the pop.', 'Sound: pop'],
  sfxBoingGain: ['boing: gain', undefined, 'The springy boing as the portrait pops back (lower under the piano).', 'Sound: boing'],
  sfxBoingRate: ['boing: pitch', '×', 'Pitch of the boing.', 'Sound: boing'],
  sfxKeysGain: ['keys: gain', undefined, 'Big: the loose piano keys clattering down.', 'Sound: keys'],
  sfxKeysRate: ['keys: pitch', '×', 'Pitch of the clatter.', 'Sound: keys'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<AnvilLevelSuffix, RareLevelSpec> = {
  ReadyMs: ['Cue', 'ms', 'The cue from the striking hero before the shadow appears.'],
  FallMs: ['Fall', 'ms', 'The shadow growing and the whistle falling, up to the landing.'],
  DropMs: ['Visible drop', 'ms', 'The object crossing the screen at the end of the fall (lower = faster).'],
  HoldMs: ['Hold flat', 'ms', 'How long the portrait stays flat under the weight.'],
  SettleMs: ['Pop back', 'ms', 'The accordion spring after the pop, to the end of the sequence.'],
  Size: ['Object size', '×', 'How wide the object is, in portrait radii.'],
  Shadow: ['Shadow size', '×', 'The radius of the shadow at the landing, in portrait radii.'],
  Flat: ['Flatness', '×', 'The height of the squashed portrait (0.2 = a fifth of its height).'],
  Bulge: ['Spread', '×', 'How far the squashed portrait spreads sideways.'],
  Dust: ['Dust', undefined, 'Dust puffs rolling out along the ground from the landing.'],
  Keys: ['Piano keys', undefined, 'Loose keys thrown out by the landing (the piano only).'],
  Shake: ['Shake', 'px', 'How hard the view is driven down on the landing.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the fall.'],
  Punch: ['Impact punch', '×', 'Extra push on the landing before the view settles.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'heroanvil', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Look Out Below (anvil, Rare)',
  store: heroAnvilStore,
  defaults: HERO_ANVIL_DEFAULTS,
  ranges: HERO_ANVIL_RANGES,
  globals: GLOBALS,
  levels: ANVIL_LEVELS,
  levelNames: { small: 'Small (tiers I-II)', big: 'Big (tiers III-IV, knockouts)' },
  suffixes: ANVIL_LEVEL_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorDust', 'Dust', 'The dust puffs and the ground ring.'],
    ['colorSpark', 'Spark', 'The cue spark and the stars knocked out of the landing.'],
    ['colorShadow', 'Shadow', 'The shadow on the struck portrait.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: cue': 'sfxCueClip', 'Sound: whistle': 'sfxWhistleClip', 'Sound: clang': 'sfxClangClip', 'Sound: piano': 'sfxPianoClip',
    'Sound: thud': 'sfxThudClip', 'Sound: pop': 'sfxPopClip', 'Sound: boing': 'sfxBoingClip', 'Sound: keys': 'sfxKeysClip',
  },
  note: () => {
    const c = getHeroAnvilConfig();
    const p = anvilPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · ${p.level} · the ${p.object}${p.keys ? `, ${p.keys} keys` : ''} · lands ${Math.round(p.impactAt - p.chargeAt)} · pops ${Math.round(p.popAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroAnvil(o),
  verb: 'drops something heavy on',
  smallHint: 'Small, an anvil lands and the portrait pops back.',
  bigHint: 'Big, a piano lands and its keys scatter.',
});

export const SPEC = built.spec;

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroAnvil?: unknown }).__heroAnvil = { demo: built.demo };
}

export function HeroAnvilTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
