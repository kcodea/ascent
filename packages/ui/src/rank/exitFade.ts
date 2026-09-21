import { gsap } from 'gsap';

/**
 * THE CONTINUE CROSS-FADE (owner 2026-09-20): the rank screen fades INTO the main menu instead of cutting.
 *
 * `openTitle` flips `showTitle`, which unmounts the end screen in the same commit the title mounts (Game.tsx
 * gates the board on `isPreRun`), so the React element cannot be what fades. Instead the settled overlay is
 * CLONED onto <body> above the title (`.rankend-exit`, pointer-events none, aria-hidden), the real one is
 * released to React, and the clone tweens to opacity 0 and removes itself. The clone is static DOM — the
 * same cached images, no canvas, no listeners — so it costs one paint. Opacity only; the fade is 400 ms
 * (150 ms under reduced motion). Returns the tween so a caller can settle it (tests, a fast second exit).
 */
export const EXIT_FADE_MS = 400;
export const EXIT_FADE_REDUCED_MS = 150;

export function beginExitFade(overlay: HTMLElement, reduced: boolean): gsap.core.Tween {
  const clone = overlay.cloneNode(true) as HTMLElement;
  clone.classList.add('rankend-exit');
  clone.setAttribute('aria-hidden', 'true');
  clone.removeAttribute('role');
  // A cloned <button> must never be a second Continue: strip ids / focusability from the copy.
  for (const el of clone.querySelectorAll<HTMLElement>('button, [tabindex], [id]')) {
    el.setAttribute('tabindex', '-1');
    el.removeAttribute('id');
    if (el instanceof HTMLButtonElement) el.disabled = true;
  }
  document.body.appendChild(clone);
  return gsap.to(clone, {
    opacity: 0,
    duration: (reduced ? EXIT_FADE_REDUCED_MS : EXIT_FADE_MS) / 1000,
    ease: 'power1.in',
    onComplete: () => { clone.remove(); },
  });
}
