/**
 * PHONE GPU MEMORY + THE PHONE DIAGNOSTICS SWITCHES (R-TOUCH-GPU-MEMORY-01, owner 2026-10-18: the iPhone still crashed
 * on the mode home after the audio fix; the crash log read "title view modes ... images 15 (35.5 MB), WebGL 4 of 7",
 * so neither audio nor decoded images were it. What is left is GPU / compositor memory, which Chrome cannot model).
 *
 * TWO THINGS LIVE HERE.
 *
 * 1. THE PHONE GPU POLICY (`PHONE_GPU`, the `LITE_ART` gate: every iOS device and small touch screens; desktop reads
 *    none of it). The WebGL canvases are lazy and short-lived on a phone: no FX canvas exists on the title, the mode
 *    home or any menu page (PixiFxLayer brings the board layers up for hero select and the run, and tears them down
 *    on the way back); each one renders at `PHONE_PIXI_RES` (1.5) instead of 2, with `powerPreference: 'low-power'`.
 *    The menus stop their looping animations after one cycle (touchUi.css, keyed off `html[data-phone-gpu]`). And on
 *    the menus the stage is shrunk with CSS `zoom` instead of `transform: scale()` (stage.ts `setStageMenuZoom`):
 *    WebKit pays a layer inside a transformed stage at its full stage size times 3x3, while a zoomed stage lays its
 *    layers out at their on-screen size. Measured layout matches within 1-2 px. Hero select, the gate and the run zoom
 *    too (R-TOUCH-RUN-MEMORY-01, 2026-10-22) when the browser passes the zoom-geometry probe (`zoomGeometryIsStandard`
 *    in stage.ts: their drag and FX maths measure the screen, so they need zoomed rects reported the standard way);
 *    otherwise they keep the transform.
 *
 * 2. THE DIAGNOSTICS SWITCHES. We can only test on the owner's phone, through the crash log. A Home Screen web app
 *    cannot be given a query string and keeps its own storage (separate from Safari's), so the switches are toggles in
 *    Settings (EscMenu, "Phone diagnostics", phones only) stored in localStorage. They are read ONCE at load, so a
 *    change applies on the next launch (the panel has a Reload button). Every crash-log step records the active ones.
 *      nofx    no WebGL FX canvases at all (the game plays with no Pixi effects)
 *      res1    every Pixi canvas at resolution 1 (CSS px), not 1.5
 *      noanim  no animations or transitions at all on the menus (not just the loops)
 *      zoom    the stage is shrunk with CSS `zoom` in games even when the geometry probe says not to (see stage.ts)
 *      nozoom  the menus go back to `transform: scale()` (the old way), to bisect the menu zoom
 *      gamexf  hero select, the gate and the run go back to `transform: scale()` (R-TOUCH-RUN-MEMORY-01 zooms them
 *              by default on a phone whose browser reports zoomed geometry the standard way)
 *      litebd  no painted menu backdrop (a flat dark ground)
 *    `?phonediag=nofx,res1` (in Safari, or any browser) sets them too; `?phonediag=0` clears them.
 */
import type { ApplicationOptions } from 'pixi.js';
import { LITE_ART } from './phoneArt';

export const PHONE_DIAG_KEY = 'ascent.phonediag.v1';

export type PhoneDiagFlag = 'nofx' | 'res1' | 'noanim' | 'zoom' | 'nozoom' | 'gamexf' | 'litebd';
export const PHONE_DIAG_FLAGS: ReadonlyArray<{ id: PhoneDiagFlag; label: string; hint: string }> = [
  { id: 'nofx', label: 'No effect canvases', hint: 'No WebGL effects at all.' },
  { id: 'res1', label: 'Effects at resolution 1', hint: 'Sharper effects off, less GPU memory.' },
  { id: 'noanim', label: 'No menu animations', hint: 'Menus stand still.' },
  { id: 'zoom', label: 'Flat stage everywhere', hint: 'Zoom the stage in games even if this browser fails the zoom check.' },
  { id: 'nozoom', label: 'Old stage on menus', hint: 'Scale the menus by transform, as before.' },
  { id: 'gamexf', label: 'Old stage in games', hint: 'Scale hero select and games by transform, as before.' },
  { id: 'litebd', label: 'Lite menu backdrop', hint: 'No painted backdrop on the menus.' },
];
export type PhoneDiagFlags = Partial<Record<PhoneDiagFlag, 1>>;

/** Pure: parse the stored value (JSON object of flags set to 1). Unknown keys and bad JSON are dropped. */
export function parseDiagFlags(raw: string | null): PhoneDiagFlags {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: PhoneDiagFlags = {};
    for (const f of PHONE_DIAG_FLAGS) if (v && v[f.id]) out[f.id] = 1;
    return out;
  } catch { return {}; }
}

