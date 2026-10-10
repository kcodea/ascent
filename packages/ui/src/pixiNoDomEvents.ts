import type { Application } from 'pixi.js';

/**
 * Unhook Pixi's DOM event system from an FX canvas (gameplay perf pass, 2026-10-09).
 *
 * Every Pixi `Application` boots an `EventSystem`, which puts a CAPTURE `pointermove` listener on `document`
 * and a `pointerup` one on `window`. Each event it receives calls `mapPositionToPoint`, which reads the canvas's
 * `getBoundingClientRect()`: a forced style + layout on every mouse move, anywhere on the page, in every phase.
 * Its `EventsTicker` also dispatches a SYNTHETIC `pointermove` on `document` every ten system-ticker frames while
 * the mouse is still, so the forced layout (and every game `pointermove` listener) ran ~24 times a second at
 * 240 Hz even with the mouse at rest. Measured in the shop: 2.5-3 ms of forced style per mouse move during a
 * hover sweep (`_onPointerMove` -> `mapPositionToPoint` -> `getBoundingClientRect`).
 *
 * None of ASCENT's Pixi canvases is interactive: they are `pointer-events: none` overlays, and no display object
 * anywhere sets an interactive `eventMode` or listens for a federated event. So the event system does nothing
 * but cost. `setTargetElement(null)` removes its listeners and its ticker hook; rendering is untouched.
 */
export function detachPixiDomEvents(app: Application): void {
  try {
    app.renderer.events?.setTargetElement(null as unknown as HTMLElement); // null is the documented "detach" (EventSystem.destroy does the same)
  } catch {
    // An exotic renderer without the events extension: nothing was hooked up, nothing to undo.
  }
}
