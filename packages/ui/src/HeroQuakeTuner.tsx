import {
  HERO_QUAKE_DEFAULTS, HERO_QUAKE_RANGES, HERO_QUAKE_SPEEDS, QUAKE_TIER_SUFFIXES, TIERS, getHeroQuakeConfig, heroQuakeConfigJson,
  heroQuakePreviewSpeed, quakePlan, resetHeroQuakeConfig, setHeroQuakePreviewSpeed, setHeroQuakeValue,
  type HeroQuakeConfig, type HeroQuakeNumKey, type HeroQuakeStrKey, type QuakeTierSuffix, type TierNum,
} from './heroQuake/heroQuakeConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroQuake, type HeroQuakeHandle, type HeroQuakeOptions } from './heroQuake/heroQuake';
import { playAttackDemo, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the QUAKE hero attack (owner ask 2026-09-28: "make a new attack animation called quake"). The Play
 * buttons run the REAL runner between the two real hero portraits (works from the shop), in either direction, at
 * Small 3 / Medium 12 / Huge 40, with reduced motion, at 1x / 0.5x / 0.25x. A preview never touches the run. The
 * "Attack style" row is the same dev override as the Blast tuner's (Auto = what a player would see). Production
 * plays the baked defaults.
 */
type QuakeTunerValues = HeroQuakeConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroQuakeNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which it steps up to Tier II (two boulders). Shared with Blast (6 by default).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which it steps up to Tier III (three hot boulders, magma). Shared with Blast (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which it becomes the true earthquake and eruption. Shared with Blast (20).', 'Damage tiers'],
  popInMs: ['Pop in', 'ms', 'Each number popping in where it comes from.', 'Combine'],
  combineBackPx: ['Pull back', 'px', 'How far a number pulls back before it flies (anticipation).', 'Combine'],
  combineArc: ['Arc', '×', 'How much the numbers curve on the way in.', 'Combine'],
  combineBias: ['Merge point', '×', 'Where the numbers meet: 0 = the board centre, 1 = the attacking hero.', 'Combine'],
  chipSize: ['Number size', 'px', 'Size of each contributing number.', 'Combine'],
  totalSize: ['Total size', 'px', 'Size of the combined total.', 'Combine'],
  tickPop: ['Tick pop', '×', 'How hard the total squashes as each number lands.', 'Combine'],
  slamMs: ['Total slam', 'ms', 'The total slamming in: overshoot and settle.', 'Combine'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Wind-up and slam'],
  heroSwell: ['Hero swell', '×', 'How much the hero swells as it rises.', 'Wind-up and slam'],
  heroSquash: ['Hero squash', '×', 'How hard the hero squashes when it slams the ground.', 'Wind-up and slam'],
  crackSegPx: ['Crack step', 'px', 'Length of each crack segment (shorter = more jagged detail).', 'Cracks'],
  crackJag: ['Jaggedness', '×', 'How far the crack wanders off the straight line.', 'Cracks'],
  crackOpenPx: ['Opening', 'px', 'How far behind its tip a crack takes to open to full width.', 'Cracks'],
  branchLength: ['Branch length', '×', 'Branch length as a fraction of the main crack.', 'Cracks'],
  crackFadeMs: ['Crack fade', 'ms', 'How long the cracks take to fade at the end.', 'Cracks'],
  coolMs: ['Magma cool', 'ms', 'How long the magma seams take to cool after the eruption (longer with a crater).', 'Cracks'],
  flashAlpha: ['Eruption flash', 'opacity', 'How bright the eruption flash is.', 'Eruption'],
  rockSize: ['Rock size', '×', 'Size of the rock chunks thrown by the eruption.', 'Eruption'],
  rockGravity: ['Rock gravity', undefined, 'How fast thrown rocks fall back (px per second squared, scaled by the stage).', 'Eruption'],
  pillarHoldMs: ['Pillar hold', 'ms', 'Tier IV: how long the pillar of magma holds before it collapses.', 'Eruption'],
  craterMs: ['Crater linger', 'ms', 'Tier III and IV: how long the glowing crater lingers.', 'Eruption'],
  knockPx: ['Jolt', 'px', 'How far the struck portrait is jolted up by the eruption.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Jolt length', 'ms', 'How long the slam and impact jolts take to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the eruption.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxGatherGain: ['gather: gain', undefined, 'The whoosh as the numbers leave.', 'Sound: gather'],
  sfxTickGain: ['tick: gain', undefined, 'Each number landing in the total.', 'Sound: tick'],
  sfxTickRate: ['tick: pitch', '×', 'The first tick pitch (1 = as recorded).', 'Sound: tick'],
  sfxTickStep: ['tick: pitch step', '×', 'Each following tick rises by this much.', 'Sound: tick'],
  sfxSlamGain: ['total slam: gain', undefined, 'The total slamming in.', 'Sound: total slam'],
  sfxSlamRate: ['total slam: pitch', '×', 'Pitch of the total slam.', 'Sound: total slam'],
  sfxWindupGain: ['wind-up: gain', undefined, 'The grinding rise as the hero lifts (lands on the slam).', 'Sound: wind-up'],
  sfxWindupRate: ['wind-up: pitch', '×', 'Pitch of the wind-up (lower per tier).', 'Sound: wind-up'],
  sfxGroundGain: ['ground slam: gain', undefined, 'The hero hitting the ground.', 'Sound: ground slam'],
  sfxGroundRate: ['ground slam: pitch', '×', 'Pitch of the ground slam (lower per tier).', 'Sound: ground slam'],
  sfxThumpGain: ['thump: gain', undefined, 'The low punch under the slam and the eruption (punchy, not boomy).', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxCrackGain: ['crack: gain', undefined, 'Rock splitting: on the slam, each burst and the eruption.', 'Sound: crack'],
  sfxCrackRate: ['crack: pitch', '×', 'Pitch of the splitting rock.', 'Sound: crack'],
  sfxEruptGain: ['eruption: gain', undefined, 'The ground erupting under the target.', 'Sound: eruption'],
  sfxEruptRate: ['eruption: pitch', '×', 'Pitch of the eruption (lower per tier).', 'Sound: eruption'],
  sfxBigGain: ['big blast: gain', undefined, 'Tiers III and IV: a blast layered on the eruption.', 'Sound: big blast'],
  sfxBigRate: ['big blast: pitch', '×', 'Pitch of the big blast.', 'Sound: big blast'],
  sfxBoomGain: ['booms: gain', undefined, 'Tiers III and IV: each burst and follow-up explosion (pitch climbs).', 'Sound: booms'],
  sfxBoomRate: ['booms: pitch', '×', 'Pitch of the first explosion.', 'Sound: booms'],
  sfxPatterGain: ['debris: gain', undefined, 'Rocks pattering down after the eruption.', 'Sound: debris'],
  sfxPatterRate: ['debris: pitch', '×', 'Pitch of the patter.', 'Sound: debris'],
  sfxThrowGain: ['throw: gain', undefined, 'Tiers I-III: each boulder hurled (pitch climbs per boulder).', 'Sound: throw'],
  sfxThrowRate: ['throw: pitch', '×', 'Pitch of the first throw.', 'Sound: throw'],
  sfxRumbleGain: ['rumble: gain', undefined, 'The synth rumble that builds from the slam to the eruption, then rings out.', 'Sound: rumble'],
  sfxRumbleLowHz: ['rumble: low cut', undefined, 'Hz. Nothing below this (keeps the low end punchy, not muddy).', 'Sound: rumble'],
  sfxRumbleHighHz: ['rumble: top', undefined, 'Hz. How bright the rumble opens up to at its peak.', 'Sound: rumble'],
  sfxTickLenMs: ['tick length', 'ms', 'Each tick is cut to this long (with a short fade).', 'Sound: mix'],
  sfxEruptLenMs: ['eruption length', 'ms', 'The eruption clip is cut to this long (with a fade).', 'Sound: mix'],
  sfxBoomLenMs: ['boom length', 'ms', 'Each explosion is cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['eruption tail', undefined, 'A short reverb tail on the eruption. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the quake plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<QuakeTierSuffix, [string, TunerUnit | undefined, string]> = {
  FlyMs: ['Number flight', 'ms', 'How long each number takes to reach the total.'],
  StaggerMs: ['Number stagger', 'ms', 'Gap between each number leaving.'],
  SlamPop: ['Total pop', '×', 'How big the total punches up when the last number lands.'],
  HoldMs: ['Hold', 'ms', 'The total holds before the hero absorbs it.'],
  LiftMs: ['Wind-up', 'ms', 'The hero rising before the slam. The view pushes in over this.'],
  LiftPx: ['Rise', 'px', 'How high the hero rises before it slams down.'],
  SlamStop: ['Slam stop', 'ms', 'A small freeze on the slam frame.'],
  TravelMs: ['Travel', 'ms', 'The quake crossing the board (at 1600 px; scales gently with distance).'],
  CrackWidth: ['Crack width', 'px', 'Width of the main crack (branches and fissures are narrower).'],
  Branches: ['Branches', undefined, 'Cracks splitting off the main one.'],
  Fissures: ['Fissures', undefined, 'Parallel cracks running beside the main one.'],
  Magma: ['Magma', 'opacity', 'How hot the seams glow (0 = a dry crack with a hint of light).'],
  Bursts: ['Path bursts', undefined, 'Secondary eruptions along the crack as it travels.'],
  BoardCracks: ['Board cracks', undefined, 'Cracks the slam sends across the whole board.'],
  Rocks: ['Rocks', undefined, 'Rock chunks the eruption throws.'],
  Dust: ['Dust', '×', 'How big the dust clouds are.'],
  Eruption: ['Eruption size', '×', 'Scale of the eruption under the target.'],
  Pillar: ['Pillar', undefined, 'A pillar of magma and rock erupts under the target.'],
  Crater: ['Crater', 'opacity', 'A glowing scorched crater that lingers around the target.'],
  HitStop: ['Hit-stop', 'ms', 'The freeze on the eruption frame.'],
  Rumble: ['Rumble', 'px', 'The rolling camera rumble as the quake travels (mostly vertical).'],
  Shake: ['Jolt', 'px', 'The hard jolt on the slam and the eruption.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the wind-up.'],
  Punch: ['Impact punch', '×', 'Extra push on the eruption before the view settles.'],
  RumbleTailMs: ['Rumble tail', 'ms', 'How long the rumble rings out after the eruption.'],
  Booms: ['Follow-up booms', undefined, 'Explosions ringing the struck hero after the eruption.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
  Quake: ['Earthquake', undefined, 'On: a true quake (the crack races to the target). Off: the hero hurls boulders instead (Tier IV only by default).'],
  Boulders: ['Boulders', undefined, 'Boulders hurled (the last is the hit; earlier ones land as ticks).'],
  BoulderSize: ['Boulder size', '×', 'Size of the hurled boulder.'],
  FlightMs: ['Boulder flight', 'ms', 'How long a boulder is in the air (at 1600 px; scales gently with distance).'],
  ThrowGapMs: ['Throw gap', 'ms', 'Gap between boulders in a volley.'],
  ArcLift: ['Arc height', '×', 'How high the boulder is lobbed (a fraction of the distance; kept in frame).'],
  Spikes: ['Stone spikes', undefined, 'Spikes that burst out of the ground round the struck hero.'],
  SpikeHeight: ['Spike height', '×', 'How tall the spikes grow.'],
  Spray: ['Magma spray', undefined, 'Molten streaks thrown up out of the eruption.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroQuakeStrKey>> = {
  'Sound: gather': 'sfxGatherClip', 'Sound: tick': 'sfxTickClip', 'Sound: total slam': 'sfxSlamClip', 'Sound: wind-up': 'sfxWindupClip',
  'Sound: ground slam': 'sfxGroundClip', 'Sound: thump': 'sfxThumpClip', 'Sound: crack': 'sfxCrackClip', 'Sound: eruption': 'sfxEruptClip',
  'Sound: big blast': 'sfxBigClip', 'Sound: booms': 'sfxBoomClip', 'Sound: debris': 'sfxPatterClip', 'Sound: throw': 'sfxThrowClip',
};

const COLORS: [HeroQuakeStrKey, string, string][] = [
  ['colorPlayer', 'Your magma', 'The magma, glows and total colour when YOU strike.'],
  ['colorFoe', 'Foe magma', 'The magma, glows and total colour when THEY strike.'],
  ['colorCore', 'Core', 'The white-hot core of the flashes and the pillar.'],
  ['colorChasm', 'Chasm', 'The dark inside of the cracks (and the crater scorch).'],
  ['colorLip', 'Crack lip', 'The light broken edge around each crack (reads on any board).'],
  ['colorDust', 'Dust', 'The dust clouds and shockwave rings.'],
  ['colorRock', 'Rock', 'The rock chunks (hot ones start in the magma colour).'],
];

type Ctl = TunerControl<Extract<keyof QuakeTunerValues, string>>;

function clipOptions(): string[] {
  let names: string[] = [];
  try { names = clipNames(); } catch { /* no audio here */ }
  return ['', ...names];
}

function buildControls(): Ctl[] {
  const out: Ctl[] = [{
    key: 'attackStyle', label: 'Attack style', kind: 'select', options: DEV_HERO_ATTACK_CHOICES, group: 'Style',
    optionLabels: { auto: 'Auto (equipped cosmetic)', classic: 'Classic (lunge)', blast: 'Blast', quake: 'Quake' },
    hint: 'Which hero attack real fights play in this dev build, for both sides. Auto = what a player sees.', min: 0, max: 0, step: 0,
  }];
  const clips = clipOptions();
  const push = (key: HeroQuakeNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_QUAKE_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of QUAKE_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroQuakeNumKey;
      const [min, max, step] = HERO_QUAKE_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Pillar' || s === 'Quake'
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

let live: HeroQuakeHandle | null = null;

/** Play the real Quake between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroQuakeOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroQuakeHandle | null> {
  live?.cancel();
  const cfg = getHeroQuakeConfig();
  return playAttackDemo(side, (o) => playHeroQuake(o), {
    damage: opts.damage ?? cfg.previewDamage, parts: opts.parts ?? cfg.previewParts, combineBias: cfg.combineBias,
    speed: heroQuakePreviewSpeed(), reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroQuake?: unknown }).__heroQuake = { demo, previewParts, setSpeed: setHeroQuakePreviewSpeed };
}

export const SPEC: TunerSpec<QuakeTunerValues> = {
  id: 'heroquake',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Quake',
  note: () => {
    const c = getHeroQuakeConfig();
    const p = quakePlan({ values: previewParts(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${heroQuakePreviewSpeed()}x · tier ${p.tier} · slam ${Math.round(p.slamAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroQuakeConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroQuakeValue(key as keyof HeroQuakeConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroQuakeValue(key as keyof HeroQuakeConfig, value); },
  reset: () => { resetHeroQuakeConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_QUAKE_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroQuakeConfigJson(),
  copyLabel: 'Copy JSON',
  actions: [
    { label: '▶ You quake', hint: 'Your hero quakes the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe quakes', hint: 'The foe quakes your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero strikes for 3: Tier I, one hurled boulder.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero strikes for 8 from three numbers: Tier II, two boulders.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero strikes for 12 from four numbers: Tier III, three hot boulders.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero quakes for 40 from seven numbers: the Tier IV earthquake and eruption.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe quakes your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe quakes your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe quakes your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
    { label: '▶ Reduced motion', hint: 'What a player with reduced motion on sees: fades, no cracks, shake, zoom or hit-stop.', run: () => { void demo('player', { reduced: true }); } },
    ...HERO_QUAKE_SPEEDS.map((s) => ({
      label: `Speed ${s}x`,
      hint: 'Slow motion for the next plays (the tuner only; never saved, never in production).',
      run: () => { setHeroQuakePreviewSpeed(s); },
    })),
  ],
};

export function HeroQuakeTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
