import {
  BACKSTAB_LEVELS, BACKSTAB_LEVEL_SUFFIXES, HERO_BACKSTAB_DEFAULTS, HERO_BACKSTAB_RANGES, backstabPlan, getHeroBackstabConfig,
  heroBackstabStore, type BackstabLevelSuffix,
} from './heroBackstab/heroBackstabConfig';
import { playHeroBackstab } from './heroBackstab/heroBackstab';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the BACKSTAB hero attack (a Rare; owner ask 2026-09-29: "add a stealth backstab attack to the rare
 * branch. portrait fades and attacks from behind the target back towards the player portrait and settles"). Two groups
 * of per-tier dials: Small (shared tiers I-II: fade, step out behind, stab) and Big (III-IV and every knockout: a lunge,
 * then a stab from the side, then from behind). The Play buttons run the real runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6). Small still plays here.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): from here it plays Big (lunge, side, behind).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20). Big (a knockout always plays Big).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  lungeWindMs: ['Lunge coil', 'ms', 'Big: the opening lunge\'s coil back (Classic\'s swing).', 'Lunge (Big)'],
  lungeStrikeMs: ['Lunge drive', 'ms', 'Big: the opening lunge\'s drive into the target.', 'Lunge (Big)'],
  lungeDepth: ['Lunge coil depth', '×', 'Big: how far the lunge coils back (1 = Classic\'s).', 'Lunge (Big)'],
  behindGap: ['Step-out distance', '×', 'How far past the target\'s rim the striker steps out (in its own radii).', 'Stab'],
  contactStop: ['Stab depth', '×', 'Where the stab stops (0.2 deep over the face, 1.2 just touching).', 'Stab'],
  windPx: ['Draw back', 'px', 'How far the striker draws back before each stab.', 'Stab'],
  tilt: ['Lean', '°', 'How far the striker leans into each stab.', 'Stab'],
  swell: ['Swell', '×', 'How much the striker swells as it draws back.', 'Stab'],
  homeSettle: ['Home settle', '×', 'The little bounce as it reappears in its own slot.', 'Stab'],
  knockPx: ['Jolt', 'px', 'How far the struck portrait jolts along the last stab.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much both portraits squash on a stab.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long each stab\'s shake takes to die away.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxVanishGain: ['vanish: gain', undefined, 'The woosh of a vanish into smoke.', 'Sound: vanish'],
  sfxVanishRate: ['vanish: pitch', '×', 'Pitch of the woosh.', 'Sound: vanish'],
  sfxAppearGain: ['appear: gain', undefined, 'The swish of stepping out of the smoke (and home).', 'Sound: appear'],
  sfxAppearRate: ['appear: pitch', '×', 'Pitch of the swish.', 'Sound: appear'],
  sfxSlashGain: ['slash: gain', undefined, 'The blade\'s snap as each stab drives in.', 'Sound: slash'],
  sfxSlashRate: ['slash: pitch', '×', 'Pitch of the snap.', 'Sound: slash'],
  sfxStabGain: ['stab: gain', undefined, 'The hit of each stab (the last one hardest).', 'Sound: stab'],
  sfxStabRate: ['stab: pitch', '×', 'Pitch of the hit.', 'Sound: stab'],
  sfxLungeGain: ['lunge: gain', undefined, 'Big: the opening lunge\'s wind-up.', 'Sound: lunge'],
  sfxLungeRate: ['lunge: pitch', '×', 'Pitch of the wind-up.', 'Sound: lunge'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the backstab plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<BackstabLevelSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'A beat before the striker moves.'],
  VanishMs: ['Vanish', 'ms', 'Fading into smoke.'],
  GapMs: ['In the shadows', 'ms', 'How long it stays unseen between a vanish and the next step out.'],
  AppearMs: ['Step out', 'ms', 'Fading in out of the smoke.'],
  WindMs: ['Draw back', 'ms', 'The draw back before a stab.'],
  StrikeMs: ['Stab', 'ms', 'The stab driving in.'],
  HoldMs: ['Hold', 'ms', 'How long it stays on the target after a stab before vanishing.'],
  Smoke: ['Smoke', '×', 'How much smoke each vanish and step out makes (0 = none).'],
  Slash: ['Slash size', '×', 'The dagger slash on each stab.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the last stab.'],
  Punch: ['Punch', '×', 'The push in on the last stab.'],
  SettleMs: ['Settle', 'ms', 'The settle back into its own slot.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herobackstab', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Backstab (Rare)',
  store: heroBackstabStore,
  defaults: HERO_BACKSTAB_DEFAULTS,
  ranges: HERO_BACKSTAB_RANGES,
  globals: GLOBALS,
  levels: BACKSTAB_LEVELS,
  levelNames: { small: 'Small (tiers I-II)', big: 'Big (tiers III-IV, knockouts)' },
  suffixes: BACKSTAB_LEVEL_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorSmoke', 'Smoke', 'Most of the smoke puffs.'],
    ['colorShadow', 'Shadow', 'The darkest smoke puffs.'],
    ['colorViolet', 'Violet', 'The wisps, the rings and the slash edge.'],
    ['colorTeal', 'Teal', 'The slash edge and the dagger sparks.'],
    ['colorFlash', 'Flash', 'The slash core and the dagger glint.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: vanish': 'sfxVanishClip', 'Sound: appear': 'sfxAppearClip', 'Sound: slash': 'sfxSlashClip', 'Sound: stab': 'sfxStabClip', 'Sound: lunge': 'sfxLungeClip',
  },
  note: () => {
    const c = getHeroBackstabConfig();
    const p = backstabPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · ${p.level} · ${p.hits.length + 1} hit${p.hits.length ? 's' : ''} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroBackstab(o),
  verb: 'backstabs',
  smallHint: 'Small, it fades, steps out behind the target and stabs back toward home.',
  bigHint: 'Big, a lunge, then a stab from the side, then from behind.',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBackstab?: unknown }).__heroBackstab = { demo: built.demo };
}

export function HeroBackstabTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
