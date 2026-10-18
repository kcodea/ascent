import { isTouchDevice } from './touchInput';

/**
 * IS THIS A PHONE? (mobile perf pass, 2026-10-18). The one gate for phone-only performance settings (the lighter
 * FX budgets in `fx/fxBudgetConfig.ts`, the lighter plate-dissolve dust). Desktop, laptops with a touchscreen and
 * tablets all answer false and keep their current quality.
 *
 * A phone is a touch device (no hover, coarse pointer: `isTouchDevice`) whose SHORTER screen side is at most
 * `PHONE_MAX_SHORT_SIDE` CSS px. Phones sit at 320-480 in either orientation; the smallest iPad is 744. The screen,
 * not the window, so rotating or resizing never flips the answer mid-session, and it is decided once.
 *
 * Not the same gate as `phoneArt.ts`'s `LITE_ART` (the memory/art path), which deliberately also covers iPads
 * (every iOS device) because of their memory ceiling. These are frame-time settings, and an iPad has the GPU and
 * CPU to keep desktop quality, so they stay phone-only.
 */
export const PHONE_MAX_SHORT_SIDE = 600;

/** Pure: the classification, from the two facts it needs. */
export function classifyPhone(touch: boolean, screenW: number, screenH: number): boolean {
  if (!touch) return false;
  const short = Math.min(screenW, screenH);
  return short > 0 && short <= PHONE_MAX_SHORT_SIDE;
}

let cached: boolean | null = null;

export function isPhone(): boolean {
  if (cached !== null) return cached;
  if (typeof window === 'undefined' || typeof screen === 'undefined') return (cached = false);
  cached = classifyPhone(isTouchDevice(), screen.width || 0, screen.height || 0);
  return cached;
}

/** TEST ONLY: forget the cached answer. */
export function resetDeviceClassForTest(): void {
  cached = null;
}
