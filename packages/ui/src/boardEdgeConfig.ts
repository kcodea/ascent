/**
 * DEV tuner config for the ULTRAWIDE board-edge blend (owner ask 2026-08-18). The 16:9 default board can't
 * fill a window wider than 16:9, so `.boardbg` lays a `--board-edge-col` gradient over the side margins that
 * fades into the art edges (see the `.boardbg` rule + the `--board-edge-*` block in styles.css). This module
 * makes the two visible knobs — the colour and how far the blend reaches into the art — live-tunable.
 *
 * Two things share the source of truth, exactly like every other tuner config (refreshConfig, freezeConfig …):
 * DEFAULTS here, and the `--board-edge-*` values declared in the styles.css `:root`. This module applies its
 * values INLINE on `:root` at load (dev: the persisted tune; prod: DEFAULTS), which overrides the stylesheet
 * declaration so a tune shows live; the stylesheet values remain the pre-JS / no-JS paint. **Keep the two in
 * sync** — when baking a tune, paste the copied JSON into DEFAULTS *and* mirror it into the styles.css `:root`
 * block (col, its 0-alpha twin `--board-edge-col-0`, and `--board-edge-fade`).
 *
 * `--board-edge-col-0` is derived, not tuned: it is the colour at zero alpha, used for the fade's inner stop so
 * it never interpolates through transparent-black and leaves a grey fringe. `applyBoardEdgeVars` recomputes it
 * from the colour whenever the colour changes, so the picker only ever exposes the one colour.
 */
import type { TunerControl, TunerSpec } from './tunerSchema';

export interface BoardEdgeConfig {
  /** The margin fill + blend colour — the ambient the art's edges sit in. */
  col: string;
  /** How far (design px, × --scale) the blend reaches INTO the art from each edge. */
  fade: number;
  /** VERTICAL blend (owner ask 2026-08-29): the Aug-25 board masters carry less sky than the canvas, so the
   *  exported webps have TRANSPARENT bands above/below the painting and `.boardbg` fills them with this
   *  colour, fading into the art's top/bottom edges — the vertical twin of the ultrawide side blend. */
  vcol: string;
  /** How far (design px, × --scale) the vertical blend reaches INTO the art from the top/bottom edges. */
  vfade: number;
}

const DEFAULTS: BoardEdgeConfig = {
  col: '#312361',
  fade: 186,
  vcol: '#313164',   // sampled from the art's own top-edge rows
  vfade: 140,
};

/** `[min, max, step]` for the numeric knobs. */
const BE_RANGES: Record<'fade' | 'vfade', [number, number, number]> = {
  fade: [0, 400, 2],
  vfade: [0, 400, 2],
};

export const BE_COLOR_KEYS = ['col', 'vcol'] as const;
/** The shipped values, exported so the tuner can mark which controls you've moved. */
export { DEFAULTS as BOARD_EDGE_DEFAULTS };

const KEY = 'ascent.boardedge';

// Dev-only persistence: production always renders the shipped DEFAULTS (which the styles.css :root mirrors).
let cfg: BoardEdgeConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<BoardEdgeConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function getBoardEdgeConfig(): BoardEdgeConfig {
  return cfg;
}

/** Reflect the two knobs (and the derived 0-alpha colour) onto `:root` as `--board-edge-*`. */
export function applyBoardEdgeVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const [r, g, b] = hexToRgb(cfg.col);
  root.setProperty('--board-edge-col', cfg.col);
  root.setProperty('--board-edge-col-0', `rgb(${r} ${g} ${b} / 0)`);
  root.setProperty('--board-edge-fade', `${cfg.fade}px`);
  const [vr, vg, vb] = hexToRgb(cfg.vcol);
  root.setProperty('--board-vedge-col', cfg.vcol);
  root.setProperty('--board-vedge-col-0', `rgb(${vr} ${vg} ${vb} / 0)`);
  root.setProperty('--board-vedge-fade', `${cfg.vfade}px`);
}

export function setBoardEdgeValue(key: keyof BoardEdgeConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyBoardEdgeVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetBoardEdgeConfig(): void {
  cfg = { ...DEFAULTS };
  applyBoardEdgeVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const controls: TunerControl<Extract<keyof BoardEdgeConfig, string>>[] = [
  { key: 'col', label: 'Blend colour', hint: 'The colour the ultrawide side margins fill with and fade from into the board edge.', group: 'Ultrawide side blend', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'fade', label: 'Blend reach', unit: 'px', hint: 'How far the colour fades INTO the board art from each edge. 0 = a hard colour field; higher = a softer, longer blend.', group: 'Ultrawide side blend', min: BE_RANGES.fade[0], max: BE_RANGES.fade[1], step: BE_RANGES.fade[2] },
  { key: 'vcol', label: 'Blend colour', hint: 'The colour the bands above/below the board art fill with and fade from into the painting.', group: 'Vertical blend', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'vfade', label: 'Blend reach', unit: 'px', hint: 'How far the colour fades INTO the board art from its top/bottom edges.', group: 'Vertical blend', min: BE_RANGES.vfade[0], max: BE_RANGES.vfade[1], step: BE_RANGES.vfade[2] },
];

export const SPEC: TunerSpec<BoardEdgeConfig> = {
  id: 'boardedge',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Board Edge',
  note: 'dev · live · only shows wider than 16:9',
  read: getBoardEdgeConfig,
  write: (key, value) => setBoardEdgeValue(key, value),
  writeColor: (key, value) => setBoardEdgeValue(key, value),
  reset: resetBoardEdgeConfig,
  defaults: DEFAULTS,
  controls,
};

// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the styles.css :root either way).
applyBoardEdgeVars();
