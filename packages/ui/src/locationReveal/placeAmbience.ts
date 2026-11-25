/**
 * THE PLACE GOES ON SOUNDING AT HERO SELECT (owner 2026-11-25: "the sound in this screen should continue and not drop off";
 * R-LOCATION-09). The reveal's ambience is not stopped when the reveal ends: it is handed over here, loops on under hero select and
 * the hero's line, and fades as the board takes over. Only the full reveal has one (a phone decodes none of it).
 */
import { audioContext, isMuted } from '../sfx';

/** How long it takes to go once hero select is left: across the frame opening onto the board. */
export const AMBIENCE_OUT_MS = 1400;
/** The seam of the loop is this much of its end, laid over its start (s). */
const SEAM_S = 0.9;

/** How many hero selects stand at a place right now (in Duos a teammate's can be over mine). */
let grounds = 0;
/** A hero select is at a place. Returns its leaving: with the last one the ambience goes. */
export function standAt(): () => void {
  grounds += 1;
  return () => { grounds -= 1; if (grounds <= 0) { grounds = 0; endAmbience(); } };
}

let held: { src: AudioBufferSourceNode; gain: GainNode; watch: number } | null = null;

/** The clip as a loop with no seam: its end fades out under its own beginning (equal power). */
export function seamless(ctx: BaseAudioContext, buf: AudioBuffer): AudioBuffer {
  const n = Math.min(Math.floor(SEAM_S * buf.sampleRate), Math.floor(buf.length / 3));
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length - n, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const a = buf.getChannelData(c);
    const d = out.getChannelData(c);
    d.set(a.subarray(0, out.length));
    for (let i = 0; i < n; i++) {
      const u = (i / n) * (Math.PI / 2);
      d[i] = a[i]! * Math.sin(u) + a[out.length + i]! * Math.cos(u);
    }
  }
  return out;
}

const fade = (h: { src: AudioBufferSourceNode; gain: GainNode; watch: number }, ms: number): void => {
  window.clearInterval(h.watch);
  const ctx = audioContext();
  try {
    const at = ctx?.currentTime ?? 0;
    h.gain.gain.cancelScheduledValues(at);
    h.gain.gain.setTargetAtTime(0, at, ms / 4000);
    h.src.stop(at + ms / 1000 + 0.1);
  } catch { /* already over */ }
};

/** Take over the reveal's ambience as it ends. */
export function holdAmbience(src: AudioBufferSourceNode, gain: GainNode): void {
  if (held) fade(held, 200);
  held = null;
  if (grounds === 0) { fade({ src, gain, watch: 0 }, 200); return; } // nowhere to sound
  // Muting the game mid-screen ends it, as it silences everything that starts after it.
  held = { src, gain, watch: window.setInterval(() => { if (isMuted()) endAmbience(200); }, 250) };
}

/** Hero select is over. */
export function endAmbience(ms = AMBIENCE_OUT_MS): void {
  const h = held;
  held = null;
  if (h) fade(h, ms);
}
