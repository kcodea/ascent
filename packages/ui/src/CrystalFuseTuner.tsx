import { useEffect, useRef, useState } from 'react';
import { chargePreview } from './chargeGlyphTune';
import { FUSE_DEFAULTS, fuseSeed, getFuseCfg, resetFuseCfg, setFuseValue, type FuseCfg } from './fuseTune';
import { randomSeed } from './fx/rng';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for the end-of-turn CRYSTAL FUSE (`ChargeGlyph` in Recruit.tsx; physics in fuseSim.ts, drawing in
 * fuseRender.ts, values in fuseTune.ts). Every value is live: a change fires `ascent:fusecfg` and the lit fuse re-reads
 * it on the spot, at true game scale. Placement (size, x, y) is in Layout Lab → Crystal Fuse.
 *
 * The fuse only appears in the last twenty seconds of a turn, so the panel carries a preview harness: hold the charge
 * at any point, play the real twenty-second burn, or jump to 0:00 to see the collapse and the charged hum. "Lock seed"
 * replays one look on every play, so a change to a dial is a fair comparison (unlocked, each play rolls fresh, the way
 * every real turn does). Copy gives the JSON to paste over `FUSE_DEFAULTS`.
 */
type K = Extract<keyof FuseCfg, string>;
const r = (key: K, label: string, group: string, min: number, max: number, step: number, hint: string, unit?: TunerControl['unit']): TunerControl<K> =>
  ({ key, label, group, min, max, step, hint, unit });
const col = (key: K, label: string, hint: string): TunerControl<K> =>
  ({ key, label, group: 'Colours', kind: 'color', min: 0, max: 0, step: 0, hint });

const controls: TunerControl<K>[] = [
  r('aggression', 'Aggression', 'Master', 0, 2, 0.01, 'How hard every force ramps up over the window. 0 = still, 2 = frantic.', '×'),
  r('rampPow', 'Ramp curve', 'Master', 0.3, 4, 0.05, 'Above 1 holds the forces back and surges late; below 1 builds early.'),
  r('rampFloor', 'Starting share', 'Master', 0, 1, 0.01, 'How much of each force is already there when the fuse lights.', 'opacity'),

  r('pull', 'Pull to gem', 'Forces', 0, 2000, 10, 'Constant tug toward the gem. Higher = debris streams in faster.', 'px/s'),
  r('vortex', 'Vortex', 'Forces', 0, 2000, 10, 'Sideways swirl around the gem. Against the pull it makes spirals and orbits.', 'px/s'),
  r('vortexR', 'Vortex radius', 'Forces', 10, 300, 1, 'Distance from the gem where the swirl is at full strength; it weakens beyond.', 'px'),
  r('turbulence', 'Turbulence', 'Forces', 0, 800, 5, 'Whipping, flickering wander on every piece.', 'px/s'),
  r('turbScale', 'Turbulence scale', 'Forces', 0.002, 0.08, 0.001, 'Tightness of the turbulence. Low = long lazy waves, high = jittery.'),
  r('drag', 'Drag (speed kept / s)', 'Forces', 0.02, 1, 0.01, 'Share of speed kept each second. Low = heavy air, high = slippery.', 'opacity'),
  r('shardMass', 'Shard weight', 'Forces', 1, 8, 0.1, 'Heavier shards swing wider and orbit longer before they fall in.', '×'),
  r('moteMass', 'Mote weight', 'Forces', 0.2, 3, 0.05, 'Light motes dart straight in.', '×'),

  r('spawnPerFuse', 'Pieces over the fuse', 'Spawning', 0, 4000, 10, 'How many pieces break off over the whole burn.'),
  r('shardShare', 'Shard share', 'Spawning', 0, 1, 0.01, 'Share of pieces that are crystal shards (the rest are energy motes).', 'opacity'),
  r('spawnSpeed', 'Break-off speed', 'Spawning', 0, 400, 1, 'How fast a piece flies off the burning front.', 'px/s'),
  r('spawnSpeedVar', 'Break-off speed variance', 'Spawning', 0, 1, 0.01, 'How much pieces differ in that speed.', 'opacity'),
  r('shardSize', 'Shard size', 'Spawning', 1, 30, 0.5, 'Size of a crystal shard.', 'px'),
  r('moteSize', 'Mote size', 'Spawning', 1, 20, 0.5, 'Size of an energy mote.', 'px'),
  r('sizeVar', 'Size variance', 'Spawning', 0, 1, 0.01, 'How much sizes differ.', 'opacity'),
  r('life', 'Lifetime', 'Spawning', 0.5, 20, 0.1, 'Seconds a piece lasts if the gem does not swallow it first.', 's'),
  r('lifeVar', 'Lifetime variance', 'Spawning', 0, 1, 0.01, 'How much lifetimes differ.', 'opacity'),
  r('maxLive', 'Max pieces at once', 'Spawning', 50, 2000, 10, 'Hard cap on live pieces (performance guard).'),

  r('gemGlow', 'Glow peak', 'Gem', 0, 1, 0.01, 'How bright the gem glows at 0:00.', 'opacity'),
  r('gemGlowSize', 'Glow size', 'Gem', 10, 300, 1, 'Radius of the gem glow.', 'px'),
  r('captureR', 'Capture radius', 'Gem', 20, 200, 1, 'Inside this, pieces are drawn over the End Turn button instead of behind the cards.', 'px'),
  r('absorbR', 'Absorb radius', 'Gem', 2, 60, 1, 'Inside this, the gem swallows a piece (each one brightens it).', 'px'),
  r('collapsePull', '0:00 collapse pull', 'Gem', 200, 6000, 50, 'How hard everything is dragged in at 0:00.', 'px/s'),
  r('idleOrbiters', 'Pieces left orbiting', 'Gem', 0, 40, 1, 'Debris left circling the charged gem while it waits for End Turn.'),
  r('idleVortex', 'Waiting orbit speed', 'Gem', 0, 300, 1, 'Speed of that calm orbit.', 'px/s'),

  r('burnFeather', 'Burn edge softness', 'Fuse', 0, 15, 0.1, 'How soft the burning edge of the fuse is.', '%'),
  r('appearLeadS', 'Appears early by', 'Fuse', 0, 5, 0.5, 'Seconds the fuse shows, whole, before it starts burning at 0:20 (1 = it appears at 0:21).', 's'),
  r('appearSparkles', 'Appear sparkles', 'Fuse', 0, 400, 5, 'How many sparkles fly off the fuse the moment it lights.'),
  r('appearFlashMs', 'Appear flash length', 'Fuse', 80, 1500, 10, 'How long the bright flash lasts when the fuse lights.', 'ms'),
  r('appearFlashPeak', 'Appear flash brightness', 'Fuse', 1, 5, 0.05, 'How bright that flash is.', '×'),
  r('flashOutMs', 'Early End Turn fade', 'Fuse', 40, 600, 10, 'How long the left-over fuse takes to flash and vanish on an early End Turn.', 'ms'),
  r('flashOutPeak', 'Early End Turn flash', 'Fuse', 1, 5, 0.05, 'Brightness of that flash.', '×'),

  col('colorShard', 'Shards', 'Colour of the crystal shards.'),
  col('colorMote', 'Motes', 'Colour of the energy motes.'),
  col('colorHot', 'White-hot', 'The hottest colour: fresh breaks, glow cores, the collapse flash.'),
  col('colorGem', 'Gem glow', 'Colour of the glow and ring around the gem.'),
];