/** Pure: the flags a `?phonediag=` value asks for (`0` / empty clears them). */
export function parseDiagQuery(q: string): PhoneDiagFlags {
  const out: PhoneDiagFlags = {};
  for (const part of q.split(',')) {
    const id = part.trim() as PhoneDiagFlag;
    if (PHONE_DIAG_FLAGS.some((f) => f.id === id)) out[id] = 1;
  }
  return out;
}

function readFlags(): PhoneDiagFlags {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return {};
  try {
    const q = new URLSearchParams(window.location.search).get('phonediag');
    if (q !== null) {
      const f = parseDiagQuery(q);
      if (Object.keys(f).length) localStorage.setItem(PHONE_DIAG_KEY, JSON.stringify(f));
      else localStorage.removeItem(PHONE_DIAG_KEY);
    }
    return parseDiagFlags(localStorage.getItem(PHONE_DIAG_KEY));
  } catch { return {}; }
}

/** The phone GPU policy is on (the `LITE_ART` memory path). Desktop: false, and every helper below is the identity. */
export const PHONE_GPU: boolean = LITE_ART;

/** The switches as loaded this session. Only a phone honours them (a desktop with a stale key is untouched). */
export const PHONE_DIAG: Readonly<PhoneDiagFlags> = PHONE_GPU ? readFlags() : {};

/** The active switches as a short string for the crash log (`nofx+res1`), or '' for none. */
export function activeDiagLabel(flags: PhoneDiagFlags = PHONE_DIAG): string {
  return PHONE_DIAG_FLAGS.filter((f) => flags[f.id]).map((f) => f.id).join('+');
}

/** Save the switches for the next launch (Settings). */
export function saveDiagFlags(flags: PhoneDiagFlags): void {
  try {
    if (Object.keys(flags).length) localStorage.setItem(PHONE_DIAG_KEY, JSON.stringify(flags));
    else localStorage.removeItem(PHONE_DIAG_KEY);
  } catch { /* blocked storage: nothing to save into */ }
}
/** The switches as stored right now (what the next launch will use). */
export function storedDiagFlags(): PhoneDiagFlags {
  try { return parseDiagFlags(localStorage.getItem(PHONE_DIAG_KEY)); } catch { return {}; }
}

/** The Pixi resolution on a phone: 1.5 (or 1 with `res1`), never past the device's own ratio. */
export const PHONE_PIXI_RES = 1.5;
export function phonePixiResolution(dpr: number, flags: PhoneDiagFlags = PHONE_DIAG): number {
  return Math.min(dpr || 1, flags.res1 ? 1 : PHONE_PIXI_RES);
}

/**
 * A Pixi `app.init` option set with the phone policy applied. `phone` false returns `opts` UNCHANGED (desktop).
 * On a phone: the resolution is capped (see `phonePixiResolution`; times `scale` for a renderer sized in stage px), the GPU asked for low power, no antialias, no
 * preserved drawing buffer. For a transparent overlay (`backgroundAlpha: 0`, every FX layer) the WebGL context is made
 * here with NO depth buffer (Pixi asks for none, so the browser's default gave every canvas one; a 2D FX layer never
 * reads it) and handed to Pixi. The stencil buffer stays: masks need it.
 */
export function phonePixiOptions(
  opts: Partial<ApplicationOptions>, scale = 1, phone: boolean = PHONE_GPU, dpr: number = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
  flags: PhoneDiagFlags = PHONE_DIAG,
): Partial<ApplicationOptions> {
  if (!phone) return opts;
  const cap = phonePixiResolution(dpr, flags) * scale;
  const out: Partial<ApplicationOptions> = {
    ...opts,
    resolution: Math.min(opts.resolution ?? cap, cap),
    antialias: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  };
  if (opts.backgroundAlpha === 0 && typeof document !== 'undefined') {
    try {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2', {
        alpha: true, premultipliedAlpha: true, antialias: false, stencil: true, depth: false,
        preserveDrawingBuffer: false, powerPreference: 'low-power',
      });
      if (context) { out.canvas = canvas; out.context = context; out.preference = 'webgl'; }
    } catch { /* Pixi makes its own context */ }
  }
  return out;
}

/** False when the `nofx` switch is on: no Pixi Application may be created at all. */
export function pixiAllowed(flags: PhoneDiagFlags = PHONE_DIAG, phone: boolean = PHONE_GPU): boolean {
  return !(phone && flags.nofx);
}

/** Write the phone attributes on `<html>` once (touchUi.css reads them): `data-phone-gpu`, plus one per CSS switch. */
export function applyPhoneDiagAttributes(): void {
  if (!PHONE_GPU || typeof document === 'undefined') return;
  const de = document.documentElement;
  de.setAttribute('data-phone-gpu', '');
  if (PHONE_DIAG.noanim) de.setAttribute('data-pd-noanim', '');
  if (PHONE_DIAG.litebd) de.setAttribute('data-pd-litebd', '');
  if (PHONE_DIAG.zoom) de.setAttribute('data-pd-zoom', '');
}
applyPhoneDiagAttributes();
