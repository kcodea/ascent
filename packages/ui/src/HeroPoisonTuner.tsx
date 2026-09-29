import {
  HERO_POISON_DEFAULTS, HERO_POISON_RANGES, POISON_TIER_SUFFIXES, TIERS, getHeroPoisonConfig,
  heroPoisonConfigJson, poisonPlan, resetHeroPoisonConfig, setHeroPoisonValue,
  type HeroPoisonConfig, type HeroPoisonNumKey, type HeroPoisonStrKey, type PoisonTierSuffix, type TierNum,
} from './heroPoison/heroPoisonConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroPoison, type HeroPoisonHandle, type HeroPoisonOptions } from './heroPoison/heroPoison';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the POISON DARTS hero attack (owner ask 2026-09-28: "branch off and make a poison dart animation. the
 * final one should throw multiple poison darts that implode with poison"). The Play buttons run the REAL runner between
 * the two real hero portraits (works from the shop), in either direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40.
 * A preview never touches the run. The "Attack style" row is the same dev
 * override as the other attack tuners' (Auto = what a player would see). Production plays the baked defaults.
 */
type PoisonTunerValues = HeroPoisonConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroPoisonNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which the darts step up to Tier II (two darts). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which the darts become the fan of five. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which the darts implode into the toxic burst. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroCoilPx: ['Lean back', 'px', 'How far the hero leans back from the target as it readies.', 'Ready'],
  heroFlickPx: ['Throw flick', 'px', 'How far the hero flicks toward the target on each throw.', 'Ready'],
  dartLength: ['Dart length', 'px', 'How long each dart is (the tier size multiplies it).', 'Darts'],
  dartGlow: ['Dart glow', 'opacity', 'The venom-green glow round each dart (0 = none).', 'Darts'],
  trailMs: ['Trail length', 'ms', 'How much of its flight the vapour trail spans (0 = no trail).', 'Darts'],
  trailWidth: ['Trail width', 'px', 'How thick the vapour trail is at the dart.', 'Darts'],
  wisps: ['Vapour wisps', '×', 'Small puffs of vapour left along the flight (0 = none).', 'Darts'],
  penetration: ['Stick depth', '×', 'How far the tip sinks into the portrait, as a fraction of the dart.', 'Darts'],
  quiver: ['Quiver', undefined, 'How hard a dart quivers as it thunks in (radians).', 'Darts'],
  splashSize: ['Venom splash', '×', 'The size of the venom splat on each hit.', 'Hit'],
  tickDrops: ['Tick droplets', undefined, 'Green droplets splashing back off each dart before the last.', 'Hit'],
  tintAlpha: ['Tint strength', 'opacity', 'The sickly green tint pulse over the struck portrait.', 'Hit'],
  stickHoldMs: ['Stick hold', 'ms', 'Tiers I to III: how long the darts stay stuck after the impact before dissolving.', 'Hit'],
  seepMs: ['Seep', 'ms', 'Tiers I to III: when the poison seeps in after the impact (a second tint pulse and bubbles).', 'Hit'],
  swellMs: ['Swell time', 'ms', 'Tier IV: how long the stuck darts glow and pulse while the venom swells.', 'Implosion (Tier IV)'],
  suckMs: ['Suck', 'ms', 'Tier IV: the collapse, everything pulled into one point before the burst.', 'Implosion (Tier IV)'],
  burstSize: ['Burst size', '×', 'Tier IV: the scale of the toxic burst.', 'Implosion (Tier IV)'],
  cloudPuffs: ['Cloud puffs', undefined, 'Tier IV: bubbling toxic cloud puffs rolling out of the burst.', 'Implosion (Tier IV)'],
  cloudSize: ['Cloud size', '×', 'Tier IV: how big the cloud puffs grow.', 'Implosion (Tier IV)'],
  dropGravity: ['Droplet gravity', undefined, 'px/s². How hard the acid droplets fall.', 'Implosion (Tier IV)'],
  hazeAlpha: ['Haze', 'opacity', 'Tier IV: the lingering poison haze (0 = none).', 'Implosion (Tier IV)'],
  hazeMs: ['Haze time', 'ms', 'Tier IV: how long the haze takes to dissipate.', 'Implosion (Tier IV)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact and burst flashes are.', 'Implosion (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxReadyGain: ['ready: gain', undefined, 'A soft glint as the hero readies.', 'Sound: ready'],
  sfxReadyRate: ['ready: pitch', '×', 'Pitch of the ready.', 'Sound: ready'],
  sfxThrowGain: ['throw: gain', undefined, 'The quick swish of each dart leaving (each a little higher).', 'Sound: throw'],
  sfxThrowRate: ['throw: pitch', '×', 'Pitch of the first swish.', 'Sound: throw'],
  sfxSnapGain: ['thwip: gain', undefined, 'The snap layered on each throw (the "thwip").', 'Sound: thwip'],
  sfxSnapRate: ['thwip: pitch', '×', 'Pitch of the snap.', 'Sound: thwip'],
  sfxThunkGain: ['thunk: gain', undefined, 'The meaty thunk of each dart sticking.', 'Sound: thunk'],
  sfxThunkRate: ['thunk: pitch', '×', 'Pitch of the first thunk (climbs per tick).', 'Sound: thunk'],
  sfxMeatGain: ['meat: gain', undefined, 'A low punch under each thunk.', 'Sound: meat'],
  sfxMeatRate: ['meat: pitch', '×', 'Pitch of the punch.', 'Sound: meat'],
  sfxSplashGain: ['splash: gain', undefined, 'The wet venom splat on each hit.', 'Sound: splash'],
  sfxSplashRate: ['splash: pitch', '×', 'Pitch of the splat.', 'Sound: splash'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the last dart, or layered on the burst.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxBigGain: ['big hit: gain', undefined, 'Tiers III and IV: an extra crack on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxSuckGain: ['suck: gain', undefined, 'Tier IV: the poison sucked into one point.', 'Sound: suck'],
  sfxSuckRate: ['suck: pitch', '×', 'Pitch of the suck.', 'Sound: suck'],
  sfxBurstGain: ['burst: gain', undefined, 'Tier IV: the toxic burst (pitched up to punch, not boom).', 'Sound: burst'],
  sfxBurstRate: ['burst: pitch', '×', 'Pitch of the burst.', 'Sound: burst'],
  sfxGushGain: ['gush: gain', undefined, 'Tier IV: the big wet gush of the burst.', 'Sound: gush'],
  sfxGushRate: ['gush: pitch', '×', 'Pitch of the gush (lower = heavier).', 'Sound: gush'],
  sfxBoomGain: ['pop: gain', undefined, 'The wet pops after the burst (IV) and the seep (I to III).', 'Sound: pop'],
  sfxBoomRate: ['pop: pitch', '×', 'Pitch of the first pop.', 'Sound: pop'],
  sfxSizzleGain: ['sizzle: gain', undefined, 'A synth acid sizzle under every splash (0 = none).', 'Sound: synth'],
  sfxFizzGain: ['fizz: gain', undefined, 'Tier IV: the synth bubbling fizz rising through the swell (peaks on the suck).', 'Sound: synth'],
  sfxFizzLowHz: ['fizz: from', undefined, 'Hz. Where the fizz starts.', 'Sound: synth'],
  sfxFizzHighHz: ['fizz: to', undefined, 'Hz. Where it has risen to at the suck.', 'Sound: synth'],
  sfxThrowLenMs: ['throw length', 'ms', 'Each throw swish is cut to this long (with a fade).', 'Sound: mix'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact and gush clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the darts play (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<PoisonTierSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Ready', 'ms', 'The hero readying before the first throw. The view pushes in over this.'],
  Darts: ['Dart count', undefined, 'How many darts are thrown (I one, II two, III the fan of five, IV the implosion).'],
  ThrowStaggerMs: ['Throw stagger', 'ms', 'Gap between each throw (the rhythm of the thunks).'],
  FlightMs: ['Dart speed', 'ms', 'A dart crossing the board (at 1600 px; lower = faster; scales gently with distance).'],
  Arc: ['Arc', '×', 'How high the dart arcs, as a fraction of the distance (a slight arc).'],
  Fan: ['Fan', '×', 'How far a volley spreads its arcs apart.'],
  DartSize: ['Dart size', '×', 'The dart length multiplier for this tier.'],
  Implode: ['Implode', undefined, 'The stuck darts swell, implode and burst in a toxic cloud instead of a plain last hit.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready (and the swell).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Drops: ['Droplets', undefined, 'Venom droplets thrown by the impact (or the burst).'],
  Burst: ['Splash size', '×', 'Scale of the impact splash, flash and bloom.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroPoisonStrKey>> = {
  'Sound: ready': 'sfxReadyClip', 'Sound: throw': 'sfxThrowClip', 'Sound: thwip': 'sfxSnapClip', 'Sound: thunk': 'sfxThunkClip',
  'Sound: meat': 'sfxMeatClip', 'Sound: splash': 'sfxSplashClip', 'Sound: impact': 'sfxImpactClip', 'Sound: big hit': 'sfxBigClip',
  'Sound: suck': 'sfxSuckClip', 'Sound: burst': 'sfxBurstClip', 'Sound: gush': 'sfxGushClip', 'Sound: pop': 'sfxBoomClip',
};

const COLORS: [HeroPoisonStrKey, string, string][] = [
  ['colorVenom', 'Venom', 'The toxic green: the venom in the darts, splats, droplets, trails and the tint on the face.'],
  ['colorAcid', 'Acid', 'The acid yellow-green: rings, droplets, bubbles and the dart edges.'],
  ['colorDark', 'Dark', 'The purple-black: the dart shafts, punctures and the dark shockwave.'],
  ['colorCore', 'Core', 'The bright white-green core of flashes and trails.'],
  ['colorPlayer', 'Your side', 'Your fletching and total colour when YOU throw.'],
  ['colorFoe', 'Foe side', 'Their fletching and total colour when THEY throw.'],
];

type Ctl = TunerControl<Extract<keyof PoisonTunerValues, string>>;

function clipOptions(): string[] {
  let names: string[] = [];
  try { names = clipNames(); } catch { /* no audio here */ }
  return ['', ...names];
}

function buildControls(): Ctl[] {
  const out: Ctl[] = [{
    key: 'attackStyle', label: 'Attack style', kind: 'select', options: DEV_HERO_ATTACK_CHOICES, group: 'Style',
    optionLabels: DEV_HERO_ATTACK_LABELS,
    hint: 'Which hero attack real fights play in this dev build, for both sides. Auto = what a player sees.', min: 0, max: 0, step: 0,
  }];
  const clips = clipOptions();
  const push = (key: HeroPoisonNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_POISON_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of POISON_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroPoisonNumKey;
      const [min, max, step] = HERO_POISON_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Implode'
        ? { key, label, hint, group, min, max, step, kind: 'toggle', onValue: 1, offValue: 0 }
        : { key, label, unit, hint, group, min, max, step });
    }
  }
  for (const [ck, cl, ch] of COLORS) out.push({ key: ck, label: cl, hint: ch, group: 'Colours', kind: 'color', min: 0, max: 0, step: 0 });
  let lastGroup = '';
  for (const [key, spec] of globals) {
    const group = spec[3];
    if (!group.startsWith('Sound')) continue;
    const clipKey = CLIP_OF[group];
    if (clipKey && group !== lastGroup) {
      out.push({ key: clipKey, label: `${group.replace('Sound: ', '')}: clip`, hint: 'Which clip this cue plays. (none) = silent.', group, kind: 'select', options: clips, optionLabels: { '': '(none)' }, min: 0, max: 0, step: 0 });
    }
    lastGroup = group;
    push(key, spec);
  }
  return out;
}

let live: HeroPoisonHandle | null = null;

/** Play the real Poison Darts between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroPoisonOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroPoisonHandle | null> {
  live?.cancel();
  const cfg = getHeroPoisonConfig();
  return playAttackDemo(side, (o) => playHeroPoison(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroPoison?: unknown }).__heroPoison = { demo, previewParts };
}

export const SPEC: TunerSpec<PoisonTunerValues> = {
  id: 'heropoison',                  // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Poison',
  note: () => {
    const c = getHeroPoisonConfig();
    const p = poisonPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.implode ? `${p.darts.length} darts, implode` : `${p.darts.length} dart${p.darts.length === 1 ? '' : 's'}`} · throw ${Math.round(p.throwAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroPoisonConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroPoisonValue(key as keyof HeroPoisonConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroPoisonValue(key as keyof HeroPoisonConfig, value); },
  reset: () => { resetHeroPoisonConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_POISON_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroPoisonConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You throw', hint: 'Your hero throws poison darts at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe throws', hint: 'The foe throws poison darts at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero throws for 3: Tier I, one dart.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero throws for 8: Tier II, two darts in quick succession.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero throws for 12 from four numbers: Tier III, the fan of five.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero throws for 40 from seven numbers: Tier IV, the darts implode into a toxic burst.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe throws at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe throws at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe throws at your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe throws at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroPoisonTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
