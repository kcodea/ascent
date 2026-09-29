import {
  HERO_BLAST_DEFAULTS, HERO_BLAST_RANGES, blastPlan, getHeroBlastConfig, heroBlastConfigJson,
  resetHeroBlastConfig, setHeroBlastValue,
  TIERS, TIER_SUFFIXES, type HeroBlastConfig, type HeroBlastNumKey, type HeroBlastStrKey, type TierNum, type TierSuffix,
} from './heroBlast/heroBlastConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroBlast, type HeroBlastHandle, type HeroBlastOptions } from './heroBlast/heroBlast';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the BLAST hero attack (owner ask 2026-09-28). The Play buttons run the REAL runner between the two
 * real hero portraits (the foe's is mounted via `duelPreview`, so it works from the shop), with the damage and the
 * number of parts chosen below, in either direction. A preview never touches the run: the
 * impact only pops the red damage number. The "Attack style" row is the dev override for real fights (Auto = what
 * a player would see: their equipped cosmetic, else Classic). Production plays the baked defaults.
 */
type BlastTunerValues = HeroBlastConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroBlastNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which the blast steps up to Tier II.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which the blast steps up to Tier III (secondary explosions, embers).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which the blast becomes the colossal beam.', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Charge and fire'],
  heroSwell: ['Hero swell', '×', 'How much the hero swells while charging.', 'Charge and fire'],
  boltSpeed: ['Bolt speed', 'px/s', 'How fast the bolts fly (the flight stays between 180 and 420 ms).', 'Charge and fire'],
  boltStaggerMs: ['Bolt stagger', 'ms', 'Gap between each bolt in the volley.', 'Charge and fire'],
  boltCurve: ['Bolt fan', '×', 'How far the trailing bolts arc to the sides (the lead bolt flies straight).', 'Charge and fire'],
  trailLength: ['Trail', '×', 'Length of the comet tail (0 = none).', 'Charge and fire'],
  recoilPx: ['Hero recoil', 'px', 'How far the hero kicks back when it fires.', 'Charge and fire'],
  beamHoldMs: ['Beam hold', 'ms', 'Tier IV: how long the beam holds on the target before it thins out.', 'Charge and fire'],
  flashSize: ['Hit flash size', '×', 'The white-hot burst on the struck hero.', 'Impact and camera'],
  flashAlpha: ['Hit flash', 'opacity', 'How bright the hit flash is.', 'Impact and camera'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked along the bolt.', 'Impact and camera'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Impact and camera'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Impact and camera'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Impact and camera'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Impact and camera'],
  sfxChargeGain: ['charge: gain', undefined, 'The riser as the hero gathers.', 'Sound: charge'],
  sfxChargeRate: ['charge: pitch', '×', 'Pitch of the riser.', 'Sound: charge'],
  sfxFireGain: ['fire: gain', undefined, 'The release as the volley leaves.', 'Sound: fire'],
  sfxFireRate: ['fire: pitch', '×', 'Pitch of the release.', 'Sound: fire'],
  sfxBeamGain: ['beam: gain', undefined, 'Tier IV: the beam tearing across the board.', 'Sound: beam'],
  sfxBeamRate: ['beam: pitch', '×', 'Pitch of the beam.', 'Sound: beam'],
  sfxImpactGain: ['impact: gain', undefined, 'The hit on the struck hero.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the hit.', 'Sound: impact'],
  sfxThumpGain: ['thump: gain', undefined, 'The low punch layered under the hit (keep it punchy, not boomy).', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxBigGain: ['big hit: gain', undefined, 'Tiers III and IV: a crack layered on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big-hit layer.', 'Sound: big hit'],
  sfxBoomGain: ['booms: gain', undefined, 'Tiers III and IV: each secondary explosion (pitch climbs per boom).', 'Sound: booms'],
  sfxBoomRate: ['booms: pitch', '×', 'Pitch of the first secondary explosion.', 'Sound: booms'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact clip is cut to this long (with a fade).', 'Sound: mix'],
  sfxBoomLenMs: ['boom length', 'ms', 'Each secondary explosion is cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the hit. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the blast plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<TierSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Charge', 'ms', 'The hero gathering power. The view pushes in over this.'],
  Motes: ['Charge motes', undefined, 'Energy spiralling into the hero.'],
  Bolts: ['Bolts', undefined, 'Bolts in the volley (ignored when Beam is on).'],
  BoltSize: ['Bolt size', '×', 'Bolt (or beam) thickness.'],
  Shake: ['Shake', 'px', 'Screen shake along the line of fire.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the charge (0.03 = 3%).'],
  Punch: ['Impact punch', '×', 'Extra push on impact before the view settles.'],
  Sparks: ['Sparks', undefined, 'Chunky sparks the impact throws.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last hit before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims through the charge and the hit.'],
  Booms: ['Secondary booms', undefined, 'Explosions ringing the struck hero after the hit.'],
  Beam: ['Beam', undefined, 'Fire one colossal beam instead of bolts.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroBlastStrKey>> = {
  'Sound: charge': 'sfxChargeClip',
  'Sound: fire': 'sfxFireClip', 'Sound: beam': 'sfxBeamClip', 'Sound: impact': 'sfxImpactClip', 'Sound: thump': 'sfxThumpClip',
  'Sound: big hit': 'sfxBigClip', 'Sound: booms': 'sfxBoomClip',
};

const COLORS: [HeroBlastStrKey, string, string][] = [
  ['colorPlayer', 'Your side', 'The glow, rings and total colour when YOU strike.'],
  ['colorFoe', 'Foe side', 'The glow, rings and total colour when THEY strike.'],
  ['colorCore', 'Core', 'The white-hot core of the bolts, flashes and sparks.'],
];

type Ctl = TunerControl<Extract<keyof BlastTunerValues, string>>;

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
  const push = (key: HeroBlastNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_BLAST_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroBlastNumKey;
      const [min, max, step] = HERO_BLAST_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Beam'
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

let live: HeroBlastHandle | null = null;

export { previewParts };

/** Play the real Blast between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroBlastOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroBlastHandle | null> {
  live?.cancel();
  const cfg = getHeroBlastConfig();
  return playAttackDemo(side, (o) => playHeroBlast(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBlast?: unknown }).__heroBlast = { demo, previewParts };
}

export const SPEC: TunerSpec<BlastTunerValues> = {
  id: 'heroblast',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Blast',
  note: () => {
    const c = getHeroBlastConfig();
    const p = blastPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1000 }, c);
    return `dev · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroBlastConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroBlastValue(key as keyof HeroBlastConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroBlastValue(key as keyof HeroBlastConfig, value); },
  reset: () => { resetHeroBlastConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_BLAST_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroBlastConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You blast', hint: 'Your hero blasts the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe blasts', hint: 'The foe blasts your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero blasts for 3: the smallest volley.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero blasts for 12 from four numbers.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero blasts for 40 from seven numbers: the full volley, shake and push.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe blasts your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroBlastTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
