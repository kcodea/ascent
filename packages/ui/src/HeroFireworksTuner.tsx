import {
  HERO_FIREWORKS_DEFAULTS, HERO_FIREWORKS_RANGES, FIREWORKS_LEVELS, FIREWORKS_LEVEL_NAMES, FIREWORKS_LEVEL_SUFFIXES, getHeroFireworksConfig, heroFireworksConfigJson,
  resetHeroFireworksConfig, setHeroFireworksValue, fireworksPlan,
  type HeroFireworksConfig, type HeroFireworksNumKey, type HeroFireworksStrKey, type FireworksLevel, type FireworksLevelSuffix,
} from './heroFireworks/heroFireworksConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroFireworks, type HeroFireworksHandle, type HeroFireworksOptions } from './heroFireworks/heroFireworks';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the GRAND FINALE hero attack (style `fireworks`, an Epic: three looks). The bottle rocket (a fuse, a
 * squeal, a wiggly flight, one small star burst), the roman candle (thump, thump, thump: three balls, three pops) and the
 * mortar shell (a thump, a comet off the top of the screen, a held beat of quiet, then the chrysanthemum). The Play
 * buttons run the REAL runner between the two real hero portraits, in either direction. A preview never touches the run.
 * Production plays the baked defaults.
 */