/** The preview harness: hold the charge at a point, play the 20 s burn, jump to 0:00, lock the seed. */
function FusePreview(): JSX.Element {
  const [scrub, setScrub] = useState(0.4);
  const [showing, setShowing] = useState(true);
  const [locked, setLocked] = useState(fuseSeed.locked != null);
  const rafRef = useRef(0);

  useEffect(() => { chargePreview.set(showing ? scrub : null); }, [showing, scrub]);
  const stopPlay = (): void => cancelAnimationFrame(rafRef.current);
  const run = (from: number, ms: number): void => {
    stopPlay();
    setShowing(true);
    setScrub(from);
    const t0 = performance.now();
    const step = (now: number): void => {
      const f = Math.min(1, from + ((1 - from) * (now - t0)) / ms);
      setScrub(f);
      if (f < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };
  // Hand the fuse back to the real turn clock (and fresh seeds) when the panel closes.
  useEffect(() => () => { cancelAnimationFrame(rafRef.current); chargePreview.set(null); fuseSeed.locked = null; }, []);

  return (
    <div className="tuner-previews tuner-harness">
      <div className="sfxmix-row tuner-row">
        <span className="sfxmix-name" aria-description="Holds the fuse on screen at this charge, so the look can be judged at any point.">
          Hold charge at
        </span>
        <input
          type="range" min={0} max={1} step={0.001} value={scrub}
          aria-label="Hold charge at"
          onChange={(e) => { stopPlay(); setShowing(true); setScrub(Number(e.target.value)); }}
        />
        <span className="sfxmix-val tuner-unit">{Math.round(scrub * 100)}%</span>
      </div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={() => run(0, 20000)} aria-description="Runs the real twenty-second burn once.">▶ Play 20s</button>
        <button className="sfxmix-copy" onClick={() => run(0.93, 1400)} aria-description="The last moments, the 0:00 collapse, then the charged hum.">Show 0:00</button>
        <button className="sfxmix-copy" onClick={() => { const on = !locked; fuseSeed.locked = on ? randomSeed() : null; setLocked(on); }}
          aria-description="Locked: every play replays the same look, so dial changes compare fairly. Unlocked: a fresh roll each play, like real turns.">
          {locked ? '🔒 Seed locked' : '🎲 Fresh seed'}
        </button>
        <button className="sfxmix-copy" onClick={() => { stopPlay(); setShowing((s) => !s); }}>
          {showing ? 'Release to turn clock' : 'Force on screen'}
        </button>
      </div>
    </div>
  );
}

export const SPEC: TunerSpec<FuseCfg> = {
  id: 'crystalfuse',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Crystal Fuse',
  note: 'dev · live · placement is in Layout Lab',
  read: getFuseCfg,
  write: (key, value) => setFuseValue(key, value),
  writeColor: (key, value) => setFuseValue(key, value),
  reset: resetFuseCfg,
  defaults: FUSE_DEFAULTS,
  controls,
  readout: () => <FusePreview />,
};

export function CrystalFuseTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
