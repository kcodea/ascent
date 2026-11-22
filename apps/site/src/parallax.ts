/** The top section's depth: its painted layers slide a little as the mouse moves, the near ones further than the far. */

export interface ParallaxOptions {
  reducedMotion: boolean;
  /** True when the visitor has a mouse or trackpad. A finger has no hover position to follow. */
  finePointer: boolean;
  /** Test hooks: the frame scheduler and the stage size. */
  raf?: (cb: () => void) => void;
  size?: () => { width: number; height: number };
}

/** How quickly a layer closes the gap to where the mouse wants it, per frame. */
const EASE = 0.09;
/** Below this many pixels from rest the loop stops, so an idle page schedules no frames. */
const REST = 0.05;

/**
 * Each `[data-depth]` layer inside `.top` shifts by up to its depth, in pixels, against the mouse: depth 26 slides 26px
 * when the pointer is at an edge. Only `transform` is written, and the stage is measured on resize, never per frame.
 */
export function initParallax(doc: Document, opts: ParallaxOptions): void {
  if (opts.reducedMotion || !opts.finePointer) return;
  const stage = doc.querySelector<HTMLElement>('.top');
  if (!stage) return;
  const layers = [...stage.querySelectorAll<HTMLElement>('[data-depth]')].map((el) => ({ el, depth: Number(el.dataset.depth) || 0 }));
  if (!layers.length) return;

  const win = doc.defaultView;
  const raf = opts.raf ?? ((cb: () => void): void => void win?.requestAnimationFrame(cb));
  const size = opts.size ?? ((): { width: number; height: number } => ({ width: win?.innerWidth ?? 1, height: win?.innerHeight ?? 1 }));

  let { width, height } = size();
  let tx = 0;
  let ty = 0;
  let x = 0;
  let y = 0;
  let running = false;

  const frame = (): void => {
    x += (tx - x) * EASE;
    y += (ty - y) * EASE;
    const settled = Math.abs(tx - x) < REST / 26 && Math.abs(ty - y) < REST / 26;
    if (settled) {
      x = tx;
      y = ty;
    }
    for (const { el, depth } of layers) el.style.transform = `translate3d(${(-x * depth).toFixed(2)}px, ${(-y * depth).toFixed(2)}px, 0)`;
    if (settled) running = false;
    else raf(frame);
  };
  const go = (): void => {
    if (running) return;
    running = true;
    raf(frame);
  };

  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    tx = Math.max(-1, Math.min(1, (e.clientX / width) * 2 - 1));
    ty = Math.max(-1, Math.min(1, (e.clientY / height) * 2 - 1));
    go();
  });
  stage.addEventListener('pointerleave', () => {
    tx = 0;
    ty = 0;
    go();
  });
  win?.addEventListener('resize', () => ({ width, height } = size()));
}
