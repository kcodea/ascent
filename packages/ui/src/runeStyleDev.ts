/**
 * THE RUNE STYLE PICKER's state (DEV only, owner ask 2026-10-07): which of the six candidate rune-card treatments
 * (runeStyles.css) every live RuneCard wears, as `data-rune-style="1".."6"` on <html>. Unset = the shipped look.
 * Persists in localStorage so a reload keeps the owner's pick; production never reads or writes it.
 */
const KEY = 'ascent.runeStyle';

export function getRuneStyle(): number {
  if (!import.meta.env.DEV) return 0;
  try { return Number(localStorage.getItem(KEY) ?? 0) || 0; } catch { return 0; }
}

export function setRuneStyle(n: number): void {
  if (!import.meta.env.DEV || typeof document === 'undefined') return;
  if (n >= 1 && n <= 6) document.documentElement.dataset.runeStyle = String(n);
  else delete document.documentElement.dataset.runeStyle;
  try { if (n) localStorage.setItem(KEY, String(n)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// Apply the persisted pick at load.
if (import.meta.env.DEV && typeof document !== 'undefined') setRuneStyle(getRuneStyle());
