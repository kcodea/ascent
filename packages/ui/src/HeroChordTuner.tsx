import {
  HERO_CHORD_DEFAULTS, HERO_CHORD_RANGES, CHORD_LEVELS, CHORD_LEVEL_NAMES, CHORD_LEVEL_SUFFIXES, getHeroChordConfig, heroChordConfigJson,
  resetHeroChordConfig, setHeroChordValue, chordPlan,
  type HeroChordConfig, type HeroChordNumKey, type HeroChordStrKey, type ChordLevel, type ChordLevelSuffix,
} from './heroChord/heroChordConfig';
import { clipNames } from './sfx';
import { DEV_HERO_ATTACK_CHOICES, DEV_HERO_ATTACK_LABELS, devHeroAttackChoice, setDevHeroAttackChoice } from './heroBlast/heroAttackStyle';
import { playHeroChord, type HeroChordHandle, type HeroChordOptions } from './heroChord/heroChord';
import { boardOfDamage, playAttackDemo, previewLeadIn, previewParts } from './heroAttack/attackDemo';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the POWER CHORD hero attack (an Epic, 2026-11-12; in progress, no cosmetic yet). Three looks: Small (one
 * note rides the staff), Medium (a three-note chord) and Big (a speaker stack and its bass wave). The Play buttons run
 * the REAL runner between the two real hero portraits, in either direction. A preview never touches the run. Production
 * plays the baked defaults.
 */
type ChordTunerValues = HeroChordConfig & { attackStyle: string };

type Spec = [string, TunerUnit | undefined, string, string];
type GlobalNumKey = Exclude<HeroChordNumKey, `v${number}${string}`>;

