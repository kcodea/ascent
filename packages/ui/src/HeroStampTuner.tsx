import {
  STAMP_LEVELS, STAMP_LEVEL_SUFFIXES, HERO_STAMP_DEFAULTS, HERO_STAMP_RANGES, stampPlan, getHeroStampConfig, heroStampStore,
  type StampLevelSuffix,
} from './heroStamp/heroStampConfig';
import { playHeroStamp } from './heroStamp/heroStamp';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for PAID IN FULL, the rubber stamp hero attack (a Rare). Two groups of per-tier dials: Small (shared tiers
 * I-II: one stamp) and Big (III-IV and every knockout: the ink pad, then three stamps). The Play buttons run the real
 * runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6). Small still plays here.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): from here the stamp plays Big.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20). Big (a knockout always plays Big).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroDipPx: ['Wind back', 'px', 'How far the hero dips back from the target as the stamp comes out.', 'Ready'],
  heroPushPx: ['Push', 'px', 'How far the hero pushes toward the target as the stamp leaves.', 'Ready'],
  padSize: ['Ink pad size', '×', 'Big: the width of the ink pad, in striking-portrait radii.', 'Ready'],
  stampSize: ['Stamp size', '×', 'The width of the stamp base, in struck-portrait radii (the per-tier size multiplies it).', 'Stamp'],
  hoverLift: ['Hover height', '×', 'How far above the portrait the stamp hovers before it comes down, in radii.', 'Stamp'],
  lastLift: ['Last wind up', '×', 'Big: how much higher the stamp winds up before the last, hardest stamp.', 'Stamp'],
  slamMs: ['Slam', 'ms', 'The stamp coming down onto the portrait.', 'Stamp'],
  pressMs: ['Press', 'ms', 'How long the stamp stays pressed before it lifts.', 'Stamp'],
  awayMs: ['Lift away', 'ms', 'The stamp lifting off the last mark and fading.', 'Stamp'],
  markSize: ['Mark size', '×', 'The diameter of the ink mark, in stamp base widths.', 'Mark'],
  markTilt: ['Mark crookedness', undefined, 'The most a mark sits crooked, in radians.', 'Mark'],
  markFadeMs: ['Mark fade', 'ms', 'How long the dry marks take to fade out.', 'Mark'],
  knockPx: ['Push down', 'px', 'How far the struck portrait is pushed down the axis of the stamp on the impact.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes under the stamp.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The swish of the stamp swinging over.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the swish.', 'Sound: whoosh'],
  sfxThunkGain: ['thunk: gain', undefined, 'The THUNK of every stamp (the last one is the lowest and the fullest).', 'Sound: thunk'],
  sfxThunkRate: ['thunk: pitch', '×', 'Pitch of the thunk.', 'Sound: thunk'],
  sfxPadGain: ['ink pad: gain', undefined, 'Big: the soft tap on the ink pad.', 'Sound: ink pad'],
  sfxPadRate: ['ink pad: pitch', '×', 'Pitch of the tap.', 'Sound: ink pad'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the stamp plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<StampLevelSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The stamp rising out of the hero (Big: and tapping the ink pad). The view pushes in over this.'],
  FlightMs: ['Swing', 'ms', 'The stamp crossing the board (at 1600 px; lower = faster).'],
  Arc: ['Arc', '×', 'How high the swing arcs, as a fraction of the distance.'],
  Stamps: ['Stamps', undefined, 'How many times it stamps the portrait (the last is the blow; the rest are ticks).'],
  HopMs: ['Between stamps', 'ms', 'The time from one stamp to the next.'],
  LastHoldMs: ['Last wind up', 'ms', 'Extra time before the last stamp (the wind up).'],
  StampSize: ['Stamp size', '×', 'The stamp size multiplier for this tier.'],
  Droplets: ['Ink drops', undefined, 'Drops of ink flung by the last stamp (a tick flings a third as many).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  MarkHoldMs: ['Mark holds', 'ms', 'How long the marks stay after the impact before they fade (wet, then dry).'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herostamp', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Paid in Full (stamp, Rare)',
  store: heroStampStore,
  defaults: HERO_STAMP_DEFAULTS,
  ranges: HERO_STAMP_RANGES,
  globals: GLOBALS,
  levels: STAMP_LEVELS,
  levelNames: { small: 'Small (tiers I-II)', big: 'Big (tiers III-IV, knockouts)' },
  suffixes: STAMP_LEVEL_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorInk', 'Ink', 'The wet mark and the flying drops.'],
    ['colorInkDeep', 'Dry ink', 'What the ink dulls toward as it dries, and the splat under the hardest stamp.'],
    ['colorShine', 'Shine', 'The wet gloss on a fresh mark.'],
    ['colorDust', 'Dust', 'The puff either side of the stamp as it lands.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU stamp.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY stamp.'],
  ],
  clipOf: { 'Sound: whoosh': 'sfxWhooshClip', 'Sound: thunk': 'sfxThunkClip', 'Sound: ink pad': 'sfxPadClip' },
  note: () => {
    const c = getHeroStampConfig();
    const p = stampPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${p.level} · ${p.thunks.length} stamp${p.thunks.length === 1 ? '' : 's'}${p.padAt !== null ? ', ink pad' : ''} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroStamp(o),
  verb: 'stamps',
  smallHint: 'Small, one stamp and one mark.',
  bigHint: 'Big, the ink pad, then three stamps.',
});

export const SPEC = built.spec;

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroStamp?: unknown }).__heroStamp = { demo: built.demo };
}

export function HeroStampTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
