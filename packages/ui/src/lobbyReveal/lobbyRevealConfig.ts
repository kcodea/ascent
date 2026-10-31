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
  /** Each flight's soft whoosh (FX bank), on top of its mixer fader. 0 = silent. */
  whooshGain: number;
}

/** Shipped values (owner 2026-10-31: slower, cleaner, one at a time, a longer look at the line-up). Eight seats:
 *  250 + 7 x 70 + 380 + 1150 = 2.3 s on stage, then 7 x 240 + 600 + 160 + 250 + 300 = 3.0 s of flights, one at a time
 *  down the rail, each hitting and expanding into its slice. */
export const LHR_DEFAULTS: LobbyRevealConfig = {
  dimOpacity: 0.72,
  portraitSize: 185,
  startDelayMs: 250,
  entranceMs: 380,
  revealStaggerMs: 70,
  holdMs: 1150,
  flyMs: 600,
  flyStaggerMs: 240,
  arcHeight: 120,
  landMs: 220,
  impactMs: 160,
  expandMs: 250,
  headSettleMs: 300,
  goodLuckAfter: 1,
  revealSoundGain: 1,
  whooshGain: 0.35,
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
  impactMs: [0, 500, 10],
  expandMs: [0, 800, 10],
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
  landMs: ['Land crossfade', 'ms', 'The portrait fading into the slice art as it lands.', 'Fly'],
  impactMs: ['Impact', 'ms', 'The portrait hitting the rail: a quick squash and a gold flash on the slice edge.', 'Fly'],
  expandMs: ['Expand', 'ms', 'The slice opening out of the impact point to its full width.', 'Fly'],
  headSettleMs: ['Round slice settle', 'ms', 'The round slice settling in after the last portrait lands.', 'Fly'],
  goodLuckAfter: ['Good Luck after', undefined, 'On: the Good Luck words still play once the rail is built. Off: the reveal replaces them.', 'Flow'],
  revealSoundGain: ['Reveal sound', '×', 'The light whoosh and shine as the line-up appears (not the Hero Select stinger). 0 = silent.', 'Sound'],
  whooshGain: ['Whoosh sound', '×', 'A soft whoosh as each portrait takes off. 0 = silent.', 'Sound'],
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
 * THE SOUNDS. Never a `ceremony/` clip (owner 2026-10-31: "dont use the same sound effect for the hero reveals as the
 * player's hero selection"), and not cinematic (owner: "the sound effect of the hero reveal is really bad ... should just
 * be like a woosh and shine"). All from the existing bank, every one already shipped:
 *  - the line-up, two light layers, about 0.9 s:
 *    WHOOSH `fx/stereogenicstudio-swish-swoosh-woosh-sfx-39`, its airy 0.1 s to 1.0 s swish (the window the menu's
 *    vista title uses), soft-tailed;
 *    SHINE `prismaticpick`, a bright glass chime, pitched up a touch, landing as the first portraits rise (the hero
 *    cosmetics use it the same way, at a similar level).
 *    Passed over: `equipmentsheen` (the Good Luck words' own shine, a moment later: it would repeat), `triggerglow` (the
 *    in-game "a trigger fired" chime), the sparkle-whoosh (the Good Luck sparks), `fx/universfield-cinematic-swoosh-
 *    impact` (the first pick: too heavy), the strike impacts and the gate clips (they mean other things).
 *  - each flight: `whoosh-03` and the short `swish-swoosh-woosh 27` take, alternating, quiet, one per portrait.
 */
export interface RevealSoundLayer { clip: string; delayMs: number; gain: number; startMs?: number; lenMs?: number; rate?: number; fadeOutMs?: number }
export const REVEAL_LINEUP_LAYERS: readonly RevealSoundLayer[] = [
  { clip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-39-357160', delayMs: 0, gain: 0.55, startMs: 100, lenMs: 900, fadeOutMs: 300 },
  { clip: 'prismaticpick', delayMs: 160, gain: 0.4, rate: 1.2, fadeOutMs: 250 },
];
export const REVEAL_WHOOSH_CLIPS: readonly string[] = ['fx/whoosh-03', 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3'];