const SPECS: Record<GlobalNumKey, Spec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the Play buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Medium from', undefined, 'Damage at which the shared Tier II starts (Power Chord plays Medium from here). Shared with every style (6).', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'The shared Tier III (still Medium for an Epic). Shared (12).', 'Damage tiers'],
  tier4At: ['Big from', undefined, 'Damage at which the shared Tier IV starts: the speakers. Shared (20). A knockout always plays it.', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Wind-up'],
  heroCoilPx: ['Lean back', 'px', 'How far the hero leans back while the staff strings out.', 'Wind-up'],
  heroThrustPx: ['Thrust', 'px', 'How far the hero is thrown forward as it plays.', 'Wind-up'],
  staffGap: ['Line gap', 'px', 'The gap between two lines of the staff.', 'The staff'],
  staffSag: ['Sag', '×', 'How far the staff sags in the middle, as a fraction of its length.', 'The staff'],
  staffWidth: ['Line width', 'px', 'How thick each line is.', 'The staff'],
  staffGlow: ['Line glow', '×', 'How wide the soft glow round each line is, as a multiple of the line.', 'The staff'],
  stringMs: ['String out', 'ms', 'How long one line takes to draw itself across.', 'The staff'],
  stringStaggerMs: ['String gap', 'ms', 'The delay between one line and the next.', 'The staff'],
  pluckPx: ['Twang', 'px', 'How far a line swings as it pulls taut, and behind a note riding it.', 'The staff'],
  thrumPx: ['Thrum', 'px', 'How far every line swings when a chord (or the wave) lands.', 'The staff'],
  vibHz: ['Vibration speed', undefined, 'How fast a struck line swings (per second).', 'The staff'],
  vibMs: ['Vibration length', 'ms', 'How long a struck line takes to die away.', 'The staff'],
  slackMs: ['Go slack', 'ms', 'How long the staff takes to droop and fade at the end.', 'The staff'],
  chordSpread: ['Chord fan', '×', 'Medium: how far apart the three notes sit along the staff (a fraction of its length).', 'The chord (Medium)'],
  stackSize: ['Stack size', '×', 'Big: how big the speaker stack is.', 'The speakers (Big)'],
  dropMs: ['Drop', 'ms', 'Big: how long the stack takes to fall in.', 'The speakers (Big)'],
  beatMs: ['Beat', 'ms', 'Big: the count-in. The thud, the two pumps and the drop are one beat apart.', 'The speakers (Big)'],
  pumpScale: ['Cone kick', '×', 'Big: how far a cone leaps out on a pump.', 'The speakers (Big)'],
  waveBands: ['Wave bands', undefined, 'Big: how many arcs the bass wave is made of.', 'The speakers (Big)'],
  waveSize: ['Wave thickness', '×', 'Big: how thick each arc is.', 'The speakers (Big)'],
  bendPx: ['Staff bend', 'px', 'Big: how far the wave pushes the staff as its front crosses.', 'The speakers (Big)'],
  blowSkew: ['Blow-back lean', '°', 'Big: how far the struck portrait leans over as the wave hits.', 'The speakers (Big)'],
  blowPx: ['Blow-back shove', 'px', 'Big: how far the struck portrait is shoved downwind.', 'The speakers (Big)'],
  flashAlpha: ['Flash', 'opacity', 'How bright the impact flash is.', 'Camera and portraits'],
  knockPx: ['Knockback', 'px', 'Small and Medium: how far the struck portrait is knocked back.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxStringGain: ['strings: gain', undefined, 'The five quiet plucks as the staff strings itself.', 'Sound: strings'],
  sfxStringRate: ['strings: pitch', '×', 'Pitch of the first string (the others walk up a scale from it).', 'Sound: strings'],
  sfxPluckGain: ['pluck: gain', undefined, 'Small: the single guitar note.', 'Sound: pluck'],
  sfxPluckRate: ['pluck: pitch', '×', 'Pitch of the note.', 'Sound: pluck'],
  sfxStrumGain: ['chord: gain', undefined, 'Medium and Big: the power chord.', 'Sound: chord'],
  sfxStrumRate: ['chord: pitch', '×', 'Pitch of the chord.', 'Sound: chord'],
  sfxBassGain: ['bass: gain', undefined, 'Big: the bass drop as the wave leaves the speakers.', 'Sound: bass'],
  sfxBassRate: ['bass: pitch', '×', 'Pitch of the bass drop (lower = deeper).', 'Sound: bass'],
  sfxThudGain: ['thud: gain', undefined, 'Big: the stack landing, and under the impact.', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: thud'],
  sfxPumpGain: ['pump: gain', undefined, 'Big: the two count-in thumps.', 'Sound: pump'],
  sfxPumpRate: ['pump: pitch', '×', 'Pitch of the count-in thumps.', 'Sound: pump'],
  sfxImpactGain: ['impact: gain', undefined, 'THE impact.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxImpactLenMs: ['impact length', 'ms', 'The impact clip is cut to about this long (with a fade).', 'Sound: mix'],
  sfxTailMix: ['tail', undefined, 'A short reverb tail on the note, the chord, the bass and the impact. 0 = dry.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<ChordLevelSuffix, [string, TunerUnit | undefined, string]> = {
  ChargeMs: ['Wind-up', 'ms', 'From the staff starting to string until the hero plays (Big: until the speakers start to fall).'],
  FlyMs: ['Ride', 'ms', 'How long the note or the chord takes to ride the staff (Big: the bass wave crossing to the target).'],
  NoteSize: ['Note size', '×', 'How big the riding notes are (Big: unused, its notes wait on the staff).'],
  Notes: ['Burst notes', undefined, 'Small notes thrown off the struck portrait in a ring.'],
  Sparks: ['Sparks', undefined, 'Sparks thrown by the impact.'],
  HoldMs: ['Ring on', 'ms', 'How long the staff keeps ringing after the impact before it goes slack.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the wind-up.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  Burst: ['Burst size', '×', 'Scale of the impact flash, rings and thrown notes.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const CLIP_OF: Partial<Record<string, HeroChordStrKey>> = {
  'Sound: strings': 'sfxStringClip', 'Sound: pluck': 'sfxPluckClip', 'Sound: chord': 'sfxStrumClip', 'Sound: bass': 'sfxBassClip',
  'Sound: thud': 'sfxThudClip', 'Sound: pump': 'sfxPumpClip', 'Sound: impact': 'sfxImpactClip',
};

const COLORS: [HeroChordStrKey, string, string][] = [
  ['colorStaff', 'Staff', 'The five lines of the staff.'],
  ['colorNoteA', 'Note 1', 'The single note, the first note of the chord, and a third of the burst.'],
  ['colorNoteB', 'Note 2', 'The second note of the chord, and a third of the burst.'],
  ['colorNoteC', 'Note 3', 'The third note of the chord, and a third of the burst.'],
  ['colorWave', 'Bass wave', 'The bass wave and the rings off the cones.'],
  ['colorPlayer', 'Your side', 'The staff glow and total colour when YOU strike.'],
  ['colorFoe', 'Foe side', 'The staff glow and total colour when THEY strike.'],
];

type Ctl = TunerControl<Extract<keyof ChordTunerValues, string>>;

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
  const push = (key: HeroChordNumKey, [label, unit, hint, group]: Spec): void => {
    const [min, max, step] = HERO_CHORD_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  };
  const globals = Object.entries(SPECS) as [GlobalNumKey, Spec][];
  for (const [key, spec] of globals) if (!spec[3].startsWith('Sound')) push(key, spec);
  for (const v of CHORD_LEVELS) {
    for (const s of CHORD_LEVEL_SUFFIXES) {
      const [label, unit, hint] = LEVEL_SPECS[s];
      const key = `v${v}${s}` as HeroChordNumKey;
      const [min, max, step] = HERO_CHORD_RANGES[key];
      out.push({ key, label, unit, hint, group: CHORD_LEVEL_NAMES[v as ChordLevel], min, max, step });
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

let live: HeroChordHandle | null = null;

/** Play the real Power Chord between the two portraits, from the shop or a fight, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { damage?: number; parts?: number; reduced?: boolean; frames?: HeroChordOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroChordHandle | null> {
  live?.cancel();
  const cfg = getHeroChordConfig();
  return playAttackDemo(side, (o) => playHeroChord(o), {
    board: boardOfDamage(opts.damage ?? cfg.previewDamage, opts.parts ?? cfg.previewParts),
    speed: 1, reduced: opts.reduced, frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroChord?: unknown }).__heroChord = { demo, previewParts, play: playHeroChord };
}

const LOOK_OF: Record<ChordLevel, string> = { 1: 'one note', 2: 'a three-note chord', 3: 'the speakers' };

export const SPEC: TunerSpec<ChordTunerValues> = {
  id: 'herochord',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Power Chord (Epic)',
  note: () => {
    const c = getHeroChordConfig();
    const p = chordPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${CHORD_LEVEL_NAMES[p.level]} (${LOOK_OF[p.level]}) · play ${Math.round(p.releaseAt)} · impact ${Math.round(p.impactAt)} · end ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getHeroChordConfig(), attackStyle: devHeroAttackChoice() }),
  write: (key, value) => setHeroChordValue(key as keyof HeroChordConfig, value),
  writeColor: (key, value) => { if (key === 'attackStyle') setDevHeroAttackChoice(value); else setHeroChordValue(key as keyof HeroChordConfig, value); },
  reset: () => { resetHeroChordConfig(); setDevHeroAttackChoice('auto'); },
  defaults: { ...HERO_CHORD_DEFAULTS, attackStyle: 'auto' },
  controls: buildControls(),
  copy: () => heroChordConfigJson(),
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You strike', hint: 'Your hero plays at the foe for the preview damage.', run: () => { void demo('player'); } },
    { label: '▶ Foe strikes', hint: 'The foe plays at your hero for the preview damage.', run: () => { void demo('opp'); } },
    { label: '▶ Small (3)', hint: 'Your hero strikes for 3: Small, one note rides the staff.', run: () => { void demo('player', { damage: 3, parts: 2 }); } },
    { label: '▶ Medium (8)', hint: 'Your hero strikes for 8: Medium, a three-note chord.', run: () => { void demo('player', { damage: 8, parts: 3 }); } },
    { label: '▶ Medium (12)', hint: 'Your hero strikes for 12 from four numbers: still Medium (an Epic has three looks).', run: () => { void demo('player', { damage: 12, parts: 4 }); } },
    { label: '▶ Big (40)', hint: 'Your hero strikes for 40 from seven numbers: Big, the speaker stack and its bass wave.', run: () => { void demo('player', { damage: 40, parts: 7 }); } },
    { label: '▶ Foe small (3)', hint: 'The foe strikes your hero for 3.', run: () => { void demo('opp', { damage: 3, parts: 2 }); } },
    { label: '▶ Foe medium (8)', hint: 'The foe strikes your hero for 8.', run: () => { void demo('opp', { damage: 8, parts: 3 }); } },
    { label: '▶ Foe big (40)', hint: 'The foe strikes your hero for 40.', run: () => { void demo('opp', { damage: 40, parts: 7 }); } },
  ],
};

export function HeroChordTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
