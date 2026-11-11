import {
  VOID_TIER_SUFFIXES, HERO_VOID_DEFAULTS, HERO_VOID_RANGES, TIERS, voidPlan, getHeroVoidConfig,
  heroVoidConfigJson, resetHeroVoidConfig, setHeroVoidValue,
  type VoidTierSuffix, type HeroVoidConfig, type HeroVoidNumKey, type HeroVoidStrKey, type TierNum,
} from './heroVoid/heroVoidConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroVoid, type HeroVoidHandle, type HeroVoidOptions } from './heroVoid/heroVoid';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the VOID hero attack (Mike 2026-11-11: "lets do void!"; built on Arcana's tuner). The Play buttons run
 * the REAL runner between the two real hero portraits (works from the shop), in either direction, at Small 3 /
 * Tier II 8 / Medium 12 / Huge 40. A preview never touches the run. The "Attack style" row is the same dev override as
 * the other attack tuners' (Auto = what a player would see). Production plays the baked defaults.
 */
type VoidTunerValues = HeroVoidConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroVoidNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which Void steps up to Tier II (two ribbons). Shared with Blast and Quake (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which Void becomes the barrage of five. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which Void becomes the vortex and explosion. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Charge'],
  heroSwell: ['Hero swell', '×', 'How much the hero swells as the spell gathers.', 'Charge'],
  recoilPx: ['Recoil', 'px', 'How far the hero dips as each ribbon leaves.', 'Charge'],
  ribbonLength: ['Ribbon length', 'ms', 'How much of its flight a ribbon trails behind it (longer = a longer streak).', 'Ribbons'],
  ribbonGlow: ['Glow width', '×', 'The light edging the dark trail, as a multiple of its body.', 'Ribbons'],
  ribbonCore: ['Seam width', '×', 'The thin hot seam down the dark trail, as a fraction of the body.', 'Ribbons'],
  ribbonShade: ['Smoke', 'opacity', 'A soft dark smoke round the trail (normal blend, so it reads on light boards too; 0 = none).', 'Ribbons'],
  ribbonTwist: ['Twist', '×', 'How much the width breathes as the ribbon twists (0 = a plain taper).', 'Ribbons'],
  strand: ['Strand', '×', 'The thin pale strand winding round the trail (0 = none).', 'Ribbons'],
  headSize: ['Orb size', '×', 'The dark orb at the head of the trail.', 'Ribbons'],
  sigilSize: ['Orb swirl', '×', 'The swirl of light spinning into the orb (0 = none).', 'Ribbons'],
  orbMotes: ['Orb motes', undefined, 'How many motes circle each orb and spiral into it (0 = none).', 'Ribbons'],
  orbReach: ['Mote reach', '×', 'How far out a mote is caught, in orb radii.', 'Ribbons'],
  orbSpin: ['Mote spin', undefined, 'Turns a second at the outer edge; motes speed up as they fall in.', 'Ribbons'],
  swirlRadius: ['Vortex radius', '×', 'Tier IV: the vortex radius, in portrait radii.', 'Swirl (Tier IV)'],
  swirlTilt: ['Vortex tilt', '×', 'Tier IV: how flat the ring looks (1 = a circle, lower = a tilted ring seen at an angle).', 'Swirl (Tier IV)'],
  swirlMs: ['Swirl time', 'ms', 'Tier IV: how long the vortex spins from the first ribbon joining to the collapse.', 'Swirl (Tier IV)'],
  swirlSpeed0: ['Spin start', undefined, 'Tier IV: turns a second as the vortex forms.', 'Swirl (Tier IV)'],
  swirlSpeed1: ['Spin end', undefined, 'Tier IV: turns a second at the collapse (it speeds up to this).', 'Swirl (Tier IV)'],
  swirlTighten: ['Tighten', '×', 'Tier IV: how far the ring closes in as it spins up (0 = not at all).', 'Swirl (Tier IV)'],
  convergeMs: ['Collapse', 'ms', 'Tier IV: the orbs and the black hole snapping to a point before the blast.', 'Swirl (Tier IV)'],
  pullPx: ['Striker pull', 'px', 'Tier IV: how far the striking portrait is dragged toward the black hole.', 'Swirl (Tier IV)'],
  crush: ['Target crush', '×', 'Tier IV: how much the struck portrait shrinks toward the hole as it grows.', 'Swirl (Tier IV)'],
  explodeSize: ['Explosion size', '×', 'Tier IV: the scale of the explosion.', 'Explosion'],
  explodeRibbons: ['Blast ribbons', undefined, 'Tier IV: ribbons flung outward by the explosion.', 'Explosion'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact and explosion flashes are.', 'Explosion'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
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
  sfxLaunchLenMs: ['launch length', 'ms', 'Each launch whoosh is cut to this long (with a fade).', 'Sound: mix'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact and explosion clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while Void plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<VoidTierSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Charge', 'ms', 'The spell gathering before the first ribbon leaves. The view pushes in over this.'],
  Ribbons: ['Ribbons', undefined, 'How many ribbons are lobbed (I one, II two, III the barrage of five, IV the vortex).'],
  LaunchStaggerMs: ['Launch stagger', 'ms', 'Gap between each ribbon leaving (the barrage rhythm).'],
  FlightMs: ['Flight', 'ms', 'A ribbon crossing the board (at 1600 px; scales gently with distance).'],
  ArcHeight: ['Arc height', '×', 'How high the lob arcs, as a fraction of the distance.'],
  Fan: ['Fan', '×', 'How far a volley spreads its arcs apart.'],
  RibbonWidth: ['Ribbon width', 'px', 'The body width of each ribbon (the last is a little bigger).'],
  Swirl: ['Vortex', undefined, 'The ribbons swirl over the target, converge and explode instead of striking.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the charge (and the vortex).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Motes: ['Glitter', undefined, 'Glitter stars thrown by the impact.'],
  Burst: ['Burst size', '×', 'Scale of the impact flash and bloom.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroVoidStrKey>> = {
  'Sound: cast': 'sfxCastClip',
  'Sound: charge': 'sfxChargeClip', 'Sound: launch': 'sfxLaunchClip', 'Sound: shimmer': 'sfxShimmerClip', 'Sound: tick hit': 'sfxHitClip',
  'Sound: impact': 'sfxImpactClip', 'Sound: chime': 'sfxChimeClip', 'Sound: thump': 'sfxThumpClip', 'Sound: collapse': 'sfxImplodeClip',
  'Sound: explosion': 'sfxExplodeClip', 'Sound: big hit': 'sfxBigClip', 'Sound: aftershock': 'sfxBoomClip',
};

const COLORS: [HeroVoidStrKey, string, string][] = [
  ['colorPlayer', 'Your void', 'The ribbon glow, sigils and total colour when YOU strike.'],
  ['colorFoe', 'Foe void', 'The ribbon glow, sigils and total colour when THEY strike.'],
  ['colorAccent', 'Accent', 'The cyan strand, rings and glitter.'],
  ['colorCore', 'Core', 'The white-hot core of the ribbons and flashes.'],
  ['colorShade', 'Halo', 'The soft halo round each ribbon (it shows on light boards, where the additive glow cannot).'],
];

type Ctl = TunerControl<Extract<keyof VoidTunerValues, string>>;

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
  const push = (key: HeroVoidNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_VOID_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of VOID_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroVoidNumKey;
      const [min, max, step] = HERO_VOID_RANGES[key];
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

let live: HeroVoidHandle | null = null;

/** Play the real Void between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; knockout?: boolean; reduced?: boolean; frames?: HeroVoidOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroVoidHandle | null> {
  live?.cancel();
  const cfg = getHeroVoidConfig();
  return playAttackDemo(side, (o) => playHeroVoid(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, knockout: opts.knockout, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroVoid?: unknown }).__heroVoid = { demo, previewParts };
}

export const SPEC: TunerSpec<VoidTunerValues> = {
  id: 'herovoid',                  // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Void',
  note: () => {
    const c = getHeroVoidConfig();
    const p = voidPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.swirl ? 'vortex' : `${p.ribbons.length} ribbon${p.ribbons.length === 1 ? '' : 's'}`} · fire ${Math.round(p.fireAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroVoidConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroVoidValue(key as keyof HeroVoidConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroVoidValue(key as keyof HeroVoidConfig, value); },
  reset: () => { resetHeroVoidConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_VOID_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroVoidConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You cast', hint: 'Your hero casts Void at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe casts', hint: 'The foe casts Void at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero casts for 3: Tier I, one ribbon.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero casts for 8: Tier II, two ribbons.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero casts for 12 from four numbers: Tier III, the barrage of five.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero casts for 40 from seven numbers: Tier IV, the vortex and explosion.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe casts at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe casts at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe casts at your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe casts at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroVoidTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
