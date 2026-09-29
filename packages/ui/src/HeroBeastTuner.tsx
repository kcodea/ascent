import {
  BEAST_TIER_SUFFIXES, HERO_BEAST_DEFAULTS, HERO_BEAST_RANGES, TIERS, beastPlan, getHeroBeastConfig,
  heroBeastConfigJson, resetHeroBeastConfig, setHeroBeastValue,
  type BeastTierSuffix, type HeroBeastConfig, type HeroBeastNumKey, type HeroBeastStrKey, type TierNum,
} from './heroBeast/heroBeastConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroBeast, type HeroBeastHandle, type HeroBeastOptions } from './heroBeast/heroBeast';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerAction, TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the STAMPEDE, the beast chomp rush hero attack (owner ask 2026-09-29: "make some more attack types ...
 * a beast chomp rush animation ... use the same 4 tier strategy we have been"). The Play buttons run the REAL runner
 * between the two real hero portraits (works from the shop), in either direction, at Small 3 / Tier II 8 / Medium 12 /
 * Huge 40. A preview never touches the run. The "Attack style" row is the same dev override as the other attack tuners'
 * (Auto = what a player would see). Production plays the baked defaults.
 *
 * THE BUTTON ROW SITS AT THE TOP (owner ask 2026-09-29, for every hero attack tuner: remove the Speed and Reduced motion
 * buttons, and put the button row at the top): the shared `buttonsOnTop` (#1843) renders Copy JSON, Reset and the Play
 * buttons under the header, like every other attack tuner.
 */
type BeastTunerValues = HeroBeastConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroBeastNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which the pack steps up to Tier II (two beasts). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which a pack of five rushes. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which the colossus rises and slams its jaws. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Growl'],
  heroCrouchPx: ['Crouch back', 'px', 'How far the hero crouches back from the target as the pack gathers.', 'Growl'],
  heroLungePx: ['Loose lunge', 'px', 'How far the hero lunges toward the target as each beast leaps.', 'Growl'],
  beastLength: ['Beast size', 'px', 'How long each spirit beast head is (the tier size multiplies it).', 'Beasts'],
  beastGlow: ['Beast glow', 'opacity', 'The feral green glow round each beast and the jaws (0 = none).', 'Beasts'],
  maneMs: ['Mane length', 'ms', 'How much of its leap the streaming mane spans (0 = no mane).', 'Beasts'],
  maneWidth: ['Mane width', 'px', 'How thick the mane is at the skull.', 'Beasts'],
  embers: ['Embers', '×', 'Embers shed along each leap (0 = none).', 'Beasts'],
  jawOpen: ['Jaw open', undefined, 'How wide each beast opens its jaw as it pounces (radians).', 'Beasts'],
  clampLeadMs: ['Jaw snap', 'ms', 'The front jaws fade in wide this long before a beast lands, then slam shut ON the bite. Lower = a sharper snap.', 'Chomp'],
  clampSize: ['Jaw size', '×', 'The size of the chomp jaws against the portrait.', 'Chomp'],
  biteHoldMs: ['Clamp hold', 'ms', 'How long the jaws stay clamped (worrying the portrait) before they let go.', 'Chomp'],
  biteMarkMs: ['Bite marks', 'ms', 'How long the bite marks stay in the face.', 'Chomp'],
  tintAlpha: ['Tint strength', 'opacity', 'The feral tint pulse over the struck portrait.', 'Chomp'],
  dustSize: ['Dust size', '×', 'Tiers III and IV: the dust kicked up by the pack.', 'Chomp'],
  riseMs: ['Rise', 'ms', 'Tier IV: how long the colossus looms (jaws creeping in, eyes igniting) before the slam.', 'Colossus (Tier IV)'],
  slamMs: ['Slam', 'ms', 'Tier IV: the colossal jaws slamming shut. Lower = harder.', 'Colossus (Tier IV)'],
  colossalSize: ['Colossus size', '×', 'Tier IV: how huge the colossal jaws are.', 'Colossus (Tier IV)'],
  roarDelayMs: ['Roar after', 'ms', 'Tier IV: the roar, this long after the slam.', 'Colossus (Tier IV)'],
  roarHoldMs: ['Roar hold', 'ms', 'Tier IV: how long the jaws stay open roaring before the colossus dissolves.', 'Colossus (Tier IV)'],
  roarRings: ['Roar rings', undefined, 'Tier IV: shockwave rings the roar sends out.', 'Colossus (Tier IV)'],
  roarSize: ['Roar size', '×', 'Tier IV: how far the roar rings and speed lines reach.', 'Colossus (Tier IV)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact and slam flashes are.', 'Colossus (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is jerked by the bite.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How flat the struck portrait is squeezed between the jaws.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxGrowlGain: ['growl: gain', undefined, 'A low growl as the pack gathers.', 'Sound: growl'],
  sfxGrowlRate: ['growl: pitch', '×', 'Pitch of the growl.', 'Sound: growl'],
  sfxSnarlGain: ['snarl: gain', undefined, 'A snarl as the first beast leaps (every beast at Tiers I and II).', 'Sound: snarl'],
  sfxSnarlRate: ['snarl: pitch', '×', 'Pitch of the snarl.', 'Sound: snarl'],
  sfxRushGain: ['rush: gain', undefined, 'The rush of air as each beast leaps (each a little higher).', 'Sound: rush'],
  sfxRushRate: ['rush: pitch', '×', 'Pitch of the first rush.', 'Sound: rush'],
  sfxSnapGain: ['snap: gain', undefined, 'The jaws snapping shut (the crack of the chomp).', 'Sound: snap'],
  sfxSnapRate: ['snap: pitch', '×', 'Pitch of the snap (climbs per tick).', 'Sound: snap'],
  sfxCrunchGain: ['crunch: gain', undefined, 'The meaty crunch under each snap.', 'Sound: crunch'],
  sfxCrunchRate: ['crunch: pitch', '×', 'Pitch of the crunch.', 'Sound: crunch'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the last chomp at Tiers I to III.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxBigGain: ['heavy hit: gain', undefined, 'Tiers III and IV: a heavy crack on the impact.', 'Sound: heavy hit'],
  sfxBigRate: ['heavy hit: pitch', '×', 'Pitch of the heavy hit.', 'Sound: heavy hit'],
  sfxRiseGain: ['rise: gain', undefined, 'Tier IV: the colossus rising, a deep slow growl.', 'Sound: rise'],
  sfxRiseRate: ['rise: pitch', '×', 'Pitch of the rise (lower = bigger beast).', 'Sound: rise'],
  sfxSlamGain: ['slam: gain', undefined, 'Tier IV: the colossal jaws slamming shut.', 'Sound: slam'],
  sfxSlamRate: ['slam: pitch', '×', 'Pitch of the slam.', 'Sound: slam'],
  sfxRoarGain: ['roar: gain', undefined, 'Tier IV: the roar after the slam.', 'Sound: roar'],
  sfxRoarRate: ['roar: pitch', '×', 'Pitch of the roar.', 'Sound: roar'],
  sfxBoomGain: ['boom: gain', undefined, 'Tier IV: a deep boom under the roar.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxRumbleGain: ['stampede: gain', undefined, 'Tiers III and IV: a synth ground rumble under the pack and the rise (0 = none).', 'Sound: synth'],
  sfxRumbleLowHz: ['stampede: low', undefined, 'Hz. The rumble\'s floor.', 'Sound: synth'],
  sfxRumbleHighHz: ['stampede: high', undefined, 'Hz. How bright the rumble opens up to.', 'Sound: synth'],
  sfxRushLenMs: ['rush length', 'ms', 'Each rush is cut to this long (with a fade).', 'Sound: mix'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact and slam clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact and the roar. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the pack plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<BeastTierSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Growl', 'ms', 'The pack gathering before the first beast leaps. The view pushes in over this.'],
  Beasts: ['Beasts', undefined, 'How many beasts rush (I one, II two, III a pack of five, IV six before the colossus).'],
  StaggerMs: ['Stagger', 'ms', 'Gap between each beast leaping (the rhythm of the chomps).'],
  FlightMs: ['Leap speed', 'ms', 'A beast crossing the board (at 1600 px; lower = faster; scales gently with distance).'],
  Leap: ['Leap height', '×', 'How high the beasts leap, as a fraction of the distance.'],
  Spread: ['Lanes', '×', 'How far apart the pack\'s lanes spread.'],
  BeastSize: ['Beast size', '×', 'The beast size multiplier for this tier.'],
  Dust: ['Dust', undefined, 'The pack kicks up dust as it runs and bites.'],
  Colossal: ['Colossus', undefined, 'A giant beast rises behind the target and slams its jaws shut (instead of a plain last chomp).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the growl (and the rise).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Sparks: ['Sparks', undefined, 'Sparks thrown off the bite line on the impact (or the slam).'],
  Burst: ['Flash size', '×', 'Scale of the impact flash and bloom.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroBeastStrKey>> = {
  'Sound: growl': 'sfxGrowlClip', 'Sound: snarl': 'sfxSnarlClip', 'Sound: rush': 'sfxRushClip', 'Sound: snap': 'sfxSnapClip',
  'Sound: crunch': 'sfxCrunchClip', 'Sound: impact': 'sfxImpactClip', 'Sound: heavy hit': 'sfxBigClip', 'Sound: rise': 'sfxRiseClip',
  'Sound: slam': 'sfxSlamClip', 'Sound: roar': 'sfxRoarClip', 'Sound: boom': 'sfxBoomClip',
};

const COLORS: [HeroBeastStrKey, string, string][] = [
  ['colorAmber', 'Amber', 'The beasts\' bodies, the jaws, rings and the bite marks\' glow.'],
  ['colorFeral', 'Feral', 'The green glow: the manes, the beasts\' aura, the jaws\' glow and the roar.'],
  ['colorFang', 'Fang', 'The gleaming fangs and lit edges.'],
  ['colorCore', 'Core', 'The white-hot core of flashes.'],
  ['colorDark', 'Dark', 'The bite marks and the colossus\' shadow.'],
  ['colorDust', 'Dust', 'The dust the pack kicks up.'],
  ['colorPlayer', 'Your side', 'Your total colour when YOUR pack rushes.'],
  ['colorFoe', 'Foe side', 'Their total colour when THEIR pack rushes.'],
];

type Ctl = TunerControl<Extract<keyof BeastTunerValues, string>>;

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
  const push = (key: HeroBeastNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_BEAST_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of BEAST_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroBeastNumKey;
      const [min, max, step] = HERO_BEAST_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Colossal' || s === 'Dust'
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

let live: HeroBeastHandle | null = null;

/** Play the real Stampede between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroBeastOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroBeastHandle | null> {
  live?.cancel();
  const cfg = getHeroBeastConfig();
  return playAttackDemo(side, (o) => playHeroBeast(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBeast?: unknown }).__heroBeast = { demo, previewParts };
}

/** The Play buttons (the top row, after the shared Copy JSON and Reset). */
export const BEAST_TUNER_PLAYS: TunerAction[] = [
  { label: '▶ You rush', hint: 'Your hero looses the pack at the foe for the preview damage.', run: () => { void demo('player'); } },
  { label: '▶ Foe rushes', hint: 'The foe looses the pack at your hero for the preview damage.', run: () => { void demo('opp'); } },
  { label: '▶ Small (3)', hint: 'Your hero attacks for 3: Tier I, one spirit wolf lunges and chomps.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
  { label: '▶ Tier II (8)', hint: 'Your hero attacks for 8: Tier II, two beasts, a staggered double chomp.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
  { label: '▶ Medium (12)', hint: 'Your hero attacks for 12 from four numbers: Tier III, a pack of five streaming across.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
  { label: '▶ Huge (40)', hint: 'Your hero attacks for 40 from seven numbers: Tier IV, the pack, then the colossus slams its jaws and roars.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
  { label: '▶ Foe small (3)', hint: 'The foe attacks your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
  { label: '▶ Foe tier II (8)', hint: 'The foe attacks your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
  { label: '▶ Foe medium (12)', hint: 'The foe attacks your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
  { label: '▶ Foe huge (40)', hint: 'The foe attacks your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
];

export const SPEC: TunerSpec<BeastTunerValues> = {
  id: 'herobeast',                  // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Beast',
  note: () => {
    const c = getHeroBeastConfig();
    const p = beastPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.colossal ? `${p.beasts.length} beasts, colossus` : `${p.beasts.length} beast${p.beasts.length === 1 ? '' : 's'}`} · leap ${Math.round(p.launchAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroBeastConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroBeastValue(key as keyof HeroBeastConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroBeastValue(key as keyof HeroBeastConfig, value); },
  reset: () => { resetHeroBeastConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_BEAST_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroBeastConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: BEAST_TUNER_PLAYS,
};

export function HeroBeastTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
