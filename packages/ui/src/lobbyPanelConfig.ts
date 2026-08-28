/**
 * Tunable layout for the LOBBY RAIL — the 8-seat table down the right edge of the stage (owner ask 2026-07-29:
 * a tuner for panel scale, row scale and font size).
 *
 * Same architecture as the other layout configs (`cardPillsConfig`, the hero-panel/power-diamond configs):
 * dev-only localStorage persistence, values pushed onto `:root` as CSS custom properties that the `.lobbyrail`
 * rules read with a fallback. Because every rule has a fallback baked in, PRODUCTION renders correctly with no
 * JS at all — `applyLobbyPanelVars()` runs at load with DEFAULTS, and shipping tuned values means pasting them
 * into DEFAULTS here.
 *
 * The rail sizes everything off ONE internal unit, `--lu` = `--u × scale`, rather than scaling the panel with a
 * CSS `transform`. A transform would scale the drop shadow and the hairline border along with the content and
 * leave the panel's layout box the wrong size, so it would still reserve its old width and could overlap the
 * board. Driving the unit keeps the rail crisp and keeps its box honest at any scale.
 */
export interface LobbyPanelConfig {
  /** Whole-panel size (×). Multiplies the rail's internal unit, so every part scales together. */
  scale: number;
  /** Panel width, in design px (× the internal unit). */
  width: number;
  /** Distance from the stage's right edge, in design px. */
  right: number;
  /** Top edge, as a % of stage height. */
  top: number;
  /** MAXIMUM panel height, as a % of stage height. The rail sizes to its rows; this only caps it (and it
   *  scrolls past the cap rather than clipping a seat). */
  height: number;
  /** Nudge the WHOLE panel (and everything in it) horizontally, in design px (× the internal unit). Positive =
   *  right. Folded into `right` rather than a transform, so the fixed-position scout card stays anchored. */
  offsetX: number;
  /** Nudge the WHOLE panel vertically, in design px (× the internal unit). Positive = down. */
  offsetY: number;
  /** Seat-row size (×) — row padding and portrait, on top of the panel scale. */
  rowScale: number;
  /** Row text size (×) — seat name, health, damage. Independent of the row box, so the text can be pushed up
   *  for legibility without making the rail taller. */
  fontScale: number;
  /** The Next Foe card (×) — its portrait and text, on top of the panel scale. */
  foeScale: number;
}

/** Owner-tuned 2026-07-29 (🪑 Lobby Rail → Copy values). These are what ships — the exe and the itch build
 *  never run the tuner, so the CSS fallbacks below mirror them. */
export const LOBBY_PANEL_DEFAULTS: LobbyPanelConfig = {
  scale: 0.84,
  width: 259,
  right: 0,
  top: 13.5,
  height: 100,
  offsetX: -10,
  offsetY: 12,
  rowScale: 1.91,
  fontScale: 0.99,
  foeScale: 0.5,
};

export const LOBBY_PANEL_KEYS = ['scale', 'width', 'right', 'top', 'height', 'offsetX', 'offsetY', 'rowScale', 'fontScale', 'foeScale'] as const;
export type LobbyPanelKey = (typeof LOBBY_PANEL_KEYS)[number];

/** [min, max, step] per key. */
export const LOBBY_PANEL_RANGES: Record<LobbyPanelKey, [number, number, number]> = {
  scale: [0.5, 2.2, 0.01],
  width: [90, 340, 1],
  right: [0, 160, 1],
  top: [0, 70, 0.5],
  height: [25, 96, 0.5],
  offsetX: [-300, 300, 1],
  offsetY: [-300, 300, 1],
  rowScale: [0.5, 2.2, 0.01],
  fontScale: [0.5, 2.2, 0.01],
  foeScale: [0.5, 2.2, 0.01],
};

export const LOBBY_PANEL_DESC: Record<LobbyPanelKey, string> = {
  scale: 'Size of the whole rail — multiplies every other measurement.',
  width: 'Rail width in design px.',
  right: 'Gap from the stage’s right edge.',
  top: 'Top edge, as a % of stage height.',
  height: 'MAX rail height, as a % of stage height — the rail sizes to its rows and scrolls past this.',
  offsetX: 'Shift the whole panel horizontally. Positive = right.',
  offsetY: 'Shift the whole panel vertically. Positive = down.',
  rowScale: 'Seat-row box: padding and portrait size.',
  fontScale: 'Seat-row text: name, health and damage.',
  foeScale: 'The Next Foe card — portrait and text.',
};

const KEY = 'ascent.lobbyPanel';

let cfg: LobbyPanelConfig = (() => {
  if (!import.meta.env.DEV) return { ...LOBBY_PANEL_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...LOBBY_PANEL_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<LobbyPanelConfig>) : {}) };
  } catch {
    return { ...LOBBY_PANEL_DEFAULTS };
  }
})();

export function getLobbyPanelConfig(): LobbyPanelConfig {
  return cfg;
}

/** Push the current values onto `:root`. Every `.lobbyrail` rule reads these WITH a fallback, so a missing var
 *  (production, or a stale save) renders the shipped defaults rather than collapsing the panel. */
export function applyLobbyPanelVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--lby-scale', String(cfg.scale));
  root.setProperty('--lby-w', String(cfg.width));
  root.setProperty('--lby-right', String(cfg.right));
  root.setProperty('--lby-top', `${cfg.top}%`);
  root.setProperty('--lby-h', `${cfg.height}%`);
  root.setProperty('--lby-x', String(cfg.offsetX));
  root.setProperty('--lby-y', String(cfg.offsetY));
  root.setProperty('--lby-row', String(cfg.rowScale));
  root.setProperty('--lby-font', String(cfg.fontScale));
  root.setProperty('--lby-foe', String(cfg.foeScale));
}

export function setLobbyPanelValue(key: LobbyPanelKey, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  applyLobbyPanelVars();
}

export function resetLobbyPanelConfig(): void {
  cfg = { ...LOBBY_PANEL_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  applyLobbyPanelVars();
}

applyLobbyPanelVars();
