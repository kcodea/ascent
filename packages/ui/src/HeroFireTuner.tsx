import {
  FIRE_TIER_SUFFIXES, HERO_FIRE_DEFAULTS, HERO_FIRE_RANGES, TIERS, firePlan, getHeroFireConfig,
  heroFireConfigJson, resetHeroFireConfig, setHeroFireValue,
  type FireTierSuffix, type HeroFireConfig, type HeroFireNumKey, type HeroFireStrKey, type TierNum,
} from './heroFire/heroFireConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroFire, type HeroFireHandle, type HeroFireOptions } from './heroFire/heroFire';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the FIRE hero attack (owner ask 2026-09-29: "we need a fire animation ... it should look like live
 * flame/fires pixi sprites"). The Play buttons run the REAL runner between the two real hero portraits (works from the
 * shop), in either direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40; the Play row sits at the TOP of the panel
 * and there are no speed or reduced-motion buttons (owner 2026-09-29, every attack tuner). A preview never touches the run. The "Attack style" row is the same dev override as the other attack tuners' (Auto =
 * what a player would see). Production plays the baked defaults.
 */
type FireTunerValues = HeroFireConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroFireNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which Fire steps up to Tier II (two fireballs). Shared with every hero attack (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which Fire becomes the volley of five that sets the target ablaze. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which Fire adds the meteor. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Kindle'],
  heroSwell: ['Hero swell', '×', 'How much the hero swells as the fire gathers.', 'Kindle'],
  recoilPx: ['Recoil', 'px', 'How far the hero kicks back as each fireball leaves.', 'Kindle'],
  growMs: ['Ignite time', 'ms', 'How long a fireball takes to swell out of a spark.', 'Kindle'],
  formRadius: ['Form distance', '×', 'How far from the hero the fireballs ignite, in portrait radii (round the rim, clear of the face).', 'Kindle'],
  formSpread: ['Form spread', '°', 'How widely a volley fans round the hero as it ignites (the angle it spans).', 'Kindle'],
  kindle: ['Kindling', '×', 'How much fire catches round the hero’s rim while the fireballs ignite.', 'Kindle'],
  ballRadius: ['Fireball size', 'px', 'Radius of a fireball at size 1 (the tier size multiplies it).', 'Fireballs'],
  ballFlame: ['Fireball flame', '×', 'How many flame particles roil off each fireball.', 'Fireballs'],
  ballGlow: ['Fireball light', '×', 'The orange light round each fireball (0 = none).', 'Fireballs'],
  pullMs: ['Draw back', 'ms', 'The small pull back just before a fireball is hurled.', 'Fireballs'],
  pullBackPx: ['Draw back distance', 'px', 'How far it pulls back.', 'Fireballs'],
  trail: ['Comet tail', '×', 'How dense the tail of flame streaming behind each fireball (and the meteor) is.', 'Fireballs'],
  trailSmoke: ['Tail smoke', '×', 'How much smoke the tails leave behind.', 'Fireballs'],
  turbulence: ['Turbulence', '×', 'How much every flame sways and curls as it rises.', 'Live fire'],
  buoyancy: ['Buoyancy', '×', 'How hard every flame rises (fire is hot gas).', 'Live fire'],
  smoke: ['Smoke', '×', 'How much smoke the fire leaves as it dies.', 'Live fire'],
  embers: ['Embers', '×', 'How many embers break off and flutter up.', 'Live fire'],
  explodeSize: ['Burst size', '×', 'Scale of every fireball burst (the flash, the fire ball, the ring).', 'Bursts and blaze'],
  blazeSize: ['Blaze size', '×', 'How big the fire burning on the struck portrait’s rim is (II briefly, III ablaze).', 'Bursts and blaze'],
  summonMs: ['Summon', 'ms', 'Tier IV: the column of fire hurled into the sky before the meteor falls.', 'Meteor (Tier IV)'],
  meteorMs: ['Meteor fall', 'ms', 'Tier IV: the meteor falling onto the target (at 1600 px; scales gently with distance).', 'Meteor (Tier IV)'],
  meteorSize: ['Meteor size', '×', 'Tier IV: the meteor, in portrait radii.', 'Meteor (Tier IV)'],
  novaSize: ['Nova reach', '×', 'Tier IV: how far the fire nova races out from the detonation, in portrait radii.', 'Meteor (Tier IV)'],
  novaMs: ['Nova time', 'ms', 'Tier IV: how long the fire nova races outward.', 'Meteor (Tier IV)'],
  engulfMs: ['Engulf', 'ms', 'Tier IV: how long the pillar of fire engulfs the struck hero at full blaze.', 'Meteor (Tier IV)'],
  burnoutMs: ['Burn out', 'ms', 'Tier IV: how long the engulfing fire takes to die down to embers and smoke.', 'Meteor (Tier IV)'],
  scorch: ['Scorch', '×', 'Tier IV: the burnt ground left round the struck hero.', 'Meteor (Tier IV)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the burst and detonation flashes are.', 'Meteor (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxIgniteGain: ['ignite: gain', undefined, 'The whoomp of fire catching as the hero kindles.', 'Sound: ignite'],
  sfxIgniteRate: ['ignite: pitch', '×', 'Pitch of the ignite.', 'Sound: ignite'],
  sfxFormGain: ['fireball: gain', undefined, 'A rising charge as each fireball ignites (each a little higher).', 'Sound: fireball'],
  sfxFormRate: ['fireball: pitch', '×', 'Pitch of the first.', 'Sound: fireball'],
  sfxLaunchGain: ['hurl: gain', undefined, 'The heavy whoosh of each fireball leaving (each a little higher).', 'Sound: hurl'],
  sfxLaunchRate: ['hurl: pitch', '×', 'Pitch of the first hurl.', 'Sound: hurl'],
  sfxTrailGain: ['flame roar: gain', undefined, 'The roar of flame riding the first fireball.', 'Sound: flame roar'],
  sfxTrailRate: ['flame roar: pitch', '×', 'Pitch of the roar.', 'Sound: flame roar'],
  sfxHitGain: ['tick burst: gain', undefined, 'The crackling burst of each volley fireball (pitch climbs).', 'Sound: tick burst'],
  sfxHitRate: ['tick burst: pitch', '×', 'Pitch of the first burst.', 'Sound: tick burst'],
  sfxBlastGain: ['blast: gain', undefined, 'THE impact: the explosion of the last fireball (and under the detonation).', 'Sound: blast'],
  sfxBlastRate: ['blast: pitch', '×', 'Pitch of the blast.', 'Sound: blast'],
  sfxImpactGain: ['impact: gain', undefined, 'The hit layered under the blast.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxThumpGain: ['thump: gain', undefined, 'A low punch under the impact (punchy, not boomy).', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxBigGain: ['big hit: gain', undefined, 'Tiers III and IV: an extra crack layered on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxSummonGain: ['summon: gain', undefined, 'Tier IV: the roar of the column of fire going up.', 'Sound: summon'],
  sfxSummonRate: ['summon: pitch', '×', 'Pitch of the summon.', 'Sound: summon'],
  sfxMeteorGain: ['meteor: gain', undefined, 'Tier IV: the falling meteor (placed so its hit lands on the detonation).', 'Sound: meteor'],
  sfxMeteorRate: ['meteor: pitch', '×', 'Pitch of the fall.', 'Sound: meteor'],
  sfxDetonateGain: ['detonate: gain', undefined, 'Tier IV: the ground-shaking boom of the detonation.', 'Sound: detonate'],
  sfxDetonateRate: ['detonate: pitch', '×', 'Pitch of the detonation.', 'Sound: detonate'],
  sfxBoomGain: ['aftershock: gain', undefined, 'Tier IV: the fire bursts after the detonation.', 'Sound: aftershock'],
  sfxBoomRate: ['aftershock: pitch', '×', 'Pitch of the first aftershock.', 'Sound: aftershock'],
  sfxRoarGain: ['fire roar: gain', undefined, 'Tier IV: the synth roar building from the summon to the detonation.', 'Sound: fire roar'],
  sfxRoarLowHz: ['fire roar: low', undefined, 'Hz. The roar’s floor (nothing muddier than this).', 'Sound: fire roar'],
  sfxRoarHighHz: ['fire roar: open', undefined, 'Hz. How bright the roar opens up at the detonation.', 'Sound: fire roar'],
  sfxCrackleGain: ['crackle: gain', undefined, 'The synth fire crackle while the hero kindles, the target burns and the fire dies down.', 'Sound: crackle'],
  sfxLaunchLenMs: ['hurl length', 'ms', 'Each hurl whoosh is cut to this long (with a fade).', 'Sound: mix'],
  sfxImpactLenMs: ['impact length', 'ms', 'The blast and detonation clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while Fire plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<FireTierSuffix, [string, TunerUnit | undefined, string]> = {
  FormMs: ['Kindle', 'ms', 'The fireballs igniting before the first one is hurled. The view pushes in over this.'],
  Balls: ['Fireballs', undefined, 'How many fireballs ignite and fly (I one, II two, III the volley of five, IV three before the meteor).'],
  LaunchStaggerMs: ['Launch stagger', 'ms', 'Gap between each fireball leaving (the volley rhythm).'],
  FlightMs: ['Flight', 'ms', 'A fireball crossing the board (at 1600 px; scales gently with distance).'],
  BallSize: ['Fireball size', '×', 'Size of the fireballs (the last of a volley is a little bigger).'],
  Arc: ['Arc', '×', 'How far each flight bows off the straight line.'],
  Meteor: ['Meteor', undefined, 'After the fireballs, a column of fire goes up and a meteor falls on the target, detonates into a fire nova and engulfs it (the blow lands on the detonation).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in while the fire gathers (and the meteor falls).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Burst: ['Burst size', '×', 'Scale of the impact flash (Tier IV: the detonation).'],
  Blaze: ['Blaze', '×', 'How hard the struck portrait’s rim burns after the impact (0 = not at all).'],
  BlazeMs: ['Blaze time', 'ms', 'How long it burns before dying down to smoke.'],
  Embers: ['Embers', undefined, 'Embers thrown by the impact.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroFireStrKey>> = {
  'Sound: ignite': 'sfxIgniteClip', 'Sound: fireball': 'sfxFormClip', 'Sound: hurl': 'sfxLaunchClip', 'Sound: flame roar': 'sfxTrailClip',
  'Sound: tick burst': 'sfxHitClip', 'Sound: blast': 'sfxBlastClip', 'Sound: impact': 'sfxImpactClip', 'Sound: thump': 'sfxThumpClip',
  'Sound: big hit': 'sfxBigClip', 'Sound: summon': 'sfxSummonClip', 'Sound: meteor': 'sfxMeteorClip', 'Sound: detonate': 'sfxDetonateClip',
  'Sound: aftershock': 'sfxBoomClip',
};

const COLORS: [HeroFireStrKey, string, string][] = [
  ['colorPlayer', 'Your fire', 'The total and the damage number colour when YOU strike.'],
  ['colorFoe', 'Foe fire', 'The total and the damage number colour when THEY strike.'],
  ['colorCore', 'White-hot', 'The white-hot heart of every flame, the fireball hearts and the flashes.'],
  ['colorHot', 'Yellow', 'The hot yellow a flame cools through first.'],
  ['colorFlame', 'Orange', 'The body of the fire, its light and the rings.'],
  ['colorDeep', 'Red', 'The red the flames cool to at their tips.'],
  ['colorEmber', 'Ember', 'The dark ember red a dying flame ends on.'],
  ['colorSmoke', 'Smoke', 'The smoke the fire leaves, and the scorch.'],
];

type Ctl = TunerControl<Extract<keyof FireTunerValues, string>>;

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
  const push = (key: HeroFireNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_FIRE_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of FIRE_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroFireNumKey;
      const [min, max, step] = HERO_FIRE_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Meteor'
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

let live: HeroFireHandle | null = null;

/** Play the real Fire between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroFireOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroFireHandle | null> {
  live?.cancel();
  const cfg = getHeroFireConfig();
  return playAttackDemo(side, (o) => playHeroFire(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroFire?: unknown }).__heroFire = { demo, previewParts };
}

export const SPEC: TunerSpec<FireTunerValues> = {
  id: 'herofire',                    // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Fire',
  note: () => {
    const c = getHeroFireConfig();
    const p = firePlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    const what = `${p.balls.length} fireball${p.balls.length === 1 ? '' : 's'}${p.meteor ? ' + meteor' : ''}`;
    return `dev · tier ${p.tier} · ${what} · fire ${Math.round(p.fireAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroFireConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroFireValue(key as keyof HeroFireConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroFireValue(key as keyof HeroFireConfig, value); },
  reset: () => { resetHeroFireConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_FIRE_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroFireConfigJson(),
  copyLabel: 'Copy JSON',
  // Owner 2026-09-29 (every attack tuner): the Play row on TOP; no speed or reduced-motion buttons.
  buttonsOnTop: true,
  actions: [
    { label: '▶ You cast', hint: 'Your hero casts Fire at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe casts', hint: 'The foe casts Fire at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero casts for 3: Tier I, one fireball.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero casts for 8: Tier II, two fireballs.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero casts for 12 from four numbers: Tier III, the volley of five that sets the target ablaze.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero casts for 40 from seven numbers: Tier IV, fireballs then the meteor.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe casts at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe casts at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe casts at your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe casts at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroFireTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
