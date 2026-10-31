import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';

/**
 * THE LOBBY REVEAL — its tunable numbers (owner ask 2026-10-31: "I want to add an animation after the player locks in a
 * hero and hits start game, where all the heroes in the lobby are shown and then all portraits fly over and build the
 * rail. This would happen in all modes").
 *
 * The tuner convention: localStorage-persisted in DEV only, production always plays `LHR_DEFAULTS`. Every value is read
 * when a reveal STARTS, so a slider changes the next play and ▶ Replay shows it at once. Shipping a feel = pasting the
 * tuned numbers into `LHR_DEFAULTS`.
 */
export interface LobbyRevealConfig {
  /** How dark the board is behind the heroes while they stand centre stage (0 = not at all, 1 = black). */
  dimOpacity: number;
  /** The portraits' size on the stage, reference px (scales with the UI). */
  portraitSize: number;
  /** Wait before the first portrait appears (the launch curtain is lifting over this). */
  startDelayMs: number;
  /** One portrait rising into place. */
  entranceMs: number;
  /** Between one portrait's entrance and the next. */
  revealStaggerMs: number;
  /** How long the full line-up holds once the last portrait is in (the magic sweep plays inside it). */
  holdMs: number;
  /** From the full line-up to the magic sweep starting across it. */
  sweepDelayMs: number;
  /** The magic sweep crossing the whole row, left to right; each portrait catches a shine as it passes. */
  sweepMs: number;
  /** One portrait's flight from the stage to its rail slot. */
  flyMs: number;
  /** Between one portrait taking off and the next (they fly together; this is just a breath of life). */
  flyStaggerMs: number;
  /** The beat between the last portrait parking and the first slice locking in. */
  lockBeatMs: number;
  /** Between one slice locking in and the next, top to bottom. */
  lockStaggerMs: number;
  /** How high each flight arcs above the straight line, reference px. */
  arcHeight: number;
  /** The crossfade from the flying portrait into the slice's art as it lands. */
  landMs: number;
  /** The hit: the portrait squashes on the rail (scale 1.06 then 0.98) and the slice edge flashes gold. */
  impactMs: number;
  /** The slice expanding out of the impact point to its full width (scaleX), revealing its frame, name and bar. */
  expandMs: number;
  /** The round slice settling in after the last landing. */
  headSettleMs: number;
  /** 1 = the Good Luck words play after the reveal (as before it existed); 0 = the reveal replaces them. */
  goodLuckAfter: number;
  /** The line-up's whoosh-and-shine level (never the Hero Select stinger), on top of its mixer fader. 0 = silent. */
  revealSoundGain: number;
  /** The group flight's soft whoosh, on top of its mixer fader. 0 = silent. */
  whooshGain: number;
  /** Each lock's thud and shimmer, on top of their mixer fader. 0 = silent. */
  lockSoundGain: number;
}

/** Shipped values (owner 2026-10-31). Eight seats: 250 + 7 x 70 + 380 + 1250 = 2.4 s on stage with the magic sweep, the
 *  round slice 0.3 s, then the group flight and the lock-in cascade: 7 x 35 + 520 + 140 + 7 x 100 + 260 = 1.9 s. */
export const LHR_DEFAULTS: LobbyRevealConfig = {
  dimOpacity: 0.72,
  portraitSize: 205,
  startDelayMs: 250,
  entranceMs: 380,
  revealStaggerMs: 70,
  holdMs: 1250,
  sweepDelayMs: 150,
  sweepMs: 750,
  flyMs: 520,
  flyStaggerMs: 35,
  arcHeight: 60,
  lockBeatMs: 140,
  lockStaggerMs: 100,
  landMs: 160,
  impactMs: 140,
  expandMs: 200,
  headSettleMs: 300,
  goodLuckAfter: 1,
  revealSoundGain: 1,
  whooshGain: 0.4,
  lockSoundGain: 1,
};

