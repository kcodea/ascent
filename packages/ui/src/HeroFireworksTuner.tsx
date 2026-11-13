import {
  HERO_FIREWORKS_DEFAULTS, HERO_FIREWORKS_RANGES, FIREWORKS_LEVELS, FIREWORKS_LEVEL_NAMES, FIREWORKS_LEVEL_SUFFIXES, FIREWORKS_LEVEL_TIERS, FIREWORKS_VARIANT_NAMES,
  getHeroFireworksConfig, heroFireworksConfigJson, resetHeroFireworksConfig, setHeroFireworksValue, fireworksPlan, fireworksVariantOf,
  type HeroFireworksConfig, type HeroFireworksNumKey, type HeroFireworksStrKey, type FireworksLevel, type FireworksLevelSuffix,
} from './heroFireworks/heroFireworksConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroFireworks, type HeroFireworksHandle, type HeroFireworksOptions } from './heroFireworks/heroFireworks';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the GRAND FINALE hero attack (style `fireworks`, an Epic: three looks, Tier 1 to Tier 3). Every shell
 * leaves from a spark lit on the striking hero's rim. Tier 1: one shell bursts on the struck portrait. Tier 2: a ring,
 * a heart, then the variant's shell. Tier 3: the barrage, the held beat, the enormous shell and the final flash. The
 * Variation row forces the whimsy (the smiley, the pinwheel, the fake-out). The Play buttons run the REAL runner between
 * the two real hero portraits, in either direction. A preview never touches the run. Production plays the baked defaults.
 */
