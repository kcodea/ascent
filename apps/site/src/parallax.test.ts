// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { initParallax } from './parallax';

/** A frame queue the test drains by hand. */
function frames(): { raf: (cb: () => void) => void; run: (max?: number) => number } {
  let queue: Array<() => void> = [];
  return {
    raf: (cb) => void queue.push(cb),
    run: (max = 2000) => {
      let n = 0;
      while (queue.length && n < max) {
        const batch = queue;
        queue = [];
        for (const cb of batch) cb();
        n++;
      }
      return n;
    },
  };
}

const move = (el: Element, x: number, y: number, pointerType = 'mouse'): void => {
  const e = new Event('pointermove');
  Object.assign(e, { clientX: x, clientY: y, pointerType });
  el.dispatchEvent(e);
};

describe('the top section parallax', () => {
  let top: HTMLElement;
  let near: HTMLElement;
  let far: HTMLElement;
  const size = (): { width: number; height: number } => ({ width: 1000, height: 500 });

  beforeEach(() => {
    document.body.innerHTML = '<header class="top"><div data-depth="10"></div><div data-depth="30"></div></header>';
    top = document.querySelector('.top')!;
    [far, near] = [...top.querySelectorAll<HTMLElement>('[data-depth]')];
  });

  it('slides each layer against the mouse by its depth, the near one further, then stops asking for frames', () => {
    const f = frames();
    initParallax(document, { reducedMotion: false, finePointer: true, raf: f.raf, size });
    move(top, 1000, 500); // bottom right corner
    expect(f.run()).toBeLessThan(2000);
    expect(far.style.transform).toBe('translate3d(-10.00px, -10.00px, 0)');
    expect(near.style.transform).toBe('translate3d(-30.00px, -30.00px, 0)');
    expect(f.run()).toBe(0);
  });

  it('eases there over several frames, and returns to rest when the mouse leaves', () => {
    const f = frames();
    initParallax(document, { reducedMotion: false, finePointer: true, raf: f.raf, size });
    move(top, 0, 250); // left edge, vertical middle
    f.run(1);
    const first = Number(/translate3d\(([-\d.]+)px/.exec(near.style.transform)![1]);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(30);
    f.run();
    expect(near.style.transform).toBe('translate3d(30.00px, 0.00px, 0)');
    top.dispatchEvent(new Event('pointerleave'));
    f.run();
    expect(near.style.transform).toBe('translate3d(0.00px, 0.00px, 0)');
  });

  it.each([
    ['reduced motion', { reducedMotion: true, finePointer: true }],
    ['a touch-only device', { reducedMotion: false, finePointer: false }],
  ])('does nothing with %s', (_name, opts) => {
    const f = frames();
    initParallax(document, { ...opts, raf: f.raf, size });
    move(top, 1000, 500);
    expect(f.run()).toBe(0);
    expect(near.style.transform).toBe('');
  });

  it('ignores a finger dragging across a touch screen laptop', () => {
    const f = frames();
    initParallax(document, { reducedMotion: false, finePointer: true, raf: f.raf, size });
    move(top, 1000, 500, 'touch');
    expect(f.run()).toBe(0);
  });
});
