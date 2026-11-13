import {
  COMBO_LEVELS, COMBO_TIER_SUFFIXES, HERO_COMBO_DEFAULTS, HERO_COMBO_RANGES, comboPlan, getHeroComboConfig,
  heroComboStore, type ComboTierSuffix,
} from './heroCombo/heroComboConfig';
import { playHeroCombo } from './heroCombo/heroCombo';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the COMBO hero attack ("Flawless", a Legendary, in progress with no cosmetic yet): the blow played as an
 * arcade fighting game combo with a HUD, a combo counter that counts the hits, a super cut-in and K.O. Four
 * groups of per-tier dials (I the jab, II the string, III the launcher, IV the super), the fight's geometry, the HUD,
 * the colours and one clip / gain / pitch row per sound cue. The Play buttons run the real runner between the two real
 * portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the string.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the launcher.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the super (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  stance: ['Stance gap', '×', 'How close the striker stands beside the target (1 = just touching).', 'The fight'],
  windMs: ['First wind-up', 'ms', 'After stepping in, before the first hit lands.', 'The fight'],
  hitFreezeMs: ['Hit-freeze', 'ms', 'How long both portraits hold the contact pose on every hit (visuals only: the clock never stops).', 'The fight'],
  lunge: ['Lunge', '×', 'How far the striker lunges on a hit (striker radii).', 'The fight'],
  flinch: ['Flinch', '×', 'How far the target is knocked by a hit (target radii).', 'The fight'],
  flinchRot: ['Flinch rock', '°', 'How far the target rocks with a hit.', 'The fight'],
  sparkSize: ['Spark size', '×', 'The hit sparks and the fist.', 'The fight'],
  counterSize: ['Counter size', '×', 'The combo counter (it counts the hits landed).', 'The HUD'],
  tapGapMs: ['Tap gap', 'ms', 'I: the time between the jab\'s quick taps (a blow of 1, 2 or 3 is that many taps).', 'The fight'],
  koHoldMs: ['K.O. hold', 'ms', 'IV: how long the K.O. word stays up.', 'The HUD'],
  flashAlpha: ['Impact flash', 'opacity', 'IV: the whole-screen white flash on the heavy blow (III\'s slam and K.O. use part of it).', 'Camera and portraits'],
  koSize: ['K.O. size', '×', 'IV: the K.O. word (0 = none).', 'The HUD'],
  koDelayMs: ['K.O. delay', 'ms', 'IV: how long after the heavy blow K.O. slams in.', 'The HUD'],
  launchMs: ['Uppercut gap', 'ms', 'III: the beat before the uppercut.', 'III: the launcher'],
  launchHeight: ['Launch height', '×', 'III: how high the target is launched (target radii; less when the screen has no room).', 'III: the launcher'],
  jumpDelayMs: ['Jump delay', 'ms', 'III: how long after the launch the striker jumps.', 'III: the launcher'],
  jumpMs: ['Jump', 'ms', 'III: the striker\'s jump up to the target.', 'III: the launcher'],
  airHits: ['Air hits', undefined, 'III: the juggle\'s hits (each fight rolls this many or one fewer).', 'III: the launcher'],
  airGapMs: ['Air gap', 'ms', 'III: the time between air hits.', 'III: the launcher'],
  airBob: ['Air bob', '×', 'III: how far the target bobs up with each air hit.', 'III: the launcher'],
  spikeMs: ['Spike gap', 'ms', 'III: the beat before the spike.', 'III: the launcher'],
  slamMs: ['Slam', 'ms', 'III: the fall from the spike into the socket (THE impact).', 'III: the launcher'],
  openHits: ['Opening hits', undefined, 'IV: the hits before the super freeze.', 'IV: the super'],
  freezeDelayMs: ['Freeze delay', 'ms', 'IV: from the last opening hit to the super freeze.', 'IV: the super'],
  cutinMs: ['Cut-in', 'ms', 'IV: the whole super freeze (the band in, the inputs, the band out).', 'IV: the super'],
  cutinSlideMs: ['Cut-in slide', 'ms', 'IV: the band sliding in, and out.', 'IV: the super'],
  cutinDim: ['Cut-in dim', 'opacity', 'IV: how dark the screen goes behind the band.', 'IV: the super'],
  cutinTilt: ['Cut-in tilt', '°', 'IV: the band\'s slant.', 'IV: the super'],
  cutinHeight: ['Cut-in height', '×', 'IV: the band\'s height, as a part of the screen.', 'IV: the super'],
  flurryHits: ['Flurry hits', undefined, 'IV: the rapid small hits after the cut-in. Ticks: no damage.', 'IV: the super'],
  flurryGapMs: ['Flurry gap', 'ms', 'IV: the time between flurry hits.', 'IV: the super'],
  heavyWindMs: ['Heavy wind-up', 'ms', 'IV: from the last flurry hit to the heavy blow (THE impact).', 'IV: the super'],
  koLaunch: ['K.O. launch', '×', 'IV: how far the target is sent flying (kept on screen).', 'IV: the super'],
  koSpin: ['K.O. spin', undefined, 'IV: how many turns the target spins as it flies.', 'IV: the super'],
  squash: ['Squash', '×', 'How much the portraits squash (hits, the slam, the K.O.).', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxStepGain: ['whoosh: gain', undefined, 'The step in, the launch, the jump, the spike and the flurry starting.', 'Sound: whoosh'],
  sfxStepRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxHitGain: ['hit: gain', undefined, 'Every hit of the combo (one clip, re-pitched by the kind of hit) and the input ticks.', 'Sound: hit'],
  sfxHitRate: ['hit: pitch', '×', 'Pitch of the hits.', 'Sound: hit'],
  sfxHeavyGain: ['heavy: gain', undefined, 'The finishing blow: II\'s low kick (quietly), III\'s slam, IV\'s heavy blow.', 'Sound: heavy'],
  sfxHeavyRate: ['heavy: pitch', '×', 'Pitch of the heavy blow.', 'Sound: heavy'],
  sfxSuperGain: ['super: gain', undefined, 'IV: the super activating (the flash and the whoosh).', 'Sound: super'],
  sfxSuperRate: ['super: pitch', '×', 'Pitch of the super.', 'Sound: super'],
  sfxKoGain: ['K.O.: gain', undefined, 'IV: the K.O. sting (an impact and a gong, no voice).', 'Sound: K.O.'],
  sfxKoRate: ['K.O.: pitch', '×', 'Pitch of the K.O. sting.', 'Sound: K.O.'],
  sfxPunchGain: ['punch: gain', undefined, 'The low body layer under every hit (lower and louder on the launcher, the spike and the heavy blow) and the landings after the K.O. blow.', 'Sound: punch'],
  sfxPunchRate: ['punch: pitch', '×', 'Pitch of the body punch.', 'Sound: punch'],
  sfxChargeGain: ['charge: gain', undefined, 'IV: the charge that climbs through the super freeze, and the riser into the heavy blow.', 'Sound: charge'],
  sfxChargeRate: ['charge: pitch', '×', 'Pitch of the charge.', 'Sound: charge'],
  sfxBoomGain: ['boom: gain', undefined, 'The deep boom under K.O., the heavy blow and III\'s slam.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<ComboTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'A beat before the striker steps in.'],
  StepMs: ['Step in', 'ms', 'The dash to the stance beside the target.'],
  GapMs: ['Hit gap', 'ms', 'The rhythm of the ground hits. I: unused (its taps have their own gap).'],
  HoldMs: ['Hold', 'ms', 'After the impact before the striker heads home (the counter stays up).'],
  ReturnMs: ['Return', 'ms', 'The striker hopping home.'],
  Knock: ['Knockback', '×', 'How far the target is knocked on the impact (I and II).'],
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
  levelNames: { t1: 'Tier I (the jab)', t2: 'Tier II (the string)', t3: 'Tier III (the launcher)', t4: 'Tier IV (the super)' },
  suffixes: COMBO_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorSpark', 'Shards', 'The small shards thrown off a hit.'],
    ['colorHeavy', 'Heavy', 'The heavy blow\'s rings and shards, and the ring behind K.O.'],
    ['colorFlash', 'Flash', 'The quick flash under every hit spark.'],
    ['colorDust', 'Dust', 'The flat dust puffs (the step in, the launch, the slam).'],
    ['colorPlayer', 'Your side', 'Your rings, speed lines and total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their rings, speed lines and total colour when THEY strike.'],
  ],
  clipOf: { 'Sound: whoosh': 'sfxStepClip', 'Sound: hit': 'sfxHitClip', 'Sound: heavy': 'sfxHeavyClip', 'Sound: super': 'sfxSuperClip', 'Sound: K.O.': 'sfxKoClip', 'Sound: punch': 'sfxPunchClip', 'Sound: charge': 'sfxChargeClip', 'Sound: boom': 'sfxBoomClip' },
  note: () => {
    const c = getHeroComboConfig();
    const p = comboPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · tier ${p.tier} · ${p.kind} · ${p.hits.length} hits · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  // A fresh roll per preview (a real fight rolls from the run seed and the round, so a replay rolls the same).
  play: (o) => playHeroCombo({ ...o, rollSeed: o.rollSeed ?? (previewRoll = (previewRoll + 1) % 3000) }),
  verb: 'lands a fighting game combo on',
  smallHint: 'the jab.',
  bigHint: 'the launcher.',
  tierHints: [
    'the jab: step in, one to three quick taps (a blow of 1, 2 or 3 is that many), the counter counting each.',
    'the string: jab, cross, low kick, the counter ticking with each.',
    'the launcher: two hits, an uppercut that launches the target, an air juggle, a spike back down.',
    'the super: opening hits, the cut-in with the hero\'s portrait and the inputs, a flurry, a held wind-up, a heavy blow that blasts the target away. K.O.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroCombo?: unknown }).__heroCombo = { demo: built.demo };
}

export function HeroComboTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
