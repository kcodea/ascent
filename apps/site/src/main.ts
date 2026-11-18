import './styles/tokens.css';
import './styles/base.css';
import './styles/sections.css';
import { initCaptures } from './captures';
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
  initCaptures(document, {
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    observe,
  });
});
