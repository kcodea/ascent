import {
  BLEED_TIER_SUFFIXES, HERO_BLEED_DEFAULTS, HERO_BLEED_RANGES, TIERS, bleedPlan, getHeroBleedConfig,
  heroBleedConfigJson, heroBleedPreviewSpeed, resetHeroBleedConfig, setHeroBleedPreviewSpeed, setHeroBleedValue,
  type BleedTierSuffix, type HeroBleedConfig, type HeroBleedNumKey, type HeroBleedStrKey, type TierNum,
} from './heroBleed/heroBleedConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroBleed, type HeroBleedHandle, type HeroBleedOptions } from './heroBleed/heroBleed';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the BLEED hero attack (the Hemorrhage cosmetic; owner ask 2026-09-29: "make some more attack types ...
 * a bleed/gash animation ... use the same 4 tier strategy"). The Play buttons run the REAL runner between the two real
 * hero portraits (works from the shop), in either direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40 (the button
 * row sits at the TOP of the panel; owner 2026-09-29). A preview never touches the run. The "Attack style" row is the same dev
 * override as the other attack tuners' (Auto = what a player would see). Production plays the baked defaults.
 */
type BleedTunerValues = HeroBleedConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroBleedNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which the cuts step up to Tier II (the cross). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which the cuts become the flurry and the claw rake. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which the cuts become the Hemorrhage (heartbeat, eight zips, bloody explosion). Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroCoilPx: ['Draw back', 'px', 'How far the hero draws back from the target as the blade is raised.', 'Ready'],
  heroSwingPx: ['Swing lunge', 'px', 'How far the hero snaps toward the target on each swing.', 'Ready'],
  heroSwingDeg: ['Swing turn', '°', 'How far the hero turns with the draw and each swing.', 'Ready'],
  waveSize: ['Crescent size', '×', 'The flying crescent (the cut in flight).', 'Crescent'],
  waveGlow: ['Crescent glow', 'opacity', 'The crimson bloom round each crescent (0 = none).', 'Crescent'],
  afterimages: ['Afterimages', undefined, 'Ghost copies trailing each crescent along its path (0 = none).', 'Crescent'],
  afterMs: ['Afterimage gap', 'ms', 'How far back along the flight each afterimage sits.', 'Crescent'],
  waveLift: ['Rise', '×', 'How much the crescent rises on its way (a fraction of the distance).', 'Crescent'],
  drawMs: ['Cut draw', 'ms', 'How long a cut takes to draw across the face.', 'Cut'],
  seamWidth: ['Seam width', 'px', 'The white-hot line a cut draws.', 'Cut'],
  gashWidth: ['Wound width', 'px', 'How wide the wound opens.', 'Cut'],
  clawGap: ['Claw gap', '×', 'The gap between a claw rake\'s lines (portrait radii).', 'Cut'],
  spray: ['Blade spray', undefined, 'Droplets thrown off the tip along the blade as a cut draws.', 'Cut'],
  tickDrops: ['Tick droplets', undefined, 'Droplets flung off the end of each cut before the last.', 'Cut'],
  tintAlpha: ['Tint strength', 'opacity', 'The crimson pulse over the struck portrait.', 'Cut'],
  bleedMs: ['Bleed', 'ms', 'Tiers I to III: when the wounds start to drip after the impact.', 'Cut'],
  holdMs: ['Wound hold', 'ms', 'Tiers I to III: how long the wounds stay open after the impact before closing.', 'Cut'],
  dripMs: ['Drip run', 'ms', 'How long a drip takes to run down the portrait.', 'Cut'],
  beats: ['Heartbeats', undefined, 'Tier IV: how many times the wounds throb before the mega-slash.', 'Hemorrhage (Tier IV)'],
  beatMs: ['Beat gap', 'ms', 'Tier IV: the time between heartbeats.', 'Hemorrhage (Tier IV)'],
  windupMs: ['Wind-up', 'ms', 'Tier IV: the hero winding the huge crescent (at least this long before the sweep).', 'Hemorrhage (Tier IV)'],
  megaMs: ['First zip sweep', 'ms', 'Tier IV: the first zip of the mega-slash crossing the screen (each crosses the target half-way); the rest get faster.', 'Hemorrhage (Tier IV)'],
  megaWidth: ['Sweep width', 'px', 'Tier IV: the mega-slash seam.', 'Hemorrhage (Tier IV)'],
  megaSize: ['Sweep crescent', '×', 'Tier IV: the size of the huge crescent.', 'Hemorrhage (Tier IV)'],
  zips: ['Zips', undefined, 'Tier IV: how many times the mega-slash zips across the screen (owner: 8).', 'Hemorrhage (Tier IV)'],
  zipGapMs: ['First zip gap', 'ms', 'Tier IV: the time from the first zip to the second; later gaps shrink by the acceleration.', 'Hemorrhage (Tier IV)'],
  zipAccel: ['Zip acceleration', '×', 'Tier IV: each zip sweep and gap is this times the one before (lower = a faster frenzy).', 'Hemorrhage (Tier IV)'],
  zipMinMs: ['Fastest zip', 'ms', 'Tier IV: the floor for a zip sweep and gap once they have sped up.', 'Hemorrhage (Tier IV)'],
  tensionMs: ['Held tension', 'ms', 'Tier IV: the beat after the last zip (the wounds pulse, blood drawn in) before the explosion. Never a freeze.', 'Hemorrhage (Tier IV)'],
  explosionSize: ['Explosion size', '×', 'Tier IV: the bloody explosion (flash, shockwaves, blood thrown high, spatter).', 'Hemorrhage (Tier IV)'],
  novaSize: ['Nova size', '×', 'Tier IV: the blood nova\'s shockwave.', 'Hemorrhage (Tier IV)'],
  stainAlpha: ['Stain', 'opacity', 'Tier IV: the stain left over the face.', 'Hemorrhage (Tier IV)'],
  stainMs: ['Stain time', 'ms', 'Tier IV: how long the stain and the ripped wounds hold before fading.', 'Hemorrhage (Tier IV)'],
  spatter: ['Spatter', undefined, 'Tier IV: spatter landing on the board round the portrait.', 'Hemorrhage (Tier IV)'],
  dropGravity: ['Droplet gravity', undefined, 'px/s². How hard the blood droplets fall.', 'Hemorrhage (Tier IV)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact and explosion flashes are.', 'Hemorrhage (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxReadyGain: ['ready: gain', undefined, 'The blade drawn as the hero readies.', 'Sound: ready'],
  sfxReadyRate: ['ready: pitch', '×', 'Pitch of the ready.', 'Sound: ready'],
  sfxSwingGain: ['swing: gain', undefined, 'The swish of each swing (each a little higher).', 'Sound: swing'],
  sfxSwingRate: ['swing: pitch', '×', 'Pitch of the first swish.', 'Sound: swing'],
  sfxShingGain: ['shing: gain', undefined, 'The snap of the blade layered on each swing (and the mega-slash).', 'Sound: shing'],
  sfxShingRate: ['shing: pitch', '×', 'Pitch of the snap.', 'Sound: shing'],
  sfxSliceGain: ['slice: gain', undefined, 'The cut landing (every cut).', 'Sound: slice'],
  sfxSliceRate: ['slice: pitch', '×', 'Pitch of the first slice (climbs per tick).', 'Sound: slice'],
  sfxFleshGain: ['flesh: gain', undefined, 'A low punch under each cut.', 'Sound: flesh'],
  sfxFleshRate: ['flesh: pitch', '×', 'Pitch of the punch.', 'Sound: flesh'],
  sfxSplatGain: ['splat: gain', undefined, 'The wet splat of blood on each cut (and the bleed).', 'Sound: splat'],
  sfxSplatRate: ['splat: pitch', '×', 'Pitch of the splat.', 'Sound: splat'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the last cut, or layered on the explosion.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxBigGain: ['big hit: gain', undefined, 'Tiers III and IV: an extra crack on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxBeatGain: ['heartbeat: gain', undefined, 'Tier IV: each heartbeat (a low lub, then a dub).', 'Sound: heartbeat'],
  sfxBeatRate: ['heartbeat: pitch', '×', 'Pitch of the heartbeat.', 'Sound: heartbeat'],
  sfxWindGain: ['wind-up: gain', undefined, 'Tier IV: the hero winding the huge crescent.', 'Sound: wind-up'],
  sfxWindRate: ['wind-up: pitch', '×', 'Pitch of the wind-up.', 'Sound: wind-up'],
  sfxMegaGain: ['mega-slash: gain', undefined, 'Tier IV: the first zip across the screen (the rest use the swing and shing, climbing).', 'Sound: mega-slash'],
  sfxMegaRate: ['mega-slash: pitch', '×', 'Pitch of the sweep.', 'Sound: mega-slash'],
  sfxGushGain: ['gush: gain', undefined, 'Tier IV: the big wet gush of the explosion.', 'Sound: gush'],
  sfxGushRate: ['gush: pitch', '×', 'Pitch of the gush (lower = heavier).', 'Sound: gush'],
  sfxSpurtGain: ['spurt: gain', undefined, 'Tier IV: the arterial spurts after the explosion.', 'Sound: spurt'],
  sfxSpurtRate: ['spurt: pitch', '×', 'Pitch of the first spurt.', 'Sound: spurt'],
  sfxBlastGain: ['explosion: gain', undefined, 'Tier IV: the bloody explosion itself.', 'Sound: explosion'],
  sfxBlastRate: ['explosion: pitch', '×', 'Pitch of the explosion (lower = bigger).', 'Sound: explosion'],
  sfxSwingLenMs: ['swing length', 'ms', 'Each swing swish is cut to this long (with a fade).', 'Sound: mix'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact and gush clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact and the sweep. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<BleedTierSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Ready', 'ms', 'The hero drawing the blade before the first swing. The view pushes in over this.'],
  Slashes: ['Slashes', undefined, 'How many cuts (I one, II the cross, III the flurry ending in a rake, IV three rakes before the Hemorrhage).'],
  StaggerMs: ['Swing stagger', 'ms', 'Gap between each swing (the rhythm of the cuts).'],
  FlightMs: ['Crescent speed', 'ms', 'A crescent crossing the board (at 1600 px; lower = faster; scales gently with distance).'],
  SlashLength: ['Cut length', '×', 'How long each cut runs across the face (portrait radii).'],
  Claws: ['Claws', undefined, 'Lines in a rake: the last cut below IV, every cut at IV (1 = a clean slash).'],
  Hemorrhage: ['Hemorrhage', undefined, 'The heartbeat, the mega-slash zipping across the screen again and again, and the bloody explosion, instead of a plain last cut.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready (and the heartbeat).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Drops: ['Droplets', undefined, 'Blood droplets thrown by the impact (or the explosion).'],
  Burst: ['Splash size', '×', 'Scale of the impact splash, flash and bloom.'],
  Drips: ['Drips', undefined, 'Drips that run down the portrait after the blow.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroBleedStrKey>> = {
  'Sound: ready': 'sfxReadyClip', 'Sound: swing': 'sfxSwingClip', 'Sound: shing': 'sfxShingClip', 'Sound: slice': 'sfxSliceClip',
  'Sound: flesh': 'sfxFleshClip', 'Sound: splat': 'sfxSplatClip', 'Sound: impact': 'sfxImpactClip', 'Sound: big hit': 'sfxBigClip',
  'Sound: heartbeat': 'sfxBeatClip', 'Sound: wind-up': 'sfxWindClip', 'Sound: mega-slash': 'sfxMegaClip', 'Sound: gush': 'sfxGushClip',
  'Sound: spurt': 'sfxSpurtClip', 'Sound: explosion': 'sfxBlastClip',
};

const COLORS: [HeroBleedStrKey, string, string][] = [
  ['colorBright', 'Crimson glow', 'The bright crimson: crescent glows, seam blooms, rings and the rim pulse.'],
  ['colorBlood', 'Blood', 'The blood red: droplets, splats, drips and the wound lips.'],
  ['colorDeep', 'Deep', 'The near-black red: the gashes, the stain and the dark shockwave.'],
  ['colorCore', 'Core', 'The white-hot core of seams, crescents and flashes.'],
  ['colorPlayer', 'Your side', 'Your crescent tint and total colour when YOU strike.'],
  ['colorFoe', 'Foe side', 'Their crescent tint and total colour when THEY strike.'],
];

type Ctl = TunerControl<Extract<keyof BleedTunerValues, string>>;

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
  const push = (key: HeroBleedNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_BLEED_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of BLEED_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroBleedNumKey;
      const [min, max, step] = HERO_BLEED_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Hemorrhage'
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

let live: HeroBleedHandle | null = null;

/** Play the real Bleed attack between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroBleedOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroBleedHandle | null> {
  live?.cancel();
  const cfg = getHeroBleedConfig();
  return playAttackDemo(side, (o) => playHeroBleed(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: heroBleedPreviewSpeed(), reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBleed?: unknown }).__heroBleed = { demo, previewParts, setSpeed: setHeroBleedPreviewSpeed };
}

export const SPEC: TunerSpec<BleedTunerValues> = {
  id: 'herobleed',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Bleed',
  note: () => {
    const c = getHeroBleedConfig();
    const p = bleedPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${heroBleedPreviewSpeed()}x · tier ${p.tier} · ${p.hemorrhage ? `${p.slashes.length} rakes, hemorrhage` : `${p.slashes.length} cut${p.slashes.length === 1 ? '' : 's'}`} · swing ${Math.round(p.swingAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroBleedConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroBleedValue(key as keyof HeroBleedConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroBleedValue(key as keyof HeroBleedConfig, value); },
  reset: () => { resetHeroBleedConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_BLEED_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroBleedConfigJson(),
  copyLabel: 'Copy JSON',
  // Owner 2026-09-29 (every hero attack tuner): the buttons at the top; no speed or reduced-motion buttons.
  buttonsOnTop: true,
  actions: [
    { label: '▶ You strike', hint: 'Your hero cuts the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe strikes', hint: 'The foe cuts your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero strikes for 3: Tier I, one clean diagonal gash.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero strikes for 8: Tier II, a cross of two gashes.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero strikes for 12 from four numbers: Tier III, the flurry and the claw rake.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero strikes for 40 from seven numbers: Tier IV, the Hemorrhage (eight zips and a bloody explosion).', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe strikes your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe strikes your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe strikes your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe strikes your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroBleedTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
