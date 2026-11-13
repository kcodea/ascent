import {
  GLASS_LEVELS, GLASS_TIER_SUFFIXES, HERO_GLASS_DEFAULTS, HERO_GLASS_RANGES, getHeroGlassConfig, glassPlan, glassSlowExtraMs,
  heroGlassStore, type GlassTierSuffix,
} from './heroGlass/heroGlassConfig';
import { playHeroGlass } from './heroGlass/heroGlass';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the FOURTH WALL hero attack (style `glass`, Ancient; in progress, no cosmetic yet): the screen is a
 * pane of glass and the blow breaks it. Four groups of per-look dials (I the chip; II the web; III the pane; IV the
 * shatter), the pebble, the cracks, the shards, the colours and one clip / gain / pitch row per sound cue. The Play
 * buttons at the top play all four looks, in either direction, between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the web.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the pane.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the shatter (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroWindPx: ['Lean back', 'px', 'How far the hero leans back through the ready.', 'Ready'],
  heroThrowPx: ['Flick snap', 'px', 'How far the hero snaps toward the target as it flicks (IV: as it punches the glass).', 'Ready'],
  stonePx: ['Pebble size', 'px', 'The pebble (III throws a bigger rock).', 'Pebble'],
  stoneArc: ['Pebble arc', '×', 'How high the pebble lobs (a fraction of the distance).', 'Pebble'],
  secondMs: ['II second pebble', 'ms', 'II: the gap between the two pebbles (the second is the blow).', 'Moves'],
  breakMs: ['III pane breaks after', 'ms', 'III: how long after the rock lands the pane falls out.', 'Moves'],
  holeMs: ['III hole stays', 'ms', 'III: how long the dark hole stays before the pane repairs.', 'Moves'],
  healMs: ['Heal', 'ms', 'I to III: the cracks fading away (the glass healing).', 'Moves'],
  creakJumps: ['Creak jumps', undefined, 'How many little jumps the cracks spread in (each one creaks).', 'Cracks'],
  crackWidth: ['Crack width', '×', 'How heavy the crack lines are.', 'Cracks'],
  splitAlpha: ['IV offset tint', 'opacity', 'IV: the faint tint either side of the main crack (the picture a hair apart).', 'Cracks'],
  slowMo: ['IV slow mo', '×', 'IV: how slow the clock dips on the shatter (1 = none). A smooth ramp, never a freeze.', 'Shards'],
  slowMoMs: ['IV slow mo length', 'ms', 'IV: how long (attack time) the clock takes to ease back after the shatter.', 'Shards'],
  shardGravity: ['Gravity', 'px', 'How hard the shards fall (px per second squared).', 'Shards'],
  shardBurst: ['Burst', 'px', 'How fast the shards are thrown outward as the glass lets go (px per second).', 'Shards'],
  shardSpin: ['Tumble', '×', 'How fast the shards spin (radians per second).', 'Shards'],
  shardRim: ['Rim highlight', 'px', 'The bright cut edge round each shard.', 'Shards'],
  impactSize: ['Impact size', '×', 'The flash and ring of a tap, and of the shatter.', 'Impact'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back on the impact.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the impact.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxThrowGain: ['flick: gain', undefined, 'The pebble leaving the hand.', 'Sound: flick'],
  sfxThrowRate: ['flick: pitch', '×', 'Pitch of the flick.', 'Sound: flick'],
  sfxTickGain: ['tick: gain', undefined, 'A pebble tapping the glass (lower for the rock of III and the punch of IV).', 'Sound: tick'],
  sfxTickRate: ['tick: pitch', '×', 'Pitch of the tick.', 'Sound: tick'],
  sfxCreakGain: ['creak: gain', undefined, 'The cracks jumping outward (a short crackle each jump).', 'Sound: creak'],
  sfxCreakRate: ['creak: pitch', '×', 'Pitch of the creak.', 'Sound: creak'],
  sfxRaceGain: ['race: gain', undefined, 'IV: the one crack racing across the screen.', 'Sound: race'],
  sfxRaceRate: ['race: pitch', '×', 'Pitch of the race.', 'Sound: race'],
  sfxPaneGain: ['pane: gain', undefined, 'III: the pane breaking out and its shards landing.', 'Sound: pane'],
  sfxPaneRate: ['pane: pitch', '×', 'Pitch of the pane.', 'Sound: pane'],
  sfxShatterGain: ['shatter: gain', undefined, 'IV: the whole screen shattering and the shards falling.', 'Sound: shatter'],
  sfxShatterRate: ['shatter: pitch', '×', 'Pitch of the shatter.', 'Sound: shatter'],
  sfxRepairGain: ['repair: gain', undefined, 'III: the shimmer as the pane repairs.', 'Sound: repair'],
  sfxRepairRate: ['repair: pitch', '×', 'Pitch of the repair.', 'Sound: repair'],
  sfxThudGain: ['thud: gain', undefined, 'The low weight under the rock of III, the punch of IV and the shatter.', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: thud'],
  sfxTailMix: ['reverb tail', undefined, 'How much reverb rings after the breaking sounds.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<GlassTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The hero winds up. The view pushes in over this.'],
  FlyMs: ['Flight', 'ms', 'The flight of the pebble (at 1600 px). IV: the race of the crack across the screen.'],
  GrowMs: ['Cracks spread', 'ms', 'How long the cracks keep jumping outward after the hit (IV: the hold sets it).'],
  HoldMs: ['Hold', 'ms', 'I and II: how long the cracks stay before they heal. IV: the creaking beat before the shatter.'],
  Web: ['Web reach', '×', 'How far the cracks reach, in struck-portrait radii (IV covers the screen).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Push: ['Travel push', '×', 'How far the view keeps pushing in until the impact.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  SettleMs: ['Settle', 'ms', 'After the impact before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'heroglass', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Fourth Wall (Ancient)',
  store: heroGlassStore,
  defaults: HERO_GLASS_DEFAULTS,
  ranges: HERO_GLASS_RANGES,
  globals: GLOBALS,
  levels: GLASS_LEVELS,
  levelNames: { t1: 'Tier I (the chip)', t2: 'Tier II (the web)', t3: 'Tier III (the pane)', t4: 'Tier IV (the shatter)' },
  suffixes: GLASS_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorGlass', 'Glass', 'The shards, the chip, the rings on the surface.'],
    ['colorEdge', 'Crack line', 'The bright thread of every crack.'],
    ['colorShade', 'Shade', 'The hole a broken pane leaves, and the dark side of the offset on IV.'],
    ['colorFlash', 'Flash', 'The white-blue flash on a tap and on the shatter.'],
    ['colorStone', 'Pebble', 'The pebble.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: flick': 'sfxThrowClip', 'Sound: tick': 'sfxTickClip', 'Sound: creak': 'sfxCreakClip', 'Sound: race': 'sfxRaceClip',
    'Sound: pane': 'sfxPaneClip', 'Sound: shatter': 'sfxShatterClip', 'Sound: repair': 'sfxRepairClip', 'Sound: thud': 'sfxThudClip',
  },
  note: () => {
    const c = getHeroGlassConfig();
    const p = glassPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt + glassSlowExtraMs(p, c))} ms after the formation`;
  },
  play: (o) => playHeroGlass(o),
  verb: 'breaks the glass over',
  smallHint: 'a pebble chips the glass over the target.',
  bigHint: 'the whole screen shatters.',
  tierHints: [
    'a flicked pebble taps the glass over the target: a chip and three short cracks that heal.',
    'two pebbles in a row; their cracks spread in jumps and join into a spider web over the portrait.',
    'a rock; the web grows large and the pane round the portrait breaks out and falls, then repairs.',
    'the hero punches the glass, one crack races edge to edge through both portraits, and the whole screen shatters and falls away.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroGlass?: unknown }).__heroGlass = { demo: built.demo };
}

export function HeroGlassTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
