import {
  COMBO_LEVELS, COMBO_TIER_SUFFIXES, HERO_COMBO_DEFAULTS, HERO_COMBO_RANGES, comboPlan, getHeroComboConfig,
  heroComboStore, type ComboTierSuffix,
} from './heroCombo/heroComboConfig';
import { playHeroCombo } from './heroCombo/heroCombo';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the COMBO hero attack ("Flawless", attack_combo, a Legendary): the blow played as an
 * arcade fighting game combo with a HUD, a combo counter that counts the hits, call-outs and K.O. Four groups of per-tier
 * dials (Tier 1 the counter, Tier 2 the string, Tier 3 the launcher, Tier 4 the super), the fight's geometry, the HUD,
 * the colours (one per tier) and one clip / gain / pitch row per sound cue. The Play buttons run the real runner between
 * the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier 2 from', undefined, 'Shared damage Tier 2 (6): the string.', 'Damage tiers'],
  tier3At: ['Tier 3 from', undefined, 'Shared damage Tier 3 (12): the launcher.', 'Damage tiers'],
  tier4At: ['Tier 4 from', undefined, 'Shared damage Tier 4 (20): the super (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  stance: ['Stance gap', '×', 'How close the striker stands beside the target (1 = just touching).', 'The fight'],
  windMs: ['First wind-up', 'ms', 'After stepping in, before the first hit lands.', 'The fight'],
  hitFreezeMs: ['Hit-freeze', 'ms', 'How long both portraits hold the contact pose on every hit (visuals only: the clock never stops).', 'The fight'],
  lunge: ['Lunge', '×', 'How far the striker lunges on a hit (striker radii).', 'The fight'],
  flinch: ['Flinch', '×', 'How far the target is knocked by a hit (target radii).', 'The fight'],
  flinchRot: ['Flinch rock', '°', 'How far the target rocks with a hit.', 'The fight'],
  skew: ['Contact smear', '°', 'How far a struck portrait skews on contact (the impact frame).', 'The fight'],
  sparkSize: ['Hit size', '×', 'The live hit effects (core, blades, speed lines, ring, sparks).', 'The fight'],
  counterSize: ['Counter size', '×', 'The combo counter (it counts the hits landed).', 'The HUD'],
  feintMs: ['Lunge', 'ms', 'Tier 1: the struck portrait\'s own lunge, before it is parried.', 'Tier 1: the counter'],
  parryMs: ['Parry to counter', 'ms', 'Tier 1: from the parry to the counter-hit (THE impact).', 'Tier 1: the counter'],
  calloutSize: ['Call-out size', '×', 'COUNTER, BREAKER? and PERFECT (0 = none).', 'The HUD'],
  dizzyMs: ['Dizzy', 'ms', 'Tier 2 and Tier 3: how long the struck portrait reels with birds round its head.', 'The HUD'],
  perfectDelayMs: ['PERFECT delay', 'ms', 'Tier 4: how long after K.O. PERFECT pops.', 'The HUD'],
  koHoldMs: ['K.O. hold', 'ms', 'Tier 4: how long the K.O. word stays up.', 'The HUD'],
  flashAlpha: ['Impact flash', 'opacity', 'Tier 4: the whole-screen white flash on the heavy blow (Tier 3\'s slam, Tier 1\'s counter and K.O. use part of it).', 'Camera and portraits'],
  koSize: ['K.O. size', '×', 'Tier 4: the K.O. word (0 = none).', 'The HUD'],
  koDelayMs: ['K.O. delay', 'ms', 'Tier 4: how long after the heavy blow K.O. slams in.', 'The HUD'],
  launchMs: ['Uppercut gap', 'ms', 'Tier 3: the beat before the uppercut.', 'Tier 3: the launcher'],
  launchHeight: ['Launch height', '×', 'Tier 3: how high the target is launched (target radii; less when the screen has no room).', 'Tier 3: the launcher'],
  jumpDelayMs: ['Jump delay', 'ms', 'Tier 3: how long after the launch the striker jumps.', 'Tier 3: the launcher'],
  jumpMs: ['Jump', 'ms', 'Tier 3: the striker\'s jump up to the target.', 'Tier 3: the launcher'],
  airHits: ['Air hits', undefined, 'Tier 3: the juggle\'s hits (each fight rolls this many or one fewer).', 'Tier 3: the launcher'],
  airGapMs: ['Air gap', 'ms', 'Tier 3: the time between air hits.', 'Tier 3: the launcher'],
  airBob: ['Air bob', '×', 'Tier 3: how far the target bobs up with each air hit.', 'Tier 3: the launcher'],
  breakMs: ['Struggle', 'ms', 'Tier 3: the struck portrait struggles in the air (BREAKER?) before the spike.', 'Tier 3: the launcher'],
  spikeMs: ['Spike gap', 'ms', 'Tier 3: after the struggle, the beat before the spike.', 'Tier 3: the launcher'],
  slamMs: ['Slam', 'ms', 'Tier 3: the fall from the spike into the socket (THE impact).', 'Tier 3: the launcher'],
  openHits: ['Opening hits', undefined, 'Tier 4: the hits before the super freeze.', 'Tier 4: the super'],
  freezeDelayMs: ['Freeze delay', 'ms', 'Tier 4: from the last opening hit to the super freeze.', 'Tier 4: the super'],
  cutinMs: ['Cut-in', 'ms', 'Tier 4: the whole super freeze (the band in, the inputs, the band out).', 'Tier 4: the super'],
  cutinSlideMs: ['Cut-in slide', 'ms', 'Tier 4: the band sliding in, and out.', 'Tier 4: the super'],
  cutinDim: ['Cut-in dim', 'opacity', 'Tier 4: how dark the screen goes behind the band.', 'Tier 4: the super'],
  cutinTilt: ['Cut-in tilt', '°', 'Tier 4: the band\'s slant.', 'Tier 4: the super'],
  cutinHeight: ['Cut-in height', '×', 'Tier 4: the band\'s height, as a part of the screen.', 'Tier 4: the super'],
  barsH: ['Letterbox', '×', 'Tier 4: the black bars\' height, as a part of the screen (0 = none).', 'Tier 4: the super'],
  flurryHits: ['Flurry hits', undefined, 'Tier 4: the rapid small hits after the cut-in. Ticks: no damage.', 'Tier 4: the super'],
  flurryGapMs: ['Flurry gap', 'ms', 'Tier 4: the time between flurry hits.', 'Tier 4: the super'],
  heavyWindMs: ['Heavy wind-up', 'ms', 'Tier 4: from the last flurry hit to the heavy blow (THE impact).', 'Tier 4: the super'],
  koLaunch: ['K.O. launch', '×', 'Tier 4: how far the target is sent flying (kept on screen).', 'Tier 4: the super'],
  koSpin: ['K.O. spin', undefined, 'Tier 4: how many turns the target spins as it flies.', 'Tier 4: the super'],
  squash: ['Squash', '×', 'How much the portraits squash (hits, the slam, the K.O.).', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxStepGain: ['whoosh: gain', undefined, 'The step in, Tier 1\'s lunge, Tier 2\'s strike trails, the launch, the jump, the spike and the flurry starting.', 'Sound: whoosh'],
  sfxStepRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxHitGain: ['hit: gain', undefined, 'Every hit of the combo (one clip, re-pitched by the kind of hit) and the input ticks.', 'Sound: hit'],
  sfxHitRate: ['hit: pitch', '×', 'Pitch of the hits.', 'Sound: hit'],
  sfxHeavyGain: ['heavy: gain', undefined, 'The finishing blow: Tier 1\'s counter, Tier 2\'s roundhouse, Tier 3\'s slam, Tier 4\'s heavy blow.', 'Sound: heavy'],
  sfxHeavyRate: ['heavy: pitch', '×', 'Pitch of the heavy blow.', 'Sound: heavy'],
  sfxSuperGain: ['super: gain', undefined, 'Tier 4: the super activating (the flash and the whoosh).', 'Sound: super'],
  sfxSuperRate: ['super: pitch', '×', 'Pitch of the super.', 'Sound: super'],
  sfxKoGain: ['K.O.: gain', undefined, 'Tier 4: the K.O. sting (an impact and a gong, no voice).', 'Sound: K.O.'],
  sfxKoRate: ['K.O.: pitch', '×', 'Pitch of the K.O. sting.', 'Sound: K.O.'],
  sfxPunchGain: ['punch: gain', undefined, 'The low body layer under every hit (lower and louder on the counter, the launcher, the spike and the heavy blow), the parry and the landings after the K.O. blow.', 'Sound: punch'],
  sfxPunchRate: ['punch: pitch', '×', 'Pitch of the body punch.', 'Sound: punch'],
  sfxChargeGain: ['charge: gain', undefined, 'Tier 4: the charge that climbs through the super freeze, and the riser into the heavy blow.', 'Sound: charge'],
  sfxChargeRate: ['charge: pitch', '×', 'Pitch of the charge.', 'Sound: charge'],
  sfxBoomGain: ['boom: gain', undefined, 'The deep boom under K.O., the heavy blow and Tier 3\'s slam.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxParryGain: ['parry: gain', undefined, 'Tier 1: the parry clash.', 'Sound: parry'],
  sfxParryRate: ['parry: pitch', '×', 'Pitch of parry.', 'Sound: parry'],
  sfxStruggleGain: ['struggle: gain', undefined, 'Tier 3: the rattle while the struck portrait struggles (BREAKER?).', 'Sound: struggle'],
  sfxStruggleRate: ['struggle: pitch', '×', 'Pitch of struggle.', 'Sound: struggle'],
  sfxDizzyGain: ['dizzy: gain', undefined, 'Tier 2 and Tier 3: the birds round the dizzy head.', 'Sound: dizzy'],
  sfxDizzyRate: ['dizzy: pitch', '×', 'Pitch of dizzy.', 'Sound: dizzy'],
  sfxVoCounterGain: ['"Counter!": gain', undefined, 'Tier 1: the announcer on the counter-hit.', 'Sound: "Counter!"'],
  sfxVoCounterRate: ['"Counter!": pitch', '×', 'Pitch of "Counter!".', 'Sound: "Counter!"'],
  sfxVoKoGain: ['"K.O.!": gain', undefined, 'Tier 4: the announcer on K.O.', 'Sound: "K.O.!"'],
  sfxVoKoRate: ['"K.O.!": pitch', '×', 'Pitch of "K.O.!".', 'Sound: "K.O.!"'],
  sfxVoPerfectGain: ['"Perfect!": gain', undefined, 'Tier 4: the announcer on PERFECT.', 'Sound: "Perfect!"'],
  sfxVoPerfectRate: ['"Perfect!": pitch', '×', 'Pitch of "Perfect!".', 'Sound: "Perfect!"'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<ComboTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'A beat before the striker steps in.'],
  StepMs: ['Step in', 'ms', 'The dash to the stance beside the target.'],
  GapMs: ['Hit gap', 'ms', 'The rhythm of the ground hits (Tier 2: the beat of the string). Tier 1: unused.'],
  HoldMs: ['Hold', 'ms', 'After the impact before the striker heads home (the counter stays up).'],
  ReturnMs: ['Return', 'ms', 'The striker hopping home.'],
  Knock: ['Knockback', '×', 'How far the target is knocked on the impact (Tier 1 and Tier 2).'],
  Zoom: ['Push in', '×', 'How far the view pushes in on the fight.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact (every other hit jolts a little).'],
  Burst: ['Burst', '×', 'The size of the impact (sparks, rings).'],
  Rings: ['Shockwaves', undefined, 'Rings off the impact.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

let previewRoll = 0;

const built = rareTunerSpec({
  id: 'herocombo', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Flawless (fighting game)',
  store: heroComboStore,
  defaults: HERO_COMBO_DEFAULTS,
  ranges: HERO_COMBO_RANGES,
  globals: GLOBALS,
  levels: COMBO_LEVELS,
  levelNames: { t1: 'Tier 1 (the counter)', t2: 'Tier 2 (the string)', t3: 'Tier 3 (the launcher)', t4: 'Tier 4 (the super)' },
  suffixes: COMBO_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorT1', 'Tier 1', 'Tier 1 (the counter): the parry, the hits, the trail (ice blue).'],
    ['colorT2', 'Tier 2', 'Tier 2 (the string): the hits and the strike trails (neon pink).'],
    ['colorT3', 'Tier 3', 'Tier 3 (the launcher): the launch, the hits, the slam (gold).'],
    ['colorT4', 'Tier 4', 'Tier 4 (the super): the hits, the heavy blow, K.O. (red).'],
    ['colorFlash', 'Flash', 'The ring of light the blasted target lands in.'],
    ['colorDust', 'Dust', 'The soft dust (the step in, the launch, the slam, the landings).'],
    ['colorPlayer', 'Your side', 'Your rings, speed lines and total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their rings, speed lines and total colour when THEY strike.'],
  ],
  clipOf: { 'Sound: whoosh': 'sfxStepClip', 'Sound: hit': 'sfxHitClip', 'Sound: heavy': 'sfxHeavyClip', 'Sound: super': 'sfxSuperClip', 'Sound: K.O.': 'sfxKoClip', 'Sound: punch': 'sfxPunchClip', 'Sound: charge': 'sfxChargeClip', 'Sound: boom': 'sfxBoomClip', 'Sound: parry': 'sfxParryClip', 'Sound: struggle': 'sfxStruggleClip', 'Sound: dizzy': 'sfxDizzyClip', 'Sound: "Counter!"': 'sfxVoCounterClip', 'Sound: "K.O.!"': 'sfxVoKoClip', 'Sound: "Perfect!"': 'sfxVoPerfectClip' },
  note: () => {
    const c = getHeroComboConfig();
    const p = comboPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · tier ${p.tier} · ${p.kind} · ${p.hits.length} hits · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  // A fresh roll per preview (a real fight rolls from the run seed and the round, so a replay rolls the same).
  play: (o) => playHeroCombo({ ...o, rollSeed: o.rollSeed ?? (previewRoll = (previewRoll + 1) % 3000) }),
  verb: 'lands a fighting game combo on',
  smallHint: 'the counter.',
  bigHint: 'the launcher.',
  tierHints: [
    'Tier 1, the counter (ice blue): the target lunges, is parried, and eats one crisp counter-hit. COUNTER.',
    'Tier 2, the string (neon pink): jab, jab, cross, roundhouse on the beat, every strike leaving a trail; the target reels, dizzy.',
    'Tier 3, the launcher (gold): uppercut, air juggle, the target struggles (BREAKER?), the spike smashes it home, dizzy.',
    'Tier 4, the super (red): letterbox, the cut-in and the inputs, a flurry, a wind-up, an impact frame, the heavy blow. K.O. PERFECT.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroCombo?: unknown }).__heroCombo = { demo: built.demo };
}

export function HeroComboTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
