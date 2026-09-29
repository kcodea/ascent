import {
  HERO_UNDEAD_DEFAULTS, HERO_UNDEAD_RANGES, UNDEAD_TIER_SUFFIXES, TIERS, getHeroUndeadConfig, heroUndeadConfigJson,
  resetHeroUndeadConfig, setHeroUndeadValue, undeadPlan,
  type HeroUndeadConfig, type HeroUndeadNumKey, type HeroUndeadStrKey, type TierNum, type UndeadTierSuffix,
} from './heroUndead/heroUndeadConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroUndead, type HeroUndeadHandle, type HeroUndeadOptions } from './heroUndead/heroUndead';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the UNDEAD hero attack, the Grave Call cosmetic (owner ask 2026-09-29: "some sort of an undead
 * animation"). The Play buttons run the REAL runner between the two real hero portraits (works from the shop), in either
 * direction, at Small 3 / Tier II 8 / Medium 12 / Huge 40, and sit at the TOP of the panel (owner 2026-09-29: the Speed
 * and Reduced motion buttons are gone from every hero attack tuner). A preview never touches the run. The "Attack style" row is the same dev override as the other attack tuners' (Auto = what a player
 * would see). Production plays the baked defaults.
 */
type UndeadTunerValues = HeroUndeadConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroUndeadNumKey, `t${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Damage at which Undead steps up to Tier II (two skulls). Shared with every attack (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Damage at which Undead becomes the grave hands and the wisp swarm. Shared (12).', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Damage at which Undead becomes the grave rift and the maw. Shared (20).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total diving into the hero.', 'Raise'],
  heroSwell: ['Hero swell', '×', 'How much the hero swells as it raises the dead.', 'Raise'],
  circleSize: ['Grave circle', '×', 'The necrotic circle under the hero (and under the target at Tier III). 0 = none.', 'Raise'],
  circleSpin: ['Circle spin', '×', 'How fast the grave circles turn.', 'Raise'],
  smokeRing: ['Smoke ring', '×', 'Grave smoke circling the hero\'s rim through the raise (0 = none).', 'Raise'],
  shriekMs: ['Shriek', 'ms', 'A skull popping out of the hero and shrieking before it is loosed.', 'Skulls'],
  skullBase: ['Skull size', '×', 'The size of every flying skull.', 'Skulls'],
  skullArc: ['Skull arc', '×', 'How far a skull\'s flight bows sideways (two skulls bow opposite ways).', 'Skulls'],
  skullWobble: ['Skull wobble', '×', 'How much a skull weaves and tilts in flight.', 'Skulls'],
  afterimages: ['Afterimages', undefined, 'Ghost copies trailing a flying skull (and the maw\'s lunge).', 'Skulls'],
  shedWisps: ['Shed wisps', '×', 'Wisps shed by a skull as it flies (and the maw as it rises).', 'Skulls'],
  echoSize: ['Bite echo', '×', 'The spectral echo of the skull swelling off each bite (0 = none).', 'Skulls'],
  shards: ['Bone shards', undefined, 'Bone shards flung by each bite.', 'Skulls'],
  wispLife: ['Wisp life', '×', 'How long the ghost wisps drift before they fade.', 'Wisps'],
  wispWander: ['Wisp wander', '×', 'How much the wisps curl and weave (0 = straight).', 'Wisps'],
  wispSize: ['Wisp size', '×', 'The size of the ghost wisps.', 'Wisps'],
  wispBend: ['Swarm bend', '×', 'Tier III: how far the swarm\'s wisps curve out to the sides on their way in.', 'Wisps'],
  handSize: ['Hand size', '×', 'Tier III: the skeletal hands clawing up round the target.', 'Hands (Tier III)'],
  handRing: ['Hand ring', '×', 'Tier III: how far round the target the hands come up, in portrait radii.', 'Hands (Tier III)'],
  handRiseMs: ['Hand rise', 'ms', 'Tier III: a hand clawing up out of the board before it grips (a tick).', 'Hands (Tier III)'],
  handDragPx: ['Drag', 'px', 'Tier III: how far the hands drag the target down into the grave.', 'Hands (Tier III)'],
  riftAlong: ['Rift along', '×', 'Tier IV: where the rift opens between the heroes (0.5 = the middle).', 'Rift and maw (Tier IV)'],
  riftLen: ['Rift length', '×', 'Tier IV: how long the tear in the board is.', 'Rift and maw (Tier IV)'],
  riftMs: ['Rift tear', 'ms', 'Tier IV: the rift tearing open.', 'Rift and maw (Tier IV)'],
  riftCracks: ['Rift cracks', undefined, 'Tier IV: cracks racing off the rift.', 'Rift and maw (Tier IV)'],
  mawSize: ['Maw size', '×', 'Tier IV: the giant skull.', 'Rift and maw (Tier IV)'],
  mawRiseMs: ['Maw rise', 'ms', 'Tier IV: the maw rising out of the rift (its eyes ignite at the end).', 'Rift and maw (Tier IV)'],
  mawLift: ['Maw lift', '×', 'Tier IV: how far above the rift the maw rises.', 'Rift and maw (Tier IV)'],
  mawShriekMs: ['Maw shriek', 'ms', 'Tier IV: the maw\'s scream (the jaw drops, shriek rings, the view trembles).', 'Rift and maw (Tier IV)'],
  mawLungeMs: ['Maw lunge', 'ms', 'Tier IV: the maw flying at the target (at 550 px; scales gently). Lower = faster.', 'Rift and maw (Tier IV)'],
  chompMs: ['Chomp', 'ms', 'Tier IV: the jaw snapping shut onto the blow.', 'Rift and maw (Tier IV)'],
  mawGrow: ['Lunge growth', '×', 'Tier IV: how much the maw grows as it lunges.', 'Rift and maw (Tier IV)'],
  mistMs: ['Mist wave', 'ms', 'Tier IV: the necrotic mist washing out from the chomp.', 'Rift and maw (Tier IV)'],
  mistReach: ['Mist reach', '×', 'Tier IV: how far across the board the mist washes.', 'Rift and maw (Tier IV)'],
  mistPuffs: ['Mist puffs', undefined, 'Tier IV: puffs of mist in the wave.', 'Rift and maw (Tier IV)'],
  lingerMs: ['Linger / fade', 'ms', 'The grave circle and the rift fading after the blow.', 'Rift and maw (Tier IV)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the bite and chomp flashes are.', 'Rift and maw (Tier IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked along the blow.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxRaiseGain: ['raise: gain', undefined, 'The low necrotic swell as the grave circle forms under the hero.', 'Sound: raise'],
  sfxRaiseRate: ['raise: pitch', '×', 'Pitch of the raise.', 'Sound: raise'],
  sfxCallGain: ['call: gain', undefined, 'The dead answering (the circle flares).', 'Sound: call'],
  sfxCallRate: ['call: pitch', '×', 'Pitch of the call.', 'Sound: call'],
  sfxShriekGain: ['shriek: gain', undefined, 'A skull shrieking as it pops out (and layered on the maw\'s scream).', 'Sound: shriek'],
  sfxShriekRate: ['shriek: pitch', '×', 'Pitch of the shriek.', 'Sound: shriek'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'A skull (or the swarm) flying.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxTickGain: ['bite: gain', undefined, 'The skull bursting as it bites (every bite; the last one louder).', 'Sound: bite'],
  sfxTickRate: ['bite: pitch', '×', 'Pitch of the bite.', 'Sound: bite'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact: the last bite, or the chomp.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxThumpGain: ['thump: gain', undefined, 'A low punch under the impact.', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump (lower = heavier).', 'Sound: thump'],
  sfxBigGain: ['big hit: gain', undefined, 'Tiers III and IV: an extra crack layered on the impact.', 'Sound: big hit'],
  sfxBigRate: ['big hit: pitch', '×', 'Pitch of the big hit.', 'Sound: big hit'],
  sfxClawGain: ['claw: gain', undefined, 'Tier III: a hand clawing up out of the board and gripping.', 'Sound: claw'],
  sfxClawRate: ['claw: pitch', '×', 'Pitch of the claw.', 'Sound: claw'],
  sfxWispGain: ['wisp: gain', undefined, 'Tier III: each wisp of the swarm striking (pitch climbs).', 'Sound: wisp'],
  sfxWispRate: ['wisp: pitch', '×', 'Pitch of the first wisp.', 'Sound: wisp'],
  sfxRiftGain: ['rift: gain', undefined, 'Tier IV: the rift tearing open.', 'Sound: rift'],
  sfxRiftRate: ['rift: pitch', '×', 'Pitch of the rift.', 'Sound: rift'],
  sfxRumbleGain: ['rumble: gain', undefined, 'The ground cracking (the rift, and the grave opening at Tier III).', 'Sound: rumble'],
  sfxRumbleRate: ['rumble: pitch', '×', 'Pitch of the rumble.', 'Sound: rumble'],
  sfxRiseGain: ['rise: gain', undefined, 'Tier IV: the maw rising out of the rift.', 'Sound: rise'],
  sfxRiseRate: ['rise: pitch', '×', 'Pitch of the rise.', 'Sound: rise'],
  sfxRoarGain: ['roar: gain', undefined, 'Tier IV: the maw\'s scream.', 'Sound: roar'],
  sfxRoarRate: ['roar: pitch', '×', 'Pitch of the roar.', 'Sound: roar'],
  sfxLungeGain: ['lunge: gain', undefined, 'Tier IV: the swoosh of the lunge, timed so its hit lands on the chomp.', 'Sound: lunge'],
  sfxLungeRate: ['lunge: pitch', '×', 'Pitch of the lunge.', 'Sound: lunge'],
  sfxChompGain: ['chomp: gain', undefined, 'The jaw snapping shut (the maw\'s chomp; a lighter snap on each bite).', 'Sound: chomp'],
  sfxChompRate: ['chomp: pitch', '×', 'Pitch of the chomp.', 'Sound: chomp'],
  sfxMistGain: ['mist: gain', undefined, 'Tier IV: the necrotic mist washing out.', 'Sound: mist'],
  sfxMistRate: ['mist: pitch', '×', 'Pitch of the mist.', 'Sound: mist'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact clip is cut to this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact and the mist. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while Undead plays (1 = no duck).', 'Sound: mix'],
};

const TIER_SPECS: Record<UndeadTierSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Raise', 'ms', 'The hero raising the dead before they answer. The view pushes in over this.'],
  Skulls: ['Skulls', undefined, 'How many skulls fly (I one, II two, III one finisher; the last is the impact).'],
  SkullGapMs: ['Skull gap', 'ms', 'After a skull is loosed, until the next pops out.'],
  SkullFlightMs: ['Skull flight', 'ms', 'A skull flying to the target (at 1100 px; scales gently).'],
  SkullSize: ['Skull size', '×', 'The size of this tier\'s skulls.'],
  Hands: ['Hands', undefined, 'Skeletal hands clawing up round the target (III).'],
  HandGapMs: ['Hand gap', 'ms', 'Between one hand and the next.'],
  Wisps: ['Swarm', undefined, 'Ghost wisps streaming from the hero and striking the target (III).'],
  WispGapMs: ['Swarm gap', 'ms', 'The rhythm of the swarm.'],
  WispFlightMs: ['Swarm flight', 'ms', 'A wisp of the swarm flying in.'],
  Maw: ['Grave rift', undefined, 'The rift and the maw instead of the skulls.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the raise (and the maw).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Burst: ['Burst size', '×', 'Scale of the impact flash and bloom.'],
  Motes: ['Motes', undefined, 'Grave motes and extra wisps thrown by the impact.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const TIER_NAMES: Record<TierNum, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III', 4: 'Tier IV' };

const CLIP_OF: Partial<Record<string, HeroUndeadStrKey>> = {
  'Sound: raise': 'sfxRaiseClip', 'Sound: call': 'sfxCallClip', 'Sound: shriek': 'sfxShriekClip', 'Sound: whoosh': 'sfxWhooshClip',
  'Sound: bite': 'sfxTickClip', 'Sound: impact': 'sfxImpactClip', 'Sound: thump': 'sfxThumpClip', 'Sound: big hit': 'sfxBigClip',
  'Sound: claw': 'sfxClawClip', 'Sound: wisp': 'sfxWispClip', 'Sound: rift': 'sfxRiftClip', 'Sound: rumble': 'sfxRumbleClip',
  'Sound: rise': 'sfxRiseClip', 'Sound: roar': 'sfxRoarClip', 'Sound: lunge': 'sfxLungeClip', 'Sound: chomp': 'sfxChompClip', 'Sound: mist': 'sfxMistClip',
};

const COLORS: [HeroUndeadStrKey, string, string][] = [
  ['colorGhost', 'Ghost green', 'The sickly spectral green of the skulls, wisps, circles and the rift\'s light.'],
  ['colorTeal', 'Spectral teal', 'The second spectral colour (afterimages, rings, some wisps).'],
  ['colorVoid', 'Void', 'The deep purple-black bodies (the skull\'s dark rim, circle lines, holes, the rift, the mist): what keeps it readable on a light board.'],
  ['colorBone', 'Bone', 'The bone white of the hands, the shards and the skull\'s line work.'],
  ['colorCore', 'Core', 'The pale cores and flashes.'],
  ['colorPlayer', 'Your total', 'The total\'s colour when YOU strike.'],
  ['colorFoe', 'Foe total', 'The total\'s colour when THEY strike.'],
];

type Ctl = TunerControl<Extract<keyof UndeadTunerValues, string>>;

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
  const push = (key: HeroUndeadNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_UNDEAD_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const t of TIERS) {
    for (const s of UNDEAD_TIER_SUFFIXES) {
      const [label, unit, hint] = TIER_SPECS[s];
      const key = `t${t}${s}` as HeroUndeadNumKey;
      const [min, max, step] = HERO_UNDEAD_RANGES[key];
      const group = TIER_NAMES[t];
      out.push(s === 'Maw'
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

let live: HeroUndeadHandle | null = null;

/** Play the real Undead attack between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroUndeadOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroUndeadHandle | null> {
  live?.cancel();
  const cfg = getHeroUndeadConfig();
  return playAttackDemo(side, (o) => playHeroUndead(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroUndead?: unknown }).__heroUndead = { demo, previewParts };
}

export const SPEC: TunerSpec<UndeadTunerValues> = {
  id: 'heroundead',                // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Undead',
  note: () => {
    const c = getHeroUndeadConfig();
    const p = undeadPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1100 }, c);
    const what = p.maw ? 'grave rift + maw' : p.hands.length || p.wisps.length ? `${p.hands.length} hands + ${p.wisps.length} wisps + skull` : `${p.skulls.length} skull${p.skulls.length === 1 ? '' : 's'}`;
    return `dev · tier ${p.tier} · ${what} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroUndeadConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroUndeadValue(key as keyof HeroUndeadConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroUndeadValue(key as keyof HeroUndeadConfig, value); },
  reset: () => { resetHeroUndeadConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_UNDEAD_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroUndeadConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You strike', hint: 'Your hero calls the dead on the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe strikes', hint: 'The foe calls the dead on your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero strikes for 3: Tier I, one shrieking skull.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Tier II (8)', hint: 'Your hero strikes for 8: Tier II, two skulls.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero strikes for 12 from four numbers: Tier III, the grave hands, the wisp swarm and a skull.', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Huge (40)', hint: 'Your hero strikes for 40 from seven numbers: Tier IV, the grave rift and the maw.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe strikes your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe tier II (8)', hint: 'The foe strikes your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe medium (12)', hint: 'The foe strikes your hero for 12.', run: () => { void demo('opp', { damage: 12, parts: 4 }); } },
    { label: '▶ Foe huge (40)', hint: 'The foe strikes your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroUndeadTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
