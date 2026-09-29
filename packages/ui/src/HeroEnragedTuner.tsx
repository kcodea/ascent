import {
  ENRAGED_TIER_SUFFIXES, HERO_ENRAGED_DEFAULTS, HERO_ENRAGED_RANGES, TIERS, enragedPlan, getHeroEnragedConfig,
  heroEnragedConfigJson, resetHeroEnragedConfig, setHeroEnragedValue,
  type EnragedTierSuffix, type HeroEnragedConfig, type HeroEnragedNumKey, type HeroEnragedStrKey, type TierNum,
} from './heroEnraged/heroEnragedConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroEnraged, type HeroEnragedHandle, type HeroEnragedOptions } from './heroEnraged/heroEnraged';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the ENRAGED STRIKE hero attack (owner ask 2026-09-28: "a legendary version of this strike ... just
 * amplified or enraged"). The Play buttons run the REAL runner between the two real hero portraits (works from the shop),
 * in either direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40. A preview
 * never touches the run. The "Attack style" row is the same dev override as the other attack tuners'. Production plays
 * the baked defaults.
 */
type EnragedTunerValues = HeroEnragedConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroEnragedNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which it becomes the double strike. Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which it becomes the flurry of three. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which it becomes the rampage and haymaker. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Windup'],
  windupLeadMs: ['Windup lead', 'ms', 'How far into the absorb the hero starts pulling back.', 'Windup'],
  windupDepth: ['Pull back', '×', 'How much deeper than Classic the hero coils back before the lunge (1 = Classic).', 'Windup'],
  windupSwell: ['Extra swell', '×', 'Swell on top of Classic\x27s own (1.32) at the top of the windup.', 'Windup'],
  tiltBoost: ['Lean', '×', 'How much harder than Classic the hero leans in to lead with a corner (1 = Classic).', 'Windup'],
  tremblePx: ['Tremble', 'px', 'How hard the hero trembles as the rage builds (grows to this).', 'Windup'],
  contactStop: ['Contact stop', '×', 'Where the lunge stops: how many of the striker radii outside the rim of the struck portrait, so the hit reads on the contact frame (0 = its centre on the rim; negative drives in over the face, like Classic).', 'Lunge and strike'],
  contactSwell: ['Contact swell', '×', 'How big the hero is on contact (the contact point itself is Classic\x27s: corner first into the foe).', 'Lunge and strike'],
  heroSquash: ['Contact squash', '×', 'How hard the hero squashes against the foe on each contact.', 'Lunge and strike'],
  recoilShare: ['Recoil share', '×', 'Between combo hits: the share of the gap spent recoiling hard off the foe (the rest is the coil before the next drive).', 'Lunge and strike'],
  coilSquash: ['Coil squash', '×', 'Between combo hits: how hard the hero squashes as it coils to fly back in.', 'Lunge and strike'],
  reboundDepth: ['Rebound', '×', 'The pull back between strikes, as a fraction of the windup (the finisher pulls back 1.7x this).', 'Lunge and strike'],
  holdMs: ['Hold', 'ms', 'How long the hero stays in the foe after the last hit before springing home.', 'Lunge and strike'],
  recoverX: ['Recover', '×', 'The elastic settle home, as a fraction of Classic\x27s (lower = snappier).', 'Lunge and strike'],
  burstMs: ['Rage burst lead', 'ms', 'The rage burst (the flare, the heat rings, the roar) fires this long before the first drive.', 'Rage burst'],
  burstSize: ['Rage burst size', '×', 'The flare and the heat-shimmer rings (0 = none).', 'Rage burst'],
  craterSize: ['Ground cracks', '×', 'Tier IV: the molten cracks and scorch the haymaker leaves round the struck hero.', 'Haymaker (Tier IV)'],
  debris: ['Rubble', undefined, 'Tier IV: chunks thrown up by the haymaker.', 'Haymaker (Tier IV)'],
  haymakerCoilMs: ['Rear-back', 'ms', 'Tier IV: the huge rear-back (the roar, the rage at its peak) before the haymaker comes down.', 'Haymaker (Tier IV)'],
  haymakerIn: ['Rear inward', '×', 'Tier IV: how far in over the board the hero rears (a fraction of the distance), so the whole rear-back is in view.', 'Haymaker (Tier IV)'],
  haymakerLift: ['Rear height', '×', 'Tier IV: how high the hero rears up (a fraction of the distance; less near the top of the screen).', 'Haymaker (Tier IV)'],
  haymakerSwell: ['Rear swell', '×', 'Tier IV: how much the hero swells toward the camera at the top of the rear-back.', 'Haymaker (Tier IV)'],
  haymakerDriveX: ['Haymaker drive', '×', 'Tier IV: the overhead blow coming down, as a multiple of the drive.', 'Haymaker (Tier IV)'],
  crescentSize: ['Crescent', '×', 'Tier IV: the giant flaming crescent cleaved across the struck hero (0 = none).', 'Haymaker (Tier IV)'],
  shockSize: ['Rage shockwave', '×', 'Tier IV: the screen-filling shockwave of the knockout.', 'Haymaker (Tier IV)'],
  auraSize: ['Aura glow', '×', 'The hot glow round the hero.', 'Aura'],
  flames: ['Flames', undefined, 'Flame tongues round the portrait rim.', 'Aura'],
  flameLength: ['Flame length', '×', 'How far the flames lick off the rim.', 'Aura'],
  motes: ['Motes', undefined, 'Hot streaks pulled into the hero through the windup.', 'Aura'],
  ghosts: ['Afterimages', undefined, 'Ghost copies of the portrait left behind the dash (0 = none).', 'Afterimages and wake'],
  ghostSpacing: ['Ghost spacing', '×', 'Distance between afterimages, in portrait radii (they are stamped along the dash, evenly).', 'Afterimages and wake'],
  ghostAlpha: ['Ghost opacity', 'opacity', 'How strong the nearest afterimage is.', 'Afterimages and wake'],
  ghostFadeMs: ['Ghost fade', 'ms', 'How fast each afterimage fades.', 'Afterimages and wake'],
  wakeWidth: ['Rage streak', '×', 'The streak of rage behind the dash, as a fraction of the portrait (0 = none).', 'Afterimages and wake'],
  wakeMs: ['Streak length', 'ms', 'How much of the dash the streak trails.', 'Afterimages and wake'],
  speedLines: ['Speed lines', undefined, 'Lines rushing past each dash (bigger hits and the haymaker get more).', 'Afterimages and wake'],
  ringSize: ['Shockwave', '×', 'The main impact ring.', 'Impact'],
  ring2Size: ['Second ring', '×', 'The wider, slower second ring.', 'Impact'],
  slashLength: ['Claw length', '×', 'The claw rips torn across the foe.', 'Impact'],
  slashWidth: ['Claw width', '×', 'How thick the rips are.', 'Impact'],
  sparkSpeed: ['Spark speed', '×', 'How hard the sparks are thrown.', 'Impact'],
  emberLife: ['Ember life', '×', 'How long embers linger.', 'Impact'],
  flashAlpha: ['Flash', 'opacity', 'How bright the white-hot flash is.', 'Impact'],
  smoulderMs: ['Smoulder', 'ms', 'How long the struck hero smoulders (embers and smoke).', 'Impact'],
  sparkInward: ['Sparks inward', 'opacity', 'Share of the impact sparks that bounce back toward the middle of the screen (keeps a corner hit in view).', 'Impact'],
  rimCracks: ['Rim cracks', '×', 'The glowing rage cracks left on the rim of the struck portrait (0 = none).', 'Impact'],
  scorch: ['Ground scorch', '×', 'The burn a dash leaves along the ground (0 = none).', 'Afterimages and wake'],
  scorchMs: ['Scorch fade', 'ms', 'How long the ground scorch lasts.', 'Afterimages and wake'],
  emberStorm: ['Ember storm', undefined, 'Tier IV: embers the cracked ground throws up over the second after the haymaker.', 'Haymaker (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  shakeCap: ['Shake cap', 'px', 'The camera never shakes further than this, whatever the tier says.', 'Camera and portraits'],
  zoomCap: ['Zoom cap', '×', 'The camera never pushes in further than this (the impact punch may add up to 1.6x it).', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxRoarGain: ['roar: gain', undefined, 'A roar as the rage ignites.', 'Sound: roar'],
  sfxRoarRate: ['roar: pitch', '×', 'Pitch of the roar.', 'Sound: roar'],
  sfxWindupGain: ['windup: gain', undefined, 'Classic\x27s own windup clip, as the hero pulls back.', 'Sound: windup'],
  sfxWindupRate: ['windup: pitch', '×', 'Pitch of the windup.', 'Sound: windup'],
  sfxChargeGain: ['charge: gain', undefined, 'The riser climbing to the first drive (IV: to the top of the rise).', 'Sound: charge'],
  sfxChargeRate: ['charge: pitch', '×', 'Pitch of the riser.', 'Sound: charge'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'Each dash (a little higher each strike; the haymaker lower).', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the first whoosh.', 'Sound: whoosh'],
  sfxTickGain: ['tick hit: gain', undefined, 'The smack of each strike before the last.', 'Sound: tick hit'],
  sfxTickRate: ['tick hit: pitch', '×', 'Pitch of the first tick.', 'Sound: tick hit'],
  sfxSlashGain: ['rip: gain', undefined, 'The claw rips.', 'Sound: rip'],
  sfxSlashRate: ['rip: pitch', '×', 'Pitch of the rips.', 'Sound: rip'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the heavy hit.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxPunchGain: ['punch: gain', undefined, 'A punchy smack under the impact.', 'Sound: punch'],
  sfxPunchRate: ['punch: pitch', '×', 'Pitch of the punch.', 'Sound: punch'],
  sfxThumpGain: ['thump: gain', undefined, 'The low end of the impact (tight, not boomy).', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (raise it if it gets muddy).', 'Sound: thump'],
  sfxBigGain: ['crack: gain', undefined, 'Tiers III and IV: an extra crack on the impact.', 'Sound: crack'],
  sfxBigRate: ['crack: pitch', '×', 'Pitch of the crack.', 'Sound: crack'],
  sfxHaymakerGain: ['haymaker: gain', undefined, 'Tier IV: the knockout layer on the haymaker.', 'Sound: haymaker'],
  sfxHaymakerRate: ['haymaker: pitch', '×', 'Pitch of the knockout layer.', 'Sound: haymaker'],
  sfxRubbleGain: ['rubble: gain', undefined, 'Tier IV: rubble landing round the cracked ground.', 'Sound: rubble'],
  sfxRubbleRate: ['rubble: pitch', '×', 'Pitch of the first rubble hit.', 'Sound: rubble'],
  sfxToneGain: ['growl: gain', undefined, 'The synth rage growl rising through the windup (peaks on the drive).', 'Sound: growl'],
  sfxToneLowHz: ['growl: from', undefined, 'Hz. Where the growl starts.', 'Sound: growl'],
  sfxToneHighHz: ['growl: to', undefined, 'Hz. Where it has risen to at the drive.', 'Sound: growl'],
  sfxCrackleGain: ['crackle: gain', undefined, 'The synth ember crackle (through the windup and the smoulder).', 'Sound: synth'],
  sfxRumbleGain: ['rumble: gain', undefined, 'Tier IV: the synth rumble building through the rear-back.', 'Sound: synth'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact clips are cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while it plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<EnragedTierSuffix, [string, TunerUnit | undefined, string]> = {
  WindupX: ['Windup', '×', 'The coil and the rage building before the first drive, as a multiple of Classic\x27s windup (IV: the rise).'],
  Strikes: ['Strikes', undefined, 'How many strikes (I one, II a double, III a combo of three, IV a rampage of five and the haymaker). Every one is a full hit; only the last lands the blow.'],
  DriveX: ['Drive', '×', 'Each dash into the foe, as a multiple of Classic\x27s distance-scaled strike (the haymaker has its own dial).'],
  GapMs: ['Rebound', 'ms', 'The pull back between strikes.'],
  Accel: ['Flurry speed-up', '×', 'Each pull back and drive before the finisher is this much shorter than the one before (lower = the flurry accelerates harder).'],
  FinisherMs: ['Finisher wind', 'ms', 'Extra pull back before the last strike of a flurry (3+ strikes).'],
  Haymaker: ['Haymaker', undefined, 'The last strike is the overhead haymaker: rear way back and up, then come down on the foe (Tier IV).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact (capped by the shake cap).'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the windup (capped).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Aura: ['Aura', '×', 'How big and bright the rage aura burns.'],
  Sparks: ['Sparks', undefined, 'Chunky sparks thrown by the impact.'],
  Embers: ['Embers', undefined, 'Embers thrown by the impact.'],
  Slashes: ['Claw sets', undefined, 'Sets of three claw rips torn across the foe on the impact (2 = crossed in an X).'],
  Burst: ['Burst size', '×', 'Scale of the flash, bloom and rings.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroEnragedStrKey>> = {
  'Sound: roar': 'sfxRoarClip', 'Sound: windup': 'sfxWindupClip', 'Sound: charge': 'sfxChargeClip', 'Sound: whoosh': 'sfxWhooshClip',
  'Sound: tick hit': 'sfxTickClip', 'Sound: rip': 'sfxSlashClip', 'Sound: impact': 'sfxImpactClip', 'Sound: punch': 'sfxPunchClip',
  'Sound: thump': 'sfxThumpClip', 'Sound: crack': 'sfxBigClip', 'Sound: haymaker': 'sfxHaymakerClip', 'Sound: rubble': 'sfxRubbleClip',
};

const COLORS: [HeroEnragedStrKey, string, string][] = [
  ['colorPlayer', 'Your rage', 'The aura, streak, afterimages and total colour when YOU strike.'],
  ['colorFoe', 'Foe rage', 'The same when THEY strike.'],
  ['colorHot', 'Hot', 'The white-hot yellow of the flame cores, rings and sparks.'],
  ['colorCore', 'Core', 'The white flash.'],
  ['colorShade', 'Deep', 'Mixed into the flame bodies and rips so they keep their colour on light boards.'],
  ['colorSmoke', 'Smoke', 'Smoke, dust, the crater scorch and the debris.'],
];

type Ctl = TunerControl<Extract<keyof EnragedTunerValues, string>>;

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
  const push = (key: HeroEnragedNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_ENRAGED_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of ENRAGED_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroEnragedNumKey;
      const [min, max, step] = HERO_ENRAGED_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Haymaker'
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

let live: HeroEnragedHandle | null = null;

/** Play the real Enraged Strike between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroEnragedOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroEnragedHandle | null> {
  live?.cancel();
  const cfg = getHeroEnragedConfig();
  return playAttackDemo(side, (o) => playHeroEnraged(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroEnraged?: unknown }).__heroEnraged = { demo, previewParts };
}

export const SPEC: TunerSpec<EnragedTunerValues> = {
  id: 'heroenraged',                 // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Enraged',
  note: () => {
    const c = getHeroEnragedConfig();
    const p = enragedPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    const what = p.haymaker ? `${p.strikes.length - 1} slams + haymaker` : `${p.strikes.length} strike${p.strikes.length === 1 ? '' : 's'}`;
    return `dev · tier ${p.tier} · ${what} · windup ${Math.round(p.windupAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroEnragedConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroEnragedValue(key as keyof HeroEnragedConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroEnragedValue(key as keyof HeroEnragedConfig, value); },
  reset: () => { resetHeroEnragedConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_ENRAGED_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroEnragedConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You strike', hint: 'Your hero strikes the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe strikes', hint: 'The foe strikes your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero strikes for 3: Tier I, one enraged hit.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero strikes for 8: Tier II, a double strike.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero strikes for 12 from four numbers: Tier III, a combo of three.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero strikes for 40 from seven numbers: Tier IV, the rampage and the haymaker.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe strikes your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe strikes your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe strikes your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe strikes your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroEnragedTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
