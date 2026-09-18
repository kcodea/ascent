/**
 * NO NATIVE TOOLTIPS — anywhere (owner ruling 2026-09-18: "remove the windows tooltip. this should never show
 * anywhere"). The game paints its own hover surfaces (card reveals, keyword pills, tuner hints); the OS's yellow
 * `title` box on top of them reads as a foreign window and hides the art.
 *
 * ONE guard rather than a sweep of the ~200 `title=` attributes: the attribute is still useful to the code that
 * sets it (tests, accessibility tools, the DevTools tree), so it is MOVED to `data-title` the moment the pointer
 * enters the element — before the browser's tooltip delay elapses — and the OS never gets to show it. Capture
 * phase, one `closest()` per pointerover, no layout read.
 */
let installed = false;
export function installNoNativeTooltips(): () => void {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  const onOver = (e: Event): void => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    // Walk the hovered chain: a tooltip shows for the NEAREST titled ancestor, so every titled ancestor is stripped.
    let el: Element | null = t.closest('[title]');
    while (el) {
      const v = el.getAttribute('title');
      if (v !== null) { el.setAttribute('data-title', v); el.removeAttribute('title'); }
      el = el.parentElement?.closest('[title]') ?? null;
    }
  };
  document.addEventListener('pointerover', onOver, { capture: true, passive: true });
  return () => { document.removeEventListener('pointerover', onOver, { capture: true }); installed = false; };
}
