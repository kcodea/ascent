import {
  BANANA_TIER_SUFFIXES, HERO_BANANA_DEFAULTS, HERO_BANANA_RANGES, TIERS, bananaPlan, getHeroBananaConfig,
  heroBananaConfigJson, heroBananaPreviewSpeed, resetHeroBananaConfig, setHeroBananaPreviewSpeed, setHeroBananaValue,
  type BananaTierSuffix, type HeroBananaConfig, type HeroBananaNumKey, type HeroBananaStrKey, type TierNum,
} from './heroBanana/heroBananaConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroBanana, type HeroBananaHandle, type HeroBananaOptions } from './heroBanana/heroBanana';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the BANANA CANNON hero attack (owner ask 2026-09-29: "i would love a king oona banana cannon
 * animation. use the same 4 tier strategy we have been."). The Play buttons run the REAL runner between the two real
 * hero portraits (works from the shop), in either direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40, with reduced
 * motion, at 1x / 0.5x / 0.25x. A preview never touches the run. The "Attack style" row is the same dev override as the
 * other attack tuners' (Auto = what a player would see). Production plays the baked defaults.
 */
type BananaTunerValues = HeroBananaConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroBananaNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which the bananas step up to Tier II (a double). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which the barrage starts. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which the giant golden banana lands and gets jammed in. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Flourish and fling'],
  heroCoilPx: ['Coil back', 'px', 'How far the hero leans back through the flourish.', 'Flourish and fling'],
  heroFlingPx: ['Fling', 'px', 'How far the hero flicks toward the target on each banana (the giant doubles it).', 'Flourish and fling'],
  launchSparks: ['Launch sparks', undefined, "Oona's orange-gold sparks as each banana bursts out of the hero.", 'Flourish and fling'],
  bananaPx: ['Banana size', 'px', "The painted banana's size (the tier size multiplies it). Oona's card plays it at 85.", 'Bananas'],
  spinTurns: ['Spin', undefined, 'Backspin turns over a flight (the painted banana spins in the plane; the giant spins 60% of this, slowing as it hangs).', 'Bananas'],
  trailSparks: ['Juice trail', '×', 'Gold juice sparkles shed along each flight (0 = none).', 'Bananas'],
  splatPx: ['Splat size', 'px', "The painted juice splat's size (Oona's card: 139).", 'Splat'],
  splatMs: ['Splat play', 'ms', 'How long a painted splat takes to burst and dissipate.', 'Splat'],
  tickJuice: ['Tick juice', undefined, 'Juice blobs in each splat before the last.', 'Splat'],
  juiceSpeed: ['Juice speed', 'px/s', "How fast the juice bursts out (Oona's card: 435).", 'Splat'],
  juiceLifeMs: ['Juice life', 'ms', 'How long a juice blob lasts.', 'Splat'],
  juicePx: ['Juice size', 'px', "A juice blob's size (Oona's card: 35).", 'Splat'],
  giantChargeMs: ['Royal blaze', 'ms', 'Tier IV: the hero blazing gold before the giant banana.', 'Royal banana (Tier IV)'],
  giantFlightMs: ['Giant flight', 'ms', "Tier IV: the giant banana's flight (at 1600 px), hang included.", 'Royal banana (Tier IV)'],
  giantSize: ['Giant size', '×', 'Tier IV: how much bigger the golden banana is.', 'Royal banana (Tier IV)'],
  giantLift: ['Giant arc', '×', 'Tier IV: how high the giant is lobbed, as a fraction of the distance.', 'Royal banana (Tier IV)'],
  giantHangY: ['Hang height', 'px', 'Tier IV: how far below the top of the screen the giant hangs at its apex.', 'Royal banana (Tier IV)'],
  giantHang: ['Hang', undefined, 'Tier IV: how long the giant lingers at the top (0 = a plain lob; higher = a longer hang and a faster drop).', 'Royal banana (Tier IV)'],
  giantSplat: ['Finale splat', '×', 'Tier IV: the size of the finale splat, in splat sizes.', 'Royal banana (Tier IV)'],
  slamCount: ['Slams', undefined, 'Tier IV: how many times the hero jams the banana in (the last is the finisher and lands the blow).', 'The jam (Tier IV)'],
  dashMs: ['Dash', 'ms', 'Tier IV: the hero dashing across to the stuck banana.', 'The jam (Tier IV)'],
  slamGapMs: ['Slam spacing', 'ms', 'Tier IV: the time from the first slam to the second (the reel-back and the drive).', 'The jam (Tier IV)'],
  slamGapGrow: ['Spacing grows', '×', 'Tier IV: how much longer each next gap is (the anticipation building; 0 = even).', 'The jam (Tier IV)'],
  slamPullPx: ['Pull back', 'px', 'Tier IV: how far the hero reels back between slams (much further each time; the finisher 3.1x).', 'The jam (Tier IV)'],
  finisherWindMs: ['Finisher wind-up', 'ms', 'Tier IV: the big wind-up before the finisher.', 'The jam (Tier IV)'],
  finisherZoom: ['Finisher push-in', '×', 'Tier IV: how far the view pushes in over the finisher wind-up.', 'The jam (Tier IV)'],
  homeMs: ['Fly home', 'ms', 'Tier IV: the hero flying home after the finisher.', 'The jam (Tier IV)'],
  jamDepthStart: ['Sunk on landing', undefined, 'Tier IV: how much of the giant is already in the face when it lands (0..1).', 'The jam (Tier IV)'],
  jamDepthEnd: ['Sunk by the finisher', undefined, 'Tier IV: how much of it is driven in by the last slam (only the end sticks out).', 'The jam (Tier IV)'],
  burstStart: ['Juice burst from slam', undefined, 'Tier IV: the slam an extra burst of painted juice splats first sprays on (4 = slams 4, 5 and 6, more each time).', 'The jam (Tier IV)'],
  burstAmount: ['Juice burst amount', '×', 'Tier IV: how much juice each of those slams sprays (0 = none; slams 5 and 6 spray far more).', 'The jam (Tier IV)'],
  juiceDrips: ['Juice drips', '×', 'Tier IV: thick banana juice running down the struck portrait and dripping off it, more each slam, a gush on the burst (0 = none).', 'The jam (Tier IV)'],
  dripMs: ['Drip linger', 'ms', 'Tier IV: how long the juice drips run and linger before they fade.', 'The jam (Tier IV)'],
  ringSplats: ['Ring of splats', undefined, 'Tier IV: splats bursting in a ring round the finale.', 'Finale (Tier IV)'],
  showerBananas: ['Banana shower', undefined, 'Tier IV: painted bananas bursting up out of the finale and raining down.', 'Finale (Tier IV)'],
  shockSize: ['Shockwave', '×', "Tier IV: the golden shockwave's size.", 'Finale (Tier IV)'],
  goldRays: ['Gold rays', undefined, 'Tier IV: golden rays out of the finale.', 'Finale (Tier IV)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact and finale flashes are.', 'Finale (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxLaunchGain: ['launch: gain', undefined, "Oona's launch as each banana is flung (the giant lower).", 'Sound: launch'],
  sfxLaunchRate: ['launch: pitch', '×', 'Pitch of the launch.', 'Sound: launch'],
  sfxWhooshGain: ['whoosh: gain', undefined, "The giant's fling and the jam's dash.", 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxSplatGain: ['splat: gain', undefined, "Oona's splat on every hit (pitched up each tick).", 'Sound: splat'],
  sfxSplatRate: ['splat: pitch', '×', 'Pitch of the splat.', 'Sound: splat'],
  sfxPowerGain: ['power-up: gain', undefined, "Oona's power-up on THE impact (as her card plays it).", 'Sound: power-up'],
  sfxPowerRate: ['power-up: pitch', '×', 'Pitch of the power-up.', 'Sound: power-up'],
  sfxImpactGain: ['smack: gain', undefined, 'A smack under the impact, the landing and every slam.', 'Sound: smack'],
  sfxImpactRate: ['smack: pitch', '×', 'Pitch of the smack.', 'Sound: smack'],
  sfxChargeGain: ['charge: gain', undefined, 'The flourish, and Tier IV: the hero blazing gold.', 'Sound: charge'],
  sfxChargeRate: ['charge: pitch', '×', 'Pitch of the charge.', 'Sound: charge'],
  sfxGlintGain: ['glint: gain', undefined, 'Tier IV: the sparkle of the blaze and the crown glint.', 'Sound: glint'],
  sfxGlintRate: ['glint: pitch', '×', 'Pitch of the glint.', 'Sound: glint'],
  sfxDropGain: ['drop: gain', undefined, 'Tier IV: the whoosh of the giant dropping.', 'Sound: drop'],
  sfxDropRate: ['drop: pitch', '×', 'Pitch of the drop.', 'Sound: drop'],
  sfxSlamGain: ['finisher: gain', undefined, 'Tier IV: the crunch of the finisher.', 'Sound: finisher'],
  sfxSlamRate: ['finisher: pitch', '×', 'Pitch of the finisher.', 'Sound: finisher'],
  sfxBoomGain: ['pop: gain', undefined, 'Tier IV: the splat pops round the target after the finale.', 'Sound: pop'],
  sfxBoomRate: ['pop: pitch', '×', 'Pitch of the first pop.', 'Sound: pop'],
  sfxImpactLenMs: ['finisher length', 'ms', 'The finisher clip is cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<BananaTierSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Flourish', 'ms', 'The golden flourish on the hero before the first banana. The view pushes in over this.'],
  Shots: ['Bananas', undefined, 'How many bananas are flung (I one, II a double, III the barrage; IV the warm-ups before the giant).'],
  ShotStaggerMs: ['Fling rhythm', 'ms', 'Gap between each banana (the rhythm of the splats).'],
  FlightMs: ['Banana flight', 'ms', "A banana crossing the board (at 1600 px; Oona's card: 700)."],
  Arc: ['Arc', '×', 'How high the bananas are lobbed, as a fraction of the distance.'],
  Fan: ['Spread', '×', 'How far a barrage spreads its arcs apart.'],
  BananaSize: ['Banana size', '×', 'The banana size multiplier for this tier.'],
  Giant: ['Royal banana', undefined, 'After the warm-ups, the giant golden banana lands on the target and the hero jams it in.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the flourish (and the blaze).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Juice: ['Juice', undefined, 'Juice blobs in the impact (or the finale).'],
  Burst: ['Splat size', '×', 'Scale of the impact splat (Tier IV: of the finale splat).'],
  Splats: ['Layered splats', undefined, 'Splats layered on the impact (one big, the rest round it).'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroBananaStrKey>> = {
  'Sound: launch': 'sfxLaunchClip', 'Sound: whoosh': 'sfxWhooshClip', 'Sound: splat': 'sfxSplatClip', 'Sound: power-up': 'sfxPowerClip',
  'Sound: smack': 'sfxImpactClip', 'Sound: charge': 'sfxChargeClip', 'Sound: glint': 'sfxGlintClip', 'Sound: drop': 'sfxDropClip',
  'Sound: finisher': 'sfxSlamClip', 'Sound: pop': 'sfxBoomClip',
};

const COLORS: [HeroBananaStrKey, string, string][] = [
  ['colorJuice', 'Juice', "Oona's juice yellow: the juice bursts and trails."],
  ['colorAmber', 'Amber', 'The amber juice.'],
  ['colorCream', 'Cream', 'The pale juice and motes.'],
  ['colorGold', 'Gold', 'The gold: the flourish, the giant, sparkles, rings, rays and the shockwave.'],
  ['colorSpark', 'Launch spark', "The orange of Oona's launch sparks."],
  ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
  ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
];

type Ctl = TunerControl<Extract<keyof BananaTunerValues, string>>;

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
  const push = (key: HeroBananaNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_BANANA_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of BANANA_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroBananaNumKey;
      const [min, max, step] = HERO_BANANA_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Giant'
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

let live: HeroBananaHandle | null = null;

/** Play the real Banana Cannon between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroBananaOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroBananaHandle | null> {
  live?.cancel();
  const cfg = getHeroBananaConfig();
  return playAttackDemo(side, (o) => playHeroBanana(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: heroBananaPreviewSpeed(), reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBanana?: unknown }).__heroBanana = { demo, previewParts, setSpeed: setHeroBananaPreviewSpeed };
}

export const SPEC: TunerSpec<BananaTunerValues> = {
  id: 'herobanana',                  // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Banana Cannon',
  note: () => {
    const c = getHeroBananaConfig();
    const p = bananaPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    const shots = p.shots.filter((x) => !x.giant).length;
    return `dev · tier ${p.tier} · ${shots} banana${shots === 1 ? '' : 's'}${p.giant ? ` + the giant, ${p.slams.length} slams` : ''} · fling ${Math.round(p.fireAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroBananaConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroBananaValue(key as keyof HeroBananaConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroBananaValue(key as keyof HeroBananaConfig, value); },
  reset: () => { resetHeroBananaConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_BANANA_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroBananaConfigJson(),
  copyLabel: 'Copy JSON',
  actions: [
    { label: '▶ You fire', hint: 'Your hero flings bananas at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe fires', hint: 'The foe flings bananas at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero fires for 3: Tier I, one banana.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero fires for 8: Tier II, a double shot.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero fires for 12 from four numbers: Tier III, the barrage.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero fires for 40 from seven numbers: Tier IV, the giant golden banana and the jam.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe fires at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe fires at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe fires at your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe fires at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
  // Owner 2026-09-29: the Copy / Reset / Play row goes at the TOP of every attack tuner; no Speed or Reduced motion rows.
  buttonsTop: true,
};

export function HeroBananaTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
