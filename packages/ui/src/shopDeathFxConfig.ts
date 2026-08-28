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
  /**
   * When the Echo burst plays, relative to the moment the body is destroyed.
   *
   * NEGATIVE is a LEAD: the skull fires that many ms BEFORE the destruction, while the body is still on the
   * board — which is what "trigger slightly earlier" means (owner 2026-08-28). A lead needs a window to live
   * in, so it applies where one exists: Funeral on Loan's landing. A destroy that resolves in a single action
   * (Graverobber) has no window, and a lead there clamps to 0.
   *
   * POSITIVE delays it past the destruction. 0 fires it as the body leaves.
   */
  echoDelayMs: number;
  /** ms after the commit before the death dissolve plays. */
  deathDelayMs: number;
  /**
   * ms the surviving cards WAIT before sliding into the dead minion's slot (owner ask 2026-08-28: "a SHORT
   * delay after the minion dies, for the cards to shift into place. like a 10-20 ms delay").
   *
   * The board reflows the instant the death commits, so the gap closes under the animation that is still
   * playing over it. This holds the row still for a beat so the death reads as a death rather than as the
   * board rearranging itself. Applies ONLY to the shift that follows a death — every other commit (a buy, a
   * sell, a reorder) glides as it always did.
   */
  shiftDelayMs: number;
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
  // The owner's tuned value (2026-08-28), dialled live and handed back: 480 → 300 → 200.
  landingMs: 200,
  // A 120ms LEAD, so the skull fires while the body is still there and the departure lands INTO it, rather
  // than after it (owner: "can we have the pixi purple skull animation trigger slightly earlier?").
  echoDelayMs: -40, // the owner's tuned lead (2026-08-28)
  deathDelayMs: 0,
  shiftDelayMs: 15, // the owner's "like a 10-20 ms delay"
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
  echoDelayMs: [-400, 800, 10],
  deathDelayMs: [0, 800, 10],
  shiftDelayMs: [0, 400, 5],
  offsetX: [-200, 200, 1],
  offsetY: [-200, 200, 1],
  sizeScale: [0.2, 3, 0.05],
  echoEnabled: [0, 1, 1],
  deathEnabled: [0, 1, 1],
};
