/**
 * Tunable layout for the HERO PANEL — the bottom-left tray (`.statusbar .hero`) holding the hero portrait,
 * the player-name pill (top eclipse), the hero-name pill (bottom eclipse), and the Resolve box. Every part
 * gets its own x/y/scale so the owner can seat each piece by eye (🧍 Hero Panel in the Dev Tuning Menu).
 * (The power DIAMOND is separate — the 💠 tuner / heroPowerBtnConfig.ts; quest badges are Layout Lab's.)
 *
 * Same architecture as the diamond configs: dev-only localStorage persistence, values reflected as
 * COMPOSED transform strings on :root (`--hpn-*-t`) that the CSS reads (`transform: var(--hpn-…-t, <base>)`)
 * — composed in JS because several elements carry a BASE centering transform (the pills' translate(-50%,…))
 * that the offsets must stack onto, and the Resolve box's hit-shake keyframes prepend the same var so a
 * tuned offset survives the shake. Panel offsets are stage-px (× --scale); element offsets are design-px
 * (× --u). PRODUCTION runs `applyHeroPanelVars()` at load with DEFAULTS (identity — matches the CSS
 * fallbacks), so shipping tuned values means baking them here.
 */
export interface HeroPanelConfig {
  /** Whole panel — px offset from its bottom-left anchor (× --scale). +x → right. */
  panelX: number;
  /** Whole panel — px offset (× --scale). +y → down. */
  panelY: number;
  /** Whole panel — scale (×), about its bottom-left anchor. */
  panelScale: number;
  /** Whole panel — explicit tray WIDTH (design px, × --u). 0 = auto (sized by its contents). */
  panelW: number;
  /** Whole panel — explicit tray HEIGHT (design px, × --u). 0 = auto. */
  panelH: number;
  /** Hero portrait (the framed art) — design-px offset (× --u). */
  portraitX: number;
  portraitY: number;
  /** Hero portrait — scale (×). NB: the hero-name pill lives inside the portrait frame, so it rides this
   *  scale too; its own dials stack on top. */
  portraitScale: number;
  /** Player-name pill (eclipsing the tray's top) — design-px offset (× --u). */
  playerNameX: number;
  playerNameY: number;
  playerNameScale: number;
  /** Hero-name pill (eclipsing the portrait's bottom) — design-px offset (× --u). */
  heroNameX: number;
  heroNameY: number;
  heroNameScale: number;
  /** Resolve box (heart + HP) — design-px offset (× --u). */
  resolveX: number;
  resolveY: number;
  resolveScale: number;
}

