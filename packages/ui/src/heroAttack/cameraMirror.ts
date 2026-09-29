/**
 * THE CAMERA IS APPLIED ONCE. Since the scaled stage (#1762) the shared Pixi FX canvas lives INSIDE `#stage`, so the
 * DOM camera (`StageCamera`) already zooms and shakes it. Mirroring the same camera onto a style's Pixi root as well
 * applied it twice, and at peak zoom the FX overshot the portrait (found by the Banana attack, PR #1839). A style
 * mirrors the camera onto its root only when its canvas is NOT inside the camera element (a sandbox that mounts its own
 * canvas elsewhere). Added 2026-09-29 with the first Epic attacks (Card Shark, Storm Call).
 */

/** Whether the Pixi canvas a style draws on already moves with `cameraEl` (then the mirror stays off). */
export function canvasInCamera(cameraEl: HTMLElement | null, sandboxed: boolean): boolean {
  if (!cameraEl) return false;
  try {
    if (sandboxed) return cameraEl.querySelector('canvas') !== null;
    const c = typeof document !== 'undefined' ? document.querySelector('canvas.pixifx-above') : null;
    return !!c && cameraEl.contains(c);
  } catch { return false; }
}
