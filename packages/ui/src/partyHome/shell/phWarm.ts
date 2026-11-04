/**
 * WARM THE PAGE CHUNKS on idle (party home prototype): the shell's pages load lazily, so a first visit would otherwise show
 * empty backdrop while its chunk arrives. One module per idle slot, after the home has settled. A glob, so it covers
 * whichever pages this build has. DEV only, like the prototype: production has none of this.
 */
const PAGES: Record<string, () => Promise<unknown>> = import.meta.env.DEV
  ? import.meta.glob(['./PhPageChrome.tsx', './PhBookNav.tsx', '../pages/**/*Ph.tsx', '../pages/Ph*.tsx', '../pages/**/Ph*.tsx', '../../progression/ph/*Ph.tsx', '!**/*.test.tsx'])
  : {};

let warmed = false;
export function warmPhPages(): void {
  if (warmed) return;
  warmed = true;
  const queue = Object.values(PAGES);
  const idle = (fn: () => void): void => { if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(fn, { timeout: 2000 }); else setTimeout(fn, 200); };
  const next = (): void => {
    const load = queue.shift();
    if (!load) return;
    void load().catch(() => undefined).finally(() => idle(next));
  };
  idle(next);
}
