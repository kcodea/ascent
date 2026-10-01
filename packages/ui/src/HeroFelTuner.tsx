import {
  FEL_TIER_SUFFIXES, HERO_FEL_DEFAULTS, HERO_FEL_RANGES, TIERS, felPlan, getHeroFelConfig,
  heroFelConfigJson, resetHeroFelConfig, setHeroFelValue,
  type FelTierSuffix, type HeroFelConfig, type HeroFelNumKey, type HeroFelStrKey, type TierNum,
} from './heroFel/heroFelConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroFel, type HeroFelHandle, type HeroFelOptions } from './heroFel/heroFel';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the FEL hero attack (owner ask 2026-09-30: "a brand new attack animation that is on par with
 * hearthstone/modern world of warcraft", theme fel / chaos bolt). The Play buttons run the REAL runner between the two
 * real hero portraits (works from the shop), in either direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40; the
 * Play row sits at the TOP of the panel and there are no speed or reduced-motion buttons (owner 2026-09-29, every attack
 * tuner). A preview never touches the run. Production plays the baked defaults.
 */
type FelTunerValues = HeroFelConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroFelNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which Fel steps up to Tier II (two bolts). Shared with every hero attack (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which Fel adds the great bolt that sets the target burning. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which Fel calls the rune circle and the chaos meteor. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Gather'],
  heroSwell: ['Hero swell', '×', 'How much the hero swells as the power gathers.', 'Gather'],
  recoilPx: ['Recoil', 'px', 'How far the hero kicks back as each bolt is released.', 'Gather'],
  growMs: ['Swell time', 'ms', 'How long a bolt takes to swell out of its sigil.', 'Gather'],
  formRadius: ['Form distance', '×', 'How far from the hero the bolts form, in portrait radii (clear of the face).', 'Gather'],
  formSpread: ['Form spread', '°', 'How widely the bolts fan round the hero as they form.', 'Gather'],
  kindle: ['Hero flames', '×', 'How much fel fire catches round the hero’s rim while it gathers.', 'Gather'],
  sigilSize: ['Sigil size', '×', 'The spinning fel sigil each bolt forms in (0 = none).', 'Gather'],
  motes: ['Motes', '×', 'How many motes stream into each sigil and into the rune circle.', 'Gather'],
  boltRadius: ['Bolt size', 'px', 'Radius of a bolt at size 1 (the tier size multiplies it).', 'Bolts'],
  boltFlame: ['Bolt flame', '×', 'How much fel fire licks off each bolt.', 'Bolts'],
  boltGlow: ['Bolt light', '×', 'The green light round each bolt (0 = none).', 'Bolts'],
  shell: ['Dark shell', '×', 'The dark crackling shell round each bolt’s bright heart, and the dark ring it shatters into.', 'Bolts'],
  crackle: ['Crackle', '×', 'How often chaos lightning crackles round the shells (and how many fly off an impact).', 'Bolts'],
  windupMs: ['Wind-up', 'ms', 'The draw back just before a bolt snaps away.', 'Bolts'],
  windupPx: ['Wind-up distance', 'px', 'How far it is drawn back.', 'Bolts'],
  trail: ['Trail', '×', 'How dense the tail of fel fire behind each bolt (and the meteor) is.', 'Bolts'],
  trailSmoke: ['Trail smoke', '×', 'How much dark smoke the tails leave.', 'Bolts'],
  turbulence: ['Turbulence', '×', 'How much every flame sways and curls as it rises.', 'Live fel fire'],
  buoyancy: ['Buoyancy', '×', 'How hard every flame rises.', 'Live fel fire'],
  smoke: ['Smoke', '×', 'How much dark smoke the fire leaves as it dies.', 'Live fel fire'],
  embers: ['Embers', '×', 'How many embers break off and flutter up.', 'Live fel fire'],
  impactSize: ['Impact size', '×', 'Scale of every bolt impact (the flash, the shell ring, the fire).', 'Impacts and burn'],
  shards: ['Shards', '×', 'How many shards fly off each impact and the eruption.', 'Impacts and burn'],
  burnSize: ['Burn size', '×', 'How big the fel fire burning on the struck portrait’s rim is.', 'Impacts and burn'],
  gateMs: ['Circle open', 'ms', 'Tier IV: the rune circle open over the target before the meteor falls.', 'The Hand (Tier IV)'],
  gateSize: ['Circle size', '×', 'Tier IV: the rune circle’s radius, in portrait radii.', 'The Hand (Tier IV)'],
  meteorMs: ['Meteor fall', 'ms', 'Tier IV: the chaos meteor falling into the circle (at 1600 px; scales gently with distance).', 'The Hand (Tier IV)'],
  meteorSize: ['Meteor size', '×', 'Tier IV: the meteor, in portrait radii.', 'The Hand (Tier IV)'],
  eruptMs: ['Pillar', 'ms', 'Tier IV: how long the pillar of fel fire roars at full.', 'The Hand (Tier IV)'],
  eruptHeight: ['Pillar height', '×', 'Tier IV: how tall the pillar of fel fire and light towers.', 'The Hand (Tier IV)'],
  burnoutMs: ['Burn out', 'ms', 'Tier IV: how long the pillar takes to die down to embers and smoke.', 'The Hand (Tier IV)'],
  ash: ['Ash', '×', 'Tier IV: the ash drifting down after the eruption.', 'The Hand (Tier IV)'],
  scorch: ['Scorch', '×', 'Tier IV: the burnt ground left round the struck hero.', 'The Hand (Tier IV)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact and eruption flashes are.', 'The Hand (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxGatherGain: ['gather: gain', undefined, 'The dark draw of power as the hero gathers.', 'Sound: gather'],
  sfxGatherRate: ['gather: pitch', '×', 'Pitch of the gather.', 'Sound: gather'],
  sfxFormGain: ['bolt forms: gain', undefined, 'A rising charge as each bolt swells (the great bolt louder and lower).', 'Sound: bolt forms'],
  sfxFormRate: ['bolt forms: pitch', '×', 'Pitch of the first.', 'Sound: bolt forms'],
  sfxLaunchGain: ['release: gain', undefined, 'The fel spike of each bolt released (each a step higher).', 'Sound: release'],
  sfxLaunchRate: ['release: pitch', '×', 'Pitch of the first release.', 'Sound: release'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The whoosh under each release.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxHitGain: ['tick: gain', undefined, 'Each bolt that lands before the last (pitch climbs).', 'Sound: tick'],
  sfxHitRate: ['tick: pitch', '×', 'Pitch of the first tick.', 'Sound: tick'],
  sfxBlastGain: ['blast: gain', undefined, 'THE impact: the burst of the last bolt (and under the eruption).', 'Sound: blast'],
  sfxBlastRate: ['blast: pitch', '×', 'Pitch of the blast.', 'Sound: blast'],
  sfxImpactGain: ['impact: gain', undefined, 'The fel hit layered on the blast.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxThumpGain: ['thump: gain', undefined, 'A low punch under the impact.', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxBigGain: ['big hit: gain', undefined, 'Tiers III and IV: an extra crack layered on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxGateGain: ['circle: gain', undefined, 'Tier IV: the rune circle opening over the target.', 'Sound: circle'],
  sfxGateRate: ['circle: pitch', '×', 'Pitch of the circle.', 'Sound: circle'],
  sfxMeteorGain: ['meteor: gain', undefined, 'Tier IV: the falling meteor (placed so its hit lands on the eruption).', 'Sound: meteor'],
  sfxMeteorRate: ['meteor: pitch', '×', 'Pitch of the fall.', 'Sound: meteor'],
  sfxEruptGain: ['eruption: gain', undefined, 'Tier IV: the ground-shaking boom of the eruption.', 'Sound: eruption'],
  sfxEruptRate: ['eruption: pitch', '×', 'Pitch of the eruption.', 'Sound: eruption'],
  sfxShatterGain: ['circle breaks: gain', undefined, 'Tier IV: the rune circle shattering on the eruption.', 'Sound: circle breaks'],
  sfxShatterRate: ['circle breaks: pitch', '×', 'Pitch of the break.', 'Sound: circle breaks'],
  sfxBoomGain: ['aftershock: gain', undefined, 'Tier IV: the bursts after the eruption.', 'Sound: aftershock'],
  sfxBoomRate: ['aftershock: pitch', '×', 'Pitch of the first aftershock.', 'Sound: aftershock'],
  sfxRoarGain: ['roar: gain', undefined, 'Tier IV: the synth roar building from the circle to the eruption.', 'Sound: roar'],
  sfxRoarLowHz: ['roar: low', undefined, 'Hz. The roar’s floor.', 'Sound: roar'],
  sfxRoarHighHz: ['roar: open', undefined, 'Hz. How bright the roar opens up at the eruption.', 'Sound: roar'],
  sfxCrackleGain: ['crackle: gain', undefined, 'The synth fire crackle while the hero gathers and the target burns.', 'Sound: crackle'],
  sfxImpactLenMs: ['impact length', 'ms', 'The blast and eruption clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while Fel plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<FelTierSuffix, [string, TunerUnit | undefined, string]> = {
  FormMs: ['Gather', 'ms', 'The bolts forming before the first one is released. The view pushes in over this.'],
  Bolts: ['Bolts', undefined, 'How many bolts fly (I one, II two, III two and the great bolt, IV two before the Hand).'],
  StaggerMs: ['Stagger', 'ms', 'Gap between each bolt leaving.'],
  FlightMs: ['Flight', 'ms', 'A bolt crossing the board (at 1600 px; scales gently with distance).'],
  BoltSize: ['Bolt size', '×', 'Size of the bolts.'],
  GreatBolt: ['Last bolt size', '×', 'Size of the last bolt; above 1.2 with three or more bolts it is the GREAT bolt (swells while the others fly, flares the target).'],
  Arc: ['Arc', '×', 'How far each flight bows off the straight line.'],
  Hand: ['The Hand', undefined, 'After the bolts, a rune circle opens over the target and a chaos meteor falls into it and erupts (the blow lands on the eruption).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in while the bolts gather (and the meteor falls).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Burst: ['Burst size', '×', 'Scale of the eruption flash (Tier IV).'],
  Burn: ['Burn', '×', 'How hard fel fire burns on the struck portrait’s rim after the impact (0 = not at all).'],
  BurnMs: ['Burn time', 'ms', 'How long it burns before dying down to smoke.'],
  Embers: ['Embers', undefined, 'Embers thrown by the impact.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroFelStrKey>> = {
  'Sound: gather': 'sfxGatherClip', 'Sound: bolt forms': 'sfxFormClip', 'Sound: release': 'sfxLaunchClip', 'Sound: whoosh': 'sfxWhooshClip',
  'Sound: tick': 'sfxHitClip', 'Sound: blast': 'sfxBlastClip', 'Sound: impact': 'sfxImpactClip', 'Sound: thump': 'sfxThumpClip',
  'Sound: big hit': 'sfxBigClip', 'Sound: circle': 'sfxGateClip', 'Sound: meteor': 'sfxMeteorClip', 'Sound: eruption': 'sfxEruptClip',
  'Sound: circle breaks': 'sfxShatterClip', 'Sound: aftershock': 'sfxBoomClip',
};

const COLORS: [HeroFelStrKey, string, string][] = [
  ['colorPlayer', 'Your fel', 'The total and the damage number colour when YOU strike.'],
  ['colorFoe', 'Foe fel', 'The total and the damage number colour when THEY strike.'],
  ['colorCore', 'White-hot', 'The white-green heart of every bolt, flame and flash.'],
  ['colorHot', 'Hot', 'The hot yellow-green a flame cools through first; crackles and shards.'],
  ['colorFel', 'Fel', 'The fel green: the body of the fire, its light and the rims.'],
  ['colorDeep', 'Deep', 'The deep green the flames cool to at their tips.'],
  ['colorEmber', 'Ember', 'The dark green a dying flame ends on.'],
  ['colorSmoke', 'Smoke', 'The dark smoke the fire leaves, and the ash.'],
  ['colorShell', 'Shell', 'The dark shell round each bolt, the ring it shatters into, and the ground under the circle.'],
  ['colorRune', 'Runes', 'The sigils and the rune circle.'],
];

type Ctl = TunerControl<Extract<keyof FelTunerValues, string>>;

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
  const push = (key: HeroFelNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_FEL_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of FEL_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroFelNumKey;
      const [min, max, step] = HERO_FEL_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Hand'
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

let live: HeroFelHandle | null = null;

/** Play the real Fel attack between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroFelOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroFelHandle | null> {
  live?.cancel();
  const cfg = getHeroFelConfig();
  return playAttackDemo(side, (o) => playHeroFel(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroFel?: unknown }).__heroFel = { demo, previewParts };
}

export const SPEC: TunerSpec<FelTunerValues> = {
  id: 'herofel',                     // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Fel',
  note: () => {
    const c = getHeroFelConfig();
    const p = felPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    const what = `${p.bolts.length} bolt${p.bolts.length === 1 ? '' : 's'}${p.bolts.some((b) => b.great) ? ' (great bolt)' : ''}${p.hand ? ' + the Hand' : ''}`;
    return `dev · tier ${p.tier} · ${what} · fire ${Math.round(p.fireAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroFelConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroFelValue(key as keyof HeroFelConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroFelValue(key as keyof HeroFelConfig, value); },
  reset: () => { resetHeroFelConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_FEL_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroFelConfigJson(),
  copyLabel: 'Copy JSON',
  // Owner 2026-09-29 (every attack tuner): the Play row on TOP; no speed or reduced-motion buttons.
  buttonsOnTop: true,
  actions: [
    { label: '▶ You cast', hint: 'Your hero casts Fel at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe casts', hint: 'The foe casts Fel at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero casts for 3: Tier I, one chaos bolt.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero casts for 8: Tier II, two chaos bolts.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero casts for 12 from four numbers: Tier III, two bolts then the great bolt that leaves the target burning.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero casts for 40 from seven numbers: Tier IV, two bolts then the Hand: the rune circle, the chaos meteor and the eruption.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe casts at your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe casts at your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe casts at your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe casts at your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroFelTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
