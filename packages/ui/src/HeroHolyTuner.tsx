import {
  HERO_HOLY_DEFAULTS, HERO_HOLY_RANGES, HOLY_TIER_SUFFIXES, TIERS, getHeroHolyConfig, heroHolyConfigJson,
  holyPlan, resetHeroHolyConfig, setHeroHolyValue,
  type HeroHolyConfig, type HeroHolyNumKey, type HeroHolyStrKey, type HolyTierSuffix, type TierNum,
} from './heroHoly/heroHolyConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroHoly, type HeroHolyHandle, type HeroHolyOptions } from './heroHoly/heroHoly';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the HOLY hero attack, the Consecration cosmetic (owner ask 2026-09-28: "branch off and create a holy
 * weapon + consecration attack"). The Play buttons run the REAL runner between the two real hero portraits (works from
 * the shop), in either direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40.
 * A preview never touches the run. The "Attack style" row is the same dev override as the other attack tuners'
 * (Auto = what a player would see). Production plays the baked defaults.
 */
type HolyTunerValues = HeroHolyConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroHolyNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which Holy steps up to Tier II (the double smite). Shared with every attack (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which Holy becomes the spear rain. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which Holy becomes the sword and the consecration. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Invoke'],
  heroSwell: ['Hero swell', '×', 'How much the hero swells (and lifts) as it invokes.', 'Invoke'],
  haloSize: ['Halo', '×', 'The golden halo over the hero\'s head (0 = none).', 'Invoke'],
  sunburst: ['Sunburst', '×', 'The god rays turning behind the hero (0 = none).', 'Invoke'],
  prayBeam: ['Prayer beam', '×', 'The beam of light rising off the hero as the prayer goes up (0 = none).', 'Invoke'],
  sigilSize: ['Sigil size', '×', 'The rune circle that flashes onto the target (0 = none).', 'Sigil and smite'],
  sigilSpin: ['Sigil spin', '×', 'How fast the sigil turns.', 'Sigil and smite'],
  pillarGlow: ['Pillar glow', '×', 'How bright the pillars of light are.', 'Sigil and smite'],
  pillarHeight: ['Pillar height', '×', 'How far up the pillars reach.', 'Sigil and smite'],
  raysSize: ['God rays', '×', 'The rays bursting from the smite and the eruption (0 = none).', 'Sigil and smite'],
  spearSize: ['Spear size', '×', 'Tier III: the size of each light spear.', 'Spear rain (Tier III)'],
  spearRing: ['Spear ring', '×', 'Tier III: how far round the target the spears land, in portrait radii.', 'Spear rain (Tier III)'],
  spearSlant: ['Spear slant', '×', 'Tier III: how steeply the spears fall (0 = straight down).', 'Spear rain (Tier III)'],
  seedGlow: ['Seed glow', '×', 'Tier III: the consecration seed each spear plants (0 = none).', 'Spear rain (Tier III)'],
  swordSize: ['Sword size', '×', 'Tier IV: the length of the holy swords.', 'Swords (Tier IV)'],
  swordLastSize: ['Last sword size', '×', 'Tier IV: how much bigger the last sword is (they grow through the barrage).', 'Swords (Tier IV)'],
  swordCount: ['Swords', undefined, 'Tier IV: how many swords fly in (the owner asked for six).', 'Swords (Tier IV)'],
  swordFlightMs: ['First flight', 'ms', 'Tier IV: the first sword\'s flight (slow and readable).', 'Swords (Tier IV)'],
  swordFlightRamp: ['Flight ramp', '×', 'Tier IV: each sword flies this much faster than the last (lower = a steeper ramp).', 'Swords (Tier IV)'],
  swordGapMs: ['First gap', 'ms', 'Tier IV: between the first and second sword landing.', 'Swords (Tier IV)'],
  swordGapRamp: ['Gap ramp', '×', 'Tier IV: each gap shrinks by this (lower = a faster frenzy).', 'Swords (Tier IV)'],
  swordAngle: ['First heading', '°', 'Tier IV: where the first sword comes from (-90 = from the top); the rest alternate round the compass.', 'Swords (Tier IV)'],
  swordJitter: ['Heading jitter', '°', 'Tier IV: how far each heading strays from the even spread.', 'Swords (Tier IV)'],
  swordPlant: ['Plant ring', '×', 'Tier IV: how far from the centre the points stop, in portrait radii.', 'Swords (Tier IV)'],
  swordHoldMs: ['Charge', 'ms', 'Tier IV: after the last sword lands, before the implosion.', 'Swords (Tier IV)'],
  implodeMs: ['Implosion', 'ms', 'Tier IV: everything sucked into the centre before the blast is released.', 'Swords (Tier IV)'],
  swordAlong: ['Sword along', '×', 'Tier IV: where the centre the swords converge on sits between the heroes (0.5 = the middle).', 'Swords (Tier IV)'],
  swordGlow: ['Sword glow', '×', 'Tier IV: the swords\' glow.', 'Swords (Tier IV)'],
  slamDust: ['Slam dust', undefined, 'Tier IV: dust rolling out when the first sword bites.', 'Swords (Tier IV)'],
  slamDebris: ['Slam debris', undefined, 'Tier IV: light chips flung out by each bite (more as they ramp).', 'Swords (Tier IV)'],
  shockwave: ['Shockwave', '×', 'Tier IV: the ring each bite sends out from the centre (0 = none).', 'Swords (Tier IV)'],
  explodeSize: ['Explosion size', '×', 'Tier IV: the burst of light when the implosion releases.', 'Swords (Tier IV)'],
  shards: ['Light shards', undefined, 'Tier IV: golden light shards flung out of the release.', 'Swords (Tier IV)'],
  spreadMs: ['Blast flight', 'ms', 'Tier IV: the flat consecrated blast skimming to the target (at 800 px; scales gently). Lower = faster.', 'Consecration (Tier IV)'],
  waveSize: ['Blast size', '×', 'Tier IV: the width of the flat consecrated blast.', 'Consecration (Tier IV)'],
  pathWidth: ['Path width', '×', 'Tier IV: the width of the cracked path (and how far the side cracks stray).', 'Consecration (Tier IV)'],
  runeDensity: ['Rune density', '×', 'Tier IV: runes lighting up along the path (0 = none).', 'Consecration (Tier IV)'],
  cracks: ['Release cracks', undefined, 'Tier IV: radiant cracks torn round the centre when the blast releases.', 'Consecration (Tier IV)'],
  gatherMs: ['Gather', 'ms', 'Tier IV: the consecration gathering under the target before it erupts.', 'Consecration (Tier IV)'],
  flamePillars: ['Flames', undefined, 'Tier IV: holy flames erupting round the target.', 'Consecration (Tier IV)'],
  flameHeight: ['Flame height', '×', 'Tier IV: how tall the holy flames rise.', 'Consecration (Tier IV)'],
  lingerMs: ['Linger / fade', 'ms', 'Tier IV: the cracked path lingering and fading after the eruption.', 'Consecration (Tier IV)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the smite, sword, release and eruption flashes are.', 'Consecration (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxInvokeGain: ['invoke: gain', undefined, 'A shimmer of divine light as the hero invokes (and as the consecration starts).', 'Sound: invoke'],
  sfxInvokeRate: ['invoke: pitch', '×', 'Pitch of the invoke.', 'Sound: invoke'],
  sfxSigilGain: ['sigil: gain', undefined, 'The chime as the sigil flashes onto the target.', 'Sound: sigil'],
  sfxSigilRate: ['sigil: pitch', '×', 'Pitch of the sigil chime.', 'Sound: sigil'],
  sfxDropGain: ['pillar drop: gain', undefined, 'The whoosh of each pillar of light dropping.', 'Sound: pillar drop'],
  sfxDropRate: ['pillar drop: pitch', '×', 'Pitch of the drop.', 'Sound: pillar drop'],
  sfxHitGain: ['tick: gain', undefined, 'The crystalline crack of each tick (a smite or a spear; pitch climbs).', 'Sound: tick'],
  sfxHitRate: ['tick: pitch', '×', 'Pitch of the first tick.', 'Sound: tick'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the last smite, or the eruption.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxThumpGain: ['thump: gain', undefined, 'A low punch under the impact and the slam (punchy, not boomy).', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxSpearGain: ['spear: gain', undefined, 'Tier III: each spear falling (and the sword\'s plunge at IV).', 'Sound: spear'],
  sfxSpearRate: ['spear: pitch', '×', 'Pitch of the first spear.', 'Sound: spear'],
  sfxDescendGain: ['descend: gain', undefined, 'Tier IV: the descending whoosh, timed so its hit lands on the slam.', 'Sound: descend'],
  sfxDescendRate: ['descend: pitch', '×', 'Pitch of the descend.', 'Sound: descend'],
  sfxSlamGain: ['slam: gain', undefined, 'Tier IV: the sword slamming into the board.', 'Sound: slam'],
  sfxSlamRate: ['slam: pitch', '×', 'Pitch of the slam.', 'Sound: slam'],
  sfxClangGain: ['clang: gain', undefined, 'Tier IV: the metal ring of the sword biting in.', 'Sound: clang'],
  sfxClangRate: ['clang: pitch', '×', 'Pitch of the clang.', 'Sound: clang'],
  sfxEruptGain: ['eruption: gain', undefined, 'Tier IV: the holy burst under the target (pitched up: a crack, not a boom).', 'Sound: eruption'],
  sfxEruptRate: ['eruption: pitch', '×', 'Pitch of the eruption.', 'Sound: eruption'],
  sfxImplodeGain: ['implosion: gain', undefined, 'Tier IV: the sharp inward suck as the centre implodes.', 'Sound: implosion'],
  sfxImplodeRate: ['implosion: pitch', '×', 'Pitch of the implosion.', 'Sound: implosion'],
  sfxBigGain: ['big hit: gain', undefined, 'Tiers III and IV: an extra crack layered on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxChoirGain: ['choir: gain', undefined, 'The synth choir swelling through the invoke and the sword\'s hang.', 'Sound: choir'],
  sfxChoirHz: ['choir: pitch', undefined, 'Hz. The root of the choir chord.', 'Sound: choir'],
  sfxBellGain: ['bell: gain', undefined, 'The synth bell struck on each smite, the slam and the eruption.', 'Sound: bell'],
  sfxBellHz: ['bell: pitch', undefined, 'Hz. The bell\'s strike note.', 'Sound: bell'],
  sfxSwellGain: ['swell: gain', undefined, 'Tier IV: the rising radiant swell as the consecration races out (peaks on the eruption).', 'Sound: swell'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact and eruption clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while Holy plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<HolyTierSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Invoke', 'ms', 'The hero invoking before the prayer goes up. The view pushes in over this.'],
  SigilMs: ['Sigil', 'ms', 'The rune circle spinning down onto the target.'],
  Smites: ['Smites', undefined, 'How many pillars of light drop (I one, II two; the last is the impact).'],
  SmiteGapMs: ['Smite gap', 'ms', 'The gap between one smite landing and the next dropping.'],
  DropMs: ['Drop', 'ms', 'A pillar of light dropping out of the sky.'],
  PillarWidth: ['Pillar width', '×', 'How wide the pillars are.'],
  Spears: ['Spears', undefined, 'Light spears raining in round the target before the smite (III).'],
  SpearGapMs: ['Spear gap', 'ms', 'The rhythm of the spear rain.'],
  SpearFlightMs: ['Spear flight', 'ms', 'A spear falling.'],
  Sword: ['Holy sword', undefined, 'The sword and the consecration instead of the smite.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the invoke (and the sword).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact (and the slam) before the view settles.'],
  Motes: ['Motes', undefined, 'Motes of light thrown by the impact.'],
  Burst: ['Burst size', '×', 'Scale of the impact flash and bloom.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroHolyStrKey>> = {
  'Sound: invoke': 'sfxInvokeClip', 'Sound: sigil': 'sfxSigilClip', 'Sound: pillar drop': 'sfxDropClip', 'Sound: tick': 'sfxHitClip',
  'Sound: impact': 'sfxImpactClip', 'Sound: thump': 'sfxThumpClip', 'Sound: spear': 'sfxSpearClip', 'Sound: descend': 'sfxDescendClip',
  'Sound: slam': 'sfxSlamClip', 'Sound: clang': 'sfxClangClip', 'Sound: eruption': 'sfxEruptClip', 'Sound: implosion': 'sfxImplodeClip', 'Sound: big hit': 'sfxBigClip',
};

const COLORS: [HeroHolyStrKey, string, string][] = [
  ['colorGold', 'Radiant gold', 'The light of the pillars, sigils, rays, flames and the consecration.'],
  ['colorDeep', 'Deep gold', 'The normal-blend bodies (the sigil lines, the pillar bodies, the ground): what keeps it readable on a light board.'],
  ['colorCore', 'Core', 'The warm-white cores and flashes.'],
  ['colorSky', 'Sky edge', 'The soft sky-blue in the glow edges and the sword\'s gems.'],
  ['colorPlayer', 'Your total', 'The total\'s colour when YOU strike.'],
  ['colorFoe', 'Foe total', 'The total\'s colour when THEY strike.'],
  ['colorDust', 'Dust', 'The dust rolling out of the slam.'],
];

type Ctl = TunerControl<Extract<keyof HolyTunerValues, string>>;

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
  const push = (key: HeroHolyNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_HOLY_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of HOLY_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroHolyNumKey;
      const [min, max, step] = HERO_HOLY_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Sword'
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

let live: HeroHolyHandle | null = null;

/** Play the real Holy attack between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; knockout?: boolean; reduced?: boolean; frames?: HeroHolyOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroHolyHandle | null> {
  live?.cancel();
  const cfg = getHeroHolyConfig();
  return playAttackDemo(side, (o) => playHeroHoly(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, knockout: opts.knockout, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroHoly?: unknown }).__heroHoly = { demo, previewParts };
}

export const SPEC: TunerSpec<HolyTunerValues> = {
  id: 'heroholy',                  // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Holy',
  note: () => {
    const c = getHeroHolyConfig();
    const p = holyPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    const what = p.sword ? 'sword + consecration' : p.spears.length ? `${p.spears.length} spears + smite` : `${p.smites.length} smite${p.smites.length === 1 ? '' : 's'}`;
    return `dev · tier ${p.tier} · ${what} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroHolyConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroHolyValue(key as keyof HeroHolyConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroHolyValue(key as keyof HeroHolyConfig, value); },
  reset: () => { resetHeroHolyConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_HOLY_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroHolyConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You smite', hint: 'Your hero smites the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe smites', hint: 'The foe smites your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero smites for 3: Tier I, one pillar of light.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero smites for 8: Tier II, a double smite.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero smites for 12 from four numbers: Tier III, the spear rain and the smite.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero smites for 40 from seven numbers: Tier IV, the holy sword and the consecration.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe smites your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe smites your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe smites your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe smites your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
    { label: '▶ Knockout (40)', hint: 'Your hero KNOCKS THE FOE OUT with 40 (the Ancient Knockout variant, "Tier V"): the Huge judgement, remixed: a seventh, giant prismatic sword is driven down into the middle of the star of blades, and the eruption throws a wider cyan and magenta consecration ring, with a bigger shake, a slow-mo dip and a KO sting.', run: () => { void demo('player', { damage: 40, parts: 7, knockout: true }); } },
    { label: '▶ Foe knockout (40)', hint: 'The foe knocks YOU out with 40 (the Knockout variant).', run: () => { void demo('opp', { damage: 40, parts: 7, knockout: true }); } },
  ],
};

export function HeroHolyTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