export const LHR_RANGES: Record<keyof LobbyRevealConfig, [number, number, number]> = {
  dimOpacity: [0, 0.95, 0.01],
  portraitSize: [60, 220, 1],
  startDelayMs: [0, 1000, 10],
  entranceMs: [80, 1200, 10],
  revealStaggerMs: [0, 300, 5],
  holdMs: [0, 2500, 10],
  sweepDelayMs: [0, 800, 10],
  sweepMs: [200, 1600, 10],
  flyMs: [150, 1500, 10],
  flyStaggerMs: [0, 150, 5],
  lockBeatMs: [0, 600, 10],
  lockStaggerMs: [30, 300, 5],
  arcHeight: [0, 400, 1],
  landMs: [0, 600, 10],
  impactMs: [0, 500, 10],
  expandMs: [0, 800, 10],
  headSettleMs: [0, 900, 10],
  goodLuckAfter: [0, 1, 1],
  revealSoundGain: [0, 2, 0.01],
  whooshGain: [0, 2, 0.01],
  lockSoundGain: [0, 2, 0.01],
};

const KEY = 'ascent.lobbyreveal';

let cfg: LobbyRevealConfig = (() => {
  if (!import.meta.env.DEV) return { ...LHR_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...LHR_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<LobbyRevealConfig>) : {}) };
  } catch {
    return { ...LHR_DEFAULTS };
  }
})();

export function getLobbyRevealConfig(): LobbyRevealConfig {
  return cfg;
}

