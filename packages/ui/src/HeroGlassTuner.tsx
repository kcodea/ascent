import {
  GLASS_CAUSES, GLASS_CAUSE_NAMES, GLASS_LEVELS, GLASS_TIER_SUFFIXES, HERO_GLASS_DEFAULTS, HERO_GLASS_RANGES, causeOf, getHeroGlassConfig, glassPlan,
  glassSlowExtraMs, heroGlassStore, type GlassTierSuffix,
} from './heroGlass/heroGlassConfig';
import { playHeroGlass } from './heroGlass/heroGlass';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the FOURTH WALL hero attack (style `glass`, Ancient; in progress, no cosmetic yet): the screen is a
 * pane of glass and the blow breaks it. WHAT cracks it is rolled per fight from seven causes (a headbutt, a knock, a
 * rising tone, a creeping crack, a shockwave, a beam, a ricochet); the Variation row forces one. Four groups of
 * per-look dials (Tier 1 the chip; Tier 2 the web; Tier 3 the pane; Tier 4 the shatter), the cracks, the shards, the colours and one
 * clip / gain / pitch row per sound cue. The Play buttons at the top play all four looks and the Knockout variant, in
 * either direction, between the two real portraits; each press with Variation on Random plays the next cause.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier 2 from', undefined, 'Shared damage Tier 2 (6): the web.', 'Damage tiers'],
  tier3At: ['Tier 3 from', undefined, 'Shared damage Tier 3 (12): the pane.', 'Damage tiers'],
  tier4At: ['Tier 4 from', undefined, 'Shared damage Tier 4 (20): the shatter (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroWindPx: ['Lean back', 'px', 'How far the hero leans back through the ready.', 'Ready'],
  heroThrowPx: ['Flick snap', 'px', 'The ricochet: how far the hero snaps toward the target as it flicks the bolt.', 'Ready'],
  breakMs: ['III pane breaks after', 'ms', 'III: how long after the glass cracks the pane falls out.', 'Moves'],
  holeMs: ['III hole stays', 'ms', 'III: how long the dark hole stays before the pane repairs.', 'Moves'],
  healMs: ['Heal', 'ms', 'Tiers 1 to 3: the cracks fading away (the glass healing).', 'Moves'],
  raceMs: ['IV tear', 'ms', 'IV: how long the bold fracture takes to tear across the screen (at 1600 px).', 'Moves'],
  creakJumps: ['Creak jumps', undefined, 'How many little jumps the cracks spread in (each one creaks).', 'Cracks'],
  crackWidth: ['Crack width', '×', 'How heavy the crack lines are.', 'Cracks'],
  tearWidth: ['IV tear width', '×', 'IV: how heavy the bold fracture is.', 'Cracks'],
  tremblePx: ['IV tremble', 'px', 'IV: how far the glass trembles by the end of the held beat.', 'Cracks'],
  splitAlpha: ['IV offset tint', 'opacity', 'IV: the faint tint either side of the tear (the picture a hair apart).', 'Cracks'],
  slowMo: ['IV slow mo', '×', 'IV: how slow the clock dips on the shatter (1 = none). A smooth ramp, never a freeze.', 'Shards'],
  slowMoMs: ['IV slow mo length', 'ms', 'IV: how long (attack time) the clock takes to ease back after the shatter.', 'Shards'],
  shardLunge: ['IV jump at you', '×', 'IV: how far the shards swell toward the viewer as the screen breaks.', 'Shards'],
  dust: ['IV glass dust', undefined, 'IV: how many motes of dust sparkle down after the shards.', 'Shards'],
  shardGravity: ['Gravity', 'px', 'How hard the shards fall (px per second squared).', 'Shards'],
  shardBurst: ['Burst', 'px', 'How fast the shards are thrown outward as the glass lets go (px per second).', 'Shards'],
  shardSpin: ['Tumble', '×', 'How fast the shards spin (radians per second).', 'Shards'],
  shardRim: ['Rim highlight', 'px', 'The bright cut edge round each shard.', 'Shards'],
  crackGlow: ['Crack glow', '×', 'How strongly the cracks glow and pulse with energy (an additive line of light under each).', 'Cracks'],
  glints: ['Running glints', '×', 'How many points of prismatic light run along the cracks (a multiplier on the count for each tier).', 'Cracks'],
  prism: ['Prism flares', '×', 'The rainbow flare where the glass cracks, a fork tears, the pane breaks and the screen shatters.', 'Cracks'],
  ghost: ['Striker ghost', '×', 'How strongly the reflection of the striker shows in the glass over the target while the cause plays.', 'Cracks'],
  pressScale: ['Press to the glass', '×', 'How far the struck hero comes up to the glass when it presses its face to it and knocks from inside.', 'Camera and portraits'],
  inhaleMs: ['Tier 4 inhale', 'ms', 'Tier 4: the breath before the shatter (the screen darkens, the cracks blaze).', 'Shards'],
  inhaleDark: ['Tier 4 inhale dark', 'opacity', 'Tier 4: how dark the screen goes on the inhale.', 'Shards'],
  impactSize: ['Impact size', '×', 'The flash and ring where the glass is struck, the tear\'s heads, and the shatter.', 'Impact'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back on the impact.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the impact.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away (Tier 4 in full, the others shorter).', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The headbutt\'s lunge, the bolt, the ring of force rolling, Tier 4\'s tear.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxTickGain: ['tick: gain', undefined, 'The sharp crack of glass giving: every first crack, a bounce, a fork of the tear.', 'Sound: tick'],
  sfxTickRate: ['tick: pitch', '×', 'Pitch of the tick.', 'Sound: tick'],
  sfxCreakGain: ['creak: gain', undefined, 'The cracks jumping outward, the creeping crack, the groan of Tier 4\'s held beat.', 'Sound: creak'],
  sfxCreakRate: ['creak: pitch', '×', 'Pitch of the creak.', 'Sound: creak'],
  sfxRaceGain: ['race: gain', undefined, 'IV: the bold fracture tearing across the screen.', 'Sound: race'],
  sfxRaceRate: ['race: pitch', '×', 'Pitch of the race.', 'Sound: race'],
  sfxPaneGain: ['pane: gain', undefined, 'III: the pane breaking out and its shards landing.', 'Sound: pane'],
  sfxPaneRate: ['pane: pitch', '×', 'Pitch of the pane.', 'Sound: pane'],
  sfxCrashGain: ['crash: gain', undefined, 'IV: the plate-glass crash and the long tinkle of falling shards.', 'Sound: crash'],
  sfxCrashRate: ['crash: pitch', '×', 'Pitch of the crash.', 'Sound: crash'],
  sfxShatterGain: ['shatter: gain', undefined, 'IV: the second layer of breaking glass under the crash.', 'Sound: shatter'],
  sfxShatterRate: ['shatter: pitch', '×', 'Pitch of the shatter.', 'Sound: shatter'],
  sfxRepairGain: ['repair: gain', undefined, 'III: the shimmer as the pane repairs.', 'Sound: repair'],
  sfxRepairRate: ['repair: pitch', '×', 'Pitch of the repair.', 'Sound: repair'],
  sfxThudGain: ['thud: gain', undefined, 'The low weight under every hard crack, the stamp, Tier 3\'s pane and the boom of the shatter.', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: thud'],
  sfxBodyGain: ['body: gain', undefined, 'The headbutt: a body hitting plate glass (also a low layer of the shatter).', 'Sound: body'],
  sfxBodyRate: ['body: pitch', '×', 'Pitch of the body hit.', 'Sound: body'],
  sfxKnockGain: ['knock: gain', undefined, 'The knock: knuckles on glass (the third is louder and lower).', 'Sound: knock'],
  sfxKnockRate: ['knock: pitch', '×', 'Pitch of the knock.', 'Sound: knock'],
  sfxSingGain: ['sing: gain', undefined, 'Resonance: the rising glass tone (also the beam\'s whine and Tier 4\'s held beat).', 'Sound: sing'],
  sfxSingRate: ['sing: pitch', '×', 'Pitch of the tone.', 'Sound: sing'],
  sfxPopGain: ['pop: gain', undefined, 'The beam: the glass popping from the heat (quieter under the shockwave and the creep).', 'Sound: pop'],
  sfxPopRate: ['pop: pitch', '×', 'Pitch of the pop.', 'Sound: pop'],
  sfxSqueakGain: ['squeak: gain', undefined, 'The face of the struck hero squeaking on the glass (the press, the headbutt sliding down).', 'Sound: squeak'],
  sfxSqueakRate: ['squeak: pitch', '×', 'Pitch of the squeak.', 'Sound: squeak'],
  sfxSwellGain: ['swell: gain', undefined, 'Tier 4: the pane groaning and singing under pressure, swelling into the shatter.', 'Sound: swell'],
  sfxSwellRate: ['swell: pitch', '×', 'Pitch of the swell.', 'Sound: swell'],
  sfxTailMix: ['reverb tail', undefined, 'How much reverb rings after the breaking sounds.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<GlassTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The hero winds up. The view pushes in over this.'],
  CauseMs: ['Cause', 'ms', 'The base length of what cracks the glass, from its start to the first crack (each cause scales it: a headbutt is quick, a creeping crack slow).'],
  GrowMs: ['Cracks spread', 'ms', 'How long the cracks keep jumping outward after the first crack (Tier 4: the hold sets it).'],
  HoldMs: ['Hold', 'ms', 'Tiers 1 and 2: how long the cracks stay before they heal. Tier 4: the creaking, trembling beat before the shatter.'],
  Web: ['Web reach', '×', 'How far the cracks reach, in struck-portrait radii (Tier 4 covers the screen).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Push: ['Travel push', '×', 'How far the view keeps pushing in until the impact.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  SettleMs: ['Settle', 'ms', 'After the impact before the sequence ends (Tier 4: the shards fall and the dust hangs).'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

// With Variation on Random, each preview plays the NEXT cause (a real fight rolls from the run seed and the round, so a
// replay rolls the same): find a roll seed that lands on it.
let previewCause = -1;
let previewSeed = 1;
function nextPreviewRoll(): number {
  previewCause = (previewCause + 1) % GLASS_CAUSES.length;
  const want = GLASS_CAUSES[previewCause]!;
  const c = { ...getHeroGlassConfig(), variation: '' };
  for (let i = 0; i < 400; i++) { previewSeed = (previewSeed + 7919) % 1000003; if (causeOf(previewSeed, c) === want) break; }
  return previewSeed;
}

const built = rareTunerSpec({
  id: 'heroglass', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Fourth Wall (Ancient)',
  store: heroGlassStore,
  defaults: HERO_GLASS_DEFAULTS,
  ranges: HERO_GLASS_RANGES,
  globals: GLOBALS,
  levels: GLASS_LEVELS,
  levelNames: { t1: 'Tier 1 (the chip)', t2: 'Tier 2 (the web)', t3: 'Tier 3 (the pane)', t4: 'Tier 4 (the shatter)' },
  suffixes: GLASS_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorGlass', 'Glass', 'The shards, the chip, the rings on the surface.'],
    ['colorEdge', 'Crack line', 'The bright thread of every crack.'],
    ['colorShade', 'Shade', 'The hole a broken pane leaves, and the dark side of the offset on Tier 4.'],
    ['colorFlash', 'Flash', 'The white-blue flash where the glass is struck and on the shatter.'],
    ['colorHeat', 'Heat', 'The beam, its hot spot and the ember it leaves.'],
    ['colorEnergy', 'Energy', 'The glow pulsing in the cracks, the stress point and the head of the creeping crack.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: whoosh': 'sfxWhooshClip', 'Sound: tick': 'sfxTickClip', 'Sound: creak': 'sfxCreakClip', 'Sound: race': 'sfxRaceClip',
    'Sound: pane': 'sfxPaneClip', 'Sound: crash': 'sfxCrashClip', 'Sound: shatter': 'sfxShatterClip', 'Sound: repair': 'sfxRepairClip', 'Sound: thud': 'sfxThudClip',
    'Sound: body': 'sfxBodyClip', 'Sound: knock': 'sfxKnockClip', 'Sound: sing': 'sfxSingClip', 'Sound: pop': 'sfxPopClip',
    'Sound: squeak': 'sfxSqueakClip', 'Sound: swell': 'sfxSwellClip',
  },
  note: () => {
    const c = getHeroGlassConfig();
    const cause = causeOf(previewSeed, c);
    const p = glassPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600, cause }, c);
    return `dev · tier ${p.tier} · ${p.kind} · ${cause} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt + glassSlowExtraMs(p, c))} ms after the formation`;
  },
  play: (o) => playHeroGlass({ ...o, rollSeed: o.rollSeed ?? nextPreviewRoll() }),
  verb: 'breaks the glass over',
  smallHint: 'the glass over the target takes a small mark that heals.',
  bigHint: 'the whole screen shatters.',
  tierHints: [
    'Tier 1: the rolled cause chips the glass over the target in a prismatic flare; the target leans in and fogs the glass; it heals.',
    'Tier 2: the glowing mark spreads in creaking jumps; the target presses against the glass and knocks twice from the inside; it heals.',
    'Tier 3: a big mark leaks light; the target presses, knocks and shoves, and the pane round it breaks out and falls, then repairs.',
    'Tier 4: the cause cracks the glass, one bold fracture tears across the screen, the web glows and races with light while the target pounds on the glass, the screen inhales, and the whole screen shatters at you.',
  ],
  knockoutHint: 'Tier 4 remixed: the Ancient prism runs through the break, the shards take a lilac tint, a bigger shake, a deeper slow-mo dip and the KO sting.',
});

// THE VARIATION override (DEV): Random (rolled per blow) or force one cause, placed right under the Attack style row.
built.spec.controls.splice(1, 0, {
  key: 'variation', label: 'Variation', kind: 'select', options: ['', ...GLASS_CAUSES], group: 'Style', min: 0, max: 0, step: 0,
  optionLabels: { '': 'Random (rolled per fight)', ...Object.fromEntries(GLASS_CAUSES.map((id) => [id, GLASS_CAUSE_NAMES[id]])) },
  hint: 'What cracks the glass. Random = what real fights do (the same fight always rolls the same); here each press plays the next one.',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroGlass?: unknown }).__heroGlass = { demo: built.demo };
}

export function HeroGlassTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