type FireworksTunerValues = HeroFireworksConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroFireworksNumKey, `v${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier 2 from', undefined, 'Damage at which shared tier 2 starts (this attack plays its Tier 2 from here). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Shared tier 3 from', undefined, "Shared tier 3 (still this attack's Tier 2: an Epic has three looks). Shared (12).", 'Damage tiers'],
  tier4At: ['Tier 3 from', undefined, "Damage at which shared tier 4 starts: this attack's Tier 3, the Grand Finale. Shared (20). A knockout always plays it.", 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroCoilPx: ['Lean away', 'px', 'How far the hero leans away from the spark lit on its rim.', 'Ready'],
  heroFlinchPx: ['Flinch', 'px', 'How hard the hero flinches as each shell leaves its spark.', 'Ready'],
  fuseArcDeg: ['Fuse arc', '°', "How far round the hero's rim the fuse of sparks crawls before the first shell.", 'Ready'],
  spinMs: ['Pinwheel spin', 'ms', 'The pinwheel spins on the rim this long before it flies (the pinwheel variant).', 'Whimsy'],
  dudMs: ['Dud', 'ms', "The dud's whole life: up, a sputter, a flop and a fizzle (the fake-out variant).", 'Whimsy'],
  dudPauseMs: ['After the dud', 'ms', 'The awkward pause after the dud before the real one goes.', 'Whimsy'],
  sputterMs: ['Sputter', 'ms', 'Tier 2 fake-out: the last shell hangs and sputters this long, then goes off all at once.', 'Whimsy'],
  volleyGapMs: ['Volley gap', 'ms', 'Tier 2: the gap between its three shells.', 'Tier 2'],
  waves: ['Waves', undefined, 'Tier 3: how many waves the barrage has.', 'Tier 3: the barrage'],
  waveShells: ['Shells per wave', undefined, 'Tier 3: shells in the first wave (each wave after has two more).', 'Tier 3: the barrage'],
  waveGapMs: ['Wave gap', 'ms', 'Tier 3: the time from one wave to the next.', 'Tier 3: the barrage'],
  waveSpanMs: ['Wave spread', 'ms', 'Tier 3: how long a wave takes to leave the ground.', 'Tier 3: the barrage'],
  riseMs: ['Comet rise', 'ms', "Tier 3: the enormous shell's comet rising off the top of the screen.", 'Tier 3: the enormous shell'],
  holdMs: ['HELD BEAT', 'ms', 'Tier 3: the hush between the comet leaving the screen and the enormous shell.', 'Tier 3: the enormous shell'],
  giantSize: ['Size', '×', "Tier 3: the enormous shell's radius, as a share of the screen's shorter side.", 'Tier 3: the enormous shell'],
  giantStars: ['Stars', undefined, "Tier 3: stars in the enormous shell's main burst (a ring, a willow and crackle are added in proportion).", 'Tier 3: the enormous shell'],
  rain: ['Glitter rain', undefined, 'Tier 3: crackling glitter specks that rain over the whole screen.', 'Tier 3: the enormous shell'],
  rainMs: ['Rain time', 'ms', 'Tier 3: how long the glitter keeps starting to fall.', 'Tier 3: the enormous shell'],
  skyFlash: ['Sky light', 'opacity', 'Tier 3: the light the enormous shell throws across the whole screen (0 = none).', 'Tier 3: the enormous shell'],
  finalMs: ['Final flash', 'ms', 'Tier 3: from the enormous shell to the final flash on the struck portrait.', 'Tier 3: the enormous shell'],
  aftermathMs: ['Aftermath', 'ms', 'Tier 3: how long the sky hangs and glitters after the enormous shell.', 'Tier 3: the enormous shell'],
  smoke: ['Smoke', '×', 'Smoke that hangs and drifts after every burst (0 = none).', 'Atmosphere'],
  singe: ['Singe', '×', 'Soot, sparkles and wisps on the struck portrait (0 = none).', 'Atmosphere'],
  rockDeg: ['Rock', '°', 'How far the blow rocks the struck portrait.', 'Camera and portraits'],
  flashAlpha: ['Flash', 'opacity', 'How bright the white flash of a burst is.', 'Camera and portraits'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxIgniteGain: ['ignite: gain', undefined, "The spark striking on the hero's rim.", 'Sound: ignite'],
  sfxIgniteRate: ['ignite: pitch', '×', 'Pitch of the strike.', 'Sound: ignite'],
  sfxFuseGain: ['fuse: gain', undefined, 'The fuse fizzing round the rim.', 'Sound: fuse'],
  sfxFuseRate: ['fuse: pitch', '×', 'Pitch of the fizz.', 'Sound: fuse'],
  sfxSquealGain: ['squeal: gain', undefined, "A shell whistling off the hero's spark.", 'Sound: squeal'],
  sfxSquealRate: ['squeal: pitch', '×', 'Pitch of the squeal.', 'Sound: squeal'],
  sfxThumpGain: ['thump: gain', undefined, "The enormous shell's comet leaving (and a soft kick under each squeal).", 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxPopGain: ['pop: gain', undefined, 'A burst: the ticks, the barrage, the blow.', 'Sound: pop'],
  sfxPopRate: ['pop: pitch', '×', 'Pitch of the bursts (higher = smaller).', 'Sound: pop'],
  sfxBoomGain: ['boom: gain', undefined, 'The enormous shell (and the body under every tick and blow).', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the big boom.', 'Sound: boom'],
  sfxWhistleGain: ['whistle: gain', undefined, 'The comet rising (and some barrage shells).', 'Sound: whistle'],
  sfxWhistleRate: ['whistle: pitch', '×', 'Pitch of the rising whistle.', 'Sound: whistle'],
  sfxCrackleGain: ['crackle: gain', undefined, 'The crackle after a burst and under the glitter rain.', 'Sound: crackle'],
  sfxCrackleRate: ['crackle: pitch', '×', 'Pitch of the crackle.', 'Sound: crackle'],
  sfxDudGain: ['dud: gain', undefined, 'The dud fizzling out, and the fake-out sputtering (higher).', 'Sound: dud'],
  sfxDudRate: ['dud: pitch', '×', 'Pitch of the fizzle.', 'Sound: dud'],
  sfxPinwheelGain: ['pinwheel: gain', undefined, 'The pinwheel whirring on the rim and in flight.', 'Sound: pinwheel'],
  sfxPinwheelRate: ['pinwheel: pitch', '×', 'Pitch of the whirr.', 'Sound: pinwheel'],
  sfxVolleyGain: ['volley: gain', undefined, 'Tier 3: the rolling barrage under every wave.', 'Sound: volley'],
  sfxVolleyRate: ['volley: pitch', '×', 'Pitch of the volley.', 'Sound: volley'],
  sfxOohGain: ['ooh: gain', undefined, 'Tier 3: the crowd drawing breath in the held beat.', 'Sound: ooh'],
  sfxOohRate: ['ooh: pitch', '×', 'Pitch of the ooh.', 'Sound: ooh'],
  sfxAahGain: ['aah: gain', undefined, 'Tier 3: the crowd going "aah" at the enormous shell.', 'Sound: aah'],
  sfxAahRate: ['aah: pitch', '×', 'Pitch of the aah.', 'Sound: aah'],
  sfxTailMix: ['burst tail', undefined, 'A short reverb tail on the bursts. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the fireworks play (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<FireworksLevelSuffix, [string, TunerUnit | undefined, string]> = {
  FuseMs: ['Fuse', 'ms', 'How long the fuse of sparks crawls round the rim before the first shell. The view pushes in over this.'],
  FlyMs: ['Flight', 'ms', 'How long a shell takes from the spark to where it bursts.'],
  Stars: ['Stars', '×', 'Star count of every burst (1 = as designed).'],
  Burst: ['Burst size', '×', 'Radius of every burst except the enormous shell.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the blow (ticks and launches kick it a little too).'],
  Zoom: ['Push in', '×', 'How far the view pushes in (Tier 3: as the comet rises, then held).'],
  Punch: ['Impact punch', '×', 'Extra push on the blow before the view settles.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims (Tier 3: through the barrage, the held beat and the enormous shell).'],
};

const CLIP_OF: Partial<Record<string, HeroFireworksStrKey>> = {
  'Sound: ignite': 'sfxIgniteClip', 'Sound: fuse': 'sfxFuseClip', 'Sound: squeal': 'sfxSquealClip', 'Sound: thump': 'sfxThumpClip',
  'Sound: pop': 'sfxPopClip', 'Sound: boom': 'sfxBoomClip', 'Sound: whistle': 'sfxWhistleClip', 'Sound: crackle': 'sfxCrackleClip',
  'Sound: dud': 'sfxDudClip', 'Sound: pinwheel': 'sfxPinwheelClip', 'Sound: volley': 'sfxVolleyClip', 'Sound: ooh': 'sfxOohClip', 'Sound: aah': 'sfxAahClip',
};

const COLORS: [HeroFireworksStrKey, string, string][] = [
  ['colorCore', 'Core', 'The white-hot middle of every spark, flash and twinkle.'],
  ['colorGold', 'Gold', "The spark and its fuse, the enormous shell's main burst, and a shell colour."],
  ['colorMagenta', 'Magenta', "The enormous shell's ring, the heart, and a shell colour."],
  ['colorCyan', 'Cyan', "The enormous shell's inner burst, the ring shell, and a shell colour."],
  ['colorGreen', 'Green', 'A shell colour.'],
  ['colorViolet', 'Violet', "A shell colour (and what the enormous shell's inner burst turns into)."],
  ['colorPlayer', 'Your side', 'The total colour when YOU strike.'],
  ['colorFoe', 'Foe side', 'The total colour when THEY strike.'],
];

type Ctl = TunerControl<Extract<keyof FireworksTunerValues, string>>;

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
  }, {
    // THE VARIATION override (DEV): Random (rolled per blow) or force one.
    key: 'variation', label: 'Variation', kind: 'select', options: ['', '1', '2', '3'], group: 'Style', min: 0, max: 0, step: 0,
    optionLabels: {
      '': 'Random (rolled per fight)',
      1: `1: ${FIREWORKS_VARIANT_NAMES[1]} (a smiley shell that winks and melts)`,
      2: `2: ${FIREWORKS_VARIANT_NAMES[2]} (a catherine wheel off the rim, spiral shells)`,
      3: `3: ${FIREWORKS_VARIANT_NAMES[3]} (a dud first, or a shell that sputters then goes all at once)`,
    },
    hint: 'Every tier has three variants. Random = what real fights do (the same fight always rolls the same).',
  }];
  const clips = clipOptions();
  const push = (key: HeroFireworksNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_FIREWORKS_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const v of FIREWORKS_LEVELS) {
    for (const s of FIREWORKS_LEVEL_SUFFIXES) {
      const [label, unit, hint] = LEVEL_SPECS[s];
      const key = `v${v}${s}` as HeroFireworksNumKey;
      const [min, max, step] = HERO_FIREWORKS_RANGES[key];
      out.push({ key, label, unit, hint: `${hint} (${FIREWORKS_LEVEL_NAMES[v as FireworksLevel]} plays on ${FIREWORKS_LEVEL_TIERS[v as FireworksLevel]}.)`, group: FIREWORKS_LEVEL_NAMES[v as FireworksLevel], min, max, step });
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

let live: HeroFireworksHandle | null = null;
/** A fresh roll per preview (a real fight rolls from the run seed and the round, so a replay rolls the same). */
let previewRoll = 0;

/** Play the real Grand Finale between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroFireworksOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroFireworksHandle | null> {
  live?.cancel();
  const cfg = getHeroFireworksConfig();
  return playAttackDemo(side, (o) => playHeroFireworks({ ...o, rollSeed: o.rollSeed ?? (previewRoll = (previewRoll + 1) % 3000) }), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroFireworks?: unknown }).__heroFireworks = { demo, previewParts, play: playHeroFireworks, set: setHeroFireworksValue };
}

const LOOK_OF: Record<FireworksLevel, string> = { 1: 'one shell', 2: 'a ring, a heart and a third', 3: 'the barrage, the held beat, the enormous shell' };

export const SPEC: TunerSpec<FireworksTunerValues> = {
  id: 'herofireworks',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Grand Finale (fireworks, Epic)',
  note: () => {
    const c = getHeroFireworksConfig();
    const p = fireworksPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    const v = c.variation ? FIREWORKS_VARIANT_NAMES[fireworksVariantOf(0, c)] : 'random variant';
    return `dev · ${FIREWORKS_LEVEL_NAMES[p.level]} (${LOOK_OF[p.level]}) · ${v} · ${p.shells.length} shells · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroFireworksConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroFireworksValue(key as keyof HeroFireworksConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroFireworksValue(key as keyof HeroFireworksConfig, value); },
  reset: () => { resetHeroFireworksConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_FIREWORKS_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroFireworksConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You strike', hint: 'Your hero sets off fireworks at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe strikes', hint: 'The foe sets off fireworks at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Tier 1 (3)', hint: 'Your hero strikes for 3: Tier 1 (shared tier 1), one shell.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier 2 (8)', hint: "Your hero strikes for 8: Tier 2 (shared tiers 2 and 3), a ring, a heart and the variant's shell.", run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Tier 2 (12)', hint: 'Your hero strikes for 12 from four numbers: still Tier 2 (an Epic has three looks).', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Tier 3 (40)', hint: 'Your hero strikes for 40 from seven numbers: Tier 3 (shared tier 4 and every knockout), the Grand Finale.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe Tier 1 (3)', hint: 'The foe strikes your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe Tier 2 (8)', hint: 'The foe strikes your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe Tier 3 (40)', hint: 'The foe strikes your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroFireworksTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
