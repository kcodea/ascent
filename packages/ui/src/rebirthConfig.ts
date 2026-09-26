import { CROWN_FRAMES, crownUrl, embersSvg, pillarUrl, svgUrl, veilSvg } from './rebirthCrown';

/**
 * The REBIRTH look. History: 2026-09-25 the owner asked for a phoenix look "similar to rise, but less intrusive,
 * more thin and less haze", in "blue and white fire" (deep cobalt → cyan → a white-hot core, clear of Rise's
 * aqua-green, Ward's gold and the Time Ancient's azure). That first pass (a 3px rim + a few motes) was judged
 * "not noticeable and ugly" (2026-09-26); the spiky v2 was "still really bad … blur it … it should be on top of the
 * card", so it is now:
 *  · IDLE, on every card with Rebirth (`RB`): SOFT blue-white fire burning ON the frame, over the art like Ward's
 *    shell (pre-rendered, pre-blurred SVG frames from `rebirthCrown.ts`, oval or Taunt-shield silhouette,
 *    cross-faded by opacity and breathed by scale), a faint ring of light (a static gradient whose opacity
 *    breathes: the `kwglow` pattern) and embers rising off the flames (transform/opacity only). CSS only: no
 *    Pixi, no live filter, no per-frame paint;
 *  · TRIGGER, on a real rebirth in combat: the one-shot `rebirth-flame` Pixi def at the slot (recoloured to the
 *    tuner's colours, sized by `burstScale`, stretched by `burstTime`), the unit re-forming out of the fire
 *    (`.unit.rebirthing`, one-shot transform/opacity), and a flame whoosh `soundOffset` ms later.
 * Reflected onto :root as `--rb-*` vars (CSS reads them live). Dev-persisted; production uses the defaults.
 */
export interface RebirthConfig {
  /** Peak opacity of the flame crown. */
  crownAlpha: number;
  /** Peak opacity of the flame VEIL over the portrait (the fire licking up over the art's lower edge). */
  veilAlpha: number;
  /** Flame length (×): how far the tongues lick above the frame. */
  crownSize: number;
  /** Seconds for one full flicker cycle through the crown's frames. Lower = livelier. */
  flickerSpeed: number;
  /** Peak opacity of the cobalt glow behind the oval (breathes between 55% and 100% of this). */
  glowAlpha: number;
  /** Seconds per glow breathe. */
  glowPulse: number;
  /** Rising embers per card (0 hides them). Applies to cards drawn after the change. */
  emberCount: number;
  /** Peak ember opacity. */
  emberAlpha: number;
  /** Ember size (% of the card width). */
  emberSize: number;
  /** Deep outer flame colour (cobalt). */
  colorB: string;
  /** Hot mid flame colour (cyan). */
  colorA: string;
  /** White-hot core colour. */
  colorCore: string;
  /** The rebirth burst's size (×). */
  burstScale: number;
  /** The rebirth burst's duration (×): stretches the flame column's life. */
  burstTime: number;
  /** The flame whoosh's gain (0 mutes). */
  soundGain: number;
  /** The whoosh's delay after the burst starts (ms). */
  soundOffset: number;
}

const DEFAULTS: RebirthConfig = {
  crownAlpha: 1,
  veilAlpha: 0.65,
  crownSize: 1,
  flickerSpeed: 1.5,
  glowAlpha: 0.45,
  glowPulse: 2.4,
  emberCount: 5,
  emberAlpha: 0.8,
  emberSize: 5,
  colorB: '#2a5cff',
  colorA: '#6fdcff',
  colorCore: '#f4fdff',
  burstScale: 1,
  burstTime: 1,
  soundGain: 0.7,
  soundOffset: 0,
};
export { DEFAULTS as REBIRTH_DEFAULTS };

type ColorKey = 'colorA' | 'colorB' | 'colorCore';
export const REBIRTH_COLOR_KEYS: readonly ColorKey[] = ['colorB', 'colorA', 'colorCore'];

