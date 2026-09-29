import {
  HERO_STORM_DEFAULTS, HERO_STORM_RANGES, STORM_LEVELS, STORM_LEVEL_NAMES, STORM_LEVEL_SUFFIXES, getHeroStormConfig, heroStormConfigJson,
  resetHeroStormConfig, setHeroStormValue, stormPlan,
  type HeroStormConfig, type HeroStormNumKey, type HeroStormStrKey, type StormLevel, type StormLevelSuffix,
} from './heroStorm/heroStormConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroStorm, type HeroStormHandle, type HeroStormOptions } from './heroStorm/heroStorm';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the STORM CALL hero attack (an Epic; owner ask 2026-09-29: "build 5 animations that range from rare ->
 * epic ... rare and epics should only have 2 or 3 tiers"). Three looks: Small (a crackling bolt), Medium (a forked bolt
 * that strikes twice) and Big (a storm cloud and a thick strike). The Play buttons run the REAL runner between the two
 * real hero portraits, in either direction. A preview never touches the run. Production plays the baked defaults.
 */
type StormTunerValues = HeroStormConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroStormNumKey, `v${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Medium from', undefined, 'Damage at which the shared Tier II starts (Storm Call plays Medium from here). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'The shared Tier III (still Medium for an Epic). Shared (12).', 'Damage tiers'],
  tier4At: ['Big from', undefined, 'Damage at which the shared Tier IV starts: the storm. Shared (20). A knockout always plays it.', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Charge'],
  heroCoilPx: ['Lean back', 'px', 'How far the hero leans back as the static gathers.', 'Charge'],
  heroThrustPx: ['Thrust', 'px', 'How far the hero thrusts as a bolt leaves (up, for the Big call).', 'Charge'],
  chargeArcs: ['Charge crackles', undefined, 'Little arcs of static crackling round the hero as it charges (0 = none).', 'Charge'],
  boltWidth: ['Bolt width', 'px', 'How thick a bolt is (the look width multiplies it).', 'Bolts'],
  glowWidth: ['Bolt glow', '×', 'How wide the soft glow round a bolt is, as a multiple of the bolt.', 'Bolts'],
  regenMs: ['Crackle rate', 'ms', 'How often a bolt redraws its jagged shape (lower = a faster crackle).', 'Bolts'],
  fadeMs: ['Bolt fade', 'ms', 'How long a bolt takes to fade out once it has flickered.', 'Bolts'],
  bow: ['Bow', '×', 'How far a bolt curves away from a straight line, as a fraction of its length.', 'Bolts'],
  forkAt: ['Fork point', '×', 'Medium: how far along the trunk splits into two branches.', 'The fork (Medium)'],
  forkGapMs: ['Second strike', 'ms', 'Medium: the gap between the two branches striking.', 'The fork (Medium)'],
  forkSpread: ['Branch spread', '×', 'Medium: how far apart the two branches land (portrait radii).', 'The fork (Medium)'],
  staticMs: ['Static time', 'ms', 'Medium: how long static crawls over the struck hero after the strikes.', 'Static'],
  staticArcs: ['Static arcs', undefined, 'How many arcs of static crawl over the struck hero at once.', 'Static'],
  jitterPx: ['Jitter', 'px', 'How hard the struck portrait jitters with static.', 'Static'],
  callMs: ['Call', 'ms', 'Big: the thin bolt the hero calls up to the sky.', 'The storm (Big)'],
  gatherMs: ['Gather', 'ms', 'Big: the cloud gathering over the target.', 'The storm (Big)'],
  rumbleMs: ['Rumble', 'ms', 'Big: the cloud rumbling and lighting up before it strikes.', 'The storm (Big)'],
  cloudSize: ['Cloud size', '×', 'Big: how big the storm cloud is.', 'The storm (Big)'],
  cloudLift: ['Cloud height', '×', 'Big: how high over the target the cloud gathers (portrait radii).', 'The storm (Big)'],
  lingerMs: ['Linger', 'ms', 'Big: how long static crawls over the struck hero after the strike.', 'The storm (Big)'],
  screenFlash: ['Screen flash', 'opacity', 'Big: the flash across the whole screen as the strike lands (0 = none).', 'The storm (Big)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact flash is.', 'Camera and portraits'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxChargeGain: ['charge: gain', undefined, 'The static charging up on the hero.', 'Sound: charge'],
  sfxChargeRate: ['charge: pitch', '×', 'Pitch of the charge.', 'Sound: charge'],
  sfxZapGain: ['zap: gain', undefined, 'A bolt striking.', 'Sound: zap'],
  sfxZapRate: ['zap: pitch', '×', 'Pitch of the zap.', 'Sound: zap'],
  sfxCrackGain: ['crack: gain', undefined, 'The crack of a bolt leaving the hero, and on the Medium impact.', 'Sound: crack'],
  sfxCrackRate: ['crack: pitch', '×', 'Pitch of the crack.', 'Sound: crack'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxStaticGain: ['static: gain', undefined, 'Static crackling over the struck hero.', 'Sound: static'],
  sfxStaticRate: ['static: pitch', '×', 'Pitch of the static.', 'Sound: static'],
  sfxCallGain: ['call: gain', undefined, 'Big: the hero calling up the storm.', 'Sound: call'],
  sfxCallRate: ['call: pitch', '×', 'Pitch of the call.', 'Sound: call'],
  sfxRumbleGain: ['rumble: gain', undefined, 'Big: the cloud gathering and rumbling.', 'Sound: rumble'],
  sfxRumbleRate: ['rumble: pitch', '×', 'Pitch of the rumble (lower = deeper).', 'Sound: rumble'],
  sfxThunderGain: ['thunder: gain', undefined, 'Big: the thunder on the strike.', 'Sound: thunder'],
  sfxThunderRate: ['thunder: pitch', '×', 'Pitch of the thunder.', 'Sound: thunder'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact and thunder clips are cut to about this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the storm plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<StormLevelSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Charge', 'ms', 'Static gathering on the hero before the first bolt (Big: before the call). The view pushes in over this.'],
  LeaderMs: ['Leader', 'ms', 'How long a bolt takes to race from end to end (Big: the strike from the cloud).'],
  FlickerMs: ['Flicker', 'ms', 'How long a landed bolt flickers before it fades.'],
  Width: ['Width', '×', 'The bolt width multiplier for this look (Big: the thick strike).'],
  Jag: ['Jag', '×', 'How jagged a bolt is, as a fraction of its length.'],
  Forks: ['Side forks', undefined, 'Little forks crackling off each bolt.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the charge (Big: through the gathering storm).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Sparks: ['Sparks', undefined, 'Sparks thrown by the strike (Big also throws a ring of them).'],
  Burst: ['Burst size', '×', 'Scale of the impact flash and rings.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const CLIP_OF: Partial<Record<string, HeroStormStrKey>> = {
  'Sound: charge': 'sfxChargeClip', 'Sound: zap': 'sfxZapClip', 'Sound: crack': 'sfxCrackClip', 'Sound: impact': 'sfxImpactClip',
  'Sound: static': 'sfxStaticClip', 'Sound: call': 'sfxCallClip', 'Sound: rumble': 'sfxRumbleClip', 'Sound: thunder': 'sfxThunderClip',
};

const COLORS: [HeroStormStrKey, string, string][] = [
  ['colorCore', 'Core', 'The white-hot core of every bolt, flash and spark.'],
  ['colorBolt', 'Bolt', 'The electric blue of the bolts, their glow, the static and the rings.'],
  ['colorViolet', 'Violet', 'The violet of the Big call, the second ring and some sparks.'],
  ['colorCloud', 'Cloud', 'The storm cloud.'],
  ['colorPlayer', 'Your side', 'The charge glow and total colour when YOU strike.'],
  ['colorFoe', 'Foe side', 'The charge glow and total colour when THEY strike.'],
];

type Ctl = TunerControl<Extract<keyof StormTunerValues, string>>;

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
  const push = (key: HeroStormNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_STORM_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const v of STORM_LEVELS) {
    for (const s of STORM_LEVEL_SUFFIXES) {
      const [label, unit, hint] = LEVEL_SPECS[s];
      const key = `v${v}${s}` as HeroStormNumKey;
      const [min, max, step] = HERO_STORM_RANGES[key];
      out.push({ key, label, unit, hint, group: STORM_LEVEL_NAMES[v as StormLevel], min, max, step });
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

let live: HeroStormHandle | null = null;

/** Play the real Storm Call between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroStormOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroStormHandle | null> {
  live?.cancel();
  const cfg = getHeroStormConfig();
  return playAttackDemo(side, (o) => playHeroStorm(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroStorm?: unknown }).__heroStorm = { demo, previewParts, play: playHeroStorm };
}

const LOOK_OF: Record<StormLevel, string> = { 1: 'a crackling bolt', 2: 'a forked double strike', 3: 'the storm' };

export const SPEC: TunerSpec<StormTunerValues> = {
  id: 'herostorm',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Storm Call',
  note: () => {
    const c = getHeroStormConfig();
    const p = stormPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${STORM_LEVEL_NAMES[p.level]} (${LOOK_OF[p.level]}) · bolt ${Math.round(p.boltAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroStormConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroStormValue(key as keyof HeroStormConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroStormValue(key as keyof HeroStormConfig, value); },
  reset: () => { resetHeroStormConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_STORM_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroStormConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You strike', hint: 'Your hero calls lightning on the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe strikes', hint: 'The foe calls lightning on your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero strikes for 3: Small, one crackling bolt.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Medium (8)', hint: 'Your hero strikes for 8: Medium, a forked bolt that strikes twice.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero strikes for 12 from four numbers: still Medium (an Epic has three looks).', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Big (40)', hint: 'Your hero strikes for 40 from seven numbers: Big, the storm cloud and the thick strike.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe strikes your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe medium (8)', hint: 'The foe strikes your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe big (40)', hint: 'The foe strikes your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroStormTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
