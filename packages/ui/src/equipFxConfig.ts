/**
 * EQUIP FX + SFX TIMING (owner ask 2026-08-28: "add a tuner for this so that I can time the animation and SFX
 * together as best as possible").
 *
 * Equipping is TWO beats in one moment — the source minion announcing it, and the icon landing in the slot —
 * with a metallic clang that has to sit against them. Which of the three leads, and by how much, can only be
 * judged by ear and eye together, so all of it is dialable rather than guessed at in code.
 *
 * `sfxDelayMs` is handed to `playSample`'s own `delay`, which schedules on the AUDIO clock rather than with a
 * `setTimeout` — so the clang stays locked to the visual at any frame rate, instead of drifting whenever the
 * main thread is busy. That is the whole reason the dial exists in milliseconds and not in frames.
 *
 * Read at FIRE TIME, DEV-persisted, inert in production — the same trio every other FX tuner uses.
 */
export interface EquipFxConfig {
  /** 1 = play the authored `equipment-spark` def on the SOURCE minion, 0 = off. */
  sourceOn: number;
  /** 1 = play it again on the second-slot button as the icon lands, 0 = off. */
  slotOn: number;
  /** ms after the cue before the SOURCE burst fires. */
  sourceDelayMs: number;
  /** ms after the cue before the SLOT burst fires — the "energy arrives" half. */
  slotDelayMs: number;
  /** ms after the cue before the clang plays. Scheduled on the audio clock, so it cannot drift. */
  sfxDelayMs: number;
  /** 1 = play the clang, 0 = silent (for judging the visual alone). */
  sfxOn: number;
  /** ms between successive sources when SEVERAL Equip minions re-equip at once. Keeps a rebuild brisk. */
  staggerMs: number;
  /** 1 = the RE-EQUIP (Start of Turn) refresh plays the same def, 0 = only the CSS flash. Off by default:
   *  a full spark per surviving source every turn is a lot of screen for a bookkeeping step. */
  reequipSparkOn: number;
}

const DEFAULTS: EquipFxConfig = {
  sourceOn: 1,
  slotOn: 1,
  sourceDelayMs: 0,
  // The icon "arrives" a beat after the source announces it — the handoff's travel, reduced to two moments.
  slotDelayMs: 140,
  // The clang lands with the ARRIVAL rather than the announcement: the metal hits when the thing seats.
  sfxDelayMs: 140,
  sfxOn: 1,
  staggerMs: 70,
  reequipSparkOn: 0,
};

const KEY = 'ascent.fx.equip.v1';

let cfg: EquipFxConfig = load();

function load(): EquipFxConfig {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<EquipFxConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getEquipFxConfig(): EquipFxConfig {
  return cfg;
}
export function setEquipFxValue(key: keyof EquipFxConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetEquipFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export const EQUIP_FX_DEFAULTS: Readonly<EquipFxConfig> = DEFAULTS;

/** [min, max, step] per dial. */
export const EQUIP_FX_RANGES: Partial<Record<keyof EquipFxConfig, [number, number, number]>> = {
  sourceOn: [0, 1, 1],
  slotOn: [0, 1, 1],
  sourceDelayMs: [0, 800, 10],
  slotDelayMs: [0, 800, 10],
  sfxDelayMs: [0, 800, 10],
  sfxOn: [0, 1, 1],
  staggerMs: [0, 400, 5],
  reequipSparkOn: [0, 1, 1],
};