export const REBIRTH_RANGES: Record<Exclude<keyof RebirthConfig, ColorKey>, [number, number, number]> = {
  crownAlpha: [0, 1, 0.01],
  veilAlpha: [0, 1, 0.01],
  crownSize: [0.4, 1.4, 0.05],
  flickerSpeed: [0.3, 3, 0.05],
  glowAlpha: [0, 1, 0.01],
  glowPulse: [0.6, 8, 0.1],
  emberCount: [0, 12, 1],
  emberAlpha: [0, 1, 0.01],
  emberSize: [2, 12, 0.5],
  burstScale: [0.3, 2.5, 0.05],
  burstTime: [0.5, 2, 0.05],
  soundGain: [0, 1, 0.01],
  soundOffset: [0, 600, 10],
};

const KEY = 'ascent.rebirth';
/** Keep only the keys this version knows — the retired rim knobs of the first pass must not ride along. */
function known(saved: unknown): Partial<RebirthConfig> {
  if (!saved || typeof saved !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULTS)) {
    const v = (saved as Record<string, unknown>)[k];
    if (typeof v === typeof DEFAULTS[k as keyof RebirthConfig]) out[k] = v;
  }
  return out as Partial<RebirthConfig>;
}
let cfg: RebirthConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...known(JSON.parse(localStorage.getItem(KEY) ?? '{}')) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getRebirthConfig(): RebirthConfig { return cfg; }

/** `#rrggbb` → 0xRRGGBB (a Pixi palette stop). Anything else → null. */
export function hexToNum(hex: string): number | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1]!, 16) : null;
}
/** The 4-stop rim→core palette the `rebirth-flame` def is recoloured with (deep, mid, hot, core). */
export function rebirthPalette(c: RebirthConfig = cfg): number[] | undefined {
  const d = hexToNum(c.colorB), h = hexToNum(c.colorA), w = hexToNum(c.colorCore);
  if (d === null || h === null || w === null) return undefined;
  const mix = (a: number, b: number): number => {
    const ch = (s: number): number => Math.round((((a >> s) & 255) + ((b >> s) & 255)) / 2) << s;
    return ch(16) | ch(8) | ch(0);
  };
  return [d, mix(d, h), h, w];
}

let lastCrownKey = '';
export function applyRebirthVars(): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  r.setProperty('--rb-crown-a', String(cfg.crownAlpha));
  r.setProperty('--rb-veil-a', String(cfg.veilAlpha));
  r.setProperty('--rb-flicker', `${cfg.flickerSpeed}s`);
  r.setProperty('--rb-glow-a', String(cfg.glowAlpha));
  r.setProperty('--rb-glow-pulse', `${cfg.glowPulse}s`);
  r.setProperty('--rb-ember-a', String(cfg.emberAlpha));
  r.setProperty('--rb-ember-size', `${cfg.emberSize}%`);
  r.setProperty('--rb-a', cfg.colorA);
  r.setProperty('--rb-b', cfg.colorB);
  r.setProperty('--rb-core', cfg.colorCore);
  r.setProperty('--rb-burst-dur', `${(1.05 * cfg.burstTime).toFixed(3)}s`);
  // The crown frames are only re-rendered when something they bake in (colours, flame length) changed.
  const crownKey = `${cfg.colorB}|${cfg.colorA}|${cfg.colorCore}|${cfg.crownSize}`;
  if (crownKey !== lastCrownKey) {
    lastCrownKey = crownKey;
    const colors = { deep: cfg.colorB, hot: cfg.colorA, core: cfg.colorCore };
    for (let k = 0; k < CROWN_FRAMES; k++) {
      r.setProperty(`--rb-crown-${k}`, crownUrl(k, colors, cfg.crownSize, 'oval'));
      r.setProperty(`--rb-crown-s-${k}`, crownUrl(k, colors, cfg.crownSize, 'shield'));
    }
    r.setProperty('--rb-pillar', pillarUrl(colors));
    r.setProperty('--rb-veil', svgUrl(veilSvg(colors)));
    r.setProperty('--rb-embers', svgUrl(embersSvg(colors)));
  }
}

export function setRebirthValue(key: keyof RebirthConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyRebirthVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetRebirthConfig(): void {
  cfg = { ...DEFAULTS };
  applyRebirthVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
applyRebirthVars();