type FireworksTunerValues = HeroFireworksConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroFireworksNumKey, `v${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Candle from', undefined, 'Damage at which the shared Tier II starts (the roman candle plays from here). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'The shared Tier III (still the roman candle for an Epic). Shared (12).', 'Damage tiers'],
  tier4At: ['Mortar from', undefined, 'Damage at which the shared Tier IV starts: the mortar shell. Shared (20). A knockout always plays it.', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  plantMs: ['Plant', 'ms', 'The firework popping up beside the hero before its fuse is lit.', 'Ready'],
  heroCoilPx: ['Lean away', 'px', 'How far the hero leans away from the lit firework.', 'Ready'],
  heroFlinchPx: ['Flinch', 'px', 'How hard the hero flinches at each launch.', 'Ready'],
  wigglePx: ['Wiggle', 'px', 'How far the bottle rocket swings side to side on its way.', 'The rocket'],
  wiggleHz: ['Wiggles', undefined, 'How many times it swings over the flight.', 'The rocket'],
  trailMs: ['Trail spacing', 'ms', 'A spark is dropped behind the rocket this often (lower = a thicker trail).', 'The rocket'],
  candleGapMs: ['Thump gap', 'ms', 'The gap between the three thumps of the roman candle.', 'The candle'],
  candleSpread: ['Pop spread', '×', 'How far apart the first two balls land on the face (portrait radii).', 'The candle'],
  holdMs: ['HELD BEAT', 'ms', 'The quiet between the comet leaving the screen and the bloom: nothing moves, nothing sounds.', 'The mortar'],
  bloomSize: ['Bloom size', '×', 'The radius of the bloom (portrait radii).', 'The mortar'],
  bloomLift: ['Bloom height', '×', 'How high above the struck portrait the shell opens (portrait radii).', 'The mortar'],
  bloomMs: ['Bloom hang', 'ms', 'How long the stars of the bloom live as they droop.', 'The mortar'],
  rain: ['Falling sparks', undefined, 'Sparks that fall from the bloom onto the struck portrait.', 'The mortar'],
  rainMs: ['Fall time', 'ms', 'How long the falling sparks take to land (the longest).', 'The mortar'],
  glitter: ['Crackle', undefined, 'Crackle twinkles inside the bloom as it hangs.', 'The mortar'],
  skyFlash: ['Sky light', 'opacity', 'The light the bloom throws across the whole screen (0 = none).', 'The mortar'],
  finaleShots: ['Finale shells', undefined, 'Smaller shells that crack open round the bloom after it (0 = none).', 'The mortar'],
  finaleGapMs: ['Finale gap', 'ms', 'The gap between the finale shells.', 'The mortar'],
  aftermathMs: ['Aftermath', 'ms', 'How long the bloom hangs and crackles before the attack ends.', 'The mortar'],
  rockDeg: ['Rock', '°', 'How far the bloom rocks the struck portrait.', 'Camera and portraits'],
  dismissMs: ['Take away', 'ms', 'The tube sinking away after the blow.', 'The mortar'],
  flashAlpha: ['Flash', 'opacity', 'How bright the white flash of a pop or the bloom is.', 'Camera and portraits'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back (down, under the bloom).', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxPlantGain: ['plant: gain', undefined, 'The firework set down beside the hero.', 'Sound: plant'],
  sfxPlantRate: ['plant: pitch', '×', 'Pitch of the plant.', 'Sound: plant'],
  sfxFuseGain: ['fuse: gain', undefined, 'The fuse fizzing.', 'Sound: fuse'],
  sfxFuseRate: ['fuse: pitch', '×', 'Pitch of the fizz.', 'Sound: fuse'],
  sfxSquealGain: ['squeal: gain', undefined, 'The bottle rocket whistling off.', 'Sound: squeal'],
  sfxSquealRate: ['squeal: pitch', '×', 'Pitch of the whistle.', 'Sound: squeal'],
  sfxThumpGain: ['thump: gain', undefined, 'The mortar firing (the candle plays it softer and higher).', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the mortar thump (lower = heavier).', 'Sound: thump'],
  sfxPopGain: ['pop: gain', undefined, 'A small burst: the rocket and each candle ball.', 'Sound: pop'],
  sfxPopRate: ['pop: pitch', '×', 'Pitch of the small bursts (higher = smaller).', 'Sound: pop'],
  sfxBoomGain: ['boom: gain', undefined, 'The shell bursting, with its crackle.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the big boom.', 'Sound: boom'],
  sfxWhistleGain: ['whistle: gain', undefined, 'The shell whistling up out of the mortar.', 'Sound: whistle'],
  sfxWhistleRate: ['whistle: pitch', '×', 'Pitch of the rising whistle.', 'Sound: whistle'],
  sfxCrackleGain: ['crackle: gain', undefined, 'The long crackle after the boom (and a breath of it after a pop).', 'Sound: crackle'],
  sfxCrackleRate: ['crackle: pitch', '×', 'Pitch of the crackle.', 'Sound: crackle'],
  sfxTailMix: ['burst tail', undefined, 'A short reverb tail on the bursts. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the fireworks play (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<FireworksLevelSuffix, [string, TunerUnit | undefined, string]> = {
  FuseMs: ['Fuse', 'ms', 'How long the fuse fizzes before the launch. The view pushes in over this.'],
  FlyMs: ['Flight', 'ms', 'The flight of the rocket or of each candle ball, or the rise of the comet off the top of the screen.'],
  Size: ['Firework size', '×', 'How big the planted firework is.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact (a launch kicks it a little too).'],
  Zoom: ['Push in', '×', 'How far the view pushes in (the mortar: as the comet rises, then held).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Sparks: ['Sparks', undefined, 'Spokes in a pop (the mortar: stars in the outer ring of the bloom).'],
  Burst: ['Burst size', '×', 'Scale of the pops (the mortar: of the flash of the bloom).'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims (the mortar: through the held beat and the bloom).'],
};

const CLIP_OF: Partial<Record<string, HeroFireworksStrKey>> = {
  'Sound: plant': 'sfxPlantClip', 'Sound: fuse': 'sfxFuseClip', 'Sound: squeal': 'sfxSquealClip', 'Sound: thump': 'sfxThumpClip',
  'Sound: pop': 'sfxPopClip', 'Sound: boom': 'sfxBoomClip', 'Sound: whistle': 'sfxWhistleClip', 'Sound: crackle': 'sfxCrackleClip',
};

const COLORS: [HeroFireworksStrKey, string, string][] = [
  ['colorCore', 'Core', 'The white-hot middle of every spark, flash and twinkle.'],
  ['colorGold', 'Gold', 'The fuse sparks, the outer ring of the bloom and its falling sparks.'],
  ['colorMagenta', 'Magenta', 'The second ring of the bloom, and one of the pop colours.'],
  ['colorCyan', 'Cyan', 'The small bloom inside, and one of the pop colours.'],
  ['colorGreen', 'Green', 'The crackle, and one of the pop colours.'],
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
      out.push({ key, label, unit, hint, group: FIREWORKS_LEVEL_NAMES[v as FireworksLevel], min, max, step });
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

/** Play the real Grand Finale between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroFireworksOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroFireworksHandle | null> {
  live?.cancel();
  const cfg = getHeroFireworksConfig();
  return playAttackDemo(side, (o) => playHeroFireworks(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroFireworks?: unknown }).__heroFireworks = { demo, previewParts, play: playHeroFireworks };
}

const LOOK_OF: Record<FireworksLevel, string> = { 1: 'a squeal and a pop', 2: 'three thumps, three pops', 3: 'the held beat and the bloom' };

export const SPEC: TunerSpec<FireworksTunerValues> = {
  id: 'herofireworks',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Grand Finale (fireworks, Epic)',
  note: () => {
    const c = getHeroFireworksConfig();
    const p = fireworksPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${FIREWORKS_LEVEL_NAMES[p.level]} (${LOOK_OF[p.level]}) · launch ${Math.round(p.launches[0] ?? 0)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
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
    { label: '▶ You strike', hint: 'Your hero sets off a firework at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe strikes', hint: 'The foe sets off a firework at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Rocket (3)', hint: 'Your hero strikes for 3: the bottle rocket.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Candle (8)', hint: 'Your hero strikes for 8: the roman candle, three balls.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Candle (12)', hint: 'Your hero strikes for 12 from four numbers: still the roman candle (an Epic has three looks).', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Mortar (40)', hint: 'Your hero strikes for 40 from seven numbers: the mortar shell, the held beat and the bloom.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe rocket (3)', hint: 'The foe strikes your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe candle (8)', hint: 'The foe strikes your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe mortar (40)', hint: 'The foe strikes your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroFireworksTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
