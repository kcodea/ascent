/** THE MASTER VOLUME (owner ask 2026-09-26): "add a master volume slider to the audio panel in game".
 *
 *  One gain stage in front of the speakers that scales EVERYTHING the game plays: the Game-sounds buses (sfx.ts,
 *  every category bus: combat, UI, hero voice, ...), the lobby Music (music.ts) and the Announcer (announcer.ts).
 *  All three already share sfx.ts's one AudioContext, and each used to connect its final gain straight to
 *  `ctx.destination`; they now connect to `masterOutput(ctx)` instead, a single GainNode that feeds the
 *  destination. So the per-channel sliders keep their meaning (a channel's gain × the master), and everything
 *  upstream of the master (the Ancients duck, music fades, the announcer's line fades, a Skip's mute bus) keeps
 *  working unchanged, because it all happens BEFORE the master.
 *
 *  The no-Web-Audio fallbacks (music's and the announcer's HTMLAudioElements) have no graph to sit in, so they
 *  multiply `masterLevel()` into `element.volume` and re-apply on `onMasterChange`.
 *
 *  CURVE: plain linear. Slider 0..100 → gain 0..1, so 100 is unity (exactly the mix before this change) and 50 is
 *  half the amplitude. No reference-gain anchoring like the channel curves: the master only ever attenuates.
 *
 *  Default 100 (full), mute off. Persisted under `ascent.mastervol.v1` + `ascent.mastermuted`, every storage touch
 *  in a try/catch (a blocked store costs persistence, never the audio). The master mute leaves every channel's
 *  own mute alone. */

export const MASTER_VOLUME_KEY = 'ascent.mastervol.v1';
export const MASTER_MUTED_KEY = 'ascent.mastermuted';
/** The master slider starts at 100: full, i.e. unity gain (the pre-master mix). */
export const DEFAULT_MASTER = 1;

/** Master slider position (0..1, clamped) → gain. Linear: 1 is unity, 0 is silent. */
export function masterSliderToGain(slider: number): number {
  return Number.isFinite(slider) ? Math.min(1, Math.max(0, slider)) : DEFAULT_MASTER;
}

function readVolume(): number {
  try {
    const raw = localStorage.getItem(MASTER_VOLUME_KEY);
    if (raw === null) return DEFAULT_MASTER;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_MASTER;
  } catch {
    return DEFAULT_MASTER;
  }
}
function readMuted(): boolean {
  try { return localStorage.getItem(MASTER_MUTED_KEY) === '1'; } catch { return false; }
}

let volume = readVolume();
let muted = readMuted();

/** The master's effective gain right now: 0 when muted, else the slider through the linear curve. */
export function masterLevel(): number {
  return muted ? 0 : masterSliderToGain(volume);
}

const listeners = new Set<() => void>();
/** Subscribe to master changes (volume or mute). The element fallbacks use this to re-apply their volume. */
export function onMasterChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

// ── The graph node: one GainNode per context, feeding the destination ─────────────────────────────────────────
let node: { ctx: BaseAudioContext; gain: GainNode } | null = null;

/** The node every channel's final gain connects to (in place of `ctx.destination`). Built once per context. */
export function masterOutput(ctx: BaseAudioContext): AudioNode {
  if (node && node.ctx === ctx) return node.gain;
  const gain = ctx.createGain();
  gain.gain.value = masterLevel();
  gain.connect(ctx.destination);
  node = { ctx, gain };
  return gain;
}

function apply(): void {
  if (node) {
    const now = node.ctx.currentTime;
    // A short time constant, like the channel gains: a slider drag glides instead of zippering.
    node.gain.gain.cancelScheduledValues(now);
    node.gain.gain.setTargetAtTime(masterLevel(), now, 0.01);
  }
  for (const cb of listeners) { try { cb(); } catch { /* a listener must never break the slider */ } }
}

export function getMasterVolume(): number {
  return volume;
}
export function setMasterVolume(v: number): void {
  volume = masterSliderToGain(v);
  try { localStorage.setItem(MASTER_VOLUME_KEY, String(volume)); } catch { /* ignore */ }
  apply();
}
export function isMasterMuted(): boolean {
  return muted;
}
export function toggleMasterMute(): boolean {
  muted = !muted;
  try { localStorage.setItem(MASTER_MUTED_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
  apply();
  return muted;
}

/** Tests only: re-read storage and drop the graph node (listeners stay; modules register theirs at load). */
export function __resetMasterForTests(): void {
  volume = readVolume();
  muted = readMuted();
  node = null;
}
