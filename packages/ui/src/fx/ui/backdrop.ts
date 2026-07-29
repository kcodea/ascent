import { Container, Graphics } from 'pixi.js';

export interface FxBackdrop {
  container: Container;
  /** `null` hides the backdrop (transparent — matches the in-game overlay, which is always `backgroundAlpha: 0`).
   *  `0xRRGGBB` fills the viewport with that flat color at full opacity. */
  setColor(hex: number | null): void;
  resize(w: number, h: number): void;
  destroy(): void;
}

/**
 * A full-viewport colored quad meant to be mounted BEHIND the effect on the FX workbench's Pixi overlay.
 * The overlay canvas is fully transparent (`backgroundAlpha: 0` in pixiFx.ts — it's an overlay over the real
 * game DOM), so a lone effect using a `multiply`/`overlay`/`screen` blend mode has nothing underneath to
 * composite against. Multiply against nothing (or against black) always renders black, which makes those
 * blend modes look broken even when they're wired correctly. This backdrop exists purely so the workbench
 * can give blend-mode primitives something real to composite against and become visible/tunable — it has no
 * role in the shipped game; the in-game overlay stays transparent regardless of what's picked here.
 *
 * Cheap by construction: the quad is only redrawn when the color or size actually changes, never per frame.
 */
export function createBackdrop(): FxBackdrop {
  const container = new Container();
  const g = new Graphics();
  container.addChild(g);

  let color: number | null = null;
  let width = 0;
  let height = 0;

  const redraw = (): void => {
    g.clear();
    if (color === null || width <= 0 || height <= 0) return;
    g.rect(0, 0, width, height).fill({ color });
  };

  return {
    container,
    setColor(hex) {
      if (hex === color) return;
      color = hex;
      redraw();
    },
    resize(w, h) {
      if (w === width && h === height) return;
      width = w;
      height = h;
      redraw();
    },
    destroy() {
      container.destroy({ children: true });
    },
  };
}
