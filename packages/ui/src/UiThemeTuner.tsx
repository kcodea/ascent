import {
  THEME_PRESET_NAMES, UI_THEME_DEFAULTS, UI_THEME_RANGES,
  getUiThemeConfig, resetUiThemeConfig, setUiThemeString, setUiThemeValue, type UiThemeConfig,
} from './uiThemeConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the UI SURFACE THEME — the palette behind the game's floating glass surfaces (the
 * quest/rune hover tooltip, the rift-pill tooltip). Changes apply LIVE to anything already on screen; hover a
 * quest badge with the panel open to watch it move.
 *
 * START WITH THE PRESET dropdown: ten stock schemes, each of which rewrites every field below in one go.
 * Touching any individual control afterwards flips the dropdown to `custom`, so it never claims a stock scheme
 * is still intact once you have moved away from it.
 *
 * SHIPPING a look means pasting the values into `DEFAULTS` in `uiThemeConfig.ts` (or setting it to the preset
 * you chose) — the tuner writes localStorage, which is per-browser and invisible to the other dev and to the
 * packaged exe.
 */
const SPECS: Record<keyof UiThemeConfig, [string, TunerUnit | undefined, string, string]> = {
  preset:  ['Stock scheme', undefined, 'Ten ready-made palettes. Picking one rewrites every control below. "Emberforge" is the old brown/orange look, kept as a one-click way back.', 'Scheme'],
  surface: ['Surface tint', undefined, 'The glass body colour, before opacity is applied.', 'Colour'],
  accent:  ['Accent', undefined, 'Bold values inside a tooltip — card names, numbers called out in the text.', 'Colour'],
  value:   ['Value / state', undefined, 'The "state" line (quest progress, rift status) — the gold-role colour.', 'Colour'],
  text:    ['Body text', undefined, 'Ordinary tooltip prose.', 'Colour'],
  panel:   ['Plaque face', undefined, 'The SOLID panel behind the HUD plaques — round bar, stat strip, buff/quest frames, opponent frame. Kept opaque on purpose: a plaque sits over busy board art and has to stay legible.', 'HUD plaques'],
  trim:    ['Plaque trim', undefined, 'The metal rim around those plaques. Shipped gold — change it so the HUD matches the tooltips instead of staying gold-on-brown.', 'HUD plaques'],
  alpha:   ['Opacity', '%', 'How solid the surface is. Lower lets more of the board show through.', 'Surface'],
  blur:    ['Backdrop blur', 'px', 'Frosting behind the surface. 0 turns the blur off entirely, which is the cheapest option — these are small boxes, so the cost is bounded either way.', 'Surface'],
  border:  ['Rim brightness', '%', 'How visible the border and its lit top edge are. The top edge is most of what reads as "glass".', 'Surface'],
  radius:  ['Corner radius', 'px', 'Roundness of the surface corners.', 'Surface'],
};

/** Declaration order IS render order: the preset first, then colours, then the surface feel. */
const ORDER: (keyof UiThemeConfig)[] = ['preset', 'surface', 'accent', 'value', 'text', 'panel', 'trim', 'alpha', 'blur', 'border', 'radius'];
const COLOR_KEYS = new Set<keyof UiThemeConfig>(['surface', 'accent', 'value', 'text', 'panel', 'trim']);

const controls: TunerControl<Extract<keyof UiThemeConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (key === 'preset') {
    return { key, label, hint, group, kind: 'select' as const, options: THEME_PRESET_NAMES, min: 0, max: 0, step: 0 };
  }
  if (COLOR_KEYS.has(key)) {
    return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  }
  const [min, max, step] = UI_THEME_RANGES[key as 'alpha' | 'blur' | 'border' | 'radius'];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<UiThemeConfig> = {
  id: 'uitheme',                    // FROZEN — indexes this panel's dragged position in localStorage
  title: 'UI Theme',
  note: 'dev · live · 10 presets',
  read: getUiThemeConfig as unknown as TunerSpec<UiThemeConfig>['read'],
  write: (key, value) => setUiThemeValue(key as keyof UiThemeConfig, value),
  // Colours AND the preset dropdown both arrive here — the schema routes every string control through
  // `writeColor`, and `setUiThemeString` is what knows a preset means "apply the whole palette".
  writeColor: (key, value) => setUiThemeString(key as keyof UiThemeConfig, value),
  reset: resetUiThemeConfig,
  defaults: UI_THEME_DEFAULTS as unknown as TunerSpec<UiThemeConfig>['defaults'],
  controls,
};

export function UiThemeTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
