import './styles/tokens.css';
import './styles/base.css';
import './styles/sections.css';
import { initAncients, initRunes } from './ancients';
import { initCaptures } from './captures';
import { initChests } from './chests';
import { initParallax } from './parallax';
import { applyPlatform, detectPlatform } from './platform';

/** Calls onVisible once, the first time el is within 200px of the viewport (at once if there is no observer). */
function observe(el: Element, onVisible: () => void): void {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible();
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.unobserve(el);
      onVisible();
    },
    { rootMargin: '200px' },
  );
  io.observe(el);
}

document.addEventListener('DOMContentLoaded', () => {
  applyPlatform(document, detectPlatform(navigator.userAgent, navigator.maxTouchPoints));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  initCaptures(document, { reducedMotion, observe });
  initAncients(document);
  initRunes(document);
  initChests(document, { reducedMotion });
  // The scene tuner: only with ?tune on the address, and only then downloaded.
  if (new URLSearchParams(window.location.search).has('tune')) void import('./tuner').then((m) => m.initTuner(document));
  initParallax(document, { reducedMotion, finePointer: window.matchMedia('(hover: hover) and (pointer: fine)').matches });
});
