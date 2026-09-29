import {
  FROST_TIER_SUFFIXES, HERO_FROST_DEFAULTS, HERO_FROST_RANGES, HERO_FROST_SPEEDS, TIERS, frostPlan, getHeroFrostConfig,
  heroFrostConfigJson, heroFrostPreviewSpeed, resetHeroFrostConfig, setHeroFrostPreviewSpeed, setHeroFrostValue,
  type FrostTierSuffix, type HeroFrostConfig, type HeroFrostNumKey, type HeroFrostStrKey, type TierNum,
} from './heroFrost/heroFrostConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroFrost, type HeroFrostHandle, type HeroFrostOptions } from './heroFrost/heroFrost';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the FROST hero attack (owner ask 2026-09-28: "branch off and create an ice/freeze blast one. icicles and
 * then a frost nova blast that blasts across the screen from the attacker to the target"). The Play buttons run the
 * REAL runner between the two real hero portraits (works from the shop), in either direction, at Small 3 / Tier II 8 /
 * Medium 12 / Huge 40, with reduced motion, at 1x / 0.5x / 0.25x. A preview never touches the run. The "Attack style"
 * row is the same dev override as the other attack tuners' (Auto = what a player would see). Production plays the
 * baked defaults.
 */
type FrostTunerValues = HeroFrostConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroFrostNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which Frost steps up to Tier II (two icicles). Shared with every hero attack (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which Frost becomes the volley of five. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which Frost adds the frost nova. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Crystallise'],
  heroSwell: ['Hero swell', '×', 'How much the hero swells as the cold gathers.', 'Crystallise'],
  recoilPx: ['Recoil', 'px', 'How far the hero kicks back as each icicle leaves.', 'Crystallise'],
  growMs: ['Grow time', 'ms', 'How long an icicle takes to crystallise from its butt out to its tip.', 'Crystallise'],
  formRadius: ['Form distance', '×', 'How far from the hero the icicles form, in portrait radii (round the rim, clear of the face).', 'Crystallise'],
  formSpread: ['Form spread', '°', 'How widely a volley fans round the hero as it forms (the angle it spans).', 'Crystallise'],
  icicleLength: ['Icicle length', 'px', 'Length of an icicle at size 1 (the tier size multiplies it).', 'Icicles'],
  icicleThick: ['Thickness', '×', 'How thick an icicle is for its length.', 'Icicles'],
  icicleGlow: ['Cold glow', '×', 'The cold aura round each icicle and its trail (0 = none).', 'Icicles'],
  icicleCore: ['Deep core', 'opacity', 'The glacier-blue heart inside each icicle.', 'Icicles'],
  pullMs: ['Draw back', 'ms', 'The small pull back just before an icicle fires.', 'Icicles'],
  pullBackPx: ['Draw back distance', 'px', 'How far it pulls back.', 'Icicles'],
  trailMs: ['Trail length', 'ms', 'How much of its flight the ice-dust trail spans.', 'Icicles'],
  trailWidth: ['Trail width', 'px', 'Width of the ice-dust trail.', 'Icicles'],
  dust: ['Ice dust', '×', 'How much glittering ice dust the icicles shed in flight.', 'Icicles'],
  shatterSize: ['Shatter size', '×', 'Scale of every icicle shatter (the flash, the snowflake, the shards).', 'Shatter and frost'],
  snowPuffs: ['Snow puffs', '×', 'How many snow puffs each shatter and the nova throw.', 'Shatter and frost'],
  creepMs: ['Frost creep', 'ms', 'How long the frost takes to creep over the struck portrait edge.', 'Shatter and frost'],
  creepFerns: ['Creep ferns', undefined, 'Frost ferns creeping in per full hit.', 'Shatter and frost'],
  creepReach: ['Creep reach', '×', 'How far the frost creeps in over the portrait (portrait radii).', 'Shatter and frost'],
  novaWindupMs: ['Nova gather', 'ms', 'Tier IV: the hero gathering the cold before the nova is released.', 'Frost nova (Tier IV)'],
  novaMs: ['Nova travel', 'ms', 'Tier IV: the wave crossing the board (at 1600 px; scales gently with distance).', 'Frost nova (Tier IV)'],
  novaWidth: ['Wave width', '×', 'Tier IV: how wide the wave front is, in portrait radii (it widens as it rolls).', 'Frost nova (Tier IV)'],
  novaDepth: ['Wave depth', '×', 'Tier IV: how deep the frost wall behind the leading edge is.', 'Frost nova (Tier IV)'],
  novaBulge: ['Wave bulge', '×', 'Tier IV: how far the middle of the front leads its ends (a rolling crescent).', 'Frost nova (Tier IV)'],
  snowDensity: ['Snow density', '×', 'Tier IV: snow and crystals swirling in the front and spiralling into the hero.', 'Frost nova (Tier IV)'],
  groundWidth: ['Ice sheet width', '×', 'Tier IV: how wide the frozen ground left behind the wave is.', 'Frost nova (Tier IV)'],
  groundFerns: ['Ground ferns', undefined, 'Tier IV: frost ferns growing off the frozen ground as the wave passes.', 'Frost nova (Tier IV)'],
  groundFadeMs: ['Ground thaw', 'ms', 'Tier IV: how long the frozen ground takes to thaw after the shatter.', 'Frost nova (Tier IV)'],
  encaseMs: ['Encase hold', 'ms', 'Tier IV: the ice holding the struck hero before it shatters (the ice holds; the clock never stops).', 'Encase and shatter'],
  encaseSize: ['Encase size', '×', 'Tier IV: the ice shell over the portrait.', 'Encase and shatter'],
  encaseShards: ['Shatter shards', undefined, 'Tier IV: shards thrown when the encasement shatters.', 'Encase and shatter'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact and shatter flashes are.', 'Encase and shatter'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxFormGain: ['forming: gain', undefined, 'The crystalline forming sound as the cold gathers.', 'Sound: forming'],
  sfxFormRate: ['forming: pitch', '×', 'Pitch of the forming sound.', 'Sound: forming'],
  sfxChimeGain: ['chime: gain', undefined, 'A bright chime as each icicle crystallises (each a little higher).', 'Sound: chime'],
  sfxChimeRate: ['chime: pitch', '×', 'Pitch of the first chime.', 'Sound: chime'],
  sfxSheenGain: ['shimmer: gain', undefined, 'A cold shimmer under the forming.', 'Sound: shimmer'],
  sfxSheenRate: ['shimmer: pitch', '×', 'Pitch of the shimmer.', 'Sound: shimmer'],
  sfxLaunchGain: ['launch: gain', undefined, 'The sharp ice-launch whoosh of each icicle (each a little higher).', 'Sound: launch'],
  sfxLaunchRate: ['launch: pitch', '×', 'Pitch of the first launch.', 'Sound: launch'],
  sfxDustGain: ['ice dust: gain', undefined, 'A sparkle riding the icicles in flight.', 'Sound: ice dust'],
  sfxDustRate: ['ice dust: pitch', '×', 'Pitch of the sparkle.', 'Sound: ice dust'],
  sfxHitGain: ['tick crack: gain', undefined, 'The glassy crack of each volley icicle shattering (pitch climbs).', 'Sound: tick crack'],
  sfxHitRate: ['tick crack: pitch', '×', 'Pitch of the first crack.', 'Sound: tick crack'],
  sfxShatterGain: ['shatter: gain', undefined, 'THE impact: the glassy shatter of the last icicle, or the encasement.', 'Sound: shatter'],
  sfxShatterRate: ['shatter: pitch', '×', 'Pitch of the shatter.', 'Sound: shatter'],
  sfxImpactGain: ['impact: gain', undefined, 'The hit layered under the shatter.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxThumpGain: ['thump: gain', undefined, 'A low punch under the impact (punchy, not boomy).', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxBigGain: ['big hit: gain', undefined, 'Tiers III and IV: an extra crack layered on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxReleaseGain: ['nova release: gain', undefined, 'Tier IV: the whoosh-hit as the nova is released.', 'Sound: nova release'],
  sfxReleaseRate: ['nova release: pitch', '×', 'Pitch of the release.', 'Sound: nova release'],
  sfxEncaseGain: ['encase: gain', undefined, 'Tier IV: the freezing crunch as the ice snaps shut over the hero.', 'Sound: encase'],
  sfxEncaseRate: ['encase: pitch', '×', 'Pitch of the encase.', 'Sound: encase'],
  sfxBurstGain: ['burst: gain', undefined, 'Tier IV: the big glassy burst as the encasement shatters (pitched up to crack, not boom).', 'Sound: burst'],
  sfxBurstRate: ['burst: pitch', '×', 'Pitch of the burst.', 'Sound: burst'],
  sfxBoomGain: ['aftershock: gain', undefined, 'Tier IV: the tinkling pops after the shatter.', 'Sound: aftershock'],
  sfxBoomRate: ['aftershock: pitch', '×', 'Pitch of the first aftershock.', 'Sound: aftershock'],
  sfxWindGain: ['howl: gain', undefined, 'Tier IV: the synth freezing wind rising to the release, trailing off as the wave rolls.', 'Sound: howl'],
  sfxWindLowHz: ['howl: from', undefined, 'Hz. Where the howl starts.', 'Sound: howl'],
  sfxWindHighHz: ['howl: to', undefined, 'Hz. Where it has risen to at the release.', 'Sound: howl'],
  sfxCrackleGain: ['crackle: gain', undefined, 'Tier IV: the synth crackle of freezing ground and the ice straining (loudest while encased).', 'Sound: crackle'],
  sfxLaunchLenMs: ['launch length', 'ms', 'Each launch whoosh is cut to this long (with a fade).', 'Sound: mix'],
  sfxImpactLenMs: ['impact length', 'ms', 'The shatter and burst clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while Frost plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<FrostTierSuffix, [string, TunerUnit | undefined, string]> = {
  FormMs: ['Form', 'ms', 'The icicles crystallising before the first one fires. The view pushes in over this.'],
  Icicles: ['Icicles', undefined, 'How many icicles form and fire (I one, II two, III the volley of five, IV four before the nova).'],
  LaunchStaggerMs: ['Launch stagger', 'ms', 'Gap between each icicle firing (the volley rhythm).'],
  FlightMs: ['Flight', 'ms', 'An icicle crossing the board (at 1600 px; scales gently with distance).'],
  IcicleSize: ['Icicle size', '×', 'Size of the icicles (the last of a volley is a little bigger).'],
  Arc: ['Arc', '×', 'How far each flight bows off the straight line.'],
  Nova: ['Frost nova', undefined, 'After the icicles, the frost nova blasts across the screen, encases the target and shatters (the blow lands on the shatter).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in while the ice forms (and the nova gathers).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Shards: ['Shards', undefined, 'Shards thrown by the impact shatter.'],
  Burst: ['Burst size', '×', 'Scale of the impact flash and bloom.'],
  Creep: ['Frost creep', '×', 'How much frost creeps over the struck portrait edge.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroFrostStrKey>> = {
  'Sound: forming': 'sfxFormClip', 'Sound: chime': 'sfxChimeClip', 'Sound: shimmer': 'sfxSheenClip', 'Sound: launch': 'sfxLaunchClip',
  'Sound: ice dust': 'sfxDustClip', 'Sound: tick crack': 'sfxHitClip', 'Sound: shatter': 'sfxShatterClip', 'Sound: impact': 'sfxImpactClip',
  'Sound: thump': 'sfxThumpClip', 'Sound: big hit': 'sfxBigClip', 'Sound: nova release': 'sfxReleaseClip', 'Sound: encase': 'sfxEncaseClip',
  'Sound: burst': 'sfxBurstClip', 'Sound: aftershock': 'sfxBoomClip',
};

const COLORS: [HeroFrostStrKey, string, string][] = [
  ['colorPlayer', 'Your frost', 'The cold glow, trails and total colour when YOU strike.'],
  ['colorFoe', 'Foe frost', 'The cold glow, trails and total colour when THEY strike.'],
  ['colorIce', 'Ice', 'The pale body of the icicles, the shards, the frost and the nova.'],
  ['colorDeep', 'Glacier core', 'The deep blue heart inside each icicle.'],
  ['colorCore', 'Glint', 'The white-hot specular edges and flashes.'],
  ['colorShade', 'Shadow', 'The cold violet in the shadows.'],
];

type Ctl = TunerControl<Extract<keyof FrostTunerValues, string>>;

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
  const push = (key: HeroFrostNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_FROST_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of FROST_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroFrostNumKey;
      const [min, max, step] = HERO_FROST_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Nova'
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

let live: HeroFrostHandle | null = null;

/** Play the real Frost between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroFrostOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroFrostHandle | null> {
  live?.cancel();
  const cfg = getHeroFrostConfig();
  return playAttackDemo(side, (o) => playHeroFrost(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: heroFrostPreviewSpeed(), reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroFrost?: unknown }).__heroFrost = { demo, previewParts, setSpeed: setHeroFrostPreviewSpeed };
}

export const SPEC: TunerSpec<FrostTunerValues> = {
  id: 'herofrost',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Frost',
  note: () => {
    const c = getHeroFrostConfig();
    const p = frostPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    const what = `${p.icicles.length} icicle${p.icicles.length === 1 ? '' : 's'}${p.nova ? ' + nova' : ''}`;
    return `dev · ${heroFrostPreviewSpeed()}x · tier ${p.tier} · ${what} · fire ${Math.round(p.fireAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroFrostConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroFrostValue(key as keyof HeroFrostConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroFrostValue(key as keyof HeroFrostConfig, value); },
  reset: () => { resetHeroFrostConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_FROST_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroFrostConfigJson(),
  copyLabel: 'Copy JSON',
  actions: [
    { label: '▶ You cast', hint: 'Your hero casts Frost at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe casts', hint: 'The foe casts Frost at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero casts for 3: Tier I, one icicle.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero casts for 8: Tier II, two icicles.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero casts for 12 from four numbers: Tier III, the volley of five.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero casts for 40 from seven numbers: Tier IV, icicles then the frost nova.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe casts at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe casts at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe casts at your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe casts at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
    { label: '▶ Reduced motion', hint: 'What a player with reduced motion on sees: fades, no icicles, nova, shake or zoom.', run: () => { void demo('player', { reduced: true }); } },
    ...HERO_FROST_SPEEDS.map((s) => ({
      label: `Speed ${s}x`,
      hint: 'Slow motion for the next plays (the tuner only; never saved, never in production).',
      run: () => { setHeroFrostPreviewSpeed(s); },
    })),
  ],
};

export function HeroFrostTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
