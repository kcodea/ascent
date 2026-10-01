import {
  FEL_TIER_SUFFIXES, HERO_FEL_DEFAULTS, HERO_FEL_RANGES, TIERS, felPlan, getHeroFelConfig,
  heroFelConfigJson, resetHeroFelConfig, setHeroFelValue,
  type FelTierSuffix, type HeroFelConfig, type HeroFelNumKey, type HeroFelStrKey, type TierNum,
} from './heroFel/heroFelConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroFel, type HeroFelHandle, type HeroFelOptions } from './heroFel/heroFel';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the EYE OF THE LEGION hero attack (style `fel`; owner ask 2026-09-30: "a brand new attack animation
 * that is on par with hearthstone/modern world of warcraft", then "extremely unique"; the owner picked the eye). The
 * Play buttons run the REAL runner between the two real hero portraits (works from the shop), in either direction, at
 * Small 3 / Tier II 8 / Medium 12 / Huge 40; the Play row sits at the TOP of the panel and there are no speed or
 * reduced-motion buttons (owner 2026-09-29, every attack tuner). A preview never touches the run. Production plays the
 * baked defaults.
 */
type FelTunerValues = HeroFelConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroFelNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which two eyes open. Shared with every hero attack (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which more eyes join the pair (the barrage). Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which the cascade of eyes ends in the massive fel explosion. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'The eye'],
  riftMs: ['Rift tear', 'ms', 'The rift tearing open before the lids crack.', 'The eye'],
  closeMs: ['Blink shut', 'ms', 'The lids closing after the gaze.', 'The eye'],
  sealMs: ['Rift seal', 'ms', 'The rift sealing (shedding embers) after the eye closes.', 'The eye'],
  squint: ['Glare squint', '×', 'How far the lids narrow into a glare once it locks on.', 'The eye'],
  slit: ['Pupil slit', '×', 'How thin the pupil slams once it finds the target.', 'The eye'],
  dilate: ['Pupil open', '×', 'How wide the pupil is while it hunts.', 'The eye'],
  lookReach: ['Look reach', '×', 'How far the iris travels toward what it looks at.', 'The eye'],
  pairGapMs: ['Second eye lag', 'ms', 'Tier II: how far behind the first the second eye opens and fires.', 'The eye'],
  veins: ['Veins', 'opacity', 'The blood veins on the eye.', 'The eye'],
  heroSwell: ['Hero swell', '×', 'How much the attacker swells while it calls the eye.', 'The eye'],
  beamWidth: ['Gaze width', '×', 'How thick the gaze beam is.', 'The gaze'],
  beamGlow: ['Gaze glow', '×', 'The fel glow round the gaze beam.', 'The gaze'],
  sparks: ['Sparks', '×', 'Sparks spraying where the gaze burns.', 'The gaze'],
  embers: ['Embers', '×', 'Embers off the impacts and the sealing rift.', 'The gaze'],
  burstSize: ['Impact size', '×', 'Scale of the gaze impacts and the explosion.', 'The gaze'],
  shards: ['Shards', '×', 'Shards thrown off the impacts.', 'The gaze'],
  fireball: ['Fireball', '×', 'Tier IV: the explosion’s towering fireball and its dome of fel fire.', 'The gaze'],
  drawIn: ['Draw in', '×', 'III / IV: how many motes stream into the target while the barrage builds.', 'The gaze'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact flashes are.', 'The gaze'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxRiftGain: ['rift: gain', undefined, 'The rift tearing open.', 'Sound: rift'],
  sfxRiftRate: ['rift: pitch', '×', 'Pitch of the rift.', 'Sound: rift'],
  sfxOpenGain: ['eye opens: gain', undefined, 'The lids opening (a low growl; heavier at Tier IV).', 'Sound: eye opens'],
  sfxOpenRate: ['eye opens: pitch', '×', 'Pitch of the opening.', 'Sound: eye opens'],
  sfxDartGain: ['dart: gain', undefined, 'A tick on each glance of the pupil.', 'Sound: dart'],
  sfxDartRate: ['dart: pitch', '×', 'Pitch of the first glance.', 'Sound: dart'],
  sfxLockGain: ['lock: gain', undefined, 'The pupil finding the target.', 'Sound: lock'],
  sfxLockRate: ['lock: pitch', '×', 'Pitch of the lock.', 'Sound: lock'],
  sfxGazeGain: ['gaze: gain', undefined, 'The gaze leaving the eye.', 'Sound: gaze'],
  sfxGazeRate: ['gaze: pitch', '×', 'Pitch of the gaze.', 'Sound: gaze'],
  sfxHitGain: ['tick: gain', undefined, 'A gaze landing before the blow (pitch climbs with every eye).', 'Sound: tick'],
  sfxHitRate: ['tick: pitch', '×', 'Pitch of the tick.', 'Sound: tick'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxBlastGain: ['blast: gain', undefined, 'The burst under the impact.', 'Sound: blast'],
  sfxBlastRate: ['blast: pitch', '×', 'Pitch of the blast.', 'Sound: blast'],
  sfxImplodeGain: ['implode: gain', undefined, 'III / IV: the riser while the barrage builds (it climaxes on the explosion).', 'Sound: implode'],
  sfxImplodeRate: ['implode: pitch', '×', 'Pitch of the implosion.', 'Sound: implode'],
  sfxBurstGain: ['explosion: gain', undefined, 'Tier IV: the boom of the explosion.', 'Sound: explosion'],
  sfxBurstRate: ['explosion: pitch', '×', 'Pitch of the explosion.', 'Sound: explosion'],
  sfxCloseGain: ['blink: gain', undefined, 'The lids snapping shut.', 'Sound: blink'],
  sfxCloseRate: ['blink: pitch', '×', 'Pitch of the blink.', 'Sound: blink'],
  sfxHumGain: ['hum: gain', undefined, 'A synth hum rising from the rift to the gaze.', 'Sound: hum'],
  sfxHumLowHz: ['hum: low', undefined, 'Hz. Where the hum starts.', 'Sound: hum'],
  sfxHumHighHz: ['hum: high', undefined, 'Hz. Where the hum ends.', 'Sound: hum'],
  sfxRumbleGain: ['rumble: gain', undefined, 'III / IV: the rumble from the first lock to the blow.', 'Sound: rumble'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the eye plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<FelTierSuffix, [string, TunerUnit | undefined, string]> = {
  EyeSize: ['Eye size', '×', 'The eye’s half-width in portrait radii (Tier IV: a share of the screen width).'],
  OpenMs: ['Open', 'ms', 'The lids cracking, then snapping open.'],
  SeekMs: ['Seek', 'ms', 'The pupil darting about before it finds the target.'],
  ChargeMs: ['Glare', 'ms', 'Locked on (pupil slit, lids narrowed) before the gaze fires.'],
  GazeMs: ['Gaze travel', 'ms', 'The gaze crossing the board (at 1600 px; scales gently with distance).'],
  Eyes: ['Eyes', undefined, 'How many eyes open (I one, II the pair, III the pair and two more, IV the pair and a cascade of a dozen).'],
  CascadeMs: ['Cascade gap', 'ms', 'III / IV: the gap before the next eye of the cascade tears open.'],
  Accel: ['Cascade speed-up', '×', 'III / IV: each gap is this times the last (below 1 = faster and faster).'],
  BuildMs: ['Build', 'ms', 'III / IV: every gaze burning on the target before the blow.'],
  HoldMs: ['Hold', 'ms', 'How long the beam holds on the target after the blow.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in on the eye as it opens.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Burst: ['Burst size', '×', 'Scale of the impact (Tier IV: the explosion).'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims (the fel shadow).'],
  Veil: ['Veil', 'opacity', 'The fel-negative veil over the screen (Tier IV).'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroFelStrKey>> = {
  'Sound: rift': 'sfxRiftClip', 'Sound: eye opens': 'sfxOpenClip', 'Sound: dart': 'sfxDartClip', 'Sound: lock': 'sfxLockClip',
  'Sound: gaze': 'sfxGazeClip', 'Sound: tick': 'sfxHitClip', 'Sound: impact': 'sfxImpactClip', 'Sound: blast': 'sfxBlastClip',
  'Sound: implode': 'sfxImplodeClip', 'Sound: explosion': 'sfxBurstClip', 'Sound: blink': 'sfxCloseClip',
};

const COLORS: [HeroFelStrKey, string, string][] = [
  ['colorPlayer', 'Your numbers', 'The total and the damage number colour when YOU strike.'],
  ['colorFoe', 'Foe numbers', 'The total and the damage number colour when THEY strike.'],
  ['colorSclera', 'Sclera', 'The white of the eye.'],
  ['colorVein', 'Veins', 'The blood veins on the eye.'],
  ['colorIris', 'Iris', 'The iris.'],
  ['colorFel', 'Fel', 'The fel glow: the rift rim, the lids’ inner glow, the iris ring, the gaze.'],
  ['colorHot', 'Hot', 'The hot yellow-green of flashes, sparks and crackles.'],
  ['colorCore', 'White-hot', 'The gaze’s core and the flashes.'],
  ['colorPupil', 'Pupil', 'The slit pupil.'],
  ['colorLid', 'Lids', 'The dark lids round the eye.'],
  ['colorRift', 'Rift', 'The dark inside of the tear.'],
  ['colorVeil', 'Veil', 'Tier IV: the fel-negative veil.'],
];

type Ctl = TunerControl<Extract<keyof FelTunerValues, string>>;

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
  const push = (key: HeroFelNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_FEL_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of FEL_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroFelNumKey;
      const [min, max, step] = HERO_FEL_RANGES[key];
      out.push({ key, label, unit, hint, group: TIER_NAMES[t], min, max, step });
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

let live: HeroFelHandle | null = null;

/** Play the real Eye of the Legion between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroFelOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroFelHandle | null> {
  live?.cancel();
  const cfg = getHeroFelConfig();
  return playAttackDemo(side, (o) => playHeroFel(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroFel?: unknown }).__heroFel = { demo, previewParts };
}

export const SPEC: TunerSpec<FelTunerValues> = {
  id: 'herofel',                     // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Eye of the Legion',
  note: () => {
    const c = getHeroFelConfig();
    const p = felPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.eyes.length} eye${p.eyes.length === 1 ? '' : 's'}, ${p.finale} · gaze ${Math.round(p.fireAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroFelConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroFelValue(key as keyof HeroFelConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroFelValue(key as keyof HeroFelConfig, value); },
  reset: () => { resetHeroFelConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_FEL_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroFelConfigJson(),
  copyLabel: 'Copy JSON',
  // Owner 2026-09-29 (every attack tuner): the Play row on TOP; no speed or reduced-motion buttons.
  buttonsOnTop: true,
  actions: [
    { label: '▶ You cast', hint: 'Your hero opens the Eye at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe casts', hint: 'The foe opens the Eye at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Tier I: a small eye opens over your hero, darts, glares and lances a gaze pulse.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Tier II: two eyes out of sync; their gazes cross on the target.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Tier III: the pair opens and fires, two more eyes join, the beams burn together and land a solid fel impact.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Tier IV: the pair fires, then more and more eyes tear open round the screen and blast the target, until a massive fel explosion.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe casts at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe casts at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe casts at your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe casts at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroFelTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
