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
  /** How long the full line-up holds once the last portrait is in. */
  holdMs: number;
  /** One portrait's flight from the stage to its rail slot. */
  flyMs: number;
  /** Between one portrait taking off and the next. */
  flyStaggerMs: number;
  /** How high each flight arcs above the straight line, reference px. */
  arcHeight: number;
  /** The crossfade from the flying portrait into the rail slot as it lands. */
  landMs: number;
  /** The round slice settling in after the last landing. */
  headSettleMs: number;
  /** 1 = the Good Luck words play after the reveal (as before it existed); 0 = the reveal replaces them. */
  goodLuckAfter: number;
  /** The reveal stinger's level (the hero-select reveal sound), on top of its mixer fader. 0 = silent. */
  revealSoundGain: number;
  /** The flight whoosh's level (the hero-select whoosh), on top of its mixer fader. 0 = silent. */
  whooshGain: number;
}

/** Shipped values. Eight seats: 250 + 7 x 60 + 380 + 650 = 1.7 s on stage, then 7 x 70 + 620 + 180 + 300 = 1.6 s of
 *  flight and settle. About 3.3 s from the curtain lifting to a built rail. */
export const LHR_DEFAULTS: LobbyRevealConfig = {
  dimOpacity: 0.72,
  portraitSize: 150,
  startDelayMs: 250,
  entranceMs: 380,
  revealStaggerMs: 60,
  holdMs: 650,
  flyMs: 620,
  flyStaggerMs: 70,
  arcHeight: 120,
  landMs: 180,
  headSettleMs: 300,
  goodLuckAfter: 1,
  revealSoundGain: 0.8,
  whooshGain: 0.7,
};

export const LHR_RANGES: Record<keyof LobbyRevealConfig, [number, number, number]> = {
  dimOpacity: [0, 0.95, 0.01],
  portraitSize: [60, 220, 1],
  startDelayMs: [0, 1000, 10],
  entranceMs: [80, 1200, 10],
  revealStaggerMs: [0, 300, 5],
  holdMs: [0, 2500, 10],
  flyMs: [150, 1500, 10],
  flyStaggerMs: [0, 300, 5],
  arcHeight: [0, 400, 1],
  landMs: [0, 600, 10],
  headSettleMs: [0, 900, 10],
  goodLuckAfter: [0, 1, 1],
  revealSoundGain: [0, 2, 0.01],
  whooshGain: [0, 2, 0.01],
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
  holdMs: ['Hold', 'ms', 'How long the full line-up stays up before the first flight.', 'Reveal'],
  flyMs: ['Fly duration', 'ms', 'One portrait\x27s flight from the stage to its rail slot.', 'Fly'],
  flyStaggerMs: ['Fly stagger', 'ms', 'Between one portrait taking off and the next.', 'Fly'],
  arcHeight: ['Arc height', 'px', 'How high each flight curves above the straight line (reference px).', 'Fly'],
  landMs: ['Land crossfade', 'ms', 'The portrait fading into its rail slot as it lands.', 'Fly'],
  headSettleMs: ['Round slice settle', 'ms', 'The round slice settling in after the last portrait lands.', 'Fly'],
  goodLuckAfter: ['Good Luck after', undefined, 'On: the Good Luck words still play once the rail is built. Off: the reveal replaces them.', 'Flow'],
  revealSoundGain: ['Reveal sound', '×', 'The hero-select reveal stinger as the line-up appears. 0 = silent.', 'Sound'],
  whooshGain: ['Whoosh sound', '×', 'The hero-select whoosh as the portraits fly. 0 = silent.', 'Sound'],
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
