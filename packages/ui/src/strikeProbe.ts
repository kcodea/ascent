/**
 * DEV-only strike/impact PROBE — temporary instrumentation for the "impact ring fires off-target" hunt
 * (owner reports 2026-07-21, persisting through three fixes: layout-frame compensation, late-solved strike
 * targets, live impact points). Three fixes without a cure means the failure model is wrong somewhere, so
 * this stops guessing and gathers evidence that discriminates between the remaining hypotheses:
 *   (a) our impact fires at the wrong coords            → the IMP marker will sit off the defender;
 *   (b) our impact is fine and the stray ring is some   → IMP + DEF markers sit ON the defender while the
 *       OTHER FX (crit flourish / pulse / aura wave)      ring appears elsewhere, unmarked;
 *   (c) the attacker isn't where we think at contact    → the contact log's attacker centre is far from the
 *       (element replaced mid-lunge / timeline gutted)    defender, or `connected: false` shows up.
 *
 * Two channels, both DEV-gated (stripped from prod):
 *   - `probeMark` — a small labelled crosshair at the exact point an FX fires, visible for ~0.9s in the
 *     owner's own tab while playing (the owner plays on the dev server, so the markers ride along);
 *   - `probeLog` — a localStorage ring buffer (`ascent.strikeProbe`) readable from the owner's tab after a
 *     session (the established shared-probe pattern: the owner plays in THEIR focused tab — rAF and
 *     measurement behave — and the numbers persist for later analysis).
 *
 * DELETE this file (and its call sites) once the hunt closes — it is instrumentation, not a feature.
 */

const KEY = 'ascent.strikeProbe';

export function probeLog(entry: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[];
    arr.unshift({ t: Math.round(performance.now()), ...entry });
    localStorage.setItem(KEY, JSON.stringify(arr.slice(0, 120)));
  } catch {
    /* ignore */
  }
}

/** Round a point for compact logging. */
export function pt(x: number, y: number): [number, number] {
  return [Math.round(x), Math.round(y)];
}

export function probeMark(x: number, y: number, color: string, label: string): void {
  if (!import.meta.env.DEV || typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;left:${x - 7}px;top:${y - 7}px;width:14px;height:14px;border:2px solid ${color};border-radius:50%;z-index:99999;pointer-events:none;box-shadow:0 0 0 1px rgba(0,0,0,0.8);`;
  const tag = document.createElement('span');
  tag.textContent = label;
  tag.style.cssText = `position:absolute;left:16px;top:-4px;font:700 10px monospace;color:${color};text-shadow:0 0 3px #000,0 0 3px #000;white-space:nowrap;`;
  el.appendChild(tag);
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 900);
}
