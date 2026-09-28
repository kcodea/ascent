import {
  BLADES_TIER_SUFFIXES, HERO_BLADES_DEFAULTS, HERO_BLADES_RANGES, HERO_BLADES_SPEEDS, TIERS, bladesPlan, getHeroBladesConfig,
  heroBladesConfigJson, heroBladesPreviewSpeed, resetHeroBladesConfig, setHeroBladesPreviewSpeed, setHeroBladesValue,
  type BladesTierSuffix, type HeroBladesConfig, type HeroBladesNumKey, type HeroBladesStrKey, type TierNum,
} from './heroBlades/heroBladesConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroBlades, type HeroBladesHandle, type HeroBladesOptions } from './heroBlades/heroBlades';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the PHANTOM BLADES hero attack (owner ask 2026-09-28: "make a new style animation and surprise me with
 * it"). The Play buttons run the REAL runner between the two real hero portraits (works from the shop), in either
 * direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40, with reduced motion, at 1x / 0.5x / 0.25x. A preview never
 * touches the run. The "Attack style" row is the same dev override as the other attack tuners' (Auto = what a player
 * would see). Production plays the baked defaults.
 */
type BladesTunerValues = HeroBladesConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroBladesNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which the Blades step up to Tier II (a crossed pair). Shared with every hero attack (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which the Blades become the fan of five. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which the Blades bring down the greatsword. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero before the blades appear.', 'Summon and aim'],
  heroSwell: ['Hero swell', '×', 'How much the hero swells as the blades are summoned.', 'Summon and aim'],
  recoilPx: ['Recoil', 'px', 'How far the hero kicks back as each blade is loosed.', 'Summon and aim'],
  manifestMs: ['Unfurl', 'ms', 'Each blade growing out of its guard.', 'Summon and aim'],
  aimMs: ['Aim swing', 'ms', 'The blades swinging round from the sky to point at the target.', 'Summon and aim'],
  lockMs: ['Lock', 'ms', 'The breath after the aim: every blade dead still before the first is loosed.', 'Summon and aim'],
  pullPx: ['Kick back', 'px', 'How far a blade draws back before it thrusts.', 'Loose'],
  pullMs: ['Kick back time', 'ms', 'The draw back before the thrust.', 'Loose'],
  bladeLength: ['Blade length', 'px', 'A size 1 sword, pommel to point (each tier scales it).', 'Blades'],
  glow: ['Glow', '×', 'The coloured glow round each sword (0 = none).', 'Blades'],
  edge: ['Edges', '×', 'The white cutting edges and the gleam at the point.', 'Blades'],
  outline: ['Outline', 'opacity', 'A dark halo that holds the silhouette on a light board (0 = none).', 'Blades'],
  ghosts: ['Afterimages', undefined, 'Ghost copies trailing a blade in flight (0 = none).', 'Blades'],
  ghostGapMs: ['Afterimage gap', 'ms', 'How far back each afterimage is (longer = more spread out).', 'Blades'],
  cutLine: ['Cut line', 'opacity', 'The thin line of light a blade leaves behind its point in flight.', 'Blades'],
  quiver: ['Quiver', '°', 'How far a stuck blade quivers.', 'Blades'],
  shatterDelayMs: ['Shatter after', 'ms', 'How long the stuck blades hold after the impact before they shatter.', 'Shatter'],
  greatSize: ['Greatsword size', '×', 'Tier IV: the greatsword, as a multiple of the blade length.', 'Greatsword (Tier IV)'],
  greatForm: ['Greatsword distance', '×', 'Tier IV: how far from the hero it forms, in portrait radii.', 'Greatsword (Tier IV)'],
  greatManifestMs: ['Greatsword unfurl', 'ms', 'Tier IV: the greatsword forming.', 'Greatsword (Tier IV)'],
  greatAimMs: ['Greatsword aim', 'ms', 'Tier IV: its heavy swing round to aim.', 'Greatsword (Tier IV)'],
  greatHangMs: ['Hang', 'ms', 'Tier IV: aimed and trembling while the judgement locks on (the big anticipation).', 'Greatsword (Tier IV)'],
  greatPullMs: ['Greatsword kick back', 'ms', 'Tier IV: its draw back before the thrust.', 'Greatsword (Tier IV)'],
  greatFlight: ['Greatsword flight', '×', 'Tier IV: its thrust time as a multiple of the tier flight.', 'Greatsword (Tier IV)'],
  bindBeams: ['Binding spokes', 'opacity', 'Tier IV: the spokes of light from each stuck blade into the target while it hangs (0 = none).', 'Greatsword (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxSummonGain: ['summon: gain', undefined, 'The steel shimmer of each blade forming.', 'Sound: summon'],
  sfxSummonRate: ['summon: pitch', '×', 'Pitch of the first blade.', 'Sound: summon'],
  sfxSummonStep: ['summon: pitch step', '×', 'Each following blade rises by this much.', 'Sound: summon'],
  sfxRingGain: ['ring: gain', undefined, 'A soft high ring under each blade forming.', 'Sound: ring'],
  sfxRingRate: ['ring: pitch', '×', 'Pitch of the ring.', 'Sound: ring'],
  sfxAimGain: ['aim: gain', undefined, 'The whoosh of the blades swinging round to aim.', 'Sound: aim'],
  sfxAimRate: ['aim: pitch', '×', 'Pitch of the aim whoosh.', 'Sound: aim'],
  sfxLockGain: ['lock: gain', undefined, 'The bright ting as every blade locks on.', 'Sound: lock'],
  sfxLockRate: ['lock: pitch', '×', 'Pitch of the ting.', 'Sound: lock'],
  sfxLooseGain: ['loose: gain', undefined, 'The whoosh of each blade thrusting (each a little higher).', 'Sound: loose'],
  sfxLooseRate: ['loose: pitch', '×', 'Pitch of the first loose.', 'Sound: loose'],
  sfxLooseStep: ['loose: pitch step', '×', 'Each following loose rises by this much.', 'Sound: loose'],
  sfxCrackGain: ['crack: gain', undefined, 'A crack on the first and the last loose.', 'Sound: crack'],
  sfxCrackRate: ['crack: pitch', '×', 'Pitch of the crack.', 'Sound: crack'],
  sfxStabGain: ['stab: gain', undefined, 'Each blade going in (pitch climbs).', 'Sound: stab'],
  sfxStabRate: ['stab: pitch', '×', 'Pitch of the first stab.', 'Sound: stab'],
  sfxClangGain: ['clang: gain', undefined, 'A metal clang under each stab.', 'Sound: clang'],
  sfxClangRate: ['clang: pitch', '×', 'Pitch of the first clang.', 'Sound: clang'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the last blade, or the greatsword.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxBigGain: ['big hit: gain', undefined, 'Tiers III and IV: an extra crack layered on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxThumpGain: ['thump: gain', undefined, 'A low punch under the impact (punchy, not boomy).', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxShatterGain: ['shatter: gain', undefined, 'The stuck blades shattering.', 'Sound: shatter'],
  sfxShatterRate: ['shatter: pitch', '×', 'Pitch of the shatter.', 'Sound: shatter'],
  sfxGreatGain: ['greatsword: gain', undefined, 'Tier IV: a cinematic swoosh timed so its hit lands exactly on the greatsword going in.', 'Sound: greatsword'],
  sfxGreatRate: ['greatsword: pitch', '×', 'Pitch of the greatsword swoosh.', 'Sound: greatsword'],
  sfxSlamDownGain: ['judgement: gain', undefined, 'Tier IV: the greatsword going in.', 'Sound: judgement'],
  sfxSlamDownRate: ['judgement: pitch', '×', 'Pitch of the judgement.', 'Sound: judgement'],
  sfxBoomGain: ['aftershock: gain', undefined, 'Tier IV: the pops after the shatter.', 'Sound: aftershock'],
  sfxBoomRate: ['aftershock: pitch', '×', 'Pitch of the first aftershock.', 'Sound: aftershock'],
  sfxHumGain: ['steel hum: gain', undefined, 'Tier IV: the synth ring of the greatsword straining, peaking on the loose.', 'Sound: steel hum'],
  sfxHumHz: ['steel hum: pitch', undefined, 'Hz. The hum\'s base pitch.', 'Sound: steel hum'],
  sfxHumRise: ['steel hum: rise', '×', 'How far the hum climbs by the loose (1 = flat).', 'Sound: steel hum'],
  sfxLooseLenMs: ['loose length', 'ms', 'Each loose whoosh is cut to this long (with a fade).', 'Sound: mix'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the Blades play (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<BladesTierSuffix, [string, TunerUnit | undefined, string]> = {
  Blades: ['Blades', undefined, 'How many blades are summoned (I one, II a crossed pair, III the fan of five, IV six before the greatsword).'],
  SummonStaggerMs: ['Summon stagger', 'ms', 'Gap between each blade appearing.'],
  AimHoldMs: ['Hover', 'ms', 'The raised blades hover before they swing round to aim.'],
  LooseStaggerMs: ['Loose stagger', 'ms', 'Gap between each blade being loosed (the rhythm).'],
  FlightMs: ['Flight', 'ms', 'A blade crossing the board (at 1600 px; scales gently with distance).'],
  Spread: ['Spread', '°', 'How wide the arc of raised blades is round the hero.'],
  FormRadius: ['Arc radius', '×', 'How far from the hero the blades hover, in portrait radii.'],
  BladeSize: ['Blade size', '×', 'Each blade, as a multiple of the blade length (the last is a little bigger).'],
  Scatter: ['Cross', '×', 'How far across the portrait the points go in (the blades cross: a pair makes an X).'],
  Great: ['Greatsword', undefined, 'After the blades, a greatsword is summoned, hangs, and impales the target.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the summon (and the greatsword).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Shards: ['Shards', undefined, 'Slivers each stuck blade shatters into.'],
  Burst: ['Burst size', '×', 'Scale of the impact flash and bloom.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroBladesStrKey>> = {
  'Sound: summon': 'sfxSummonClip',
  'Sound: ring': 'sfxRingClip', 'Sound: aim': 'sfxAimClip', 'Sound: lock': 'sfxLockClip', 'Sound: loose': 'sfxLooseClip',
  'Sound: crack': 'sfxCrackClip', 'Sound: stab': 'sfxStabClip', 'Sound: clang': 'sfxClangClip', 'Sound: impact': 'sfxImpactClip',
  'Sound: big hit': 'sfxBigClip', 'Sound: thump': 'sfxThumpClip', 'Sound: shatter': 'sfxShatterClip', 'Sound: greatsword': 'sfxGreatClip',
  'Sound: judgement': 'sfxSlamDownClip', 'Sound: aftershock': 'sfxBoomClip',
};

const COLORS: [HeroBladesStrKey, string, string][] = [
  ['colorPlayer', 'Your blades', 'The steel, glow and total colour when YOU strike.'],
  ['colorFoe', 'Foe blades', 'The steel, glow and total colour when THEY strike.'],
  ['colorEdge', 'Edge', 'The cutting edges, rings and cuts.'],
  ['colorCore', 'Core', 'The white-hot flashes and glints.'],
  ['colorHilt', 'Hilt', 'The guard, grip and pommel.'],
  ['colorShade', 'Outline', 'The dark halo that holds each sword on a light board.'],
];

type Ctl = TunerControl<Extract<keyof BladesTunerValues, string>>;

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
  const push = (key: HeroBladesNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_BLADES_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of BLADES_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroBladesNumKey;
      const [min, max, step] = HERO_BLADES_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Great'
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

let live: HeroBladesHandle | null = null;

/** Play the real Phantom Blades between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroBladesOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroBladesHandle | null> {
  live?.cancel();
  const cfg = getHeroBladesConfig();
  return playAttackDemo(side, (o) => playHeroBlades(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: heroBladesPreviewSpeed(), reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBlades?: unknown }).__heroBlades = { demo, previewParts, setSpeed: setHeroBladesPreviewSpeed };
}

export const SPEC: TunerSpec<BladesTunerValues> = {
  id: 'heroblades',                  // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Phantom Blades',
  note: () => {
    const c = getHeroBladesConfig();
    const p = bladesPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${heroBladesPreviewSpeed()}x · tier ${p.tier} · ${p.blades.length} blade${p.blades.length === 1 ? '' : 's'}${p.great ? ' + greatsword' : ''} · loose ${Math.round(p.fireAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroBladesConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroBladesValue(key as keyof HeroBladesConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroBladesValue(key as keyof HeroBladesConfig, value); },
  reset: () => { resetHeroBladesConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_BLADES_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroBladesConfigJson(),
  copyLabel: 'Copy JSON',
  actions: [
    { label: '▶ You strike', hint: 'Your hero looses the Blades at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe strikes', hint: 'The foe looses the Blades at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero strikes for 3: Tier I, one blade.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero strikes for 8: Tier II, a crossed pair.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero strikes for 12 from four numbers: Tier III, the fan of five.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero strikes for 40 from seven numbers: Tier IV, six blades and the greatsword.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe strikes your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe strikes your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe strikes your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe strikes your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
    { label: '▶ Reduced motion', hint: 'What a player with reduced motion on sees: fades, no blades, shake or zoom.', run: () => { void demo('player', { reduced: true }); } },
    ...HERO_BLADES_SPEEDS.map((s) => ({
      label: `Speed ${s}x`,
      hint: 'Slow motion for the next plays (the tuner only; never saved, never in production).',
      run: () => { setHeroBladesPreviewSpeed(s); },
    })),
  ],
};

export function HeroBladesTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
