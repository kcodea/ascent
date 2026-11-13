import {
  CLAW_LEVELS, CLAW_LEVEL_NAMES, CLAW_LEVEL_SUFFIXES, HERO_CLAW_DEFAULTS, HERO_CLAW_RANGES, clawPlan, getHeroClawConfig,
  heroClawConfigJson, resetHeroClawConfig, setHeroClawValue,
  type ClawLevel, type ClawLevelSuffix, type HeroClawConfig, type HeroClawNumKey, type HeroClawStrKey,
} from './heroClaw/heroClawConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroClaw, type HeroClawHandle, type HeroClawOptions } from './heroClaw/heroClaw';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the GRABBY CLAW hero attack (an Epic, in progress, no cosmetic yet): an arcade claw machine claw comes
 * down from the top of the screen and picks the struck portrait up. Three looks: Fumble (a short lift, dropped), Shake
 * (lifted higher and shaken, coins falling out) and Prize (carried to a prize chute and dropped in). The Play buttons
 * run the REAL runner between the two real hero portraits (works from the shop), in either direction. A preview never
 * touches the run. The "Attack style" row is the same dev override as the other attack tuners' (Auto = what a player
 * would see). Production plays the baked defaults.
 */
type ClawTunerValues = HeroClawConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroClawNumKey, `v${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Shake from', undefined, 'Damage at which the shared Tier II starts (the claw plays Shake from here). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'The shared Tier III (still Shake for an Epic). Shared (12).', 'Damage tiers'],
  tier4At: ['Prize from', undefined, 'Damage at which the shared Tier IV starts: the prize chute. Shared (20). A knockout always plays it.', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the striking hero.', 'Operator'],
  heroLeanPx: ['Operator lean', 'px', 'How far the striking hero leans with the trolley, presses on the drop and hops on the blow.', 'Operator'],
  clawSize: ['Claw size', '×', 'The claw against the struck portrait (1 = the prongs just wrap it).', 'Claw'],
  hubOff: ['Hub height', '×', 'How far the hub sits above the centre of the held portrait (portrait radii).', 'Claw'],
  hoverGap: ['Hover height', '×', 'How far above its grip the claw hovers before it drops (portrait radii).', 'Claw'],
  hoverMs: ['Hover', 'ms', 'The beat the claw hangs over the portrait before it drops.', 'Claw'],
  dropMs: ['Drop', 'ms', 'The claw dropping onto the portrait.', 'Claw'],
  clampMs: ['Clamp', 'ms', 'The prongs closing on the portrait.', 'Claw'],
  squeeze: ['Squeeze', '×', 'How much the portrait is squeezed in the grip.', 'Claw'],
  leaveMs: ['Retract', 'ms', 'The empty claw going back up its cable.', 'Claw'],
  peekMs: ['Show first', 'ms', 'No headroom: extra time for the claw to show itself in the open before it goes over the portrait.', 'Claw'],
  pullOut: ['Pull out', '×', 'No headroom: how far toward the middle the portrait is pulled out (portrait radii).', 'Claw'],
  fumbleMs: ['Fumble', 'ms', 'Fumble: how long the grip rattles before it lets go.', 'Fumble and Shake'],
  shakes: ['Shakes', undefined, 'Shake: how many hard shakes.', 'Fumble and Shake'],
  shakeMs: ['Shake time', 'ms', 'Shake: one whole side to side swing.', 'Fumble and Shake'],
  shakeAmp: ['Shake reach', '×', 'Shake: how far the claw jerks to each side (portrait radii).', 'Fumble and Shake'],
  coins: ['Coins', undefined, 'Shake: coins that fall out on each shake.', 'Fumble and Shake'],
  carryReach: ['Carry reach', '×', 'Prize: how far the portrait is carried to the chute (portrait radii; less when the edge is near).', 'Prize chute'],
  carryMs: ['Carry', 'ms', 'Prize: the carry across.', 'Prize chute'],
  holdMs: ['Hold', 'ms', 'Prize: the beat it hangs over the chute before the claw lets go.', 'Prize chute'],
  returnMs: ['Away', 'ms', 'Prize: how long the portrait is gone down the chute.', 'Prize chute'],
  popMs: ['Pop back', 'ms', 'Prize: the portrait popping back up in its socket.', 'Prize chute'],
  chuteSize: ['Chute size', '×', 'Prize: the size of the chute.', 'Prize chute'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact flash is.', 'Camera and landing'],
  squash: ['Squash', '×', 'How much the portrait squashes when it lands.', 'Camera and landing'],
  bounceMs: ['Bounce length', 'ms', 'Fumble and Shake: how long the landing bounce takes to settle.', 'Camera and landing'],
  shakeDecayMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and landing'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and landing'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and landing'],
  sfxServoGain: ['servo: gain', undefined, 'The motor whirr: the trolley running in, the winch, each shake, the carry.', 'Sound: servo'],
  sfxServoRate: ['servo: pitch', '×', 'Pitch of the servo.', 'Sound: servo'],
  sfxClampGain: ['clamp: gain', undefined, 'The prongs clamping shut (and, softer, springing open).', 'Sound: clamp'],
  sfxClampRate: ['clamp: pitch', '×', 'Pitch of the clamp.', 'Sound: clamp'],
  sfxCoinGain: ['coins: gain', undefined, 'Shake: coins falling out (a little higher each shake).', 'Sound: coins'],
  sfxCoinRate: ['coins: pitch', '×', 'Pitch of the first coins.', 'Sound: coins'],
  sfxThudGain: ['thud: gain', undefined, 'THE impact of Fumble and Shake: the portrait landing in its socket.', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: thud'],
  sfxChuteGain: ['chute: gain', undefined, 'THE impact of Prize: the clatter down the chute.', 'Sound: chute'],
  sfxChuteRate: ['chute: pitch', '×', 'Pitch of the clatter.', 'Sound: chute'],
  sfxWinGain: ['winner: gain', undefined, 'Prize: the WINNER sign.', 'Sound: winner'],
  sfxWinRate: ['winner: pitch', '×', 'Pitch of the winner sting.', 'Sound: winner'],
  sfxPopGain: ['pop: gain', undefined, 'Prize: the chute sliding up, and the portrait popping back.', 'Sound: pop'],
  sfxPopRate: ['pop: pitch', '×', 'Pitch of the pop.', 'Sound: pop'],
  sfxTailMix: ['impact tail', undefined, 'A short reverb tail on the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the claw plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<ClawLevelSuffix, [string, TunerUnit | undefined, string]> = {
  SlideMs: ['Slide in', 'ms', 'The claw running in over the struck portrait.'],
  LiftMs: ['Lift time', 'ms', 'The claw lifting the portrait.'],
  Lift: ['Lift height', '×', 'How high the portrait is lifted (portrait radii; less near the top of the screen).'],
  FallMs: ['Fall', 'ms', 'The portrait falling from the claw to THE impact.'],
  Bounce: ['Bounce', 'px', 'How high the portrait bounces when it lands (at a 100 px portrait).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in while the portrait is in the air.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Sparks: ['Sparks', undefined, 'Sparks thrown by the impact.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const CLIP_OF: Partial<Record<string, HeroClawStrKey>> = {
  'Sound: servo': 'sfxServoClip', 'Sound: clamp': 'sfxClampClip', 'Sound: coins': 'sfxCoinClip', 'Sound: thud': 'sfxThudClip',
  'Sound: chute': 'sfxChuteClip', 'Sound: winner': 'sfxWinClip', 'Sound: pop': 'sfxPopClip',
};

const COLORS: [HeroClawStrKey, string, string][] = [
  ['colorChrome', 'Chrome', 'A tint over the claw (white = the painted steel as it is).'],
  ['colorLamp', 'Lamp', 'The lamp on the hub and the two on the chute.'],
  ['colorCoin', 'Coins', 'The coins shaken out, and the gold of the chute sparks.'],
  ['colorDust', 'Dust', 'The dust a landing throws up.'],
  ['colorPlayer', 'Your side', 'The rings and total colour when YOUR claw grabs.'],
  ['colorFoe', 'Foe side', 'The rings and total colour when THEIR claw grabs.'],
];

type Ctl = TunerControl<Extract<keyof ClawTunerValues, string>>;

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
  const push = (key: HeroClawNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_CLAW_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const v of CLAW_LEVELS) {
    for (const s of CLAW_LEVEL_SUFFIXES) {
      const [label, unit, hint] = LEVEL_SPECS[s];
      const key = `v${v}${s}` as HeroClawNumKey;
      const [min, max, step] = HERO_CLAW_RANGES[key];
      out.push({ key, label, unit, hint, group: CLAW_LEVEL_NAMES[v as ClawLevel], min, max, step });
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

let live: HeroClawHandle | null = null;

/** Play the real Grabby Claw between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroClawOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroClawHandle | null> {
  live?.cancel();
  const cfg = getHeroClawConfig();
  return playAttackDemo(side, (o) => playHeroClaw(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroClaw?: unknown }).__heroClaw = { demo, previewParts, play: playHeroClaw };
}

const LOOK_OF: Record<ClawLevel, string> = { 1: 'grabbed and dropped', 2: 'shaken', 3: 'the prize chute' };

export const SPEC: TunerSpec<ClawTunerValues> = {
  id: 'heroclaw',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Grabby Claw',
  note: () => {
    const c = getHeroClawConfig();
    const p = clawPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · ${CLAW_LEVEL_NAMES[p.level]} (${LOOK_OF[p.level]}) · grab ${Math.round(p.grabAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroClawConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroClawValue(key as keyof HeroClawConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroClawValue(key as keyof HeroClawConfig, value); },
  reset: () => { resetHeroClawConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_CLAW_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroClawConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You grab', hint: 'Your claw grabs the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe grabs', hint: 'The foe claw grabs your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Fumble (3)', hint: 'Your claw grabs for 3: Fumble, a short lift and a drop.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Shake (8)', hint: 'Your claw grabs for 8: Shake, three hard shakes and a drop from height.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Shake (12)', hint: 'Your claw grabs for 12 from four numbers: still Shake (an Epic has three looks).', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Prize (40)', hint: 'Your claw grabs for 40 from seven numbers: Prize, carried to the chute.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe fumble (3)', hint: 'The foe claw grabs your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe shake (8)', hint: 'The foe claw grabs your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe prize (40)', hint: 'The foe claw grabs your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroClawTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
