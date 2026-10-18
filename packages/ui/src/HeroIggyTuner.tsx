import {
  HERO_IGGY_DEFAULTS, HERO_IGGY_RANGES, IGGY_TIER_SUFFIXES, TIERS, getHeroIggyConfig, heroIggyConfigJson, iggyPlan,
  resetHeroIggyConfig, setHeroIggyValue,
  type HeroIggyConfig, type HeroIggyNumKey, type HeroIggyStrKey, type IggyTierSuffix, type TierNum,
} from './heroIggy/heroIggyConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroIggy, type HeroIggyHandle, type HeroIggyOptions } from './heroIggy/heroIggy';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the IGGY BLAST hero attack (owner 2026-10-18 picked concept A, RECOIL WARD: "go with A, legendary
 * rarity, name Iggy Blast"). The Play buttons run the REAL runner between the two real hero portraits (works from the
 * shop), in either direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40 and a Knockout; the Play row sits at the TOP
 * and there are no speed or reduced-motion buttons (owner 2026-09-29, every attack tuner). A preview never touches the
 * run. The "Attack style" row is the same dev override as the other attack tuners' (Auto = what a player would see).
 * Production plays the baked defaults.
 */
type IggyTunerValues = HeroIggyConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroIggyNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which the breath gets its second (cyan) stage. Shared with every hero attack (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which the breath climbs all three stages (white-cored). Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which the ward shatters on the rebound. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Ward up + crouch'],
  crouch: ['Crouch', '×', 'How low the hero crouches before it breathes (a squash down and wide).', 'Ward up + crouch'],
  wardRadius: ['Ward size', '×', 'The ward round the hero, in portrait radii.', 'Ward up + crouch'],
  wardAlpha: ['Ward opacity', 'opacity', 'How visible the ward is.', 'Ward up + crouch'],
  wardGlow: ['Ward glow', '×', 'How much brighter the ward glows as the push builds.', 'Ward up + crouch'],
  streamFlame: ['Stream flame', '×', 'How dense the breath is (flame particles along the stream).', 'Breath'],
  streamSpeed: ['Stream flow', '×', 'How fast the flame flows down the stream.', 'Breath'],
  turbulence: ['Turbulence', '×', 'How much the breath licks and curls.', 'Breath'],
  buoyancy: ['Buoyancy', '×', 'How much the flame rises off the stream (low keeps it a jet).', 'Breath'],
  smoke: ['Smoke', '×', 'How much smoke the breath leaves.', 'Breath'],
  embers: ['Embers', '×', 'How many embers fly off the stream and the blasts.', 'Breath'],
  reboundHoldMs: ['Rebound hold', 'ms', 'How long the ward holds the last, hardest push before it springs back.', 'Rebound'],
  backBlast: ['Back-blast', '×', 'Size of the shockwave, flame and debris off the back of the ward.', 'Rebound'],
  shards: ['Shards', undefined, 'Tier IV: how many glass shards the ward shatters into.', 'Rebound'],
  explodeSize: ['Impact size', '×', 'Scale of the surge detonating on the target.', 'Impact'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact flash is.', 'Impact'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxWardGain: ['ward: gain', undefined, 'The shimmer of the ward going up.', 'Sound: ward'],
  sfxWardRate: ['ward: pitch', '×', 'Pitch of the ward.', 'Sound: ward'],
  sfxGrowlGain: ['growl: gain', undefined, 'The dragon growl in the crouch.', 'Sound: growl'],
  sfxGrowlRate: ['growl: pitch', '×', 'Pitch of the growl.', 'Sound: growl'],
  sfxBreathGain: ['breath: gain', undefined, 'The roar of the breath (held for the whole stream).', 'Sound: breath'],
  sfxBreathRate: ['breath: pitch', '×', 'Pitch of the breath.', 'Sound: breath'],
  sfxStageGain: ['stage: gain', undefined, 'Each stage shift (a step higher each).', 'Sound: stage'],
  sfxStageRate: ['stage: pitch', '×', 'Pitch of the first shift.', 'Sound: stage'],
  sfxHitGain: ['stage hit: gain', undefined, 'A stage front reaching the target (pitch climbs).', 'Sound: stage hit'],
  sfxHitRate: ['stage hit: pitch', '×', 'Pitch of the first stage hit.', 'Sound: stage hit'],
  sfxReboundGain: ['rebound: gain', undefined, 'The ward springing back and the back-blast.', 'Sound: rebound'],
  sfxReboundRate: ['rebound: pitch', '×', 'Pitch of the rebound.', 'Sound: rebound'],
  sfxShatterGain: ['shatter: gain', undefined, 'Tier IV: the ward shattering.', 'Sound: shatter'],
  sfxShatterRate: ['shatter: pitch', '×', 'Pitch of the shatter.', 'Sound: shatter'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the surge detonating on the target.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxThumpGain: ['thump: gain', undefined, 'A low punch under the impact.', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxBoomGain: ['aftershock: gain', undefined, 'Tier IV: the bursts after the impact.', 'Sound: aftershock'],
  sfxBoomRate: ['aftershock: pitch', '×', 'Pitch of the first aftershock.', 'Sound: aftershock'],
  sfxCrackleGain: ['crackle: gain', undefined, 'The synth fire crackle under the breath.', 'Sound: crackle'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact clip is cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact and rebound. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while Iggy Blast plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<IggyTierSuffix, [string, TunerUnit | undefined, string]> = {
  WindupMs: ['Wind-up', 'ms', 'The ward going up and the crouch before the breath. The view pushes in over this.'],
  Stages: ['Stages', undefined, 'How many stages the breath shifts through (1 thin blue, 2 adds cyan, 3 white-cored).'],
  StageMs: ['Stage time', 'ms', 'How long each stage pours before the next shift.'],
  ReachMs: ['Reach', 'ms', 'The stream crossing the board on the first stage (at 1600 px; scales gently with distance).'],
  Width: ['Width', '×', 'How thick the stream is (each stage widens it further).'],
  Recoil: ['Push back', 'px', 'How far the breath shoves the hero back by the top stage.'],
  Flatten: ['Ward flatten', '×', 'How hard the ward flattens against the push by the top stage.'],
  Shatter: ['Shatter', undefined, 'On the rebound the ward shatters into glass shards (the Tier IV look).'],
  SurgeMs: ['Surge', 'ms', 'The surge racing down the stream from the rebound to the impact.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the crouch and the push.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Burst: ['Burst size', '×', 'Scale of the impact.'],
  Embers: ['Embers', undefined, 'Embers thrown by the impact.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroIggyStrKey>> = {
  'Sound: ward': 'sfxWardClip', 'Sound: growl': 'sfxGrowlClip', 'Sound: breath': 'sfxBreathClip', 'Sound: stage': 'sfxStageClip',
  'Sound: stage hit': 'sfxHitClip', 'Sound: rebound': 'sfxReboundClip', 'Sound: shatter': 'sfxShatterClip',
  'Sound: impact': 'sfxImpactClip', 'Sound: thump': 'sfxThumpClip', 'Sound: aftershock': 'sfxBoomClip',
};

const COLORS: [HeroIggyStrKey, string, string][] = [
  ['colorPlayer', 'Your colour', 'The total and the damage number colour when YOU strike.'],
  ['colorFoe', 'Foe colour', 'The total and the damage number colour when THEY strike.'],
  ['colorCore', 'White-hot', 'The white-hot heart of the breath (the top stage) and the flashes.'],
  ['colorHot', 'Cyan', 'The hot cyan the breath runs at its middle stage.'],
  ['colorFlame', 'Blue', 'The body of the breath, its light and the rings.'],
  ['colorDeep', 'Deep blue', 'The blue the flames cool to at their tips.'],
  ['colorEmber', 'Ember', 'The night blue a dying flame ends on.'],
  ['colorSmoke', 'Smoke', 'The smoke the breath leaves, and the debris.'],
  ['colorWard', 'Ward', 'The ward round the hero, its rings and its shards.'],
];

type Ctl = TunerControl<Extract<keyof IggyTunerValues, string>>;

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
  const push = (key: HeroIggyNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_IGGY_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of IGGY_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroIggyNumKey;
      const [min, max, step] = HERO_IGGY_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Shatter'
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

let live: HeroIggyHandle | null = null;

/** Play the real Iggy Blast between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; knockout?: boolean; reduced?: boolean; frames?: HeroIggyOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroIggyHandle | null> {
  live?.cancel();
  const cfg = getHeroIggyConfig();
  return playAttackDemo(side, (o) => playHeroIggy(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    knockout: opts.knockout, speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroIggy?: unknown }).__heroIggy = { demo, previewParts };
}

export const SPEC: TunerSpec<IggyTunerValues> = {
  id: 'heroiggy',                    // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Iggy Blast',
  note: () => {
    const c = getHeroIggyConfig();
    const p = iggyPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    const what = `${p.stages.length} stage${p.stages.length === 1 ? '' : 's'}${p.shatter ? ' + shatter' : ''}`;
    return `dev · tier ${p.tier} · ${what} · breath ${Math.round(p.breathAt)} · rebound ${Math.round(p.reboundAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroIggyConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroIggyValue(key as keyof HeroIggyConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroIggyValue(key as keyof HeroIggyConfig, value); },
  reset: () => { resetHeroIggyConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_IGGY_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroIggyConfigJson(),
  copyLabel: 'Copy JSON',
  // Owner 2026-09-29 (every attack tuner): the Play row on TOP; no speed or reduced-motion buttons.
  buttonsOnTop: true,
  actions: [
    { label: '▶ You cast', hint: 'Your hero casts Iggy Blast at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe casts', hint: 'The foe casts Iggy Blast at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero casts for 3: Tier I, one thin blue stage, the rebound and the surge.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero casts for 8: Tier II, thin blue then cyan.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero casts for 12: Tier III, all three stages up to the white-cored torrent.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero casts for 40: Tier IV, three stages and the ward shatters on the rebound.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Knockout (3)', hint: 'A knockout blow of 3: plays the Tier IV version, whatever the number.', run: () => { void demo('player', { damage: 3, parts: 2, knockout: true }); } },
    { label: '▶ Foe small (3)', hint: 'The foe casts at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe casts at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe casts at your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe casts at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroIggyTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
