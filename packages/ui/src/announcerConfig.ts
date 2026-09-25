import type { AnnouncerEvent } from './announcerSlice';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV tuner + the ONE config accessor for THE ANNOUNCER's per-event mix (owner ask 2026-09-24): *"add an announcer
 * tuner to the dev panel that has volume for each event, and a timing adjust that allows me to offset timing of the
 * event earlier or later"*.
 *
 * Two knobs per event (every key of `ANNOUNCER_LINES` in announcer.ts):
 *  · `<event>Vol`: a percentage (0 to 200, 100 = as recorded) multiplied into that line's gain, on top of the Announcer channel's
 *    level. The final gain is clamped at 1 (`announcerLineGain`), so a boost can never clip past full scale.
 *  · `<event>Offset`: milliseconds added to the event's built-in delay (Face Omen 1600, back to shop 1000,
 *    Equipment 400, the end lines 1000, Game Start 4000 from the run landing, 0 for the in-shop moments). Negative
 *    fires earlier, but never before the moment is detected (the queue clamps it to "now"). The cooldown, the cap
 *    and the shelf life are untouched: the cooldown still counts from when the previous line ACTUALLY ended.
 *
 * Prod ignores localStorage and ships DEFAULTS (the castPreviewConfig pattern); "bake" = paste the panel's Copy
 * values into DEFAULTS. This module imports nothing from announcer.ts (announcer.ts reads it), so no cycle.
 */

/** Every announcer event, in the tuner's display order (the moment order of a game, roughly). Kept in step with
 *  `ANNOUNCER_LINES` by `announcerConfig.test.ts`. */
export const ANNOUNCER_TUNER_EVENTS = [
  'gameStart', 'equipment', 'triple', 'tierSix', 'runeforge', 'epicRuneforge', 'minionHits100Stats',
  'goldenArmy', 'bigSpender', 'shopBigBuff', 'pair', 'tribeFour',
  'randomCardBuy', 'randomSpellBuy', 'randomBeastBuy', 'randomDwarfBuy', 'timeRunningOut',
  'enteringCombat', 'enteringCombatAfterLoss', 'startCombatUnder10hp',
  'surviveUnder10hp', 'losingLowOddsFight', 'winningLowOddsFight', 'comebackWin', 'threeWinStreak',
  'flawlessVictory', 'bigHit',
  'backToShop', 'richTurn', 'round7', 'knockout', 'topFour', 'topTwo', 'gameWon', 'gameLoss',
] as const satisfies readonly AnnouncerEvent[];

type VolKey = `${AnnouncerEvent}Vol`;
type OffsetKey = `${AnnouncerEvent}Offset`;
export type AnnouncerTunerKey = VolKey | OffsetKey;
export type AnnouncerTunerConfig = Record<AnnouncerTunerKey, number>;

/** The panel's group title per event: its name plus the built-in delay the offset rides on. */
const EVENT_LABEL: Record<AnnouncerEvent, string> = {
  gameStart: 'Game start (4000 ms after the first shop)',
  equipment: 'Equipment (400 ms)',
  triple: 'Triple (0 ms)',
  tierSix: 'Tier six (0 ms)',
  runeforge: 'Runeforge (1000 ms on the return, else 0)',
  epicRuneforge: 'Epic Runeforge (1000 ms on the return, else 0)',
  minionHits100Stats: 'Minion hits 100 stats (0 ms, 3 s into a fight)',
  enteringCombat: 'Entering combat (1600 ms)',
  enteringCombatAfterLoss: 'Entering combat after losses (1600 ms)',
  startCombatUnder10hp: 'Start combat under 10 (1600 ms)',
  surviveUnder10hp: 'Survive under 10 (verdict, 3 s into a fight)',
  losingLowOddsFight: 'Lost a favoured fight (verdict)',
  winningLowOddsFight: 'Won an underdog fight (verdict)',
  threeWinStreak: 'Three win streak (verdict)',
  backToShop: 'Back to shop (1000 ms)',
  topFour: 'Top four (1000 ms)',
  topTwo: 'Top two (1000 ms)',
  gameWon: 'Game won (1000 ms)',
  gameLoss: 'Game lost (1000 ms)',
  knockout: 'Knockout (1000 ms after the return)',
  bigHit: 'Big hit, 15+ to a hero (verdict)',
  comebackWin: 'Comeback win after 3+ losses (verdict)',
  flawlessVictory: 'Flawless victory, no deaths (verdict)',
  goldenArmy: 'Golden army, 3 gilded on board (0 ms)',
  richTurn: 'Rich turn, 20+ Gold (1000 ms after the return)',
  bigSpender: 'Big spender, 20 spent with 10 left (0 ms)',
  shopBigBuff: 'Shop minion over 50 Attack (0 ms)',
  pair: 'First pair (0 ms)',
  tribeFour: 'Four of a tribe bought this turn (0 ms)',
  randomSpellBuy: 'Random spell buy, 10% (0 ms)',
  randomCardBuy: 'Random card buy, 10% (0 ms)',
  randomBeastBuy: 'Random Beast buy, 10% (0 ms)',
  randomDwarfBuy: 'Random Dwarf buy, 10% (0 ms)',
  round7: 'Round 7, 10% (1000 ms after the return)',
  timeRunningOut: 'Time running out, 10 s left on the Shop clock (0 ms)',
};

