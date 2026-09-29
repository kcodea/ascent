import {
  FORMATION_CLIP_KEYS, FORMATION_DEFAULTS, FORMATION_RANGES, formationConfigJson, formationPlan, 
  getFormationConfig, resetFormationConfig, setFormationValue,
  type FormationConfig, type FormationNumKey,
} from './heroAttack/formationConfig';
import { playAttackDemo, previewFormation, previewTiers, type PreviewBoard } from './heroAttack/attackDemo';
import { playHeroClassic } from './heroAttack/heroClassic';
import {
  CLASSIC_DEFAULTS, CLASSIC_RANGES, getClassicConfig, resetClassicConfig, setClassicValue, type ClassicConfig, type ClassicNumKey,
} from './heroAttack/classicConfig';
import type { HeroAttackHandle, HeroAttackOptions } from './heroAttack/options';
import { formationCapped } from './heroAttack/damageFormation';
import { playHeroBlast } from './heroBlast/heroBlast';
import { playHeroQuake } from './heroQuake/heroQuake';
import { playHeroArcana } from './heroArcana/heroArcana';
import { playHeroBlades } from './heroBlades/heroBlades';
import { clipNames } from './sfx';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for THE DAMAGE FORMATION every hero attack opens with (owner ask 2026-09-28: the minion tiers pulse left to
 * right, flow up and merge, the hero's tier joins, the full damage shows, then it reduces to the cap). One shared
 * tuner, because every style (Classic, Blast, Quake, Arcana, Phantom Blades) plays the SAME formation.
 *
 * The Play buttons run the real formation, then the chosen attack, between the two real hero portraits (works from
 * the shop; the numbers rise off your real cards' tier badges when you have cards up), on a chosen board: how many
 * minions, their tiers (spread low to high across the row), the hero's tier and a round cap (0 = uncapped). A preview
 * never touches the run. Always 1x, full motion. localStorage in DEV only; production plays the baked defaults.
 */
const STYLES = ['classic', 'blast', 'quake', 'arcana', 'blades'] as const;
type PreviewStyle = (typeof STYLES)[number];
const STYLE_LABELS: Record<PreviewStyle, string> = { classic: 'Classic (lunge)', blast: 'Blast', quake: 'Quake', arcana: 'Arcana', blades: 'Phantom Blades' };
let previewStyle: PreviewStyle = 'classic';

type FormationTunerValues = FormationConfig & ClassicConfig & { previewStyle: string };
type Spec = [string, TunerUnit | undefined, string, string];

const SPECS: Record<FormationNumKey, Spec> = {
  previewMinions: ['Minions', undefined, 'Survivors on the preview board (0 to 7).', 'Preview board'],
  previewTierLo: ['Left tier', undefined, 'The leftmost survivor\'s tier. The row spreads from this to the right tier.', 'Preview board'],
  previewTierHi: ['Right tier', undefined, 'The rightmost survivor\'s tier.', 'Preview board'],
  previewHeroTier: ['Hero tier', undefined, 'The attacking hero\'s tier.', 'Preview board'],
  previewCap: ['Round cap', undefined, 'The round\'s damage cap (0 = uncapped). Above the cap, the cap beat plays.', 'Preview board'],
  pulseStaggerMs: ['Pulse stagger', 'ms', 'Gap between one minion\'s pulse and the next, left to right.', 'Timing: pulses'],
  pulseSpanMs: ['Pulse span', 'ms', 'The whole row pulses inside this; a full board compresses the stagger to fit.', 'Timing: pulses'],
  pulseMs: ['Badge pulse', 'ms', 'How long a tier badge swells and settles.', 'Timing: pulses'],
  popMs: ['Number pop', 'ms', 'A number popping up off its badge (and the hero\'s popping in).', 'Timing: pulses'],
  popHoldMs: ['Hold before merge', 'ms', 'The row of numbers holds this long after the last pops.', 'Timing: pulses'],
  mergeFlyMs: ['Merge flight', 'ms', 'Each number flowing up into the minion total.', 'Timing: merge'],
  mergeStaggerMs: ['Merge stagger', 'ms', 'Gap between the numbers leaving (each lands with a tick).', 'Timing: merge'],
  mergeSpanMs: ['Merge span', 'ms', 'The most the merge stagger can add up to on a full board.', 'Timing: merge'],
  heroDelayMs: ['Hero number', 'ms', 'When the hero\'s number pops in, from the minion total\'s slam (negative = a little before).', 'Timing: hero and join'],
  heroHoldMs: ['Hero hold', 'ms', 'The hero\'s number is read before the join starts.', 'Timing: hero and join'],
  joinFlyMs: ['Join flight', 'ms', 'One number flying into the other.', 'Timing: hero and join'],
  fullHoldMs: ['Full hold', 'ms', 'Uncapped: the full damage holds this long before the attack.', 'Timing: full and cap'],
  cappedHoldMs: ['Full before cap', 'ms', 'Capped: the full damage holds this long before it reduces.', 'Timing: full and cap'],
  capMs: ['Reduce', 'ms', 'The number counting down to the cap.', 'Timing: full and cap'],
  stampAt: ['Stamp at', '×', 'When the "Damage capped" stamp lands, through the count-down (1 = as it hits the cap).', 'Timing: full and cap'],
  capHoldMs: ['Capped hold', 'ms', 'The capped number and stamp hold this long before the attack.', 'Timing: full and cap'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, each stage just fades over this.', 'Timing: full and cap'],
  pulseStrength: ['Pulse strength', '×', 'How much a tier badge swells on its pulse.', 'Look'],
  ringSize: ['Pulse ring', '×', 'The ring that bursts off a pulsing badge (0 = none).', 'Look'],
  chipSize: ['Minion number', 'px', 'Size of each minion\'s tier number.', 'Look'],
  mergeSize: ['Minion total', 'px', 'Size of the merged minion number.', 'Look'],
  heroSize: ['Hero number', 'px', 'Size of the hero\'s tier number.', 'Look'],
  fullSize: ['Full damage', 'px', 'Size of the full damage (and the hit number, at 0.8x).', 'Look'],
  stampSize: ['Stamp', 'px', 'Size of the "Damage capped" stamp.', 'Look'],
  stampTilt: ['Stamp tilt', '°', 'The stamp\'s angle.', 'Look'],
  stampPop: ['Stamp slam', '×', 'How big the stamp slams in before it settles.', 'Look'],
  fullPop: ['Full slam', '×', 'How big the full damage slams in before it settles.', 'Look'],
  slamMs: ['Slam settle', 'ms', 'The merge and full slams settling.', 'Look'],
  riseLift: ['Rise', 'px', 'How far a number rises above its badge.', 'Motion'],
  mergeLift: ['Merge height', 'px', 'How far above the row the numbers merge.', 'Motion'],
  mergeArc: ['Merge arc', '×', 'How much the numbers curve as they flow up.', 'Motion'],
  joinArc: ['Join arc', '×', 'How much the join curves.', 'Motion'],
  capShake: ['Reduce shake', 'px', 'How hard the number rattles as it reduces.', 'Motion'],
  joinDir: ['Join direction', undefined, 'Off: the minion number joins the hero\'s (at the hero). On: the hero\'s joins the minions\'.', 'Motion'],
  sfxPulseGain: ['pulse: gain', undefined, 'Each badge pulsing (a step higher each).', 'Sound: pulse'],
  sfxPulseRate: ['pulse: pitch', '×', 'The first pulse pitch.', 'Sound: pulse'],
  sfxPulseStep: ['pulse: pitch step', '×', 'Each next pulse rises by this much.', 'Sound: pulse'],
  sfxFlowGain: ['flow: gain', undefined, 'The whoosh as the numbers flow up.', 'Sound: flow'],
  sfxFlowRate: ['flow: pitch', '×', 'Pitch of the whoosh.', 'Sound: flow'],
  sfxLandGain: ['land: gain', undefined, 'Each number landing in the minion total.', 'Sound: land'],
  sfxLandRate: ['land: pitch', '×', 'The first landing pitch.', 'Sound: land'],
  sfxLandStep: ['land: pitch step', '×', 'Each next landing rises by this much.', 'Sound: land'],
  sfxMergeGain: ['merge: gain', undefined, 'The minion total slamming in.', 'Sound: merge'],
  sfxMergeRate: ['merge: pitch', '×', 'Pitch of the merge slam.', 'Sound: merge'],
  sfxHeroGain: ['hero: gain', undefined, 'The hero\'s number popping in.', 'Sound: hero'],
  sfxHeroRate: ['hero: pitch', '×', 'Pitch of the hero pop.', 'Sound: hero'],
  sfxJoinGain: ['join: gain', undefined, 'The two numbers joining.', 'Sound: join'],
  sfxJoinRate: ['join: pitch', '×', 'Pitch of the join.', 'Sound: join'],
  sfxFullGain: ['full: gain', undefined, 'A low punch under the full damage.', 'Sound: full'],
  sfxFullRate: ['full: pitch', '×', 'Pitch of the punch.', 'Sound: full'],
  sfxSlashGain: ['slash: gain', undefined, 'The heavy slash hitting the full damage.', 'Sound: slash'],
  sfxSlashRate: ['slash: pitch', '×', 'Pitch of the slash (lower = heavier).', 'Sound: slash'],
  sfxCapGain: ['reduce: gain', undefined, 'The number crunching down to the cap.', 'Sound: reduce'],
  sfxCapRate: ['reduce: pitch', '×', 'Pitch of the crunch.', 'Sound: reduce'],
  sfxStampGain: ['stamp: gain', undefined, 'The "Damage capped" stamp slamming on.', 'Sound: stamp'],
  sfxStampRate: ['stamp: pitch', '×', 'Pitch of the stamp.', 'Sound: stamp'],
  sfxTickLenMs: ['tick length', 'ms', 'Each pulse, landing and hero tick is cut to this long (with a short fade).', 'Sound: mix'],
};

const CLASSIC_SPECS: Record<ClassicNumKey, Spec> = {
  absorbMs: ['Absorb', 'ms', 'The finished number sinking into the striking hero (the wind-up starts halfway through).', 'Classic: swing'],
  tempo: ['Tempo', '×', 'The swing plays the ⚔️ Lunge tuner wind-up and strike at this speed (1.15 = the old Classic strike).', 'Classic: swing'],
  settleMs: ['Settle', 'ms', 'Hold after the hero has come to rest before the sequence ends.', 'Classic: swing'],
  shakePx: ['Shake', 'px', 'How hard the view shakes along the blow. Keep it small (owner: do not overdo it).', 'Classic: impact'],
  shakeMs: ['Shake length', 'ms', 'How long the shake and the punch take to die away.', 'Classic: impact'],
  punch: ['Punch', '×', 'A small push in on the target on contact.', 'Classic: impact'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back.', 'Classic: impact'],
  squash: ['Squash', '×', 'How much the struck portrait squashes.', 'Classic: impact'],
  impactPower: ['Burst weight', '×', 'Scales the blow handed to the shared strike burst (3.45 = the old Classic).', 'Classic: impact'],
};

const CLIP_OF: Record<string, (typeof FORMATION_CLIP_KEYS)[number]> = {
  'Sound: pulse': 'sfxPulseClip', 'Sound: flow': 'sfxFlowClip', 'Sound: land': 'sfxLandClip', 'Sound: merge': 'sfxMergeClip',
  'Sound: hero': 'sfxHeroClip', 'Sound: join': 'sfxJoinClip', 'Sound: full': 'sfxFullClip', 'Sound: slash': 'sfxSlashClip', 'Sound: reduce': 'sfxCapClip',
  'Sound: stamp': 'sfxStampClip',
};

type Ctl = TunerControl<Extract<keyof FormationTunerValues, string>>;

function buildControls(): Ctl[] {
  const out: Ctl[] = [{
    key: 'previewStyle', label: 'Then play', kind: 'select', options: STYLES, optionLabels: STYLE_LABELS, group: 'Preview board',
    hint: 'Which attack the Play buttons run after the formation (preview only).', min: 0, max: 0, step: 0,
  }];
  let clips: string[] = [];
  try { clips = clipNames(); } catch { /* no audio here */ }
  let lastGroup = '';
  for (const [key, [label, unit, hint, group]] of Object.entries(SPECS) as [FormationNumKey, Spec][]) {
    const clipKey = CLIP_OF[group];
    if (clipKey && group !== lastGroup) {
      out.push({ key: clipKey, label: `${group.replace('Sound: ', '')}: clip`, hint: 'Which clip this cue plays. (none) = silent.', group, kind: 'select', options: ['', ...clips], optionLabels: { '': '(none)' }, min: 0, max: 0, step: 0 });
    }
    lastGroup = group;
    const [min, max, step] = FORMATION_RANGES[key];
    out.push(key === 'joinDir'
      ? { key, label, hint, group, min, max, step, kind: 'toggle', onValue: 1, offValue: 0 }
      : { key, label, unit, hint, group, min, max, step });
  }
  for (const [key, [label, unit, hint, group]] of Object.entries(CLASSIC_SPECS) as [ClassicNumKey, Spec][]) {
    const [min, max, step] = CLASSIC_RANGES[key];
    out.push({ key, label, unit, hint, group, min, max, step });
  }
  return out;
}

const isClassicKey = (k: string): k is keyof ClassicConfig => k in CLASSIC_DEFAULTS;

/** The preview board from the tuner (or an override). */
export function boardOf(over: Partial<{ minions: number; lo: number; hi: number; hero: number; cap: number }> = {}): PreviewBoard {
  const c = getFormationConfig();
  const lo = over.lo ?? c.previewTierLo, hi = over.hi ?? c.previewTierHi;
  return { minionTiers: previewTiers(over.minions ?? c.previewMinions, lo, hi), heroTier: over.hero ?? c.previewHeroTier, cap: over.cap ?? c.previewCap };
}

const RUNNERS: Record<PreviewStyle, (o: HeroAttackOptions) => HeroAttackHandle> = {
  classic: playHeroClassic, blast: playHeroBlast, quake: playHeroQuake, arcana: playHeroArcana, blades: playHeroBlades,
};

let live: HeroAttackHandle | null = null;

/** Play the formation (then the chosen attack) between the portraits, on a board, without touching the run. */
export function demo(
  side: 'player' | 'opp',
  opts: { board?: PreviewBoard; reduced?: boolean; flip?: boolean; style?: PreviewStyle; frames?: HeroAttackOptions['frames']; sound?: boolean; safety?: boolean } = {},
): Promise<HeroAttackHandle | null> {
  live?.cancel();
  const c = getFormationConfig();
  const formationCfg = opts.flip ? { ...c, joinDir: c.joinDir === 1 ? 0 : 1 } : c;
  return playAttackDemo(side, RUNNERS[opts.style ?? previewStyle], {
    board: opts.board ?? boardOf(), speed: 1, reduced: opts.reduced, formationCfg,
    frames: opts.frames, sound: opts.sound, safety: opts.safety,
  }, () => { live = null; }).then((h) => { live = h; return h; });
}

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __dmgFormation?: unknown }).__dmgFormation = { demo, boardOf };
}

export const SPEC: TunerSpec<FormationTunerValues> = {
  id: 'dmgformation',                // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Damage Formation',
  note: () => {
    const c = getFormationConfig();
    const b = boardOf();
    const { data } = previewFormation(b);
    const p = formationPlan({ minions: b.minionTiers.length, hero: true, capped: formationCapped(data) }, c);
    return `dev · ${b.minionTiers.length} minion${b.minionTiers.length === 1 ? '' : 's'} · ${data.full}${p.capped ? ` capped to ${data.total}` : ''} · join ${Math.round(p.joinAt)} · attack at ${Math.round(p.endAt)} ms`;
  },
  read: () => ({ ...getFormationConfig(), ...getClassicConfig(), previewStyle }),
  write: (key, value) => { if (isClassicKey(key)) setClassicValue(key, value); else setFormationValue(key as keyof FormationConfig, value); },
  writeColor: (key, value) => {
    if (key === 'previewStyle') { if ((STYLES as readonly string[]).includes(value)) previewStyle = value as PreviewStyle; }
    else if (isClassicKey(key)) setClassicValue(key, value);
    else setFormationValue(key as keyof FormationConfig, value);
  },
  reset: () => { resetFormationConfig(); resetClassicConfig(); previewStyle = 'classic'; },
  defaults: { ...FORMATION_DEFAULTS, ...CLASSIC_DEFAULTS, previewStyle: 'classic' },
  controls: buildControls(),
  copy: () => `{"formation": ${formationConfigJson()},
"classic": ${JSON.stringify(getClassicConfig(), null, 2)}}`,
  copyLabel: 'Copy JSON',
  buttonsOnTop: true,
  actions: [
    { label: '▶ You attack', hint: 'Your hero builds the preview board\'s damage, then attacks the foe.', run: () => { void demo('player'); } },
    { label: '▶ Foe attacks', hint: 'The foe builds the preview board\'s damage, then attacks your hero.', run: () => { void demo('opp'); } },
    { label: '▶ Other direction', hint: 'The preview board with the join played the other way round (this play only).', run: () => { void demo('player', { flip: true }); } },
    { label: '▶ 1 minion', hint: 'One tier 3 survivor, hero tier 2, uncapped.', run: () => { void demo('player', { board: boardOf({ minions: 1, lo: 3, hi: 3, hero: 2, cap: 0 }) }); } },
    { label: '▶ 4 minions, capped', hint: 'Tiers 2 to 5, hero tier 4 (18), capped to 10.', run: () => { void demo('player', { board: boardOf({ minions: 4, lo: 2, hi: 5, hero: 4, cap: 10 }) }); } },
    { label: '▶ Full board, capped', hint: 'Seven survivors, tiers 3 to 6, hero tier 6, capped to 20.', run: () => { void demo('player', { board: boardOf({ minions: 7, lo: 3, hi: 6, hero: 6, cap: 20 }) }); } },
    { label: '▶ Full board, uncapped', hint: 'Seven survivors, tiers 1 to 6, hero tier 5, no cap (round 16 on).', run: () => { void demo('player', { board: boardOf({ minions: 7, lo: 1, hi: 6, hero: 5, cap: 0 }) }); } },
    { label: '▶ No minions', hint: 'Only the hero\'s tier (an older result with no breakdown plays like this too).', run: () => { void demo('player', { board: boardOf({ minions: 0, hero: 4, cap: 0 }) }); } },
  ],
};

export function DamageFormationTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