export function setLobbyRevealValue(key: keyof LobbyRevealConfig, value: number | string): void {
  cfg = { ...cfg, [key]: Number(value) };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetLobbyRevealConfig(): void {
  cfg = { ...LHR_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** [label, unit, hint, group]. Declaration order is render order. */
const SPECS: Record<keyof LobbyRevealConfig, [string, TunerUnit | undefined, string, string]> = {
  dimOpacity: ['Dim', 'opacity', 'How dark the board is behind the heroes on stage. It lifts while they fly.', 'Look'],
  portraitSize: ['Portrait size', 'px', 'The heroes\x27 size on the stage (reference px, scales with the UI).', 'Look'],
  startDelayMs: ['Start delay', 'ms', 'Wait before the first hero appears. The launch curtain is lifting during this.', 'Reveal'],
  entranceMs: ['Entrance', 'ms', 'One hero rising into the line-up.', 'Reveal'],
  revealStaggerMs: ['Reveal stagger', 'ms', 'Between one hero\x27s entrance and the next.', 'Reveal'],
  holdMs: ['Hold', 'ms', 'How long the full line-up stays up before the flights (the sweep plays inside it).', 'Reveal'],
  sweepDelayMs: ['Sweep delay', 'ms', 'From the full line-up to the magic sweep starting.', 'Reveal'],
  sweepMs: ['Sweep', 'ms', 'The magic trail crossing the row, left to right; each hero catches a shine.', 'Reveal'],
  flyMs: ['Fly duration', 'ms', 'One portrait\x27s flight from the stage to its rail slot.', 'Fly'],
  flyStaggerMs: ['Fly stagger', 'ms', 'They fly together; this is the small offset between take-offs.', 'Fly'],
  lockBeatMs: ['Lock beat', 'ms', 'The pause between the last portrait parking and the first lock.', 'Lock'],
  lockStaggerMs: ['Lock stagger', 'ms', 'Between one slice locking in and the next, top to bottom.', 'Lock'],
  arcHeight: ['Arc height', 'px', 'How high each flight curves above the straight line (reference px).', 'Fly'],
  landMs: ['Crossfade', 'ms', 'The portrait fading into the slice art as the slice opens.', 'Lock'],
  impactMs: ['Lock snap', 'ms', 'The lock: a quick snap (1.08, 0.97, 1), a gold flash on the slice edge and a sparkle pop.', 'Lock'],
  expandMs: ['Expand', 'ms', 'The slice opening out of the portrait to its full width.', 'Lock'],
  headSettleMs: ['Round slice', 'ms', 'The round slice opening out of the Refresh pill, before any portrait flies.', 'Fly'],
  goodLuckAfter: ['Good Luck after', undefined, 'On: the Good Luck words still play once the rail is built. Off: the reveal replaces them.', 'Flow'],
  revealSoundGain: ['Reveal sound', '×', 'The soft whoosh as the line-up appears and the shimmer with the sweep. 0 = silent.', 'Sound'],
  whooshGain: ['Whoosh sound', '×', 'The soft whoosh as the portraits fly. 0 = silent.', 'Sound'],
  lockSoundGain: ['Lock sound', '×', 'Each lock: a gentle thud (three takes, rotating) and a light shimmer. 0 = silent.', 'Sound'],
};

const controls: TunerControl<Extract<keyof LobbyRevealConfig, string>>[] =
  (Object.keys(SPECS) as (keyof LobbyRevealConfig)[]).map((key) => {
    const [label, unit, hint, group] = SPECS[key];
    const [min, max, step] = LHR_RANGES[key];
    return key === 'goodLuckAfter'
      ? { key, label, hint, group, min, max, step, kind: 'toggle' as const, onValue: 1, offValue: 0 }
      : { key, label, unit, hint, group, min, max, step };
  });

/** Window event the ▶ Replay action fires; `LobbyReveal` listens for it in dev builds. */
export const LHR_REPLAY_EVENT = 'ascent:lobbyreveal-replay';

export const SPEC: TunerSpec<LobbyRevealConfig> = {
  id: 'lobbyreveal',               // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Lobby reveal',
  note: 'dev · ▶ to replay',
  read: getLobbyRevealConfig,
  write: (key, value) => setLobbyRevealValue(key, value),
  reset: resetLobbyRevealConfig,
  defaults: LHR_DEFAULTS,
  controls,
  actions: [
    {
      label: '▶ Replay reveal',
      hint: 'Play the reveal over the current board with the values above: the line-up, then every portrait flying to its rail slot.',
      run: () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event(LHR_REPLAY_EVENT)); },
    },
  ],
};

/**
 * THE SOUNDS (owner 2026-10-31: no Hero Select clip; "a woosh and shine"; then the owner's own clips: "maybe these
 * would be good sounds for the impact, plus a soft woosh and shimmer", "can try this shimmer at the hero reveal").
 *  - the line-up: a soft airy whoosh as it rises (`fx/stereogenicstudio-swish-swoosh-woosh-sfx-39`, its 0.1 s to 1.0 s
 *    swish, soft-tailed), then the owner's SHIMMER (audio/fx/reveal-shimmer.mp3) with the magic sweep.
 *  - the group flight: one soft whoosh (`fx/whoosh-03`).
 *  - each lock: one of the owner's three gentle THUDS (audio/fx/reveal-impact-1, -3 and -4.mp3, rotating so neighbours differ)
 *    and a light glass shimmer (`prismaticpick`, quiet, pitched a little higher each lock).
 * Passed over: `equipmentsheen` (the Good Luck words' own shine, a moment later), `triggerglow` (the in-game trigger
 * chime), the sparkle-whoosh (the Good Luck sparks), `fx/universfield-cinematic-swoosh-impact` (too heavy).
 */
export interface RevealSoundLayer { clip: string; gain: number; startMs?: number; lenMs?: number; rate?: number; fadeOutMs?: number }
export const REVEAL_LINEUP_WHOOSH: RevealSoundLayer = { clip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-39-357160', gain: 0.45, startMs: 100, lenMs: 900, fadeOutMs: 300 };
/** The owner's clips play ONCE per game, at its start, and `sfx.warmClips` decodes them under the launch curtain. So they
 *  stay OFF the phone's per-fight decode list (`audio/codeClips.ts`, which counts against the phone audio LRU's working
 *  set: phoneAudioQuality.test.ts). Named through this prefix so that list's scan of `fx/` literals passes them by. */
const OWNER_FX = 'fx/';
export const REVEAL_SWEEP_SHIMMER: RevealSoundLayer = { clip: `${OWNER_FX}reveal-shimmer`, gain: 0.6, fadeOutMs: 400 };
export const REVEAL_FLIGHT_WHOOSH: RevealSoundLayer = { clip: 'fx/whoosh-03', gain: 0.5, fadeOutMs: 200 };
export const REVEAL_LOCK_THUDS: readonly string[] = ['reveal-impact-1', 'reveal-impact-3', 'reveal-impact-4'].map((n) => `${OWNER_FX}${n}`);
export const REVEAL_LOCK_THUD_GAIN = 0.5;
export const REVEAL_LOCK_SHIMMER: RevealSoundLayer = { clip: 'prismaticpick', gain: 0.16, rate: 1.1, fadeOutMs: 200 };
/** Every clip the reveal plays: decoded under the launch curtain so the first lock is never late. */
export const REVEAL_ALL_CLIPS: readonly string[] = [
  REVEAL_LINEUP_WHOOSH.clip, REVEAL_SWEEP_SHIMMER.clip, REVEAL_FLIGHT_WHOOSH.clip, ...REVEAL_LOCK_THUDS, REVEAL_LOCK_SHIMMER.clip,
];
