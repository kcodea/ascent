import {
  HERO_REWIND_DEFAULTS, HERO_REWIND_RANGES, REWIND_LEVELS, REWIND_TIER_SUFFIXES, getHeroRewindConfig, heroRewindStore, rewindPlan, rewindSlowExtraMs,
  type RewindTierSuffix,
} from './heroRewind/heroRewindConfig';
import { playHeroRewind } from './heroRewind/heroRewind';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the REWIND hero attack (the Ancient of Time; owner ask 2026-10-02: "rewinding/stopping time concepts
 * could be cool, and repeating time for the final hit or something to repeat the same attack maybe?"; the owner picked
 * REWIND & REPLAY). Four groups of per-tier dials (I one strike; II one rewind; III two rewinds with afterimages; IV five
 * accelerating loops, frozen echoes and the hourglass shatter), the bolt, the halo, the echoes, the colours and one
 * clip / gain / pitch row per sound cue. The Play buttons (at the top) run the real runner between the two real
 * portraits at each tier.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): one rewind.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): two rewinds and the stutter.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the crescendo and the hourglass shatter (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroWindPx: ['Lean back', 'px', 'How far the hero leans back through the ready.', 'Ready'],
  heroThrowPx: ['Throw snap', 'px', 'How far the hero snaps toward the target on each throw (a rewind un-snaps it).', 'Ready'],
  stutterMs: ['III stutter', 'ms', 'III: how far ahead of the bolt each afterimage flies on the last replay (the gap between bam, bam, BAM).', 'Rewind'],
  finalMs: ['IV finale flight', 'ms', 'IV: the last replay, with every frozen echo snapping in to land with it.', 'Rewind'],
  hourglassMs: ['IV hourglass forms', 'ms', 'IV: the hourglass forms round the target this long before the shatter.', 'Rewind'],
  slowMo: ['IV slow mo', '×', 'IV: how slow the clock dips on the shatter (1 = none). A smooth ramp, never a freeze.', 'Rewind'],
  slowMoMs: ['IV slow mo length', 'ms', 'IV: how long (attack time) the clock takes to ease back to full speed after the shatter.', 'Rewind'],
  jitterPx: ['Tracking jitter', 'px', 'How far both portraits jitter sideways while time scrubs back.', 'Rewind'],
  twitchPx: ['Board twitch', 'px', 'How far every card on both boards twitches BACKWARD on each rewind.', 'Rewind'],
  washAlpha: ['Gold wash', 'opacity', 'The gold wash over the whole screen on each rewind.', 'Rewind'],
  godSize: ['The god', '×', 'The Ancient of Time\'s bust rising over the board, as a fraction of the screen height (0 = none).', 'The god'],
  drainMs: ['Torrent drain', 'ms', 'How long the torrent\'s tail keeps draining into the hit after it lands (a rewind un-drains it).', 'Bolt'],
  arc: ['Arc', '×', 'How much the strike path bows upward (a fraction of the distance).', 'Bolt'],
  boltPx: ['Bolt size', 'px', 'The bolt of sand\'s head (the per-tier size multiplies it).', 'Bolt'],
  trailMs: ['Trail length', 'ms', 'How much of its flight the trail spans (a rewind shows it LEADING the bolt).', 'Bolt'],
  trailWidth: ['Trail width', 'px', 'How thick the trail is.', 'Bolt'],
  splitPx: ['RGB split', 'px', 'How far the magenta and cyan ghosts split off the bolt while it rewinds.', 'Bolt'],
  grainRate: ['Sand grains', undefined, 'Grains shed in flight (rewinding: gathered back in) per second.', 'Bolt'],
  haloSize: ['Halo size', '×', 'The broken halo rings round the striker (striker radii).', 'Halo and dial'],
  haloDrift: ['Halo drift', undefined, 'The rings\' slow forward drift (radians a second).', 'Halo and dial'],
  haloRewind: ['Halo rewind snap', undefined, 'How fast the rings snap BACKWARD while time scrubs (radians a second; IV builds on it every loop).', 'Halo and dial'],
  dialSize: ['IV clock dial', '×', 'IV: the clock dial spinning backward on the target (struck radii; 0 = none).', 'Halo and dial'],
  echoMs: ['III afterimage fade', 'ms', 'III: how long any afterimage left takes to fade after the impact.', 'Echoes and shatter'],
  echoTremble: ['IV echo tremble', 'px', 'IV: how much a frozen echo trembles in mid flight.', 'Echoes and shatter'],
  hourglassSize: ['Hourglass size', '×', 'IV: the hourglass round the target (struck radii).', 'Echoes and shatter'],
  shatterSize: ['Shatter size', '×', 'IV: the shatter (shards, the sand explosion, the shock rings).', 'Echoes and shatter'],
  rain: ['Crystal-sand rain', undefined, 'IV: grains raining down round the target after the shatter.', 'Echoes and shatter'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back on the impact.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the impact.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxTickGain: ['tick: gain', undefined, 'A clock tick: the ready, every return to the hand (higher each loop), a reversed stutter of three on every rewind.', 'Sound: tick'],
  sfxTickRate: ['tick: pitch', '×', 'Pitch of the tick.', 'Sound: tick'],
  sfxThrowGain: ['throw: gain', undefined, 'The sparkling whoosh of each throw.', 'Sound: throw'],
  sfxThrowRate: ['throw: pitch', '×', 'Pitch of the throw.', 'Sound: throw'],
  sfxSnapGain: ['snap: gain', undefined, 'The rubber-band snap of every replay (louder each loop).', 'Sound: snap'],
  sfxSnapRate: ['snap: pitch', '×', 'Pitch of the snap.', 'Sound: snap'],
  sfxHitGain: ['hit: gain', undefined, 'Each landing (bigger and deeper every loop).', 'Sound: hit'],
  sfxHitRate: ['hit: pitch', '×', 'Pitch of the hit.', 'Sound: hit'],
  sfxThudGain: ['thud: gain', undefined, 'The punch under each landing.', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: thud'],
  sfxChimeGain: ['chime: gain', undefined, 'A glassy chime on each landing and each frozen echo (IV).', 'Sound: chime'],
  sfxChimeRate: ['chime: pitch', '×', 'Pitch of the chime.', 'Sound: chime'],
  sfxRewindGain: ['rewind: gain', undefined, 'The REVERSED whoosh, swelling into the hand as time scrubs back.', 'Sound: rewind'],
  sfxRewindRate: ['rewind: pitch', '×', 'Pitch of the rewind.', 'Sound: rewind'],
  sfxZipGain: ['tape zip: gain', undefined, 'A reversed, pitched-up swish under each rewind (a tape scrubbing).', 'Sound: tape zip'],
  sfxZipRate: ['tape zip: pitch', '×', 'Pitch of the zip.', 'Sound: tape zip'],
  sfxBoomGain: ['boom: gain', undefined, 'II-IV: a cinematic boom under the impact (deepest on IV).', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxRiserGain: ['riser: gain', undefined, 'IV: the riser as the hourglass forms.', 'Sound: riser'],
  sfxRiserRate: ['riser: pitch', '×', 'Pitch of the riser.', 'Sound: riser'],
  sfxShatterGain: ['shatter: gain', undefined, 'IV: the hourglass shattering.', 'Sound: shatter'],
  sfxShatterRate: ['shatter: pitch', '×', 'Pitch of the shatter.', 'Sound: shatter'],
  sfxGlassGain: ['glass: gain', undefined, 'IV: the glass ringing out.', 'Sound: glass'],
  sfxGlassRate: ['glass: pitch', '×', 'Pitch of the glass.', 'Sound: glass'],
  sfxBellGain: ['bell: gain', undefined, 'The gong the clock ticks build into (IV; softer on III).', 'Sound: bell'],
  sfxBellRate: ['bell: pitch', '×', 'Pitch of the bell (low = a gong).', 'Sound: bell'],
  sfxRumbleGain: ['rumble: gain', undefined, 'IV: a low rumble under the shatter.', 'Sound: rumble'],
  sfxRumbleRate: ['rumble: pitch', '×', 'Pitch of the rumble.', 'Sound: rumble'],
  sfxTailMix: ['reverb tail', undefined, 'How much reverb rings after the impact sounds.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<RewindTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The ready: sand pours into the hand, the halo fades in. The view pushes in over this.'],
  FlyMs: ['Flight', 'ms', 'The first strike\'s flight to the target (at 1600 px; lower = faster).'],
  HoldMs: ['Hold', 'ms', 'After a landing, before time scrubs back (the splash plays on).'],
  RewindMs: ['Scrub', 'ms', 'The rewind scrub, from the splash back to the hand (about 120-200 ms reads as a snap).'],
  Rewinds: ['Rewinds', undefined, 'How many times the strike rewinds and replays (I 0, II 1, III 2, IV 5).'],
  Speedup: ['Snap back', '×', 'Each replay takes this much of the last one\'s time (lower = a harder rubber-band snap).'],
  Size: ['Size', '×', 'The bolt size multiplier for this tier.'],
  Grains: ['Splash', undefined, 'Grains of sand in the impact splash.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact (IV also pushes in through the finale).'],
  SettleMs: ['Settle', 'ms', 'After the impact before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herorewind', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Rewind (Ancient)',
  store: heroRewindStore,
  defaults: HERO_REWIND_DEFAULTS,
  ranges: HERO_REWIND_RANGES,
  globals: GLOBALS,
  levels: REWIND_LEVELS,
  levelNames: { t1: 'Tier I (one strike)', t2: 'Tier II (one rewind)', t3: 'Tier III (two rewinds, the stutter)', t4: 'Tier IV (the crescendo, the shatter)' },
  suffixes: REWIND_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorSand', 'Sand', 'The hourglass sand: grains, the splash.'],
    ['colorSandLight', 'Light sand', 'The bolt\'s core, the bright grains and flashes.'],
    ['colorGold', 'Gold', 'The halo rings, the bolt\'s glow and trail.'],
    ['colorViolet', 'Violet', 'Time running backward: the rewinding bolt, the contracting rings, the frozen echoes.'],
    ['colorSplitA', 'Split A', 'One of the rewinding bolt\'s RGB ghosts and scrub bars (magenta).'],
    ['colorSplitB', 'Split B', 'The other RGB ghost and scrub bars (cyan).'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: tick': 'sfxTickClip', 'Sound: throw': 'sfxThrowClip', 'Sound: snap': 'sfxSnapClip', 'Sound: hit': 'sfxHitClip', 'Sound: thud': 'sfxThudClip',
    'Sound: chime': 'sfxChimeClip', 'Sound: rewind': 'sfxRewindClip', 'Sound: tape zip': 'sfxZipClip', 'Sound: boom': 'sfxBoomClip',
    'Sound: riser': 'sfxRiserClip', 'Sound: shatter': 'sfxShatterClip', 'Sound: glass': 'sfxGlassClip', 'Sound: bell': 'sfxBellClip', 'Sound: rumble': 'sfxRumbleClip',
  },
  note: () => {
    const c = getHeroRewindConfig();
    const p = rewindPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.strikes.length - 1} rewind${p.strikes.length === 2 ? '' : 's'} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt + rewindSlowExtraMs(p, c))} ms after the formation`;
  },
  play: (o) => playHeroRewind(o),
  verb: 'strikes with a bolt of golden sand at',
  smallHint: 'one bolt of golden sand.',
  bigHint: 'the loop and the hourglass shatter.',
  tierHints: [
    'one bolt of golden sand slams the target.',
    'the bolt lands, time scrubs back (RGB split, scrub bars, the sand sucked up) and the same bolt snaps in again, harder.',
    'it lands and scrubs back twice; the afterimages fly with the last replay, so three echoes hit in a rapid stutter.',
    'a clock dial spins backward on the target; five accelerating loops, each leaving an echo frozen in mid flight; the hourglass forms; every echo lands at once in a gold and violet hourglass shatter, with a slow-mo dip and a crystal-sand rain.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroRewind?: unknown }).__heroRewind = { demo: built.demo };
}

export function HeroRewindTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
