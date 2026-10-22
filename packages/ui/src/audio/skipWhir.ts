/**
 * THE SKIP FAST-FORWARD WHIR (owner pick 2026-10-22, R-SKIP-TURBO-01): a generated "tape fast-forwarding" sound
 * that plays while a Skip races the fight. A placeholder until an authored clip replaces it, so it needs no asset.
 *
 * One `amount` dial drives it (0 = the player's speed, 1 = the full Skip speed, skipTurbo.ts `turboAmount`): pitch
 * and level both follow it, so as the Skip brakes for the deciding hit the whir winds down like a tape slowing and
 * fades out while the game's own sounds fade back in (sfx.ts `setSkipTurboAudio`). Built from a looped noise
 * buffer through a band-pass (the hiss), a quiet sawtooth through a low-pass (the motor), and a slow flutter on
 * the hiss level. Every change is a `setTargetAtTime` glide, so a per-frame update never clicks.
 */
export interface SkipWhir {
  /** 0..1 — pitch + level follow it, gliding. */
  set(amount: number): void;
  /** Fade out and release every node. Safe to call twice. */
  stop(): void;
}

/** The whir's level at full turbo, before the game-sounds volume. Quiet: it is a bed, not a feature. */
const PEAK_GAIN = 0.22;
const GLIDE_S = 0.06;

export function createSkipWhir(ctx: AudioContext, out: AudioNode): SkipWhir {
  const now = ctx.currentTime;
  const level = ctx.createGain();
  level.gain.value = 0;
  level.connect(out);

  // The hiss: one second of white noise, looped, through a band-pass that sweeps up with the speed.
  const len = Math.max(1, Math.floor(ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Fixed LCG, not Math.random: the sound must be the same every time, and the repo bans Math.random in engine code.
  let seed = 0x2f6b;
  for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; data[i] = (seed / 0x3fffffff) - 1; }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.4;
  band.frequency.value = 500;
  const hiss = ctx.createGain();
  hiss.gain.value = 0.8;
  noise.connect(band).connect(hiss).connect(level);

  // The flutter: a slow wobble on the hiss level, the way a tape transport wavers.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 7;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.18;
  lfo.connect(lfoDepth).connect(hiss.gain);

  // The motor: a sawtooth whose pitch rides the speed, softened by a low-pass.
  const motor = ctx.createOscillator();
  motor.type = 'sawtooth';
  motor.frequency.value = 60;
  const soft = ctx.createBiquadFilter();
  soft.type = 'lowpass';
  soft.frequency.value = 900;
  const motorGain = ctx.createGain();
  motorGain.gain.value = 0.12;
  motor.connect(soft).connect(motorGain).connect(level);

  noise.start(now);
  lfo.start(now);
  motor.start(now);

  let stopped = false;
  return {
    set(amount: number): void {
      if (stopped) return;
      const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
      const t = ctx.currentTime;
      band.frequency.setTargetAtTime(400 + 2600 * a, t, GLIDE_S);
      motor.frequency.setTargetAtTime(45 + 230 * a, t, GLIDE_S);
      lfo.frequency.setTargetAtTime(4 + 10 * a, t, GLIDE_S);
      // Level rises a little faster than linear so the low end of the brake is already mostly faded.
      level.gain.setTargetAtTime(PEAK_GAIN * Math.pow(a, 0.8), t, GLIDE_S);
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      level.gain.cancelScheduledValues(t);
      level.gain.setTargetAtTime(0, t, 0.05);
      const end = t + 0.4;
      for (const src of [noise, lfo, motor]) { try { src.stop(end); } catch { /* already stopped */ } }
      window.setTimeout(() => { try { level.disconnect(); } catch { /* gone */ } }, 500);
    },
  };
}
