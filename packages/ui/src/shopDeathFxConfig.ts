/**
 * SHOP DEATH / ECHO FX — the tunables (owner ask 2026-08-28: "add a tuner to the dev panel for this ... so i
 * can control timings and even position if need be for animations and time before destruction").
 *
 * Three things are dialable here, and they are dialable because the right values can only be judged by
 * watching, not reasoned about:
 *
 *   · `landingMs`  — how long Funeral on Loan's borrowed body sits on the board before its death resolves.
 *                    Shipped at 480ms, cut to 300ms on the owner's "should stick around for a shorter time";
 *                    the dial exists so the next adjustment is not a code change.
 *   · `echoDelayMs` / `deathDelayMs` — the beat between the body leaving and each animation firing.
 *   · `offsetX` / `offsetY` / `sizeScale` — where the animation lands relative to the card's centre, for the
 *                    case the owner named: the Echo must play WHERE THE CARD WAS.
 *
 * Same trio pattern as `questTendrilConfig.ts` / `infuseFxConfig.ts`: DEV-persisted to localStorage, read at
 * FIRE TIME so an edit applies to the next death without a reload, and inert in production (which always
 * renders DEFAULTS — a tuned value has to be published deliberately).
 */
export interface ShopDeathFxConfig {
  /** ms the borrowed body stays on the board before `resolveShopDeath` fires. 0 = resolve immediately. */
  landingMs: number;
  /** ms after the commit before the Echo burst plays. */
  echoDelayMs: number;
  /** ms after the commit before the death dissolve plays. */
  deathDelayMs: number;
  /** px from the card's centre — positive Y is DOWN, matching screen coordinates. */
  offsetX: number;
  offsetY: number;
  /** Multiplies the card width handed to `pixiFx.deathrattle`, which scales the burst. */
  sizeScale: number;
  /** 1 = play the Echo burst, 0 = off. A kill switch while judging the others. */
  echoEnabled: number;
  /** 1 = play the death dissolve, 0 = off. */
  deathEnabled: number;
}

const DEFAULTS: ShopDeathFxConfig = {
  // 300ms: long enough to read as "it landed", short enough not to feel like a stall. The owner's correction
  // to the 480ms this shipped with.
  landingMs: 300,
  echoDelayMs: 0,
  deathDelayMs: 0,
  offsetX: 0,
  offsetY: 0,
  sizeScale: 1,
  echoEnabled: 1,
  deathEnabled: 1,
};

const KEY = 'ascent.fx.shopDeath.v1';

let cfg: ShopDeathFxConfig = load();

function load(): ShopDeathFxConfig {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ShopDeathFxConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function getShopDeathFxConfig(): ShopDeathFxConfig {
  return cfg;
}
export function setShopDeathFxValue(key: keyof ShopDeathFxConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetShopDeathFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export const SHOP_DEATH_FX_DEFAULTS: Readonly<ShopDeathFxConfig> = DEFAULTS;

/** [min, max, step] per dial, for the tuner's sliders. */
export const SHOP_DEATH_FX_RANGES: Partial<Record<keyof ShopDeathFxConfig, [number, number, number]>> = {
  landingMs: [0, 1200, 10],
  echoDelayMs: [0, 800, 10],
  deathDelayMs: [0, 800, 10],
  offsetX: [-200, 200, 1],
  offsetY: [-200, 200, 1],
  sizeScale: [0.2, 3, 0.05],
  echoEnabled: [0, 1, 1],
  deathEnabled: [0, 1, 1],
};
