/**
 * DEV tuner config for the LOBBY SCOUT CARD — the hover/pinned opponent report (owner ask 2026-08-31, iterating
 * on the V1 layout). Same architecture as `boardEdgeConfig` / `lobbyRailLookConfig`: DEV-only localStorage,
 * values pushed onto `:root` as `--sc-*` custom properties that the `.lobbyscout*` rules read WITH the shipped
 * value as their fallback — so PRODUCTION, which never runs the tuner, paints identically with no JS. Shipping a
 * tune means pasting the copied values into DEFAULTS here (the CSS fallbacks already mirror them).
 *
 * Sizes are MULTIPLIERS of the card's baked base measurements (all default 1). Translucent CSS targets bake their
 * own alpha via `color-mix`, so the colour dials expose only a hue.
 */
import type { TunerControl, TunerSpec } from './tunerSchema';

export interface ScoutCardConfig {
  // Card box
  width: number;      // × card width
  pad: number;        // × inner padding
  radius: number;     // × corner radius
  gap: number;        // × gap between sections
  // Text sizes
  nameSize: number;   // × opponent name
  heroSize: number;   // × hero-power subtitle
  statSize: number;   // × the stat values (tribe / tier / triples)
  statLabelSize: number; // × the stat labels
  histText: number;   // × the fight-log damage numbers
  // Portraits & runes
  histFace: number;   // × the foe portrait in the fight log
  socketSize: number; // × the rune sockets
  // Colours
  bg1: string;        // card gradient, top
  bg2: string;        // card gradient, bottom
  border: string;     // frame + rune-socket outline hue
  nameCol: string;    // opponent name ink
  labelCol: string;   // hero-power + stat labels ink
  statCol: string;    // stat values ink
}

const DEFAULTS: ScoutCardConfig = {
  width: 2, pad: 1.8, radius: 1, gap: 1.8,
  // Text doubled all round (owner ask 2026-08-31: "increase the size of the text by 200%").
  nameSize: 2, heroSize: 2, statSize: 2, statLabelSize: 2, histText: 2,
  histFace: 1, socketSize: 1,
  bg1: '#241a13', bg2: '#17110c', border: '#c8922e',
  nameCol: '#f4ecdb', labelCol: '#b7a98f', statCol: '#f0902e',
};

export { DEFAULTS as SCOUT_CARD_DEFAULTS };

type NumKey = 'width' | 'pad' | 'radius' | 'gap' | 'nameSize' | 'heroSize' | 'statSize'
  | 'statLabelSize' | 'histText' | 'histFace' | 'socketSize';
const RANGES: Record<NumKey, [number, number, number]> = {
  width: [0.6, 2.8, 0.02],
  pad: [0.3, 2.5, 0.05],
  radius: [0, 3, 0.05],
  gap: [0, 3, 0.05],
  nameSize: [0.6, 3.5, 0.05],
  heroSize: [0.6, 3.5, 0.05],
  statSize: [0.6, 3.5, 0.05],
  statLabelSize: [0.6, 3.5, 0.05],
  histText: [0.6, 3.5, 0.05],
  histFace: [0.5, 3, 0.05],
  socketSize: [0.5, 3, 0.05],
};

const KEY = 'ascent.scoutCard';

let cfg: ScoutCardConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<ScoutCardConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getScoutCardConfig(): ScoutCardConfig {
  return cfg;
}

/** Push every value onto `:root` as `--sc-*`; every `.lobbyscout*` rule reads these WITH a fallback. */
export function applyScoutCardVars(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  s.setProperty('--sc-w', String(cfg.width));
  s.setProperty('--sc-pad', String(cfg.pad));
  s.setProperty('--sc-rad', String(cfg.radius));
  s.setProperty('--sc-gap', String(cfg.gap));
  s.setProperty('--sc-name', String(cfg.nameSize));
  s.setProperty('--sc-hero', String(cfg.heroSize));
  s.setProperty('--sc-stat', String(cfg.statSize));
  s.setProperty('--sc-statlabel', String(cfg.statLabelSize));
  s.setProperty('--sc-histtext', String(cfg.histText));
  s.setProperty('--sc-histface', String(cfg.histFace));
  s.setProperty('--sc-socket', String(cfg.socketSize));
  s.setProperty('--sc-bg1', cfg.bg1);
  s.setProperty('--sc-bg2', cfg.bg2);
  s.setProperty('--sc-border', cfg.border);
  s.setProperty('--sc-name-col', cfg.nameCol);
  s.setProperty('--sc-label-col', cfg.labelCol);
  s.setProperty('--sc-stat-col', cfg.statCol);
}

export function setScoutCardValue(key: keyof ScoutCardConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyScoutCardVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetScoutCardConfig(): void {
  cfg = { ...DEFAULTS };
  applyScoutCardVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const r = (key: NumKey, label: string, group: string, hint: string): TunerControl<Extract<keyof ScoutCardConfig, string>> => {
  const [min, max, step] = RANGES[key];
  return { key, label, group, unit: '×', hint, min, max, step };
};
const col = (key: Extract<keyof ScoutCardConfig, string>, label: string, group: string, hint: string): TunerControl<Extract<keyof ScoutCardConfig, string>> =>
  ({ key, label, group, hint, kind: 'color', min: 0, max: 0, step: 0 });

const controls: TunerControl<Extract<keyof ScoutCardConfig, string>>[] = [
  r('width', 'Width', 'Card', 'Overall card width.'),
  r('pad', 'Padding', 'Card', 'Inner padding around the content.'),
  r('radius', 'Corners', 'Card', 'Corner radius.'),
  r('gap', 'Section gap', 'Card', 'Vertical space between sections.'),

  r('nameSize', 'Name size', 'Text', 'Opponent name.'),
  r('heroSize', 'Hero-power size', 'Text', 'The hero-power subtitle under the name.'),
  r('statSize', 'Stat value size', 'Text', 'The tribe / tier / triples numbers.'),
  r('statLabelSize', 'Stat label size', 'Text', 'The little "build / tier / triples" labels.'),
  r('histText', 'History text size', 'Text', 'The damage numbers in the fight log.'),

  r('histFace', 'History portrait size', 'Portraits & runes', 'The foe portrait shown in each fight-log row.'),
  r('socketSize', 'Rune socket size', 'Portraits & runes', 'The three rune sockets at the foot of the card.'),

  col('bg1', 'Background top', 'Colours', 'Top of the card’s background gradient.'),
  col('bg2', 'Background bottom', 'Colours', 'Bottom of the card’s background gradient.'),
  col('border', 'Frame + sockets', 'Colours', 'The card frame and rune-socket outline hue.'),
  col('nameCol', 'Name ink', 'Colours', 'Opponent name colour.'),
  col('labelCol', 'Label ink', 'Colours', 'Hero-power subtitle and stat labels.'),
  col('statCol', 'Stat value ink', 'Colours', 'The tribe / tier / triples values.'),
];

export const SPEC: TunerSpec<ScoutCardConfig> = {
  id: 'scoutcard',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Scout Card',
  note: 'dev · live · persists',
  read: getScoutCardConfig,
  write: (key, value) => setScoutCardValue(key, value),
  writeColor: (key, value) => setScoutCardValue(key, value),
  reset: resetScoutCardConfig,
  defaults: DEFAULTS,
  controls,
};

// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the styles.css fallbacks either way).
applyScoutCardVars();
