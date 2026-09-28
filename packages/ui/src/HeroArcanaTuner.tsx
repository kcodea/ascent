import {
  ARCANA_TIER_SUFFIXES, HERO_ARCANA_DEFAULTS, HERO_ARCANA_RANGES, HERO_ARCANA_SPEEDS, TIERS, arcanaPlan, getHeroArcanaConfig,
  heroArcanaConfigJson, heroArcanaPreviewSpeed, resetHeroArcanaConfig, setHeroArcanaPreviewSpeed, setHeroArcanaValue,
  type ArcanaTierSuffix, type HeroArcanaConfig, type HeroArcanaNumKey, type HeroArcanaStrKey, type TierNum,
} from './heroArcana/heroArcanaConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroArcana, type HeroArcanaHandle, type HeroArcanaOptions } from './heroArcana/heroArcana';
import { playAttackDemo, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the ARCANA hero attack (owner ask 2026-09-28: "one more attack animation, same setup as the last 2, but
 * let's make like a magic one called arcana"). The Play buttons run the REAL runner between the two real hero portraits
 * (works from the shop), in either direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40, with reduced motion, at
 * 1x / 0.5x / 0.25x. A preview never touches the run. The "Attack style" row is the same dev override as the other
 * attack tuners' (Auto = what a player would see). Production plays the baked defaults.
 */
type ArcanaTunerValues = HeroArcanaConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroArcanaNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which Arcana steps up to Tier II (two ribbons). Shared with Blast and Quake (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which Arcana becomes the barrage of five. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which Arcana becomes the vortex and explosion. Shared (20).', 'Damage tiers'],
  popInMs: ['Pop in', 'ms', 'Each number popping in where it comes from.', 'Combine'],
  combineBackPx: ['Pull back', 'px', 'How far a number pulls back before it flies (anticipation).', 'Combine'],
  combineArc: ['Arc', '×', 'How much the numbers curve on the way in.', 'Combine'],
  combineBias: ['Merge point', '×', 'Where the numbers meet: 0 = the board centre, 1 = the attacking hero.', 'Combine'],
  chipSize: ['Number size', 'px', 'Size of each contributing number.', 'Combine'],
  totalSize: ['Total size', 'px', 'Size of the combined total.', 'Combine'],
  tickPop: ['Tick pop', '×', 'How hard the total squashes as each number lands.', 'Combine'],
  slamMs: ['Total slam', 'ms', 'The total slamming in: overshoot and settle.', 'Combine'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Charge'],
  heroSwell: ['Hero swell', '×', 'How much the hero swells as the spell gathers.', 'Charge'],
  recoilPx: ['Recoil', 'px', 'How far the hero dips as each ribbon leaves.', 'Charge'],
  ribbonLength: ['Ribbon length', 'ms', 'How much of its flight a ribbon trails behind it (longer = a longer streak).', 'Ribbons'],
  ribbonGlow: ['Glow width', '×', 'The arcane glow around the ribbon, as a multiple of its body.', 'Ribbons'],
  ribbonCore: ['Core width', '×', 'The white-hot core, as a fraction of the body.', 'Ribbons'],
  ribbonShade: ['Underlay', 'opacity', 'A dark underlay that gives the ribbon a silhouette on bright boards (0 = none).', 'Ribbons'],
  ribbonTwist: ['Twist', '×', 'How much the width breathes as the ribbon twists (0 = a plain taper).', 'Ribbons'],
  strand: ['Strand', '×', 'The thin cyan strand winding round the ribbon (0 = none).', 'Ribbons'],
  headSize: ['Head size', '×', 'The orb and flare at the ribbon head.', 'Ribbons'],
  sigilSize: ['Head sigil', '×', 'The spinning sigil at the ribbon head (0 = none).', 'Ribbons'],
  swirlRadius: ['Vortex radius', '×', 'Tier IV: the vortex radius, in portrait radii.', 'Swirl (Tier IV)'],
  swirlTilt: ['Vortex tilt', '×', 'Tier IV: how flat the ring looks (1 = a circle, lower = a tilted ring seen at an angle).', 'Swirl (Tier IV)'],
  swirlMs: ['Swirl time', 'ms', 'Tier IV: how long the vortex spins from the first ribbon joining to the collapse.', 'Swirl (Tier IV)'],
  swirlSpeed0: ['Spin start', undefined, 'Tier IV: turns a second as the vortex forms.', 'Swirl (Tier IV)'],
  swirlSpeed1: ['Spin end', undefined, 'Tier IV: turns a second at the collapse (it speeds up to this).', 'Swirl (Tier IV)'],
  swirlTighten: ['Tighten', '×', 'Tier IV: how far the ring closes in as it spins up (0 = not at all).', 'Swirl (Tier IV)'],
  convergeMs: ['Collapse', 'ms', 'Tier IV: the ribbons snapping into the centre before the explosion.', 'Swirl (Tier IV)'],
  explodeSize: ['Explosion size', '×', 'Tier IV: the scale of the explosion.', 'Explosion'],
  explodeRibbons: ['Blast ribbons', undefined, 'Tier IV: ribbons flung outward by the explosion.', 'Explosion'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact and explosion flashes are.', 'Explosion'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxGatherGain: ['gather: gain', undefined, 'The whoosh as the numbers leave.', 'Sound: gather'],
  sfxTickGain: ['tick: gain', undefined, 'Each number landing in the total.', 'Sound: tick'],
  sfxTickRate: ['tick: pitch', '×', 'The first tick pitch (1 = as recorded).', 'Sound: tick'],
  sfxTickStep: ['tick: pitch step', '×', 'Each following tick rises by this much.', 'Sound: tick'],
  sfxSlamGain: ['total slam: gain', undefined, 'The total slamming in.', 'Sound: total slam'],
  sfxSlamRate: ['total slam: pitch', '×', 'Pitch of the total slam.', 'Sound: total slam'],
  sfxCastGain: ['cast: gain', undefined, 'The spell being cast as the charge starts.', 'Sound: cast'],
  sfxCastRate: ['cast: pitch', '×', 'Pitch of the cast.', 'Sound: cast'],
  sfxChargeGain: ['charge: gain', undefined, 'The riser climbing to the first launch.', 'Sound: charge'],
  sfxChargeRate: ['charge: pitch', '×', 'Pitch of the riser.', 'Sound: charge'],
  sfxLaunchGain: ['launch: gain', undefined, 'The sparkling whoosh of each ribbon leaving (each a little higher).', 'Sound: launch'],
  sfxLaunchRate: ['launch: pitch', '×', 'Pitch of the first launch.', 'Sound: launch'],
  sfxShimmerGain: ['shimmer: gain', undefined, 'A shimmer riding the ribbons in flight.', 'Sound: shimmer'],
  sfxShimmerRate: ['shimmer: pitch', '×', 'Pitch of the shimmer.', 'Sound: shimmer'],
  sfxHitGain: ['tick hit: gain', undefined, 'The bright crack of each barrage ribbon landing (pitch climbs).', 'Sound: tick hit'],
  sfxHitRate: ['tick hit: pitch', '×', 'Pitch of the first crack.', 'Sound: tick hit'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the last ribbon, or the explosion.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxChimeGain: ['chime: gain', undefined, 'A bright chime on the impact (and softly as each ribbon joins the vortex).', 'Sound: chime'],
  sfxChimeRate: ['chime: pitch', '×', 'Pitch of the chime.', 'Sound: chime'],
  sfxThumpGain: ['thump: gain', undefined, 'A low punch under the impact (punchy, not boomy).', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxImplodeGain: ['collapse: gain', undefined, 'Tier IV: the vortex collapsing inward.', 'Sound: collapse'],
  sfxImplodeRate: ['collapse: pitch', '×', 'Pitch of the collapse.', 'Sound: collapse'],
  sfxExplodeGain: ['explosion: gain', undefined, 'Tier IV: the explosion (pitched up to crack, not boom).', 'Sound: explosion'],
  sfxExplodeRate: ['explosion: pitch', '×', 'Pitch of the explosion.', 'Sound: explosion'],
  sfxBigGain: ['big hit: gain', undefined, 'Tiers III and IV: an extra crack layered on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxBoomGain: ['aftershock: gain', undefined, 'Tier IV: the sparkle pops after the explosion.', 'Sound: aftershock'],
  sfxBoomRate: ['aftershock: pitch', '×', 'Pitch of the first aftershock.', 'Sound: aftershock'],
  sfxSwirlGain: ['swirl: gain', undefined, 'Tier IV: the synth tone rising as the vortex spins up (peaks on the explosion).', 'Sound: swirl'],
  sfxSwirlLowHz: ['swirl: from', undefined, 'Hz. Where the swirl tone starts.', 'Sound: swirl'],
  sfxSwirlHighHz: ['swirl: to', undefined, 'Hz. Where it has risen to at the explosion.', 'Sound: swirl'],
  sfxTickLenMs: ['tick length', 'ms', 'Each tick is cut to this long (with a short fade).', 'Sound: mix'],
  sfxLaunchLenMs: ['launch length', 'ms', 'Each launch whoosh is cut to this long (with a fade).', 'Sound: mix'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact and explosion clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while Arcana plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<ArcanaTierSuffix, [string, TunerUnit | undefined, string]> = {
  FlyMs: ['Number flight', 'ms', 'How long each number takes to reach the total.'],
  StaggerMs: ['Number stagger', 'ms', 'Gap between each number leaving.'],
  SlamPop: ['Total pop', '×', 'How big the total punches up when the last number lands.'],
  HoldMs: ['Hold', 'ms', 'The total holds before the hero absorbs it.'],
  ChargeMs: ['Charge', 'ms', 'The spell gathering before the first ribbon leaves. The view pushes in over this.'],
  Ribbons: ['Ribbons', undefined, 'How many ribbons are lobbed (I one, II two, III the barrage of five, IV the vortex).'],
  LaunchStaggerMs: ['Launch stagger', 'ms', 'Gap between each ribbon leaving (the barrage rhythm).'],
  FlightMs: ['Flight', 'ms', 'A ribbon crossing the board (at 1600 px; scales gently with distance).'],
  ArcHeight: ['Arc height', '×', 'How high the lob arcs, as a fraction of the distance.'],
  Fan: ['Fan', '×', 'How far a volley spreads its arcs apart.'],
  RibbonWidth: ['Ribbon width', 'px', 'The body width of each ribbon (the last is a little bigger).'],
  Swirl: ['Vortex', undefined, 'The ribbons swirl over the target, converge and explode instead of striking.'],
  HitStop: ['Hit-stop', 'ms', 'The freeze on the impact frame.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the charge (and the vortex).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Motes: ['Glitter', undefined, 'Glitter stars thrown by the impact.'],
  Burst: ['Burst size', '×', 'Scale of the impact flash and bloom.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroArcanaStrKey>> = {
  'Sound: gather': 'sfxGatherClip', 'Sound: tick': 'sfxTickClip', 'Sound: total slam': 'sfxSlamClip', 'Sound: cast': 'sfxCastClip',
  'Sound: charge': 'sfxChargeClip', 'Sound: launch': 'sfxLaunchClip', 'Sound: shimmer': 'sfxShimmerClip', 'Sound: tick hit': 'sfxHitClip',
  'Sound: impact': 'sfxImpactClip', 'Sound: chime': 'sfxChimeClip', 'Sound: thump': 'sfxThumpClip', 'Sound: collapse': 'sfxImplodeClip',
  'Sound: explosion': 'sfxExplodeClip', 'Sound: big hit': 'sfxBigClip', 'Sound: aftershock': 'sfxBoomClip',
};

const COLORS: [HeroArcanaStrKey, string, string][] = [
  ['colorPlayer', 'Your arcana', 'The ribbon glow, sigils and total colour when YOU strike.'],
  ['colorFoe', 'Foe arcana', 'The ribbon glow, sigils and total colour when THEY strike.'],
  ['colorAccent', 'Accent', 'The cyan strand, rings and glitter.'],
  ['colorCore', 'Core', 'The white-hot core of the ribbons and flashes.'],
  ['colorShade', 'Underlay', 'The dark underlay beneath each ribbon.'],
];

type Ctl = TunerControl<Extract<keyof ArcanaTunerValues, string>>;

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
  const push = (key: HeroArcanaNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_ARCANA_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of ARCANA_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroArcanaNumKey;
      const [min, max, step] = HERO_ARCANA_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Swirl'
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

let live: HeroArcanaHandle | null = null;

/** Play the real Arcana between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroArcanaOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroArcanaHandle | null> {
  live?.cancel();
  const cfg = getHeroArcanaConfig();
  return playAttackDemo(side, (o) => playHeroArcana(o), {
    damage: opts.damage ?? cfg.previewDamage, parts: opts.parts ?? cfg.previewParts, combineBias: cfg.combineBias,
    speed: heroArcanaPreviewSpeed(), reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroArcana?: unknown }).__heroArcana = { demo, previewParts, setSpeed: setHeroArcanaPreviewSpeed };
}

export const SPEC: TunerSpec<ArcanaTunerValues> = {
  id: 'heroarcana',                  // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Arcana',
  note: () => {
    const c = getHeroArcanaConfig();
    const p = arcanaPlan({ values: previewParts(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${heroArcanaPreviewSpeed()}x · tier ${p.tier} · ${p.swirl ? 'vortex' : `${p.ribbons.length} ribbon${p.ribbons.length === 1 ? '' : 's'}`} · fire ${Math.round(p.fireAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroArcanaConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroArcanaValue(key as keyof HeroArcanaConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroArcanaValue(key as keyof HeroArcanaConfig, value); },
  reset: () => { resetHeroArcanaConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_ARCANA_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroArcanaConfigJson(),
  copyLabel: 'Copy JSON',
  actions: [
    { label: '▶ You cast', hint: 'Your hero casts Arcana at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe casts', hint: 'The foe casts Arcana at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero casts for 3: Tier I, one ribbon.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero casts for 8: Tier II, two ribbons.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero casts for 12 from four numbers: Tier III, the barrage of five.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero casts for 40 from seven numbers: Tier IV, the vortex and explosion.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe casts at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe casts at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe casts at your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe casts at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
    { label: '▶ Reduced motion', hint: 'What a player with reduced motion on sees: fades, no ribbons, shake, zoom or hit-stop.', run: () => { void demo('player', { reduced: true }); } },
    ...HERO_ARCANA_SPEEDS.map((s) => ({
      label: `Speed ${s}x`,
      hint: 'Slow motion for the next plays (the tuner only; never saved, never in production).',
      run: () => { setHeroArcanaPreviewSpeed(s); },
    })),
  ],
};

export function HeroArcanaTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