export const ANNOUNCER_VOL_RANGE: [number, number, number] = [0, 200, 5];
export const ANNOUNCER_OFFSET_RANGE: [number, number, number] = [-2000, 3000, 50];

const DEFAULTS: AnnouncerTunerConfig = Object.fromEntries(
  ANNOUNCER_TUNER_EVENTS.flatMap((e) => [[`${e}Vol`, 100], [`${e}Offset`, 0]]),
) as AnnouncerTunerConfig;
export { DEFAULTS as ANNOUNCER_TUNER_DEFAULTS };

export const ANNOUNCER_TUNER_KEYS = Object.keys(DEFAULTS) as AnnouncerTunerKey[];
const rangeOf = (key: AnnouncerTunerKey): [number, number, number] => (key.endsWith('Vol') ? ANNOUNCER_VOL_RANGE : ANNOUNCER_OFFSET_RANGE);

const KEY = 'ascent.announcertuner';

function load(): AnnouncerTunerConfig {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const out = { ...DEFAULTS };
    if (saved && typeof saved === 'object') {
      for (const k of ANNOUNCER_TUNER_KEYS) {
        const v = (saved as Record<string, unknown>)[k];
        if (typeof v === 'number' && Number.isFinite(v)) {
          const [min, max] = rangeOf(k);
          out[k] = Math.max(min, Math.min(max, v));
        }
      }
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

let cfg: AnnouncerTunerConfig = load();

export function getAnnouncerTunerConfig(): AnnouncerTunerConfig {
  return cfg;
}

export function setAnnouncerTunerValue(key: AnnouncerTunerKey, value: number | string): void {
  const n = Number(value);
  if (!Number.isFinite(n) || !(key in DEFAULTS)) return;
  const [min, max] = rangeOf(key);
  cfg = { ...cfg, [key]: Math.max(min, Math.min(max, n)) };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetAnnouncerTunerConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Re-read storage — for tests that seed localStorage before "loading". */
export function reloadAnnouncerTunerConfigForTest(): void {
  cfg = load();
}

/** The tuned gain multiplier for an event's line (1 = as recorded; the panel stores percent). */
export function announcerEventVolume(event: AnnouncerEvent, c: AnnouncerTunerConfig = cfg): number {
  return (c[`${event}Vol`] ?? 100) / 100;
}
/** The tuned timing offset for an event, ms (negative = earlier). */
export function announcerEventOffset(event: AnnouncerEvent, c: AnnouncerTunerConfig = cfg): number {
  return c[`${event}Offset`] ?? 0;
}
/** A line's final gain: the channel level times the event's multiplier, clamped to [0, 1]. */
export function announcerLineGain(channelLevel: number, eventVolume: number): number {
  return Math.max(0, Math.min(1, channelLevel * eventVolume));
}

// ── the panel schema ────────────────────────────────────────────────────────────────────────────────────────
/** Per-row preview hook: TunerPanel draws a ▶ beside the Volume row; the panel component supplies the player. */
export function announcerTunerControls(preview?: (event: AnnouncerEvent) => void): TunerControl<AnnouncerTunerKey>[] {
  return ANNOUNCER_TUNER_EVENTS.flatMap((e): TunerControl<AnnouncerTunerKey>[] => {
    const group = EVENT_LABEL[e];
    const [vMin, vMax, vStep] = ANNOUNCER_VOL_RANGE;
    const [oMin, oMax, oStep] = ANNOUNCER_OFFSET_RANGE;
    return [
      { key: `${e}Vol`, label: 'Volume', group, unit: '%', min: vMin, max: vMax, step: vStep, ...(preview ? { preview: () => preview(e) } : {}) },
      { key: `${e}Offset`, label: 'Timing offset', group, unit: 'ms', min: oMin, max: oMax, step: oStep },
    ];
  });
}

export const SPEC: TunerSpec<AnnouncerTunerConfig> = {
  id: 'announcer',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Announcer',
  note: 'dev · per-line volume + timing',
  read: getAnnouncerTunerConfig,
  write: (key, value) => setAnnouncerTunerValue(key, value),
  reset: resetAnnouncerTunerConfig,
  defaults: DEFAULTS,
  controls: announcerTunerControls(),
};
