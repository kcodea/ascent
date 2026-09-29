/**
 * THE CAMERA MIRROR, applied ONCE (added 2026-09-29 with the Rare attacks; the finding is the Banana PR's, #1839).
 *
 * Since the scaled stage (#1762) the shared Pixi overlay canvas lives INSIDE `#stage`, so the DOM camera
 * (`StageCamera`) already zooms and shakes it. Mirroring the same transform onto the scene's Pixi root as well applies
 * it TWICE and every FX drifts off its focus by the zoom. So the mirror only moves the root when the canvas is NOT
 * inside the camera element (a test, or no DOM camera at all); otherwise it holds the root at rest. Decided once, when
 * the camera starts (the overlay slot is up by then).
 */
import type { CameraMirror } from './stageCamera';

export interface OverlayCamera {
  /** The mirror to hand `StageCamera` (null with no scene). */
  readonly mirror: CameraMirror | null;
  /** Decide whether the mirror moves the root (call when the camera starts). */
  decide(): void;
  /** Whether the mirror is moving the root. */
  readonly on: boolean;
}

export function overlayCamera(scene: CameraMirror | null, cameraEl: HTMLElement | null, mounted: boolean): OverlayCamera {
  let on = true;
  const inCamera = (): boolean => {
    if (!cameraEl) return false;
    try {
      if (mounted) return cameraEl.querySelector('canvas') !== null;
      const c = typeof document !== 'undefined' ? document.querySelector('canvas.pixifx-above') : null;
      return !!c && cameraEl.contains(c);
    } catch { return false; }
  };
  const mirror: CameraMirror | null = scene
    ? { setCamera: (ax, ay, z) => { if (on) scene.setCamera(ax, ay, z); else scene.setCamera(0, 0, 1); } }
    : null;
  return {
    mirror,
    decide: () => { on = !inCamera(); },
    get on() { return on; },
  };
}