const DEFAULTS: HeroPanelConfig = {
  panelX: 0, panelY: 0, panelScale: 1, panelW: 0, panelH: 0,
  portraitX: 0, portraitY: 0, portraitScale: 1,
  playerNameX: 0, playerNameY: 0, playerNameScale: 1,
  heroNameX: 0, heroNameY: 0, heroNameScale: 1,
  resolveX: 0, resolveY: 0, resolveScale: 1,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const HPN_RANGES: Record<keyof HeroPanelConfig, [number, number, number]> = {
  panelX: [-400, 800, 1], panelY: [-800, 400, 1], panelScale: [0.4, 2.5, 0.01],
  panelW: [0, 500, 1], panelH: [0, 400, 1],
  portraitX: [-200, 200, 1], portraitY: [-200, 200, 1], portraitScale: [0.4, 2.5, 0.01],
  playerNameX: [-200, 200, 1], playerNameY: [-200, 200, 1], playerNameScale: [0.4, 2.5, 0.01],
  heroNameX: [-200, 200, 1], heroNameY: [-200, 200, 1], heroNameScale: [0.4, 2.5, 0.01],
  resolveX: [-200, 200, 1], resolveY: [-200, 200, 1], resolveScale: [0.4, 2.5, 0.01],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const HPN_DESC: Record<keyof HeroPanelConfig, string> = {
  panelX: 'Whole panel — horizontal offset (stage px × scale) from its bottom-left corner anchor.',
  panelY: 'Whole panel — vertical offset. Positive = down.',
  panelScale: 'Whole panel — overall size (×), scaling about the bottom-left anchor.',
  panelW: 'Whole panel — the tray box WIDTH (design px). 0 = auto (hug the contents).',
  panelH: 'Whole panel — the tray box HEIGHT (design px). 0 = auto.',
  portraitX: 'Hero portrait — horizontal nudge (design px).',
  portraitY: 'Hero portrait — vertical nudge (design px).',
  portraitScale: 'Hero portrait — size (×). The hero-name pill rides this too (it lives on the frame).',
  playerNameX: 'Player-name pill — horizontal nudge (design px).',
  playerNameY: 'Player-name pill — vertical nudge (design px).',
  playerNameScale: 'Player-name pill — size (×).',
  heroNameX: 'Hero-name pill — horizontal nudge (design px).',
  heroNameY: 'Hero-name pill — vertical nudge (design px).',
  heroNameScale: 'Hero-name pill — size (×).',
  resolveX: 'Resolve box — horizontal nudge (design px).',
  resolveY: 'Resolve box — vertical nudge (design px).',
  resolveScale: 'Resolve box — size (×).',
};

export const HPN_KEYS = [
  'panelX', 'panelY', 'panelScale', 'panelW', 'panelH',
  'portraitX', 'portraitY', 'portraitScale',
  'playerNameX', 'playerNameY', 'playerNameScale',
  'heroNameX', 'heroNameY', 'heroNameScale',
  'resolveX', 'resolveY', 'resolveScale',
] as const;

const KEY = 'ascent.heropanel';
// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: HeroPanelConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<HeroPanelConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getHeroPanelConfig(): HeroPanelConfig {
  return cfg;
}

/** Reflect the config onto :root as COMPOSED transform strings (see the header for why). */
export function applyHeroPanelVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  // Element transform: design-px offsets × --u + a scale. `base` prepends an element's own centering
  // transform (the pills) so the nudge stacks onto it instead of replacing it.
  const t = (x: number, y: number, s: number, base = ''): string =>
    `${base}${base ? ' ' : ''}translate(calc(${x} * var(--u)), calc(${y} * var(--u))) scale(${s})`;
  root.setProperty('--hpn-panel-t', `translate(calc(${cfg.panelX}px * var(--scale)), calc(${cfg.panelY}px * var(--scale))) scale(${cfg.panelScale})`);
  // Tray dimensions — 0 means AUTO: remove the var so the CSS fallback (`auto`) takes over.
  if (cfg.panelW > 0) root.setProperty('--hpn-panel-w', `calc(${cfg.panelW} * var(--u))`);
  else root.removeProperty('--hpn-panel-w');
  if (cfg.panelH > 0) root.setProperty('--hpn-panel-h', `calc(${cfg.panelH} * var(--u))`);
  else root.removeProperty('--hpn-panel-h');
  root.setProperty('--hpn-portrait-t', t(cfg.portraitX, cfg.portraitY, cfg.portraitScale));
  root.setProperty('--hpn-pname-t', t(cfg.playerNameX, cfg.playerNameY, cfg.playerNameScale, 'translate(-50%, -55%)'));
  root.setProperty('--hpn-hname-t', t(cfg.heroNameX, cfg.heroNameY, cfg.heroNameScale, 'translate(-50%, 52%)'));
  root.setProperty('--hpn-hp-t', t(cfg.resolveX, cfg.resolveY, cfg.resolveScale));
}

export function setHeroPanelValue(key: keyof HeroPanelConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyHeroPanelVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetHeroPanelConfig(): void {
  cfg = { ...DEFAULTS };
  applyHeroPanelVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
// Reflect vars at load (dev: persisted values; prod: DEFAULTS — identity, matching the CSS fallbacks).
applyHeroPanelVars();
