// @vitest-environment jsdom
/**
 * The `portals` container against the REAL page shape (perf report 2026-09-30). Since the responsive stage
 * (`stage.ts`) wraps `#root` in `#stage`, the old `body > :not(#root)` selector matched `#stage` itself, so
 * "portals" counted the whole game: the owner's capture read "portals grew 82 → 664 and never came back", which
 * was the app's DOM going from the title into a run, not a leak. These pin that the selector counts only what is
 * mounted OUTSIDE the React root, whichever parent it was portalled to.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PERF_DOM_CONTAINERS } from './perfDomContainers';

const count = (sel: string): number => {
  let n = 0;
  for (const el of document.querySelectorAll(sel)) n += 1 + el.getElementsByTagName('*').length;
  return n;
};

afterEach(() => { document.body.innerHTML = ''; });

describe('PERF_DOM_CONTAINERS.portals', () => {
  it('counts nothing of the game tree inside #stage > #root', () => {
    document.body.innerHTML = '<div id="stage"><div id="root"><div data-zone="tavern"><i></i><i></i><i></i></div><p></p></div></div>';
    expect(count(PERF_DOM_CONTAINERS.portals!)).toBe(0);
  });

  it('counts a portal on #stage and one on <body>, and nothing else', () => {
    document.body.innerHTML =
      '<div id="stage"><div id="root"><p></p><p></p></div><div class="dragcard"><span></span></div></div>' +
      '<div class="rotate-prompt"><b></b></div><script></script>';
    // .dragcard + its span (2) and .rotate-prompt + its b (2).
    expect(count(PERF_DOM_CONTAINERS.portals!)).toBe(4);
  });

  it('still works on the pre-stage shape (#root directly under <body>)', () => {
    document.body.innerHTML = '<div id="root"><p></p></div><div class="tip"></div>';
    expect(count(PERF_DOM_CONTAINERS.portals!)).toBe(1);
  });
});
