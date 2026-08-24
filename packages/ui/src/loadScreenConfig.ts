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
}

// Mirror the index.html CSS fallbacks (the shipped look). If you change these, change index.html too.
const DEFAULTS: LoadScreenConfig = {
  iconSize: 300,
  barWidth: 340,
  barHeight: 6,
  barBottom: 12,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const LOADSCREEN_RANGES: Record<keyof LoadScreenConfig, [number, number, number]> = {
  iconSize: [60, 640, 1],
  barWidth: [80, 900, 1],
  barHeight: [1, 40, 1],
  barBottom: [0, 50, 0.5],
};

/** One-line definitions, shown as a hover tooltip on each control's name in the DEV tuner. */
export const LOADSCREEN_DESC: Record<keyof LoadScreenConfig, string> = {
  iconSize: 'Width of the centred AscentIcon logo (it is square, so height matches).',
  barWidth: 'Width of the loading bar.',
  barHeight: 'Thickness of the loading bar.',
  barBottom: 'How far the loading bar sits above the bottom of the screen.',
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
}

export function setLoadScreenValue(key: keyof LoadScreenConfig, value: number): void {
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

// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the index.html fallbacks either way).
applyLoadScreenVars();
