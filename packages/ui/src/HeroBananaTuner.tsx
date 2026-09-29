import {
  BANANA_TIER_SUFFIXES, HERO_BANANA_DEFAULTS, HERO_BANANA_RANGES, HERO_BANANA_SPEEDS, TIERS, bananaPlan, getHeroBananaConfig,
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
  tier2At: ['Tier II from', undefined, 'Damage at which the cannon steps up to Tier II (a double shot). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which the cannon fires the rapid barrage. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which the cannon fires the giant golden banana. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Summon'],
  heroCoilPx: ['Brace', 'px', 'How far the hero leans back as the cannon appears.', 'Summon'],
  heroRecoilPx: ['Hero recoil', 'px', 'How far each shot shoves the hero back (the giant doubles it).', 'Summon'],
  cannonLength: ['Cannon size', 'px', 'How long the cannon is.', 'Cannon'],
  cannonPopMs: ['Cannon pop', 'ms', 'The cannon popping into being on the hero.', 'Cannon'],
  recoilPx: ['Cannon recoil', 'px', 'How far the cannon kicks back on each shot.', 'Cannon'],
  pumpLeadMs: ['Pump lead', 'ms', 'How long before a shot the cannon pumps (the "chk").', 'Cannon'],
  muzzlePuffs: ['Muzzle smoke', undefined, 'Smoke puffs in each muzzle blast (the giant nearly doubles it).', 'Cannon'],
  leaves: ['Muzzle leaves', undefined, 'Jungle leaves blown out of each shot.', 'Cannon'],
  stowMs: ['Stow after', 'ms', 'How long after its last shot the cannon pops away.', 'Cannon'],
  bananaLength: ['Banana size', 'px', 'How long each banana is (the tier size multiplies it).', 'Bananas'],
  spinTurns: ['Tumble', '×', 'How many turns a banana tumbles through in flight.', 'Bananas'],
  trailAlpha: ['Motion streak', 'opacity', 'The streak behind each flying banana (0 = none).', 'Bananas'],
  tickChunks: ['Tick chunks', undefined, 'Banana chunks thrown off each banana before the last.', 'Splat'],
  starSize: ['Comic star', '×', 'The size of the comic impact stars.', 'Splat'],
  peelHoldMs: ['Peel hold', 'ms', 'How long a stuck peel hangs on the face before it slides off.', 'Splat'],
  gravity: ['Chunk gravity', undefined, 'px/s². How hard the chunks and the shower fall.', 'Splat'],
  giantChargeMs: ['Royal charge', 'ms', 'Tier IV: the cannon glowing gold, swelling and its crown glinting before the giant shot.', 'Royal shot (Tier IV)'],
  giantFlightMs: ['Giant flight', 'ms', 'Tier IV: the giant golden banana\'s flight (at 1600 px).', 'Royal shot (Tier IV)'],
  giantSize: ['Giant size', '×', 'Tier IV: how much bigger the golden banana is.', 'Royal shot (Tier IV)'],
  giantLift: ['Giant arc', '×', 'Tier IV: how high the giant is lobbed, as a fraction of the distance.', 'Royal shot (Tier IV)'],
  giantOvershoot: ['Leaves the frame by', 'px', 'Tier IV: how far past the top of the screen the giant may climb before it comes back down.', 'Royal shot (Tier IV)'],
  showerBananas: ['Banana shower', undefined, 'Tier IV: whole bananas bursting out of the slam.', 'Royal shot (Tier IV)'],
  shockSize: ['Shockwave', '×', 'Tier IV: the golden shockwave\'s size.', 'Royal shot (Tier IV)'],
  goldRays: ['Gold rays', undefined, 'Tier IV: golden rays out of the slam.', 'Royal shot (Tier IV)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact and slam flashes are.', 'Royal shot (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxSummonGain: ['summon: gain', undefined, 'The clunk as the cannon appears.', 'Sound: summon'],
  sfxSummonRate: ['summon: pitch', '×', 'Pitch of the clunk.', 'Sound: summon'],
  sfxSparkleGain: ['sparkle: gain', undefined, 'A sparkle as the cannon appears (and on the royal charge).', 'Sound: sparkle'],
  sfxSparkleRate: ['sparkle: pitch', '×', 'Pitch of the sparkle.', 'Sound: sparkle'],
  sfxPumpGain: ['pump: gain', undefined, 'The "chk" as the cannon pumps before each shot.', 'Sound: pump'],
  sfxPumpRate: ['pump: pitch', '×', 'Pitch of the first pump (climbs per shot).', 'Sound: pump'],
  sfxFireGain: ['fire: gain', undefined, 'The launch of each banana.', 'Sound: fire'],
  sfxFireRate: ['fire: pitch', '×', 'Pitch of the launch (the giant plays it lower).', 'Sound: fire'],
  sfxBoomGain: ['boom: gain', undefined, 'The muzzle boom under each launch (and under the slam).', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The whoosh of a banana in flight.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxSplatGain: ['splat: gain', undefined, 'The wet splat of each banana.', 'Sound: splat'],
  sfxSplatRate: ['splat: pitch', '×', 'Pitch of the first splat (climbs per tick).', 'Sound: splat'],
  sfxSmackGain: ['smack: gain', undefined, 'A smack under each splat.', 'Sound: smack'],
  sfxSmackRate: ['smack: pitch', '×', 'Pitch of the smack.', 'Sound: smack'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the crack on the last banana (and on the slam).', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxPowerGain: ['power: gain', undefined, 'Tier IV: the power-up as the cannon charges the royal shot.', 'Sound: power'],
  sfxPowerRate: ['power: pitch', '×', 'Pitch of the power-up.', 'Sound: power'],
  sfxMarkGain: ['descent: gain', undefined, 'Tier IV: the whoosh of the giant coming back down.', 'Sound: descent'],
  sfxMarkRate: ['descent: pitch', '×', 'Pitch of the descent.', 'Sound: descent'],
  sfxSlamGain: ['slam: gain', undefined, 'Tier IV: the giant golden banana slamming down.', 'Sound: slam'],
  sfxSlamRate: ['slam: pitch', '×', 'Pitch of the slam.', 'Sound: slam'],
  sfxPopGain: ['pop: gain', undefined, 'Tier IV: the banana pops round the target after the slam.', 'Sound: pop'],
  sfxPopRate: ['pop: pitch', '×', 'Pitch of the first pop.', 'Sound: pop'],
  sfxStowGain: ['stow: gain', undefined, 'The cannon popping away.', 'Sound: stow'],
  sfxStowRate: ['stow: pitch', '×', 'Pitch of the stow.', 'Sound: stow'],
  sfxFireLenMs: ['fire length', 'ms', 'Each launch clip is cut to this long (with a fade).', 'Sound: mix'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact and slam clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the cannon plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<BananaTierSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Summon', 'ms', 'The cannon appearing and aiming before the first shot. The view pushes in over this.'],
  Shots: ['Bananas', undefined, 'How many bananas are fired (I one, II a double, III the barrage; IV the warm-up before the giant).'],
  ShotStaggerMs: ['Fire rhythm', 'ms', 'Gap between each shot (the rhythm of the pumps and splats).'],
  FlightMs: ['Banana flight', 'ms', 'A banana crossing the board (at 1600 px; lower = faster; scales gently with distance).'],
  Arc: ['Arc', '×', 'How high the bananas are lobbed, as a fraction of the distance.'],
  Fan: ['Spread', '×', 'How far a barrage spreads its arcs apart.'],
  BananaSize: ['Banana size', '×', 'The banana size multiplier for this tier.'],
  Giant: ['Giant golden banana', undefined, 'After the warm-up, the cannon charges and fires a giant golden banana that slams down.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the summon (and the royal charge).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Chunks: ['Chunks', undefined, 'Banana chunks thrown by the impact (or the slam).'],
  Burst: ['Splat size', '×', 'Scale of the impact splat, flash and glow.'],
  Peels: ['Peels', undefined, 'Peels the impact scatters over the struck face.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroBananaStrKey>> = {
  'Sound: summon': 'sfxSummonClip', 'Sound: sparkle': 'sfxSparkleClip', 'Sound: pump': 'sfxPumpClip', 'Sound: fire': 'sfxFireClip',
  'Sound: boom': 'sfxBoomClip', 'Sound: whoosh': 'sfxWhooshClip', 'Sound: splat': 'sfxSplatClip', 'Sound: smack': 'sfxSmackClip',
  'Sound: impact': 'sfxImpactClip', 'Sound: power': 'sfxPowerClip', 'Sound: descent': 'sfxMarkClip', 'Sound: slam': 'sfxSlamClip',
  'Sound: pop': 'sfxPopClip', 'Sound: stow': 'sfxStowClip',
};

const COLORS: [HeroBananaStrKey, string, string][] = [
  ['colorBanana', 'Banana', 'The banana yellow: bananas, peels, stars and rings.'],
  ['colorGold', 'Gold', 'The royal gold: the cannon trim and crown, the giant banana, sparkles, rays and the shockwave.'],
  ['colorBarrel', 'Barrel', 'The cannon\'s jungle-green barrel.'],
  ['colorDark', 'Dark', 'The dark brown: the cannon grips and bore, star outlines and the shadow under the giant.'],
  ['colorCream', 'Cream', 'The banana flesh: chunks, mush and the splat mist.'],
  ['colorSmoke', 'Smoke', 'The muzzle smoke.'],
  ['colorLeaf', 'Leaves', 'The jungle leaves blown out of the muzzle.'],
  ['colorPlayer', 'Your side', 'Your total colour when YOU fire.'],
  ['colorFoe', 'Foe side', 'Their total colour when THEY fire.'],
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
    return `dev · ${heroBananaPreviewSpeed()}x · tier ${p.tier} · ${shots} banana${shots === 1 ? '' : 's'}${p.giant ? ' + the giant' : ''} · fire ${Math.round(p.fireAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
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
    { label: '▶ You fire', hint: 'Your hero fires the banana cannon at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe fires', hint: 'The foe fires the banana cannon at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero fires for 3: Tier I, one banana.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero fires for 8: Tier II, a double shot.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero fires for 12 from four numbers: Tier III, the rapid barrage.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero fires for 40 from seven numbers: Tier IV, the giant golden banana.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe fires at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe fires at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe fires at your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe fires at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
    { label: '▶ Reduced motion', hint: 'What a player with reduced motion on sees: fades, no cannon, bananas, shake or zoom.', run: () => { void demo('player', { reduced: true }); } },
    ...HERO_BANANA_SPEEDS.map((s) => ({
      label: `Speed ${s}x`,
      hint: 'Slow motion for the next plays (the tuner only; never saved, never in production).',
      run: () => { setHeroBananaPreviewSpeed(s); },
    })),
  ],
};

export function HeroBananaTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
