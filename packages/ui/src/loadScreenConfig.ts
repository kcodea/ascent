/**
 * Tunable size + placement for the BOOT LOAD SCREEN — the AscentIcon logo and the fake 3.5s progress bar that
 * live in `apps/web/index.html`. Owner-tuned live via the ⏳ Load Screen dev tuner (size the icon, size and
 * position the bar) plus a "Toggle load screen" action that re-shows the splash so it can be judged on demand
 * (the real one is removed the instant boot finishes).
 *
 * Config is localStorage-persisted in DEV only; PRODUCTION always renders the index.html CSS fallbacks (Layout
 * Lab convention). Values reflect to `--ls-*` CSS vars — the index.html fallbacks MUST mirror DEFAULTS.
 */
export interface LoadScreenConfig {
  /** AscentIcon width (px) — the logo is square, so height follows. */
  iconSize: number;
  /** Progress-bar width (px). */
  barWidth: number;
  /** Progress-bar height / thickness (px). */
  barHeight: number;
  /** Progress-bar distance from the bottom of the screen (vh). */
  barBottom: number;
  /** Background radial-gradient CENTRE colour (hex) — the lighter core behind the logo. */
  gradCenter: string;
  /** Background radial-gradient EDGE colour (hex) — the outer fill. */
  gradEdge: string;
  /** Radial-gradient SIZE — the ellipse extent as a % of the viewport (both axes). Bigger = a wider, softer
   *  core; smaller = a tight spotlight. */
  gradSize: number;
  /** Radial-gradient centre X (% across) — moves where the light core sits, i.e. the gradient's "direction". */
  gradPosX: number;
  /** Radial-gradient centre Y (% down). */
  gradPosY: number;
}

/** The config's numeric keys (everything but the two colours) — the tuner's slider set. */
export type LoadScreenNumKey = Exclude<keyof LoadScreenConfig, 'gradCenter' | 'gradEdge'>;
export const LOADSCREEN_COLOR_KEYS = ['gradCenter', 'gradEdge'] as const;

// Mirror the index.html CSS fallbacks (the shipped look). If you change these, change index.html too.
const DEFAULTS: LoadScreenConfig = {
  iconSize: 570,
  barWidth: 413,
  barHeight: 8,
  barBottom: 22.5,
  gradCenter: '#24468a',
  gradEdge: '#0a1730',
  gradSize: 60,
  gradPosX: 50,
  gradPosY: 50,
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key. */
export const LOADSCREEN_RANGES: Record<LoadScreenNumKey, [number, number, number]> = {
  iconSize: [60, 640, 1],
  barWidth: [80, 900, 1],
  barHeight: [1, 40, 1],
  barBottom: [0, 50, 0.5],
  gradSize: [10, 200, 1],
  gradPosX: [0, 100, 1],
  gradPosY: [0, 100, 1],
};

/** One-line definitions, shown as a hover tooltip on each control's name in the DEV tuner. */
export const LOADSCREEN_DESC: Record<keyof LoadScreenConfig, string> = {
  iconSize: 'Width of the centred AscentIcon logo (it is square, so height matches).',
  barWidth: 'Width of the loading bar.',
  barHeight: 'Thickness of the loading bar.',
  barBottom: 'How far the loading bar sits above the bottom of the screen.',
  gradCenter: 'Centre colour of the background gradient — the lighter core behind the logo.',
  gradEdge: 'Edge colour of the background gradient — the outer fill (usually near-black).',
  gradSize: 'Spread of the gradient — how far the centre colour reaches before fading to the edge.',
  gradPosX: 'Horizontal position of the gradient core (0 = left, 100 = right).',
  gradPosY: 'Vertical position of the gradient core (0 = top, 100 = bottom).',
};

export { DEFAULTS as LOADSCREEN_DEFAULTS };

const KEY = 'ascent.loadscreen';
let cfg: LoadScreenConfig = (() => {
  if (typeof localStorage === 'undefined' || !import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<LoadScreenConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getLoadScreenConfig(): LoadScreenConfig {
  return cfg;
}

/** Reflect icon size + bar size/position onto :root as `--ls-*`, which the index.html splash CSS reads.
 *  DEV-only: in production the vars are never set, so the RESPONSIVE index.html fallbacks (a `min()` on the
 *  icon/bar) stand rather than being pinned to flat pixels. */
export function applyLoadScreenVars(): void {
  if (typeof document === 'undefined' || !import.meta.env.DEV) return;
  const root = document.documentElement.style;
  root.setProperty('--ls-icon', `${cfg.iconSize}px`);
  root.setProperty('--ls-bar-w', `${cfg.barWidth}px`);
  root.setProperty('--ls-bar-h', `${cfg.barHeight}px`);
  root.setProperty('--ls-bar-bottom', `${cfg.barBottom}vh`);
  root.setProperty('--ls-grad-center', cfg.gradCenter);
  root.setProperty('--ls-grad-edge', cfg.gradEdge);
  root.setProperty('--ls-grad-size', `${cfg.gradSize}%`);
  root.setProperty('--ls-grad-x', `${cfg.gradPosX}%`);
  root.setProperty('--ls-grad-y', `${cfg.gradPosY}%`);
}

export function setLoadScreenValue(key: keyof LoadScreenConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyLoadScreenVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetLoadScreenConfig(): void {
  cfg = { ...DEFAULTS };
  applyLoadScreenVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * PREVIEW the splash on demand (the "Toggle load screen" tuner action). The real `#bootsplash` is removed the
 * instant boot finishes, so this rebuilds an equivalent node — reusing the SAME id so all of index.html's
 * splash CSS (gradient, fade-in, the 3.5s bar fill) applies unchanged — and leaves it up (no fade-out) until
 * toggled off. Live tuner edits reflect through the shared `--ls-*` vars, so a slider resizes the preview in
 * real time. Returns the new on/off state.
 */
export function toggleLoadScreenPreview(): boolean {
  if (typeof document === 'undefined') return false;
  const existing = document.getElementById('bootsplash');
  if (existing) { existing.remove(); return false; }
  applyLoadScreenVars();
  const el = document.createElement('div');
  el.id = 'bootsplash';
  el.dataset.preview = '1'; // marks a tuner preview (never torn down by Boot)
  const img = document.createElement('img');
  img.id = 'bootsplash-img';
  img.src = `${import.meta.env.BASE_URL}ascenticon.png`;
  img.alt = '';
  const bar = document.createElement('div');
  bar.id = 'bootsplash-bar';
  bar.appendChild(document.createElement('i'));
  el.appendChild(img);
  el.appendChild(bar);
  document.body.appendChild(el);
  // Next frame, add `.is-in` so the fade-in + 3.5s bar fill run exactly as they do at boot.
  requestAnimationFrame(() => el.classList.add('is-in'));
  return true;
}

// Reflect vars at load ONLY when the user has SAVED tuner values. With no saved config the RESPONSIVE
// index.html fallbacks (a `min()` on the icon/bar) must stand — pinning the flat DEFAULT px here overrides that
// `min()` and makes the splash logo JUMP from the responsive size up to a flat 570px the instant the bundle
// mounts, on any viewport where 42vh/42vw < 570 (owner report 2026-08-26). A tuned dev build is already applied
// pre-paint by index.html's inline script, so it stays WYSIWYG with no jump. (`applyLoadScreenVars` is a no-op
// in prod regardless, so this only changes the untuned-DEV path — which now matches prod.)
if (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) !== null) applyLoadScreenVars();
